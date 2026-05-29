# Protocol Registry Format

Use a JSON file to add verified Pharos protocol contracts without changing the skill.

## ERC20/LP/Vault Share Balance

```json
{
  "mainnet": [
    {
      "name": "Example LP",
      "type": "erc20-balance",
      "contract": "0x0000000000000000000000000000000000000000",
      "symbol": "LP-USDC-PROS",
      "decimals": 18,
      "category": "LP token"
    }
  ]
}
```

The script calls:

```solidity
balanceOf(address)(uint256)
```

Use this type for ERC20-style protocol balances such as AquaFlux P/AQ/S/RWA tokens, LP tokens, vault shares, or receipt tokens.

## ERC721 Position Balance

```json
{
  "mainnet": [
    {
      "name": "Example NFT Positions",
      "type": "erc721-balance",
      "contract": "0x0000000000000000000000000000000000000000",
      "symbol": "POSITION-NFT",
      "category": "liquidity NFT"
    }
  ]
}
```

The script calls:

```solidity
balanceOf(address)(uint256)
```

Use this type when a protocol position is an NFT but token enumeration or detailed decode is not verified.

## Faroswap/Uniswap V3 NFT Positions

```json
{
  "mainnet": [
    {
      "name": "Faroswap V3 Positions",
      "type": "uniswap-v3-position-manager",
      "contract": "0xc0479219f4FebA5A668cFF71BF96f4FFE124c3ab",
      "symbol": "FAROSWAP-V3-LP",
      "category": "concentrated liquidity NFT",
      "maxPositions": 25,
      "tokenMetadata": [
        {
          "symbol": "WPROS",
          "decimals": 18,
          "address": "0x52c48d4213107b20bc583832b0d951fb9ca8f0b0"
        }
      ]
    }
  ]
}
```

The script calls:

```solidity
balanceOf(address)(uint256)
tokenOfOwnerByIndex(address,uint256)(uint256)
positions(uint256)((uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128))
```

It reports NFT count plus decoded tokenIds with pair, fee tier, tick range, liquidity, and owed token balances.

## Staking Position

```json
{
  "mainnet": [
    {
      "name": "Example Staking",
      "type": "staking",
      "contract": "0x0000000000000000000000000000000000000000",
      "stakedFunction": "balanceOf(address)(uint256)",
      "rewardFunction": "earned(address)(uint256)",
      "symbol": "staked LP",
      "decimals": 18,
      "rewardSymbol": "REWARD",
      "rewardDecimals": 18
    }
  ]
}
```

If a protocol uses different read method names, put the full cast-compatible signature in `stakedFunction` or `rewardFunction`.

## Registry Hygiene

- Verify every contract address on the explorer.
- Verify decimals.
- Prefer a protocol frontend bundle or official docs only as a discovery source; confirm read methods with `cast call`.
- Test on a wallet with known non-zero position before submitting.
- Keep protocol files conservative; wrong registry entries create misleading reports.
