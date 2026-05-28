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
  resolveLifiToken,
  resolveLocalChain,
  runCast,
  tryReadPrivateKey,
  writeJson
} from "./lib/bridge.mjs";

function usage() {
  console.log(`Usage:
  node scripts/bridge-plan-safe.mjs --from pharos --to base --from-token USDC --to-token USDC --amount 0.05
  node scripts/bridge-plan-safe.mjs --from pharos --to base --from-token USDC --to-token USDC --amount 0.05 --address 0xWallet --output plan.json

This is read-only: quote, chain-id check, balance check, allowance check, and saved plan. It never broadcasts.`);
}

function parseCastUint(output) {
  const match = String(output || "").match(/\b\d+\b/);
  return match ? BigInt(match[0]) : 0n;
}

function safeCast(label, fn) {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, value: `${label}: ${error.message}` };
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }

  const provider = String(args.provider || "lifi").toLowerCase();
  if (!["lifi", "jumper"].includes(provider)) throw new Error(`Unsupported quote provider "${args.provider}". Use lifi or jumper.`);

  const fromChain = await enrichChain(resolveLocalChain(args.from || "pharos"));
  const toChain = await enrichChain(resolveLocalChain(args.to));
  if (!args.amount) throw new Error("--amount is required");

  const privateKey = tryReadPrivateKey(args);
  const derivedAddress = privateKey ? runCast(["wallet", "address", "--private-key", privateKey]).trim() : "";
  const fromAddress = args["from-address"] || args.address || derivedAddress;
  const toAddress = args["to-address"] || args.address || fromAddress;
  if (!isAddress(fromAddress)) throw new Error("--address or a discoverable private key is required");
  if (!isAddress(toAddress)) throw new Error("--to-address must be a valid EVM address");

  const fromToken = await resolveLifiToken(fromChain.id, args["from-token"] || "USDC", args["from-decimals"]);
  const toToken = await resolveLifiToken(toChain.id, args["to-token"] || args["from-token"] || "USDC");
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
  const valueWei = BigInt(tx.value || "0x0").toString();

  const plan = {
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

  const defaultOutput = path.resolve(`bridge-plan-${fromChain.id}-${toChain.id}-${fromToken.symbol}-${Date.now()}.json`);
  const output = path.resolve(args.output || defaultOutput);
  writeJson(output, plan);

  const chainCheck = safeCast("chain-id", () => runCast(["chain-id", "--rpc-url", fromChain.rpcUrl]).trim());
  const nativeBalance = safeCast("native balance", () => BigInt(runCast(["balance", fromAddress, "--rpc-url", fromChain.rpcUrl]).trim()));
  const sourceBalance = safeCast("source token balance", () => balanceOf(fromChain.rpcUrl, fromToken, fromAddress));
  const allowance = requiresApproval
    ? safeCast("allowance", () => allowanceOf(fromChain.rpcUrl, fromToken, fromAddress, approvalAddress))
    : { ok: true, value: null };

  const policyCheck = derivedAddress
    ? evaluateMainnetAutoConfirm(readPolicy(args), {
        action: "bridge",
        signer: derivedAddress,
        fromChainId: fromChain.id,
        toChainId: toChain.id,
        tool: quote.tool || "",
        tokenSymbol: fromToken.symbol,
        tokenDecimals: fromToken.decimals,
        amountBase: fromAmount,
        amountHuman: String(args.amount)
      })
    : { allowed: false, reason: "signer not derived; policy not checked" };

  console.log("# Pharos Bridge Safe Plan");
  console.log("");
  printTable([
    { Field: "Provider", Value: "Jumper / LI.FI" },
    { Field: "Route", Value: `${fromChain.name} (${fromChain.id}) -> ${toChain.name} (${toChain.id})` },
    { Field: "From address", Value: fromAddress },
    { Field: "To address", Value: toAddress },
    { Field: "Amount in", Value: `${args.amount} ${fromToken.symbol} (${fromAmount} base units)` },
    { Field: "Estimated out", Value: quote.estimate?.toAmount ? `${formatUnits(quote.estimate.toAmount, toToken.decimals)} ${toToken.symbol}` : "-" },
    { Field: "Tool", Value: quote.tool || "-" },
    { Field: "Tx target", Value: tx.to || "-" },
    { Field: "Tx value", Value: `${valueWei} wei` },
    { Field: "Calldata", Value: calldataSummary(tx.data) },
    { Field: "Approval", Value: requiresApproval ? `${approvalAddress} exact ${fromAmount}` : "not required" },
    { Field: "Saved plan", Value: output }
  ]);

  console.log("");
  console.log("Safety checks:");
  printTable([
    { Check: "RPC chain id", Result: chainCheck.ok && String(chainCheck.value) === String(fromChain.id) ? `ok (${chainCheck.value})` : String(chainCheck.value) },
    { Check: "Signer", Result: derivedAddress || "not derived; read-only quote only" },
    { Check: "Native gas balance", Result: nativeBalance.ok ? `${formatUnits(nativeBalance.value, 18)} ${fromChain.nativeSymbol || fromChain.nativeToken?.symbol || "native"}` : String(nativeBalance.value) },
    { Check: `${fromToken.symbol} balance`, Result: sourceBalance.ok ? `${formatUnits(sourceBalance.value, fromToken.decimals)} ${fromToken.symbol}` : String(sourceBalance.value) },
    { Check: `${fromToken.symbol} needed`, Result: `${args.amount} ${fromToken.symbol}` },
    { Check: "Allowance", Result: allowance.value === null ? "not required" : allowance.ok ? `${formatUnits(allowance.value, fromToken.decimals)} ${fromToken.symbol}` : String(allowance.value) },
    { Check: "Policy", Result: policyCheck.allowed ? `auto-confirm allowed: ${policyCheck.reason}` : `manual confirm required: ${policyCheck.reason}` },
    { Check: "Broadcast", Result: "not broadcast" }
  ]);

  console.log("");
  console.log("Bridge command preview:");
  console.log("```bash");
  console.log(castSendPreview(tx, fromChain.rpcUrl, { compact: !args["show-calldata"] }));
  console.log("```");
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
