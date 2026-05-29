#!/usr/bin/env node
import path from "node:path";
import {
  calldataSummary,
  castSendPreview,
  enrichChain,
  evaluateMainnetAutoConfirm,
  fetchJson,
  formatUnits,
  isAddress,
  isNativeAddress,
  loadProviders,
  nowIso,
  parseArgs,
  parseUnits,
  printTable,
  readPolicy,
  readPrivateKey,
  resolveLifiToken,
  resolveLocalChain,
  runCast,
  tryReadPrivateKey,
  writeJson
} from "./lib/bridge.mjs";

function usage() {
  console.log(`Usage:
  node scripts/bridge-safe.mjs --from pharos --to base --token USDC --amount 0.05
  node scripts/bridge-safe.mjs --from pharos --to base --token USDC --amount 0.05 --broadcast
  node scripts/bridge-safe.mjs --from pharos --to base --from-token USDC --to-token USDC --amount 0.05 --save-plan plan.json

Defaults:
  - Keeps the bridge plan ephemeral unless --save-plan/--output is passed.
  - Derives --address from the local private key when possible.
  - Broadcast still requires --broadcast plus CONFIRM_MAINNET_BRIDGE or a matching local policy.`);
}

function parseCastUint(output) {
  const match = String(output || "").match(/\b\d+\b/);
  return match ? BigInt(match[0]) : 0n;
}

function extractTxHash(output) {
  return String(output || "").match(/transactionHash\s+(0x[a-fA-F0-9]{64})/)?.[1] || String(output || "").match(/0x[a-fA-F0-9]{64}/)?.at(-1) || "";
}

function safeCheck(label, fn, render = (value) => String(value)) {
  try {
    const value = fn();
    return { label, ok: true, value, display: render(value) };
  } catch (error) {
    return { label, ok: false, value: null, display: error.message };
  }
}

function balanceOf(rpcUrl, token, owner) {
  if (isNativeAddress(token.address)) {
    return BigInt(runCast(["balance", owner, "--rpc-url", rpcUrl]).trim());
  }
  return parseCastUint(runCast(["call", token.address, "balanceOf(address)(uint256)", owner, "--rpc-url", rpcUrl]));
}

function allowanceOf(rpcUrl, token, owner, spender) {
  if (isNativeAddress(token.address) || !spender) return null;
  return parseCastUint(runCast(["call", token.address, "allowance(address,address)(uint256)", owner, spender, "--rpc-url", rpcUrl]));
}

function sendApprove(plan, privateKey, spender, amount) {
  const out = runCast([
    "send",
    plan.fromToken.address,
    "approve(address,uint256)",
    spender,
    amount,
    "--private-key",
    privateKey,
    "--rpc-url",
    plan.fromChain.rpcUrl
  ]);
  return extractTxHash(out);
}

function sendBridge(plan, privateKey) {
  const tx = plan.transactionRequest || {};
  const out = runCast([
    "send",
    tx.to,
    "--data",
    tx.data || "0x",
    "--value",
    `${BigInt(tx.value || "0x0").toString()}wei`,
    "--private-key",
    privateKey,
    "--rpc-url",
    plan.fromChain.rpcUrl
  ]);
  return extractTxHash(out);
}

function outputJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

async function buildSafePlan(args) {
  const fromChain = await enrichChain(resolveLocalChain(args.from || "pharos"));
  const toChain = await enrichChain(resolveLocalChain(args.to));
  if (!args.amount) throw new Error("--amount is required");

  const privateKey = tryReadPrivateKey(args);
  const derivedAddress = privateKey ? runCast(["wallet", "address", "--private-key", privateKey]).trim() : "";
  const fromAddress = args["from-address"] || args.address || derivedAddress;
  const toAddress = args["to-address"] || args.address || fromAddress;
  if (!isAddress(fromAddress)) throw new Error("--address or a discoverable private key is required");
  if (!isAddress(toAddress)) throw new Error("--to-address must be a valid EVM address");

  const token = args.token || args["from-token"] || "USDC";
  const fromToken = await resolveLifiToken(fromChain.id, args["from-token"] || token, args["from-decimals"]);
  const toToken = await resolveLifiToken(toChain.id, args["to-token"] || args.token || args["from-token"] || token);
  const fromAmount = parseUnits(args.amount, fromToken.decimals).toString();
  const slippage = String(args.slippage || "0.005");
  const providers = loadProviders();

  const params = new URLSearchParams({
    fromChain: String(fromChain.id),
    toChain: String(toChain.id),
    fromToken: fromToken.address,
    toToken: toToken.address,
    fromAmount,
    fromAddress,
    toAddress,
    slippage
  });
  const quote = await fetchJson(`${providers.lifi.baseUrl}/quote?${params.toString()}`);
  const tx = quote.transactionRequest || {};
  const includedTools = (quote.includedSteps || []).map((step) => step.tool).filter(Boolean).join(", ");
  const approvalAddress = quote.estimate?.approvalAddress || "";
  const requiresApproval = Boolean(!isNativeAddress(fromToken.address) && approvalAddress);

  return {
    schema: "pharos-bridge-router-plan/v1",
    provider: "lifi",
    createdAt: nowIso(),
    quoteId: quote.id || "",
    fromChain,
    toChain,
    fromToken,
    toToken,
    fromAmount,
    humanAmount: String(args.amount),
    fromAddress,
    toAddress,
    slippage,
    tool: quote.tool || "",
    includedTools,
    approvalAddress,
    requiresApproval,
    transactionRequest: tx,
    quote
  };
}

