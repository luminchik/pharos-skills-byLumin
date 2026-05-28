---
name: pharos-faroswap-swapper
description: >
  Portable Pharos Agent Center skill for Faroswap swaps on Pharos mainnet. Use when the user asks to swap PROS, WPROS, or USDC through Faroswap, quote Faroswap routes, plan a safe swap, execute a saved swap plan, use local mainnet auto-confirm policy, wrap PROS to WPROS, unwrap WPROS to PROS, inspect a Faroswap transaction, decode Faroswap mixSwap calldata, or diagnose Faroswap/DODO quote support. Uses the public Faroswap DODO widget quote API and Foundry cast for execution.
---

# Pharos Faroswap Swapper

Quote, plan, execute, and inspect Faroswap swaps on Pharos mainnet.

Required binaries: Node.js. Required for execution and transaction inspection: Foundry `cast`. Read-only quotes do not need a private key.

## Core Rules

- Faroswap is Pharos mainnet only (`chainId 1672`).
- Use Faroswap/DODO quote output for `to`, `data`, `value`, `minReturnAmount`, and approval spender. Do not hand-build router calldata when the API is available.
- Never broadcast directly from a chat answer. Save a plan first, then execute the saved plan.
- Mainnet swap execution requires `--broadcast --confirm CONFIRM_MAINNET_SWAP`.
- A matching local policy may replace the confirmation string only when the user explicitly configured it; scripts still require `--broadcast`.
- Never print or store private keys. Execution auto-discovers `--private-key-file`, `PRIVATE_KEY`, `PHAROS_PRIVATE_KEY_FILE`, `~/.codex/secrets/pharos_private_key.txt`, then `~/.pharos/private_key`.
- For ERC20 inputs, approve only the exact planned amount to the quote's `targetApproveAddr`.
- If an existing ERC20 allowance is larger than needed, reset it and approve the exact amount unless the user explicitly passes `--keep-existing-allowance`.
- Refresh quotes before execution if a plan is older than 10 minutes.

## Capability Index

| User need | Use | Details |
| --- | --- | --- |
| Quote PROS to USDC | `node scripts/faroswap-quote.mjs --from PROS --to USDC --amount 0.01 --address <wallet>` | See `references/faroswap.md` |
| Quote USDC to PROS | `node scripts/faroswap-quote.mjs --from USDC --to PROS --amount 1 --address <wallet>` | ERC20 quote uses `estimateGas=false` by default |
| Plan and save a swap | Add `--output faroswap-plan.json` to `faroswap-quote.mjs` | Review before execution |
| Execute a saved plan | `node scripts/faroswap-execute.mjs --plan faroswap-plan.json --broadcast --confirm CONFIRM_MAINNET_SWAP` | See `references/safety.md` |
| Execute with local policy | `node scripts/faroswap-execute.mjs --plan faroswap-plan.json --broadcast` | Requires matching `pharos_policy.json` |
| Wrap or unwrap PROS/WPROS | Quote `PROS -> WPROS` or `WPROS -> PROS` | API returns WPROS deposit/withdraw calldata |
| Decode a Faroswap tx | `node scripts/faroswap-decode-tx.mjs --tx <hash>` | Decodes `mixSwap`, wrapping calls, transfers, and `OrderHistory` |
| Check setup and contracts | `node scripts/faroswap-doctor.mjs` | Verifies API, chain ID, router code, token metadata |

## Quick Commands

Quote and save a PROS to USDC plan:

```bash
node scripts/faroswap-quote.mjs --from PROS --to USDC --amount 0.001 --address 0xYourWallet --output faroswap-plan.json
```

Quote all built-in pairs:

```bash
node scripts/faroswap-quote.mjs --matrix --address 0xYourWallet --amount 0.001
```

Execute after review:

```bash
node scripts/faroswap-execute.mjs --plan faroswap-plan.json --broadcast --confirm CONFIRM_MAINNET_SWAP
```

If a local policy allows this signer/token/amount, execute still uses `--broadcast` but may omit `--confirm`:

```bash
node scripts/faroswap-execute.mjs --plan faroswap-plan.json --broadcast
```

Decode the known sample:

```bash
node scripts/faroswap-decode-tx.mjs --tx 0x87a74a2dcc0328fb4ec471c2b2f5361c1ff110161ff55252525d2c383690f18e
```

## Output Rules

- Show network, from token, to token, input amount, estimated output, minimum return, slippage, route source, target, value, approval spender, gas limit, and plan expiry.
- For ERC20 swaps, show whether approval is required and the exact approval amount.
- For execution, show approval tx hash when approval was sent and swap tx hash after broadcast.
- For decode, show function selector, decoded action, transfers for known tokens, and explorer links.

## Safety

Read `references/safety.md` before executing saved plans.
