#![no_std]
use soroban_sdk::{
    contract, contractimpl, contractmeta, contracttype, symbol_short, token, Address, Env, IntoVal, String, Symbol, Val, Vec,
};

contractmeta!(key = "name", val = "ChronoStar DCA Policy");
contractmeta!(key = "version", val = "0.1.0");
contractmeta!(
    key = "description",
    val = "Automated dollar-cost averaging policies"
);

/// Upper bound on how many records a single `get_execution_history` call returns.
/// Callers paginate with `start` to walk the full history.
pub const MAX_HISTORY_PAGE: u32 = 50;

#[contracttype]
pub enum DataKey {
    DCA(u64),
    Counter,
    DCAsByOwner(Address),
    Config,
    ExecutionRecord(u64, u32),
}

#[contracttype]
#[derive(Clone)]
pub struct DCAEntry {
    pub id: u64,
    pub owner: Address,
    pub token_in: Address,
    pub token_out: Option<Address>,
    pub router: Option<Address>,
    pub swap_receiver: Address,
    pub total_budget: i128,
    pub remaining_budget: i128,
    pub amount_per_swap: i128,
    pub min_output_per_swap: i128,
    pub last_swap_output: i128,
    pub interval_ledgers: u32,
    pub last_executed_ledger: u32,
    pub next_execution_ledger: u32,
    pub executions_completed: u32,
    pub created_ledger: u32,
    pub label: String,
    pub status: DCAStatus,
}

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum DCAStatus {
    Active,
    Exhausted,
    Cancelled,
}

/// A single recorded swap execution, keyed by (dca_id, index) where index is
/// 1-based and matches `DCAEntry::executions_completed` at write time.
#[contracttype]
#[derive(Clone)]
pub struct ExecutionRecord {
    pub index: u32,
    pub dca_id: u64,
    pub ledger: u32,
    pub amount_in: i128,
    pub amount_out: i128,
    pub remaining_budget: i128,
    pub next_execution_ledger: u32,
    pub swapped: bool,
}

#[contract]
pub struct DCAPolicy;

