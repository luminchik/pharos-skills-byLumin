#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs, printTable } from "./lib/pharos.mjs";

const DEFAULT_ENDPOINT = "https://ipfs.oversas.org/api/v0/add";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/nft-ipfs-upload.mjs --dir ./metadata --allow-public-upload");
  console.log("  node scripts/nft-ipfs-upload.mjs --dir ./metadata --endpoint https://host/api/v0/add --allow-public-upload");
  console.log("");
  console.log("Options:");
  console.log("  --dir <path>                    Required directory containing NFT metadata");
  console.log("  --endpoint <url>                IPFS RPC add endpoint. Default: public Oversas endpoint");
  console.log("  --allow-public-upload           Required. Confirms files may be uploaded to the endpoint");
}

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function toUnixPath(value) {
  return value.split(path.sep).join("/");
}

function parseIpfsAddOutput(text) {
  const rows = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // Some RPC implementations return a plain hash in quiet mode.
      if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]+)$/i.test(trimmed)) {
        rows.push({ Name: "", Hash: trimmed, Size: "" });
      }
    }
  }
  return rows;
}

const args = parseArgs(process.argv.slice(2));

try {
  if (args.help || args.h) {
    usage();
    process.exit(0);
  }

  const dir = args.dir ? path.resolve(args.dir) : "";
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    usage();
    throw new Error("--dir is required and must be a directory");
  }
  if (!args["allow-public-upload"]) {
    usage();
    throw new Error("--allow-public-upload is required before uploading user files");
  }

  const endpoint = args.endpoint || DEFAULT_ENDPOINT;
  const files = walkFiles(dir);
  if (!files.length) throw new Error(`No files found in ${dir}`);

  const form = new FormData();
  for (const filePath of files) {
    const relative = toUnixPath(path.relative(dir, filePath));
    const bytes = fs.readFileSync(filePath);
    form.append("file", new Blob([bytes]), relative);
  }

  const url = new URL(endpoint);
  url.searchParams.set("pin", "true");
  url.searchParams.set("wrap-with-directory", "true");

  console.log("# Pharos NFT IPFS Upload");
  console.log("");
  console.log(`Directory: ${dir}`);
  console.log(`Endpoint: ${url.origin}${url.pathname}`);
  console.log(`Files: ${files.length}`);
  console.log("");

  const response = await fetch(url, { method: "POST", body: form });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`IPFS upload failed: HTTP ${response.status} ${body.slice(0, 500)}`);
  }

  const rows = parseIpfsAddOutput(body);
  if (!rows.length) {
    throw new Error(`IPFS upload returned an unrecognized response: ${body.slice(0, 500)}`);
  }

  const root = rows[rows.length - 1];
  const cid = root.Hash;
  if (!cid) throw new Error("IPFS upload did not return a root hash");
  const baseUri = `ipfs://${cid}/`;
  const gateway = `https://ipfs.oversas.org/ipfs/${cid}/`;

  printTable([
    { Field: "Root CID", Value: cid },
    { Field: "setBaseURI", Value: baseUri },
    { Field: "Gateway", Value: gateway }
  ]);
  console.log("");
  console.log("Uploaded files:");
  printTable(rows.map((row) => ({
    Name: row.Name || "(root)",
    Hash: row.Hash || "-",
    Size: String(row.Size || "-")
  })));
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
