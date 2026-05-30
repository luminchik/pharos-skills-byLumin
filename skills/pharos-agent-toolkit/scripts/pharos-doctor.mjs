#!/usr/bin/env node
import {
  discoverPrivateKey,
  findBinary,
  loadNetworks,
  parseArgs,
  printTable,
  runBinary,
  runCast
} from "./lib/pharos.mjs";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/pharos-doctor.mjs");
  console.log("");
  console.log("Checks local Foundry tools, Pharos RPC chain IDs, and private-key discovery without printing secrets.");
}

function status(ok) {
  return ok ? "ok" : "missing";
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  usage();
  process.exit(0);
}

console.log("# Pharos Doctor");
console.log("");
console.log(`Platform: ${process.platform} ${process.arch}`);
console.log(`Node: ${process.version}`);
console.log("");

const binaryRows = ["cast", "forge", "bash"].map((name) => {
  const binary = findBinary(name);
  let version = "";
  if (binary) {
    try {
      version = runBinary(name, ["--version"]).split(/\r?\n/)[0];
    } catch (error) {
      version = `version check failed: ${error.message}`;
    }
  }
  return {
    Tool: name,
    Status: status(Boolean(binary)),
    Path: binary || "-",
    Version: version || "-"
  };
});

printTable(binaryRows);
console.log("");

const hasCast = Boolean(findBinary("cast"));
const config = loadNetworks();
const networkRows = [];

for (const network of config.networks) {
  if (!hasCast) {
    networkRows.push({
      Network: network.name,
      Expected: network.chainId,
      Returned: "-",
      Status: "skipped: cast missing"
    });
    continue;
  }

  try {
    const chainId = runCast(["chain-id", "--rpc-url", network.rpcUrl]);
    networkRows.push({
      Network: network.name,
      Expected: network.chainId,
      Returned: chainId,
      Status: Number(chainId) === Number(network.chainId) ? "ok" : "mismatch"
    });
  } catch (error) {
    networkRows.push({
      Network: network.name,
      Expected: network.chainId,
      Returned: "-",
      Status: `error: ${error.message}`
    });
  }
}

printTable(networkRows);
console.log("");

const privateKey = discoverPrivateKey();
if (!privateKey) {
  console.log("Private key: not found; read-only workflows are available");
} else if (!hasCast) {
  console.log(`Private key: found in ${privateKey.source}, address derivation skipped because cast is missing`);
} else {
  try {
    const address = runCast(["wallet", "address", "--private-key", privateKey.value]);
    console.log(`Private key: found in ${privateKey.source}, derived address ${address}`);
  } catch (error) {
    console.log(`Private key: found in ${privateKey.source}, address derivation failed: ${error.message}`);
  }
}

if (!hasCast) {
  console.log("");
  console.log("Install Foundry:");
  console.log("- macOS/Linux: curl -L https://foundry.paradigm.xyz | bash && foundryup");
  console.log("- Windows: install Git Bash, run the same installer, and add %USERPROFILE%\\.foundry\\bin to PATH");
}
