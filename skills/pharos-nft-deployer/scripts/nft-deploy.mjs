#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  copyAsset,
  ensureDir,
  explorerAddress,
  isAddress,
  parseArgs,
  printTable,
  readPrivateKey,
  runCast,
  runForge,
  selectNetwork,
  shellQuote,
  skillRoot
} from "./lib/pharos.mjs";

const CONTRACTS = {
  erc721: {
    file: "PharosERC721.sol",
    contract: "PharosERC721",
    signature: "constructor(string,string,string,string,uint256,address)",
    args: (cfg) => [cfg.name, cfg.symbol, cfg.baseUri, cfg.contractUri, String(cfg.maxSupply), cfg.owner]
  },
  erc1155: {
    file: "PharosERC1155.sol",
    contract: "PharosERC1155",
    signature: "constructor(string,string,string,string,address)",
    args: (cfg) => [cfg.name, cfg.symbol, cfg.uri, cfg.contractUri, cfg.owner]
  }
};

function usage() {
  console.log("Usage:");
  console.log("  node scripts/nft-deploy.mjs --standard erc721 --name \"Demo NFT\" --symbol DNFT --base-uri ipfs://CID/ --owner <address> --network atlantic-testnet");
  console.log("  node scripts/nft-deploy.mjs --standard erc1155 --name \"Demo Items\" --symbol DITEM --uri ipfs://CID/{id}.json --owner <address>");
  console.log("");
  console.log("Options:");
  console.log("  --standard <erc721|erc1155>     Required");
  console.log("  --name <name>                   Required");
  console.log("  --symbol <symbol>               Required");
  console.log("  --owner <address>               Defaults to address derived from PRIVATE_KEY when set");
  console.log("  --base-uri <uri>                ERC721 tokenURI prefix");
  console.log("  --uri <uri>                     ERC1155 uri, may contain {id}");
  console.log("  --contract-uri <uri>            Optional collection metadata URI");
  console.log("  --max-supply <n>                ERC721 max supply; 0 means unlimited. Default: 0");
  console.log("  --network <name>                Default: atlantic-testnet");
  console.log("  --project <dir>                 Generated Foundry workspace. Default: OS temp directory");
  console.log("  --broadcast                     Actually send deployment transaction");
  console.log("  --confirm <text>                Required with --broadcast. Use CONFIRM_TESTNET_DEPLOY or CONFIRM_MAINNET_DEPLOY");
  console.log("  --private-key-file <path>       Optional local secret file for broadcasts");
}

