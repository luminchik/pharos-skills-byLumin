# Pharos Agent Center Skills

Portable Pharos skills for AI agents that need useful onchain and developer workflows on Pharos mainnet and Pharos Atlantic testnet.

This repository follows the skill layout used by agent runtimes:

```text
skills/
  pharos-agent-toolkit/
    SKILL.md
    assets/
    references/
    scripts/
```

Each skill is self-contained. The `SKILL.md` file describes when the agent should use the skill, and the bundled scripts/assets provide deterministic commands instead of fragile prompt-only instructions.

This repository does not vendor the official `pharos-skill-engine`; it uses that project as the compatibility reference and adds separate contest skills around it.

## Skills

| Skill | Purpose | Private key required |
| --- | --- | --- |
| `pharos-agent-toolkit` | Environment doctor, wallet portfolio summaries, ERC20 allowance audits, NFT ownership checks, transaction debugging, selector/event summaries | No for reads |
| `pharos-nft-deployer` | ERC721/ERC1155 deployment, image-to-metadata preparation, IPFS metadata upload helper, baseURI/mint command generation | Only for broadcast |
| `pharos-batch-transfer` | Native/ERC20 batch transfers, airdrops, distributor deployment, `batchTransferUniform(address[],uint256)` workflows | Only for broadcast |
| `pharos-bridge-router` | Jumper/LI.FI bridge quotes, saved bridge plans, dry-run execution, Jumper status, Transporter/CCIP status, bridge app links | Only for broadcast |
| `pharos-faroswap-swapper` | Faroswap/DODO quotes, saved swap plans, PROS/WPROS/USDC swaps, wrapping/unwrapping, Faroswap tx decoding | Only for broadcast |
| `pharos-defi-position-checker` | Native/token/LP/staking/vault/RealFi-style position reports using registry files | No |
| `pharos-tx-history-summarizer` | Wallet transaction history, gas, success/failure, counterparties, latest activity via public explorer APIs | No |

## Requirements

- Node.js 18+
- Foundry `cast` for read/write chain commands
- Foundry `forge` for contract deployment skills
- A local private key source only when broadcasting transactions
- Optional `LIFI_API_KEY` or `LI_FI_API_KEY` for higher LI.FI/Jumper route-discovery and quote limits
- Optional `FAROSWAP_API_KEY` to override the public Faroswap widget quote key

Read-only skills do not need a private key. Write-capable skills require explicit mainnet/testnet confirmation strings before broadcasting.

## Mainnet Auto-Confirm Policy

By default, write-capable skills stop before Pharos mainnet broadcasts unless the exact confirmation string is present. Users can explicitly create a local, time-limited policy that lets allowed scripts omit repeated `CONFIRM_MAINNET_*` strings while still requiring `--broadcast` and enforcing signer/amount limits.

Create a cautious one-hour policy for small bridge and swap tests:

```powershell
node .\skills\pharos-agent-toolkit\scripts\pharos-policy.mjs --enable --actions bridge,swap --signer 0xYourWallet --expires-minutes 60 --max-bridge-usdc 0.10 --bridge-to 8453 --max-swap-pros 0.01 --max-swap-usdc 1
```

Show or disable it:

```powershell
node .\skills\pharos-agent-toolkit\scripts\pharos-policy.mjs --show
node .\skills\pharos-agent-toolkit\scripts\pharos-policy.mjs --disable
```

The default path is `~/.codex/secrets/pharos_policy.json`; it is local and should not be committed.

Permanent local policy is also supported when the user explicitly accepts persistent mainnet access. It still enforces signer/action/amount/route limits and scripts still require `--broadcast`:

```powershell
node .\skills\pharos-agent-toolkit\scripts\pharos-policy.mjs --enable --permanent --actions bridge,swap --signer 0xYourWallet --max-bridge-usdc 0.10 --bridge-to 8453 --max-swap-pros 0.01 --max-swap-usdc 1
```

Power-user mode is a local opt-in for permanent mainnet access with unlimited token amounts. It is never the repository default, but an agent can configure it after the user explicitly asks:

```powershell
node .\skills\pharos-agent-toolkit\scripts\pharos-policy.mjs --enable --power-user --signer 0xYourWallet
```

