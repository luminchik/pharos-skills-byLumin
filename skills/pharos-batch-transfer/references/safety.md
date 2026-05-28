# Safety Checklist

Run these checks before any broadcast:

1. Run `node scripts/batch-plan.mjs ...` and inspect network, recipient count, total amount, and command preview.
2. Confirm a private key source exists without printing it. Scripts try `--private-key-file`, `PRIVATE_KEY`, `PHAROS_PRIVATE_KEY_FILE`, `~/.codex/secrets/pharos_private_key.txt`, then `~/.pharos/private_key`.
3. Confirm the signer address with `cast wallet address --private-key <redacted>`.
4. Confirm RPC chain id with `cast chain-id --rpc-url <rpc>`.
5. Confirm the signer balance is greater than the native transfer total plus gas.
6. Confirm the exact confirmation flag:
   - Mainnet transfer: `CONFIRM_MAINNET_BATCH_TRANSFER`
   - Testnet transfer: `CONFIRM_TESTNET_BATCH_TRANSFER`
   - Mainnet distributor deploy: `CONFIRM_MAINNET_BATCH_DEPLOY`
   - Testnet distributor deploy: `CONFIRM_TESTNET_BATCH_DEPLOY`

Broadcast examples:

```bash
node scripts/batch-transfer.mjs --asset native --mode distributor --distributor 0x78699D58e05Daa04240011af64FC3620b2A33412 --amount 0.05 --input recipients.csv --network mainnet --broadcast --confirm CONFIRM_MAINNET_BATCH_TRANSFER
```

```bash
node scripts/batch-distributor-deploy.mjs --network mainnet --broadcast --confirm CONFIRM_MAINNET_BATCH_DEPLOY
```

Never paste a private key into chat or logs. Prefer the local secret file at `~/.codex/secrets/pharos_private_key.txt`.
