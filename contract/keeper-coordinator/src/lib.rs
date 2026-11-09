#![no_std]

use soroban_sdk::{
    contract, contractimpl, contractmeta, contracttype, symbol_short, Address, Env, Symbol, Vec,
};

const MAX_LOCK_TTL_LEDGERS: u32 = 1_000;
const STORAGE_TTL_LEDGERS: u32 = 100_000;

/// Maximum number of claim entries scanned or returned in a single view call so that
/// read-only queries never exceed Soroban's per-transaction read budget.
pub const MAX_CLAIMS_SCAN_LIMIT: u32 = 32;

contractmeta!(key = "name", val = "ChronoStar Keeper Coordinator");
contractmeta!(key = "version", val = "0.1.0");
contractmeta!(
    key = "description",
    val = "Exclusive claim ledger that stops two keepers executing the same schedule"
);

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Keeper(Address),
    Claim(Symbol, u64),
    ClaimIndex,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Claim {
    pub keeper: Address,
    pub expires_at: u32,
}

#[contract]
pub struct KeeperCoordinator;

#[contractimpl]
impl KeeperCoordinator {
    pub fn register(env: Env, keeper: Address) {
        keeper.require_auth();
        let key = DataKey::Keeper(keeper.clone());
        env.storage().persistent().set(&key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&key, STORAGE_TTL_LEDGERS, STORAGE_TTL_LEDGERS);
        env.events()
            .publish((symbol_short!("register"), keeper), ());
    }

