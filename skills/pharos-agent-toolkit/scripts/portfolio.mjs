#!/usr/bin/env node
import {
  explorerAddress,
  formatUnits,
  isAddress,
  loadTokens,
  parseArgs,
  parseCastUint,
  printTable,
  readAddressesFromFile,
  runCast,
  selectNetworks
} from "./lib/pharos.mjs";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/portfolio.mjs <address> --network all");
  console.log("  node scripts/portfolio.mjs --input wallets.csv --network mainnet");
  console.log("");
  console.log("Options:");
  console.log("  --network <name|all>   Default: atlantic-testnet");
  console.log("  --input <file>         CSV/TXT file containing EVM addresses");
  console.log("  --show-zero            Show zero ERC20 balances");
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  usage();
  process.exit(0);
}
const networkName = args.network || undefined;
const showZero = Boolean(args["show-zero"]);

let addresses = [];
if (args.input) {
  addresses = readAddressesFromFile(args.input);
} else if (args._[0]) {
  addresses = [args._[0]];
}

if (!addresses.length) {
  usage();
  process.exit(1);
}

for (const address of addresses) {
  if (!isAddress(address)) {
    console.error(`Invalid EVM address: ${address}`);
    process.exit(1);
  }
}

const networks = selectNetworks(networkName);
const tokensByNetwork = loadTokens();
const rows = [];
let hiddenZeroCount = 0;

for (const address of addresses) {
  for (const network of networks) {
    const nativeBalance = runCast([
      "balance",
      address,
      "--rpc-url",
      network.rpcUrl,
      "--ether"
    ]);

    rows.push({
      Wallet: address,
      Network: network.name,
      Asset: network.nativeToken,
      Balance: nativeBalance,
      Explorer: explorerAddress(network, address)
    });

    const tokenList = tokensByNetwork[network.name] || [];
    for (const token of tokenList) {
      const rawOutput = runCast([
        "call",
        token.address,
        "balanceOf(address)(uint256)",
        address,
        "--rpc-url",
        network.rpcUrl
      ]);
      const raw = parseCastUint(rawOutput);
      if (raw === 0n && !showZero) {
        hiddenZeroCount += 1;
        continue;
      }
      rows.push({
        Wallet: address,
        Network: network.name,
        Asset: token.symbol,
        Balance: formatUnits(raw, Number(token.decimals)),
        Explorer: explorerAddress(network, token.address)
      });
    }
  }
}

console.log("# Pharos Portfolio Report");
console.log("");
printTable(rows);
console.log("");
if (hiddenZeroCount > 0) {
  console.log(`Hidden zero ERC20 balances: ${hiddenZeroCount}. Re-run with --show-zero to display them.`);
}
