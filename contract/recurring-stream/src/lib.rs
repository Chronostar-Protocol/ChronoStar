#![no_std]
#![allow(clippy::too_many_arguments)]
use soroban_sdk::{
    contract, contracterror, contractimpl, contractmeta, contracttype, symbol_short, token,
    Address, Env, String, Symbol, Vec,
};

const MAX_LABEL_LEN: u32 = 64;

/// Maximum stream duration (~5 years at 5s per ledger).
pub const MAX_DURATION_LEDGERS: u32 = 31_536_000;

/// Maximum start delay (cliff) before vesting begins (~5 years at 5s per ledger).
pub const MAX_START_DELAY_LEDGERS: u32 = 31_536_000;

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
    DurationTooLong = 14,
    StartDelayTooLong = 15,
    LedgerOverflow = 16,
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
            return 0;
        }
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

fn validate_label(label: &String) -> Result<(), Error> {
    if label.is_empty() {
        return Err(Error::LabelCannotBeEmpty);
    }
    if label.len() > MAX_LABEL_LEN {
        return Err(Error::LabelTooLong);
    }
    let mut buf = [0u8; MAX_LABEL_LEN as usize];
    label.copy_into_slice(&mut buf[..label.len() as usize]);
    let all_ws = buf[..label.len() as usize]
        .iter()
        .all(|b| matches!(b, b' ' | b'\t' | b'\r' | b'\n'));
    if all_ws {
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
        if duration_ledgers > MAX_DURATION_LEDGERS {
            return Err(Error::DurationTooLong);
        }
        if start_delay_ledgers > MAX_START_DELAY_LEDGERS {
            return Err(Error::StartDelayTooLong);
        }
        validate_label(&label)?;

        let current = env.ledger().sequence();
        let start_ledger = current
            .checked_add(start_delay_ledgers)
            .ok_or(Error::LedgerOverflow)?;
        let end_ledger = start_ledger
            .checked_add(duration_ledgers)
            .ok_or(Error::LedgerOverflow)?;
        let _ = end_ledger
            .checked_add(grace_period_ledgers)
            .ok_or(Error::LedgerOverflow)?;

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
        if duration_ledgers > MAX_DURATION_LEDGERS {
            return Err(Error::DurationTooLong);
        }
        validate_label(&label)?;
        if splits.len() <= 1 {
            return Err(Error::UseCreateStreamForSingleRecipient);
        }

        let mut total_share: u32 = 0;
        for split in splits.iter() {
            total_share += split.share as u32;
        }
        if total_share != 10000 {
            return Err(Error::SharesMustSumTo10000);
        }

        let current = env.ledger().sequence();
        let end_ledger = current
            .checked_add(duration_ledgers)
            .ok_or(Error::LedgerOverflow)?;

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

        Ok(claimable)
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
        } else if env.ledger().sequence()
            >= stream.end_ledger.saturating_add(stream.grace_period_ledgers)
        {
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
    pub fn pause(env: Env, stream_id: u64) -> Result<(), Error> {
        let mut stream: StreamEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        stream.owner.require_auth();
        if stream.status != StreamStatus::Active {
            return Err(Error::StreamNotActive);
        }

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

        Ok(())
    }

    /// Resume a paused stream. Only the owner may resume.
    /// The paused interval is accumulated into `paused_ledgers` so it is
    /// never counted as vested time.
    pub fn resume(env: Env, stream_id: u64) -> Result<(), Error> {
        let mut stream: StreamEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        stream.owner.require_auth();
        if stream.status != StreamStatus::Paused {
            return Err(Error::StreamNotPaused);
        }

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

        Ok(())
    }

    pub fn cancel(env: Env, stream_id: u64) -> Result<(), Error> {
        let mut stream: StreamEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        stream.owner.require_auth();
        if stream.status != StreamStatus::Active && stream.status != StreamStatus::Paused {
            return Err(Error::StreamNotActive);
        }

        let current = env.ledger().sequence();

        let claimable = if stream.status == StreamStatus::Paused {
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

        Ok(())
    }

    pub fn change_recipient(env: Env, stream_id: u64, new_recipient: Address) -> Result<(), Error> {
        let mut stream: StreamEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        stream.owner.require_auth();
        if stream.status != StreamStatus::Active {
            return Err(Error::StreamNotActive);
        }

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

        Ok(())
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
            let claimable = match env
                .storage()
                .persistent()
                .get::<_, StreamEntry>(&DataKey::Stream(id))
            {
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
    use soroban_sdk::{
        testutils::{Address as _, Events as _, Ledger, LedgerInfo},
        token::{StellarAssetClient as TokenAdminClient, TokenClient},
        Env, Symbol, TryFromVal,
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
            &100,
            &String::from_str(&env, "Test stream"),
            &0,
        );

        assert_eq!(stream_id, 1);

        let stream = stream_client.get_stream(&stream_id).unwrap();
        assert_eq!(stream.owner, owner);
        assert_eq!(stream.recipient, recipient);
        assert_eq!(stream.total_amount, 1_000_000);
        assert_eq!(stream.status, StreamStatus::Active);
    }

    #[test]
    fn test_max_duration_boundary_accepted() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let stream_client = RecurringStreamClient::new(&env, &contract_id);

        let stream_id = stream_client.create_stream(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &MAX_DURATION_LEDGERS,
            &100,
            &String::from_str(&env, "Boundary stream"),
            &MAX_START_DELAY_LEDGERS,
        );
        let stream = stream_client.get_stream(&stream_id).unwrap();
        assert_eq!(stream.start_ledger, 1000 + MAX_START_DELAY_LEDGERS);
        assert_eq!(
            stream.end_ledger,
            1000 + MAX_START_DELAY_LEDGERS + MAX_DURATION_LEDGERS
        );
    }

    #[test]
    fn test_duration_exceeding_max_rejected() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let stream_client = RecurringStreamClient::new(&env, &contract_id);

        let res = stream_client.try_create_stream(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &(MAX_DURATION_LEDGERS + 1),
            &100,
            &String::from_str(&env, "Too long"),
            &0,
        );
        assert_eq!(res, Err(Ok(Error::DurationTooLong)));
    }

    #[test]
    fn test_start_delay_exceeding_max_rejected() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let stream_client = RecurringStreamClient::new(&env, &contract_id);

        let res = stream_client.try_create_stream(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &1000,
            &100,
            &String::from_str(&env, "Delay too long"),
            &(MAX_START_DELAY_LEDGERS + 1),
        );
        assert_eq!(res, Err(Ok(Error::StartDelayTooLong)));
    }

    #[test]
    fn test_end_ledger_overflow_rejected_without_trap() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let stream_client = RecurringStreamClient::new(&env, &contract_id);

        // Overflow via grace_period_ledgers at normal ledger sequence
        let res = stream_client.try_create_stream(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &1000,
            &u32::MAX,
            &String::from_str(&env, "Overflow grace period"),
            &0,
        );
        assert_eq!(res, Err(Ok(Error::LedgerOverflow)));

        // Overflow via start_ledger + duration_ledgers near u32::MAX
        let high_env = Env::default();
        high_env.mock_all_auths();
        high_env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: u32::MAX - 500,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 10,
            min_temp_entry_ttl: 10,
            max_entry_ttl: 100,
        });
        let high_owner = Address::generate(&high_env);
        let high_recipient = Address::generate(&high_env);
        let high_token = Address::generate(&high_env);
        let high_contract_id = high_env.register(RecurringStream, ());
        let high_client = RecurringStreamClient::new(&high_env, &high_contract_id);

        let res_high = high_client.try_create_stream(
            &high_owner,
            &high_recipient,
            &high_token,
            &1_000_000,
            &1000,
            &0,
            &String::from_str(&high_env, "Overflow stream"),
            &0,
        );
        assert_eq!(res_high, Err(Ok(Error::LedgerOverflow)));
    }

    #[test]
    fn test_create_stream_emits_created_event() {
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

        let events = env.events().all();
        let (_, topics, data) = events
            .iter()
            .find(|(_, topics, _)| {
                Symbol::try_from_val(&env, &topics.first().unwrap())
                    .is_ok_and(|name| name == symbol_short!("created"))
            })
            .expect("created event not published");

        assert_eq!(topics.len(), 2);
        let event_id = u64::try_from_val(&env, &topics.get(1).unwrap()).unwrap();
        assert_eq!(event_id, stream_id);

        let created = StreamCreated::try_from_val(&env, &data).unwrap();
        assert_eq!(created.owner, owner);
        assert_eq!(created.end_ledger, 2440);
    }
}
