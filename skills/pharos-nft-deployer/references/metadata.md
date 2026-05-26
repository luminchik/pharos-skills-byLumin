# NFT Image and Metadata Workflow

Use this when a user provides an image or asks to add an image to an ERC721 collection.

## Workflow

1. Obtain a local image path or an existing image URI (`ipfs://`, `ar://`, `https://`).
2. Generate token metadata:

```bash
node scripts/nft-metadata.mjs \
  --image ./art.png \
  --token-id 1 \
  --name "Collection #1" \
  --description "NFT minted through a Pharos skill"
```

3. Upload the generated folder to IPFS or Arweave. The folder contains both `<token-id>` and `<token-id>.json`; the extensionless file is required because the bundled ERC721 template returns `baseURI + tokenId`.

```bash
node scripts/nft-ipfs-upload.mjs --dir ./metadata --allow-public-upload
```

4. Use the folder URI as the contract base URI:

```bash
node scripts/nft-erc721-write.mjs \
  --contract 0xYourCollection \
  --set-base-uri ipfs://METADATA_FOLDER_CID/ \
  --mint-to 0xRecipient \
  --network mainnet
```

5. Add `--broadcast --confirm CONFIRM_MAINNET_NFT_WRITE` only after the user explicitly confirms mainnet writes.

## Existing Image URI

If the image is already uploaded:

```bash
node scripts/nft-metadata.mjs \
  --image ipfs://IMAGE_CID \
  --token-id 1 \
  --name "Collection #1" \
  --metadata-base-uri ipfs://METADATA_FOLDER_CID/ \
  --contract 0xYourCollection \
  --to 0xRecipient \
  --network mainnet
```

## Local Image

If the user sends an image file and no upload tool is available, generate a portable bundle:

```bash
node scripts/nft-metadata.mjs --image ./user-image.png --token-id 1 --name "NFT #1"
```

The output folder can be uploaded as-is. The metadata image field will be relative (`images/user-image.png`) unless `--image-uri` or `--image-base-uri` is provided.

## IPFS Upload

`nft-ipfs-upload.mjs` uploads all files in a metadata directory to an IPFS RPC `/api/v0/add` endpoint using `wrap-with-directory=true&pin=true`.

The script requires:

```text
--allow-public-upload
```

Use a custom endpoint when the user provides one:

```bash
node scripts/nft-ipfs-upload.mjs --dir ./metadata --endpoint https://your-ipfs-rpc.example/api/v0/add --allow-public-upload
```

## Write Safety

`nft-erc721-write.mjs` checks:

- RPC chain ID.
- `PRIVATE_KEY` signer address.
- native balance.
- contract code exists.
- signer is `owner()` of the ERC721 contract.

Mainnet requires:

```text
CONFIRM_MAINNET_NFT_WRITE
```

Testnet requires:

```text
CONFIRM_TESTNET_NFT_WRITE
```
