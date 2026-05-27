---
name: pharos-bridge-router
description: >
  Portable Pharos Agent Center skill for cross-chain bridge workflows through Jumper/LI.FI and Transporter/Chainlink CCIP. Use when the user asks to bridge from Pharos mainnet to another EVM chain, bridge back to Pharos, quote bridge routes, compare supported destination chains or tokens, build a safe bridge transaction plan, execute a saved bridge plan with Foundry cast, track Jumper transaction status, track Transporter CCIP message status, inspect CCIP message IDs, or diagnose Pharos bridge provider support. Supports Pharos mainnet chainId 1672, PROS, USDC, LINK, WETH, WPROS, Base, Arbitrum, Ethereum, Optimism, Polygon, BSC, Avalanche, and any LI.FI-supported chain ID.
---

# Pharos Bridge Router

Portable bridge skill for Pharos mainnet. It supports two provider families:

- Jumper/LI.FI for live route discovery, quote generation, transaction plans, and status tracking.
- Transporter/Chainlink CCIP for CCIP message status tracking and Pharos router diagnostics.

Required binaries: Node.js. Required for execution: Foundry `cast`. Read-only quote/status tasks do not need a private key.

## Core Rules

- Default source chain is Pharos mainnet (`1672`) only when the user clearly asks for Pharos bridging.
- Never broadcast directly from a quote. Save a plan first, then execute the saved plan.
- Mainnet bridge execution requires `--broadcast --confirm CONFIRM_MAINNET_BRIDGE`.
- Never print or store private keys. Execution reads `PRIVATE_KEY` from the local environment.
- Refresh quotes before execution if the saved plan is older than 10 minutes.
- For ERC20 routes, approve only the exact quoted amount unless the user explicitly asks for another allowance.
- Treat Transporter as CCIP-backed. Use Chainlink CCIP message status for tracking.
- Do not use hidden frontend endpoints for bridge execution. Use documented/provider APIs and onchain calls.

## Capability Index

| User need | Use | Details |
| --- | --- | --- |
| Quote Pharos to another chain with Jumper | `node scripts/bridge-quote.mjs --from pharos --to base --from-token PROS --to-token PROS --amount 0.01 --address <wallet>` | See `references/jumper-lifi.md` |
| Quote another chain back to Pharos | `node scripts/bridge-quote.mjs --from base --to pharos --from-token ETH --to-token PROS --amount 0.001 --address <wallet>` | See `references/jumper-lifi.md` |
| Save a bridge execution plan | Add `--output plan.json` to `bridge-quote.mjs` | See `references/safety.md` |
| Execute a saved Jumper plan | `node scripts/bridge-execute.mjs --plan plan.json --broadcast --confirm CONFIRM_MAINNET_BRIDGE` | See `references/safety.md` |
| Track a Jumper transaction | `node scripts/bridge-status.mjs --provider lifi --tx <source_tx> --from-chain pharos --to-chain base` | See `references/jumper-lifi.md` |
| Track a Transporter CCIP message | `node scripts/bridge-status.mjs --provider ccip --message-id <message_id>` | See `references/transporter-ccip.md` |
| Generate Jumper or Transporter app links | `node scripts/bridge-link.mjs --provider transporter --from pharos --to base` | See provider references |
| Diagnose bridge provider support | `node scripts/bridge-doctor.mjs` | See `references/transporter-ccip.md` |

## Quick Commands

Quote Pharos PROS to Base PROS using Jumper/LI.FI:

```bash
node scripts/bridge-quote.mjs --from pharos --to base --from-token PROS --to-token PROS --amount 0.01 --address 0xYourWallet --output plan.json
```

Track a Jumper transaction:

```bash
node scripts/bridge-status.mjs --provider lifi --tx 0x9bfdf2d70dacf196ab6eab9812c2e0832ba73b1ae3d25976b79cb797d2dd3586 --from-chain pharos --to-chain base
```

Track a Transporter/CCIP message:

```bash
node scripts/bridge-status.mjs --provider ccip --message-id 0xc6a25437cd4beaf97627465257d1641dcccd6ce7e78e8dcac9fef130021c8325
```

Execute a saved plan after review:

```bash
node scripts/bridge-execute.mjs --plan plan.json --broadcast --confirm CONFIRM_MAINNET_BRIDGE
```

## Output Rules

- Show source chain, destination chain, source token, destination token, amount, provider, tool, estimated output, fees when available, transaction target, value, gas limit, and approval address.
- Include status links for Jumper and CCIP when possible.
- For quotes, show command previews instead of broadcasting.
- For status, show send tx, receive tx, status, substatus/message, and explorer links.
- When provider support is missing, say which provider failed and suggest the next provider.

## Safety

- This skill may build write transactions, but broadcast is disabled unless the user explicitly asks and provides the exact confirmation.
- If `PRIVATE_KEY` is missing, stop before execution and show how to set it.
- If chain ID returned by RPC does not match the saved plan, stop.
- If an approval transaction is required, execute it before the bridge transaction and show the approval tx hash.
- Do not retry bridge broadcasts automatically.
