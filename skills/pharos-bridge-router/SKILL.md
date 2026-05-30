---
name: pharos-bridge-router
description: >
  Portable Pharos Agent Center skill for cross-chain bridge workflows through Jumper/LI.FI, Circle CCTP V2 native USDC, and Transporter/Chainlink CCIP. Use when the user asks to bridge from Pharos mainnet to another EVM chain, bridge back to Pharos, move native USDC with CCTP, quote bridge routes, compare supported destination chains or tokens, build a safe bridge transaction plan, run fast quote plus safety checks, execute saved or ephemeral bridge plans with Foundry cast, use local mainnet auto-confirm policy, track Jumper transaction status, track CCTP burn/mint attestation, track Transporter CCIP message status, inspect CCIP message IDs, or diagnose Pharos bridge provider support. Supports Pharos mainnet chainId 1672, PROS, USDC, LINK, WETH, WPROS, Base, Arbitrum, Ethereum, Optimism, Polygon, BSC, Avalanche, and any LI.FI-supported chain ID.
---

# Pharos Bridge Router

Portable bridge skill for Pharos mainnet. It supports two provider families:

- Jumper/LI.FI for live route discovery, quote generation, transaction plans, and status tracking.
- Circle CCTP V2 for native USDC burn/mint routes between Pharos and supported EVM domains. The built-in CCTP script is direct/self-mint mode; Interport-style CCTP uses the same Circle contracts but adds a relayer that submits the destination mint.
- Transporter/Chainlink CCIP for direct CCIP token-transfer tests, CCIP message status tracking, and Pharos router diagnostics.

Required binaries: Node.js. Required for execution: Foundry `cast`. Read-only quote/status tasks do not need a private key.

## Core Rules

- Default source chain is Pharos mainnet (`1672`) only when the user clearly asks for Pharos bridging.
- Use risk-tier planning:
  - Read-only quote/status/discovery: no saved plan is required.
  - Small bridge with local policy or explicit confirmation: `bridge-safe.mjs` may use an ephemeral plan.
  - Large amount, no policy, unknown route, or audit request: save a plan first, then execute the saved plan.
- Mainnet bridge execution requires `--broadcast --confirm CONFIRM_MAINNET_BRIDGE`.
- A matching local policy may replace the confirmation string only when the user explicitly configured it; scripts still require `--broadcast`.
- Never print or store private keys. Execution auto-discovers `--private-key-file`, `PRIVATE_KEY`, `PHAROS_PRIVATE_KEY_FILE`, `~/.codex/secrets/pharos_private_key.txt`, then `~/.pharos/private_key`.
- Refresh quotes before execution if the saved plan is older than 10 minutes.
- For ERC20 routes, approve only the exact quoted amount unless the user explicitly asks for another allowance.
- For direct CCTP, remember it is a two-step burn/mint flow; verify destination gas before burning unless the user explicitly accepts mint-later. If the user expects Interport-like UX, use Jumper/LI.FI or add an Interport relayed plan instead of raw direct CCTP.
- Treat Transporter as CCIP-backed. Use Chainlink CCIP message status for tracking.
- Do not use hidden frontend endpoints for bridge execution. Use documented/provider APIs and onchain calls.

## Capability Index

