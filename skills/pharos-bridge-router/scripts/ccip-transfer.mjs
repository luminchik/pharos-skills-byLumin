#!/usr/bin/env node
import path from "node:path";
import {
  evaluateMainnetAutoConfirm,
  fetchJson,
  formatUnits,
  isAddress,
  loadCctp,
  loadProviders,
  nowIso,
  parseArgs,
  parseUnits,
  printTable,
  readPolicy,
  readPrivateKey,
  runCast,
  tryReadPrivateKey,
  writeJson
} from "./lib/bridge.mjs";

const CCIP_MESSAGE_SENT_TOPIC = "0x192442a2b2adb6a7948f097023cb6b57d29d3a7a5dd33e6666d33c39cc456f32";
const LEGACY_CCIP_MESSAGE_SENT_TOPIC = "0x0fc8197a4a6dc645375404b6dafe4008197b479f41155708ac2e362e9916ae1d";

function usage() {
  console.log(`Usage:
  node scripts/ccip-transfer.mjs --from pharos --to base --token USDC --amount 0.001 --address 0xWallet
  node scripts/ccip-transfer.mjs --from pharos --to base --token USDC --amount 0.001 --broadcast

Transporter / Chainlink CCIP token transfer:
  - Builds a direct CCIP Router ccipSend token transfer.
  - Pays the CCIP fee in source-chain native token by default.
  - Uses exact ERC20 approval to the source CCIP router.

Broadcast rules:
  - --broadcast is required for a real transaction.
  - Mainnet broadcasts require CONFIRM_MAINNET_BRIDGE or a matching local policy.
  - This script is intentionally narrow: tested first for Pharos -> Base USDC.`);
}

function outputJson(data) {
  console.log(JSON.stringify(jsonSafe(data), null, 2));
}

function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

function parseCastUint(output) {
  const match = String(output || "").match(/\b\d+\b/);
  return match ? BigInt(match[0]) : 0n;
}

function extractTxHash(output) {
  const matches = String(output || "").match(/0x[a-fA-F0-9]{64}/g) || [];
  return matches.at(-1) || "";
}

function resolveCctpChain(input, cctp) {
  if (!input) throw new Error("Chain is required");
  const text = String(input).trim().toLowerCase();
  const numeric = Number(text);
  const chain = cctp.chains.find((item) => {
    const aliases = item.aliases || [];
    return item.key.toLowerCase() === text ||
      item.name.toLowerCase() === text ||
      aliases.map((alias) => alias.toLowerCase()).includes(text) ||
      item.chainId === numeric ||
      item.domain === numeric;
  });
  if (!chain) throw new Error(`Unsupported chain "${input}"`);
  return chain;
}

function resolveCcipChain(chain, providers) {
  const item = providers.ccip[chain.key];
  if (!item?.chainSelector) throw new Error(`No CCIP selector configured for ${chain.key}`);
  return item;
}

function addressToBytes32(address) {
  if (!isAddress(address)) throw new Error(`Invalid EVM address: ${address}`);
  return `0x${"0".repeat(24)}${address.slice(2)}`.toLowerCase();
}

function explorerTx(chain, txHash) {
  if (!txHash || !chain.explorerUrl) return txHash || "-";
  return `${chain.explorerUrl.replace(/\/+$/, "")}/tx/${txHash}`;
}

function balanceOf(chain, token, owner) {
  return parseCastUint(runCast(["call", token.address, "balanceOf(address)(uint256)", owner, "--rpc-url", chain.rpcUrl]));
}

function allowanceOf(chain, token, owner, spender) {
  return parseCastUint(runCast(["call", token.address, "allowance(address,address)(uint256)", owner, spender, "--rpc-url", chain.rpcUrl]));
}

function nativeBalance(chain, owner) {
  return BigInt(runCast(["balance", owner, "--rpc-url", chain.rpcUrl]).trim());
}

function resolveToken(args, from, to) {
  const token = String(args.token || args["from-token"] || "USDC").toUpperCase();
  if (token !== "USDC") {
    if (!isAddress(args["token-address"]) || !args.decimals) {
      throw new Error("Only USDC is built in. For custom tokens pass --token-address and --decimals.");
    }
    return {
      symbol: args.token || args["token-symbol"] || args["token-address"],
      decimals: Number(args.decimals),
      address: args["token-address"],
      destinationAddress: args["destination-token-address"] || args["token-address"]
    };
  }
  return {
    symbol: "USDC",
    decimals: 6,
    address: from.usdc,
    destinationAddress: to.usdc
  };
}

