---
name: pharos-defi-position-checker
description: >
  Portable Pharos Agent Center skill for checking DeFi-style wallet positions on Pharos mainnet or Atlantic testnet. Use when the user asks for DeFi positions, protocol balances, LP token balances, staking balances, claimable rewards, wrapped asset exposure, stablecoin exposure, RealFi asset positions, or registry-driven position reports for PHRS/PROS networks. Uses Foundry cast read calls and supports optional protocol definition JSON files for staking, vault, LP, or ERC20 position contracts.
---

# Pharos DeFi Position Checker

Registry-driven position checker for Pharos wallets. It reports native balance, known token positions, and optional protocol positions supplied through JSON definitions.

Required binary: Foundry `cast`. Required runtime: Node.js. No private key required for read-only checks.

## Capability Index

| User need | Use | Details |
| --- | --- | --- |
| Check wallet DeFi/token positions | `node scripts/defi-positions.mjs <wallet> --network mainnet` | See `references/positions.md` |
| Check both Pharos networks | `node scripts/defi-positions.mjs <wallet> --network all` | See `references/positions.md` |
| Add LP/staking/vault definitions | `node scripts/defi-positions.mjs <wallet> --protocol-file protocols.local.json` | See `references/protocol-registry.md` |

## Quick Commands

```bash
node scripts/defi-positions.mjs 0x13e272ed4a94105b1fab86ca878f6d049355c978 --network mainnet
node scripts/defi-positions.mjs 0x13e272ed4a94105b1fab86ca878f6d049355c978 --network all --include-zero
```

PowerShell:

```powershell
node .\scripts\defi-positions.mjs 0x13e272ed4a94105b1fab86ca878f6d049355c978 --network mainnet
```

## Output Rules

- Report network, source, position symbol, category, balance, contract, and explorer link.
- Hide zero positions by default and mention how many were hidden.
- Use `--json` when another agent/script needs machine-readable position data.
- Do not invent protocol addresses. Use only `assets/protocols.json` or user-provided protocol files.
- If a protocol call fails, stop and explain which definition likely needs correction.

## Safety

- This skill is read-only.
- For claim/withdraw/deposit transactions, generate a plan only and hand off to the official `pharos-skill-engine` write flow.
