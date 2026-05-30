#!/usr/bin/env node
import {
  explorerAddress,
  explorerTx,
  fetchJson,
  isAddress,
  loadSelectors,
  parseArgs,
  printTable,
  selectNetworks
} from "./lib/pharos.mjs";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/tx-history.mjs <address> --network mainnet --pages 2");
  console.log("  node scripts/tx-history.mjs <address> --network all --pages 1 --latest 10");
  console.log("");
  console.log("Options:");
  console.log("  --network <name|all>  Default: mainnet");
  console.log("  --pages <n>           SocialScan pages to fetch; 25 tx/page. Default: 2");
  console.log("  --latest <n>          Latest transactions to print. Default: 10");
}

function lower(value) {
  return String(value || "").toLowerCase();
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function classify(tx, address, selectors) {
  const from = lower(tx.from_address);
  const to = lower(tx.to_address);
  const self = lower(address);
  const method = lower(tx.method_id);

  if (tx.receipt_contract_address) return "contract deploy";
  if (method && method !== "0x" && selectors.functions[method]) return selectors.functions[method];
  if (method && method !== "0x") return `${method} call`;
  if (from === self && to === self) return "self transfer";
  if (from === self) return "native sent";
  if (to === self) return "native received";
  return "related";
}

function direction(tx, address) {
  const self = lower(address);
  if (lower(tx.from_address) === self && lower(tx.to_address) === self) return "self";
  if (lower(tx.from_address) === self) return "out";
  if (lower(tx.to_address) === self) return "in";
  return "related";
}

function shortHash(hash) {
  if (!hash) return "-";
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function shortAddress(address) {
  if (!address) return "-";
  return `${address.slice(0, 8)}...${address.slice(-4)}`;
}

function addCounter(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  usage();
  process.exit(0);
}
const address = args._[0] || args.address;

if (!address || !isAddress(address)) {
  usage();
  if (address) console.error(`Invalid address: ${address}`);
  process.exit(1);
}

const pages = Math.max(1, Math.min(20, Number(args.pages || 2)));
const latestCount = Math.max(1, Math.min(50, Number(args.latest || 10)));
const selectors = loadSelectors();
const networks = selectNetworks(args.network || undefined);
const jsonMode = Boolean(args.json);
const reports = [];

if (!jsonMode) {
  console.log("# Pharos Transaction History Summary");
  console.log("");
  console.log(`Address: ${address}`);
  console.log("");
}

for (const network of networks) {
  const transactions = [];
  const seen = new Set();
  let explorerTotal = "unknown";
  let apiError = "";
  for (let page = 1; page <= pages; page += 1) {
    const url = `${network.historyApiUrl}/address/${address}/transactions?page=${page}`;
    try {
      const json = await fetchJson(url);
      if (json.total !== undefined && json.total !== null) {
        explorerTotal = String(json.total);
      }
      const data = Array.isArray(json.data) ? json.data : [];
      for (const tx of data) {
        if (!seen.has(tx.hash)) {
          seen.add(tx.hash);
          transactions.push(tx);
        }
      }
      if (data.length === 0) break;
    } catch (error) {
      apiError = error.message;
      break;
    }
  }
  if (apiError) {
    reports.push({ network: network.name, ok: false, error: apiError });
    if (!jsonMode) {
      console.log(`## ${network.name}`);
      console.log("");
      console.log(`History API error: ${apiError}`);
      console.log("");
    }
    continue;
  }

  const total = transactions.length;
  const success = transactions.filter((tx) => Number(tx.receipt_status) === 1).length;
  const failed = transactions.filter((tx) => Number(tx.receipt_status) === 0).length;
  const inbound = transactions.filter((tx) => direction(tx, address) === "in").length;
  const outbound = transactions.filter((tx) => direction(tx, address) === "out").length;
  const totalFees = transactions.reduce((sum, tx) => sum + asNumber(tx.transaction_fee), 0);
  const sentValue = transactions
    .filter((tx) => direction(tx, address) === "out")
    .reduce((sum, tx) => sum + asNumber(tx.value), 0);
  const receivedValue = transactions
    .filter((tx) => direction(tx, address) === "in")
    .reduce((sum, tx) => sum + asNumber(tx.value), 0);

  const classes = new Map();
  const counterparties = new Map();
  for (const tx of transactions) {
    const label = classify(tx, address, selectors);
    addCounter(classes, label);
    const dir = direction(tx, address);
    const counterparty = dir === "out" ? tx.to_address : tx.from_address;
    if (counterparty) addCounter(counterparties, counterparty);
  }

  const classRows = [...classes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([Type, Count]) => ({ Type, Count }));

  const counterpartyRows = [...counterparties.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([Address, Count]) => ({ Address: shortAddress(Address), Count }));

  const latestRows = transactions.slice(0, latestCount).map((tx) => ({
    Time: tx.block_timestamp || "-",
    Dir: direction(tx, address),
    Status: Number(tx.receipt_status) === 1 ? "ok" : "fail",
    Type: classify(tx, address, selectors),
    Value: `${tx.value || "0"} ${network.nativeToken}`,
    Fee: tx.transaction_fee || "-",
    Hash: shortHash(tx.hash),
    Link: explorerTx(network, tx.hash)
  }));

  const report = {
    network: network.name,
    ok: true,
    explorer: explorerAddress(network, address),
    explorerTotal,
    fetchedTransactions: total,
    success,
    failed,
    inbound,
    outbound,
    nativeSent: sentValue.toFixed(6),
    nativeReceived: receivedValue.toFixed(6),
    gasFees: totalFees.toFixed(8),
    activityTypes: classRows,
    topCounterparties: counterpartyRows,
    latestTransactions: latestRows
  };
  reports.push(report);
  if (jsonMode) continue;

  console.log(`## ${network.name}`);
  console.log("");
  printTable([
    { Metric: "Explorer total", Value: explorerTotal },
    { Metric: "Fetched transactions", Value: String(total) },
    { Metric: "Success / failed", Value: `${success} / ${failed}` },
    { Metric: "Inbound / outbound", Value: `${inbound} / ${outbound}` },
    { Metric: `Native sent (${network.nativeToken})`, Value: sentValue.toFixed(6) },
    { Metric: `Native received (${network.nativeToken})`, Value: receivedValue.toFixed(6) },
    { Metric: `Gas fees (${network.nativeToken})`, Value: totalFees.toFixed(8) },
    { Metric: "Explorer", Value: explorerAddress(network, address) }
  ]);
  console.log("");

  console.log("### Activity Types");
  printTable(classRows);
  console.log("");

  console.log("### Top Counterparties");
  printTable(counterpartyRows);
  console.log("");

  console.log("### Latest Transactions");
  printTable(latestRows);
  console.log("");
}

if (jsonMode) {
  console.log(JSON.stringify({
    ok: reports.every((report) => report.ok !== false),
    address,
    pages,
    latest: latestCount,
    reports
  }, null, 2));
}
