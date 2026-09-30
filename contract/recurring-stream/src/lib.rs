#![no_std]
use soroban_sdk::{
    contract, contractimpl, contractmeta, contracttype, symbol_short, token, Address, Env, String,
    Vec,
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
    pub status: StreamStatus,
}

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum StreamStatus {
    Active,
    Completed,
    Cancelled,
}

impl StreamEntry {
    pub fn claimable_amount(&self, current_ledger: u32) -> i128 {
        if self.status != StreamStatus::Active {
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
        let elapsed = (effective_ledger - self.start_ledger) as i128;
        let vested = (self.total_amount * elapsed) / total_duration;
        let claimable = vested - self.claimed_amount;
        claimable.max(0)
    }
}

#[contract]
pub struct RecurringStream;

#[contractimpl]
impl RecurringStream {
    pub fn create_stream(
        env: Env,
        owner: Address,
        recipient: Address,
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
            recipient: recipient.clone(),
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
            .unwrap_or(Vec::new(&env));
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

    pub fn claim(env: Env, stream_id: u64) -> i128 {
        let mut stream: StreamEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        stream.recipient.require_auth();
        assert!(stream.status == StreamStatus::Active, "stream not active");

        let current = env.ledger().sequence();
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
        token_client.transfer(
            &env.current_contract_address(),
            &stream.recipient,
            &claimable,
        );

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
        }

        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Stream(stream_id), 6_312_000, 6_312_000);
    }

