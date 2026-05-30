# Transporter / Chainlink CCIP

Transporter is Chainlink CCIP-backed, so this skill tracks Transporter transfers through CCIP message IDs.

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

This skill does not synthesize direct CCIP `ccipSend` calldata by default. It tracks CCIP messages, validates Pharos router support, and provides Chainlink/Transporter status links. Add direct execution only after a dedicated ABI-level workflow is tested for the exact token/lane.

For native USDC movement, prefer the Circle CCTP workflow in `references/circle-cctp.md`. CCTP burns and mints native USDC and does not rely on a liquidity bridge route.