function knownUnsupportedRoute(providers, from, to, token) {
  const routes = providers.ccip.knownUnsupportedTokenRoutes || [];
  const match = routes.find((item) =>
    String(item.from || "").toLowerCase() === from.key.toLowerCase() &&
    String(item.to || "").toLowerCase() === to.key.toLowerCase() &&
    String(item.token || "").toLowerCase() === token.symbol.toLowerCase()
  );
  return match || null;
}

function ccipMessageTuple(plan) {
  return `(${plan.receiverBytes},${plan.data},[(${plan.token.address},${plan.amountBase})],${plan.feeToken},${plan.extraArgs})`;
}

function quoteFee(plan) {
  return parseCastUint(runCast([
    "call",
    plan.sourceCcip.routerAddress,
    "getFee(uint64,(bytes,bytes,(address,uint256)[],address,bytes))(uint256)",
    plan.destinationCcip.chainSelector,
    ccipMessageTuple(plan),
    "--rpc-url",
    plan.fromChain.rpcUrl
  ]));
}

function buildPlan(args) {
  const cctp = loadCctp();
  const providers = loadProviders();
  const from = resolveCctpChain(args.from || "pharos", cctp);
  const to = resolveCctpChain(args.to || "base", cctp);
  const sourceCcip = resolveCcipChain(from, providers);
  const destinationCcip = resolveCcipChain(to, providers);
  if (!args.amount) throw new Error("--amount is required");

  const privateKey = tryReadPrivateKey(args);
  const derivedAddress = privateKey ? runCast(["wallet", "address", "--private-key", privateKey]).trim() : "";
  const fromAddress = args["from-address"] || args.address || derivedAddress;
  const toAddress = args["to-address"] || args.address || fromAddress;
  if (!isAddress(fromAddress)) throw new Error("--address or a discoverable private key is required");
  if (!isAddress(toAddress)) throw new Error("--to-address must be a valid EVM address");

  const token = resolveToken(args, from, to);
  const amountBase = parseUnits(args.amount, token.decimals);
  const plan = {
    schema: "pharos-bridge-router-ccip-plan/v1",
    provider: "chainlink-ccip",
    createdAt: nowIso(),
    fromChain: from,
    toChain: to,
    sourceCcip,
    destinationCcip,
    token,
    fromAddress,
    toAddress,
    receiverBytes: args.receiver || addressToBytes32(toAddress),
    data: args.data || "0x",
    feeToken: args["fee-token"] || "0x0000000000000000000000000000000000000000",
    extraArgs: args["extra-args"] || providers.ccip.defaultExtraArgs || "0x",
    amountBase: amountBase.toString(),
    humanAmount: String(args.amount),
    ccipExplorerBase: providers.ccip.messageUrl
  };
  plan.knownUnsupportedTokenRoute = knownUnsupportedRoute(providers, from, to, token);
  plan.feeWei = quoteFee(plan).toString();
  return plan;
}

function runSafetyChecks(plan) {
  const checks = [];
  const add = (label, fn, render = (value) => String(value)) => {
    try {
      const value = fn();
      checks.push({ check: label, ok: true, result: render(value), value });
    } catch (error) {
      checks.push({ check: label, ok: false, result: error.message, value: null });
    }
  };

  add("Source chain id", () => runCast(["chain-id", "--rpc-url", plan.fromChain.rpcUrl]).trim());
  add("CCIP lane supported", () => runCast([
    "call",
    plan.sourceCcip.routerAddress,
    "isChainSupported(uint64)(bool)",
    plan.destinationCcip.chainSelector,
    "--rpc-url",
    plan.fromChain.rpcUrl
  ]).trim());
  add("Source gas balance", () => nativeBalance(plan.fromChain, plan.fromAddress), (value) => `${formatUnits(value, 18)} ${plan.fromChain.nativeSymbol}`);
  add(`${plan.token.symbol} balance`, () => balanceOf(plan.fromChain, plan.token, plan.fromAddress), (value) => `${formatUnits(value, plan.token.decimals)} ${plan.token.symbol}`);
  add(`${plan.token.symbol} allowance`, () => allowanceOf(plan.fromChain, plan.token, plan.fromAddress, plan.sourceCcip.routerAddress), (value) => `${formatUnits(value, plan.token.decimals)} ${plan.token.symbol}`);
  add("CCIP fee", () => BigInt(plan.feeWei), (value) => `${formatUnits(value, 18)} ${plan.fromChain.nativeSymbol}`);

  const warnings = [];
  const lane = checks.find((item) => item.check === "CCIP lane supported")?.result;
  const gasBalance = checks.find((item) => item.check === "Source gas balance")?.value;
  const tokenBalance = checks.find((item) => item.check === `${plan.token.symbol} balance`)?.value;
  if (plan.knownUnsupportedTokenRoute) warnings.push(plan.knownUnsupportedTokenRoute.reason);
  if (lane && !String(lane).toLowerCase().includes("true")) warnings.push("CCIP lane is not supported by the source router");
  if (tokenBalance !== undefined && tokenBalance !== null && BigInt(tokenBalance) < BigInt(plan.amountBase)) {
    warnings.push(`${plan.token.symbol} balance is below requested amount ${plan.humanAmount}`);
  }
  if (gasBalance !== undefined && gasBalance !== null && BigInt(gasBalance) < BigInt(plan.feeWei)) {
    warnings.push(`source native balance is below CCIP fee ${formatUnits(plan.feeWei, 18)} ${plan.fromChain.nativeSymbol}`);
  }

  return {
    checks,
    hardFailures: checks.filter((item) => !item.ok),
    warnings
  };
}