    pub fn cancel(env: Env, stream_id: u64) {
        let mut stream: StreamEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        stream.owner.require_auth();
        assert!(stream.status == StreamStatus::Active, "stream not active");

        let current = env.ledger().sequence();

        let claimable = stream.claimable_amount(current);
        let token_client = token::Client::new(&env, &stream.token);

        if claimable > 0 {
            stream.claimed_amount += claimable;
            token_client.transfer(
                &env.current_contract_address(),
                &stream.recipient,
                &claimable,
            );
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
    use proptest::prelude::*;
    use soroban_sdk::{
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
        token_admin_client.mint(&owner, &10_000_000_000);

        let contract_id = env.register(RecurringStream, ());

        let token_client = TokenClient::new(&env, &token);
        token_client.approve(
            &owner,
            &contract_id,
            &10_000_000_000i128,
            &(env.ledger().sequence() + 10000),
        );

        (env, contract_id, owner, recipient, token)
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
            &String::from_str(&env, "Test stream"),
        );

        assert_eq!(stream_id, 1);

        let stream = stream_client.get_stream(&stream_id).unwrap();
        assert_eq!(stream.owner, owner);
        assert_eq!(stream.recipient, recipient);
        assert_eq!(stream.total_amount, 1_000_000);
        assert_eq!(stream.status, StreamStatus::Active);
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

        let claimed = stream_client.claim(&stream_id);
        assert!(claimed > 0);
        assert!(claimed < 1_000_000);

        let stream = stream_client.get_stream(&stream_id).unwrap();
        assert_eq!(stream.claimed_amount, claimed);
    }

    #[test]
    fn test_claim_full() {
        let (env, contract_id, owner, recipient, token) = setup_test();
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

        let claimed = stream_client.claim(&stream_id);
        assert_eq!(claimed, 1_000_000);

        let stream = stream_client.get_stream(&stream_id).unwrap();
        assert_eq!(stream.status, StreamStatus::Completed);
    }

    #[test]
    fn test_claim_nothing() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let stream_client = RecurringStreamClient::new(&env, &contract_id);

        let stream_id = stream_client.create_stream(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &1000,
            &String::from_str(&env, "Test stream"),
        );

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            stream_client.claim(&stream_id);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_cancel_returns_remainder() {
        let (env, contract_id, owner, recipient, token) = setup_test();
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
            sequence_number: 1500,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        stream_client.cancel(&stream_id);

        let stream = stream_client.get_stream(&stream_id).unwrap();
        assert_eq!(stream.status, StreamStatus::Cancelled);
    }

    #[test]
    fn test_tick_marks_completed() {
        let (env, contract_id, owner, recipient, token) = setup_test();
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
            sequence_number: 2500,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        stream_client.claim(&stream_id);
        stream_client.tick(&stream_id);

        let stream = stream_client.get_stream(&stream_id).unwrap();
        assert_eq!(stream.status, StreamStatus::Completed);
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn prop_monotonicity(
            total_amount in prop_oneof![1..100i128, 100..10_000i128, 10_000..10_000_000_000i128],
            start_ledger in 0..=100_000u32,
            duration in 1..=100_000u32,
            claimed_amount_ratio in 0..=100u32,
            ledger_a in 0..=300_000u32,
            ledger_b in 0..=300_000u32,
        ) {
            let (la, lb) = if ledger_a <= ledger_b {
                (ledger_a, ledger_b)
            } else {
                (ledger_b, ledger_a)
            };

            let end_ledger = start_ledger + duration;
            let claimed_amount = (total_amount * claimed_amount_ratio as i128) / 100;
            let last_claimed_ledger = start_ledger;

            let stream = StreamEntry {
                id: 1,
                owner: Address::generate(&Env::default()),
                recipient: Address::generate(&Env::default()),
                token: Address::generate(&Env::default()),
                total_amount,
                claimed_amount,
                start_ledger,
                end_ledger,
                last_claimed_ledger,
                created_ledger: start_ledger,
                label: String::from_str(&Env::default(), "prop"),
                status: StreamStatus::Active,
            };

            let claimable_a = stream.claimable_amount(la);
            let claimable_b = stream.claimable_amount(lb);

            prop_assert!(
                claimable_a <= claimable_b,
                "Monotonicity failed: at ledger {} claimable is {}, but at later ledger {} claimable is {}",
                la, claimable_a, lb, claimable_b
            );
        }

        #[test]
        fn prop_cumulative_claims_bounded(
            total_amount in prop_oneof![1..100i128, 100..10_000i128, 10_000..10_000_000_000i128],
            duration in 60..=10_000u32,
            raw_offsets in prop::collection::vec(0..=15_000u32, 1..=15),
        ) {
            let (env, contract_id, owner, recipient, token) = setup_test();
            let stream_client = RecurringStreamClient::new(&env, &contract_id);

            let stream_id = stream_client.create_stream(
                &owner,
                &recipient,
                &token,
                &total_amount,
                &duration,
                &String::from_str(&env, "prop test"),
            );

            let start_ledger = 1000u32;
            let mut offsets = raw_offsets;
            offsets.sort_unstable();

            let mut cumulative_claimed = 0i128;

            for offset in offsets {
                let current_ledger = start_ledger + offset;
                env.ledger().set(LedgerInfo {
                    protocol_version: 22,
                    sequence_number: current_ledger,
                    timestamp: 0,
                    network_id: [0u8; 32],
                    base_reserve: 0,
                    min_persistent_entry_ttl: 1000,
                    min_temp_entry_ttl: 1000,
                    max_entry_ttl: 6_312_000,
                });

                let claimable = stream_client.get_claimable(&stream_id);
                let stream = stream_client.get_stream(&stream_id).unwrap();

                if stream.status == StreamStatus::Active && claimable > 0 {
                    let claimed = stream_client.claim(&stream_id);
                    cumulative_claimed += claimed;

                    let updated_stream = stream_client.get_stream(&stream_id).unwrap();

                    prop_assert!(
                        cumulative_claimed <= total_amount,
                        "Cumulative claimed {} exceeded total_amount {}",
                        cumulative_claimed, total_amount
                    );
                    prop_assert!(
                        updated_stream.claimed_amount <= total_amount,
                        "Stream claimed_amount {} exceeded total_amount {}",
                        updated_stream.claimed_amount, total_amount
                    );
                    prop_assert_eq!(
                        updated_stream.claimed_amount, cumulative_claimed,
                        "Stream claimed_amount {} mismatch with cumulative_claimed {}",
                        updated_stream.claimed_amount, cumulative_claimed
                    );
                }
            }
        }

        #[test]
        fn prop_cancel_claims_plus_refund_equals_total(
            total_amount in prop_oneof![1..100i128, 100..10_000i128, 10_000..10_000_000_000i128],
            duration in 60..=10_000u32,
            claim_offsets in prop::collection::vec(0..=15_000u32, 0..=10),
            cancel_offset in 0..=20_000u32,
        ) {
            let (env, contract_id, owner, recipient, token) = setup_test();
            let stream_client = RecurringStreamClient::new(&env, &contract_id);
            let token_client = TokenClient::new(&env, &token);

            let initial_owner_balance = token_client.balance(&owner);
            let initial_recipient_balance = token_client.balance(&recipient);

            let stream_id = stream_client.create_stream(
                &owner,
                &recipient,
                &token,
                &total_amount,
                &duration,
                &String::from_str(&env, "prop test cancel"),
            );

            let start_ledger = 1000u32;
            let mut sorted_offsets = claim_offsets;
            sorted_offsets.sort_unstable();

            let cancel_ledger = start_ledger + cancel_offset;

            for offset in sorted_offsets {
                let current_ledger = start_ledger + offset;
                if current_ledger >= cancel_ledger {
                    break;
                }
                env.ledger().set(LedgerInfo {
                    protocol_version: 22,
                    sequence_number: current_ledger,
                    timestamp: 0,
                    network_id: [0u8; 32],
                    base_reserve: 0,
                    min_persistent_entry_ttl: 1000,
                    min_temp_entry_ttl: 1000,
                    max_entry_ttl: 6_312_000,
                });

                let claimable = stream_client.get_claimable(&stream_id);
                let stream = stream_client.get_stream(&stream_id).unwrap();

                if stream.status == StreamStatus::Active && claimable > 0 {
                    stream_client.claim(&stream_id);
                }
            }

            env.ledger().set(LedgerInfo {
                protocol_version: 22,
                sequence_number: cancel_ledger,
                timestamp: 0,
                network_id: [0u8; 32],
                base_reserve: 0,
                min_persistent_entry_ttl: 1000,
                min_temp_entry_ttl: 1000,
                max_entry_ttl: 6_312_000,
            });

            let stream_before_cancel = stream_client.get_stream(&stream_id).unwrap();

            if stream_before_cancel.status == StreamStatus::Active {
                let owner_bal_before_cancel = token_client.balance(&owner);

                stream_client.cancel(&stream_id);

                let stream_after_cancel = stream_client.get_stream(&stream_id).unwrap();
                prop_assert_eq!(stream_after_cancel.status, StreamStatus::Cancelled);

                let recipient_total_claimed = token_client.balance(&recipient) - initial_recipient_balance;
                let owner_refund = token_client.balance(&owner) - owner_bal_before_cancel;

                prop_assert_eq!(
                    recipient_total_claimed + owner_refund,
                    total_amount,
                    "Conservation failed: claims ({}) + refund ({}) != total_amount ({})",
                    recipient_total_claimed, owner_refund, total_amount
                );

                let owner_final_balance = token_client.balance(&owner);
                prop_assert_eq!(
                    initial_owner_balance - owner_final_balance,
                    recipient_total_claimed,
                    "Net owner outflow ({}) does not match recipient claims ({})",
                    initial_owner_balance - owner_final_balance, recipient_total_claimed
                );
            }
        }
    }
}
