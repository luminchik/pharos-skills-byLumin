#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDir, isAddress, parseArgs, printTable, selectNetwork, shellQuote } from "./lib/pharos.mjs";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/nft-metadata.mjs --image <path|ipfs://...|https://...> --token-id 1 --name \"Token #1\"");
  console.log("  node scripts/nft-metadata.mjs --image ./art.png --image-base-uri ipfs://IMAGE_FOLDER_CID/ --metadata-base-uri ipfs://METADATA_FOLDER_CID/ --contract <erc721> --to <recipient> --network mainnet");
  console.log("");
  console.log("Options:");
  console.log("  --image <path|uri>              Required. User-supplied image file or uploaded image URI");
  console.log("  --image-uri <uri>               Override metadata image URI");
  console.log("  --image-base-uri <uri>          Prefix for local image filename after upload");
  console.log("  --metadata-base-uri <uri>       URI folder containing <token-id>.json, used for setBaseURI command");
  console.log("  --output <dir>                  Metadata bundle output. Default: OS temp directory");
  console.log("  --token-id <n>                  Default: 1");
  console.log("  --name <text>                   Token name. Default: NFT #<token-id>");
  console.log("  --description <text>            Token description");
  console.log("  --attributes-json <json|path>   Optional OpenSea-style attributes array");
  console.log("  --collection-name <text>        Optional collection metadata name");
  console.log("  --collection-description <text> Optional collection metadata description");
  console.log("  --contract <address>            Optional deployed ERC721 contract for command preview");
  console.log("  --to <address>                  Optional mint recipient for command preview");
  console.log("  --network <name>                Default: atlantic-testnet");
}

function isRemoteUri(value) {
  return /^(ipfs|ar|https?):\/\//i.test(String(value || ""));
}

function appendSlash(value) {
  return String(value || "").endsWith("/") ? String(value) : `${value}/`;
}

function safeBasename(filePath) {
  return path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, "-");
}

function readAttributes(value) {
  if (!value) return undefined;
  const raw = fs.existsSync(value) ? fs.readFileSync(value, "utf8") : value;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("--attributes-json must be a JSON array or a file containing a JSON array");
  }
  return parsed;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function commandPreviews(network, contract, to, metadataBaseUri) {
  if (!contract && !to) return;
  console.log("");
  console.log("Command previews:");

  if (contract && metadataBaseUri) {
    console.log("```bash");
    console.log(`cast send ${shellQuote(contract)} "setBaseURI(string)" ${shellQuote(metadataBaseUri)} --private-key "$PRIVATE_KEY" --rpc-url ${shellQuote(network.rpcUrl)}`);
    console.log("```");
    console.log("```powershell");
    console.log(`cast send ${shellQuote(contract)} "setBaseURI(string)" ${shellQuote(metadataBaseUri)} --private-key $env:PRIVATE_KEY --rpc-url ${shellQuote(network.rpcUrl)}`);
    console.log("```");
  }

  if (contract && to) {
    console.log("```bash");
    console.log(`cast send ${shellQuote(contract)} "mint(address)" ${shellQuote(to)} --private-key "$PRIVATE_KEY" --rpc-url ${shellQuote(network.rpcUrl)}`);
    console.log("```");
    console.log("```powershell");
    console.log(`cast send ${shellQuote(contract)} "mint(address)" ${shellQuote(to)} --private-key $env:PRIVATE_KEY --rpc-url ${shellQuote(network.rpcUrl)}`);
    console.log("```");
  }
}

const args = parseArgs(process.argv.slice(2));

try {
  if (args.help || args.h) {
    usage();
    process.exit(0);
  }

  const image = args.image;
  if (!image) {
    usage();
    throw new Error("--image is required");
  }

  const tokenId = String(args["token-id"] || "1");
  if (!/^\d+$/.test(tokenId) || BigInt(tokenId) === 0n) {
    throw new Error("--token-id must be a positive integer");
  }

  const outputDir = path.resolve(args.output || path.join(os.tmpdir(), "pharos-nft-metadata", `${Date.now()}-${process.pid}`));
  const imagesDir = path.join(outputDir, "images");
  ensureDir(outputDir);

  let imageUri = args["image-uri"] || "";
  let copiedImage = "";
  if (!imageUri) {
    if (isRemoteUri(image)) {
      imageUri = image;
    } else {
      const imagePath = path.resolve(image);
      if (!fs.existsSync(imagePath)) {
        throw new Error(`Image file not found: ${imagePath}`);
      }
      ensureDir(imagesDir);
      const basename = safeBasename(imagePath);
      copiedImage = path.join(imagesDir, basename);
      fs.copyFileSync(imagePath, copiedImage);
      imageUri = args["image-base-uri"]
        ? `${appendSlash(args["image-base-uri"])}${basename}`
        : `images/${basename}`;
    }
  }

  const name = args.name || `NFT #${tokenId}`;
  const description = args.description || "";
  const metadata = {
    name,
    description,
    image: imageUri
  };
  if (args["external-url"]) metadata.external_url = args["external-url"];
  if (args["animation-url"]) metadata.animation_url = args["animation-url"];
  const attributes = readAttributes(args["attributes-json"]);
  if (attributes) metadata.attributes = attributes;

  const tokenFile = path.join(outputDir, tokenId);
  const tokenJsonFile = path.join(outputDir, `${tokenId}.json`);
  writeJson(tokenFile, metadata);
  writeJson(tokenJsonFile, metadata);

  const collection = {
    name: args["collection-name"] || name,
    description: args["collection-description"] || description,
    image: imageUri
  };
  const collectionFile = path.join(outputDir, "collection.json");
  writeJson(collectionFile, collection);

  const metadataBaseUri = args["metadata-base-uri"] ? appendSlash(args["metadata-base-uri"]) : "";
  const network = selectNetwork(args.network || undefined);
  const contract = args.contract || "";
  const to = args.to || "";
  if (contract && !isAddress(contract)) throw new Error("--contract must be an EVM address");
  if (to && !isAddress(to)) throw new Error("--to must be an EVM address");

  console.log("# Pharos NFT Metadata Bundle");
  console.log("");
  console.log(`Output: ${outputDir}`);
  console.log("");
  const rows = [
    { Field: "Token ID", Value: tokenId },
    { Field: "Token metadata", Value: tokenFile },
    { Field: "Token metadata .json copy", Value: tokenJsonFile },
    { Field: "Collection metadata", Value: collectionFile },
    { Field: "Image URI", Value: imageUri }
  ];
  if (copiedImage) rows.push({ Field: "Copied image", Value: copiedImage });
  if (metadataBaseUri) rows.push({ Field: "setBaseURI value", Value: metadataBaseUri });
  printTable(rows);

  console.log("");
  if (!metadataBaseUri) {
    console.log("Upload the output folder to IPFS/Arweave, then use the resulting folder URI as --metadata-base-uri.");
  }
  if (!isRemoteUri(imageUri)) {
    console.log("Image URI is relative. Upload the full metadata folder so token JSON can resolve the image path.");
  }

  commandPreviews(network, contract, to, metadataBaseUri);
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