function ensureBroadcastAllowed(args, plan, signer) {
  if (args.confirm === "CONFIRM_MAINNET_BRIDGE") return { allowed: true, reason: "explicit confirmation", source: "" };
  const policy = evaluateMainnetAutoConfirm(readPolicy(args), {
    action: "bridge",
    signer,
    fromChainId: plan.fromChain.chainId,
    toChainId: plan.toChain.chainId,
    tool: "ccip",
    tokenSymbol: plan.token.symbol,
    tokenDecimals: plan.token.decimals,
    amountBase: plan.amountBase,
    amountHuman: plan.humanAmount
  });
  if (!policy.allowed) {
    throw new Error(`CCIP mainnet transfer requires --confirm CONFIRM_MAINNET_BRIDGE or a matching policy: ${policy.reason}`);
  }
  return policy;
}

function sendApprove(plan, privateKey, amount) {
  const output = runCast([
    "send",
    plan.token.address,
    "approve(address,uint256)",
    plan.sourceCcip.routerAddress,
    amount,
    "--private-key",
    privateKey,
    "--rpc-url",
    plan.fromChain.rpcUrl
  ]);
  return extractTxHash(output);
}

function simulateCcip(plan) {
  return runCast([
    "call",
    plan.sourceCcip.routerAddress,
    "ccipSend(uint64,(bytes,bytes,(address,uint256)[],address,bytes))(bytes32)",
    plan.destinationCcip.chainSelector,
    ccipMessageTuple(plan),
    "--value",
    `${plan.feeWei}wei`,
    "--from",
    plan.fromAddress,
    "--rpc-url",
    plan.fromChain.rpcUrl
  ]);
}

function sendCcip(plan, privateKey) {
  const output = runCast([
    "send",
    plan.sourceCcip.routerAddress,
    "ccipSend(uint64,(bytes,bytes,(address,uint256)[],address,bytes))",
    plan.destinationCcip.chainSelector,
    ccipMessageTuple(plan),
    "--value",
    `${plan.feeWei}wei`,
    "--private-key",
    privateKey,
    "--rpc-url",
    plan.fromChain.rpcUrl
  ]);
  return extractTxHash(output);
}

function extractCcipMessageId(plan, txHash) {
  try {
    const receipt = JSON.parse(runCast(["receipt", txHash, "--rpc-url", plan.fromChain.rpcUrl, "--json"]));
    for (const log of receipt.logs || []) {
      const topics = log.topics || [];
      if (String(topics[0] || "").toLowerCase() === CCIP_MESSAGE_SENT_TOPIC.toLowerCase()) {
        const words = String(log.data || "")
          .replace(/^0x/, "")
          .match(/.{1,64}/g) || [];
        const candidates = words
          .map((word) => `0x${word}`)
          .filter((word) => /^0x[a-fA-F0-9]{64}$/.test(word))
          .filter((word) => !["0x" + "0".repeat(64), "0x" + "0".repeat(63) + "20"].includes(word.toLowerCase()));
        return candidates[0] || "";
      }
      if (String(topics[0] || "").toLowerCase() === LEGACY_CCIP_MESSAGE_SENT_TOPIC.toLowerCase()) {
        return topics[1] || "";
      }
    }
  } catch {
    // keep fallback below
  }
  return "";
}

