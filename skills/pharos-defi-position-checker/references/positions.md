# DeFi Position Workflow

Use this workflow for DeFi position checks, token exposure summaries, LP token balance checks, staking balances, and claimable reward reads.

## Basic Position Report

```bash
node scripts/defi-positions.mjs <wallet> --network mainnet
```

By default the script checks:

- Native token balance.
- Known ERC20 token balances from `assets/tokens.json`.
- Protocol definitions from `assets/protocols.json`, including Faroswap V3 LP NFTs and AquaFlux market tokens where verified.

Zero positions are hidden unless `--include-zero` is supplied.

For Faroswap V3 LP NFT holders, the report decodes each visible tokenId into pair, fee tier, ticks, liquidity, and owed token balances.

For AquaFlux, the built-in registry reports P-token, underlying RWA token, AQ-token, S-token, LP token, and v4 position NFT balances.

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
- Faroswap LP NFT tokenIds and decoded details when present.
- AquaFlux market exposure by token class when present.
- Stablecoin exposure.
- Wrapped/native exposure.
- Any hidden zero positions.
- Explorer links for contracts.

Do not claim a protocol integration exists unless it is present in the registry or provided by the user.
