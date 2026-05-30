#!/usr/bin/env node
import path from "node:path";
import {
  evaluateMainnetAutoConfirm,
  fetchJson,
  formatUnits,
  getLifiTokens,
  isAddress,
  loadCctp,
  loadInterport,
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
  node scripts/interport-cctp-relay.mjs --from pharos --to base --amount 0.01 --address 0xWallet
  node scripts/interport-cctp-relay.mjs --from pharos --to base --amount 0.01 --broadcast
  node scripts/interport-cctp-relay.mjs --from pharos --to base --amount 0.01 --native-fee 0.02 --broadcast

Interport relayed CCTP:
  - Burns native USDC on the source chain through InterportCCTPV2Bridge.
  - Interport's relayer submits Circle receiveMessage on the destination chain.
  - The user does not need to hold destination gas or submit a manual mint transaction.

Broadcast rules:
  - --broadcast is required for a real transaction.
  - Mainnet broadcasts require CONFIRM_MAINNET_BRIDGE or a matching local policy.
  - The script uses exact USDC approval to the Interport CCTPV2 bridge.
  - --native-fee can override the estimated relayer reserve paid as msg.value.`);
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

function decimalToScaled(value, scale) {
  const text = String(value ?? "0").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid decimal value: ${value}`);
  const [whole, fraction = ""] = text.split(".");
  const scaleText = String(scale);
  const decimals = scaleText.length - 1;
  const frac = fraction.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole) * BigInt(scale) + BigInt(frac || "0");
}

function ceilDiv(a, b) {
  return (a + b - 1n) / b;
}

function interportFeeBase(amountBase, minimumFee) {
  const scaled = decimalToScaled(minimumFee || 0, 1_000_000);
  if (scaled === 0n) return 0n;
  return ceilDiv(BigInt(amountBase) * scaled, 10_000n * 1_000_000n);
}

async function nativePriceUsd(chain) {
  const tokens = await getLifiTokens(chain.chainId);
  const native = tokens.find((token) => token.address?.toLowerCase() === "0x0000000000000000000000000000000000000000") ||
    tokens.find((token) => token.symbol?.toLowerCase() === chain.nativeSymbol?.toLowerCase());
  const price = Number(native?.priceUSD || 0);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`No native USD price for ${chain.name}`);
  return price;
}

async function estimateNativeFeeWei(args, from, to, interport) {
  if (args["native-fee"]) {
    return {
      wei: parseUnits(args["native-fee"], 18),
      source: "manual --native-fee",
      details: `${args["native-fee"]} ${from.nativeSymbol}`
    };
  }

  try {
    const gasLimit = BigInt(args["destination-gas-limit"] || interport.defaults.destinationGasLimit || 200000);
    const destinationGasPrice = BigInt(runCast(["gas-price", "--rpc-url", to.rpcUrl]).trim());
    const fromPrice = await nativePriceUsd(from);
    const toPrice = await nativePriceUsd(to);
    const bufferBps = BigInt(args["native-fee-buffer-bps"] || interport.defaults.nativeFeeBufferBps || 1500);
    const destinationWei = gasLimit * destinationGasPrice;
    const destinationUsd = Number(formatUnits(destinationWei, 18)) * toPrice;
    const sourceNative = destinationUsd / fromPrice;
    const estimatedWei = parseUnits(sourceNative.toFixed(18), 18);
    const buffered = estimatedWei + (estimatedWei * bufferBps) / 10_000n;
    return {
      wei: buffered,
      source: "auto gas+price estimate",
      details: `${gasLimit} destination gas at ${destinationGasPrice} wei, ${bufferBps} bps buffer`
    };
  } catch (error) {
    const fallback = BigInt(interport.defaults.fallbackNativeFeeWei || "0");
    return {
      wei: fallback,
      source: "fallback",
      details: error.message
    };
  }
}

