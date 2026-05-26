# Distributor Mode

Use distributor mode for large batches, uniform airdrops, or compatibility with contracts exposing:

```solidity
batchTransferUniform(address[] recipients, uint256 amount)
```

The Pharos mainnet example transaction `0x0acd61f94d3080fd66966a1639bbb54e20ac3490de6bfd6a2697f9242a0e7159` calls selector `0x1d678dc3` on distributor `0x78699D58e05Daa04240011af64FC3620b2A33412` with 300 recipients and `0.05` PROS per recipient.

Preview against that style of distributor:

```bash
node scripts/batch-plan.mjs --asset native --mode distributor --distributor 0x78699D58e05Daa04240011af64FC3620b2A33412 --amount 0.05 --input recipients.csv --network mainnet
```

Deploy this skill's disposable distributor:

```bash
node scripts/batch-distributor-deploy.mjs --network mainnet
```

Rules:

- For native uniform batches, the script calls `batchTransferUniform(address[],uint256)` and sends `msg.value = recipients.length * amount`.
- For native variable batches, it calls `batchTransfer(address[],uint256[])`.
- For ERC20 batches, it first approves the exact total amount and then calls the ERC20 distributor method.
- Always verify contract code exists at `--distributor` before broadcast.
- Keep chunks around 300 recipients unless a known distributor has a lower gas ceiling.
