#!/usr/bin/env node
import {
  explorerAddress,
  formatUnits,
  isAddress,
  loadTokens,
  parseAddressList,
  parseArgs,
  parseCastString,
  parseCastUint,
  printTable,
  readAddressesFromFile,
  runCast,
  selectNetworks
} from "./lib/pharos.mjs";

const MAX_UINT256 = (1n << 256n) - 1n;
const UNLIMITED_THRESHOLD = MAX_UINT256 / 2n;

function usage() {
  console.log("Usage:");
  console.log("  node scripts/allowance-audit.mjs --owner <wallet> --spender <address[,address]> --network mainnet --token all");
  console.log("  node scripts/allowance-audit.mjs --owner <wallet> --spender-file spenders.csv --network all --token USDC");
  console.log("");
  console.log("Options:");
  console.log("  --owner <address>        Token owner wallet");
  console.log("  --spender <addresses>    One or more spender addresses, comma/space separated");
  console.log("  --spender-file <file>    CSV/TXT file containing spender addresses");
  console.log("  --network <name|all>     Default: atlantic-testnet");
  console.log("  --token <all|symbol|address>  Default: all known ERC20 tokens for the network");
  console.log("  --show-zero              Show zero allowances");
}

function classifyAllowance(allowance, balance) {
  if (allowance === 0n) return "zero";
  if (allowance >= UNLIMITED_THRESHOLD) return "critical: unlimited-like";
  if (balance > 0n && allowance > balance) return "high: exceeds balance";
  return "active";
}

function shellQuote(value) {
  if (/^[a-zA-Z0-9_./:$-]+$/.test(value)) return value;
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function resolveTokens(network, tokenArg) {
  const tokensByNetwork = loadTokens();
  const knownTokens = tokensByNetwork[network.name] || [];
  const requested = tokenArg || "all";

  if (requested.toLowerCase() === "all") {
    return knownTokens;
  }

  if (isAddress(requested)) {
    let symbol = requested;
    let decimals = 18;
    try {
      symbol = parseCastString(runCast(["call", requested, "symbol()(string)", "--rpc-url", network.rpcUrl])) || requested;
    } catch {
      symbol = requested;
    }
    try {
      decimals = Number(parseCastUint(runCast(["call", requested, "decimals()(uint8)", "--rpc-url", network.rpcUrl])));
    } catch {
      decimals = 18;
    }
    return [{ symbol, name: symbol, decimals, address: requested }];
  }

  const match = knownTokens.find((token) => token.symbol.toLowerCase() === requested.toLowerCase());
  if (!match) {
    const symbols = knownTokens.map((token) => token.symbol).join(", ");
    throw new Error(`Token "${requested}" is not known on ${network.name}. Use one of: ${symbols}, all, or a token contract address.`);
  }
  return [match];
}

const args = parseArgs(process.argv.slice(2));
const owner = args.owner || args._[0];

if (!owner || !isAddress(owner)) {
  usage();
  if (owner) console.error(`Invalid owner address: ${owner}`);
  process.exit(1);
}

let spenders = [];
if (args.spender) {
  spenders = spenders.concat(parseAddressList(args.spender));
}
if (args["spender-file"]) {
  spenders = spenders.concat(readAddressesFromFile(args["spender-file"]));
}
spenders = [...new Map(spenders.map((address) => [address.toLowerCase(), address])).values()];

if (!spenders.length) {
  usage();
  console.error("At least one spender address is required. This skill does not discover historical approvals without an indexer.");
  process.exit(1);
}

const networks = selectNetworks(args.network || undefined);
const showZero = Boolean(args["show-zero"]);
const rows = [];
const revokePlans = [];
let hiddenZeroCount = 0;

for (const network of networks) {
  const tokens = resolveTokens(network, args.token || "all");
  for (const token of tokens) {
    let balance = 0n;
    try {
      balance = parseCastUint(runCast([
        "call",
        token.address,
        "balanceOf(address)(uint256)",
        owner,
        "--rpc-url",
        network.rpcUrl
      ]));
    } catch {
      balance = 0n;
    }

    for (const spender of spenders) {
      const allowance = parseCastUint(runCast([
        "call",
        token.address,
        "allowance(address,address)(uint256)",
        owner,
        spender,
        "--rpc-url",
        network.rpcUrl
      ]));

      if (allowance === 0n && !showZero) {
        hiddenZeroCount += 1;
        continue;
      }

      const risk = classifyAllowance(allowance, balance);
      rows.push({
        Network: network.name,
        Token: token.symbol,
        OwnerBalance: formatUnits(balance, Number(token.decimals)),
        Spender: spender,
        Allowance: formatUnits(allowance, Number(token.decimals)),
        Risk: risk,
        TokenExplorer: explorerAddress(network, token.address)
      });

      if (allowance > 0n) {
        revokePlans.push({
          network,
          token,
          spender,
          bash: `cast send ${shellQuote(token.address)} "approve(address,uint256)" ${shellQuote(spender)} 0 --private-key "$PRIVATE_KEY" --rpc-url ${shellQuote(network.rpcUrl)}`,
          powershell: `cast send ${shellQuote(token.address)} "approve(address,uint256)" ${shellQuote(spender)} 0 --private-key $env:PRIVATE_KEY --rpc-url ${shellQuote(network.rpcUrl)}`
        });
      }
    }
  }
}

console.log("# Pharos ERC20 Allowance Audit");
console.log("");
console.log(`Owner: ${owner}`);
console.log("");
if (rows.length) {
  printTable(rows);
} else {
  console.log("No non-zero allowances found for the provided spender list.");
}
console.log("");
if (hiddenZeroCount > 0) {
  console.log(`Hidden zero allowances: ${hiddenZeroCount}. Re-run with --show-zero to display them.`);
}

if (revokePlans.length) {
  console.log("");
  console.log("## Suggested Revoke Commands");
  console.log("");
  console.log("Review network, token, and spender before executing. These commands set allowance to 0.");
  for (const plan of revokePlans) {
    console.log("");
    console.log(`### ${plan.network.name} ${plan.token.symbol} spender ${plan.spender}`);
    console.log("");
    console.log("Bash/zsh:");
    console.log("```bash");
    console.log(plan.bash);
    console.log("```");
    console.log("PowerShell:");
    console.log("```powershell");
    console.log(plan.powershell);
    console.log("```");
  }
}
