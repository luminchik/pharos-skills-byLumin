# Portfolio Workflow

Use this workflow for wallet portfolio, balance summaries, multi-wallet checks, or CSV balance reports.

## Single Wallet

```bash
node scripts/portfolio.mjs <address> --network all
node scripts/portfolio.mjs <address> --network mainnet
node scripts/portfolio.mjs <address> --network atlantic-testnet --show-zero
```

The script:

1. Reads `assets/networks.json` and `assets/tokens.json`.
2. Runs `cast balance <address> --rpc-url <rpc> --ether`.
3. Runs `cast call <token> "balanceOf(address)(uint256)" <address> --rpc-url <rpc>` for known tokens.
4. Converts ERC20 raw balances using configured decimals.
5. Prints a Markdown report with explorer links.

## Multi-Wallet Input

Use a `.csv` or `.txt` file. The script accepts any line containing an EVM address.

```csv
address,label
0x13e272ed4a94105b1fab86ca878f6d049355c978,treasury
0x0000000000000000000000000000000000000000,empty
```

Run:

```bash
node scripts/portfolio.mjs --input wallets.csv --network all
```

## Agent Response

When answering the user, include:

- Network names.
- Non-zero assets.
- Hidden zero-balance note.
- Explorer links.

If the user requested a file report, redirect output to a Markdown file:

```bash
node scripts/portfolio.mjs --input wallets.csv --network all > pharos-portfolio-report.md
```
