---
name: pharos-defi-position-checker
description: >
  Portable Pharos Agent Center skill for checking DeFi-style wallet positions on Pharos mainnet or Atlantic testnet. Use when the user asks for DeFi positions, ecosystem protocol balances, Faroswap pool or LP positions, AquaFlux P/AQ/S/RWA/LP holdings, protocol balances, LP token balances, staking balances, claimable rewards, wrapped asset exposure, stablecoin exposure, RealFi asset positions, or registry-driven position reports for PHRS/PROS networks. Uses Foundry cast read calls and supports optional protocol definition JSON files for ERC20, ERC721, Faroswap V3 NFT LP, staking, vault, or LP position contracts.
---

# Pharos DeFi Position Checker

Registry-driven position checker for Pharos wallets. It reports native balance, known token positions, and ecosystem protocol positions such as Faroswap V3 LP NFTs and AquaFlux market tokens.

Required binary: Foundry `cast`. Required runtime: Node.js. No private key required for read-only checks.

## Capability Index

| User need | Use | Details |
| --- | --- | --- |
| Check wallet DeFi/token positions | `node scripts/defi-positions.mjs <wallet> --network mainnet` | Includes built-in Faroswap/AquaFlux registry |
| Check both Pharos networks | `node scripts/defi-positions.mjs <wallet> --network all` | See `references/positions.md` |
| Show zero protocol positions too | `node scripts/defi-positions.mjs <wallet> --network mainnet --include-zero` | Useful for ecosystem coverage checks |
| Machine-readable report | `node scripts/defi-positions.mjs <wallet> --network mainnet --json` | Use for downstream agents |
| Add LP/NFT/staking/vault definitions | `node scripts/defi-positions.mjs <wallet> --protocol-file protocols.local.json` | See `references/protocol-registry.md` |

## Quick Commands

```bash
node scripts/defi-positions.mjs 0x13e272ed4a94105b1fab86ca878f6d049355c978 --network mainnet
node scripts/defi-positions.mjs 0x13e272ed4a94105b1fab86ca878f6d049355c978 --network all --include-zero
node scripts/defi-positions.mjs 0x13e272ed4a94105b1fab86ca878f6d049355c978 --network mainnet --json
```

PowerShell:

```powershell
node .\scripts\defi-positions.mjs 0x13e272ed4a94105b1fab86ca878f6d049355c978 --network mainnet
```

## Output Rules

- Report network, source, position symbol, category, balance, contract, and explorer link.
- For Faroswap V3 LP NFTs, include NFT count and decode visible tokenIds into pair, fee tier, ticks, liquidity, and owed tokens.
- For AquaFlux, report P-token, underlying RWA token, AQ-token, S-token, LP token, and v4 position NFT balances from the built-in registry.
- Hide zero positions by default and mention how many were hidden.
- Use `--json` when another agent/script needs machine-readable position data.
- Do not invent protocol addresses. Use only `assets/protocols.json` or user-provided protocol files.
- If a protocol call fails, stop and explain which definition likely needs correction.

## Safety

- This skill is read-only.
- For claim/withdraw/deposit transactions, generate a plan only and hand off to the official `pharos-skill-engine` write flow.
