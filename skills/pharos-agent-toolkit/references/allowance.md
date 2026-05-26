# Allowance Audit Workflow

Use this workflow for ERC20 approval checks, spender risk review, or revoke-command generation.

## Important Limitation

Plain RPC can query `allowance(owner, spender)` only when the spender is known. It cannot discover every historical spender without an indexer or event scan service. Ask the user for spender addresses, a spender CSV/TXT file, or a known protocol contract list.

## Commands

Audit all known tokens for one spender:

```bash
node scripts/allowance-audit.mjs --owner <wallet> --spender <spender> --network mainnet --token all
```

Audit USDC for several spenders:

```bash
node scripts/allowance-audit.mjs --owner <wallet> --spender <spender1>,<spender2> --network all --token USDC
```

Use a spender file:

```bash
node scripts/allowance-audit.mjs --owner <wallet> --spender-file spenders.csv --network mainnet --token all
```

## Output

The script reports:

- Token and network.
- Owner token balance.
- Spender address.
- Allowance.
- Risk label.
- Token explorer link.
- Suggested revoke commands for non-zero allowances.

## Risk Labels

- `zero`: no current allowance.
- `active`: non-zero allowance within current balance.
- `high: exceeds balance`: allowance is greater than current token balance.
- `critical: unlimited-like`: allowance is close to max `uint256`.

## Revoke Safety

The script does not execute revoke transactions. It prints commands only. Before executing any revoke:

1. Confirm target network.
2. Confirm token contract.
3. Confirm spender address.
4. Confirm `PRIVATE_KEY` belongs to the token owner.
5. Run through the official `pharos-skill-engine` write-operation confirmation flow.
