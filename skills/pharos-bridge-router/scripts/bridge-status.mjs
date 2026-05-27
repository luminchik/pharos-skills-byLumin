#!/usr/bin/env node
import {
  enrichChain,
  explorerTx,
  fetchJson,
  isTxHash,
  loadProviders,
  parseArgs,
  printTable,
  resolveLocalChain
} from "./lib/bridge.mjs";

function usage() {
  console.log(`Usage:
  node scripts/bridge-status.mjs --provider lifi --tx <source_tx> --from-chain pharos --to-chain base
  node scripts/bridge-status.mjs --provider ccip --message-id <ccip_message_id>

Providers:
  lifi, jumper        Jumper / LI.FI transaction status
  ccip, transporter   Transporter / Chainlink CCIP message status`);
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
  throw new Error(`Unsupported provider "${args.provider}". Use lifi or ccip.`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});

