#!/usr/bin/env node
import {
  enrichChain,
  explorerTx,
  fetchJson,
  isTxHash,
  loadCctp,
  loadProviders,
  parseArgs,
  printTable,
  readPrivateKey,
  runCast,
  resolveLocalChain
} from "./lib/bridge.mjs";

function usage() {
  console.log(`Usage:
  node scripts/bridge-status.mjs --provider lifi --tx <source_tx> --from-chain pharos --to-chain base
  node scripts/bridge-status.mjs --provider ccip --message-id <ccip_message_id>
  node scripts/bridge-status.mjs --provider cctp --tx <burn_tx> --from pharos --to base
  node scripts/bridge-status.mjs --provider cctp --tx <burn_tx> --from pharos --to base --mint

Providers:
  lifi, jumper        Jumper / LI.FI transaction status
  ccip, transporter   Transporter / Chainlink CCIP message status
  cctp, circle        Circle CCTP V2 USDC burn/mint status`);
}

async function lifiStatus(args) {
  const txHash = args.tx || args._[0];
  if (!isTxHash(txHash)) throw new Error("--tx must be a valid transaction hash");
  const fromChain = await enrichChain(resolveLocalChain(args["from-chain"] || args.from || "pharos"));
  const toChain = await enrichChain(resolveLocalChain(args["to-chain"] || args.to));
  const providers = loadProviders();
  const params = new URLSearchParams({
    txHash,
    fromChain: String(fromChain.id),
    toChain: String(toChain.id)
  });
  if (args.bridge) params.set("bridge", String(args.bridge));
  const status = await fetchJson(`${providers.lifi.baseUrl}/status?${params.toString()}`);

  console.log("# Jumper / LI.FI Bridge Status");
  console.log("");
  printTable([
    { Field: "Status", Value: status.status || "-" },
    { Field: "Substatus", Value: status.substatus || "-" },
    { Field: "Message", Value: status.substatusMessage || "-" },
    { Field: "Route", Value: `${fromChain.name} (${fromChain.id}) -> ${toChain.name} (${toChain.id})` },
    { Field: "Sending tx", Value: status.sending?.txHash || txHash },
    { Field: "Receiving tx", Value: status.receiving?.txHash || "-" },
    { Field: "Source explorer", Value: explorerTx(fromChain, status.sending?.txHash || txHash) },
    { Field: "Destination explorer", Value: status.receiving?.txHash ? explorerTx(toChain, status.receiving.txHash) : "-" },
    { Field: "Jumper scan", Value: `${providers.lifi.jumperScanTx}${txHash}` }
  ]);
}

async function ccipStatus(args) {
  const messageId = args["message-id"] || args.message || args._[0];
  if (!isTxHash(messageId)) throw new Error("--message-id must be a 32-byte CCIP message id");
  const providers = loadProviders();
  const message = await fetchJson(`${providers.ccip.apiBaseUrl}/messages/${messageId}`);

  console.log("# Transporter / Chainlink CCIP Status");
  console.log("");
  printTable([
    { Field: "Status", Value: message.status || "-" },
    { Field: "Message ID", Value: message.messageId || messageId },
    { Field: "Sequence", Value: message.sequenceNumber || "-" },
    { Field: "Source", Value: `${message.sourceNetworkInfo?.displayName || "-"} (${message.sourceNetworkInfo?.chainId || "-"})` },
    { Field: "Destination", Value: `${message.destNetworkInfo?.displayName || "-"} (${message.destNetworkInfo?.chainId || "-"})` },
    { Field: "Sender", Value: message.sender || "-" },
    { Field: "Receiver", Value: message.receiver || "-" },
    { Field: "Send tx", Value: message.sendTransactionHash || "-" },
    { Field: "Receive tx", Value: message.receiptTransactionHash || "-" },
    { Field: "CCIP explorer", Value: `${providers.ccip.messageUrl}${messageId}` }
  ]);
}

function resolveCctpChain(input, config) {
  if (!input) throw new Error("CCTP chain is required");
  const text = String(input).trim().toLowerCase();
  const numeric = Number(text);
  const chain = config.chains.find((item) => {
    const aliases = item.aliases || [];
    return item.key.toLowerCase() === text ||
      item.name.toLowerCase() === text ||
      aliases.map((alias) => alias.toLowerCase()).includes(text) ||
      item.chainId === numeric ||
      item.domain === numeric;
  });
  if (!chain) throw new Error(`Unsupported CCTP chain "${input}"`);
  return chain;
}

