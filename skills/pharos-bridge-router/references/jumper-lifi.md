# Jumper / LI.FI

Use LI.FI for Jumper-backed execution because it exposes portable route, quote, and status APIs.

## Flow

1. Resolve source/destination chains with `assets/chains.json` and LI.FI `/chains`.
2. Resolve token symbols with LI.FI `/tokens?chains=<chainId>`.
3. Convert user amount to base units using the source token decimals.
4. Fetch `/quote` with `fromChain`, `toChain`, `fromToken`, `toToken`, `fromAmount`, `fromAddress`, `toAddress`, and `slippage`.
5. Save the returned `transactionRequest` to a plan file.
6. For ERC20 source tokens, approve `estimate.approvalAddress` for the exact `fromAmount`.
7. Broadcast the transaction request with `cast send <to> --data <data> --value <value>`.
8. Track source transaction with LI.FI `/status`.

## Status

`bridge-status.mjs --provider lifi` calls:

```text
https://li.quest/v1/status?txHash=<hash>&fromChain=<id>&toChain=<id>
```

Statuses include `DONE`, `PENDING`, `FAILED`, `NOT_FOUND`, and provider-specific substatus fields.

## Notes

- LI.FI can route through several underlying bridges. Print the returned `tool` and included steps.
- For symbol resolution, if a token is ambiguous, prefer the token returned first by LI.FI and print the address.
- For arbitrary chain IDs not in `assets/chains.json`, numeric chain IDs are accepted.