| User need | Use | Details |
| --- | --- | --- |
| Quote Pharos to another chain with Jumper | `node scripts/bridge-quote.mjs --from pharos --to base --from-token PROS --to-token PROS --amount 0.01 --address <wallet>` | See `references/jumper-lifi.md` |
| One-command safe bridge flow | `node scripts/bridge-safe.mjs --from pharos --to base --token USDC --amount 0.05 --broadcast` | Ephemeral by default; add `--save-plan` for audit |
| Compare live bridge providers and pick the cheapest route | `node scripts/bridge-best-route.mjs --from pharos --to base --token USDC --amount 0.05` | Compares Jumper/LI.FI, Interport CCTP relay, and CCIP |
| Execute the currently cheapest bridge route | `node scripts/bridge-best-route.mjs --from pharos --to base --token USDC --amount 0.05 --broadcast` | Uses the best executable provider after fresh quotes |
| Quote plus safety checks in one run | `node scripts/bridge-plan-safe.mjs --from pharos --to base --from-token USDC --to-token USDC --amount 0.05 --address <wallet> --output plan.json` | Best default for clean-chat bridge prep |
| Quote another chain back to Pharos | `node scripts/bridge-quote.mjs --from base --to pharos --from-token ETH --to-token PROS --amount 0.001 --address <wallet>` | See `references/jumper-lifi.md` |
| Move native USDC with direct Circle CCTP | `node scripts/cctp-transfer.mjs --from pharos --to base --amount 0.01 --address <wallet>` | See `references/circle-cctp.md` |
| Burn and self-mint direct CCTP USDC | `node scripts/cctp-transfer.mjs --from pharos --to base --amount 0.01 --broadcast --mint` | Requires destination gas and confirmation/policy |
| Move USDC with Interport relayed CCTP | `node scripts/interport-cctp-relay.mjs --from pharos --to base --amount 0.01 --broadcast` | Relayer submits destination `receiveMessage`; no user-side mint tx |
| Move USDC with direct Chainlink CCIP | `node scripts/ccip-transfer.mjs --from pharos --to base --token USDC --amount 0.001 --broadcast` | Pays source-native CCIP fee and returns CCIP message link when parsed |
| Discover currently supported Jumper routes | `node scripts/bridge-discover.mjs --from pharos --quotes usdc --address <wallet> --output routes.json` | See `references/jumper-lifi.md` |
| Run resumable quote matrix tests | `node scripts/bridge-quote-matrix.mjs --address <wallet> --direction both --output quote-matrix.json --max-tests 25` | See `references/jumper-lifi.md` |
| Save a bridge execution plan | Add `--output plan.json` to `bridge-quote.mjs` | See `references/safety.md` |
| Execute a saved Jumper plan | `node scripts/bridge-execute.mjs --plan plan.json --broadcast --confirm CONFIRM_MAINNET_BRIDGE` | See `references/safety.md` |
| Track a Jumper transaction | `node scripts/bridge-status.mjs --provider lifi --tx <source_tx> --from-chain pharos --to-chain base` | See `references/jumper-lifi.md` |
| Track or mint a CCTP transfer | `node scripts/bridge-status.mjs --provider cctp --tx <burn_tx> --from pharos --to base` | Add `--mint` after attestation is ready |
| Track a Transporter CCIP message | `node scripts/bridge-status.mjs --provider ccip --message-id <message_id>` | See `references/transporter-ccip.md` |
| Generate Jumper or Transporter app links | `node scripts/bridge-link.mjs --provider transporter --from pharos --to base` | See provider references |
| Diagnose bridge provider support | `node scripts/bridge-doctor.mjs` | See `references/transporter-ccip.md` |

## Quick Commands

Quote Pharos PROS to Base PROS using Jumper/LI.FI:

```bash
node scripts/bridge-quote.mjs --from pharos --to base --from-token PROS --to-token PROS --amount 0.01 --address 0xYourWallet --output plan.json
```

Fast safe plan for Pharos USDC to Base USDC:

```bash
node scripts/bridge-safe.mjs --from pharos --to base --token USDC --amount 0.05 --address 0xYourWallet
```

Compare Jumper/LI.FI, Interport CCTP relay, and CCIP, then pick the best route:

```bash
node scripts/bridge-best-route.mjs --from pharos --to base --token USDC --amount 0.05
```

Execute the current best bridge route after fresh quotes:

```bash
node scripts/bridge-best-route.mjs --from pharos --to base --token USDC --amount 0.05 --broadcast
```

Execute a small bridge with an ephemeral plan when confirmation or policy is present:

```bash
node scripts/bridge-safe.mjs --from pharos --to base --token USDC --amount 0.05 --broadcast
```

Dry-run native USDC through Circle CCTP:

```bash
node scripts/cctp-transfer.mjs --from pharos --to base --amount 0.01 --address 0xYourWallet
```

Burn and mint native USDC through CCTP when destination gas is available:

```bash
node scripts/cctp-transfer.mjs --from pharos --to base --amount 0.01 --broadcast --mint
```

Bridge native USDC through Interport relayed CCTP:

