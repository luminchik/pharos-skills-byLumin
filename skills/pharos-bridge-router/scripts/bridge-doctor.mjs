#!/usr/bin/env node
import {
  fetchJson,
  findBinary,
  loadProviders,
  printTable,
  runCast
} from "./lib/bridge.mjs";

function codeStatus(address, rpcUrl) {
  try {
    const code = runCast(["code", address, "--rpc-url", rpcUrl]);
    return code && code !== "0x" ? `${Math.max(0, code.length - 2)} hex chars` : "no code";
  } catch (error) {
    return `error: ${error.message}`;
  }
}

async function main() {
  const providers = loadProviders();
  const chains = await fetchJson(`${providers.lifi.baseUrl}/chains`);
  const pharos = (chains.chains || []).find((chain) => chain.id === 1672);
  const tokens = await fetchJson(`${providers.lifi.baseUrl}/tokens?chains=1672`);
  const pharosTokens = tokens.tokens?.["1672"] || [];

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
    { Check: "CCIP destinations", Status: providers.ccip.pharos.supportedDestinationNames.join(", ") }
  ]);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});

