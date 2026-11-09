#![no_std]

use soroban_sdk::{
    contract, contractimpl, contractmeta, contracttype, symbol_short, Address, Env, Symbol,
};

/// Minimum claim lock TTL in ledgers (~25 seconds at 5s/ledger).
/// Covers a single Soroban transaction's inclusion and settlement window plus RPC margin
/// between acquiring the claim and submitting the guarded invocation.
pub const MIN_LOCK_TTL_LEDGERS: u32 = 5;

/// Maximum claim lock TTL in ledgers (~83 minutes at 5s/ledger).
/// Caps how long a crashed keeper can delay another keeper from taking over a schedule.
pub const MAX_LOCK_TTL_LEDGERS: u32 = 1_000;
const STORAGE_TTL_LEDGERS: u32 = 100_000;

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

    /// Acquires or renews an exclusive claim on `(resource, id)` for `ttl_ledgers` ledgers.
    ///
    /// `ttl_ledgers` must satisfy `MIN_LOCK_TTL_LEDGERS <= ttl_ledgers <= MAX_LOCK_TTL_LEDGERS`.
    pub fn claim(env: Env, resource: Symbol, id: u64, keeper: Address, ttl_ledgers: u32) -> bool {
        keeper.require_auth();
        assert!(
            Self::is_registered(env.clone(), keeper.clone()),
            "keeper not registered"
        );
        assert!(
            ttl_ledgers >= MIN_LOCK_TTL_LEDGERS,
            "lock TTL below minimum"
        );
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
        env.events()
            .publish((symbol_short!("released"), resource, id), keeper);
        true
    }

    pub fn get_claim(env: Env, resource: Symbol, id: u64) -> Option<Claim> {
        env.storage()
            .persistent()
            .get(&DataKey::Claim(resource, id))
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
    #[should_panic(expected = "lock TTL below minimum")]
    fn claim_rejects_ttl_below_minimum() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = env.register(KeeperCoordinator, ());
        let client = KeeperCoordinatorClient::new(&env, &contract);
        let keeper = Address::generate(&env);
        client.register(&keeper);
        client.claim(
            &symbol_short!("vault"),
            &1,
            &keeper,
            &(MIN_LOCK_TTL_LEDGERS - 1),
        );
    }

    #[test]
    #[should_panic(expected = "lock TTL too large")]
    fn claim_rejects_ttl_above_maximum() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = env.register(KeeperCoordinator, ());
        let client = KeeperCoordinatorClient::new(&env, &contract);
        let keeper = Address::generate(&env);
        client.register(&keeper);
        client.claim(
            &symbol_short!("vault"),
            &1,
            &keeper,
            &(MAX_LOCK_TTL_LEDGERS + 1),
        );
    }
}
