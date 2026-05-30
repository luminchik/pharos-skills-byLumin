# Transporter / Chainlink CCIP

Transporter is Chainlink CCIP-backed, so this skill can create narrow direct
CCIP token-transfer tests and track Transporter transfers through CCIP message
IDs.

## Status

`bridge-status.mjs --provider ccip` calls:

```text
https://api.ccip.chain.link/v2/messages/<messageId>
```

The response includes source and destination networks, sender, receiver, status, send transaction, receipt transaction, and sequence number.

## Pharos Mainnet CCIP Constants

Known Pharos CCIP values are stored in `assets/providers.json`:

- Chain ID: `1672`
- Chain selector: `7801139999541420232`
- Router: `0x4e52dd94e9bcfefe3c78153bdfb0ab1d30687297`
- LINK token: `0x51e2A24742Db77604B881d6781Ee16B5b8fcBE29`

## Execution Scope

`ccip-transfer.mjs` synthesizes direct CCIP Router `ccipSend` calldata for
tested token/lane combinations. It quotes router fees, checks lane support, and
blocks known unsupported token routes before broadcast.

Live note: Pharos -> Base USDC has a supported CCIP chain lane and returns a
router fee, but a 2026-05-30 mainnet preflight reverted with
`ERC20: transfer to the zero address`, indicating no usable direct CCIP token
pool for that USDC lane. Use `bridge-best-route.mjs` so the agent can select
Interport/Jumper instead when direct CCIP is not executable.

Dry run:

```bash
node scripts/ccip-transfer.mjs --from pharos --to base --token USDC --amount 0.001
```

Broadcast:

```bash
node scripts/ccip-transfer.mjs --from pharos --to base --token USDC --amount 0.001 --broadcast
```

For route selection, prefer:

```bash
node scripts/bridge-best-route.mjs --from pharos --to base --token USDC --amount 0.001
```

For native USDC movement, prefer the Circle CCTP workflow in `references/circle-cctp.md`. CCTP burns and mints native USDC and does not rely on a liquidity bridge route.
