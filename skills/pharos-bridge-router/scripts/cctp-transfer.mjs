#!/usr/bin/env node
import path from "node:path";
import {
  evaluateMainnetAutoConfirm,
  fetchJson,
  formatUnits,
  isAddress,
  isTxHash,
  loadCctp,
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

function usage() {
  console.log(`Usage:
  node scripts/cctp-transfer.mjs --from pharos --to base --amount 0.01 --address 0xWallet
  node scripts/cctp-transfer.mjs --from pharos --to base --amount 0.01 --broadcast --mint
  node scripts/cctp-transfer.mjs --from pharos --to base --amount 0.01 --save-plan cctp-plan.json --json

Circle CCTP V2:
  - Burns native USDC on the source domain.
  - Polls Circle Iris for attestation.
  - Mints native USDC on the destination domain with receiveMessage.

Broadcast rules:
  - --broadcast is required for burn.
  - --mint is required to auto-submit the destination mint transaction.
  - Use --mint-later-ok only when the user explicitly accepts burn-now/mint-later.
  - Mainnet broadcasts require CONFIRM_MAINNET_BRIDGE or a matching local policy.
  - Destination wallet must have native gas for minting, unless another relayer will mint later.`);
}

function outputJson(data) {
  console.log(JSON.stringify(data, null, 2));
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

function resolveCctpChain(input, config) {
  if (input === undefined || input === null || input === "") throw new Error("CCTP chain is required");
  const text = String(input).trim().toLowerCase();
  const numeric = Number(text);
  const chain = config.chains.find((item) => {
    const aliases = item.aliases || [];
    return item.key.toLowerCase() === text ||
      item.name.toLowerCase() === text ||
      aliases.map((alias) => alias.toLowerCase()).includes(text) ||
      item.chainId === numeric ||
      item.domain === numeric;
  });
  if (!chain) {
    throw new Error(`Unsupported CCTP chain "${input}". Use one of: ${config.chains.map((item) => item.key).join(", ")}`);
  }
  return chain;
}

function addressToBytes32(address) {
  if (!isAddress(address)) throw new Error(`Invalid EVM address: ${address}`);
  return `0x${"0".repeat(24)}${address.slice(2)}`.toLowerCase();
}

function explorerTx(chain, txHash) {
  if (!txHash || !chain.explorerUrl) return txHash || "-";
  return `${chain.explorerUrl.replace(/\/+$/, "")}/tx/${txHash}`;
}

function codeStatus(address, rpcUrl) {
  const code = runCast(["code", address, "--rpc-url", rpcUrl]);
  return code && code !== "0x" ? "ok" : "missing";
}

function balanceOf(chain, token, owner) {
  return parseCastUint(runCast(["call", token, "balanceOf(address)(uint256)", owner, "--rpc-url", chain.rpcUrl]));
}

function allowanceOf(chain, token, owner, spender) {
  return parseCastUint(runCast(["call", token, "allowance(address,address)(uint256)", owner, spender, "--rpc-url", chain.rpcUrl]));
}

function nativeBalance(chain, owner) {
  return BigInt(runCast(["balance", owner, "--rpc-url", chain.rpcUrl]).trim());
}

function getMinFeeAmount(chain, amountBase, config) {
  return parseCastUint(runCast([
    "call",
    config.contracts.tokenMessengerV2,
    "getMinFeeAmount(uint256)(uint256)",
    amountBase,
    "--rpc-url",
    chain.rpcUrl
  ]));
}

function buildPlan(args) {
  const config = loadCctp();
  const from = resolveCctpChain(args.from || "pharos", config);
  const to = resolveCctpChain(args.to, config);
  if (from.domain === to.domain) throw new Error("CCTP source and destination domains must differ");
  if (!args.amount) throw new Error("--amount is required");

  const privateKey = tryReadPrivateKey(args);
  const derivedAddress = privateKey ? runCast(["wallet", "address", "--private-key", privateKey]).trim() : "";
  const fromAddress = args["from-address"] || args.address || derivedAddress;
  const toAddress = args["to-address"] || args.address || fromAddress;
  if (!isAddress(fromAddress)) throw new Error("--address or a discoverable private key is required");
  if (!isAddress(toAddress)) throw new Error("--to-address must be a valid EVM address");

  const decimals = Number(config.defaults.decimals || 6);
  const amountBase = parseUnits(args.amount, decimals);
  const maxFee = args["max-fee"]
    ? parseUnits(args["max-fee"], decimals)
    : getMinFeeAmount(from, amountBase.toString(), config);
  const minFinalityThreshold = Number(args["min-finality-threshold"] || config.defaults.minFinalityThreshold || 2000);

  return {
    schema: "pharos-bridge-router-cctp-plan/v1",
    provider: "circle-cctp-v2",
    createdAt: nowIso(),
    fromChain: from,
    toChain: to,
    token: {
      symbol: "USDC",
      decimals,
      fromAddress: from.usdc,
      toAddress: to.usdc
    },
    fromAddress,
    toAddress,
    mintRecipient: addressToBytes32(toAddress),
    destinationCaller: String(args["destination-caller"] || config.defaults.destinationCaller),
    amountBase: amountBase.toString(),
    humanAmount: String(args.amount),
    maxFeeBase: maxFee.toString(),
    minFinalityThreshold,
    contracts: config.contracts,
    irisApiBaseUrl: config.apiBaseUrl
  };
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
  add("Destination chain id", () => runCast(["chain-id", "--rpc-url", plan.toChain.rpcUrl]).trim());
  add("Source TokenMessengerV2 code", () => codeStatus(plan.contracts.tokenMessengerV2, plan.fromChain.rpcUrl));
  add("Destination MessageTransmitterV2 code", () => codeStatus(plan.contracts.messageTransmitterV2, plan.toChain.rpcUrl));
  add("Source gas balance", () => nativeBalance(plan.fromChain, plan.fromAddress), (value) => `${formatUnits(value, 18)} ${plan.fromChain.nativeSymbol}`);
  add("Destination gas balance", () => nativeBalance(plan.toChain, plan.toAddress), (value) => `${formatUnits(value, 18)} ${plan.toChain.nativeSymbol}`);
  add("Source USDC balance", () => balanceOf(plan.fromChain, plan.token.fromAddress, plan.fromAddress), (value) => `${formatUnits(value, plan.token.decimals)} USDC`);
  add("Source USDC allowance", () => allowanceOf(plan.fromChain, plan.token.fromAddress, plan.fromAddress, plan.contracts.tokenMessengerV2), (value) => `${formatUnits(value, plan.token.decimals)} USDC`);
  add("CCTP min fee", () => BigInt(plan.maxFeeBase), (value) => `${formatUnits(value, plan.token.decimals)} USDC`);

  const hardFailures = checks.filter((item) => !item.ok);
  const warnings = [];
  const sourceBalance = checks.find((item) => item.check === "Source USDC balance")?.value;
  const destGas = checks.find((item) => item.check === "Destination gas balance")?.value;
  if (sourceBalance !== undefined && sourceBalance !== null && BigInt(sourceBalance) < BigInt(plan.amountBase)) {
    warnings.push(`source USDC balance is below requested amount ${plan.humanAmount} USDC`);
  }
  if (destGas !== undefined && destGas !== null && BigInt(destGas) === 0n) {
    warnings.push(`destination gas balance is zero; burn can succeed, but mint needs ${plan.toChain.nativeSymbol} gas or an external relayer`);
  }
  return { checks, hardFailures, warnings };
}

function ensureBroadcastAllowed(args, plan, signer) {
  if (args.confirm === "CONFIRM_MAINNET_BRIDGE") return { allowed: true, reason: "explicit confirmation", source: "" };
  const policy = evaluateMainnetAutoConfirm(readPolicy(args), {
    action: "bridge",
    signer,
    fromChainId: plan.fromChain.chainId,
    toChainId: plan.toChain.chainId,
    tool: "cctp",
    tokenSymbol: "USDC",
    tokenDecimals: plan.token.decimals,
    amountBase: plan.amountBase,
    amountHuman: plan.humanAmount
  });
  if (!policy.allowed) {
    throw new Error(`CCTP mainnet transfer requires --confirm CONFIRM_MAINNET_BRIDGE or a matching policy: ${policy.reason}`);
  }
  return policy;
}

function sendApprove(plan, privateKey, amount) {
  const output = runCast([
    "send",
    plan.token.fromAddress,
    "approve(address,uint256)",
    plan.contracts.tokenMessengerV2,
    amount,
    "--private-key",
    privateKey,
    "--rpc-url",
    plan.fromChain.rpcUrl
  ]);
  return extractTxHash(output);
}

function sendBurn(plan, privateKey) {
  const output = runCast([
    "send",
    plan.contracts.tokenMessengerV2,
    "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
    plan.amountBase,
    String(plan.toChain.domain),
    plan.mintRecipient,
    plan.token.fromAddress,
    plan.destinationCaller,
    plan.maxFeeBase,
    String(plan.minFinalityThreshold),
    "--private-key",
    privateKey,
    "--rpc-url",
    plan.fromChain.rpcUrl
  ]);
  return extractTxHash(output);
}

async function pollAttestation(plan, burnTx, timeoutSeconds, delaySeconds) {
  const url = `${plan.irisApiBaseUrl}/messages/${plan.fromChain.domain}?transactionHash=${burnTx}`;
  const started = Date.now();
  let last = null;
  while (Date.now() - started <= timeoutSeconds * 1000) {
    try {
      const data = await fetchJson(url);
      const messages = data.messages || [];
      last = data;
      const ready = messages.find((message) =>
        String(message.status || "").toLowerCase() === "complete" &&
        message.attestation &&
        message.attestation !== "PENDING" &&
        message.message
      );
      if (ready) return { ready: true, url, message: ready, response: data };
    } catch (error) {
      last = { error: error.message };
      if (!String(error.message || "").includes("404")) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
  }
  return { ready: false, url, response: last };
}

function sendMint(plan, attestedMessage, privateKey) {
  const output = runCast([
    "send",
    plan.contracts.messageTransmitterV2,
    "receiveMessage(bytes,bytes)",
    attestedMessage.message,
    attestedMessage.attestation,
    "--private-key",
    privateKey,
    "--rpc-url",
    plan.toChain.rpcUrl
  ]);
  return extractTxHash(output);
}

async function executePlan(args, plan, safety) {
  if (safety.hardFailures.length) {
    throw new Error(`Safety checks failed: ${safety.hardFailures.map((item) => `${item.check}: ${item.result}`).join("; ")}`);
  }
  const destinationGas = safety.checks.find((item) => item.check === "Destination gas balance")?.value;
  if (!args.mint && !args["mint-later-ok"]) {
    throw new Error("CCTP broadcast requires --mint for a complete burn+mint flow, or --mint-later-ok if the user explicitly accepts burn-now/mint-later.");
  }
  if (destinationGas !== undefined && destinationGas !== null && BigInt(destinationGas) === 0n && !args["mint-later-ok"]) {
    throw new Error(`Destination ${plan.toChain.nativeSymbol} gas is zero. Add destination gas before broadcast, or use --mint-later-ok only if the user explicitly accepts minting later.`);
  }
  const privateKey = readPrivateKey(args);
  const sourceChainId = runCast(["chain-id", "--rpc-url", plan.fromChain.rpcUrl]).trim();
  const destinationChainId = runCast(["chain-id", "--rpc-url", plan.toChain.rpcUrl]).trim();
  if (String(sourceChainId) !== String(plan.fromChain.chainId)) {
    throw new Error(`Source RPC chain-id mismatch. Expected ${plan.fromChain.chainId}, got ${sourceChainId}`);
  }
  if (String(destinationChainId) !== String(plan.toChain.chainId)) {
    throw new Error(`Destination RPC chain-id mismatch. Expected ${plan.toChain.chainId}, got ${destinationChainId}`);
  }
  const signer = runCast(["wallet", "address", "--private-key", privateKey]).trim();
  if (signer.toLowerCase() !== plan.fromAddress.toLowerCase()) {
    throw new Error(`Signer ${signer} does not match plan fromAddress ${plan.fromAddress}`);
  }
  const policy = ensureBroadcastAllowed(args, plan, signer);

  const result = {
    signer,
    policy,
    approvalTx: "",
    burnTx: "",
    attestation: null,
    mintTx: "",
    sourceExplorer: "",
    destinationExplorer: ""
  };

  const currentAllowance = allowanceOf(plan.fromChain, plan.token.fromAddress, signer, plan.contracts.tokenMessengerV2);
  if (currentAllowance !== BigInt(plan.amountBase)) {
    if (currentAllowance > 0n && !args["keep-existing-allowance"]) {
      result.approvalResetTx = sendApprove(plan, privateKey, "0");
    }
    if (currentAllowance < BigInt(plan.amountBase) || !args["keep-existing-allowance"]) {
      result.approvalTx = sendApprove(plan, privateKey, plan.amountBase);
    }
  }

  result.burnTx = sendBurn(plan, privateKey);
  result.sourceExplorer = explorerTx(plan.fromChain, result.burnTx);

  const timeoutSeconds = Number(args["poll-seconds"] || 900);
  const delaySeconds = Number(args["poll-interval"] || 15);
  result.attestation = await pollAttestation(plan, result.burnTx, timeoutSeconds, delaySeconds);

  if (args.mint) {
    if (!result.attestation.ready) {
      throw new Error(`Circle attestation was not ready within ${timeoutSeconds}s. Rerun bridge-status --provider cctp --tx ${result.burnTx} --from ${plan.fromChain.key} --to ${plan.toChain.key} --mint later.`);
    }
    const destinationGas = nativeBalance(plan.toChain, signer);
    if (destinationGas === 0n) {
      throw new Error(`Destination signer has 0 ${plan.toChain.nativeSymbol}; cannot submit receiveMessage mint tx.`);
    }
    result.mintTx = sendMint(plan, result.attestation.message, privateKey);
    result.destinationExplorer = explorerTx(plan.toChain, result.mintTx);
  }

  return result;
}

function summaryRows(plan, safety, savedPlan) {
  const policy = (() => {
    const privateKey = tryReadPrivateKey({});
    if (!privateKey) return "not checked; no signer";
    const signer = runCast(["wallet", "address", "--private-key", privateKey]).trim();
    const check = evaluateMainnetAutoConfirm(readPolicy({}), {
      action: "bridge",
      signer,
      fromChainId: plan.fromChain.chainId,
      toChainId: plan.toChain.chainId,
      tool: "cctp",
      tokenSymbol: "USDC",
      tokenDecimals: plan.token.decimals,
      amountBase: plan.amountBase,
      amountHuman: plan.humanAmount
    });
    return check.allowed ? `auto-confirm allowed: ${check.reason}` : `manual confirm required: ${check.reason}`;
  })();

  return [
    { Field: "Provider", Value: "Circle CCTP V2" },
    { Field: "Route", Value: `${plan.fromChain.name} domain ${plan.fromChain.domain} -> ${plan.toChain.name} domain ${plan.toChain.domain}` },
    { Field: "From address", Value: plan.fromAddress },
    { Field: "To address", Value: plan.toAddress },
    { Field: "Amount", Value: `${plan.humanAmount} USDC (${plan.amountBase} base units)` },
    { Field: "Max fee", Value: `${formatUnits(plan.maxFeeBase, plan.token.decimals)} USDC` },
    { Field: "Finality", Value: String(plan.minFinalityThreshold) },
    { Field: "Source TokenMessengerV2", Value: plan.contracts.tokenMessengerV2 },
    { Field: "Destination MessageTransmitterV2", Value: plan.contracts.messageTransmitterV2 },
    { Field: "Mint recipient bytes32", Value: plan.mintRecipient },
    { Field: "Plan", Value: savedPlan || "ephemeral (not saved)" },
    { Field: "Policy", Value: policy },
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
    outputJson(jsonSafe(base));
    process.exit(0);
  }

  console.log("# Circle CCTP USDC Transfer");
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
    console.log("Dry run only. Add --broadcast to burn USDC, and add --mint to auto-submit receiveMessage when attestation is ready.");
  } else {
    const execution = await executePlan(args, plan, safety);
    console.log("");
    console.log(`Signer: ${execution.signer}`);
    if (execution.policy?.reason) console.log(`Auto-confirm policy: ${execution.policy.reason} (${execution.policy.source || "explicit"})`);
    if (execution.approvalResetTx) console.log(`Approval reset tx: ${execution.approvalResetTx}`);
    if (execution.approvalTx) console.log(`Exact approval tx: ${execution.approvalTx}`);
    console.log(`Burn tx: ${execution.burnTx}`);
    console.log(`Source explorer: ${execution.sourceExplorer}`);
    console.log(`Attestation: ${execution.attestation?.ready ? "ready" : "pending"}`);
    if (execution.mintTx) {
      console.log(`Mint tx: ${execution.mintTx}`);
      console.log(`Destination explorer: ${execution.destinationExplorer}`);
    } else if (execution.burnTx) {
      console.log(`Mint later: node scripts/bridge-status.mjs --provider cctp --tx ${execution.burnTx} --from ${plan.fromChain.key} --to ${plan.toChain.key} --mint`);
    }
  }
} catch (error) {
  if (args.json) outputJson({ ok: false, error: error.message });
  else console.error(`Error: ${error.message}`);
  process.exit(1);
}
