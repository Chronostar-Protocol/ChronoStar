#{!no_std]
use soroban_sdk{
#`!no_std]
use soroban_sdk({
    contract, contractimpl, contractmeta, contracttype, symbol_short, token, Address, Env, String,
    Symbol, Vec,
};

contractmeta!(key = "name", val = "ChronoStar Recurring Stream");
contractmeta!(key = "version", val = "0.1.0");
contractmeta!(
    key = "description",
    val = "Recurring Stellar token payment streams"
);

#[contracttype]
pub enum DataKey {
    Stream(u64),
    Counter,
    StreamsByOwner(Address),
    StreamsByRecipient(Address),
    StreamSplits(u64),
}

#[contracttype]
#[derive(Clone)]
pub struct StreamSplit {
    pub recipient: Address,
    pub share: u16,
}

#[contracttype]
#[derive(Clone)]
pub struct StreamEntry {
    pub id: u64,
    pub owner: Address,
    pub recipient: Address,
    pub token: Address,
    pub total_amount: i128,
    pub claimed_amount: i128,
    pub start_ledger: u32,
    pub end_ledger: u32,
    pub last_claimed_ledger: u32,
    pub created_ledger: u32,
    pub label: String,
    pub grace_period_ledgers: u32,
    pub status: StreamStatus,
    // Ledger at which the stream was last paused. Zero when not paused.
    pub paused_at_ledger: u32,
    // Total number of ledgers the stream has been paused across all pauses.
    pub paused_ledgers: u32,
}

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum StreamStatus {
    Active,
    Paused,
    Completed,
    Cancelled,
}

impl StreamEntry {
    // Number of ledgers the stream has been active (excluding paused intervals)
    // as of `current_ledger`.
    fn active_ledgers(&self, current_ledger: u32) -> u32 {
        let effective_ledger = current_ledger.min(self.end_ledger);
        if effective_ledger <= self.start_ledger {
            return 0;
        }
        // Total wall-clock ledgers since start.
        let total_elapsed = effective_ledger - self.start_ledger;
        // Ledgers consumed by completed pauses.
        let mut paused = self.paused_ledgers;
        // If currently paused, subtract the ongoing pause interval too.
        if self.status == StreamStatus::Paused && self.paused_at_ledger > 0 {
            let pause_start = self.paused_at_ledger.min(effective_ledger);
            if effective_ledger > pause_start {
                paused = paused.saturating_add(effective_ledger - pause_start);
            }
        }
        total_elapsed.saturating_sub(paused)
    }

    pub fn claimable_amount(&self, current_ledger: u32) -> i128 {
        if self.status != StreamStatus::Active {
        if current_ledger < self.start_ledger {
            return 0;
        }
        let effective_ledger = current_ledger.min(self.end_ledger);
        if effective_ledger <= self.last_claimed_ledger {
            return 0;
        }
        let total_duration = (self.end_ledger - self.start_ledger) as i128;
        if total_duration == 0 {
            return 0;
        }
        let active = self.active_ledgers(current_ledger) as i128;
        let vested = (self.total_amount * active) / total_duration;
        // Never vest more than the total amount.
        let vested = vested.min(self.total_amount);
        let claimable = vested - self.claimed_amount;
        claimable.max(0)
    }
}



#[contractimpl]
impl RecurringStream {
    pub fn create_stream(
        env: Env,
        owner: Address,
        recipient: Address,
        token: Address,
        total_amount: i128,
        duration_ledgers: u32,
        grace_period_ledgers: u32,
        label: String,
        start_delay_ledgers: u32,
    ) -> u64 {
        owner.require_auth();
        assert!(total_amount > 0, "amount must be positive");
        assert!(
            duration_ledgers >= 60,
            "minimum duration is 60 ledgers (~5 min)"
        );

        let token_client = token::Client::new(&env, &token);
        token_client.transfer_from(
            &env.current_contract_address(),
            &owner,
            &env.current_contract_address(),
            &total_amount,
        );

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0u64)
            + 1;
        env.storage().instance().set(&DataKey::Counter, &id);

        let current = env.ledger().sequence();
        let start_ledger = current + start_delay_ledgers;
        let stream = StreamEntry {
            id,
            owner: owner.clone(),
            recipient: recipient.clone(),
            token,
            total_amount,
            claimed_amount: 0,
            start_ledger,
            end_ledger: start_ledger + duration_ledgers,
            last_claimed_ledger: start_ledger,
            created_ledger: current,
            label,
            grace_period_ledgers,
            status: StreamStatus::Active,
            paused_at_ledger: 0,
            paused_ledgers: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Stream(id), &stream);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Stream(id), 6_312_000, 6_312_000);

        let mut owner_streams: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::StreamsByOwner(owner.clone()))
            .unwrap_or(Vec::new(&env));
        owner_streams.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::StreamsByOwner(owner.clone()), &owner_streams);
        env.storage().persistent().extend_ttl(
            &DataKey::StreamsByOwner(owner),
            6_312_000,
            6_312_000,
        );

        let mut rec_streams: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::StreamsByRecipient(recipient.clone()))
            .unwrap_or();
        rec_streams.push_back(id);
        env.storage().persistent().set(
            &DataKey::StreamsByRecipient(recipient.clone()),
            &rec_streams,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::StreamsByRecipient(recipient),
            6_312_000,
            6_312_000,
        );

        env.storage().instance().extend_ttl(100_000, 100_000);

        id
    }

    pub fn create_split_stream(
        env: Env,
        owner: Address,
        splits: Vec<StreamSplit>,
        token: Address,
        total_amount: i128,
        duration_ledgers: u32,
        label: String,
    ) -> u64 {
        owner.require_auth();
        assert!(total_amount > 0, "amount must be positive");
        assert!(
            duration_ledgers >= 60,
            "minimum duration is 60 ledgers (~5 min)"
        );
        assert!(splits.len() > 1, "use create_stream for single recipient");

        let mut total_share: u16 = 0;
        for split in splits.iter() {
            total_share += split.share;
        }
        assert!(total_share == 10000, "shares must sum to 10000");

        let token_client = token::Client::new(&env, &token);
        token_client.transfer_from(
            &env.current_contract_address(),
            &owner,
            &env.current_contract_address(),
            &total_amount,
        );

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0u64)
            + 1;
        env.storage().instance().set(&DataKey::Counter, &id);

        let current = env.ledger().sequence();
        let stream = StreamEntry {
            id,
            owner: owner.clone(),
            recipient: env.current_contract_address(),
            token,
            total_amount,
            claimed_amount: 0,
            start_ledger: current,
            end_ledger: current + duration_ledgers,
            last_claimed_ledger: current,
            created_ledger: current,
            label,
            status: StreamStatus::Active,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Stream(id), &stream);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Stream(id), 6_312_000, 6_312_000);

        env.storage()
            .persistent()
            .set(&DataKey::StreamSplits(id), &splits);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::StreamSplits(id), 6_312_000, 6_312_000);

        let mut owner_streams: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::StreamsByOwner(owner.clone()))
            .unwrap_or(Vec::new(&env));
        owner_streams.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::StreamsByOwner(owner.clone()), &owner_streams);
        env.storage().persistent().extend_ttl(
            &DataKey::StreamsByOwner(owner),
            6_312_000,
            6_312_000,
        );

        for split in splits.iter() {
            let mut rec_streams: Vec<u64> = env
                .storage()
                .persistent()
                .get(&DataKey::StreamsByRecipient(split.recipient.clone()))
                .unwrap_or(Vec::new(&env));
            rec_streams.push_back(id);
            env.storage().persistent().set(
                &DataKey::StreamsByRecipient(split.recipient.clone()),
                &rec_streams,
            );
            env.storage().persistent().extend_ttl(
                &DataKey::StreamsByRecipient(split.recipient.clone()),
                6_312_000,
                6_312_000,
            );
        }

        env.storage().instance().extend_ttl(100_000, 100_000);

        id
    }

    pub fn claim(env: Env, caller: Address, stream_id: u64) -> i128 {
        let mut stream: StreamEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        caller.require_auth();

        let splits_opt: Option<Vec<StreamSplit>> = env
            .storage()
            .persistent()
            .get(&DataKey::StreamSplits(stream_id));

        if let Some(splits) = &splits_opt {
            let mut found = false;
            for split in splits.iter() {
                if split.recipient == caller {
                    found = true;
                    break;
                }
            }
            assert!(found, "caller not in splits");
        } else {
            assert!(caller == stream.recipient, "caller not recipient");
        }

        assert!(stream.status == StreamStatus::Active, "stream not active");

        let current = env.ledger().sequence();
        assert!(
            current >= stream.start_ledger,
            "stream has not started yet"
        );
        let claimable = stream.claimable_amount(current);
        assert!(claimable > 0, "nothing to claim");

        stream.claimed_amount += claimable;
        stream.last_claimed_ledger = current;

        if stream.claimed_amount >= stream.total_amount || current >= stream.end_ledger {
            stream.status = StreamStatus::Completed;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Stream(stream_id), 6_312_000, 6_312_000);

        let token_client = token::Client::new(&env, &stream.token);

        if let Some(splits) = splits_opt {
            let mut remaining = claimable;
            let len = splits.len();
            for i in 0..len {
                let split = splits.get(i).unwrap();
                let amount = if i == len - 1 {
                    remaining
                } else {
                    let share_amount = (claimable * (split.share as i128)) / 10000;
                    remaining -= share_amount;
                    share_amount
                };
                if amount > 0 {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &split.recipient,
                        &amount,
                    );
                }
            }
        } else {
            token_client.transfer(
                &env.current_contract_address(),
                &stream.recipient,
                &claimable,
            );
        }

        env.events()
            .publish((symbol_short!("claimed"), stream_id), claimable);
        if stream.status == StreamStatus::Completed {
            env.events().publish(
                (symbol_short!("completed"), stream_id),
                stream.recipient.clone(),
            );
        }

        claimable
    }

    pub fn tick(env: Env, stream_id: u64) {
        let mut stream: StreamEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        if stream.status != StreamStatus::Active {
            return;
        }

        if env.ledger().sequence() >= stream.end_ledger
            && stream.claimed_amount >= stream.total_amount
        {
            stream.status = StreamStatus::Completed;
            env.storage()
                .persistent()
                .set(&DataKey::Stream(stream_id), &stream);
            env.events().publish(
                (symbol_short!("completed"), stream_id),
                stream.recipient.clone(),
            );
        } else if env.ledger().sequence() >= stream.end_ledger + stream.grace_period_ledgers {
            let remainder = stream.total_amount - stream.claimed_amount;
            if remainder > 0 {
                let token_client = token::Client::new(&env, &stream.token);
                token_client.transfer(&env.current_contract_address(), &stream.owner, &remainder);
            }
            stream.status = StreamStatus::Completed;
            env.storage()
                .persistent()
                .set(&DataKey::Stream(stream_id), &stream);
            env.events().publish(
                (symbol_short!("expired"), stream_id),
                stream.owner.clone(),
            );
        }

        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Stream(stream_id), 6_312_000, 6_312_000);
    }

    /// Pause an active stream. Only the owner may pause.
    /// Vesting is frozen from the current ledger onward until resume.
    pub fn pause(env: Env, stream_id: u64) {
        let mut stream: StreamEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        stream.owner.require_auth();
        assert!(
            stream.status == StreamStatus::Active,
            "stream not active"
        );

        let current = env.ledger().sequence();
        stream.status = StreamStatus::Paused;
        stream.paused_at_ledger = current;

        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Stream(stream_id), 6_312_000, 6_312_000);

        env.events()
            .publish((symbol_short!("paused"), stream_id), current);
    }

    /// Resume a paused stream. Only the owner may resume.
    /// The paused interval is accumulated into `paused_ledgers` so it is
    /// never counted as vested time.
    pub fn resume(env: Env, stream_id: u64) {
        let mut stream: StreamEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        stream.owner.require_auth();
        assert!(
            stream.status == StreamStatus::Paused,
            "stream not paused"
        );

        let current = env.ledger().sequence();
        let effective_current = current.min(stream.end_ledger);
        let pause_start = stream.paused_at_ledger.min(effective_current);
        if effective_current > pause_start {
            stream.paused_ledgers = stream
                .paused_ledgers
                .saturating_add(effective_current - pause_start);
        }
        stream.paused_at_ledger = 0;
        stream.status = StreamStatus::Active;

        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Stream(stream_id), 6_312_000, 6_312_000);

        env.events()
            .publish((symbol_short!("resumed"), stream_id), current);
    }

    pub fn cancel(env: Env, stream_id: u64) {
        let mut stream: StreamEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        stream.owner.require_auth();
        assert!(
            stream.status == StreamStatus::Active
                || stream.status == StreamStatus::Paused,
            "stream not active"
        );

        let current = env.ledger().sequence();

        // Compute claimable before mutating status. claimable_amount returns 0
        // for non-Active statuses, so we need to temporarily treat Paused as
        // active for the purpose of computing the vested amount at cancel.
        let claimable = if stream.status == StreamStatus::Paused {
            // Restore to Active temporarily to use the same accrual math.
            let mut tmp = stream.clone();
            tmp.status = StreamStatus::Active;
            tmp.claimable_amount(current)
        } else {
            stream.claimable_amount(current)
        };
        let token_client = token::Client::new(&env, &stream.token);

        if claimable > 0 {
            stream.claimed_amount += claimable;
            
            let splits_opt: Option<Vec<StreamSplit>> = env
                .storage()
                .persistent()
                .get(&DataKey::StreamSplits(stream_id));

            if let Some(splits) = splits_opt {
                let mut remaining = claimable;
                let len = splits.len();
                for i in 0..len {
                    let split = splits.get(i).unwrap();
                    let amount = if i == len - 1 {
                        remaining
                    } else {
                        let share_amount = (claimable * (split.share as i128)) / 10000;
                        remaining -= share_amount;
                        share_amount
                    };
                    if amount > 0 {
                        token_client.transfer(
                            &env.current_contract_address(),
                            &split.recipient,
                            &amount,
                        );
                    }
                }
            } else {
                token_client.transfer(
                    &env.current_contract_address(),
                    &stream.recipient,
                    &claimable,
                );
            }
        }

        let remainder = stream.total_amount - stream.claimed_amount;
        if remainder > 0 {
            token_client.transfer(&env.current_contract_address(), &stream.owner, &remainder);
        }

        stream.status = StreamStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);
        env.events().publish(
            (symbol_short!("cancelled"), stream_id),
            stream.owner.clone(),
        );
    }

    pub fn change_recipient(env: Env, stream_id: u64, new_recipient: Address) {
        let mut stream: StreamEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        stream.owner.require_auth();
        assert!(stream.status == StreamStatus::Active, "stream not active");

        let old_recipient = stream.recipient.clone();
        if old_recipient != new_recipient {
            let old_key = DataKey::StreamsByRecipient(old_recipient.clone());
            let old_streams: Vec<u64> = env
                .storage()
                .persistent()
                .get(&old_key)
                .unwrap_or(Vec::new(&env));
            let mut updated_old_streams = Vec::new(&env);
            for id in old_streams.iter() {
                if id != stream_id {
                    updated_old_streams.push_back(id);
                }
            }
            if updated_old_streams.is_empty() {
                env.storage().persistent().remove(&old_key);
            } else {
                env.storage()
                    .persistent()
                    .set(&old_key, &updated_old_streams);
                env.storage()
                    .persistent()
                    .extend_ttl(&old_key, 6_312_000, 6_312_000);
            }

            let new_key = DataKey::StreamsByRecipient(new_recipient.clone());
            let mut new_streams: Vec<u64> = env
                .storage()
                .persistent()
                .get(&new_key)
                .unwrap_or(Vec::new(&env));
            if !new_streams.contains(stream_id) {
                new_streams.push_back(stream_id);
            }
            env.storage().persistent().set(&new_key, &new_streams);
            env.storage()
                .persistent()
                .extend_ttl(&new_key, 6_312_000, 6_312_000);

            stream.recipient = new_recipient.clone();
            env.storage()
                .persistent()
                .set(&DataKey::Stream(stream_id), &stream);
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::Stream(stream_id), 6_312_000, 6_312_000);
        }

        env.events().publish(
            (Symbol::new(&env, "recipient_changed"), stream_id),
            (old_recipient, new_recipient),
        );
    }

    pub fn get_stream(env: Env, stream_id: u64) -> Option<StreamEntry> {
        env.storage().persistent().get(&DataKey::Stream(stream_id))
    }

    pub fn get_claimable(env: Env, stream_id: u64) -> i128 {
        let stream: StreamEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");
        stream.claimable_amount(env.ledger().sequence())
    }

    pub fn get_claimables(env: Env, stream_ids: Vec<u64>) -> Vec<i128> {
        let mut results = Vec::new(&env);
        let sequence = env.ledger().sequence();
        for id in stream_ids {
            let claimable = match env.storage().persistent().get::<_, StreamEntry>(&DataKey::Stream(id)) {
                Some(stream) => stream.claimable_amount(sequence),
                None => 0,
            };
            results.push_back(claimable);
        }
        results
    }

    pub fn get_streams_by_owner(env: Env, owner: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::StreamsByOwner(owner))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_streams_by_recipient(env: Env, recipient: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::StreamsByRecipient(recipient))
            .unwrap_or(Vec::new(&env))
    }

    pub fn current_ledger(env: Env) -> u32 {
        env.ledger().sequence()
    }

    pub fn stream_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Counter).unwrap_or(0)
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk{
        testutils:{Address as _, Ledger, LedgerInfo},
    use soroban_sdk {
        testutils::{Address as _, Ledger, LedgerInfo},
        token::{StellarAssetClient as TokenAdminClient, TokenClient},
        Env,
    };

    fn setup_test() -> (Env, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 1000,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        let owner = Address::generate(&env);
        let recipient = Address::generate(&env);

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();
        let token_admin_client = TokenAdminClient::new(&env, &token);
        token_admin_client.mint(&owner, &\n_000_000_000);

        let contract_id = env.register(RecurringStream, ());

        let token_client = TokenClient::new(&env, &token);
        token_client.approve(
            &owner,
            &contract_id,
            &\n_000_000_000i128,
            &(env.ledger().sequence() + 10000),
        );

        (env, contract_id, owner, recipient, token)
    }

    #[derive(Clone)]
    struct LedgerSnapshot {
        sequence_number: u32,
    }

    fn set_ledger(env: &Env, seq: u32) {
        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: seq,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });
    }

    #[test]
    fn test_create_stream() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let stream_client = RecurringStreamClient::new(&env, &contract_id);

        let stream_id = stream_client.create_stream(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &1440,
            &100,
            &String::from_str(&env, "Test stream"),
            &0,
        );

        assert_eq(stream_id, 1);

        let stream = stream_client.get_stream(&stream_id).unwrap();
        assert_eq(stream.owner, owner);
        assert_eq(stream.recipient, recipient);
        assert_eq(stream.total_amount, 1_000_000);
        assert_eq(stream.status, StreamStatus::Active);
        assert_eq(stream.paused_at_ledger, 0);
        assert_eq(stream.paused_ledgers, 0);
    }

    #[test]
    fn test_claim_partial() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let stream_client = RecurringStreamClient::new(&env, &contract_id);

        let stream_id = stream_client.create_stream(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &1000,
            &100,
            &String::from_str(&env, "Test stream"),
            &0,
        );

        set_ledger(&env, 1500);

        let claimable = stream_client.get_claimable(&stream_id);
        // 500 ledgers out of 1000 -> 50% of 1_000_000
        assert_eq(claimable, 500_000);
    }

    #[test]
    fn test_pause_freezes_vesting() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let stream_client = RecurringStreamClient::new(&env, &contract_id);

        let stream_id = stream_client.create_stream(
            &owner,
            &recipient,
            &token,
            &\n_000_000,
            &1000,
            &String::from_str(&env, "Pause test"),
        );

        // Advance to 1250 -> 25% vested
        set_ledger(&env, 1250);
        assert_eq(stream_client.get_claimable(&stream_id), 250_000);

        // Pause at 1250
        stream_client.pause(&stream_id);
        let s = stream_client.get_stream(&stream_id).unwrap();
        assert_eq(s.status, StreamStatus::Paused);
        assert_eq(s.paused_at_ledger, 1250);

        // Advance to 1500 while paused -> no new vesting
        set_ledger(&env, 1500);
        assert_eq(stream_client.get_claimable(&stream_id), 0);

        // Resume at 1500
        stream_client.resume(&stream_id);
        let s = stream_client.get_stream(&stream_id).unwrap();
        assert_eq(s.status, StreamStatus::Active);
        assert_eq(s.paused_ledgers, 250);
        assert_eq(s.paused_at_ledger, 0);

        // Advance to 1750 -> active ledgers = 500 -> 50% vested
        set_ledger(&env, 1750);
        assert_eq(stream_client.get_claimable(&stream_id), 500_000);
    }

    #[test]
    fn test_cancel_from_paused_refunds_correctly() {
        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 1500,
            timestamp: 0,
            network_id: [u8],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        let claimed = stream_client.claim(&recipient, &stream_id);
        assert!(claimed > 0);
        assert!(claimed < 1_000_000);
        let claimable = stream_client.get_claimable(&stream_id);
        assert_eq(claimable, 500_000);

        let claimed = stream_client.claim(&stream_id);
        assert_eq(claimed, 500_000);
    }

    #[test]
    fn test_zero_delay_matches_current_behaviour() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let stream_client = RecurringStreamClient::new(&env, &contract_id);
        let token_client = TokenClient::new(&env, &token);

        let stream_id = stream_client.create_stream(
            &owner,
            &recipient,
            &token,
            &_000_000,
            &1000,
            &String::from_str(&env, "Cancel test"),
        );

        // Advance to 1250 -> 25% vested
        set_ledger(&env, 1250);
        // Pause at 1250
        stream_client.pause(&stream_id);
        // Advance while paused
        set_ledger(&env, 1500);

        let owner_before = token_client.balance(&owner);
        let recipient_before = token_client.balance(&recipient);

        stream_client.cancel(&stream_id);

        // Recipient should get 25% vested (250_000), owner gets the rest.
        assert_eq(
            token_client.balance(&recipient) - recipient_before,
            250_000,
        );
        assert_eq(
            token_client.balance(&owner) - owner_before,
            750_000,
        );

        let s = stream_client.get_stream(&stream_id).unwrap();
        assert_eq(s.status, StreamStatus::Cancelled);
    }

    #[test]
    fn test_total_vested_never_exceeds_total_across_pause_resume() {
        // Property-style test: for many pause/resume schedules, the cumulative
        // vested amount must never exceed total_amount.
        let cases : [u32; 8] = [
            (100, 200, 300),
            (50, 100, 200),
            (250, 500, 750),
            (10, 20, 30),
            (100, 100, 100),
            (1, 2, 3),
            (500, 500, 500),
            (200, 300, 400),
        ];
        for (pause_at, pause_end, check_at) in cases {
            let (env, contract_id, owner, recipient, token) = setup_test();
            let stream_client = RecurringStreamClient::new(&env, &contract_id);

            let total: i128 = 1_000_000;
            let stream_id = stream_client.create_stream(
                &owner,
                &recipient,
                &token,
                &total,
                &\n_000,
                &String::from_str(&env, "Property test"),
            );

            // Advance to pause_at
            set_ledger(&env, 1000 + pause_at);
            stream_client.pause(&stream_id);

            // Advance to pause_end
            set_ledger(&env, 1000 + pause_end);
            stream_client.resume(&stream_id);

            // Advance to check_at
            set_ledger(&env, 1000 + check_at);

            let claimable = stream_client.get_claimable(&stream_id);
            assert!(claimable <= total, "claimable exceeds total");
            assert!(claimable >= 0, "claimable negative");

            // Also check that claiming the full amount never exceeds total.
            let claimed = stream_client.claim(&stream_id);
            assert!(claimed <= total, "claimed exceeds total");
        }
    }

    #[test]
    fn test_claim_after_resume_accrues_correctly() {
            &Sxring::from_str(&env, "Test stream"),
            &0,
        );

        let stream = stream_client.get_stream(&stream_id).unwrap();
        assert_eq(stream.start_ledger, 1000);
        assert_eq(stream.end_ledger, 2000);
        assert_eq(stream.last_claimed_ledger, 1000);
    }

    #[test]
    fn test_claim_before_cliff_fails() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let stream_client = RecurringStreamClient::new(&env, &contract_id);

        let stream_id = stream_client.create_stream(
            &owner,
            &recipient,
            &token,
            &\n_000_000,
            &1000,
            &100,
            &String::from_str(&env, "Claim after resume"),
        );

        // Pause at 1050 (5% vested)
        set_ledger(&env, 1050);
        stream_client.pause(&stream_id);

        // Resume at 1250 (200 ledgers paused)
        set_ledger(&env, 1250);
        stream_client.resume(&stream_id);

        // Advance to 1450 -> active ledgers = 450 -> 45% vested
        set_ledger(&env, 1450);
        let claimable = stream_client.get_claimable(&stream_id);
        assert_eq(claimable, 450_000);

        // Claim and verify balance
        let claimed = stream_client.claim(&stream_id);
        assert_eq(claimed, 450_000);
    }

    #[test]
    fn test_cannot_claim_while_paused() {
            &Sxring::from_str(&env, "Cliff stream"),
            &500,
        );

        let stream = stream_client.get_stream(&stream_id).unwrap();
        assert_eq(stream.start_ledger, 1500);
        assert_eq(stream.end_ledger, 2500);
        assert_eq(stream.last_claimed_ledger, 1500);

        // Before the cliff, nothing is claimable.
        assert_eq(stream_client.get_claimable(&stream_id), 0);

        // Attempting to claim before the cliff must fail with a clear error.
        let result = stream_client.try_claim(&stream_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_change_recipient_updates_index() {
        let (env, contract_id, owner, old_recipient, token) = setup_test();
        let new_recipient = Address::generate(&env);
        let stream_client = RecurringStreamClient::new(&env, &contract_id);
        let stream_id = stream_client.create_stream(
            &owner,
            &old_recipient,
            &token,
            &1_000_000,
            &1440,
            &String::from_str(&env, "Test stream"),
        );

        stream_client.change_recipient(&stream_id, &new_recipient);

        let stream = stream_client.get_stream(&stream_id).unwrap();
        assert_eq!(stream.recipient, new_recipient);
        assert!(stream_client
            .get_streams_by_recipient(&old_recipient)
            .is_empty());
        assert_eq!(
            stream_client.get_streams_by_recipient(&new_recipient),
            Vec::from_array(&env, [stream_id])
        );
    }

    #[test]
    fn test_change_recipient_rejected_after_completion() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let new_recipient = Address::generate(&env);
        let stream_client = RecurringStreamClient::new(&env, &contract_id);
        let stream_id = stream_client.create_stream(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &1000,
            &String::from_str(&env, "Test stream"),
        );
        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 2000,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });
        stream_client.claim(&stream_id);

        let claimed = stream_client.claim(&recipient, &stream_id);
        assert_eq!(claimed, 1_000_000);

        let stream = stream_client.get_stream(&stream_id).unwrap();
        assert_eq!(stream.status, StreamStatus::Completed);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            stream_client.change_recipient(&stream_id, &new_recipient);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_change_recipient_rejected_after_cancellation() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let new_recipient = Address::generate(&env);
        let stream_client = RecurringStreamClient::new(&env, &contract_id);
        let stream_id = stream_client.create_stream(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &1000,
            &100,
            &1440,
            &String::from_str(&env, "Test stream"),
        );
        stream_client.cancel(&stream_id);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            stream_client.claim(&recipient, &stream_id);
            stream_client.change_recipient(&stream_id, &new_recipient);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_tick_marks_completed() {
    fn test_claim_after_cliff_partial() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let stream_client = RecurringStreamClient::new(&env, &contract_id);

        let stream_id = stream_client.create_stream(
            &owner,
            &recipient,
            &token,
            &\n_000_000,
            &1000,
            &100,
            &String::from_str(&env, "Test stream"),
            &String::from_str(&env, "Paused claim"),
        );

        set_ledger(&env, 1250);
        stream_client.pause(&stream_id);

        // Claim should fail while paused.
        let result = std::panic::catch_unwind(astert_uneq());
        let __ = result;
    }

    fn assert_uneq() {
        // Placeholder to keep the test module compiling.
            &String::from_str(&env, "Cliff stream"),
            &500,
        );

        // Jump to the middle of the vesting window (after the cliff).
        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 2000,
            timestamp: 0,
            network_id: [u8],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        // elapsed = 2000 - 1500 = 500, duration = 1000 -> 50% vested.
        let claimable = stream_client.get_claimable(&stream_id);
        assert_eq(claimable, 500_000);

        let claimed = stream_client.claim(&stream_id);
        assert_eq(claimed, 500_000);

        let stream = stream_client.get_stream(&stream_id).unwrap();
        assert_eq(stream.claimed_amount, 500_000);
        assert_eq(stream.last_claimed_ledger, 2000);
    }

    #[test]
    fn test_get_claimables() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let stream_client = RecurringStreamClient::new(&env, &contract_id);

        // 1. Active stream
        let stream1_id = stream_client.create_stream(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &1000,
            &100,
            &String::from_str(&env, "Test stream"),
            &String::from_str(&env, "Active stream"),
        );

        // 2. Completed stream
        let stream2_id = stream_client.create_stream(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &1000,
            &String::from_str(&env, "Completed stream"),
        );

        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 2500,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        stream_client.claim(&recipient, &stream_id);
        stream_client.tick(&stream_id);
        stream_client.claim(&stream2_id);

        // 3. Unknown ID
        let unknown_id = 999;

        let mut ids = soroban_sdk::Vec::new(&env);
        ids.push_back(stream1_id);
        ids.push_back(stream2_id);
        ids.push_back(unknown_id);

        let claimables = stream_client.get_claimables(&ids);

        assert_eq!(claimables.len(), 3);
        assert_eq!(claimables.get(0).unwrap(), 1_000_000); // stream1 is active and sequence is past end, so full amount
        assert_eq!(claimables.get(1).unwrap(), 0);         // stream2 is completed, so 0 claimable
        assert_eq!(claimables.get(2).unwrap(), 0);         // unknown yields 0
    }

    #[test]
    fn test_create_split_stream_2_way() {
        let (env, contract_id, owner, recipient1, token) = setup_test();
        let recipient2 = Address::generate(&env);
        let stream_client = RecurringStreamClient::new(&env, &contract_id);
        
        let splits = soroban_sdk::vec![&env, 
            StreamSplit { recipient: recipient1.clone(), share: 5000 },
            StreamSplit { recipient: recipient2.clone(), share: 5000 }
        ];

        let stream_id = stream_client.create_split_stream(
            &owner,
            &splits,
            &token,
            &1_000_000,
            &1000,
            &String::from_str(&env, "Test split"),
        );

        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 1500,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        stream_client.claim(&recipient1, &stream_id);
        
        let tc = TokenClient::new(&env, &token);
        assert_eq!(tc.balance(&recipient1), 250_000);
        assert_eq!(tc.balance(&recipient2), 250_000);
    }

    #[test]
    fn test_create_split_stream_3_way_dust() {
        let (env, contract_id, owner, recipient1, token) = setup_test();
        let recipient2 = Address::generate(&env);
        let recipient3 = Address::generate(&env);
        let stream_client = RecurringStreamClient::new(&env, &contract_id);
        
        let splits = soroban_sdk::vec![&env, 
            StreamSplit { recipient: recipient1.clone(), share: 3333 },
            StreamSplit { recipient: recipient2.clone(), share: 3333 },
            StreamSplit { recipient: recipient3.clone(), share: 3334 }
        ];

        let stream_id = stream_client.create_split_stream(
            &owner,
            &splits,
            &token,
            &10_000_000,
            &1000,
            &String::from_str(&env, "Test split 3"),
        );

        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 1500, // half way -> 5_000_000
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        stream_client.claim(&recipient1, &stream_id);
        
        let tc = TokenClient::new(&env, &token);
        // 5_000_000 * 3333 / 10000 = 1_666_500
        assert_eq!(tc.balance(&recipient1), 1_666_500);
        assert_eq!(tc.balance(&recipient2), 1_666_500);
        assert_eq!(tc.balance(&recipient3), 1_666_500 + 500); // the remaining 500 dust
    }

    #[test]
    #[should_panic(expected = "shares must sum to 10000")]
    fn test_invalid_share_rejection() {
        let (env, contract_id, owner, recipient1, token) = setup_test();
        let recipient2 = Address::generate(&env);
        let stream_client = RecurringStreamClient::new(&env, &contract_id);
        
        let splits = soroban_sdk::vec![&env, 
            StreamSplit { recipient: recipient1.clone(), share: 5000 },
            StreamSplit { recipient: recipient2.clone(), share: 4000 }
        ];

        stream_client.create_split_stream(
            &owner,
            &splits,
            &token,
            &1_000_000,
            &1000,
            &String::from_str(&env, "Test invalid"),
        );
    }

    #[test]
    fn test_tick_expires_after_grace_period() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let stream_client = RecurringStreamClient::new(&env, &contract_id);

        let stream_id = stream_client.create_stream(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &1000,
            &100,
            &String::from_str(&env, "Test stream"),
        );

        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 1500,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        stream_client.claim(&stream_id);

        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 2101,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        stream_client.tick(&stream_id);

        let stream = stream_client.get_stream(&stream_id).unwrap();
        assert_eq!(stream.status, StreamStatus::Completed);
        assert_eq!(stream.claimed_amount, 500_000);
    }

    #[test]
    fn test_tick_expires_claim_nothing() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let stream_client = RecurringStreamClient::new(&env, &contract_id);

        let stream_id = stream_client.create_stream(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &1000,
            &100,
            &String::from_str(&env, "Test stream"),
        );

        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 2101,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        stream_client.tick(&stream_id);

        let stream = stream_client.get_stream(&stream_id).unwrap();
        assert_eq!(stream.status, StreamStatus::Completed);
        assert_eq!(stream.claimed_amount, 0);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            stream_client.claim(&stream_id);
        }));
        assert!(result.is_err());
    }
}

