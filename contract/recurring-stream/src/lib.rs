#![no_std]
#![allow(clippy::too_many_arguments)]
use soroban_sdk::{
    contract, contracterror, contractimpl, contractmeta, contracttype, symbol_short, token,
    Address, Env, String, Symbol, Vec,
};

const MAX_LABEL_LEN: u32 = 64;

contractmeta!(key = "name", val = "ChronoStar Recurring Stream");
contractmeta!(key = "version", val = "0.1.0");
contractmeta!(
    key = "description",
    val = "Recurring Stellar token payment streams"
);

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    AmountMustBePositive = 1,
    MinimumDurationIs60Ledgers = 2,
    LabelCannotBeEmpty = 3,
    LabelCannotBeBlank = 4,
    LabelTooLong = 5,
    UseCreateStreamForSingleRecipient = 6,
    SharesMustSumTo10000 = 7,
    CallerNotInSplits = 8,
    CallerNotRecipient = 9,
    StreamNotActive = 10,
    StreamNotPaused = 11,
    StreamHasNotStartedYet = 12,
    NothingToClaim = 13,
    DuplicateSplitRecipient = 14,
}

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
    pub share: u32,
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
    pub paused_at_ledger: u32,
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

#[contracttype]
#[derive(Clone)]
pub struct StreamCreated {
    pub owner: Address,
    pub end_ledger: u32,
}

impl StreamEntry {
    fn active_ledgers(&self, current_ledger: u32) -> u32 {
        let effective_ledger = current_ledger.min(self.end_ledger);
        if effective_ledger <= self.start_ledger {
            return 0;
        }
        let total_elapsed = effective_ledger - self.start_ledger;
        let mut paused = self.paused_ledgers;
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
            return 0;
        }

        let active = self.active_ledgers(current_ledger);
        if active == 0 {
            return 0;
        }

        let duration = (self.end_ledger - self.start_ledger) as i128;
        if duration <= 0 {
            return 0;
        }

        let total_earned = if active as i128 >= duration {
            self.total_amount
        } else {
            (self.total_amount * (active as i128)) / duration
        };

        let claimable = total_earned - self.claimed_amount;
        if claimable < 0 {
            0
        } else {
            claimable
        }
    }
}

