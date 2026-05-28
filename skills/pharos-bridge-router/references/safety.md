# Bridge Safety

Bridge writes are mainnet operations. Use this sequence:

1. Quote and save a plan with `bridge-quote.mjs --output plan.json`.
2. Review route, source chain, destination chain, token addresses, amounts, approval address, transaction target, calldata, and value.
3. Check that the plan is less than 10 minutes old.
4. Confirm a private key source exists without printing it. `bridge-execute.mjs` tries `--private-key-file`, `PRIVATE_KEY`, `PHAROS_PRIVATE_KEY_FILE`, `~/.codex/secrets/pharos_private_key.txt`, then `~/.pharos/private_key`.
5. Execute with `--broadcast --confirm CONFIRM_MAINNET_BRIDGE`.
6. Track the source transaction with `bridge-status.mjs`.

Never:

- Broadcast from an unsaved quote.
- Use unlimited approval by default.
- Retry a bridge transaction automatically.
- Print a private key.
- Execute hidden frontend API results unless the endpoint is documented or explicitly accepted by the user.
