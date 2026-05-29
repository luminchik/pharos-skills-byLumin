#!/usr/bin/env node
import fs from "node:fs";
import {
  explorerAddress,
  formatUnits,
  isAddress,
  loadProtocols,
  loadTokens,
  parseArgs,
  parseCastUint,
  printTable,
  runCast,
  selectNetworks
} from "./lib/pharos.mjs";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/defi-positions.mjs <wallet> --network mainnet");
  console.log("  node scripts/defi-positions.mjs <wallet> --network all --include-zero");
  console.log("  node scripts/defi-positions.mjs <wallet> --protocol-file protocols.local.json");
  console.log("");
  console.log("Protocol definition types:");
  console.log("  erc20-balance: { name,type,contract,symbol,decimals,category }");
  console.log("  staking: { name,type,contract,stakedFunction,rewardFunction,symbol,decimals,rewardSymbol,rewardDecimals }");
}

function safeCall(args) {
  try {
    return { ok: true, output: runCast(args) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function loadExtraProtocols(file) {
  if (!file) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function protocolsFor(networkName, extra) {
  const builtIn = loadProtocols();
  const builtInList = builtIn[networkName] || [];
  const extraList = Array.isArray(extra) ? extra : extra[networkName] || [];
  return [...builtInList, ...extraList];
}

function addIfVisible(rows, row, includeZero, jsonRows = []) {
  if (includeZero || row.Raw === undefined || BigInt(row.Raw) !== 0n) {
    const { Raw, ...visible } = row;
    rows.push(visible);
    jsonRows.push(row);
  }
}

const args = parseArgs(process.argv.slice(2));
const wallet = args._[0] || args.wallet;

if (!wallet || !isAddress(wallet)) {
  usage();
  if (wallet) console.error(`Invalid wallet address: ${wallet}`);
  process.exit(1);
}

const includeZero = Boolean(args["include-zero"]);
const networks = selectNetworks(args.network || undefined);
const tokens = loadTokens();
const extraProtocols = loadExtraProtocols(args["protocol-file"]);
const rows = [];
const jsonRows = [];
let hiddenZero = 0;

if (!args.json) {
  console.log("# Pharos DeFi Position Check");
  console.log("");
  console.log(`Wallet: ${wallet}`);
  console.log("");
}

for (const network of networks) {
  const native = parseCastUint(runCast(["balance", wallet, "--rpc-url", network.rpcUrl]));
  addIfVisible(rows, {
    Network: network.name,
    Source: "native",
    Position: network.nativeToken,
    Category: "native",
    Balance: formatUnits(native, 18),
    Raw: native.toString(),
    Contract: "-",
    Explorer: explorerAddress(network, wallet)
  }, includeZero, jsonRows);
  if (native === 0n && !includeZero) hiddenZero += 1;

  for (const token of tokens[network.name] || []) {
    const call = safeCall([
      "call",
      token.address,
      "balanceOf(address)(uint256)",
      wallet,
      "--rpc-url",
      network.rpcUrl
    ]);
    const raw = call.ok ? parseCastUint(call.output) : 0n;
    addIfVisible(rows, {
      Network: network.name,
      Source: "token",
      Position: token.symbol,
      Category: token.category || "token",
      Balance: formatUnits(raw, Number(token.decimals)),
      Raw: raw.toString(),
      Contract: token.address,
      Explorer: explorerAddress(network, token.address)
    }, includeZero, jsonRows);
    if (raw === 0n && !includeZero) hiddenZero += 1;
  }

  for (const protocol of protocolsFor(network.name, extraProtocols)) {
    if (protocol.type === "erc20-balance") {
      const raw = parseCastUint(runCast([
        "call",
        protocol.contract,
        "balanceOf(address)(uint256)",
        wallet,
        "--rpc-url",
        network.rpcUrl
      ]));
      addIfVisible(rows, {
        Network: network.name,
        Source: protocol.name,
        Position: protocol.symbol,
        Category: protocol.category || "protocol token",
        Balance: formatUnits(raw, Number(protocol.decimals || 18)),
        Raw: raw.toString(),
        Contract: protocol.contract,
        Explorer: explorerAddress(network, protocol.contract)
      }, includeZero, jsonRows);
      if (raw === 0n && !includeZero) hiddenZero += 1;
    } else if (protocol.type === "staking") {
      const staked = parseCastUint(runCast([
        "call",
        protocol.contract,
        protocol.stakedFunction || "balanceOf(address)(uint256)",
        wallet,
        "--rpc-url",
        network.rpcUrl
      ]));
      addIfVisible(rows, {
        Network: network.name,
        Source: protocol.name,
        Position: protocol.symbol || "staked",
        Category: "staked",
        Balance: formatUnits(staked, Number(protocol.decimals || 18)),
        Raw: staked.toString(),
        Contract: protocol.contract,
        Explorer: explorerAddress(network, protocol.contract)
      }, includeZero, jsonRows);
      if (protocol.rewardFunction) {
        const reward = parseCastUint(runCast([
          "call",
          protocol.contract,
          protocol.rewardFunction,
          wallet,
          "--rpc-url",
          network.rpcUrl
        ]));
        addIfVisible(rows, {
          Network: network.name,
          Source: protocol.name,
          Position: protocol.rewardSymbol || "reward",
          Category: "claimable reward",
          Balance: formatUnits(reward, Number(protocol.rewardDecimals || 18)),
          Raw: reward.toString(),
          Contract: protocol.contract,
          Explorer: explorerAddress(network, protocol.contract)
        }, includeZero, jsonRows);
        if (reward === 0n && !includeZero) hiddenZero += 1;
      }
    }
  }
}

if (args.json) {
  console.log(JSON.stringify({
    ok: true,
    wallet,
    networks: networks.map((network) => network.name),
    includeZero,
    hiddenZero,
    positions: jsonRows.map((row) => ({
      network: row.Network,
      source: row.Source,
      position: row.Position,
      category: row.Category,
      balance: row.Balance,
      raw: row.Raw,
      contract: row.Contract,
      explorer: row.Explorer
    }))
  }, null, 2));
  process.exit(0);
}

printTable(rows);
console.log("");
if (hiddenZero) {
  console.log(`Hidden zero positions: ${hiddenZero}. Re-run with --include-zero to display them.`);
}
console.log("");
console.log("Note: protocol positions are registry-driven. Add verified protocol definitions with --protocol-file for LP, vault, or staking contracts.");