function requireString(value, label) {
  if (!value || String(value).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(value);
}

function deriveOwnerFromPrivateKey(args) {
  try {
    const privateKey = readPrivateKey(args);
    return runCast(["wallet", "address", "--private-key", privateKey]);
  } catch {
    return "";
  }
}

function verifyRpcChain(network) {
  const returned = runCast(["chain-id", "--rpc-url", network.rpcUrl]).trim();
  if (String(returned) !== String(network.chainId)) {
    throw new Error(`RPC chain id mismatch for ${network.name}: expected ${network.chainId}, got ${returned}`);
  }
  return returned;
}

function getDeployerPreflight(privateKey, network) {
  const deployer = runCast(["wallet", "address", "--private-key", privateKey]).trim();
  const balanceWei = runCast(["balance", deployer, "--rpc-url", network.rpcUrl]).trim();
  const balanceNative = runCast(["balance", deployer, "--rpc-url", network.rpcUrl, "--ether"]).trim();
  return { deployer, balanceWei, balanceNative };
}

function writeFoundryProject(projectDir) {
  ensureDir(projectDir);
  ensureDir(path.join(projectDir, "src"));
  ensureDir(path.join(projectDir, "deployments"));

  copyAsset("assets/contracts/PharosERC721.sol", path.join(projectDir, "src", "PharosERC721.sol"));
  copyAsset("assets/contracts/PharosERC1155.sol", path.join(projectDir, "src", "PharosERC1155.sol"));

  const foundryToml = [
    "[profile.default]",
    "src = \"src\"",
    "out = \"out\"",
    "libs = []",
    "solc_version = \"0.8.20\"",
    "optimizer = true",
    "optimizer_runs = 200",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(projectDir, "foundry.toml"), foundryToml, "utf8");
}

function getBytecode(projectDir, contractInfo) {
  return runForge([
    "inspect",
    `src/${contractInfo.file}:${contractInfo.contract}`,
    "bytecode",
    "--root",
    projectDir
  ]);
}

function encodeConstructor(contractInfo, values) {
  return runCast(["abi-encode", contractInfo.signature, ...values]);
}

function parseDeployResult(output) {
  const tx = output.match(/transactionHash\s+([0-9a-fA-Fx]{66})/)?.[1] || output.match(/transaction hash:\s*([0-9a-fA-Fx]{66})/i)?.[1] || "";
  const contractAddress = output.match(/contractAddress\s+(0x[a-fA-F0-9]{40})/)?.[1] || output.match(/contract address:\s*(0x[a-fA-F0-9]{40})/i)?.[1] || "";
  return { tx, contractAddress };
}

function toBashPath(filePath) {
  if (process.platform !== "win32") return filePath;
  const normalized = path.resolve(filePath).replace(/\\/g, "/");
  return normalized.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
}

const args = parseArgs(process.argv.slice(2));

try {
  const standard = String(args.standard || "").toLowerCase();
  if (!CONTRACTS[standard]) {
    usage();
    throw new Error("--standard must be erc721 or erc1155");
  }

  const network = selectNetwork(args.network || undefined);
  const contractInfo = CONTRACTS[standard];
  const owner = args.owner || deriveOwnerFromPrivateKey(args);
  if (!owner || !isAddress(owner)) {
    usage();
    throw new Error("--owner is required when PRIVATE_KEY is not set, and it must be an EVM address");
  }

  const cfg = {
    name: requireString(args.name, "--name"),
    symbol: requireString(args.symbol, "--symbol"),
    owner,
    baseUri: args["base-uri"] || "",
    uri: args.uri || "",
    contractUri: args["contract-uri"] || "",
    maxSupply: args["max-supply"] || "0"
  };

  if (standard === "erc721" && cfg.baseUri === "") {
    console.log("Warning: --base-uri is empty; tokenURI will be the decimal token id only.");
  }
  if (standard === "erc1155" && cfg.uri === "") {
    console.log("Warning: --uri is empty; ERC1155 uri() will return an empty string.");
  }

  const defaultProjectDir = path.join(os.tmpdir(), "pharos-nft-deploy-workspaces", `${standard}-${Date.now()}-${process.pid}`);
  const projectDir = path.resolve(args.project || defaultProjectDir);
  writeFoundryProject(projectDir);
  console.log(`# Pharos NFT Deploy Plan (${standard.toUpperCase()})`);
  console.log("");
  console.log(`Generated Foundry workspace: ${projectDir}`);
  console.log("");

  runForge(["build", "--root", projectDir]);
  const bytecode = getBytecode(projectDir, contractInfo);
  const constructorArgs = encodeConstructor(contractInfo, contractInfo.args(cfg));
  const deployData = `${bytecode}${constructorArgs.replace(/^0x/, "")}`;

  const deploymentFile = path.join(projectDir, "deployments", `${standard}-${network.name}-deploy-calldata.txt`);
  fs.writeFileSync(deploymentFile, deployData, "utf8");

  const rows = [
    { Field: "Network", Value: `${network.name} (${network.nativeToken})` },
    { Field: "Chain ID", Value: String(network.chainId) },
    { Field: "Contract", Value: contractInfo.contract },
    { Field: "Name", Value: cfg.name },
    { Field: "Symbol", Value: cfg.symbol },
    { Field: "Owner", Value: cfg.owner },
    { Field: "Constructor", Value: contractInfo.signature },
    { Field: "Calldata file", Value: deploymentFile }
  ];
  if (standard === "erc721") rows.splice(6, 0, { Field: "Max Supply", Value: String(cfg.maxSupply) });
  printTable(rows);
  console.log("");

  const bashCommand = `cast send --private-key "$PRIVATE_KEY" --rpc-url ${shellQuote(network.rpcUrl)} --create $(cat ${shellQuote(toBashPath(deploymentFile))})`;
  const powershellCommand = `$deployData = Get-Content -Raw ${shellQuote(deploymentFile)}\ncast send --private-key $env:PRIVATE_KEY --rpc-url ${shellQuote(network.rpcUrl)} --create $deployData`;

  console.log("Deploy command preview:");
  console.log("```bash");
  console.log(bashCommand);
  console.log("```");
  console.log("```powershell");
  console.log(powershellCommand);
  console.log("```");

  if (!args.broadcast) {
    console.log("");
    console.log("Build succeeded. Deployment was not broadcast. Add --broadcast with explicit confirmation to send.");
    process.exit(0);
  }

  const expectedConfirm = network.environment === "mainnet" ? "CONFIRM_MAINNET_DEPLOY" : "CONFIRM_TESTNET_DEPLOY";
  if (args.confirm !== expectedConfirm) {
    throw new Error(`--broadcast requires --confirm ${expectedConfirm}`);
  }

  const privateKey = readPrivateKey(args);
  const returnedChainId = verifyRpcChain(network);
  const preflight = getDeployerPreflight(privateKey, network);
  console.log("");
  console.log("Broadcast preflight:");
  printTable([
    { Field: "Deployer", Value: preflight.deployer },
    { Field: "RPC chain id", Value: returnedChainId },
    { Field: `Balance (${network.nativeToken})`, Value: preflight.balanceNative }
  ]);

  if (BigInt(preflight.balanceWei) === 0n) {
    throw new Error(`Deployer ${preflight.deployer} has 0 ${network.nativeToken} on ${network.name}; fund it before --broadcast`);
  }

  console.log("");
  console.log(`Broadcasting deployment to ${network.name}...`);
  const output = runCast([
    "send",
    "--private-key",
    privateKey,
    "--rpc-url",
    network.rpcUrl,
    "--create",
    deployData
  ]);
  console.log(output);
  const parsed = parseDeployResult(output);
  if (parsed.contractAddress) {
    console.log("");
    console.log(`Contract: ${explorerAddress(network, parsed.contractAddress)}`);
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