async function executePlan(args, plan, safety) {
  if (safety.hardFailures.length) {
    throw new Error(`Safety checks failed: ${safety.hardFailures.map((item) => `${item.check}: ${item.result}`).join("; ")}`);
  }
  if (safety.warnings.length && !args["ignore-warnings"]) {
    throw new Error(`Safety warnings require --ignore-warnings to broadcast: ${safety.warnings.join("; ")}`);
  }

  const privateKey = readPrivateKey(args);
  const signer = runCast(["wallet", "address", "--private-key", privateKey]).trim();
  if (signer.toLowerCase() !== plan.fromAddress.toLowerCase()) {
    throw new Error(`Signer ${signer} does not match plan fromAddress ${plan.fromAddress}`);
  }
  ensureBroadcastAllowed(args, plan, signer);

  const result = {
    signer,
    approvalTx: "",
    ccipTx: "",
    sourceExplorer: "",
    messageId: "",
    ccipExplorer: ""
  };

  const currentAllowance = allowanceOf(plan.fromChain, plan.token, signer, plan.sourceCcip.routerAddress);
  let approvedForThisRun = false;
  if (currentAllowance !== BigInt(plan.amountBase)) {
    if (currentAllowance > 0n && !args["keep-existing-allowance"]) {
      result.approvalResetTx = sendApprove(plan, privateKey, "0");
    }
    if (currentAllowance < BigInt(plan.amountBase) || !args["keep-existing-allowance"]) {
      result.approvalTx = sendApprove(plan, privateKey, plan.amountBase);
      approvedForThisRun = true;
    }
  }

  try {
    result.preflightMessageId = simulateCcip(plan);
  } catch (error) {
    if (approvedForThisRun && !args["keep-existing-allowance"]) {
      result.approvalCleanupTx = sendApprove(plan, privateKey, "0");
    }
    error.message = `CCIP source preflight failed before broadcast${result.approvalCleanupTx ? `; approval cleanup tx ${result.approvalCleanupTx}` : ""}: ${error.message}`;
    throw error;
  }

  result.ccipTx = sendCcip(plan, privateKey);
  result.sourceExplorer = explorerTx(plan.fromChain, result.ccipTx);
  result.messageId = extractCcipMessageId(plan, result.ccipTx);
  if (result.messageId) result.ccipExplorer = `${plan.ccipExplorerBase}${result.messageId}`;
  return result;
}

function summaryRows(plan, safety, savedPlan) {
  return [
    { Field: "Provider", Value: "Transporter / Chainlink CCIP" },
    { Field: "Route", Value: `${plan.fromChain.name} selector ${plan.sourceCcip.chainSelector} -> ${plan.toChain.name} selector ${plan.destinationCcip.chainSelector}` },
    { Field: "From address", Value: plan.fromAddress },
    { Field: "To address", Value: plan.toAddress },
    { Field: "Amount", Value: `${plan.humanAmount} ${plan.token.symbol} (${plan.amountBase} base units)` },
    { Field: "CCIP fee", Value: `${formatUnits(plan.feeWei, 18)} ${plan.fromChain.nativeSymbol}` },
    { Field: "Source router", Value: plan.sourceCcip.routerAddress },
    { Field: "Receiver bytes", Value: plan.receiverBytes },
    { Field: "Plan", Value: savedPlan || "ephemeral (not saved)" },
    { Field: "Warnings", Value: safety.warnings.join(" | ") || "-" }
  ];
}

const args = parseArgs(process.argv.slice(2));

try {
  if (args.help || args.h) {
    usage();
    process.exit(0);
  }

  const plan = buildPlan(args);
  const safety = runSafetyChecks(plan);
  const savedPlan = args["save-plan"] || args.output ? path.resolve(args["save-plan"] || args.output) : "";
  if (savedPlan) writeJson(savedPlan, plan);

  if (args.json) {
    const base = { ok: true, broadcast: Boolean(args.broadcast), savedPlan, plan, safety };
    if (args.broadcast) base.execution = await executePlan(args, plan, safety);
    outputJson(base);
    process.exit(0);
  }

  console.log("# Chainlink CCIP Token Transfer");
  console.log("");
  printTable(summaryRows(plan, safety, savedPlan));
  console.log("");
  console.log("Safety checks:");
  printTable(safety.checks.map((check) => ({ Check: check.check, Result: check.ok ? `ok: ${check.result}` : check.result })));
  if (safety.warnings.length) {
    console.log("");
    console.log("Warnings:");
    for (const warning of safety.warnings) console.log(`- ${warning}`);
  }

  if (!args.broadcast) {
    console.log("");
    console.log("Dry run only. Add --broadcast to submit the CCIP source transaction.");
  } else {
    const execution = await executePlan(args, plan, safety);
    console.log("");
    console.log(`Signer: ${execution.signer}`);
    if (execution.approvalResetTx) console.log(`Approval reset tx: ${execution.approvalResetTx}`);
    if (execution.approvalTx) console.log(`Exact approval tx: ${execution.approvalTx}`);
    console.log(`CCIP source tx: ${execution.ccipTx}`);
    console.log(`Source explorer: ${execution.sourceExplorer}`);
    console.log(`Message ID: ${execution.messageId || "not parsed from receipt"}`);
    if (execution.ccipExplorer) console.log(`CCIP explorer: ${execution.ccipExplorer}`);
  }
} catch (error) {
  if (args.json) outputJson({ ok: false, error: error.message });
  else console.error(`Error: ${error.message}`);
  process.exit(1);
}
