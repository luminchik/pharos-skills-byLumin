# Direct Mode

Use direct mode for small batches where one transaction per recipient is acceptable.

Native transfer preview:

```bash
node scripts/batch-plan.mjs --asset native --mode direct --amount 0.01 --recipients 0x1111111111111111111111111111111111111111,0x2222222222222222222222222222222222222222 --network mainnet
```

ERC20 transfer preview:

```bash
node scripts/batch-plan.mjs --asset erc20 --mode direct --token USDC --amount 1 --input recipients.csv --network mainnet
```

Rules:

- Direct mode sends one `cast send` per recipient.
- Direct mode rejects `--chunk-size` values other than `1` so recipients cannot be skipped accidentally.
- Use distributor mode when the batch is larger than 10 recipients or when the user explicitly mentions `batchTransferUniform(address[],uint256)`.
- For ERC20 tokens, pass a known symbol from `assets/tokens.json` or a token contract address.