    pub fn unregister(env: Env, keeper: Address) {
        keeper.require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::Keeper(keeper.clone()));
        env.events().publish((symbol_short!("remove"), keeper), ());
    }

    pub fn is_registered(env: Env, keeper: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Keeper(keeper))
            .unwrap_or(false)
    }

    pub fn claim(env: Env, resource: Symbol, id: u64, keeper: Address, ttl_ledgers: u32) -> bool {
        keeper.require_auth();
        assert!(
            Self::is_registered(env.clone(), keeper.clone()),
            "keeper not registered"
        );
        assert!(ttl_ledgers > 0, "lock TTL must be positive");
        assert!(ttl_ledgers <= MAX_LOCK_TTL_LEDGERS, "lock TTL too large");

        let key = DataKey::Claim(resource.clone(), id);
        let now = env.ledger().sequence();
        if let Some(existing) = env.storage().persistent().get::<_, Claim>(&key) {
            if existing.expires_at > now && existing.keeper != keeper {
                return false;
            }
        }

        let expires_at = now.checked_add(ttl_ledgers).expect("lock expiry overflow");
        env.storage().persistent().set(
            &key,
            &Claim {
                keeper: keeper.clone(),
                expires_at,
            },
        );
        env.storage()
            .persistent()
            .extend_ttl(&key, STORAGE_TTL_LEDGERS, STORAGE_TTL_LEDGERS);

        Self::index_claim(&env, resource.clone(), id, now);

        env.events().publish(
            (symbol_short!("claimed"), resource, id),
            (keeper, expires_at),
        );
        true
    }

    pub fn release(env: Env, resource: Symbol, id: u64, keeper: Address) -> bool {
        keeper.require_auth();
        let key = DataKey::Claim(resource.clone(), id);
        let Some(existing) = env.storage().persistent().get::<_, Claim>(&key) else {
            return false;
        };
        if existing.keeper != keeper {
            return false;
        }
        env.storage().persistent().remove(&key);
        Self::unindex_claim(&env, &resource, id);
        env.events()
            .publish((symbol_short!("released"), resource, id), keeper);
        true
    }

    pub fn get_claim(env: Env, resource: Symbol, id: u64) -> Option<Claim> {
        env.storage()
            .persistent()
            .get(&DataKey::Claim(resource, id))
    }

    /// Returns the number of live (non-expired) claims currently stored, scanning at most
    /// `MAX_CLAIMS_SCAN_LIMIT` indexed claim keys so the view call stays within the read budget.
    pub fn get_claim_count(env: Env) -> u32 {
        Self::list_live_claims(env, None, MAX_CLAIMS_SCAN_LIMIT).len()
    }

    /// Returns up to `limit` (clamped to `MAX_CLAIMS_SCAN_LIMIT`) live claims currently active
    /// (`expires_at > current_ledger`), optionally filtered by `resource`.
    pub fn list_live_claims(
        env: Env,
        resource: Option<Symbol>,
        limit: u32,
    ) -> Vec<(Symbol, u64, Claim)> {
        let now = env.ledger().sequence();
        let cap = limit.min(MAX_CLAIMS_SCAN_LIMIT);
        let mut live = Vec::new(&env);
        if cap == 0 {
            return live;
        }

        let index: Vec<(Symbol, u64)> = env
            .storage()
            .persistent()
            .get(&DataKey::ClaimIndex)
            .unwrap_or_else(|| Vec::new(&env));

        let mut scanned = 0u32;
        for (res, id) in index.iter() {
            if scanned >= MAX_CLAIMS_SCAN_LIMIT || live.len() >= cap {
                break;
            }
            if let Some(ref filter) = resource {
                if &res != filter {
                    continue;
                }
            }
            scanned += 1;
            if let Some(claim) = env
                .storage()
                .persistent()
                .get::<_, Claim>(&DataKey::Claim(res.clone(), id))
            {
                if claim.expires_at > now {
                    live.push_back((res, id, claim));
                }
            }
        }
        live
    }

    /// Returns the earliest `expires_at` ledger across live claims (scanning up to
    /// `MAX_CLAIMS_SCAN_LIMIT` entries), or `None` when no live claims exist.
    pub fn get_next_expiry(env: Env) -> Option<u32> {
        let live = Self::list_live_claims(env, None, MAX_CLAIMS_SCAN_LIMIT);
        let mut earliest: Option<u32> = None;
        for (_, _, claim) in live.iter() {
            earliest = Some(match earliest {
                Some(cur) => cur.min(claim.expires_at),
                None => claim.expires_at,
            });
        }
        earliest
    }

    fn index_claim(env: &Env, resource: Symbol, id: u64, now: u32) {
        let existing: Vec<(Symbol, u64)> = env
            .storage()
            .persistent()
            .get(&DataKey::ClaimIndex)
            .unwrap_or_else(|| Vec::new(env));

        let mut updated = Vec::new(env);
        let mut found = false;
        for (res, existing_id) in existing.iter() {
            if res == resource && existing_id == id {
                updated.push_back((res, existing_id));
                found = true;
                continue;
            }
            if let Some(claim) = env
                .storage()
                .persistent()
                .get::<_, Claim>(&DataKey::Claim(res.clone(), existing_id))
            {
                if claim.expires_at > now && updated.len() < MAX_CLAIMS_SCAN_LIMIT {
                    updated.push_back((res, existing_id));
                }
            }
        }
        if !found && updated.len() < MAX_CLAIMS_SCAN_LIMIT {
            updated.push_back((resource, id));
        }
        env.storage()
            .persistent()
            .set(&DataKey::ClaimIndex, &updated);
        env.storage().persistent().extend_ttl(
            &DataKey::ClaimIndex,
            STORAGE_TTL_LEDGERS,
            STORAGE_TTL_LEDGERS,
        );
    }

    fn unindex_claim(env: &Env, resource: &Symbol, id: u64) {
        let Some(existing) = env
            .storage()
            .persistent()
            .get::<_, Vec<(Symbol, u64)>>(&DataKey::ClaimIndex)
        else {
            return;
        };
        let mut updated = Vec::new(env);
        for (res, existing_id) in existing.iter() {
            if &res != resource || existing_id != id {
                updated.push_back((res, existing_id));
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::ClaimIndex, &updated);
        env.storage().persistent().extend_ttl(
            &DataKey::ClaimIndex,
            STORAGE_TTL_LEDGERS,
            STORAGE_TTL_LEDGERS,
        );
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    #[test]
    fn two_keepers_contend_and_expiry_restores_liveness() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = env.register(KeeperCoordinator, ());
        let client = KeeperCoordinatorClient::new(&env, &contract);
        let first = Address::generate(&env);
        let second = Address::generate(&env);
        client.register(&first);
        client.register(&second);

        assert!(client.claim(&symbol_short!("dca"), &42, &first, &10));
        assert!(!client.claim(&symbol_short!("dca"), &42, &second, &10));
        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 10);
        assert!(client.claim(&symbol_short!("dca"), &42, &second, &10));
        assert_eq!(
            client.get_claim(&symbol_short!("dca"), &42).unwrap().keeper,
            second
        );
    }

    #[test]
    fn resource_namespaces_do_not_collide() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = env.register(KeeperCoordinator, ());
        let client = KeeperCoordinatorClient::new(&env, &contract);
        let keeper = Address::generate(&env);
        client.register(&keeper);
        assert!(client.claim(&symbol_short!("vault"), &1, &keeper, &5));
        assert!(client.claim(&symbol_short!("dca"), &1, &keeper, &5));
    }

    #[test]
    fn claim_count_and_next_expiry_cover_empty_single_and_expired_cases() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(100);
        let contract = env.register(KeeperCoordinator, ());
        let client = KeeperCoordinatorClient::new(&env, &contract);
        let keeper = Address::generate(&env);
        client.register(&keeper);

        // 1. Empty case
        assert_eq!(client.get_claim_count(), 0);
        assert_eq!(client.get_next_expiry(), None);
        assert_eq!(client.list_live_claims(&None, &10).len(), 0);

        // 2. Single-claim case (plus second claim with later expiry)
        assert!(client.claim(&symbol_short!("vault"), &1, &keeper, &15)); // expires at 115
        assert_eq!(client.get_claim_count(), 1);
        assert_eq!(client.get_next_expiry(), Some(115));
        let listed = client.list_live_claims(&None, &10);
        assert_eq!(listed.len(), 1);
        assert_eq!(
            listed.get(0).unwrap(),
            (
                symbol_short!("vault"),
                1u64,
                Claim {
                    keeper: keeper.clone(),
                    expires_at: 115,
                }
            )
        );

        assert!(client.claim(&symbol_short!("dca"), &2, &keeper, &8)); // expires at 108
        assert_eq!(client.get_claim_count(), 2);
        assert_eq!(client.get_next_expiry(), Some(108));
        assert_eq!(
            client
                .list_live_claims(&Some(symbol_short!("dca")), &10)
                .len(),
            1
        );

        // 3. Expired-claim case: advance past first expiry (108), then past all expiries (115)
        env.ledger().set_sequence_number(108);
        assert_eq!(client.get_claim_count(), 1);
        assert_eq!(client.get_next_expiry(), Some(115));

        env.ledger().set_sequence_number(115);
        assert_eq!(client.get_claim_count(), 0);
        assert_eq!(client.get_next_expiry(), None);
        assert_eq!(client.list_live_claims(&None, &10).len(), 0);
    }
}
