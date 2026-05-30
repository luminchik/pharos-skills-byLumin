#!/usr/bin/env node
import {
  explorerAddress,
  ipfsToHttps,
  isAddress,
  parseArgs,
  parseCastBool,
  parseCastString,
  parseCastUint,
  printTable,
  runCast,
  selectNetworks
} from "./lib/pharos.mjs";

const ERC721_ID = "0x80ac58cd";
const ERC1155_ID = "0xd9b67a26";
const ERC721_METADATA_ID = "0x5b5e139f";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/nft-check.mjs --contract <nft> --owner <wallet> --token-id <id> --network mainnet");
  console.log("  node scripts/nft-check.mjs --contract <nft> --owner <wallet> --token-id <id> --standard erc1155 --fetch-metadata");
  console.log("");
  console.log("Options:");
  console.log("  --contract <address>       NFT contract address");
  console.log("  --owner <address>          Wallet to check");
  console.log("  --token-id <id>            Token id for ownerOf/balanceOf/tokenURI/uri");
  console.log("  --network <name|all>       Default: atlantic-testnet");
  console.log("  --standard <auto|erc721|erc1155>  Default: auto");
  console.log("  --fetch-metadata           Fetch http(s)/ipfs JSON metadata when URI is available");
}

function safeCast(args) {
  try {
    return { ok: true, value: runCast(args) };
  } catch (error) {
    return { ok: false, error: error.stderr || error.message };
  }
}

function detectStandard(contract, network, forced) {
  if (forced && forced !== "auto") return forced;

  const erc721 = safeCast([
    "call",
    contract,
    "supportsInterface(bytes4)(bool)",
    ERC721_ID,
    "--rpc-url",
    network.rpcUrl
  ]);
  if (erc721.ok && parseCastBool(erc721.value)) return "erc721";

  const erc1155 = safeCast([
    "call",
    contract,
    "supportsInterface(bytes4)(bool)",
    ERC1155_ID,
    "--rpc-url",
    network.rpcUrl
  ]);
  if (erc1155.ok && parseCastBool(erc1155.value)) return "erc1155";

  return "unknown";
}

function fetchJson(uri) {
  const url = ipfsToHttps(uri);
  if (!/^https?:\/\//i.test(url || "")) {
    return { ok: false, error: "metadata URI is not http(s)/ipfs" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  return fetch(url, { signal: controller.signal })
    .then(async (response) => {
      clearTimeout(timeout);
      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}` };
      }
      const json = await response.json();
      return { ok: true, url, json };
    })
    .catch((error) => {
      clearTimeout(timeout);
      return { ok: false, error: error.message };
    });
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  usage();
  process.exit(0);
}
const contract = args.contract || args._[0];
const owner = args.owner || args._[1];
const tokenId = args["token-id"] || args.tokenId || args._[2];
const standardArg = String(args.standard || "auto").toLowerCase();

if (!contract || !isAddress(contract) || !owner || !isAddress(owner) || tokenId === undefined) {
  usage();
  if (contract && !isAddress(contract)) console.error(`Invalid NFT contract address: ${contract}`);
  if (owner && !isAddress(owner)) console.error(`Invalid owner address: ${owner}`);
  process.exit(1);
}

if (!/^(auto|erc721|erc1155)$/.test(standardArg)) {
  console.error(`Unsupported standard: ${standardArg}`);
  process.exit(1);
}

const networks = selectNetworks(args.network || undefined);
const rows = [];
const metadataTasks = [];

for (const network of networks) {
  const code = safeCast(["code", contract, "--rpc-url", network.rpcUrl]);
  if (!code.ok || !code.value || code.value === "0x") {
    rows.push({
      Network: network.name,
      Standard: "no contract code",
      Contract: explorerAddress(network, contract),
      Owner: owner,
      TokenId: tokenId,
      Result: "contract not found"
    });
    continue;
  }

  const standard = detectStandard(contract, network, standardArg);
  const baseRow = {
    Network: network.name,
    Standard: standard,
    Contract: explorerAddress(network, contract),
    Owner: owner,
    TokenId: tokenId
  };

  if (standard === "erc721") {
    const balance = safeCast([
      "call",
      contract,
      "balanceOf(address)(uint256)",
      owner,
      "--rpc-url",
      network.rpcUrl
    ]);
    const ownerOf = safeCast([
      "call",
      contract,
      "ownerOf(uint256)(address)",
      tokenId,
      "--rpc-url",
      network.rpcUrl
    ]);
    const tokenUri = safeCast([
      "call",
      contract,
      "tokenURI(uint256)(string)",
      tokenId,
      "--rpc-url",
      network.rpcUrl
    ]);

    const currentOwner = ownerOf.ok ? ownerOf.value.trim() : "";
    const ownsToken = currentOwner.toLowerCase() === owner.toLowerCase();
    const uri = tokenUri.ok ? parseCastString(tokenUri.value) : "";
    rows.push({
      ...baseRow,
      WalletBalance: balance.ok ? parseCastUint(balance.value).toString() : "error",
      TokenOwner: currentOwner || "unavailable",
      OwnsToken: ownsToken ? "yes" : "no",
      URI: uri || "-",
      Notes: ownerOf.ok ? "" : "ownerOf failed; contract may not be ERC721"
    });

    if (args["fetch-metadata"] && uri) {
      metadataTasks.push({ network: network.name, tokenId, uri, task: fetchJson(uri) });
    }
  } else if (standard === "erc1155") {
    const balance = safeCast([
      "call",
      contract,
      "balanceOf(address,uint256)(uint256)",
      owner,
      tokenId,
      "--rpc-url",
      network.rpcUrl
    ]);
    const uriCall = safeCast([
      "call",
      contract,
      "uri(uint256)(string)",
      tokenId,
      "--rpc-url",
      network.rpcUrl
    ]);
    const uri = uriCall.ok ? parseCastString(uriCall.value).replace("{id}", String(tokenId)) : "";
    const amount = balance.ok ? parseCastUint(balance.value) : 0n;
    rows.push({
      ...baseRow,
      BalanceOfTokenId: balance.ok ? amount.toString() : "error",
      OwnsToken: amount > 0n ? "yes" : "no",
      URI: uri || "-",
      Notes: balance.ok ? "" : "ERC1155 balanceOf failed; contract may not be ERC1155"
    });

    if (args["fetch-metadata"] && uri) {
      metadataTasks.push({ network: network.name, tokenId, uri, task: fetchJson(uri) });
    }
  } else {
    rows.push({
      ...baseRow,
      Result: "ERC165 did not report ERC721 or ERC1155",
      Hint: "Use --standard erc721 or --standard erc1155 if the contract is non-standard"
    });
  }
}

console.log("# Pharos NFT Ownership Check");
console.log("");
printTable(rows);

if (metadataTasks.length) {
  console.log("");
  console.log("## Metadata");
  for (const item of metadataTasks) {
    const result = await item.task;
    console.log("");
    console.log(`### ${item.network} token ${item.tokenId}`);
    console.log(`URI: ${item.uri}`);
    if (!result.ok) {
      console.log(`Metadata fetch failed: ${result.error}`);
      continue;
    }
    const json = result.json || {};
    if (json.name) console.log(`Name: ${json.name}`);
    if (json.description) console.log(`Description: ${String(json.description).slice(0, 240)}`);
    if (json.image) console.log(`Image: ${ipfsToHttps(json.image)}`);
    console.log(`Fetched: ${result.url}`);
  }
}
