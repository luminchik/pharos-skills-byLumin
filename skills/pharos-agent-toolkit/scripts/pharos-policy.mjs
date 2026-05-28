#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  discoverPrivateKey,
  isAddress,
  parseArgs,
  printTable,
  runCast
} from "./lib/pharos.mjs";

function defaultPolicyPath() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (process.env.PHAROS_POLICY_FILE) return process.env.PHAROS_POLICY_FILE;
  if (process.env.CODEX_HOME) return path.join(process.env.CODEX_HOME, "secrets", "pharos_policy.json");
  return path.join(home, ".codex", "secrets", "pharos_policy.json");
}

function usage() {
  console.log(`Usage:
  node scripts/pharos-policy.mjs --show
  node scripts/pharos-policy.mjs --enable --actions bridge,swap --signer 0xWallet --expires-minutes 60
  node scripts/pharos-policy.mjs --enable --permanent --actions bridge,swap --signer 0xWallet
  node scripts/pharos-policy.mjs --disable

Common limits:
  --max-bridge-usdc 0.10    Default bridge USDC per tx
  --bridge-to 8453          Default allowed destination chain IDs
  --max-swap-usdc 1         Default swap USDC input per tx
  --max-swap-pros 0.01      Default swap PROS input per tx

Use --permanent or --expires never only when the user explicitly asks for permanent mainnet access. Amount, signer, action, and route limits still apply.

Policy path defaults to ~/.codex/secrets/pharos_policy.json or PHAROS_POLICY_FILE.`);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function splitCsv(value, fallback = []) {
  if (!value) return fallback;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitNumbers(value, fallback = []) {
  return splitCsv(value, fallback).map((item) => Number(item));
}

function resolveSigner(args) {
  if (args.signer) {
    if (!isAddress(args.signer)) throw new Error("--signer must be an EVM address");
    return args.signer;
  }
  const discovered = discoverPrivateKey();
  if (!discovered) throw new Error("--signer is required when no private key is discoverable");
  return runCast(["wallet", "address", "--private-key", discovered.value]).trim();
}

function buildActions(args) {
  const requested = splitCsv(args.actions, ["bridge", "swap"]).map((item) => item.toLowerCase());
  const actions = {};
  if (requested.includes("bridge")) {
    actions.bridge = {
      enabled: true,
      allowedFromChains: splitNumbers(args["bridge-from"], [1672]),
      allowedToChains: splitNumbers(args["bridge-to"], [8453]),
      allowedTools: splitCsv(args["bridge-tools"], []),
      maxAmount: {
        USDC: String(args["max-bridge-usdc"] || "0.10"),
        PROS: String(args["max-bridge-pros"] || "0.01")
      }
    };
  }
  if (requested.includes("swap")) {
    actions.swap = {
      enabled: true,
      maxInputAmount: {
        USDC: String(args["max-swap-usdc"] || "1"),
        PROS: String(args["max-swap-pros"] || "0.01"),
        WPROS: String(args["max-swap-wpros"] || args["max-swap-pros"] || "0.01")
      }
    };
  }
  return actions;
}

function isPermanentRequest(args) {
  const expires = String(args.expires || args.expiry || "").trim().toLowerCase();
  return args.permanent === true || expires === "never" || expires === "permanent";
}

function expiryForArgs(args) {
  if (isPermanentRequest(args)) {
    return {
      expiresAt: "",
      permanent: true
    };
  }
  const expiresMinutes = Number(args["expires-minutes"] || 60);
  if (!Number.isFinite(expiresMinutes) || expiresMinutes <= 0) {
    throw new Error("--expires-minutes must be a positive number, or use --permanent / --expires never");
  }
  return {
    expiresAt: new Date(Date.now() + expiresMinutes * 60 * 1000).toISOString(),
    permanent: false
  };
}

function formatExpiry(autoConfirm = {}) {
  if (autoConfirm.permanent === true || (!autoConfirm.expiresAt && autoConfirm.enabled === true)) {
    return "never (permanent)";
  }
  return autoConfirm.expiresAt || "-";
}

const args = parseArgs(process.argv.slice(2));

try {
  if (args.help || args.h) {
    usage();
    process.exit(0);
  }

  const policyPath = path.resolve(args.policy || defaultPolicyPath());
  const existing = readJson(policyPath);

  if (args.show || (!args.enable && !args.disable)) {
    console.log("# Pharos Policy");
    console.log("");
    if (!existing) {
      console.log(`No policy file found at ${policyPath}`);
      process.exit(0);
    }
    printTable([
      { Field: "Path", Value: policyPath },
      { Field: "Enabled", Value: String(existing.mainnet?.autoConfirm?.enabled === true) },
      { Field: "Expires", Value: formatExpiry(existing.mainnet?.autoConfirm) },
      { Field: "Signer", Value: existing.mainnet?.autoConfirm?.allowedSigner || "-" },
      { Field: "Actions", Value: Object.keys(existing.mainnet?.autoConfirm?.actions || {}).join(", ") || "-" }
    ]);
    process.exit(0);
  }

  if (args.disable) {
    const next = existing || { version: 1 };
    next.updatedAt = new Date().toISOString();
    next.mainnet = next.mainnet || {};
    next.mainnet.autoConfirm = {
      ...(typeof next.mainnet.autoConfirm === "object" ? next.mainnet.autoConfirm : {}),
      enabled: false
    };
    writeJson(policyPath, next);
    console.log(`Disabled mainnet auto-confirm policy: ${policyPath}`);
    process.exit(0);
  }

  const signer = resolveSigner(args);
  const expiry = expiryForArgs(args);

  const policy = {
    version: 1,
    updatedAt: new Date().toISOString(),
    mainnet: {
      autoConfirm: {
        enabled: true,
        permanent: expiry.permanent,
        expiresAt: expiry.expiresAt,
        allowedSigner: signer,
        actions: buildActions(args)
      }
    }
  };

  writeJson(policyPath, policy);
  console.log("# Pharos Mainnet Auto-Confirm Policy");
  console.log("");
  printTable([
    { Field: "Path", Value: policyPath },
    { Field: "Enabled", Value: "true" },
    { Field: "Expires", Value: formatExpiry(policy.mainnet.autoConfirm) },
    { Field: "Signer", Value: signer },
    { Field: "Actions", Value: Object.keys(policy.mainnet.autoConfirm.actions).join(", ") }
  ]);
  console.log("");
  console.log("Policy is local. It does not broadcast by itself; write scripts still require --broadcast and enforce amount/signer limits.");
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
