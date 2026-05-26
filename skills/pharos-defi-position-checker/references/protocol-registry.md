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
- Test on a wallet with known non-zero position before submitting.
- Keep protocol files conservative; wrong registry entries create misleading reports.
