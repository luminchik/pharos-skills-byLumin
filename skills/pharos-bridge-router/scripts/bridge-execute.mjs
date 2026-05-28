#!/usr/bin/env node
import {
  castSendPreview,
  calldataSummary,
  evaluateMainnetAutoConfirm,
  isNativeAddress,
  loadProviders,
  parseArgs,
  planAgeSeconds,
  printTable,
  readPrivateKey,
  readJson,
  readPolicy,
  runCast
} from "./lib/bridge.mjs";

function usage() {
  console.log(`Usage:
  node scripts/bridge-execute.mjs --plan plan.json
  node scripts/bridge-execute.mjs --plan plan.json --broadcast --confirm CONFIRM_MAINNET_BRIDGE

Optional: --private-key-file <path> for local secret-file broadcasts
Optional: --policy <path> to use a mainnet auto-confirm policy

Without --broadcast this script only validates and prints command previews.`);
}

function requireFreshPlan(plan, maxAgeSeconds) {
  const age = planAgeSeconds(plan);
  if (age > maxAgeSeconds) {
    throw new Error(`Plan is ${age}s old. Refresh the quote before execution.`);
  }
  return age;
}

function parseTxHash(output) {
  return String(output || "").match(/transactionHash\s+(0x[a-fA-F0-9]{64})/)?.[1] || String(output || "").match(/0x[a-fA-F0-9]{64}/)?.[0] || "";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }
  if (!args.plan) throw new Error("--plan is required");
  const plan = readJson(args.plan);
  if (plan.schema !== "pharos-bridge-router-plan/v1") throw new Error("Unsupported plan schema");
  if (plan.provider !== "lifi") throw new Error(`Unsupported plan provider "${plan.provider}"`);
  const maxAgeSeconds = Number(args["max-age"] || 600);
  const age = requireFreshPlan(plan, maxAgeSeconds);
  const providers = loadProviders();
  const rpcUrl = plan.fromChain.rpcUrl;
  const tx = plan.transactionRequest;

  console.log("# Pharos Bridge Execute");
  console.log("");
  printTable([
    { Field: "Plan", Value: args.plan },
    { Field: "Age", Value: `${age}s` },
    { Field: "Provider", Value: "Jumper / LI.FI" },
    { Field: "Route", Value: `${plan.fromChain.name} (${plan.fromChain.id}) -> ${plan.toChain.name} (${plan.toChain.id})` },
    { Field: "Amount", Value: `${plan.humanAmount} ${plan.fromToken.symbol}` },
    { Field: "Tool", Value: plan.tool || "-" },
    { Field: "Approval", Value: plan.requiresApproval ? plan.approvalAddress : "not required" },
    { Field: "Tx target", Value: tx.to },
    { Field: "Tx value", Value: `${BigInt(tx.value || "0x0").toString()} wei` },
    { Field: "Calldata", Value: calldataSummary(tx.data) }
  ]);

  console.log("");
  console.log("Bridge command preview:");
  console.log("```bash");
  console.log(castSendPreview(tx, rpcUrl, { compact: !args["show-calldata"] }));
  console.log("```");

  if (!args.broadcast) {
    console.log("");
    console.log("Dry run only. Add --broadcast --confirm CONFIRM_MAINNET_BRIDGE to execute, or --broadcast with a matching local policy.");
    return;
  }

  const pk = readPrivateKey(args);

  const chainId = runCast(["chain-id", "--rpc-url", rpcUrl]).trim();
  if (String(chainId) !== String(plan.fromChain.id)) {
    throw new Error(`RPC chain id mismatch: expected ${plan.fromChain.id}, got ${chainId}`);
  }

  const signer = runCast(["wallet", "address", "--private-key", pk]).trim();
  if (plan.fromAddress && String(plan.fromAddress).toLowerCase() !== signer.toLowerCase()) {
    throw new Error(`Plan fromAddress ${plan.fromAddress} does not match signer ${signer}. Refresh the quote with this wallet.`);
  }

  if (args.confirm !== "CONFIRM_MAINNET_BRIDGE") {
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
      throw new Error(`Mainnet bridge execution requires --confirm CONFIRM_MAINNET_BRIDGE or a matching policy: ${policyCheck.reason}`);
    }
    console.log(`Auto-confirm policy: ${policyCheck.reason} (${policyCheck.source})`);
  }

  console.log("");
  console.log(`Signer: ${signer}`);
  console.log(`Source chain ID: ${chainId}`);

  if (plan.requiresApproval && !isNativeAddress(plan.fromToken.address)) {
    const approvalArgs = [
      "send",
      plan.fromToken.address,
      "approve(address,uint256)",
      plan.approvalAddress,
      plan.fromAmount,
      "--private-key",
      pk,
      "--rpc-url",
      rpcUrl
    ];
    const approvalOut = runCast(approvalArgs);
    const approvalTx = parseTxHash(approvalOut);
    console.log(`Approval tx: ${approvalTx || approvalOut}`);
  }

  const sendArgs = [
    "send",
    tx.to,
    "--data",
    tx.data || "0x",
    "--value",
    `${BigInt(tx.value || "0x0").toString()}wei`,
    "--private-key",
    pk,
    "--rpc-url",
    rpcUrl
  ];
  const bridgeOut = runCast(sendArgs);
  const bridgeTx = parseTxHash(bridgeOut);
  console.log(`Bridge tx: ${bridgeTx || bridgeOut}`);
  if (bridgeTx) {
    console.log(`Jumper status: ${providers.lifi.jumperScanTx}${bridgeTx}`);
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
