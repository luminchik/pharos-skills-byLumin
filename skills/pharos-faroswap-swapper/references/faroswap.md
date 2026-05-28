# Faroswap Routing Notes

Faroswap currently embeds the DODO widget on Pharos mainnet. The frontend requests quotes from:

```text
https://api.dodoex.io/route-service/v2/widget/getdodoroute
```

The API returns the execution target, calldata, value, minimum return amount, approval spender, route info, and gas estimate when available. Use the returned transaction fields directly instead of reconstructing `mixSwap` calldata by hand.

## Required Quote Parameters

- `chainId=1672`
- `deadLine=<unix timestamp>`
- `apikey=<public Faroswap widget key or FAROSWAP_API_KEY>`
- `slippage=<percent, e.g. 0.5>`
- `source=dodoV2AndMixWasm` by default
- `fromTokenAddress=<token or native sentinel>`
- `toTokenAddress=<token or native sentinel>`
- `fromAmount=<base units>`
- `userAddr=<wallet or zero address>`
- `estimateGas=true|false`

For ERC20 input tokens, use `estimateGas=false` for quotes unless the wallet already has enough allowance; otherwise the quote can return `SafeERC20: low-level call failed` while simulating the swap. Execution estimates/broadcasts after approval.

## Supported Built-In Tokens

- `PROS`: native Pharos token, represented in the API by `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`.
- `WPROS`: `0x52C48d4213107b20bC583832b0d951FB9CA8F0B0`.
- `USDC`: `0xC879C018dB60520F4355C26eD1a6D572cdAC1815`.

The API can also quote direct PROS/WPROS wrapping. For native PROS input it returns a payable transaction with `value`. For WPROS to PROS it returns a WPROS `withdraw(uint256)` transaction.

## Example Transaction

The transaction `0x87a74a2dcc0328fb4ec471c2b2f5361c1ff110161ff55252525d2c383690f18e` calls Faroswap router `0xA5cA5Fbe34e444F366B373170541ec6902b0F75c` with selector `0xff84aafa`:

```text
mixSwap(address,address,uint256,uint256,uint256,address[],address[],address[],uint256,bytes[],bytes,uint256)
```

The decoded call swaps native PROS sentinel to USDC and emits:

```text
OrderHistory(address,address,address,uint256,uint256)
```