Even in power-user mode, write scripts still require `--broadcast`, signer checks, and valid saved plans.

## Private Key Setup

Write-capable scripts auto-discover keys in this order:

1. `--private-key-file <path>` when the script supports it
2. `PRIVATE_KEY`
3. `PHAROS_PRIVATE_KEY_FILE`
4. `~/.codex/secrets/pharos_private_key.txt`
5. `~/.pharos/private_key`

If no key is found, the scripts stop before broadcast and print setup steps. They never print the key.

Cross-agent local setup, recommended for Codex, Claude Code, and OpenClaw:

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.pharos" | Out-Null
Set-Content -NoNewline -Path "$env:USERPROFILE\.pharos\private_key" -Value "0xYOUR_PRIVATE_KEY"
```

macOS/Linux:

```bash
mkdir -p ~/.pharos
printf "0xYOUR_PRIVATE_KEY" > ~/.pharos/private_key
chmod 600 ~/.pharos/private_key
```

Codex-specific local setup is also supported:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\secrets" | Out-Null
Set-Content -NoNewline -Path "$env:USERPROFILE\.codex\secrets\pharos_private_key.txt" -Value "0xYOUR_PRIVATE_KEY"
```

macOS/Linux:

```bash
mkdir -p ~/.codex/secrets
printf "0xYOUR_PRIVATE_KEY" > ~/.codex/secrets/pharos_private_key.txt
chmod 600 ~/.codex/secrets/pharos_private_key.txt
```

## Install

Windows PowerShell:

```powershell
.\scripts\install-skills.ps1 -Target codex
.\scripts\install-skills.ps1 -Target claude
.\scripts\install-skills.ps1 -Target openclaw
```

Unix-like shells:

```bash
./scripts/install-skills.sh codex
./scripts/install-skills.sh claude
./scripts/install-skills.sh openclaw
```

Install to all supported local agent skill folders:

```powershell
.\scripts\install-skills.ps1 -Target all
```

```bash
./scripts/install-skills.sh all
```

Backward-compatible Codex shortcuts are still available:

```powershell
.\scripts\install-codex.ps1
```

```bash
./scripts/install-codex.sh
```

Manual install:

```text
copy skills/<skill-name> to:
  Codex:       ~/.codex/skills/<skill-name>
  Claude Code: ~/.claude/skills/<skill-name>
  OpenClaw:    ~/.openclaw/skills/<skill-name>
```

## Update Installed Skills

Skills are local files; agent runtimes do not auto-pull this GitHub repository. To update after the repo changes:

```powershell
git pull
.\scripts\install-skills.ps1 -Target codex
```

Replace `codex` with `claude`, `openclaw`, or `all` for other runtimes. Then restart the agent or refresh its skill list.

## Validate

```powershell
.\scripts\validate-skills.ps1
```

The validator checks that every skill has a matching folder/name, a `SKILL.md`, frontmatter metadata, and valid JavaScript syntax for bundled `.mjs` scripts when Node.js is available.
It also runs help smoke tests for supported scripts, checks shared asset drift, and scans for the local private key value if one is configured.

Shared Pharos network/token assets live under `shared/assets/` and are copied into each portable skill folder. If validation reports asset drift, run:

```powershell
.\scripts\sync-shared-assets.ps1
```

## Safety Model

- Never store or print private keys.
- Default to Pharos Atlantic testnet when a write workflow is ambiguous.
- Treat Pharos mainnet as production.
- Verify RPC chain IDs before writes.
- Run dry-run planning before batch transfers or deployments.
- Use public RPC/explorer endpoints; no private node dependency is required.
- Stop before broadcast unless the exact confirmation string is present.

## Contest Fit

These skills are built for the Pharos Agent Center skill builder campaign: each skill helps an AI agent perform a concrete onchain or developer-related action while staying portable across agent hosts.

The repository covers several suggested categories:

- Wallet portfolio summary
- NFT ownership checker and NFT creator
- Batch transfer skill
- Cross-chain bridge skill
- Smart contract interaction and swap helper
- DeFi position checker
- Testnet/mainnet activity helper
- Onchain analytics skill
- Developer debugging skill
- Multi-wallet asset aggregation
