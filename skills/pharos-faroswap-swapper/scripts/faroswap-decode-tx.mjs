#!/usr/bin/env node
import {
  explorerTx,
  formatUnits,
  hexWords,
  isTxHash,
  loadFaroswap,
  parseArgs,
  printTable,
  runCast,
  selectorOf,
  selectNetwork,
  tokenByAddress,
  wordToAddress,
  wordToBigInt
} from "./lib/faroswap.mjs";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/faroswap-decode-tx.mjs --tx 0xHash");
}

function topicAddress(topic) {
  return `0x${String(topic || "").replace(/^0x/, "").slice(24)}`;
}

function formatTokenAmount(address, value, networkName) {
  const token = tokenByAddress(address, networkName);
  if (!token) return `${value.toString()} base units`;
  return `${formatUnits(value, token.decimals)} ${token.symbol}`;
}

function decodeOrderHistory(log, networkName) {
  const words = hexWords(log.data);
  if (words.length < 5) return null;
  const fromToken = wordToAddress(words[0]);
  const toToken = wordToAddress(words[1]);
  const user = wordToAddress(words[2]);
  const fromAmount = wordToBigInt(words[3]);
  const returnAmount = wordToBigInt(words[4]);
  return {
    Event: "OrderHistory",
    FromToken: tokenByAddress(fromToken, networkName)?.symbol || fromToken,
    ToToken: tokenByAddress(toToken, networkName)?.symbol || toToken,
    User: user,
    In: formatTokenAmount(fromToken, fromAmount, networkName),
    Out: formatTokenAmount(toToken, returnAmount, networkName)
  };
}

function decodeTransfer(log, networkName) {
  if ((log.topics || []).length < 3) return null;
  const token = tokenByAddress(log.address, networkName);
  if (!token) return null;
  return {
    Event: "Transfer",
    Token: token.symbol,
    From: topicAddress(log.topics[1]),
    To: topicAddress(log.topics[2]),
    Amount: formatUnits(wordToBigInt(String(log.data).replace(/^0x/, "")), token.decimals)
  };
}

const args = parseArgs(process.argv.slice(2));

try {
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!isTxHash(args.tx)) throw new Error("Missing or invalid --tx");
  const network = selectNetwork(args.network || "mainnet");
  const faroswap = loadFaroswap();
  const tx = JSON.parse(runCast(["tx", args.tx, "--json", "--rpc-url", network.rpcUrl]));
  const receipt = JSON.parse(runCast(["receipt", args.tx, "--json", "--rpc-url", network.rpcUrl]));
  const selector = selectorOf(tx.input);
  const selectorName = faroswap.knownSelectors[selector] || "unknown";

  console.log("# Faroswap Transaction Decode");
  console.log("");
  printTable([
    { Field: "Hash", Value: tx.hash },
    { Field: "Explorer", Value: explorerTx(network, tx.hash) },
    { Field: "Status", Value: receipt.status === "0x1" ? "success" : "failed" },
    { Field: "From", Value: tx.from },
    { Field: "To", Value: tx.to },
    { Field: "Value", Value: `${BigInt(tx.value || "0x0").toString()} wei` },
    { Field: "Selector", Value: `${selector} ${selectorName}` }
  ]);

  if (selector === "0xff84aafa") {
    console.log("");
    console.log("Decoded mixSwap calldata:");
    console.log("```text");
    console.log(runCast(["calldata-decode", faroswap.knownSelectors[selector], tx.input]));
    console.log("```");
  } else if (selector === "0xd0e30db0") {
    console.log("");
    console.log("Action: wrap native PROS into WPROS via deposit()");
  } else if (selector === "0x2e1a7d4d") {
    const words = hexWords(`0x${tx.input.slice(10)}`);
    const amount = words[0] ? wordToBigInt(words[0]) : 0n;
    console.log("");
    console.log(`Action: unwrap ${formatUnits(amount, 18)} WPROS into native PROS via withdraw(uint256)`);
  }

  const transfers = [];
  const orders = [];
  for (const log of receipt.logs || []) {
    const eventName = faroswap.knownEvents[(log.topics || [])[0]];
    if (eventName?.startsWith("OrderHistory")) {
      const row = decodeOrderHistory(log, network.name);
      if (row) orders.push(row);
    } else if (eventName?.startsWith("Transfer")) {
      const row = decodeTransfer(log, network.name);
      if (row) transfers.push(row);
    }
  }
  if (transfers.length) {
    console.log("");
    console.log("Known transfers:");
    printTable(transfers);
  }
  if (orders.length) {
    console.log("");
    console.log("Order history:");
    printTable(orders);
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
