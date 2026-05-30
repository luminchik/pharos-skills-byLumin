#!/usr/bin/env node
import {
  fetchJson,
  findBinary,
  loadCctp,
  loadProviders,
  parseArgs,
  printTable,
  runCast
} from "./lib/bridge.mjs";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/bridge-doctor.mjs");
  console.log("");
  console.log("Checks LI.FI, CCTP, CCIP, local cast, and Pharos bridge contract availability.");
}

function codeStatus(address, rpcUrl) {
  try {
    const code = runCast(["code", address, "--rpc-url", rpcUrl]);
    return code && code !== "0x" ? `${Math.max(0, code.length - 2)} hex chars` : "no code";
  } catch (error) {
    return `error: ${error.message}`;
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  usage();
  process.exit(0);
}

async function main() {
  const providers = loadProviders();
  const cctp = loadCctp();
  const chains = await fetchJson(`${providers.lifi.baseUrl}/chains`);
  const pharos = (chains.chains || []).find((chain) => chain.id === 1672);
  const tokens = await fetchJson(`${providers.lifi.baseUrl}/tokens?chains=1672`);
  const pharosTokens = tokens.tokens?.["1672"] || [];
  const pharosCctp = cctp.chains.find((chain) => chain.key === "pharos");

  console.log("# Pharos Bridge Router Doctor");
  console.log("");
  printTable([
    { Check: "Node.js", Status: process.version },
    { Check: "cast", Status: findBinary("cast") || "missing" },
    { Check: "LI.FI Pharos chain", Status: pharos ? `${pharos.name} (${pharos.id})` : "missing" },
    { Check: "LI.FI Pharos tokens", Status: pharosTokens.map((token) => token.symbol).join(", ") || "none" },
    { Check: "LI.FI diamond code", Status: codeStatus(providers.lifi.pharosDiamond, "https://rpc.pharos.xyz") },
    { Check: "CCIP Pharos router code", Status: codeStatus(providers.ccip.pharos.routerAddress, "https://rpc.pharos.xyz") },
    { Check: "CCIP Pharos selector", Status: providers.ccip.pharos.chainSelector },
    { Check: "CCIP destinations", Status: providers.ccip.pharos.supportedDestinationNames.join(", ") },
    { Check: "CCTP Pharos domain", Status: String(pharosCctp?.domain || "-") },
    { Check: "CCTP Pharos USDC", Status: pharosCctp?.usdc || "-" },
    { Check: "CCTP TokenMessengerV2 code", Status: codeStatus(cctp.contracts.tokenMessengerV2, pharosCctp?.rpcUrl || "https://rpc.pharos.xyz") },
    { Check: "CCTP MessageTransmitterV2 code", Status: codeStatus(cctp.contracts.messageTransmitterV2, pharosCctp?.rpcUrl || "https://rpc.pharos.xyz") },
    { Check: "CCTP supported chains", Status: cctp.chains.map((chain) => chain.key).join(", ") }
  ]);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