async function buildPlan(args) {
  const cctp = loadCctp();
  const interport = loadInterport();
  const from = resolveCctpChain(args.from || "pharos", cctp);
  const to = resolveCctpChain(args.to, cctp);
  if (from.domain === to.domain) throw new Error("Source and destination CCTP domains must differ");
  if (!args.amount) throw new Error("--amount is required");

  const privateKey = tryReadPrivateKey(args);
  const derivedAddress = privateKey ? runCast(["wallet", "address", "--private-key", privateKey]).trim() : "";
  const fromAddress = args["from-address"] || args.address || derivedAddress;
  const toAddress = args["to-address"] || args.address || fromAddress;
  if (!isAddress(fromAddress)) throw new Error("--address or a discoverable private key is required");
  if (!isAddress(toAddress)) throw new Error("--to-address must be a valid EVM address");

  const decimals = Number(interport.defaults.decimals || cctp.defaults.decimals || 6);
  const amountBase = parseUnits(args.amount, decimals);
  const feeInfo = await fetchJson(`${interport.apiBaseUrl}/cctp-v2-fee?sourceChain=${from.chainId}&destinationChain=${to.chainId}`);
  const maxFeeBase = args["max-fee"]
    ? parseUnits(args["max-fee"], decimals)
    : interportFeeBase(amountBase, feeInfo?.minimumFee || 0);
  const mode = String(args.mode || (from.fastTransfer && to.fastTransfer ? "fast" : "standard")).toLowerCase();
  const minFinalityThreshold = Number(args["min-finality-threshold"] ||
    (mode === "fast" ? interport.defaults.fastFinalityThreshold : interport.defaults.standardFinalityThreshold));
  const nativeFee = await estimateNativeFeeWei(args, from, to, interport);

  return {
    schema: "pharos-bridge-router-interport-cctp-plan/v1",
    provider: "interport-cctp-v2-relay",
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
    destinationCaller: String(args["destination-caller"] || interport.defaults.destinationCaller),
    amountBase: amountBase.toString(),
    humanAmount: String(args.amount),
    maxFeeBase: maxFeeBase.toString(),
    estimatedReceiveBase: (amountBase - maxFeeBase).toString(),
    interportFeeInfo: feeInfo,
    minFinalityThreshold,
    mode,
    nativeFeeWei: nativeFee.wei.toString(),
    nativeFeeSource: nativeFee.source,
    nativeFeeDetails: nativeFee.details,
    contracts: {
      ...cctp.contracts,
      interportCctpV2Bridge: interport.contracts.cctpV2Bridge
    },
    interportExplorer: interport.explorerTxBaseUrl,
    irisApiBaseUrl: cctp.apiBaseUrl
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
  add("Interport bridge code", () => codeStatus(plan.contracts.interportCctpV2Bridge, plan.fromChain.rpcUrl));
  add("Interport bridge paused", () => runCast(["call", plan.contracts.interportCctpV2Bridge, "paused()(bool)", "--rpc-url", plan.fromChain.rpcUrl]).trim());
  add("Interport tokenMessenger", () => runCast(["call", plan.contracts.interportCctpV2Bridge, "tokenMessenger()(address)", "--rpc-url", plan.fromChain.rpcUrl]).trim());
  add("Source gas balance", () => nativeBalance(plan.fromChain, plan.fromAddress), (value) => `${formatUnits(value, 18)} ${plan.fromChain.nativeSymbol}`);
  add("Source USDC balance", () => balanceOf(plan.fromChain, plan.token.fromAddress, plan.fromAddress), (value) => `${formatUnits(value, plan.token.decimals)} USDC`);
  add("Source USDC allowance", () => allowanceOf(plan.fromChain, plan.token.fromAddress, plan.fromAddress, plan.contracts.interportCctpV2Bridge), (value) => `${formatUnits(value, plan.token.decimals)} USDC`);

  const warnings = [];
  const sourceBalance = checks.find((item) => item.check === "Source USDC balance")?.value;
  const gasBalance = checks.find((item) => item.check === "Source gas balance")?.value;
  const paused = checks.find((item) => item.check === "Interport bridge paused")?.result;
  const tokenMessenger = checks.find((item) => item.check === "Interport tokenMessenger")?.result;
  if (sourceBalance !== undefined && sourceBalance !== null && BigInt(sourceBalance) < BigInt(plan.amountBase)) {
    warnings.push(`source USDC balance is below requested amount ${plan.humanAmount} USDC`);
  }
  if (gasBalance !== undefined && gasBalance !== null && BigInt(gasBalance) < BigInt(plan.nativeFeeWei)) {
    warnings.push(`source native balance is below relayer reserve ${formatUnits(plan.nativeFeeWei, 18)} ${plan.fromChain.nativeSymbol}`);
  }
  if (paused && String(paused).toLowerCase().includes("true")) warnings.push("Interport CCTPV2 bridge is paused");
  if (tokenMessenger && !String(tokenMessenger).toLowerCase().includes(plan.contracts.tokenMessengerV2.toLowerCase().slice(2))) {
    warnings.push(`Interport tokenMessenger ${tokenMessenger} does not match configured Circle TokenMessengerV2 ${plan.contracts.tokenMessengerV2}`);
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
    tool: "interport-cctp",
    tokenSymbol: "USDC",
    tokenDecimals: plan.token.decimals,
    amountBase: plan.amountBase,
    amountHuman: plan.humanAmount
  });
  if (!policy.allowed) {
    throw new Error(`Interport CCTP mainnet transfer requires --confirm CONFIRM_MAINNET_BRIDGE or a matching policy: ${policy.reason}`);
  }
  return policy;
}