function runSafetyChecks(args, plan) {
  const rpcUrl = plan.fromChain.rpcUrl;
  const privateKey = tryReadPrivateKey(args);
  const signer = privateKey ? runCast(["wallet", "address", "--private-key", privateKey]).trim() : "";
  const checks = [
    safeCheck("RPC chain id", () => runCast(["chain-id", "--rpc-url", rpcUrl]).trim()),
    safeCheck("Native gas balance", () => BigInt(runCast(["balance", plan.fromAddress, "--rpc-url", rpcUrl]).trim()), (value) =>
      `${formatUnits(value, 18)} ${plan.fromChain.nativeSymbol || plan.fromChain.nativeToken?.symbol || "native"}`
    ),
    safeCheck(`${plan.fromToken.symbol} balance`, () => balanceOf(rpcUrl, plan.fromToken, plan.fromAddress), (value) =>
      `${formatUnits(value, plan.fromToken.decimals)} ${plan.fromToken.symbol}`
    )
  ];
  if (plan.requiresApproval) {
    checks.push(safeCheck("Allowance", () => allowanceOf(rpcUrl, plan.fromToken, plan.fromAddress, plan.approvalAddress), (value) =>
      `${formatUnits(value, plan.fromToken.decimals)} ${plan.fromToken.symbol}`
    ));
  }
  const policy = signer
    ? evaluateMainnetAutoConfirm(readPolicy(args), {
        action: "bridge",
        signer,
        fromChainId: plan.fromChain.id,
        toChainId: plan.toChain.id,
        tool: plan.tool || "",
        tokenSymbol: plan.fromToken.symbol,
        tokenDecimals: plan.fromToken.decimals,
        amountBase: plan.fromAmount,
        amountHuman: plan.humanAmount
      })
    : { allowed: false, reason: "signer not derived; policy not checked", source: "" };
  return { signer, checks, policy };
}

function ensureBroadcastAllowed(args, plan, signer) {
  if (args.confirm === "CONFIRM_MAINNET_BRIDGE") return { allowed: true, reason: "explicit confirmation" };
  const policyCheck = evaluateMainnetAutoConfirm(readPolicy(args), {
    action: "bridge",
    signer,
    fromChainId: plan.fromChain.id,
    toChainId: plan.toChain.id,
    tool: plan.tool || "",
    tokenSymbol: plan.fromToken.symbol,
    tokenDecimals: plan.fromToken.decimals,
    amountBase: plan.fromAmount,
    amountHuman: plan.humanAmount
  });
  if (!policyCheck.allowed) {
    throw new Error(`Mainnet bridge requires --confirm CONFIRM_MAINNET_BRIDGE or a matching policy: ${policyCheck.reason}`);
  }
  return policyCheck;
}

function executePlan(args, plan) {
  const privateKey = readPrivateKey(args);
  const chainId = runCast(["chain-id", "--rpc-url", plan.fromChain.rpcUrl]).trim();
  if (String(chainId) !== String(plan.fromChain.id)) {
    throw new Error(`RPC chain-id mismatch. Expected ${plan.fromChain.id}, got ${chainId}`);
  }

  const signer = runCast(["wallet", "address", "--private-key", privateKey]).trim();
  if (plan.fromAddress && plan.fromAddress.toLowerCase() !== signer.toLowerCase()) {
    throw new Error(`Plan fromAddress ${plan.fromAddress} does not match signer ${signer}`);
  }

  const policy = ensureBroadcastAllowed(args, plan, signer);
  const result = {
    signer,
    chainId,
    policy,
    approvalTx: "",
    bridgeTx: "",
    jumperStatus: ""
  };

  if (plan.requiresApproval && !isNativeAddress(plan.fromToken.address) && !args["skip-approval"]) {
    const required = BigInt(plan.fromAmount);
    const current = allowanceOf(plan.fromChain.rpcUrl, plan.fromToken, signer, plan.approvalAddress) || 0n;
    if (current !== required) {
      if (current > 0n && !args["keep-existing-allowance"]) {
        result.approvalResetTx = sendApprove(plan, privateKey, plan.approvalAddress, "0");
      }
      if (current < required || !args["keep-existing-allowance"]) {
        result.approvalTx = sendApprove(plan, privateKey, plan.approvalAddress, plan.fromAmount);
      }
    }
  }

  result.bridgeTx = sendBridge(plan, privateKey);
  if (result.bridgeTx) {
    result.jumperStatus = `${loadProviders().lifi.jumperScanTx}${result.bridgeTx}`;
  }
  return result;
}

