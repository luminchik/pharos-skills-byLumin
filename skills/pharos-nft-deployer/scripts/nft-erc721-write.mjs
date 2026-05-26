#!/usr/bin/env node
import {
  explorerTx,
  isAddress,
  parseArgs,
  printTable,
  runCast,
  selectNetwork,
  shellQuote
} from "./lib/pharos.mjs";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/nft-erc721-write.mjs --contract <erc721> --set-base-uri ipfs://METADATA_CID/ --mint-to <address> --network mainnet");
  console.log("  node scripts/nft-erc721-write.mjs --contract <erc721> --set-base-uri ipfs://METADATA_CID/ --mint-to <address> --network mainnet --broadcast --confirm CONFIRM_MAINNET_NFT_WRITE");
  console.log("");
  console.log("Options:");
  console.log("  --contract <address>            Required deployed ERC721 contract");
  console.log("  --set-base-uri <uri>            Optional owner-only setBaseURI(string)");
  console.log("  --set-contract-uri <uri>        Optional owner-only setContractURI(string)");
  console.log("  --mint-to <address>             Optional mint recipient");
  console.log("  --token-id <n>                  Optional explicit token id; calls mintTo(address,uint256)");
  console.log("  --network <name>                Default: atlantic-testnet");
  console.log("  --broadcast                     Execute writes; otherwise print commands only");
  console.log("  --confirm <text>                CONFIRM_TESTNET_NFT_WRITE or CONFIRM_MAINNET_NFT_WRITE");
}

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function verifyRpcChain(network) {
  const returned = runCast(["chain-id", "--rpc-url", network.rpcUrl]).trim();
  if (String(returned) !== String(network.chainId)) {
    throw new Error(`RPC chain id mismatch for ${network.name}: expected ${network.chainId}, got ${returned}`);
  }
  return returned;
}

function preflight(network, contract, privateKey) {
  const chainId = verifyRpcChain(network);
  const deployer = runCast(["wallet", "address", "--private-key", privateKey]).trim();
  const balance = runCast(["balance", deployer, "--rpc-url", network.rpcUrl, "--ether"]).trim();
  const code = runCast(["code", contract, "--rpc-url", network.rpcUrl]).trim();
  if (!code || code === "0x") {
    throw new Error(`No contract code at ${contract} on ${network.name}`);
  }
  const owner = runCast(["call", contract, "owner()(address)", "--rpc-url", network.rpcUrl]).trim();
  if (normalizeAddress(owner) !== normalizeAddress(deployer)) {
    throw new Error(`PRIVATE_KEY address ${deployer} is not contract owner ${owner}`);
  }
  return { chainId, deployer, owner, balance };
}

function parseTxHash(output) {
  return String(output || "").match(/transactionHash\s+(0x[a-fA-F0-9]{64})/)?.[1] || "";
}

function printCommand(network, contract, signature, values) {
  console.log("```bash");
  console.log(`cast send ${shellQuote(contract)} "${signature}" ${values.map(shellQuote).join(" ")} --private-key "$PRIVATE_KEY" --rpc-url ${shellQuote(network.rpcUrl)}`);
  console.log("```");
  console.log("```powershell");
  console.log(`cast send ${shellQuote(contract)} "${signature}" ${values.map(shellQuote).join(" ")} --private-key $env:PRIVATE_KEY --rpc-url ${shellQuote(network.rpcUrl)}`);
  console.log("```");
}

function sendWrite(network, privateKey, contract, signature, values) {
  const output = runCast([
    "send",
    contract,
    signature,
    ...values,
    "--private-key",
    privateKey,
    "--rpc-url",
    network.rpcUrl
  ]);
  const txHash = parseTxHash(output);
  console.log(output);
  if (txHash) console.log(`Explorer: ${explorerTx(network, txHash)}`);
  return txHash;
}

const args = parseArgs(process.argv.slice(2));

try {
  const contract = args.contract || "";
  if (!isAddress(contract)) {
    usage();
    throw new Error("--contract is required and must be an EVM address");
  }

  const network = selectNetwork(args.network || undefined);
  const actions = [];

  if (args["set-base-uri"]) {
    actions.push({ Label: "setBaseURI", Signature: "setBaseURI(string)", Values: [String(args["set-base-uri"])] });
  }
  if (args["set-contract-uri"]) {
    actions.push({ Label: "setContractURI", Signature: "setContractURI(string)", Values: [String(args["set-contract-uri"])] });
  }
  if (args["mint-to"]) {
    if (!isAddress(args["mint-to"])) throw new Error("--mint-to must be an EVM address");
    if (args["token-id"]) {
      if (!/^\d+$/.test(String(args["token-id"]))) throw new Error("--token-id must be an integer");
      actions.push({ Label: "mintTo", Signature: "mintTo(address,uint256)", Values: [String(args["mint-to"]), String(args["token-id"])] });
    } else {
      actions.push({ Label: "mint", Signature: "mint(address)", Values: [String(args["mint-to"])] });
    }
  }

  if (!actions.length) {
    usage();
    throw new Error("No write action requested");
  }

  console.log("# Pharos ERC721 Metadata/Mint Write Plan");
  console.log("");
  printTable([
    { Field: "Network", Value: `${network.name} (${network.nativeToken})` },
    { Field: "Chain ID", Value: String(network.chainId) },
    { Field: "Contract", Value: contract },
    { Field: "Mode", Value: args.broadcast ? "broadcast" : "preview only" }
  ]);
  console.log("");

  if (!args.broadcast) {
    for (const action of actions) {
      console.log(`${action.Label}:`);
      printCommand(network, contract, action.Signature, action.Values);
    }
    console.log("Add --broadcast with exact confirmation to execute.");
    process.exit(0);
  }

  const privateKey = process.env.PRIVATE_KEY || "";
  if (!privateKey) {
    throw new Error("PRIVATE_KEY must be set for --broadcast");
  }

  const expectedConfirm = network.environment === "mainnet" ? "CONFIRM_MAINNET_NFT_WRITE" : "CONFIRM_TESTNET_NFT_WRITE";
  if (args.confirm !== expectedConfirm) {
    throw new Error(`--broadcast requires --confirm ${expectedConfirm}`);
  }

  const check = preflight(network, contract, privateKey);
  console.log("Broadcast preflight:");
  printTable([
    { Field: "Signer/owner", Value: check.deployer },
    { Field: "RPC chain id", Value: check.chainId },
    { Field: `Balance (${network.nativeToken})`, Value: check.balance }
  ]);

  const txs = [];
  for (const action of actions) {
    console.log("");
    console.log(`Broadcasting ${action.Label}...`);
    txs.push({ Action: action.Label, Tx: sendWrite(network, privateKey, contract, action.Signature, action.Values) || "-" });
  }

  console.log("");
  console.log("Write summary:");
  printTable(txs.map((row) => ({ ...row, Explorer: row.Tx === "-" ? "-" : explorerTx(network, row.Tx) })));
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
