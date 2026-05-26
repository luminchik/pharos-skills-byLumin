# DeFi Position Workflow

Use this workflow for DeFi position checks, token exposure summaries, LP token balance checks, staking balances, and claimable reward reads.

## Basic Position Report

```bash
node scripts/defi-positions.mjs <wallet> --network mainnet
```

By default the script checks:

- Native token balance.
- Known ERC20 token balances from `assets/tokens.json`.
- Protocol definitions from `assets/protocols.json`.

Zero positions are hidden unless `--include-zero` is supplied.

## Both Networks

```bash
node scripts/defi-positions.mjs <wallet> --network all
```

## With Custom Protocol File

```bash
node scripts/defi-positions.mjs <wallet> --network mainnet --protocol-file protocols.local.json
```

## Agent Response

Summarize:

- Non-zero positions.
- Stablecoin exposure.
- Wrapped/native exposure.
- Any hidden zero positions.
- Explorer links for contracts.

Do not claim a protocol integration exists unless it is present in the registry or provided by the user.