function sendApprove(plan, privateKey, amount) {
  const output = runCast([
    "send",
    plan.token.fromAddress,
    "approve(address,uint256)",
    plan.contracts.interportCctpV2Bridge,
    amount,
    "--private-key",
    privateKey,
    "--rpc-url",
    plan.fromChain.rpcUrl
  ]);
  return extractTxHash(output);
}

function actionTuple(plan) {
  return `(${plan.amountBase},${plan.toChain.domain},${plan.mintRecipient},${plan.token.fromAddress},${plan.destinationCaller},${plan.maxFeeBase},${plan.minFinalityThreshold})`;
}

function sendBridge(plan, privateKey) {
  const output = runCast([
    "send",
    plan.contracts.interportCctpV2Bridge,
    "bridge((uint256,uint32,bytes32,address,bytes32,uint256,uint32))",
    actionTuple(plan),
    "--value",
    `${plan.nativeFeeWei}wei`,
    "--private-key",
    privateKey,
    "--rpc-url",
    plan.fromChain.rpcUrl
  ]);
  return extractTxHash(output);
}

async function registerInterportTransaction(plan, txHash) {
  try {
    return await fetchJson(`${loadInterport().apiBaseUrl}/transactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "bridge",
        data: {
          txHash,
          amount: Number(plan.humanAmount),
          sourceChain: plan.fromChain.chainId,
          destinationChain: plan.toChain.chainId,
          sourceAsset: plan.token.fromAddress,
          destinationAsset: plan.token.toAddress,
          sourceAddress: plan.fromAddress,
          destinationAddress: plan.toAddress
        }
      })
    });
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function pollAttestation(plan, txHash, timeoutSeconds, delaySeconds) {
  const url = `${plan.irisApiBaseUrl}/messages/${plan.fromChain.domain}?transactionHash=${txHash}`;
  const started = Date.now();
  let last = null;
  while (Date.now() - started <= timeoutSeconds * 1000) {
    try {
      const data = await fetchJson(url);
      last = data;
      const ready = (data.messages || []).find((message) =>
        String(message.status || "").toLowerCase() === "complete" &&
        message.attestation &&
        message.attestation !== "PENDING"
      );
      if (ready) return { ready: true, url, message: ready };
    } catch (error) {
      last = { error: error.message };
      if (!String(error.message || "").includes("404")) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
  }
  return { ready: false, url, response: last };
}

async function executePlan(args, plan, safety) {
  if (safety.hardFailures.length) {
    throw new Error(`Safety checks failed: ${safety.hardFailures.map((item) => `${item.check}: ${item.result}`).join("; ")}`);
  }
  if (safety.warnings.length && !args["ignore-warnings"]) {
    throw new Error(`Safety warnings require --ignore-warnings to broadcast: ${safety.warnings.join("; ")}`);
  }

  const privateKey = readPrivateKey(args);
  const chainId = runCast(["chain-id", "--rpc-url", plan.fromChain.rpcUrl]).trim();
  if (String(chainId) !== String(plan.fromChain.chainId)) {
    throw new Error(`Source RPC chain-id mismatch. Expected ${plan.fromChain.chainId}, got ${chainId}`);
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
    bridgeTx: "",
    sourceExplorer: "",
    interportRegistered: null,
    attestation: null,
    cctpStatusCommand: ""
  };

  const currentAllowance = allowanceOf(plan.fromChain, plan.token.fromAddress, signer, plan.contracts.interportCctpV2Bridge);
  if (currentAllowance !== BigInt(plan.amountBase)) {
    if (currentAllowance > 0n && !args["keep-existing-allowance"]) {
      result.approvalResetTx = sendApprove(plan, privateKey, "0");
    }
    if (currentAllowance < BigInt(plan.amountBase) || !args["keep-existing-allowance"]) {
      result.approvalTx = sendApprove(plan, privateKey, plan.amountBase);
    }
  }

  result.bridgeTx = sendBridge(plan, privateKey);
  result.sourceExplorer = explorerTx(plan.fromChain, result.bridgeTx);
  result.interportRegistered = await registerInterportTransaction(plan, result.bridgeTx);
  result.cctpStatusCommand = `node scripts/bridge-status.mjs --provider cctp --tx ${result.bridgeTx} --from ${plan.fromChain.key} --to ${plan.toChain.key}`;

  const timeoutSeconds = Number(args["poll-seconds"] || 180);
  const delaySeconds = Number(args["poll-interval"] || 10);
  if (timeoutSeconds > 0) result.attestation = await pollAttestation(plan, result.bridgeTx, timeoutSeconds, delaySeconds);

  return result;
}

function summaryRows(plan, safety, savedPlan) {
  const receive = formatUnits(plan.estimatedReceiveBase, plan.token.decimals);
  return [
    { Field: "Provider", Value: "Interport relayed CCTP V2" },
    { Field: "Route", Value: `${plan.fromChain.name} domain ${plan.fromChain.domain} -> ${plan.toChain.name} domain ${plan.toChain.domain}` },
    { Field: "From address", Value: plan.fromAddress },
    { Field: "To address", Value: plan.toAddress },
    { Field: "Amount", Value: `${plan.humanAmount} USDC (${plan.amountBase} base units)` },
    { Field: "Estimated receive", Value: `${receive} USDC` },
    { Field: "CCTP fee", Value: `${formatUnits(plan.maxFeeBase, plan.token.decimals)} USDC` },
    { Field: "Native relayer reserve", Value: `${formatUnits(plan.nativeFeeWei, 18)} ${plan.fromChain.nativeSymbol} (${plan.nativeFeeSource})` },
    { Field: "Mode/finality", Value: `${plan.mode} / ${plan.minFinalityThreshold}` },
    { Field: "Interport bridge", Value: plan.contracts.interportCctpV2Bridge },
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

  const plan = await buildPlan(args);
  const safety = runSafetyChecks(plan);
  const savedPlan = args["save-plan"] || args.output ? path.resolve(args["save-plan"] || args.output) : "";
  if (savedPlan) writeJson(savedPlan, plan);

  if (args.json) {
    const base = { ok: true, broadcast: Boolean(args.broadcast), savedPlan, plan, safety };
    if (args.broadcast) base.execution = await executePlan(args, plan, safety);
    outputJson(base);
    process.exit(0);
  }

  console.log("# Interport Relayed CCTP USDC Transfer");
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
    console.log("Dry run only. Add --broadcast to submit the Interport source transaction.");
  } else {
    const execution = await executePlan(args, plan, safety);
    console.log("");
    console.log(`Signer: ${execution.signer}`);
    if (execution.policy?.reason) console.log(`Auto-confirm policy: ${execution.policy.reason} (${execution.policy.source || "explicit"})`);
    if (execution.approvalResetTx) console.log(`Approval reset tx: ${execution.approvalResetTx}`);
    if (execution.approvalTx) console.log(`Exact approval tx: ${execution.approvalTx}`);
    console.log(`Interport source tx: ${execution.bridgeTx}`);
    console.log(`Source explorer: ${execution.sourceExplorer}`);
    console.log(`Circle attestation: ${execution.attestation?.ready ? "ready" : "pending"}`);
    console.log(`Status command: ${execution.cctpStatusCommand}`);
  }
} catch (error) {
  if (args.json) outputJson({ ok: false, error: error.message });
  else console.error(`Error: ${error.message}`);
  process.exit(1);
}
