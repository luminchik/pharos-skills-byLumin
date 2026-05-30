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
  console.log("Options:");
  console.log("  --json  Print machine-readable output");
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
const jsonMode = Boolean(args.json);

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

const privateKey = discoverPrivateKey();
let privateKeyStatus = {};
if (!privateKey) {
  privateKeyStatus = { found: false, message: "not found; read-only workflows are available" };
} else if (!hasCast) {
  privateKeyStatus = { found: true, source: privateKey.source, address: "", message: "address derivation skipped because cast is missing" };
} else {
  try {
    const address = runCast(["wallet", "address", "--private-key", privateKey.value]);
    privateKeyStatus = { found: true, source: privateKey.source, address, message: "address derived" };
  } catch (error) {
    privateKeyStatus = { found: true, source: privateKey.source, address: "", message: `address derivation failed: ${error.message}` };
  }
}

const installFoundry = [
  "macOS/Linux: curl -L https://foundry.paradigm.xyz | bash && foundryup",
  "Windows: install Git Bash, run the same installer, and add %USERPROFILE%\\.foundry\\bin to PATH"
];

if (jsonMode) {
  console.log(JSON.stringify({
    ok: hasCast && networkRows.every((row) => row.Status === "ok"),
    platform: `${process.platform} ${process.arch}`,
    node: process.version,
    binaries: binaryRows,
    networks: networkRows,
    privateKey: privateKeyStatus,
    installFoundry: hasCast ? [] : installFoundry
  }, null, 2));
} else {
  console.log("# Pharos Doctor");
  console.log("");
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Node: ${process.version}`);
  console.log("");

  printTable(binaryRows);
  console.log("");
  printTable(networkRows);
  console.log("");

  if (!privateKeyStatus.found) {
    console.log(`Private key: ${privateKeyStatus.message}`);
  } else if (privateKeyStatus.address) {
    console.log(`Private key: found in ${privateKeyStatus.source}, derived address ${privateKeyStatus.address}`);
  } else {
    console.log(`Private key: found in ${privateKeyStatus.source}, ${privateKeyStatus.message}`);
  }

  if (!hasCast) {
    console.log("");
    console.log("Install Foundry:");
    for (const item of installFoundry) console.log(`- ${item}`);
  }
}
