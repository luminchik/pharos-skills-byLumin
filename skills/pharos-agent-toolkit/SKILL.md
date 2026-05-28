---
name: pharos-agent-toolkit
description: >
  Cross-platform Pharos Agent Center skill for AI agents that need safer, more autonomous Pharos onchain workflows. Use for Pharos environment diagnostics, Foundry/cast setup checks, RPC chain-id validation, wallet portfolio summaries across known Pharos tokens, multi-wallet balance reports, ERC20 allowance audits, approval risk checks, revoke-command generation, NFT ownership checks, ERC721/ERC1155 balance checks, tokenURI/metadata lookup, transaction debugging, receipt/status inspection, calldata selector lookup, event topic summaries, and preflight planning for Pharos mainnet or Atlantic testnet. Invoke when the user mentions Pharos debugging, tx debug, transaction status, portfolio report, multiple wallets, allowance, approval, revoke, spender risk, NFT ownership, ERC721, ERC1155, tokenURI, metadata, setup doctor, cast/forge health, PHRS, PROS, Atlantic testnet, or Pharos mainnet.
---

# Pharos Agent Toolkit

Portable skill for Pharos Agent Center style agents. It complements the official `pharos-skill-engine` with cross-platform diagnostics, transaction debugging, ERC20 allowance auditing, NFT ownership checks, and multi-wallet portfolio reporting.

Required binary: Foundry `cast`. Optional binaries: `forge` for deploy-oriented follow-up tasks, `bash` for Unix-style setup commands.

## Design Rules

- Use Foundry `cast` for chain reads. Do not use raw JSON-RPC unless the user explicitly asks for fallback diagnostics.
- Read network and token data from `assets/networks.json` and `assets/tokens.json`.
- Default network is `atlantic-testnet`; support `mainnet` only when requested or when auto-detecting a transaction.
- Never print private keys. The doctor may detect `PRIVATE_KEY` or standard local key files only to derive the public signer address.
- Be OS-aware. On Windows, PowerShell commands use `$env:PRIVATE_KEY`; on bash/zsh, use `$PRIVATE_KEY`.

## Capability Index

| User need | Use | Details |
| --- | --- | --- |
| Check whether Pharos tooling works | `node scripts/pharos-doctor.mjs` | See `references/doctor.md` |
| Check one wallet portfolio | `node scripts/portfolio.mjs <address> --network <network-or-all>` | See `references/portfolio.md` |
| Check many wallets from CSV/TXT | `node scripts/portfolio.mjs --input wallets.csv --network <network-or-all>` | See `references/portfolio.md` |
| Audit ERC20 allowances for known spenders | `node scripts/allowance-audit.mjs --owner <wallet> --spender <spender> --network <network> --token all` | See `references/allowance.md` |
| Generate ERC20 revoke commands | `node scripts/allowance-audit.mjs --owner <wallet> --spender-file spenders.csv --network <network>` | See `references/allowance.md` |
| Check NFT ownership and token URI | `node scripts/nft-check.mjs --contract <nft> --owner <wallet> --token-id <id> --network <network>` | See `references/nft.md` |
| Check ERC721/ERC1155 metadata | `node scripts/nft-check.mjs --contract <nft> --owner <wallet> --token-id <id> --fetch-metadata` | See `references/nft.md` |
| Debug a transaction hash | `node scripts/tx-debug.mjs <tx_hash> --network <network-or-all>` | See `references/tx-debug.md` |
| Decode common selector/event topic | Use `assets/selectors.json` plus tx debugger output | See `references/tx-debug.md` |

## Quick Commands

Run from the skill folder:

```bash
node scripts/pharos-doctor.mjs
node scripts/portfolio.mjs 0x13e272ed4a94105b1fab86ca878f6d049355c978 --network all
node scripts/allowance-audit.mjs --owner 0x13e272ed4a94105b1fab86ca878f6d049355c978 --spender <spender> --network mainnet --token all
node scripts/nft-check.mjs --contract <nft> --owner 0x13e272ed4a94105b1fab86ca878f6d049355c978 --token-id 1 --network mainnet
node scripts/tx-debug.mjs <tx_hash> --network all
```

PowerShell works too:

```powershell
node .\scripts\pharos-doctor.mjs
node .\scripts\portfolio.mjs 0x13e272ed4a94105b1fab86ca878f6d049355c978 --network all
node .\scripts\allowance-audit.mjs --owner 0x13e272ed4a94105b1fab86ca878f6d049355c978 --spender <spender> --network mainnet --token all
node .\scripts\nft-check.mjs --contract <nft> --owner 0x13e272ed4a94105b1fab86ca878f6d049355c978 --token-id 1 --network mainnet
node .\scripts\tx-debug.mjs <tx_hash> --network all
```

## Output Rules

- Summarize results in Markdown tables when answering the user.
- Include explorer links for wallets and transactions.
- Filter zero ERC20 balances by default, but mention when zero balances were hidden.
- If `cast` is missing, run the doctor workflow and show OS-specific installation guidance instead of attempting the requested chain query.
- If a transaction is not found on the selected network, try the other configured network when `--network all` is appropriate.
- For allowance audits, explain that spender discovery requires a provided spender list or indexer; plain RPC can only query known owner/spender pairs.
- For NFT checks, auto-detect ERC721/ERC1155 with ERC165 first; if detection fails, ask whether to retry with `--standard erc721` or `--standard erc1155`.

## Safety

- Treat Pharos mainnet as production.
- Keep this skill read-only unless the user explicitly asks for a write operation.
- Allowance audit may print revoke commands, but must not execute them automatically.
- For writes, hand off to the official `pharos-skill-engine` transfer/deploy workflow or add a separate write-specific reference with confirmation, simulation, balance, and gas checks.