#[contractimpl]
impl DCAPolicy {
    #[allow(clippy::too_many_arguments)]
    pub fn create_dca(
        env: Env,
        owner: Address,
        token_in: Address,
        swap_receiver: Address,
        total_budget: i128,
        amount_per_swap: i128,
        interval_ledgers: u32,
        label: String,
    ) -> u64 {
        Self::create_dca_swap(
            env,
            owner,
            token_in,
            None,
            None,
            swap_receiver,
            total_budget,
            amount_per_swap,
            0,
            interval_ledgers,
            label,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_dca_swap(
        env: Env,
        owner: Address,
        token_in: Address,
        token_out: Option<Address>,
        router: Option<Address>,
        swap_receiver: Address,
        total_budget: i128,
        amount_per_swap: i128,
        min_output_per_swap: i128,
        interval_ledgers: u32,
        label: String,
    ) -> u64 {
        owner.require_auth();
        assert!(
            total_budget > 0 && amount_per_swap > 0,
            "amounts must be positive"
        );
        assert!(
            total_budget % amount_per_swap == 0,
            "total_budget must be exact multiple of amount_per_swap"
        );
        assert!(interval_ledgers >= 120, "minimum interval is 120 ledgers");

        let token_client = token::Client::new(&env, &token_in);
        token_client.transfer_from(
            &env.current_contract_address(),
            &owner,
            &env.current_contract_address(),
            &total_budget,
        );

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0u64)
            + 1;
        env.storage().instance().set(&DataKey::Counter, &id);

        let current = env.ledger().sequence();
        let dca = DCAEntry {
            id,
            owner: owner.clone(),
            token_in,
            token_out,
            router,
            swap_receiver,
            total_budget,
            remaining_budget: total_budget,
            amount_per_swap,
            min_output_per_swap,
            last_swap_output: 0,
            interval_ledgers,
            last_executed_ledger: current,
            next_execution_ledger: current + interval_ledgers,
            executions_completed: 0,
            created_ledger: current,
            label,
            status: DCAStatus::Active,
        };

        env.storage().persistent().set(&DataKey::DCA(id), &dca);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::DCA(id), 6_312_000, 6_312_000);

        let mut owner_dcas: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::DCAsByOwner(owner.clone()))
            .unwrap_or(Vec::new(&env));
        owner_dcas.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::DCAsByOwner(owner.clone()), &owner_dcas);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::DCAsByOwner(owner), 6_312_000, 6_312_000);

        env.storage().instance().extend_ttl(100_000, 100_000);

        id
    }

    pub fn execute_swap(env: Env, dca_id: u64) {
        let mut dca: DCAEntry = env
            .storage()
            .persistent()
            .get(&DataKey::DCA(dca_id))
            .expect("DCA not found");

        assert!(dca.status == DCAStatus::Active, "DCA not active");
        assert!(
            env.ledger().sequence() >= dca.next_execution_ledger,
            "too early to execute"
        );
        assert!(
            dca.remaining_budget >= dca.amount_per_swap,
            "insufficient budget"
        );

        let swapped = dca.router.is_some() && dca.token_out.is_some();

        if let (Some(router), Some(token_out)) = (dca.router.clone(), dca.token_out.clone()) {
            let token_in_client = token::Client::new(&env, &dca.token_in);
            token_in_client.approve(
                &env.current_contract_address(),
                &router,
                &dca.amount_per_swap,
                &(env.ledger().sequence() + 100),
            );

            let swap_args: Vec<Val> = (
                env.current_contract_address(),
                dca.swap_receiver.clone(),
                dca.token_in.clone(),
                token_out,
                dca.amount_per_swap,
                dca.min_output_per_swap,
            )
                .into_val(&env);

            let output_amount: i128 =
                env.invoke_contract(&router, &Symbol::new(&env, "swap"), swap_args);
            assert!(
                output_amount > 0,
                "swap resulted in zero output"
            );
            assert!(
                output_amount >= dca.min_output_per_swap,
                "slippage shortfall"
            );
            dca.last_swap_output = output_amount;
        } else {
            let token_client = token::Client::new(&env, &dca.token_in);
            token_client.transfer(
                &env.current_contract_address(),
                &dca.swap_receiver,
                &dca.amount_per_swap,
            );
            dca.last_swap_output = dca.amount_per_swap;
        }

        dca.remaining_budget -= dca.amount_per_swap;
        dca.executions_completed += 1;
        dca.last_executed_ledger = env.ledger().sequence();
        dca.next_execution_ledger = env.ledger().sequence() + dca.interval_ledgers;

        if dca.remaining_budget == 0 {
            dca.status = DCAStatus::Exhausted;
        }

        let record = ExecutionRecord {
            index: dca.executions_completed,
            dca_id,
            ledger: dca.last_executed_ledger,
            amount_in: dca.amount_per_swap,
            amount_out: dca.last_swap_output,
            remaining_budget: dca.remaining_budget,
            next_execution_ledger: dca.next_execution_ledger,
            swapped,
        };

        env.storage()
            .persistent()
            .set(&DataKey::ExecutionRecord(dca_id, record.index), &record);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::ExecutionRecord(dca_id, record.index), 6_312_000, 6_312_000);

        env.storage().persistent().set(&DataKey::DCA(dca_id), &dca);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::DCA(dca_id), 6_312_000, 6_312_000);
        env.events()
            .publish((symbol_short!("swap"), dca_id), dca.executions_completed);
    }

    pub fn cancel(env: Env, dca_id: u64) {
        let mut dca: DCAEntry = env
            .storage()
            .persistent()
            .get(&DataKey::DCA(dca_id))
            .expect("DCA not found");

        dca.owner.require_auth();
        assert!(dca.status == DCAStatus::Active, "DCA not active");

        if dca.remaining_budget > 0 {
            let token_client = token::Client::new(&env, &dca.token_in);
            token_client.transfer(
                &env.current_contract_address(),
                &dca.owner,
                &dca.remaining_budget,
            );
        }

        dca.remaining_budget = 0;
        dca.status = DCAStatus::Cancelled;
        env.storage().persistent().set(&DataKey::DCA(dca_id), &dca);
        env.events()
            .publish((symbol_short!("cancelled"), dca_id), dca.owner.clone());
    }

    pub fn top_up(env: Env, dca_id: u64, amount: i128) {
        let mut dca: DCAEntry = env
            .storage()
            .persistent()
            .get(&DataKey::DCA(dca_id))
            .expect("DCA not found");

        dca.owner.require_auth();
        assert!(amount > 0, "amount must be positive");
        assert!(dca.status != DCAStatus::Cancelled, "cannot top-up cancelled policy");

        let token_client = token::Client::new(&env, &dca.token_in);
        token_client.transfer_from(
            &env.current_contract_address(),
            &dca.owner,
            &env.current_contract_address(),
            &amount,
        );

        dca.total_budget += amount;
        dca.remaining_budget += amount;

        if dca.status == DCAStatus::Exhausted {
            dca.status = DCAStatus::Active;
            dca.next_execution_ledger = env.ledger().sequence() + dca.interval_ledgers;
        }

        env.storage().persistent().set(&DataKey::DCA(dca_id), &dca);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::DCA(dca_id), 6_312_000, 6_312_000);
        env.events()
            .publish((symbol_short!("topup"), dca_id), amount);
    }

    pub fn get_dca(env: Env, dca_id: u64) -> Option<DCAEntry> {
        env.storage().persistent().get(&DataKey::DCA(dca_id))
    }

    pub fn get_dcas_by_owner(env: Env, owner: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::DCAsByOwner(owner))
            .unwrap_or(Vec::new(&env))
    }

    /// Returns up to `limit` execution records for `dca_id`, starting at the
    /// 1-based `start` index. `limit` is clamped to `MAX_HISTORY_PAGE`.
    /// Returns an empty vec when the DCA has no executions or `start` is past
    /// the end of history.
    pub fn get_execution_history(env: Env, dca_id: u64, start: u32, limit: u32) -> Vec<ExecutionRecord> {
        let dca: DCAEntry = env
            .storage()
            .persistent()
            .get(&DataKey::DCA(dca_id))
            .expect("DCA not found");

        let cap = limit.min(MAX_HISTORY_PAGE);
        let mut records: Vec<ExecutionRecord> = Vec::new(&env);
        if cap == 0 || start > dca.executions_completed {
            return records;
        }

        let total = dca.executions_completed;
        let end = total.min(start.saturating_add(cap).saturating_sub(1));
        let mut index = start;
        while index <= end {
            if let Some(record) = env
                .storage()
                .persistent()
                .get(&DataKey::ExecutionRecord(dca_id, index))
            {
                records.push_back(record);
            }
            index += 1;
        }
        records
    }

    /// Number of executions recorded for `dca_id`.
    pub fn get_execution_count(env: Env, dca_id: u64) -> u32 {
        let dca: DCAEntry = env
            .storage()
            .persistent()
            .get(&DataKey::DCA(dca_id))
            .expect("DCA not found");
        dca.executions_completed
    }

    pub fn current_ledger(env: Env) -> u32 {
        env.ledger().sequence()
    }

    pub fn dca_count(env: Env) -> u64 {
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
        let swap_receiver = Address::generate(&env);

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();
        let token_admin_client = TokenAdminClient::new(&env, &token);
        token_admin_client.mint(&owner, &10_000_000_000);

        let contract_id = env.register(DCAPolicy, ());

        let token_client = TokenClient::new(&env, &token);
        token_client.approve(
            &owner,
            &contract_id,
            &10_000_000_000i128,
            &(env.ledger().sequence() + 10000),
        );

        (env, contract_id, owner, swap_receiver, token)
    }

    #[test]
    fn test_create_dca() {
        let (env, contract_id, owner, swap_receiver, token) = setup_test();
        let dca_client = DCAPolicyClient::new(&env, &contract_id);

        let dca_id = dca_client.create_dca(
            &owner,
            &token,
            &swap_receiver,
            &1_000_000,
            &100_000,
            &1440,
            &String::from_str(&env, "Test DCA"),
        );

        assert_eq!(dca_id, 1);

        let dca = dca_client.get_dca(&dca_id).unwrap();
        assert_eq!(dca.owner, owner);
        assert_eq!(dca.total_budget, 1_000_000);
        assert_eq!(dca.amount_per_swap, 100_000);
        assert_eq!(dca.status, DCAStatus::Active);
    }

    #[test]
    fn test_execute_swap() {
        let (env, contract_id, owner, swap_receiver, token) = setup_test();
        let dca_client = DCAPolicyClient::new(&env, &contract_id);

        let dca_id = dca_client.create_dca(
            &owner,
            &token,
            &swap_receiver,
            &1_000_000,
            &100_000,
            &1440,
            &String::from_str(&env, "Test DCA"),
        );

        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 2440,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        dca_client.execute_swap(&dca_id);

        let dca = dca_client.get_dca(&dca_id).unwrap();
        assert_eq!(dca.executions_completed, 1);
        assert_eq!(dca.remaining_budget, 900_000);
    }

    #[test]
    fn test_execute_too_early() {
        let (env, contract_id, owner, swap_receiver, token) = setup_test();
        let dca_client = DCAPolicyClient::new(&env, &contract_id);

        let dca_id = dca_client.create_dca(
            &owner,
            &token,
            &swap_receiver,
            &1_000_000,
            &100_000,
            &1440,
            &String::from_str(&env, "Test DCA"),
        );

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            dca_client.execute_swap(&dca_id);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_execute_exhausts_budget() {
        let (env, contract_id, owner, swap_receiver, token) = setup_test();
        let dca_client = DCAPolicyClient::new(&env, &contract_id);

        let dca_id = dca_client.create_dca(
            &owner,
            &token,
            &swap_receiver,
            &500_000,
            &100_000,
            &120,
            &String::from_str(&env, "Test DCA"),
        );

        for i in 0..5 {
            env.ledger().set(LedgerInfo {
                protocol_version: 22,
                sequence_number: 1000 + (i * 120) + 120,
                timestamp: 0,
                network_id: [0u8; 32],
                base_reserve: 0,
                min_persistent_entry_ttl: 1000,
                min_temp_entry_ttl: 1000,
                max_entry_ttl: 6_312_000,
            });
            dca_client.execute_swap(&dca_id);
        }

        let dca = dca_client.get_dca(&dca_id).unwrap();
        assert_eq!(dca.status, DCAStatus::Exhausted);
        assert_eq!(dca.remaining_budget, 0);
        assert_eq!(dca.executions_completed, 5);
    }

    #[test]
    fn test_cancel_returns_remaining() {
        let (env, contract_id, owner, swap_receiver, token) = setup_test();
        let dca_client = DCAPolicyClient::new(&env, &contract_id);

        let dca_id = dca_client.create_dca(
            &owner,
            &token,
            &swap_receiver,
            &1_000_000,
            &100_000,
            &1440,
            &String::from_str(&env, "Test DCA"),
        );

        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 2440,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        dca_client.execute_swap(&dca_id);
        dca_client.cancel(&dca_id);

        let dca = dca_client.get_dca(&dca_id).unwrap();
        assert_eq!(dca.status, DCAStatus::Cancelled);
        assert_eq!(dca.remaining_budget, 0);
    }

    #[test]
    fn test_top_up_active() {
        let (env, contract_id, owner, swap_receiver, token) = setup_test();
        let dca_client = DCAPolicyClient::new(&env, &contract_id);

        let dca_id = dca_client.create_dca(
            &owner,
            &token,
            &swap_receiver,
            &1_000_000,
            &100_000,
            &1440,
            &String::from_str(&env, "Test DCA"),
        );

        dca_client.top_up(&dca_id, &500_000);

        let dca = dca_client.get_dca(&dca_id).unwrap();
        assert_eq!(dca.total_budget, 1_500_000);
        assert_eq!(dca.remaining_budget, 1_500_000);
        assert_eq!(dca.status, DCAStatus::Active);
    }

    #[test]
    fn test_top_up_exhausted() {
        let (env, contract_id, owner, swap_receiver, token) = setup_test();
        let dca_client = DCAPolicyClient::new(&env, &contract_id);

        let dca_id = dca_client.create_dca(
            &owner,
            &token,
            &swap_receiver,
            &500_000,
            &100_000,
            &120,
            &String::from_str(&env, "Test DCA"),
        );

        for i in 0..5 {
            env.ledger().set(LedgerInfo {
                protocol_version: 22,
                sequence_number: 1000 + (i * 120) + 120,
                timestamp: 0,
                network_id: [0u8; 32],
                base_reserve: 0,
                min_persistent_entry_ttl: 1000,
                min_temp_entry_ttl: 1000,
                max_entry_ttl: 6_312_000,
            });
            dca_client.execute_swap(&dca_id);
        }

        let dca = dca_client.get_dca(&dca_id).unwrap();
        assert_eq!(dca.status, DCAStatus::Exhausted);

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

        dca_client.top_up(&dca_id, &500_000);

        let dca2 = dca_client.get_dca(&dca_id).unwrap();
        assert_eq!(dca2.status, DCAStatus::Active);
        assert_eq!(dca2.total_budget, 1_000_000);
        assert_eq!(dca2.remaining_budget, 500_000);
        assert_eq!(dca2.next_execution_ledger, 2000 + 120);
    }

    #[test]
    fn test_top_up_cancelled_fails() {
        let (env, contract_id, owner, swap_receiver, token) = setup_test();
        let dca_client = DCAPolicyClient::new(&env, &contract_id);

        let dca_id = dca_client.create_dca(
            &owner,
            &token,
            &swap_receiver,
            &1_000_000,
            &100_000,
            &1440,
            &String::from_str(&env, "Test DCA"),
        );

        dca_client.cancel(&dca_id);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            dca_client.top_up(&dca_id, &500_000);
        }));
        assert!(result.is_err());
    }

    #[contract]
    pub struct MockRouter;

    #[contractimpl]
    impl MockRouter {
        pub fn swap(
            env: Env,
            _from: Address,
            to: Address,
            _token_in: Address,
            token_out: Address,
            _amount_in: i128,
            min_amount_out: i128,
        ) -> i128 {
            let token_out_admin_client = TokenAdminClient::new(&env, &token_out);
            let output = min_amount_out + 10;
            token_out_admin_client.mint(&to, &output);
            output
        }
    }

    fn advance_to(env: &Env, sequence: u32) {
        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: sequence,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });
    }

    #[test]
    fn test_execution_history_records_each_swap() {
        let (env, contract_id, owner, swap_receiver, token) = setup_test();
        let dca_client = DCAPolicyClient::new(&env, &contract_id);

        let dca_id = dca_client.create_dca(
            &owner,
            &token,
            &swap_receiver,
            &500_000,
            &100_000,
            &120,
            &String::from_str(&env, "History DCA"),
        );

        let history = dca_client.get_execution_history(&dca_id, &1, &50);
        assert_eq!(history.len(), 0);
        assert_eq!(dca_client.get_execution_count(&dca_id), 0);

        for i in 0..5u32 {
            advance_to(&env, 1000 + (i * 120) + 120);
            dca_client.execute_swap(&dca_id);
        }

        assert_eq!(dca_client.get_execution_count(&dca_id), 5);

        let history = dca_client.get_execution_history(&dca_id, &1, &50);
        assert_eq!(history.len(), 5);

        for (i, record) in history.iter().enumerate() {
            let expected_index = i as u32 + 1;
            assert_eq!(record.index, expected_index);
            assert_eq!(record.dca_id, dca_id);
            assert_eq!(record.amount_in, 100_000);
            assert_eq!(record.amount_out, 100_000);
            assert_eq!(record.remaining_budget, 500_000 - (100_000 * expected_index as i128));
            assert_eq!(record.ledger, 1000 + (expected_index as u32 - 1) * 120 + 120);
            assert!(!record.swapped);
        }

        assert_eq!(history.last().unwrap().remaining_budget, 0);
    }

    #[test]
    fn test_execution_history_paginates() {
        let (env, contract_id, owner, swap_receiver, token) = setup_test();
        let dca_client = DCAPolicyClient::new(&env, &contract_id);

        let dca_id = dca_client.create_dca(
            &owner,
            &token,
            &swap_receiver,
            &500_000,
            &100_000,
            &120,
            &String::from_str(&env, "Paged DCA"),
        );

        for i in 0..5u32 {
            advance_to(&env, 1000 + (i * 120) + 120);
            dca_client.execute_swap(&dca_id);
        }

        let page_one = dca_client.get_execution_history(&dca_id, &1, &2);
        assert_eq!(page_one.len(), 2);
        assert_eq!(page_one.get(0).unwrap().index, 1);
        assert_eq!(page_one.get(1).unwrap().index, 2);

        let page_two = dca_client.get_execution_history(&dca_id, &3, &2);
        assert_eq!(page_two.len(), 2);
        assert_eq!(page_two.get(0).unwrap().index, 3);
        assert_eq!(page_two.get(1).unwrap().index, 4);

        let last = dca_client.get_execution_history(&dca_id, &5, &2);
        assert_eq!(last.len(), 1);
        assert_eq!(last.get(0).unwrap().index, 5);

        let past_end = dca_client.get_execution_history(&dca_id, &6, &2);
        assert_eq!(past_end.len(), 0);
    }

    #[test]
    fn test_execution_history_limit_is_clamped() {
        let (env, contract_id, owner, swap_receiver, token) = setup_test();
        let dca_client = DCAPolicyClient::new(&env, &contract_id);

        let dca_id = dca_client.create_dca(
            &owner,
            &token,
            &swap_receiver,
            &500_000,
            &100_000,
            &120,
            &String::from_str(&env, "Clamp DCA"),
        );

        for i in 0..5u32 {
            advance_to(&env, 1000 + (i * 120) + 120);
            dca_client.execute_swap(&dca_id);
        }

        let clamped = dca_client.get_execution_history(&dca_id, &1, &10_000);
        assert!(clamped.len() as u32 <= MAX_HISTORY_PAGE);

        let zero_limit = dca_client.get_execution_history(&dca_id, &1, &0);
        assert_eq!(zero_limit.len(), 0);
    }

    #[test]
    fn test_execution_history_records_swapped_flag() {
        let (env, contract_id, owner, swap_receiver, token_in) = setup_test();
        let dca_client = DCAPolicyClient::new(&env, &contract_id);

        let router_id = env.register(MockRouter, ());
        let token_out_admin = Address::generate(&env);
        let token_out = env
            .register_stellar_asset_contract_v2(token_out_admin)
            .address();

        let dca_id = dca_client.create_dca_swap(
            &owner,
            &token_in,
            &Some(token_out),
            &Some(router_id),
            &swap_receiver,
            &500_000,
            &100_000,
            &95_000,
            &120,
            &String::from_str(&env, "Router History"),
        );

        advance_to(&env, 1120);
        dca_client.execute_swap(&dca_id);

        let history = dca_client.get_execution_history(&dca_id, &1, &50);
        assert_eq!(history.len(), 1);
        let record = history.get(0).unwrap();
        assert!(record.swapped);
        assert_eq!(record.amount_in, 100_000);
        assert_eq!(record.amount_out, 95_010);
        assert_eq!(record.next_execution_ledger, 1120 + 120);
    }

    #[test]
    fn test_execution_history_survives_cancel() {
        let (env, contract_id, owner, swap_receiver, token) = setup_test();
        let dca_client = DCAPolicyClient::new(&env, &contract_id);

        let dca_id = dca_client.create_dca(
            &owner,
            &token,
            &swap_receiver,
            &1_000_000,
            &100_000,
            &120,
            &String::from_str(&env, "Cancel History"),
        );

        advance_to(&env, 1120);
        dca_client.execute_swap(&dca_id);
        dca_client.cancel(&dca_id);

        let history = dca_client.get_execution_history(&dca_id, &1, &50);
        assert_eq!(history.len(), 1);
        assert_eq!(history.get(0).unwrap().index, 1);
        assert_eq!(dca_client.get_execution_count(&dca_id), 1);
    }

    #[test]
    fn test_execution_history_unknown_dca_panics() {
        let (env, contract_id, _owner, _swap_receiver, _token) = setup_test();
        let dca_client = DCAPolicyClient::new(&env, &contract_id);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            dca_client.get_execution_history(&99, &1, &10);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_execute_swap_with_router() {
        let (env, contract_id, owner, swap_receiver, token_in) = setup_test();
        let dca_client = DCAPolicyClient::new(&env, &contract_id);

        let router_id = env.register(MockRouter, ());

        let token_out_admin = Address::generate(&env);
        let token_out = env
            .register_stellar_asset_contract_v2(token_out_admin.clone())
            .address();

        let dca_id = dca_client.create_dca_swap(
            &owner,
            &token_in,
            &Some(token_out.clone()),
            &Some(router_id.clone()),
            &swap_receiver,
            &1_000_000,
            &100_000,
            &95_000,
            &1440,
            &String::from_str(&env, "Router DCA"),
        );

        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 2440,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        dca_client.execute_swap(&dca_id);

        let dca = dca_client.get_dca(&dca_id).unwrap();
        assert_eq!(dca.executions_completed, 1);
        assert_eq!(dca.last_swap_output, 95_010);
    }

    #[contract]
    pub struct MockBreachingRouter;

    #[contractimpl]
    impl MockBreachingRouter {
        pub fn swap(
            env: Env,
            _from: Address,
            to: Address,
            _token_in: Address,
            token_out: Address,
            _amount_in: i128,
            min_amount_out: i128,
        ) -> i128 {
            let token_out_admin_client = TokenAdminClient::new(&env, &token_out);
            let output = min_amount_out - 10; // breach slippage
            if output > 0 {
                token_out_admin_client.mint(&to, &output);
            }
            output
        }
    }

    #[test]
    #[should_panic(expected = "slippage shortfall")]
    fn test_execute_swap_with_breaching_router() {
        let (env, contract_id, owner, swap_receiver, token_in) = setup_test();
        let dca_client = DCAPolicyClient::new(&env, &contract_id);

        let router_id = env.register(MockBreachingRouter, ());
        let token_out_admin = Address::generate(&env);
        let token_out = env
            .register_stellar_asset_contract_v2(token_out_admin.clone())
            .address();

        let dca_id = dca_client.create_dca_swap(
            &owner,
            &token_in,
            &Some(token_out.clone()),
            &Some(router_id.clone()),
            &swap_receiver,
            &1_000_000,
            &100_000,
            &95_000,
            &1440,
            &String::from_str(&env, "Router DCA"),
        );

        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 2440,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        dca_client.execute_swap(&dca_id);
    }

    #[contract]
    pub struct MockZeroRouter;

    #[contractimpl]
    impl MockZeroRouter {
        pub fn swap(
            _env: Env,
            _from: Address,
            _to: Address,
            _token_in: Address,
            _token_out: Address,
            _amount_in: i128,
            _min_amount_out: i128,
        ) -> i128 {
            0
        }
    }

    #[test]
    #[should_panic(expected = "swap resulted in zero output")]
    fn test_execute_swap_with_zero_router() {
        let (env, contract_id, owner, swap_receiver, token_in) = setup_test();
        let dca_client = DCAPolicyClient::new(&env, &contract_id);

        let router_id = env.register(MockZeroRouter, ());
        let token_out_admin = Address::generate(&env);
        let token_out = env
            .register_stellar_asset_contract_v2(token_out_admin.clone())
            .address();

        let dca_id = dca_client.create_dca_swap(
            &owner,
            &token_in,
            &Some(token_out.clone()),
            &Some(router_id.clone()),
            &swap_receiver,
            &1_000_000,
            &100_000,
            &0, 
            &1440,
            &String::from_str(&env, "Router DCA"),
        );

        env.ledger().set(LedgerInfo {
            protocol_version: 22,
            sequence_number: 2440,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_persistent_entry_ttl: 1000,
            min_temp_entry_ttl: 1000,
            max_entry_ttl: 6_312_000,
        });

        dca_client.execute_swap(&dca_id);
    }
}
