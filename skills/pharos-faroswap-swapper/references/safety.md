# Faroswap Safety

- Faroswap is on Pharos mainnet. Treat every broadcast as production.
- Always quote first, save a plan, and review target, calldata, value, approval spender, amount in, estimated amount out, and minimum return.
- Execute only with `--broadcast --confirm CONFIRM_MAINNET_SWAP`, or omit `--confirm` only when a user-configured local policy matches signer, action, token, and amount.
- Refresh the plan if it is older than 10 minutes.
- Approve only the exact input amount returned in the plan unless the user explicitly asks otherwise.
- If an ERC20 allowance is non-zero and not exactly equal to the required amount, reset allowance to zero before approving the exact amount. Use `--keep-existing-allowance` only when the user explicitly accepts a larger existing allowance.
- Never print private keys. `faroswap-execute.mjs` tries `--private-key-file`, `PRIVATE_KEY`, `PHAROS_PRIVATE_KEY_FILE`, `~/.codex/secrets/pharos_private_key.txt`, then `~/.pharos/private_key`.
- Never retry broadcasts automatically. If a swap or approval fails, inspect the receipt/revert before trying again.
- Never create or relax an auto-confirm policy unless the user explicitly asks for it.
