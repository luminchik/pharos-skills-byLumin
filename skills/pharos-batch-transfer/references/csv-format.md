# CSV and Recipient Input

Use this format for variable amounts:

```csv
address,amount
0x1111111111111111111111111111111111111111,0.01
0x2222222222222222222222222222222222222222,0.02
```

For uniform amount batches, the file can contain only addresses:

```csv
address
0x1111111111111111111111111111111111111111
0x2222222222222222222222222222222222222222
```

Then pass:

```bash
--amount 0.05
```

Rules:

- Empty lines and lines starting with `#` are ignored.
- Headers `address` or `recipient` are ignored.
- Duplicate recipients are rejected.
- Native token amounts are human units (`0.05` means `0.05 PHRS/PROS`).
- ERC20 amounts are human units and converted using token decimals.
