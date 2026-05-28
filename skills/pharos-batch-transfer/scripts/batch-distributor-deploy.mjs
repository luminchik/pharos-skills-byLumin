#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  copyAsset,
  ensureDir,
  explorerAddress,
  parseArgs,
  parseTxHash,
  printTable,
  readPrivateKey,
  runCast,
  runForge,
  selectNetwork,
  shellQuote
} from "./lib/pharos.mjs";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/batch-distributor-deploy.mjs --network mainnet");
  console.log("  node scripts/batch-distributor-deploy.mjs --network mainnet --broadcast --confirm CONFIRM_MAINNET_BATCH_DEPLOY");
  console.log("  Optional: --private-key-file <path> for local secret-file broadcasts");
}

function writeFoundryProject(projectDir) {
  ensureDir(projectDir);
  ensureDir(path.join(projectDir, "src"));
  ensureDir(path.join(projectDir, "deployments"));
  copyAsset("assets/contracts/PharosBatchDistributor.sol", path.join(projectDir, "src", "PharosBatchDistributor.sol"));
  fs.writeFileSync(path.join(projectDir, "foundry.toml"), [
    "[profile.default]",
    "src = \"src\"",
    "out = \"out\"",
    "libs = []",
    "solc_version = \"0.8.20\"",
    "optimizer = true",
    "optimizer_runs = 200",
    ""
  ].join("\n"), "utf8");
}

function parseContractAddress(output) {
  return String(output || "").match(/contractAddress\s+(0x[a-fA-F0-9]{40})/)?.[1] || "";
}

function verifyChain(network) {
  const returned = runCast(["chain-id", "--rpc-url", network.rpcUrl]).trim();
  if (String(returned) !== String(network.chainId)) throw new Error(`RPC chain id mismatch: expected ${network.chainId}, got ${returned}`);
  return returned;
}

const args = parseArgs(process.argv.slice(2));

try {
  if (args.help) {
    usage();
    process.exit(0);
  }

  const network = selectNetwork(args.network || undefined);
  const projectDir = path.resolve(args.project || path.join(os.tmpdir(), "pharos-batch-distributor", `${Date.now()}-${process.pid}`));
  writeFoundryProject(projectDir);
  runForge(["build", "--root", projectDir]);
  const bytecode = runForge(["inspect", "src/PharosBatchDistributor.sol:PharosBatchDistributor", "bytecode", "--root", projectDir]);
  const deploymentFile = path.join(projectDir, "deployments", `batch-distributor-${network.name}-bytecode.txt`);
  fs.writeFileSync(deploymentFile, bytecode, "utf8");

  console.log("# Pharos Batch Distributor Deploy Plan");
  console.log("");
  printTable([
    { Field: "Network", Value: `${network.name} (${network.nativeToken})` },
    { Field: "Chain ID", Value: String(network.chainId) },
    { Field: "Workspace", Value: projectDir },
    { Field: "Bytecode file", Value: deploymentFile },
    { Field: "Broadcast", Value: args.broadcast ? "yes" : "no" }
  ]);
  console.log("");
  console.log("Deploy command preview:");
  console.log("```bash");
  console.log(`cast send --private-key "$PRIVATE_KEY" --rpc-url ${shellQuote(network.rpcUrl)} --create $(cat ${shellQuote(deploymentFile.replace(/\\/g, "/"))})`);
  console.log("```");

  if (!args.broadcast) {
    console.log("Build succeeded. Add --broadcast with exact confirmation to deploy.");
    process.exit(0);
  }

  const expectedConfirm = network.environment === "mainnet" ? "CONFIRM_MAINNET_BATCH_DEPLOY" : "CONFIRM_TESTNET_BATCH_DEPLOY";
  if (args.confirm !== expectedConfirm) throw new Error(`--broadcast requires --confirm ${expectedConfirm}`);

  const privateKey = readPrivateKey(args);
  const chainId = verifyChain(network);
  const signer = runCast(["wallet", "address", "--private-key", privateKey]).trim();
  const balance = runCast(["balance", signer, "--rpc-url", network.rpcUrl, "--ether"]).trim();
  console.log("");
  console.log("Broadcast preflight:");
  printTable([
    { Field: "Signer", Value: signer },
    { Field: "RPC chain id", Value: chainId },
    { Field: `Balance (${network.nativeToken})`, Value: balance }
  ]);

  console.log("");
  console.log("Broadcasting distributor deployment...");
  const output = runCast(["send", "--private-key", privateKey, "--rpc-url", network.rpcUrl, "--create", bytecode]);
  console.log(output);
  const tx = parseTxHash(output);
  const contract = parseContractAddress(output);
  if (contract) console.log(`Distributor: ${explorerAddress(network, contract)}`);
  if (tx) console.log(`Transaction: ${network.explorerUrl.replace(/\/+$/, "")}/tx/${tx}`);
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
