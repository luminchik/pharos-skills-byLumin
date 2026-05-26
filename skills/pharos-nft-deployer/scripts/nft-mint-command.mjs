#!/usr/bin/env node
import { isAddress, parseArgs, selectNetwork, shellQuote } from "./lib/pharos.mjs";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/nft-mint-command.mjs --standard erc721 --contract <address> --to <address> --network atlantic-testnet");
  console.log("  node scripts/nft-mint-command.mjs --standard erc1155 --contract <address> --to <address> --token-id 1 --amount 10 --network mainnet");
}

const args = parseArgs(process.argv.slice(2));
const standard = String(args.standard || "").toLowerCase();
const contract = args.contract;
const to = args.to;

if (!["erc721", "erc1155"].includes(standard) || !isAddress(contract) || !isAddress(to)) {
  usage();
  process.exit(1);
}

const network = selectNetwork(args.network || undefined);

let signature;
let values;
if (standard === "erc721") {
  signature = "mint(address)";
  values = [to];
} else {
  signature = "mint(address,uint256,uint256)";
  values = [to, String(args["token-id"] || "1"), String(args.amount || "1")];
}

const bash = `cast send ${shellQuote(contract)} "${signature}" ${values.map(shellQuote).join(" ")} --private-key "$PRIVATE_KEY" --rpc-url ${shellQuote(network.rpcUrl)}`;
const powershell = `cast send ${shellQuote(contract)} "${signature}" ${values.map(shellQuote).join(" ")} --private-key $env:PRIVATE_KEY --rpc-url ${shellQuote(network.rpcUrl)}`;

console.log("# Pharos NFT Mint Command");
console.log("");
console.log(`Network: ${network.name}`);
console.log(`Contract: ${contract}`);
console.log(`Recipient: ${to}`);
console.log("");
console.log("Bash/zsh:");
console.log("```bash");
console.log(bash);
console.log("```");
console.log("PowerShell:");
console.log("```powershell");
console.log(powershell);
console.log("```");