```bash
node scripts/interport-cctp-relay.mjs --from pharos --to base --amount 0.01 --broadcast
```

Bridge USDC through Chainlink CCIP:

```bash
node scripts/ccip-transfer.mjs --from pharos --to base --token USDC --amount 0.001 --broadcast
```

Save an auditable bridge plan:

```bash
node scripts/bridge-safe.mjs --from pharos --to base --token USDC --amount 0.05 --save-plan pharos-base-usdc-plan.json
```

Discover current Pharos destination support in Jumper/LI.FI:

```bash
node scripts/bridge-discover.mjs --from pharos --quotes none --output pharos-routes.json
```

Run a rate-limit friendly USDC quote smoke test:

```bash
node scripts/bridge-discover.mjs --from pharos --quotes usdc --address 0xYourWallet --delay-ms 1500 --output pharos-usdc-routes.json
```

Run a resumable quote matrix across available Pharos directions:

```bash
node scripts/bridge-quote-matrix.mjs --address 0xYourWallet --direction both --output pharos-quote-matrix.json --max-tests 25 --delay-ms 1500
```

Track a Jumper transaction:

```bash
node scripts/bridge-status.mjs --provider lifi --tx 0x9bfdf2d70dacf196ab6eab9812c2e0832ba73b1ae3d25976b79cb797d2dd3586 --from-chain pharos --to-chain base
```

Track a Transporter/CCIP message:

```bash
node scripts/bridge-status.mjs --provider ccip --message-id 0xc6a25437cd4beaf97627465257d1641dcccd6ce7e78e8dcac9fef130021c8325
```

Track a Circle CCTP burn/mint:

```bash
node scripts/bridge-status.mjs --provider cctp --tx 0xBurnTx --from pharos --to base
```

Execute a saved plan after review:

```bash
node scripts/bridge-execute.mjs --plan plan.json --broadcast --confirm CONFIRM_MAINNET_BRIDGE
```

If a local policy allows this signer/action/amount, execute still uses `--broadcast` but may omit `--confirm`:

```bash
node scripts/bridge-execute.mjs --plan plan.json --broadcast
```

## Output Rules

- Show source chain, destination chain, source token, destination token, amount, provider, tool, estimated output, fees when available, transaction target, value, gas limit, and approval address.
- Include status links for Jumper, CCTP, and CCIP when possible.
- For CCTP, show source/destination domains, TokenMessengerV2, MessageTransmitterV2, destination gas status, burn tx, attestation readiness, and mint tx when available.
- Use `--json` when another agent/script needs machine-readable bridge plan and safety check data.
- For "best bridge", use `bridge-best-route.mjs`; show all provider scores and make clear which cost inputs are live quotes, relay/native fees, or estimated gas.
- For quotes, show command previews instead of broadcasting.
- Prefer `bridge-safe.mjs` for normal user-facing preparation because it combines quote, RPC chain-id, balances, allowance, policy status, optional ephemeral execution, and optional saved plans in one run.
- For discovery, distinguish `/connections` support from live `/quote` success; a connection can exist while a specific token/amount quote fails.
- For status, show send tx, receive tx, status, substatus/message, and explorer links.
- When provider support is missing, say which provider failed and suggest the next provider.

## Safety

- This skill may build write transactions, but broadcast is disabled unless the user explicitly asks and provides the exact confirmation or has configured a matching local policy.
- If no private key source is found, stop before execution and show the local secret-file setup.
- If neither exact confirmation nor a matching policy is present, stop before execution and show both options.
- If chain ID returned by RPC does not match the saved plan, stop.
- If an approval transaction is required, execute it before the bridge transaction and show the approval tx hash.
- If a CCTP destination account has zero native gas, do not auto-burn unless the user clearly accepts burn-now/mint-later.
- Do not retry bridge broadcasts automatically.
- `bridge-discover.mjs` is read-only, but LI.FI quote tests are rate limited. Prefer `--quotes none` first, use `--delay-ms`, and set `LIFI_API_KEY` or `LI_FI_API_KEY` when available.
- `bridge-quote-matrix.mjs` is also read-only and resumable. Use `--max-tests` chunks and rerun the same `--output` file until `Pending` is zero.
