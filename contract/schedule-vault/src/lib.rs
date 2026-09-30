#![no_std]
use soroban_sdk::{
    contract, contractimpl, contractmeta, contracttype, symbol_short, token, Address, Env, String,
    Vec,
};

contractmeta!(key = "name", val = "ChronoStar Schedule Vault");
contractmeta!(key = "version", val = "0.1.0");
contractmeta!(
    key = "description",
    val = "Time-locked Stellar token vaults"
);

pub const MAX_BATCH_SIZE: u32 = 50;

#[contracttype]
pub enum DataKey {
    Vault(u64),
    Counter,
    VaultsByOwner(Address),
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
}

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum VaultStatus {
    Active,
    Released,
    Cancelled,
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
    ) -> u64 {
        owner.require_auth();
        assert!(amount > 0, "amount must be positive");
        assert!(
            release_ledger > env.ledger().sequence(),
            "release_ledger must be in the future"
        );
        assert!(label.len() <= 64, "label max 64 chars");

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
            recipient,
            token,
            amount,
            release_ledger,
            created_ledger: env.ledger().sequence(),
            label,
            status: VaultStatus::Active,
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

        env.storage().instance().extend_ttl(100_000, 100_000);

        id
    }

    pub fn create_vaults(
        env: Env,
        owner: Address,
        recipients: Vec<Address>,
        token: Address,
        amount: i128,
        release_ledger: u32,
        label_prefix: String,
    ) -> Vec<u64> {
        owner.require_auth();
        assert!(amount > 0, "amount must be positive");
        assert!(
            release_ledger > env.ledger().sequence(),
            "release_ledger must be in the future"
        );
        assert!(label_prefix.len() <= 64, "label max 64 chars");

        let count = recipients.len();
        assert!(count > 0, "batch must not be empty");
        assert!(count <= MAX_BATCH_SIZE, "batch exceeds MAX_BATCH_SIZE");

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
                recipient,
                token: token.clone(),
                amount,
                release_ledger,
                created_ledger,
                label: label_prefix.clone(),
                status: VaultStatus::Active,
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

        ids
    }

    pub fn release(env: Env, vault_id: u64) {
        let mut vault: VaultEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Vault(vault_id))
            .expect("vault not found");

        assert!(vault.status == VaultStatus::Active, "vault not active");
        assert!(
            env.ledger().sequence() >= vault.release_ledger,
            "too early to release"
        );

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
    }

    pub fn cancel(env: Env, vault_id: u64) {
        let mut vault: VaultEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Vault(vault_id))
            .expect("vault not found");

        vault.owner.require_auth();
        assert!(vault.status == VaultStatus::Active, "vault not active");
        assert!(
            env.ledger().sequence() < vault.release_ledger,
            "cannot cancel after release ledger"
        );

        vault.status = VaultStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Vault(vault_id), &vault);

        let token_client = token::Client::new(&env, &vault.token);
        token_client.transfer(&env.current_contract_address(), &vault.owner, &vault.amount);
        env.events()
            .publish((symbol_short!("cancelled"), vault_id), vault.owner.clone());
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
    fn test_get_vaults_by_owner() {
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
            );
        }

        let vaults = vault_client.get_vaults_by_owner(&owner);
        assert_eq!(vaults.len(), 3);
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
}
