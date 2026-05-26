# Transaction History Workflow

Use this workflow when the user asks for wallet activity, transaction history, gas spent, failed transaction counts, or latest transactions.

## Commands

Mainnet summary:

```bash
node scripts/tx-history.mjs <address> --network mainnet --pages 2 --latest 10
```

Atlantic testnet summary:

```bash
node scripts/tx-history.mjs <address> --network atlantic-testnet --pages 2
```

Both configured networks:

```bash
node scripts/tx-history.mjs <address> --network all --pages 1
```

## Parameters

- `--pages`: number of SocialScan pages to fetch. Each page currently returns 25 transactions. Default: `2`.
- `--latest`: number of latest transactions to show. Default: `10`.

## Agent Response

Lead with:

- Network.
- Transaction count fetched.
- Success/failed.
- Inbound/outbound.
- Native sent/received.
- Gas fees.
- Top activity types.
- Link to the address on the explorer.

Then include latest transactions when useful.

## Notes

This skill uses:

```text
<historyApiUrl>/address/<address>/transactions?page=<n>
```

If the API is unavailable, explain that explorer-backed history is temporarily unavailable and suggest using single-transaction debugging with `cast tx` / `cast receipt` as fallback.
