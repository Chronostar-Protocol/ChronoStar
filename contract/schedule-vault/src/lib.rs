#![no_std]
#![allow(clippy::too_many_arguments)]
use soroban_sdk::{
    contract, contracterror, contractimpl, contractmeta, contracttype, symbol_short, token,
    Address, Env, String, Vec,
};

const MAX_LABEL_LEN: u32 = 64;

contractmeta!(key = "name", val = "ChronoStar Schedule Vault");
contractmeta!(key = "version", val = "0.1.0");
contractmeta!(
    key = "description",
    val = "Time-locked Stellar token vaults"
);

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    AmountMustBePositive = 1,
    ReleaseLedgerMustBeInFuture = 2,
    LabelCannotBeEmpty = 3,
    LabelCannotBeBlank = 4,
    LabelTooLong = 5,
    ExpiryMustBeAfterReleaseLedger = 6,
    BatchMustNotBeEmpty = 7,
    BatchExceedsMaxSize = 8,
    VaultNotActive = 9,
    TooEarlyToRelease = 10,
    CannotCancelAfterReleaseLedger = 11,
    VaultNotPaused = 12,
    VaultNotYetExpired = 13,
}

pub const MAX_BATCH_SIZE: u32 = 50;

#[contracttype]
pub enum DataKey {
    Vault(u64),
    Counter,
    VaultsByOwner(Address),
    VaultsByRecipient(Address),
}

#[contracttype]
#[derive(Clone)]
pub struct VaultEntry {
    pub id: u64,
    pub owner: Address,
    pub recipient: Address,
    pub token: Address,
    pub amount: i128,
    pub release_ledger: u32,
    pub created_ledger: u32,
    pub label: String,
    pub status: VaultStatus,
    pub paused_at_ledger: Option<u32>,
    pub expires_after_ledger: Option<u32>,
}

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum VaultStatus {
    Active,
    Released,
    Cancelled,
    Paused,
    Reclaimed,
}

#[contracttype]
#[derive(Clone)]
pub struct VaultCreated {
    pub owner: Address,
    pub release_ledger: u32,
}

#[contract]
pub struct ScheduleVault;

#[contractimpl]
impl ScheduleVault {
    pub fn create_vault(
        env: Env,
        owner: Address,
        recipient: Address,
        token: Address,
        amount: i128,
        release_ledger: u32,
        label: String,
        expires_after_ledger: Option<u32>,
    ) -> Result<u64, Error> {
        owner.require_auth();
        if amount <= 0 {
            return Err(Error::AmountMustBePositive);
        }
        if release_ledger <= env.ledger().sequence() {
            return Err(Error::ReleaseLedgerMustBeInFuture);
        }
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
        if let Some(expiry) = expires_after_ledger {
            if expiry <= release_ledger {
                return Err(Error::ExpiryMustBeAfterReleaseLedger);
            }
        }

        let token_client = token::Client::new(&env, &token);
        token_client.transfer_from(
            &env.current_contract_address(),
            &owner,
            &env.current_contract_address(),
            &amount,
        );

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0u64)
            + 1;
        env.storage().instance().set(&DataKey::Counter, &id);

        let vault = VaultEntry {
            id,
            owner: owner.clone(),
            recipient: recipient.clone(),
            token,
            amount,
            release_ledger,
            created_ledger: env.ledger().sequence(),
            label,
            status: VaultStatus::Active,
            paused_at_ledger: None,
            expires_after_ledger,
        };

