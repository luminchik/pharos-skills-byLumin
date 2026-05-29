---
name: pharos-batch-transfer
description: >
  Portable Pharos Agent Center skill for safe batch transfers and airdrops on Pharos Atlantic testnet or Pharos mainnet. Use when the user asks to batch transfer PHRS/PROS, send the same amount to many wallets, run airdrops from CSV/TXT input, interact with a batchTransferUniform(address[],uint256) distributor contract, deploy a disposable batch distributor, batch send ERC20 tokens, generate dry-run plans, estimate totals, validate recipient lists, chunk large transfers, resume direct transfers, or create explorer-linked transfer reports. Uses Foundry cast/forge, requires PRIVATE_KEY only for broadcast, and requires exact mainnet/testnet confirmations before writes.
---

# Pharos Batch Transfer

Portable Pharos skill for native and ERC20 batch transfer workflows. It complements the official `pharos-skill-engine` with deterministic validation, dry-run planning, distributor deployment, chunked execution, and transfer reports.

Required binaries: Foundry `cast` and `forge`. Required runtime: Node.js.

## Core Rules

- Read network/token data from `assets/networks.json` and `assets/tokens.json`.
- Default to `atlantic-testnet`; treat `mainnet` as production.
- Never print or store private keys. Broadcast commands auto-discover `--private-key-file`, `PRIVATE_KEY`, `PHAROS_PRIVATE_KEY_FILE`, `~/.codex/secrets/pharos_private_key.txt`, then `~/.pharos/private_key`.
- Always run a dry-run plan before broadcast.
- Mainnet writes require exact confirmation:
  - transfers: `CONFIRM_MAINNET_BATCH_TRANSFER`
  - distributor deploys: `CONFIRM_MAINNET_BATCH_DEPLOY`
- Testnet writes require:
  - transfers: `CONFIRM_TESTNET_BATCH_TRANSFER`
  - distributor deploys: `CONFIRM_TESTNET_BATCH_DEPLOY`
- Validate all recipient addresses, amounts, totals, chain id, signer balance, and token decimals before broadcast.
- Prefer distributor mode for large uniform transfers like `batchTransferUniform(address[],uint256)`.

## Capability Index

| User need | Use | Details |
| --- | --- | --- |
| Plan a native uniform batch | `node scripts/batch-plan.mjs --asset native --amount 0.05 --recipients <list> --network mainnet` | See `references/direct-mode.md` |
| Match the example function | `node scripts/batch-plan.mjs --mode distributor --distributor <addr> --amount 0.05 ...` | See `references/distributor-mode.md` |
| Execute a batch transfer | `node scripts/batch-transfer.mjs ... --broadcast --confirm <CONFIRM>` | See `references/safety.md` |
| Deploy a distributor | `node scripts/batch-distributor-deploy.mjs --network mainnet` | See `references/distributor-mode.md` |
| Batch ERC20 transfers | `node scripts/batch-plan.mjs --asset erc20 --token USDC ...` | See `references/direct-mode.md` |
| Read CSV/TXT input | Use `--input recipients.csv` | See `references/csv-format.md` |

## Quick Commands

Preview a native uniform transfer using an existing distributor:

```bash
node scripts/batch-plan.mjs --asset native --mode distributor --distributor 0x78699D58e05Daa04240011af64FC3620b2A33412 --amount 0.05 --recipients 0xRecipient1,0xRecipient2 --network mainnet
```

Broadcast after reviewing the plan:

```bash
node scripts/batch-transfer.mjs --asset native --mode distributor --distributor 0x78699D58e05Daa04240011af64FC3620b2A33412 --amount 0.05 --recipients 0xRecipient1,0xRecipient2 --network mainnet --broadcast --confirm CONFIRM_MAINNET_BATCH_TRANSFER
```

Deploy this skill's disposable distributor:

```bash
node scripts/batch-distributor-deploy.mjs --network mainnet --broadcast --confirm CONFIRM_MAINNET_BATCH_DEPLOY
```

## Output Rules

- Show network, chain id, asset, transfer mode, recipient count, total amount, chunk count, signer balance checks, and command previews.
- Include explorer links for broadcasts.
- Use `--json` when another agent/script needs a machine-readable batch plan and command previews.
- If a transfer cannot be safely executed, stop before sending and show the exact failed preflight check.
- For large lists, print a compact summary and write detailed progress/report files.

## Safety

- Do not broadcast without exact confirmation.
- Do not use direct JSON-RPC as a workaround; use Foundry `cast`/`forge`.
- Do not execute a distributor call unless contract code exists at the distributor address.
- For ERC20 distributor mode, approve only the exact total required for the planned batch.
