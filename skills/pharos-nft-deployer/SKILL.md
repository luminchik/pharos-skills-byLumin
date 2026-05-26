---
name: pharos-nft-deployer
description: >
  Portable Pharos Agent Center skill for creating and deploying NFT contracts on Pharos Atlantic testnet or Pharos mainnet. Use when the user asks to create an NFT, deploy an ERC721 collection, deploy an ERC1155 collection, turn an attached image into NFT metadata, generate image/token metadata bundles, set ERC721 baseURI/contractURI, mint an NFT with metadata, prepare NFT metadata/baseURI deployment, build a Foundry NFT deployment workspace, or produce safe cast-based deployment commands for PHRS/PROS networks. Supports self-contained ERC721/ERC1155 contracts, forge build checks, cast constructor encoding, mainnet/testnet safety confirmations, post-deploy metadata updates, and post-deploy mint command generation.
---

# Pharos NFT Deployer

Portable Pharos skill for deploying self-contained ERC721 and ERC1155 NFT contracts. It is intentionally separate from read-only Pharos analysis skills because deployment is a write operation with private-key and mainnet risk.

Required binaries: Foundry `forge` and `cast`. Required runtime: Node.js.

## Core Rules

- Default to `atlantic-testnet`.
- Treat `mainnet` as production and require explicit confirmation before broadcast.
- Never print or store private keys.
- When the user provides an image, first prepare metadata; do not claim the NFT has an image until token metadata is uploaded and `setBaseURI` plus mint are completed.
- Build first with `forge build`; do not broadcast until build succeeds.
- Before broadcast, verify RPC chain ID, derive the deployer, and check deployer native balance.
- By default, generate deploy calldata and commands only. Execute deployment only with `--broadcast` and exact `--confirm`.
- Use the self-contained contracts in `assets/contracts/` to avoid OpenZeppelin/remapping setup friction.
- Tell users these contracts are simple deployment templates; production collections should be reviewed before high-value launches.

## Capability Index

| User need | Use | Details |
| --- | --- | --- |
| Prepare ERC721 deployment | `node scripts/nft-deploy.mjs --standard erc721 ...` | See `references/deploy.md` |
| Prepare ERC1155 deployment | `node scripts/nft-deploy.mjs --standard erc1155 ...` | See `references/deploy.md` |
| Broadcast deployment | Add `--broadcast --confirm CONFIRM_TESTNET_DEPLOY` or `CONFIRM_MAINNET_DEPLOY` | See `references/safety.md` |
| Turn an image into NFT metadata | `node scripts/nft-metadata.mjs --image <path-or-uri> --token-id 1 ...` | See `references/metadata.md` |
| Upload metadata folder to IPFS RPC | `node scripts/nft-ipfs-upload.mjs --dir <metadata-dir> --allow-public-upload` | See `references/metadata.md` |
| Set ERC721 baseURI and mint | `node scripts/nft-erc721-write.mjs --contract <erc721> --set-base-uri <uri> --mint-to <wallet>` | See `references/metadata.md` |
| Generate mint command | `node scripts/nft-mint-command.mjs --standard <erc721|erc1155> ...` | See `references/mint.md` |
| Verify contract manually | Use generated project path plus `forge verify-contract` | See `references/verify.md` |

## Quick Commands

ERC721 build/prep, no broadcast:

```bash
node scripts/nft-deploy.mjs --standard erc721 --name "Demo NFT" --symbol DNFT --base-uri "ipfs://CID/" --owner 0xYourOwner --network atlantic-testnet
```

ERC1155 build/prep, no broadcast:

```bash
node scripts/nft-deploy.mjs --standard erc1155 --name "Demo Items" --symbol DITEM --uri "ipfs://CID/{id}.json" --owner 0xYourOwner --network atlantic-testnet
```

Broadcast to Atlantic testnet only after setting `PRIVATE_KEY`:

```bash
node scripts/nft-deploy.mjs --standard erc721 --name "Demo NFT" --symbol DNFT --base-uri "ipfs://CID/" --network atlantic-testnet --broadcast --confirm CONFIRM_TESTNET_DEPLOY
```

PowerShell uses the same Node commands; set private key with:

```powershell
$env:PRIVATE_KEY="0x..."
```

Image to ERC721 metadata bundle:

```bash
node scripts/nft-metadata.mjs --image ./art.png --token-id 1 --name "Demo NFT #1" --description "Demo NFT with image"
```

After uploading the metadata folder, set baseURI and mint:

```bash
node scripts/nft-erc721-write.mjs --contract 0xYourCollection --set-base-uri ipfs://METADATA_FOLDER_CID/ --mint-to 0xRecipient --network mainnet --broadcast --confirm CONFIRM_MAINNET_NFT_WRITE
```

## Output Rules

- Show the generated Foundry workspace path.
- Show network, chain ID, native token, owner, constructor signature, and calldata file.
- Show preview deploy commands for bash/zsh and PowerShell.
- If broadcast succeeds, show contract explorer link.
- If `PRIVATE_KEY` is missing or the deployer has zero native balance, stop before broadcast and explain the next step.
- For image workflows, show token metadata path, collection metadata path, image URI, and the exact `setBaseURI` value.
- For IPFS uploads, require `--allow-public-upload`, then show root CID, `ipfs://.../` baseURI, and gateway URL.

## Safety

- Do not execute deployment on mainnet without exact `--confirm CONFIRM_MAINNET_DEPLOY`.
- Do not auto-mint after deployment unless the user explicitly asks and confirms.
- Do not execute metadata or mint writes on mainnet without exact `--confirm CONFIRM_MAINNET_NFT_WRITE`.
- Do not upload user images to third-party pinning services unless the user explicitly asked to proceed, chose that service, or provided credentials.
- Do not accept private keys in chat; instruct the user to set `PRIVATE_KEY` locally.
