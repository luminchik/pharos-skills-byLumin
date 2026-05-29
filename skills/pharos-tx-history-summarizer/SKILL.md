---
name: pharos-tx-history-summarizer
description: >
  Portable Pharos Agent Center skill for summarizing wallet transaction history on Pharos mainnet or Atlantic testnet. Use when the user asks for transaction history, activity summary, wallet activity report, gas spent, latest transactions, failed transaction count, top counterparties, native sent/received totals, method selector summaries, or explorer-backed address history for PHRS/PROS networks. Uses public Pharos explorer APIs and does not require a private key.
---

# Pharos Transaction History Summarizer

Summarize wallet transaction history using public Pharos explorer APIs. This skill complements `cast`-based transaction lookup by handling address-level history reports.

Required runtime: Node.js. No private key required.

## Capability Index

| User need | Use | Details |
| --- | --- | --- |
| Summarize wallet activity | `node scripts/tx-history.mjs <address> --network mainnet --pages 2` | See `references/history.md` |
| Compare mainnet and testnet activity | `node scripts/tx-history.mjs <address> --network all --pages 1` | See `references/history.md` |
| List latest transactions | `node scripts/tx-history.mjs <address> --latest 20` | See `references/history.md` |

## Quick Commands

```bash
node scripts/tx-history.mjs 0x13e272ed4a94105b1fab86ca878f6d049355c978 --network mainnet --pages 2 --latest 10
node scripts/tx-history.mjs 0x13e272ed4a94105b1fab86ca878f6d049355c978 --network all --pages 1
```

PowerShell uses the same Node commands:

```powershell
node .\scripts\tx-history.mjs 0x13e272ed4a94105b1fab86ca878f6d049355c978 --network mainnet --pages 2
```

## Output Rules

- Report network name and wallet explorer link.
- Show fetched transaction count, success/failed counts, inbound/outbound counts, native sent/received totals, and gas fees.
- Show top activity types and counterparties.
- Show latest transaction table with explorer links.
- Use `--json` when another agent/script needs machine-readable history data.
- If a selector is unknown, label it as `<selector> call` rather than guessing.

## Limitations

- Uses explorer API pagination; increase `--pages` for deeper history.
- Token-transfer-only history may require a future endpoint; this MVP summarizes transaction-level activity.
