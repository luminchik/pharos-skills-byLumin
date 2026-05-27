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
| `pharos-defi-position-checker` | Native/token/LP/staking/vault/RealFi-style position reports using registry files | No |
| `pharos-tx-history-summarizer` | Wallet transaction history, gas, success/failure, counterparties, latest activity via public explorer APIs | No |

## Requirements

- Node.js 18+
- Foundry `cast` for read/write chain commands
- Foundry `forge` for contract deployment skills
- `PRIVATE_KEY` environment variable only when broadcasting transactions

Read-only skills do not need a private key. Write-capable skills require explicit mainnet/testnet confirmation strings before broadcasting.

## Install

Codex:

```powershell
.\scripts\install-codex.ps1
```

Unix-like runtimes:

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

## Validate

```powershell
.\scripts\validate-skills.ps1
```

The validator checks that every skill has a matching folder/name, a `SKILL.md`, frontmatter metadata, and valid JavaScript syntax for bundled `.mjs` scripts when Node.js is available.

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
- DeFi position checker
- Testnet/mainnet activity helper
- Onchain analytics skill
- Developer debugging skill
- Multi-wallet asset aggregation