function summaryRows(plan, safety, savedPlan) {
  const tx = plan.transactionRequest || {};
  const valueWei = BigInt(tx.value || "0x0").toString();
  return [
    { Field: "Provider", Value: "Jumper / LI.FI" },
    { Field: "Route", Value: `${plan.fromChain.name} (${plan.fromChain.id}) -> ${plan.toChain.name} (${plan.toChain.id})` },
    { Field: "From address", Value: plan.fromAddress },
    { Field: "To address", Value: plan.toAddress },
    { Field: "Amount in", Value: `${plan.humanAmount} ${plan.fromToken.symbol} (${plan.fromAmount} base units)` },
    { Field: "Estimated out", Value: plan.quote.estimate?.toAmount ? `${formatUnits(plan.quote.estimate.toAmount, plan.toToken.decimals)} ${plan.toToken.symbol}` : "-" },
    { Field: "Tool", Value: plan.tool || "-" },
    { Field: "Tx target", Value: tx.to || "-" },
    { Field: "Tx value", Value: `${valueWei} wei` },
    { Field: "Calldata", Value: calldataSummary(tx.data) },
    { Field: "Approval", Value: plan.requiresApproval ? `${plan.approvalAddress} exact ${plan.fromAmount}` : "not required" },
    { Field: "Plan", Value: savedPlan || "ephemeral (not saved)" },
    { Field: "Policy", Value: safety.policy.allowed ? `auto-confirm allowed: ${safety.policy.reason}` : `manual confirm required: ${safety.policy.reason}` }
  ];
}

const args = parseArgs(process.argv.slice(2));

try {
  if (args.help || args.h) {
    usage();
    process.exit(0);
  }

  const plan = await buildSafePlan(args);
  const safety = runSafetyChecks(args, plan);
  const savePath = args["save-plan"] || args.output || "";
  const savedPlan = savePath ? path.resolve(savePath) : "";
  if (savedPlan) writeJson(savedPlan, plan);

  const safetyJson = {
    signer: safety.signer,
    checks: safety.checks.map((check) => ({ check: check.label, ok: check.ok, result: check.display })),
    policy: safety.policy
  };

  if (args.json) {
    if (!args.broadcast) {
      outputJson({
        ok: true,
        broadcast: false,
        savedPlan,
        plan,
        safety: safetyJson
      });
    } else {
      const execution = executePlan(args, plan);
      outputJson({ ok: true, broadcast: true, savedPlan, plan, safety: safetyJson, execution });
    }
  } else {
    console.log("# Pharos Bridge Safe");
    console.log("");
    printTable(summaryRows(plan, safety, savedPlan));
    console.log("");
    console.log("Safety checks:");
    printTable([
      ...safety.checks.map((check) => ({ Check: check.label, Result: check.ok ? `ok: ${check.display}` : check.display })),
      { Check: `${plan.fromToken.symbol} needed`, Result: `${plan.humanAmount} ${plan.fromToken.symbol}` },
      { Check: "Signer", Result: safety.signer || "not derived; read-only quote only" },
      { Check: "Broadcast", Result: args.broadcast ? "requested" : "not broadcast" }
    ]);
    console.log("");
    console.log("Bridge command preview:");
    console.log("```bash");
    console.log(castSendPreview(plan.transactionRequest, plan.fromChain.rpcUrl, { compact: !args["show-calldata"] }));
    console.log("```");

    if (!args.broadcast) {
      console.log("");
      console.log("Dry run only. Add --broadcast to execute with a matching policy or CONFIRM_MAINNET_BRIDGE.");
    } else {
      const execution = executePlan(args, plan);
      console.log("");
      console.log(`Signer: ${execution.signer}`);
      if (execution.policy?.reason) console.log(`Auto-confirm policy: ${execution.policy.reason} (${execution.policy.source || "explicit"})`);
      if (execution.approvalResetTx) console.log(`Approval reset tx: ${execution.approvalResetTx}`);
      if (execution.approvalTx) console.log(`Exact approval tx: ${execution.approvalTx}`);
      console.log(`Bridge tx: ${execution.bridgeTx}`);
      if (execution.jumperStatus) console.log(`Jumper status: ${execution.jumperStatus}`);
    }
  }
} catch (error) {
  if (args.json) outputJson({ ok: false, error: error.message });
  else console.error(`Error: ${error.message}`);
  process.exit(1);
}