fn validate_label(label: &String) -> Result<(), Error> {
    let len = label.len();
    if len == 0 {
        return Err(Error::LabelCannotBeEmpty);
    }
    if len > MAX_LABEL_LEN {
        return Err(Error::LabelTooLong);
    }
    let mut buf = [0u8; 64];
    let slice = &mut buf[..len as usize];
    label.copy_into_slice(slice);
    let non_ws = slice
        .iter()
        .any(|&b| b != b' ' && b != b'\t' && b != b'\n' && b != b'\r');
    if !non_ws {
        return Err(Error::LabelCannotBeBlank);
    }
    Ok(())
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
        grace_period_ledgers: u32,
        label: String,
        start_delay_ledgers: u32,
    ) -> Result<u64, Error> {
        owner.require_auth();
        if total_amount <= 0 {
            return Err(Error::AmountMustBePositive);
        }
        if duration_ledgers < 60 {
            return Err(Error::MinimumDurationIs60Ledgers);
        }
        validate_label(&label)?;

        let current = env.ledger().sequence();
        let start_ledger = current + start_delay_ledgers;
        let end_ledger = start_ledger + duration_ledgers;

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

        let stream = StreamEntry {
            id,
            owner: owner.clone(),
            recipient: recipient.clone(),
            token,
            total_amount,
            claimed_amount: 0,
            start_ledger,
            end_ledger,
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

        env.events().publish(
            (symbol_short!("created"), id),
            StreamCreated {
                owner: stream.owner.clone(),
                end_ledger: stream.end_ledger,
            },
        );

        Ok(id)
    }

    pub fn create_split_stream(
        env: Env,
        owner: Address,
        splits: Vec<StreamSplit>,
        token: Address,
        total_amount: i128,
        duration_ledgers: u32,
        label: String,
    ) -> Result<u64, Error> {
        owner.require_auth();
        if total_amount <= 0 {
            return Err(Error::AmountMustBePositive);
        }
        if duration_ledgers < 60 {
            return Err(Error::MinimumDurationIs60Ledgers);
        }
        validate_label(&label)?;
        if splits.len() <= 1 {
            return Err(Error::UseCreateStreamForSingleRecipient);
        }

        let len = splits.len();
        for i in 0..len {
            let a = splits.get(i).unwrap();
            for j in (i + 1)..len {
                let b = splits.get(j).unwrap();
                if a.recipient == b.recipient {
                    return Err(Error::DuplicateSplitRecipient);
                }
            }
        }

        let mut total_share: u32 = 0;
        for split in splits.iter() {
            total_share += split.share;
        }
        if total_share != 10000 {
            return Err(Error::SharesMustSumTo10000);
        }

        let current = env.ledger().sequence();
        let end_ledger = current + duration_ledgers;

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

        let stream = StreamEntry {
            id,
            owner: owner.clone(),
            recipient: env.current_contract_address(),
            token,
            total_amount,
            claimed_amount: 0,
            start_ledger: current,
            end_ledger,
            last_claimed_ledger: current,
            created_ledger: current,
            label,
            grace_period_ledgers: 0,
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
            if !rec_streams.contains(id) {
                rec_streams.push_back(id);
            }
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

        Ok(id)
    }

    pub fn claim(env: Env, caller: Address, stream_id: u64) -> Result<i128, Error> {
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
            if !found {
                return Err(Error::CallerNotInSplits);
            }
        } else if caller != stream.recipient {
            return Err(Error::CallerNotRecipient);
        }

        if stream.status != StreamStatus::Active {
            return Err(Error::StreamNotActive);
        }

        let current = env.ledger().sequence();
        if current < stream.start_ledger {
            return Err(Error::StreamHasNotStartedYet);
        }
        let claimable = stream.claimable_amount(current);
        if claimable <= 0 {
            return Err(Error::NothingToClaim);
        }

        stream.claimed_amount += claimable;
        stream.last_claimed_ledger = current;

        if stream.claimed_amount >= stream.total_amount {
            stream.status = StreamStatus::Completed;
        }

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
                    token_client.transfer(&env.current_contract_address(), &split.recipient, &amount);
                }
            }
        } else {
            token_client.transfer(&env.current_contract_address(), &stream.recipient, &claimable);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Stream(stream_id), 6_312_000, 6_312_000);

        env.events()
            .publish((symbol_short!("claimed"), stream_id), claimable);

        Ok(claimable)
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
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;
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
    fn test_create_split_stream_rejects_duplicate_recipients() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let stream_client = RecurringStreamClient::new(&env, &contract_id);

        let mut duplicate_splits = Vec::new(&env);
        duplicate_splits.push_back(StreamSplit {
            recipient: recipient.clone(),
            share: 5000,
        });
        duplicate_splits.push_back(StreamSplit {
            recipient: recipient.clone(),
            share: 5000,
        });

        let res = stream_client.try_create_split_stream(
            &owner,
            &duplicate_splits,
            &token,
            &1_000_000,
            &1000,
            &String::from_str(&env, "Duplicate split"),
        );
        assert_eq!(res, Err(Ok(Error::DuplicateSplitRecipient)));

        // Non-adjacent duplicate in 3-entry split is also rejected
        let other = Address::generate(&env);
        let mut non_adjacent_duplicates = Vec::new(&env);
        non_adjacent_duplicates.push_back(StreamSplit {
            recipient: recipient.clone(),
            share: 4000,
        });
        non_adjacent_duplicates.push_back(StreamSplit {
            recipient: other,
            share: 3000,
        });
        non_adjacent_duplicates.push_back(StreamSplit {
            recipient,
            share: 3000,
        });

        let res2 = stream_client.try_create_split_stream(
            &owner,
            &non_adjacent_duplicates,
            &token,
            &1_000_000,
            &1000,
            &String::from_str(&env, "Duplicate non-adjacent"),
        );
        assert_eq!(res2, Err(Ok(Error::DuplicateSplitRecipient)));
    }

    #[test]
    fn test_create_split_stream_valid_two_and_three_way_splits() {
        let (env, contract_id, owner, r1, token) = setup_test();
        let stream_client = RecurringStreamClient::new(&env, &contract_id);
        let token_client = TokenClient::new(&env, &token);

        let r2 = Address::generate(&env);
        let r3 = Address::generate(&env);

        let mut two_way = Vec::new(&env);
        two_way.push_back(StreamSplit {
            recipient: r1.clone(),
            share: 6000,
        });
        two_way.push_back(StreamSplit {
            recipient: r2.clone(),
            share: 4000,
        });

        let id1 = stream_client.create_split_stream(
            &owner,
            &two_way,
            &token,
            &1_000_000,
            &1000,
            &String::from_str(&env, "2-way split"),
        );
        assert_eq!(id1, 1);
        assert_eq!(stream_client.get_streams_by_recipient(&r1).len(), 1);
        assert_eq!(stream_client.get_streams_by_recipient(&r2).len(), 1);

        let mut three_way = Vec::new(&env);
        three_way.push_back(StreamSplit {
            recipient: r1.clone(),
            share: 5000,
        });
        three_way.push_back(StreamSplit {
            recipient: r2.clone(),
            share: 3000,
        });
        three_way.push_back(StreamSplit {
            recipient: r3.clone(),
            share: 2000,
        });

        let id2 = stream_client.create_split_stream(
            &owner,
            &three_way,
            &token,
            &1_000_000,
            &1000,
            &String::from_str(&env, "3-way split"),
        );
        assert_eq!(id2, 2);
        assert_eq!(stream_client.get_streams_by_recipient(&r1).len(), 2);
        assert_eq!(stream_client.get_streams_by_recipient(&r2).len(), 2);
        assert_eq!(stream_client.get_streams_by_recipient(&r3).len(), 1);

        // Advance to end of stream and verify claim distributes exact shares once
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

        let claimed = stream_client.claim(&r1, &id1);
        assert_eq!(claimed, 1_000_000);
        assert_eq!(token_client.balance(&r1), 600_000);
        assert_eq!(token_client.balance(&r2), 400_000);
    }
}
