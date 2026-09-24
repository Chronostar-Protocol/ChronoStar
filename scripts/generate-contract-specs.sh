#!/usr/bin/env bash
set -euo pipefail

cargo build --release --target wasm32-unknown-unknown

for contract in schedule-vault recurring-stream dca-policy; do
  wasm="target/wasm32-unknown-unknown/release/${contract//-/_}.wasm"
  stellar contract bindings json --wasm "$wasm" --output "contract/$contract/spec.json"
done

echo "Contract specs written to contract/*/spec.json"
