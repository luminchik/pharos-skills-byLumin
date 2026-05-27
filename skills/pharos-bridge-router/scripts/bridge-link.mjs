#!/usr/bin/env node
import { parseArgs, printTable, resolveLocalChain } from "./lib/bridge.mjs";

function usage() {
  console.log(`Usage:
  node scripts/bridge-link.mjs --provider jumper --from pharos --to base --from-token PROS --to-token PROS
  node scripts/bridge-link.mjs --provider transporter --from pharos --to base`);
}

function chainSlug(chain, provider) {
  if (provider === "jumper") return String(chain.id);
  if (chain.key === "ethereum") return "ethereum";
  if (chain.key === "arbitrum") return "arbitrum";
  if (chain.key === "avalanche") return "avalanche";
  if (chain.key === "bsc") return "bsc";
  if (chain.key === "polygon") return "polygon";
  if (chain.key === "optimism") return "optimism";
  return chain.key;
}

function tokenParam(token) {
  if (!token) return "";
  const text = String(token);
  if (text.toLowerCase() === "native") return "0x0000000000000000000000000000000000000000";
  return text;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }
  const provider = String(args.provider || "jumper").toLowerCase();
  const from = resolveLocalChain(args.from || "pharos");
  const to = resolveLocalChain(args.to || "base");
  let url;
  if (provider === "jumper" || provider === "lifi") {
    const params = new URLSearchParams({
      fromChain: chainSlug(from, "jumper"),
      toChain: chainSlug(to, "jumper")
    });
    if (args["from-token"]) params.set("fromToken", tokenParam(args["from-token"]));
    if (args["to-token"]) params.set("toToken", tokenParam(args["to-token"]));
    url = `https://jumper.xyz/?${params.toString()}`;
  } else if (provider === "transporter" || provider === "ccip") {
    const params = new URLSearchParams({
      from: chainSlug(from, "transporter"),
      tab: "token",
      to: chainSlug(to, "transporter")
    });
    url = `https://app.transporter.io/?${params.toString()}`;
  } else {
    throw new Error(`Unsupported provider "${args.provider}". Use jumper or transporter.`);
  }

  console.log("# Bridge App Link");
  console.log("");
  printTable([
    { Field: "Provider", Value: provider === "jumper" || provider === "lifi" ? "Jumper / LI.FI" : "Transporter / CCIP" },
    { Field: "Route", Value: `${from.name} (${from.id}) -> ${to.name} (${to.id})` },
    { Field: "URL", Value: url }
  ]);
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

