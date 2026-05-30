#!/usr/bin/env node
import {
  explorerAddress,
  explorerTx,
  formatUnits,
  isTxHash,
  loadSelectors,
  parseArgs,
  printTable,
  runCast,
  selectNetworks
} from "./lib/pharos.mjs";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/tx-debug.mjs <tx_hash> --network all");
  console.log("  node scripts/tx-debug.mjs <tx_hash> --network mainnet");
}

function parseKeyValues(output) {
  const fields = {};
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_ ]*?)(?:\s*:\s*|\s{2,})(.*)$/);
    if (!match) continue;
    const key = match[1].trim().replace(/\s+/g, "");
    const value = match[2].trim();
    fields[key] = value;
  }
  return fields;
}

function extractInput(txOutput, fields) {
  if (fields.input && fields.input.startsWith("0x")) return fields.input;
  const match = String(txOutput || "").match(/\binput:\s*(0x[a-fA-F0-9]*)/);
  return match ? match[1] : "0x";
}

function extractTopics(receiptOutput) {
  const logsJson = String(receiptOutput || "").match(/logs\s+(\[[\s\S]*?\])\s+logsBloom/);
  if (logsJson) {
    try {
      const logs = JSON.parse(logsJson[1]);
      const topics = [];
      for (const log of logs) {
        for (const topic of log.topics || []) {
          const normalized = String(topic).toLowerCase();
          if (/^0x[a-f0-9]{64}$/.test(normalized) && !topics.includes(normalized)) {
            topics.push(normalized);
          }
        }
      }
      return topics;
    } catch {
      // Fall through to regex extraction for older cast output formats.
    }
  }

  if (/logs\s+\[\]/.test(String(receiptOutput || ""))) {
    return [];
  }
  const topics = [];
  const regex = /0x[a-fA-F0-9]{64}/g;
  const matches = String(receiptOutput || "").match(regex) || [];
  for (const topic of matches) {
    if (!topics.includes(topic.toLowerCase())) topics.push(topic.toLowerCase());
  }
  return topics;
}

function normalizeAddress(value) {
  const text = String(value || "").trim();
  if (!text || text === "null" || text === "0x") return "";
  return text;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  usage();
  process.exit(0);
}
const txHash = args._[0];
if (!txHash || !isTxHash(txHash)) {
  usage();
  if (txHash) console.error(`Invalid transaction hash: ${txHash}`);
  process.exit(1);
}

const selectors = loadSelectors();
const networks = selectNetworks(args.network || "all");
const reportRows = [];
let found = false;

for (const network of networks) {
  let txOutput = "";
  try {
    txOutput = runCast(["tx", txHash, "--rpc-url", network.rpcUrl]);
  } catch (error) {
    reportRows.push({
      Network: network.name,
      Status: "not found",
      Detail: "cast tx returned no transaction"
    });
    continue;
  }

  found = true;
  const txFields = parseKeyValues(txOutput);
  const input = extractInput(txOutput, txFields);
  const toAddress = normalizeAddress(txFields.to);
  const selector = input && input.length >= 10 ? input.slice(0, 10).toLowerCase() : "0x";
  const selectorLabel = !toAddress && selector !== "0x"
    ? "contract creation"
    : selectors.functions[selector] || (selector === "0x" ? "native transfer or empty calldata" : `${selector} (unknown)`);

  let receiptOutput = "";
  let receiptFields = {};
  let status = "pending";
  try {
    receiptOutput = runCast(["receipt", txHash, "--rpc-url", network.rpcUrl]);
    receiptFields = parseKeyValues(receiptOutput);
    const rawStatus = receiptFields.status || receiptFields.Status || "";
    status = rawStatus.startsWith("1") || rawStatus.toLowerCase().includes("success")
      ? "success"
      : rawStatus.startsWith("0")
        ? "failed"
        : rawStatus || "confirmed";
  } catch {
    status = "pending";
  }

  const valueRaw = txFields.value || "0";
  const valueMatch = valueRaw.match(/\d+/);
  const value = valueMatch ? formatUnits(BigInt(valueMatch[0]), 18) : valueRaw;
  const topics = extractTopics(receiptOutput);
  const createdContract = normalizeAddress(receiptFields.contractAddress);
  const targetAddress = toAddress || createdContract;
  const knownEvents = topics
    .map((topic) => selectors.events[topic])
    .filter(Boolean)
    .filter((event, index, arr) => arr.indexOf(event) === index)
    .join(", ");

  reportRows.push({
    Network: network.name,
    Status: status,
    From: txFields.from || "-",
    To: toAddress || (createdContract ? "(contract creation)" : "-"),
    Contract: createdContract || "-",
    Value: `${value} ${network.nativeToken}`,
    Selector: selectorLabel,
    GasUsed: receiptFields.gasUsed || "-",
    Block: receiptFields.blockNumber || txFields.blockNumber || "-",
    Explorer: explorerTx(network, txHash)
  });

  console.log(`# Pharos Transaction Debug: ${txHash}`);
  console.log("");
  printTable(reportRows);
  console.log("");
  console.log(`Contract/source address link: ${targetAddress ? explorerAddress(network, targetAddress) : "-"}`);
  if (knownEvents) {
    console.log(`Known event topics: ${knownEvents}`);
  } else if (topics.length) {
    console.log(`Event topics found: ${topics.length}. Provide ABI for full event decoding.`);
  }
  if (selectorLabel.endsWith("(unknown)")) {
    console.log("Function selector is unknown. Provide ABI or source code for full calldata decoding.");
  }
  process.exit(0);
}

if (!found) {
  console.log(`# Pharos Transaction Debug: ${txHash}`);
  console.log("");
  printTable(reportRows);
  process.exit(2);
}
