# NFT Deploy Workflow

Use this workflow when the user asks to create or deploy an NFT collection on Pharos.

## ERC721

Prepare and compile a deployment workspace:

```bash
node scripts/nft-deploy.mjs \
  --standard erc721 \
  --name "Demo NFT" \
  --symbol DNFT \
  --base-uri "ipfs://CID/" \
  --contract-uri "ipfs://CID/collection.json" \
  --max-supply 10000 \
  --owner 0xYourOwner \
  --network atlantic-testnet
```

Constructor:

```solidity
constructor(
  string name,
  string symbol,
  string baseURI,
  string contractURI,
  uint256 maxSupply,
  address initialOwner
)
```

`maxSupply = 0` means unlimited.

## ERC1155

Prepare and compile:

```bash
node scripts/nft-deploy.mjs \
  --standard erc1155 \
  --name "Demo Items" \
  --symbol DITEM \
  --uri "ipfs://CID/{id}.json" \
  --contract-uri "ipfs://CID/collection.json" \
  --owner 0xYourOwner \
  --network atlantic-testnet
```

Constructor:

```solidity
constructor(
  string name,
  string symbol,
  string uri,
  string contractURI,
  address initialOwner
)
```

## Broadcast

Use a local private key source, never chat. The scripts try `--private-key-file`, `PRIVATE_KEY`, `PHAROS_PRIVATE_KEY_FILE`, `~/.codex/secrets/pharos_private_key.txt`, then `~/.pharos/private_key`.

Bash/zsh:

```bash
export PRIVATE_KEY=0x...
```

PowerShell:

```powershell
$env:PRIVATE_KEY="0x..."
```

Persistent local secret file:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\secrets" | Out-Null
Set-Content -NoNewline "$env:USERPROFILE\.codex\secrets\pharos_private_key.txt" "0xYOUR_PRIVATE_KEY"
```

```bash
mkdir -p ~/.codex/secrets
printf "0xYOUR_PRIVATE_KEY" > ~/.codex/secrets/pharos_private_key.txt
chmod 600 ~/.codex/secrets/pharos_private_key.txt
```

Then rerun with `--broadcast` and exact confirmation:

```bash
node scripts/nft-deploy.mjs ... --broadcast --confirm CONFIRM_TESTNET_DEPLOY
node scripts/nft-deploy.mjs ... --network mainnet --broadcast --confirm CONFIRM_MAINNET_DEPLOY
```

## Generated Workspace

By default the script creates a disposable workspace under the OS temp directory. Pass `--project <dir>` when the user wants a stable project path. The workspace contains:

```text
pharos-nft-deploy-workspace/
  foundry.toml
  src/
    PharosERC721.sol
    PharosERC1155.sol
  deployments/
    <standard>-<network>-deploy-calldata.txt
```

The deploy calldata file can be reused with `cast send --create`.