function extractDestinationDomain(message) {
  return Number(
    message.destinationDomain ||
    message.decodedMessage?.destinationDomain ||
    message.decodedMessageBody?.destinationDomain ||
    message.messageBody?.destinationDomain ||
    0
  );
}

function extractTxHash(output) {
  const matches = String(output || "").match(/0x[a-fA-F0-9]{64}/g) || [];
  return matches.at(-1) || "";
}

function sendCctpMint(toChain, message, privateKey, config) {
  const out = runCast([
    "send",
    config.contracts.messageTransmitterV2,
    "receiveMessage(bytes,bytes)",
    message.message,
    message.attestation,
    "--private-key",
    privateKey,
    "--rpc-url",
    toChain.rpcUrl
  ]);
  return extractTxHash(out);
}

async function cctpStatus(args) {
  const txHash = args.tx || args._[0];
  if (!isTxHash(txHash)) throw new Error("--tx must be a valid CCTP burn transaction hash");
  const config = loadCctp();
  const fromChain = resolveCctpChain(args["from-chain"] || args.from || "pharos", config);
  const toChainArg = args["to-chain"] || args.to || "";
  const url = `${config.apiBaseUrl}/messages/${fromChain.domain}?transactionHash=${txHash}`;
  let data = null;
  try {
    data = await fetchJson(url);
  } catch (error) {
    console.log("# Circle CCTP Status");
    console.log("");
    printTable([
      { Field: "Source", Value: `${fromChain.name} domain ${fromChain.domain}` },
      { Field: "Burn tx", Value: txHash },
      { Field: "Status", Value: "not found / pending" },
      { Field: "Iris API", Value: url },
      { Field: "Message", Value: error.details || error.message }
    ]);
    return;
  }
  const messages = data.messages || [];
  const rows = messages.map((message, index) => ({
    Index: String(index),
    Status: message.status || "-",
    "Source domain": String(message.sourceDomain || fromChain.domain),
    "Destination domain": String(extractDestinationDomain(message) || "-"),
    "Attestation": message.attestation && message.attestation !== "PENDING" ? "ready" : "pending",
    "Nonce": message.eventNonce || message.nonce || "-",
    "Message bytes": message.message ? String((message.message.length - 2) / 2) : "-"
  }));

  console.log("# Circle CCTP Status");
  console.log("");
  printTable([
    { Field: "Source", Value: `${fromChain.name} domain ${fromChain.domain}` },
    { Field: "Burn tx", Value: txHash },
    { Field: "Iris API", Value: url }
  ]);
  console.log("");
  printTable(rows.length ? rows : [{ Status: "no messages returned" }]);

  if (!args.mint) return;
  const ready = messages.find((message) =>
    String(message.status || "").toLowerCase() === "complete" &&
    message.attestation &&
    message.attestation !== "PENDING" &&
    message.message
  );
  if (!ready) throw new Error("No complete CCTP attestation is ready yet");
  const destinationDomain = extractDestinationDomain(ready);
  const toChain = toChainArg
    ? resolveCctpChain(toChainArg, config)
    : config.chains.find((item) => item.domain === destinationDomain);
  if (!toChain) throw new Error(`Could not resolve destination domain ${destinationDomain}; pass --to <chain>`);
  const privateKey = readPrivateKey(args);
  const signer = runCast(["wallet", "address", "--private-key", privateKey]).trim();
  const gas = BigInt(runCast(["balance", signer, "--rpc-url", toChain.rpcUrl]).trim());
  if (gas === 0n) throw new Error(`Signer ${signer} has 0 ${toChain.nativeSymbol}; cannot mint on ${toChain.name}`);
  const mintTx = sendCctpMint(toChain, ready, privateKey, config);
  console.log("");
  printTable([
    { Field: "Mint tx", Value: mintTx },
    { Field: "Destination explorer", Value: `${toChain.explorerUrl.replace(/\/+$/, "")}/tx/${mintTx}` }
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }
  const provider = String(args.provider || "lifi").toLowerCase();
  if (provider === "lifi" || provider === "jumper") {
    await lifiStatus(args);
    return;
  }
  if (provider === "ccip" || provider === "transporter") {
    await ccipStatus(args);
    return;
  }
  if (provider === "cctp" || provider === "circle") {
    await cctpStatus(args);
    return;
  }
  throw new Error(`Unsupported provider "${args.provider}". Use lifi, ccip, or cctp.`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