        env.storage().persistent().set(&DataKey::Vault(id), &vault);

        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Vault(id), 6_312_000, 6_312_000);

        let mut owner_vaults: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::VaultsByOwner(owner.clone()))
            .unwrap_or(Vec::new(&env));
        owner_vaults.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::VaultsByOwner(owner.clone()), &owner_vaults);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::VaultsByOwner(owner), 6_312_000, 6_312_000);

        let mut recipient_vaults: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::VaultsByRecipient(recipient.clone()))
            .unwrap_or(Vec::new(&env));
        recipient_vaults.push_back(id);
        env.storage().persistent().set(
            &DataKey::VaultsByRecipient(recipient.clone()),
            &recipient_vaults,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::VaultsByRecipient(recipient),
            6_312_000,
            6_312_000,
        );

        env.storage().instance().extend_ttl(100_000, 100_000);

        env.events().publish(
            (symbol_short!("created"), id),
            VaultCreated {
                owner: vault.owner.clone(),
                release_ledger: vault.release_ledger,
            },
        );

        Ok(id)
    }

    pub fn create_vaults(
        env: Env,
        owner: Address,
        recipients: Vec<Address>,
        token: Address,
        amount: i128,
        release_ledger: u32,
        label_prefix: String,
    ) -> Result<Vec<u64>, Error> {
        owner.require_auth();
        if amount <= 0 {
            return Err(Error::AmountMustBePositive);
        }
        if release_ledger <= env.ledger().sequence() {
            return Err(Error::ReleaseLedgerMustBeInFuture);
        }
        if label_prefix.len() > 64 {
            return Err(Error::LabelTooLong);
        }

        let count = recipients.len();
        if count == 0 {
            return Err(Error::BatchMustNotBeEmpty);
        }
        if count > MAX_BATCH_SIZE {
            return Err(Error::BatchExceedsMaxSize);
        }

        let total: i128 = amount
            .checked_mul(count as i128)
            .expect("batch amount overflow");

        let token_client = token::Client::new(&env, &token);
        token_client.transfer_from(
            &env.current_contract_address(),
            &owner,
            &env.current_contract_address(),
            &total,
        );

        let mut next_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0u64);

        let mut owner_vaults: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::VaultsByOwner(owner.clone()))
            .unwrap_or(Vec::new(&env));

        let created_ledger = env.ledger().sequence();
        let mut ids: Vec<u64> = Vec::new(&env);

        for recipient in recipients.iter() {
            next_id += 1;
            let id = next_id;

            let vault = VaultEntry {
                id,
                owner: owner.clone(),
                recipient: recipient.clone(),
                token: token.clone(),
                amount,
                release_ledger,
                created_ledger,
                label: label_prefix.clone(),
                status: VaultStatus::Active,
                paused_at_ledger: None,
                expires_after_ledger: None,
            };

            env.storage().persistent().set(&DataKey::Vault(id), &vault);
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::Vault(id), 6_312_000, 6_312_000);

            owner_vaults.push_back(id);
            ids.push_back(id);
        }

        env.storage().instance().set(&DataKey::Counter, &next_id);

        env.storage()
            .persistent()
            .set(&DataKey::VaultsByOwner(owner.clone()), &owner_vaults);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::VaultsByOwner(owner), 6_312_000, 6_312_000);

        env.storage().instance().extend_ttl(100_000, 100_000);

        env.events()
            .publish((symbol_short!("batch"), created_ledger), ids.clone());

        Ok(ids)
    }

    pub fn release(env: Env, vault_id: u64) -> Result<(), Error> {
        let mut vault: VaultEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Vault(vault_id))
            .expect("vault not found");

        if vault.status != VaultStatus::Active {
            return Err(Error::VaultNotActive);
        }
        if env.ledger().sequence() < vault.release_ledger {
            return Err(Error::TooEarlyToRelease);
        }

        vault.status = VaultStatus::Released;
        env.storage()
            .persistent()
            .set(&DataKey::Vault(vault_id), &vault);

        let token_client = token::Client::new(&env, &vault.token);
        token_client.transfer(
            &env.current_contract_address(),
            &vault.recipient,
            &vault.amount,
        );

        env.events().publish(
            (symbol_short!("released"), vault_id),
            vault.recipient.clone(),
        );

        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Vault(vault_id), 6_312_000, 6_312_000);

        Ok(())
    }

    pub fn cancel(env: Env, vault_id: u64) -> Result<(), Error> {
        let mut vault: VaultEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Vault(vault_id))
            .expect("vault not found");

        vault.owner.require_auth();
        if vault.status != VaultStatus::Active {
            return Err(Error::VaultNotActive);
        }
        if env.ledger().sequence() >= vault.release_ledger {
            return Err(Error::CannotCancelAfterReleaseLedger);
        }

        vault.status = VaultStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Vault(vault_id), &vault);

        let token_client = token::Client::new(&env, &vault.token);
        token_client.transfer(&env.current_contract_address(), &vault.owner, &vault.amount);
        env.events()
            .publish((symbol_short!("cancelled"), vault_id), vault.owner.clone());

        Ok(())
    }

    pub fn transfer_ownership(env: Env, vault_id: u64, new_owner: Address) -> Result<(), Error> {
        let mut vault: VaultEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Vault(vault_id))
            .expect("vault not found");

        vault.owner.require_auth();
        if vault.status != VaultStatus::Active {
            return Err(Error::VaultNotActive);
        }

        let mut old_owner_vaults: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::VaultsByOwner(vault.owner.clone()))
            .unwrap_or(Vec::new(&env));
        if let Some(index) = old_owner_vaults.first_index_of(vault_id) {
            old_owner_vaults.remove(index);
            env.storage().persistent().set(
                &DataKey::VaultsByOwner(vault.owner.clone()),
                &old_owner_vaults,
            );
            env.storage().persistent().extend_ttl(
                &DataKey::VaultsByOwner(vault.owner.clone()),
                6_312_000,
                6_312_000,
            );
        }

        vault.owner = new_owner.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Vault(vault_id), &vault);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Vault(vault_id), 6_312_000, 6_312_000);

        let mut new_owner_vaults: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::VaultsByOwner(new_owner.clone()))
            .unwrap_or(Vec::new(&env));
        new_owner_vaults.push_back(vault_id);
        env.storage().persistent().set(
            &DataKey::VaultsByOwner(new_owner.clone()),
            &new_owner_vaults,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::VaultsByOwner(new_owner.clone()),
            6_312_000,
            6_312_000,
        );

        env.events()
            .publish((symbol_short!("transfer"), vault_id), new_owner);

        Ok(())
    }

    pub fn pause(env: Env, vault_id: u64) -> Result<(), Error> {
        let mut vault: VaultEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Vault(vault_id))
            .expect("vault not found");

        vault.owner.require_auth();
        if vault.status != VaultStatus::Active {
            return Err(Error::VaultNotActive);
        }

        vault.status = VaultStatus::Paused;
        vault.paused_at_ledger = Some(env.ledger().sequence());

        env.storage()
            .persistent()
            .set(&DataKey::Vault(vault_id), &vault);

        env.events()
            .publish((symbol_short!("paused"), vault_id), vault.owner.clone());

        Ok(())
    }

    pub fn resume(env: Env, vault_id: u64) -> Result<(), Error> {
        let mut vault: VaultEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Vault(vault_id))
            .expect("vault not found");

        vault.owner.require_auth();
        if vault.status != VaultStatus::Paused {
            return Err(Error::VaultNotPaused);
        }

        vault.status = VaultStatus::Active;
        vault.paused_at_ledger = None;

        env.storage()
            .persistent()
            .set(&DataKey::Vault(vault_id), &vault);

        env.events()
            .publish((symbol_short!("resumed"), vault_id), vault.owner.clone());

        Ok(())
    }

    pub fn reclaim_expired(env: Env, owner: Address, limit: u32) -> Vec<u64> {
        owner.require_auth();

        let current_ledger = env.ledger().sequence();

        let vault_ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::VaultsByOwner(owner.clone()))
            .unwrap_or(Vec::new(&env));

        let mut reclaimed: Vec<u64> = Vec::new(&env);
        let scan_count = vault_ids.len().min(limit);

        for i in 0..scan_count {
            let vault_id = vault_ids.get(i).unwrap();

            let mut vault: VaultEntry = match env
                .storage()
                .persistent()
                .get(&DataKey::Vault(vault_id))
            {
                Some(v) => v,
                None => continue,
            };

            // Only Active and Paused vaults are eligible.
            if vault.status != VaultStatus::Active && vault.status != VaultStatus::Paused {
                continue;
            }

            // Skip vaults with no expiry set.
            let expiry = match vault.expires_after_ledger {
                Some(e) => e,
                None => continue,
            };

            // Skip vaults that have not yet expired.
            if current_ledger <= expiry {
                continue;
            }

            vault.status = VaultStatus::Reclaimed;
            env.storage()
                .persistent()
                .set(&DataKey::Vault(vault_id), &vault);

            let token_client = token::Client::new(&env, &vault.token);
            token_client.transfer(
                &env.current_contract_address(),
                &vault.owner,
                &vault.amount,
            );

            env.events()
                .publish((symbol_short!("reclaimed"), vault_id), vault.owner.clone());

            reclaimed.push_back(vault_id);
        }

        reclaimed
    }

    pub fn reclaim(env: Env, vault_id: u64) -> Result<(), Error> {
        let mut vault: VaultEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Vault(vault_id))
            .expect("vault not found");

        vault.owner.require_auth();
        if vault.status != VaultStatus::Active {
            return Err(Error::VaultNotActive);
        }

        let current_ledger = env.ledger().sequence();
        let expiry = vault.expires_after_ledger.expect("vault has no expiry");
        if current_ledger <= expiry {
            return Err(Error::VaultNotYetExpired);
        }

        vault.status = VaultStatus::Reclaimed;
        env.storage()
            .persistent()
            .set(&DataKey::Vault(vault_id), &vault);

        let token_client = token::Client::new(&env, &vault.token);
        token_client.transfer(&env.current_contract_address(), &vault.owner, &vault.amount);

        env.events()
            .publish((symbol_short!("reclaimed"), vault_id), vault.owner.clone());

        Ok(())
    }

    pub fn get_vault(env: Env, vault_id: u64) -> Option<VaultEntry> {
        env.storage().persistent().get(&DataKey::Vault(vault_id))
    }

    pub fn get_vaults_by_owner(env: Env, owner: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::VaultsByOwner(owner))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_vaults_by_recipient(env: Env, recipient: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::VaultsByRecipient(recipient))
            .unwrap_or(Vec::new(&env))
    }

    pub fn current_ledger(env: Env) -> u32 {
        env.ledger().sequence()
    }

    pub fn vault_count(env: Env) -> u64 {
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

        let contract_id = env.register(ScheduleVault, ());

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
    fn test_create_vault() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);

        let vault_id = vault_client.create_vault(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &2000,
            &String::from_str(&env, "Test vault"),
            &None,
        );

        assert_eq!(vault_id, 1);

        let vault = vault_client.get_vault(&vault_id).unwrap();
        assert_eq!(vault.owner, owner);
        assert_eq!(vault.recipient, recipient);
        assert_eq!(vault.amount, 1_000_000);
        assert_eq!(vault.release_ledger, 2000);
        assert_eq!(vault.status, VaultStatus::Active);
    }

    #[test]
    fn test_release_on_time() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);

        let vault_id = vault_client.create_vault(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &2000,
            &String::from_str(&env, "Test vault"),
            &None,
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

        vault_client.release(&vault_id);

        let vault = vault_client.get_vault(&vault_id).unwrap();
        assert_eq!(vault.status, VaultStatus::Released);
    }

    #[test]
    fn test_release_too_early() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);

        let vault_id = vault_client.create_vault(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &2000,
            &String::from_str(&env, "Test vault"),
            &None,
        );

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            vault_client.release(&vault_id);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_cancel_before_release() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);

        let vault_id = vault_client.create_vault(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &2000,
            &String::from_str(&env, "Test vault"),
            &None,
        );

        vault_client.cancel(&vault_id);

        let vault = vault_client.get_vault(&vault_id).unwrap();
        assert_eq!(vault.status, VaultStatus::Cancelled);
    }

    #[test]
    fn test_cancel_after_release_ledger() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);

        let vault_id = vault_client.create_vault(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &2000,
            &String::from_str(&env, "Test vault"),
            &None,
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

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            vault_client.cancel(&vault_id);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_get_vaults_by_owner_and_recipient() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);

        for i in 0..3 {
            vault_client.create_vault(
                &owner,
                &recipient,
                &token,
                &1_000_000,
                &(2000 + i * 100),
                &String::from_str(&env, "Vault"),
                &None,
            );
        }

        let vaults = vault_client.get_vaults_by_owner(&owner);
        assert_eq!(vaults.len(), 3);

        let recipient_vaults = vault_client.get_vaults_by_recipient(&recipient);
        assert_eq!(recipient_vaults.len(), 3);
        assert_eq!(vaults, recipient_vaults);
    }

    #[test]
    fn test_reclaim_before_expiry() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);

        let vault_id = vault_client.create_vault(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &2000,
            &String::from_str(&env, "Test vault"),
            &Some(3000),
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

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            vault_client.reclaim(&vault_id);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_reclaim_after_expiry() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);

        let vault_id = vault_client.create_vault(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &2000,
            &String::from_str(&env, "Test vault"),
            &Some(3000),
        );

        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 3001,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        vault_client.reclaim(&vault_id);

        let vault = vault_client.get_vault(&vault_id).unwrap();
        assert_eq!(vault.status, VaultStatus::Reclaimed);
    }

    #[test]
    fn test_create_vaults_batch_of_three() {
        let (env, contract_id, owner, _recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);

        let r1 = Address::generate(&env);
        let r2 = Address::generate(&env);
        let r3 = Address::generate(&env);
        let mut recipients = Vec::new(&env);
        recipients.push_back(r1.clone());
        recipients.push_back(r2.clone());
        recipients.push_back(r3.clone());

        let ids = vault_client.create_vaults(
            &owner,
            &recipients,
            &token,
            &1_000_000,
            &2000,
            &String::from_str(&env, "Payroll"),
        );

        assert_eq!(ids.len(), 3);
        assert_eq!(ids.get(0).unwrap(), 1);
        assert_eq!(ids.get(1).unwrap(), 2);
        assert_eq!(ids.get(2).unwrap(), 3);

        let v1 = vault_client.get_vault(&1).unwrap();
        let v2 = vault_client.get_vault(&2).unwrap();
        let v3 = vault_client.get_vault(&3).unwrap();

        assert_eq!(v1.recipient, r1);
        assert_eq!(v2.recipient, r2);
        assert_eq!(v3.recipient, r3);
        assert_eq!(v1.release_ledger, 2000);
        assert_eq!(v2.release_ledger, 2000);
        assert_eq!(v3.release_ledger, 2000);
        assert_eq!(v1.amount, 1_000_000);
        assert_eq!(v2.amount, 1_000_000);
        assert_eq!(v3.amount, 1_000_000);

        let owned = vault_client.get_vaults_by_owner(&owner);
        assert_eq!(owned.len(), 3);
        assert_eq!(vault_client.vault_count(), 3);
    }

    #[test]
    fn test_create_vaults_empty_batch() {
        let (env, contract_id, owner, _recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);

        let recipients: Vec<Address> = Vec::new(&env);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            vault_client.create_vaults(
                &owner,
                &recipients,
                &token,
                &1_000_000,
                &2000,
                &String::from_str(&env, "Payroll"),
            );
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_create_vaults_over_cap() {
        let (env, contract_id, owner, _recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);

        let mut recipients: Vec<Address> = Vec::new(&env);
        for _ in 0..(MAX_BATCH_SIZE + 1) {
            recipients.push_back(Address::generate(&env));
        }

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            vault_client.create_vaults(
                &owner,
                &recipients,
                &token,
                &1_000_000,
                &2000,
                &String::from_str(&env, "Payroll"),
            );
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_create_vault_emits_created_event() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);

        let vault_id = vault_client.create_vault(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &2000,
            &String::from_str(&env, "Test vault"),
            &None,
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
        assert_eq!(event_id, vault_id);

        let created = VaultCreated::try_from_val(&env, &data).unwrap();
        assert_eq!(created.owner, owner);
        assert_eq!(created.release_ledger, 2000);
    }

    #[test]
    #[should_panic(expected = "label cannot be empty")]
    fn test_label_empty() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);
        vault_client.create_vault(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &2000,
            &String::from_str(&env, ""),
            &None,
        );
    }

    #[test]
    #[should_panic(expected = "label cannot be blank")]
    fn test_label_whitespace_only() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);
        vault_client.create_vault(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &2000,
            &String::from_str(&env, "   "),
            &None,
        );
    }

    #[test]
    fn test_label_exactly_64() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);
        // 64 chars
        let label = String::from_str(
            &env,
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        );
        let id =
            vault_client.create_vault(&owner, &recipient, &token, &1_000_000, &2000, &label, &None);
        assert_eq!(id, 1);
    }

    #[test]
    #[should_panic(expected = "label max 64 chars")]
    fn test_label_65_chars() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);
        // 65 chars
        vault_client.create_vault(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &2000,
            &String::from_str(
                &env,
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            ),
            &None,
        );
    }

    #[test]
    fn test_transfer_ownership() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);

        let vault_id = vault_client.create_vault(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &2000,
            &String::from_str(&env, "Test vault"),
            &None,
        );

        let new_owner = Address::generate(&env);
        vault_client.transfer_ownership(&vault_id, &new_owner);

        let old_owner_vaults = vault_client.get_vaults_by_owner(&owner);
        assert_eq!(old_owner_vaults.len(), 0);

        let new_owner_vaults = vault_client.get_vaults_by_owner(&new_owner);
        assert_eq!(new_owner_vaults.len(), 1);
        assert_eq!(new_owner_vaults.get(0).unwrap(), vault_id);

        let vault = vault_client.get_vault(&vault_id).unwrap();
        assert_eq!(vault.owner, new_owner);
    }

    // Creates five vaults for the same owner:
    //   id 1 – expires at 3000, ledger will be 3001 → expired, Active  → reclaimed
    //   id 2 – expires at 5000, ledger will be 3001 → not expired      → left alone
    //   id 3 – no expiry set                                            → left alone
    //   id 4 – expires at 2500, ledger will be 3001 → expired, Paused  → reclaimed
    //   id 5 – already Released                                         → left alone
    #[test]
    fn test_reclaim_expired_sweeps_only_expired_vaults() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);

        // Vault 1 – Active, expires 3000
        let id1 = vault_client.create_vault(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &1500,
            &String::from_str(&env, "Vault 1"),
            &Some(3000),
        );

        // Vault 2 – Active, expires 5000 (not yet expired at ledger 3001)
        let id2 = vault_client.create_vault(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &1500,
            &String::from_str(&env, "Vault 2"),
            &Some(5000),
        );

        // Vault 3 – Active, no expiry
        let id3 = vault_client.create_vault(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &1500,
            &String::from_str(&env, "Vault 3"),
            &None,
        );

        // Vault 4 – will be paused, expires 2500
        let id4 = vault_client.create_vault(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &1500,
            &String::from_str(&env, "Vault 4"),
            &Some(2500),
        );
        vault_client.pause(&id4);

        // Vault 5 – release it so it becomes Released
        let id5 = vault_client.create_vault(
            &owner,
            &recipient,
            &token,
            &1_000_000,
            &1500,
            &String::from_str(&env, "Vault 5"),
            &Some(2500),
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
        vault_client.release(&id5);

        // Advance ledger past the expiry of vault 1 and 4 but not vault 2.
        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 3001,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        let reclaimed = vault_client.reclaim_expired(&owner, &10);

        // Only id1 (Active, expired) and id4 (Paused, expired) should be reclaimed.
        assert_eq!(reclaimed.len(), 2);
        assert!(reclaimed.contains(&id1));
        assert!(reclaimed.contains(&id4));

        // Statuses
        assert_eq!(
            vault_client.get_vault(&id1).unwrap().status,
            VaultStatus::Reclaimed
        );
        assert_eq!(
            vault_client.get_vault(&id2).unwrap().status,
            VaultStatus::Active
        );
        assert_eq!(
            vault_client.get_vault(&id3).unwrap().status,
            VaultStatus::Active
        );
        assert_eq!(
            vault_client.get_vault(&id4).unwrap().status,
            VaultStatus::Reclaimed
        );
        assert_eq!(
            vault_client.get_vault(&id5).unwrap().status,
            VaultStatus::Released
        );

        // A reclaimed event must have been emitted for id1 and id4.
        let events = env.events().all();
        let reclaimed_ids: std::vec::Vec<u64> = events
            .iter()
            .filter_map(|(_, topics, _)| {
                let name = Symbol::try_from_val(&env, &topics.first()?).ok()?;
                if name == symbol_short!("reclaimed") {
                    u64::try_from_val(&env, &topics.get(1)?).ok()
                } else {
                    None
                }
            })
            .collect();
        assert!(reclaimed_ids.contains(&id1));
        assert!(reclaimed_ids.contains(&id4));
    }

    // Ensures the limit parameter bounds how many vaults are scanned.
    #[test]
    fn test_reclaim_expired_respects_limit() {
        let (env, contract_id, owner, recipient, token) = setup_test();
        let vault_client = ScheduleVaultClient::new(&env, &contract_id);

        // Three expired vaults.
        for i in 0..3u32 {
            vault_client.create_vault(
                &owner,
                &recipient,
                &token,
                &1_000_000,
                &1500,
                &String::from_str(&env, "Vault"),
                &Some(2000 + i),
            );
        }

        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 9000,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        // Scan only the first 2 out of 3.
        let reclaimed = vault_client.reclaim_expired(&owner, &2);
        assert_eq!(reclaimed.len(), 2);

        // The third vault is still Active (not yet scanned).
        let all_ids = vault_client.get_vaults_by_owner(&owner);
        let third_id = all_ids.get(2).unwrap();
        assert_eq!(
            vault_client.get_vault(&third_id).unwrap().status,
            VaultStatus::Active
        );
    }
}
