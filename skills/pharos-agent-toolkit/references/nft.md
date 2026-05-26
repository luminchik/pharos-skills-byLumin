# NFT Ownership Workflow

Use this workflow for NFT ownership checks, ERC721/ERC1155 balance checks, token URI lookup, and metadata inspection.

## Commands

Auto-detect ERC721 or ERC1155 using ERC165:

```bash
node scripts/nft-check.mjs --contract <nft_contract> --owner <wallet> --token-id <id> --network mainnet
```

Force a standard when a contract does not implement ERC165 correctly:

```bash
node scripts/nft-check.mjs --contract <nft_contract> --owner <wallet> --token-id <id> --standard erc721 --network atlantic-testnet
node scripts/nft-check.mjs --contract <nft_contract> --owner <wallet> --token-id <id> --standard erc1155 --network mainnet
```

Fetch metadata from `http(s)` or `ipfs://` token URIs:

```bash
node scripts/nft-check.mjs --contract <nft_contract> --owner <wallet> --token-id <id> --network mainnet --fetch-metadata
```

## What The Script Checks

- Confirms contract code exists at the NFT contract address.
- Uses `supportsInterface(bytes4)` for ERC721 (`0x80ac58cd`) and ERC1155 (`0xd9b67a26`).
- ERC721:
  - `balanceOf(address)`
  - `ownerOf(uint256)`
  - `tokenURI(uint256)`
- ERC1155:
  - `balanceOf(address,uint256)`
  - `uri(uint256)`
- Converts `ipfs://` metadata links to an HTTPS gateway for optional metadata fetches.

## Agent Response

Summarize:

- Network.
- Detected standard.
- Contract explorer link.
- Wallet.
- Token id.
- Ownership result.
- URI and metadata summary if available.

If standard detection fails, ask the user whether to retry with `--standard erc721` or `--standard erc1155`.
