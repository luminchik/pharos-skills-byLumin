# Transaction Debug Workflow

Use this workflow for transaction status, tx debugging, failed transaction investigation, or calldata/event summaries.

## Basic Usage

```bash
node scripts/tx-debug.mjs <tx_hash> --network all
node scripts/tx-debug.mjs <tx_hash> --network mainnet
node scripts/tx-debug.mjs <tx_hash> --network atlantic-testnet
```

## What The Script Does

1. Validates transaction hash format.
2. Reads networks from `assets/networks.json`.
3. Runs `cast tx <tx_hash> --rpc-url <rpc>`.
4. Runs `cast receipt <tx_hash> --rpc-url <rpc>`.
5. Classifies status as success, failed, pending, or not found.
6. Extracts sender, recipient, value, block number, gas used, contract address, and input selector.
7. Looks up common function selectors and event topics in `assets/selectors.json`.
8. Prints explorer links.

## Agent Response

Lead with:

- Network found.
- Status.
- Sender and target.
- Value.
- Gas used.
- Selector label when known.
- Explorer link.

If the selector is unknown, say that ABI is required for full decoding.

## ABI Decoding Extension

If the user provides ABI JSON or a Solidity source path, use `cast calldata-decode`, `cast pretty-calldata`, or `cast logs` with the ABI when appropriate. Keep this as an optional follow-up; the default tx-debug workflow should work without ABI.
