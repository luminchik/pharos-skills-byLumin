# Circle CCTP V2 USDC

Use this reference when the user asks for native USDC movement through Circle
CCTP instead of a liquidity bridge.

## Scope

- Supports native USDC burn/mint routes between Pharos and CCTP-supported EVM
  domains listed in `assets/cctp.json`.
- Uses Foundry `cast` for all onchain reads and writes.
- Uses Circle Iris API only to fetch message attestation after the source burn.
- Does not use hidden bridge UI endpoints.

## Main Commands

Dry-run Pharos to Base:

```bash
node scripts/cctp-transfer.mjs --from pharos --to base --amount 0.01 --address 0xYourWallet
```

Burn and auto-mint when destination gas is available:

```bash
node scripts/cctp-transfer.mjs --from pharos --to base --amount 0.01 --broadcast --mint
```

Check a burn transaction:

```bash
node scripts/bridge-status.mjs --provider cctp --tx 0xBurnTx --from pharos --to base
```

Mint later after attestation is ready:

```bash
node scripts/bridge-status.mjs --provider cctp --tx 0xBurnTx --from pharos --to base --mint
```

## Safety Notes

- CCTP has two phases: burn on source, mint on destination.
- The destination signer needs native gas to call `receiveMessage`, unless a
  separate relayer handles minting.
- Use standard finality (`minFinalityThreshold=2000`) unless the source chain
  explicitly supports fast transfer and the user asks for it.
- Approve only the exact USDC amount for `TokenMessengerV2`.
- If destination gas is zero, do not burn unless the user explicitly accepts a
  burn-now/mint-later workflow.

## Pharos Constants

Stored in `assets/cctp.json`:

- Pharos chain ID: `1672`
- Pharos CCTP domain: `31`
- Pharos USDC: `0xC879C018dB60520F4355C26eD1a6D572cdAC1815`
- TokenMessengerV2: `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`
- MessageTransmitterV2: `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`
- TokenMinterV2: `0xfd78EE919681417d192449715b2594ab58f5D002`
