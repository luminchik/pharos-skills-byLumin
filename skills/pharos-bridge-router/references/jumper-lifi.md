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

## Discovery

Use `bridge-discover.mjs` before promising broad route support. It checks LI.FI `/connections`
for live source/destination support and can optionally run read-only `/quote` smoke tests.

```bash
node scripts/bridge-discover.mjs --from pharos --quotes none --output out/pharos-lifi-connections.json
node scripts/bridge-discover.mjs --from pharos --quotes usdc --address 0xYourWallet --delay-ms 1500 --output out/pharos-lifi-usdc-quotes.json
```

Interpret results carefully:

- `/connections` means LI.FI currently reports a possible path between the chains.
- `/quote` success means the specific token pair, amount, and address produced executable transaction data.
- `/quote` failure can be amount-, liquidity-, token-, or rate-limit-specific. Retry with a larger amount, a different token, or an API key before declaring a chain unsupported.
- Public LI.FI quota is limited. If available, set `LIFI_API_KEY` or `LI_FI_API_KEY`.

For full route viability checks, use the resumable quote matrix:

```bash
node scripts/bridge-quote-matrix.mjs --address 0xYourWallet --direction both --output out/pharos-quote-matrix.json --max-tests 25 --delay-ms 1500
```

Rerun the same command until `Pending` is zero. The matrix tests practical token-pair candidates
such as USDC, USDCe, WETH, LINK, PROS, and WPROS. Add `--include-fallback-swaps` to test
native/USDC cross-chain swap fallbacks after same-token bridge checks.

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
- `bridge-discover.mjs` defaults to EVM mainnets because this skill's execution path uses EVM addresses and Foundry `cast`. Non-EVM destinations need chain-specific recipient address validation before execution support.
