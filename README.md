# Pharos Agent Center Skills by Lumin

Portable Pharos skills for AI agents.

This pack helps agents inspect wallets, summarize activity, check DeFi positions,
deploy NFTs, run batch transfers, quote Faroswap swaps, prepare bridge routes,
and debug Pharos transactions.

Built for the Pharos Agent Center Skill Builder Campaign and designed to work
with Codex, Claude Code, OpenClaw, and other runtimes that load `SKILL.md`
folders.

## What's Inside

| Skill | What it does |
| --- | --- |
| `pharos-agent-toolkit` | Wallet portfolio, allowance audits, NFT checks, tx debugging, Pharos setup doctor |
| `pharos-faroswap-swapper` | Faroswap quotes, safe swaps, buy target amount, wrap/unwrap PROS |
| `pharos-bridge-router` | Jumper/LI.FI bridge quotes, route discovery, safety checks, CCIP/Transporter status |
| `pharos-nft-deployer` | ERC721/ERC1155 deploy, image metadata, IPFS helper, mint/baseURI workflows |
| `pharos-batch-transfer` | Native/ERC20 batch sends, airdrops, distributor workflows |
| `pharos-defi-position-checker` | Token balances, Faroswap V3 LP NFTs, AquaFlux market positions |
| `pharos-tx-history-summarizer` | Explorer-backed wallet activity, gas, counterparties, latest tx summaries |

Each skill is self-contained:

```text
skills/<skill-name>/
  SKILL.md
  assets/
  references/
  scripts/
```

## Requirements

- Node.js 18+
- Foundry `cast`
- Foundry `forge` for NFT and contract deployment workflows
- Optional: `LIFI_API_KEY` or `LI_FI_API_KEY` for higher Jumper/LI.FI limits
- Optional: `FAROSWAP_API_KEY` for Faroswap quote API override

Read-only skills do not need a private key.

## Install

Clone the repo:

```bash
git clone https://github.com/luminchik/pharos-skills-byLumin.git
cd pharos-skills-byLumin
```

Install for your agent runtime.

Windows PowerShell:

```powershell
.\scripts\install-skills.ps1 -Target codex
.\scripts\install-skills.ps1 -Target claude
.\scripts\install-skills.ps1 -Target openclaw
.\scripts\install-skills.ps1 -Target all
```

macOS/Linux:

```bash
./scripts/install-skills.sh codex
./scripts/install-skills.sh claude
./scripts/install-skills.sh openclaw
./scripts/install-skills.sh all
```

Then restart the agent or refresh its skill list.

## Private Key

Only write actions need a private key: swaps, bridges, transfers, deployments,
or mints. Read-only reports work without one.

Skills auto-discover a key from:

1. `--private-key-file <path>`
2. `PRIVATE_KEY`
3. `PHAROS_PRIVATE_KEY_FILE`
4. `~/.codex/secrets/pharos_private_key.txt`
5. `~/.pharos/private_key`

Cross-agent setup:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.pharos" | Out-Null
Set-Content -NoNewline -Path "$env:USERPROFILE\.pharos\private_key" -Value "0xYOUR_PRIVATE_KEY"
```

```bash
mkdir -p ~/.pharos
printf "0xYOUR_PRIVATE_KEY" > ~/.pharos/private_key
chmod 600 ~/.pharos/private_key
```

The scripts never print private keys.

## Example Prompts

Use normal language. The agent should pick the right skill.

```text
Check my Pharos mainnet wallet portfolio.
Summarize this wallet's Pharos transaction history.
Show my Faroswap and AquaFlux DeFi positions.
Quote a Faroswap swap from PROS to USDC.
Buy 5 USDC with PROS through Faroswap.
Prepare a bridge plan from Pharos mainnet to Base for 0.01 USDC.
Create an ERC721 NFT collection on Pharos mainnet with this image.
Plan a batch transfer to these wallets.
Debug this Pharos transaction hash.
```

## Mainnet Safety

Mainnet writes require `--broadcast` and local safety checks.

By default, skills stop before risky broadcasts unless the user confirms.
For repeated tests, create a local policy:

```powershell
node .\skills\pharos-agent-toolkit\scripts\pharos-policy.mjs --enable --actions bridge,swap --signer 0xYourWallet --expires-minutes 60 --max-bridge-usdc 0.10 --bridge-to 8453 --max-swap-pros 0.01 --max-swap-usdc 1
```

Show or disable it:

```powershell
node .\skills\pharos-agent-toolkit\scripts\pharos-policy.mjs --show
node .\skills\pharos-agent-toolkit\scripts\pharos-policy.mjs --disable
```

Power-user mode is available, but it is local opt-in only:

```powershell
node .\skills\pharos-agent-toolkit\scripts\pharos-policy.mjs --enable --power-user --signer 0xYourWallet
```

## Update

Skills are local files. Agent runtimes do not auto-pull GitHub updates.

```powershell
git pull
.\scripts\install-skills.ps1 -Target all
```

```bash
git pull
./scripts/install-skills.sh all
```

Restart the agent or refresh skills after updating.

## Validate

```powershell
.\scripts\validate-skills.ps1
```

The validator checks skill metadata, JavaScript syntax, help smoke tests, shared
asset drift, and accidental private key leaks.

If shared assets drift:

```powershell
.\scripts\sync-shared-assets.ps1
```

## Safety Rules

- Never commit or print private keys.
- Prefer read-only checks before write actions.
- Verify Pharos chain IDs before broadcasts.
- Use exact approvals for ERC20 writes when possible.
- Keep saved plans for large or sensitive transactions.
- Treat Pharos mainnet as production.

## Contest Fit

This repo covers multiple Pharos Agent Center campaign categories:

- Wallet portfolio summary
- Transaction history summary
- DeFi position checker
- Pharos ecosystem asset tracker
- NFT creator
- Batch transfer skill
- Bridge skill
- Swap helper
- Developer debugging skill
