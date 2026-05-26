# Verification Workflow

Use this after deployment when the user wants source verification on Pharos explorer.

## Inputs Needed

- Network.
- Deployed contract address.
- Generated Foundry workspace path.
- Contract type: `PharosERC721` or `PharosERC1155`.
- Constructor arguments used at deploy time.

## Command Shape

ERC721:

```bash
forge verify-contract <contract_address> src/PharosERC721.sol:PharosERC721 \
  --root <workspace> \
  --chain-id <chain_id> \
  --verifier blockscout \
  --verifier-url <explorer_api_url> \
  --constructor-args $(cast abi-encode "constructor(string,string,string,string,uint256,address)" "<name>" "<symbol>" "<baseURI>" "<contractURI>" <maxSupply> <owner>)
```

ERC1155:

```bash
forge verify-contract <contract_address> src/PharosERC1155.sol:PharosERC1155 \
  --root <workspace> \
  --chain-id <chain_id> \
  --verifier blockscout \
  --verifier-url <explorer_api_url> \
  --constructor-args $(cast abi-encode "constructor(string,string,string,string,address)" "<name>" "<symbol>" "<uri>" "<contractURI>" <owner>)
```

Wait about 10 seconds after deployment before verifying to give the explorer indexer time to ingest the transaction.
