# Doctor Workflow

Use this workflow when the user asks whether Pharos tooling works, when `cast` is missing, or before live demos.

## Steps

1. Run `node scripts/pharos-doctor.mjs` from this skill folder.
2. Confirm `cast` is found and print `cast --version`.
3. Confirm `forge` is found when deployment or verification is expected.
4. Query every network in `assets/networks.json` with `cast chain-id --rpc-url <rpc>`.
5. Compare returned chain id to configured `chainId`.
6. Detect whether `PRIVATE_KEY` is set without printing it.
7. If set, derive the public address with `cast wallet address --private-key <value>`.

## Expected Result

The final output should clearly show:

- OS and shell family.
- `cast` status.
- `forge` status.
- RPC status for `atlantic-testnet` and `mainnet`.
- Private key status: set/not set.

## Error Recovery

If `cast` is missing:

- Windows: install Git Bash and Foundry, then ensure `%USERPROFILE%\.foundry\bin` is visible in PATH.
- macOS/Linux: run `curl -L https://foundry.paradigm.xyz | bash`, then `foundryup`.

If RPC chain id mismatches, do not continue with chain operations on that network.
