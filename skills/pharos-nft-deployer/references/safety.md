# Deployment Safety

NFT deployment is a write operation.

## Required Checks

Before broadcast:

1. Confirm a private key source exists locally and never print it. Scripts try `--private-key-file`, `PRIVATE_KEY`, `PHAROS_PRIVATE_KEY_FILE`, `~/.codex/secrets/pharos_private_key.txt`, then `~/.pharos/private_key`.
2. Derive deployer address with `cast wallet address --private-key <redacted>`.
3. Verify RPC chain ID matches the configured network.
4. Confirm target network:
   - `atlantic-testnet` uses `PHRS`.
   - `mainnet` uses `PROS`.
5. Check deployer balance:

```bash
cast balance <deployer> --rpc-url <rpc> --ether
```

6. Build the contract with `forge build`.
7. Review generated constructor arguments.
8. Use exact confirmation:
   - `CONFIRM_TESTNET_DEPLOY`
   - `CONFIRM_MAINNET_DEPLOY`

## Mainnet Rules

For mainnet, show:

- Network: `mainnet`
- Chain ID: `1672`
- Native token: `PROS`
- Owner address
- Contract type
- Name and symbol
- Calldata file

Do not proceed if the user said `PHRS on mainnet`; clarify that mainnet native token is `PROS`.
