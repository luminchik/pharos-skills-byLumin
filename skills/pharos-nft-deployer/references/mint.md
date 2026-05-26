# NFT Mint Workflow

Use this workflow after an NFT contract has been deployed.

## ERC721 Mint

Generate the mint command:

```bash
node scripts/nft-mint-command.mjs \
  --standard erc721 \
  --contract <deployed_contract> \
  --to <recipient> \
  --network atlantic-testnet
```

The command calls:

```solidity
mint(address to)
```

Only the contract owner can mint.

For image-backed ERC721 minting, first prepare metadata and set baseURI. See `references/metadata.md`.

## ERC1155 Mint

Generate the mint command:

```bash
node scripts/nft-mint-command.mjs \
  --standard erc1155 \
  --contract <deployed_contract> \
  --to <recipient> \
  --token-id 1 \
  --amount 10 \
  --network atlantic-testnet
```

The command calls:

```solidity
mint(address to, uint256 id, uint256 amount)
```

## Safety

The script prints commands only. Before running the command:

1. Confirm network.
2. Confirm contract address.
3. Confirm recipient.
4. Confirm `PRIVATE_KEY` belongs to the collection owner.
