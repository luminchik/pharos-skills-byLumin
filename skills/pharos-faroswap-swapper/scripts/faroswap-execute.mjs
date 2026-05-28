#!/usr/bin/env node
import {
  explorerTx,
  evaluateMainnetAutoConfirm,
  extractTxHash,
  formatUnits,
  loadPlan,
  parseArgs,
  parseCastUint,
  printTable,
  readPrivateKey,
  readPolicy,
  runCast
} from "./lib/faroswap.mjs";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/faroswap-execute.mjs --plan faroswap-plan.json");
  console.log("  node scripts/faroswap-execute.mjs --plan faroswap-plan.json --broadcast --confirm CONFIRM_MAINNET_SWAP");
  console.log("  Optional: --private-key-file <path> for local secret-file broadcasts");
  console.log("  Optional: --policy <path> to use a mainnet auto-confirm policy");
}

function requireFresh(plan) {
  const expires = Date.parse(plan.expiresAt || "");
  if (Number.isFinite(expires) && Date.now() > expires) {
    throw new Error(`Plan expired at ${plan.expiresAt}. Refresh quote before execution.`);
  }
}

function assertChain(plan) {
  const chainId = parseCastUint(runCast(["chain-id", "--rpc-url", plan.network.rpcUrl]));
  if (chainId !== BigInt(plan.network.chainId)) {
    throw new Error(`RPC chain-id mismatch. Expected ${plan.network.chainId}, got ${chainId}`);
  }
}

function deriveWallet(privateKey) {
  return runCast(["wallet", "address", "--private-key", privateKey]).trim();
}

function allowanceOf(plan, owner, approval) {
  const out = runCast([
    "call",
    approval.token,
    "allowance(address,address)(uint256)",
    owner,
    approval.spender,
    "--rpc-url",
    plan.network.rpcUrl
  ]);
  return parseCastUint(out);
}

function sendApprove(plan, privateKey, spender, amount) {
  const out = runCast([
    "send",
    plan.approval.token,
    "approve(address,uint256)",
    spender,
    amount,
    "--private-key",
    privateKey,
    "--rpc-url",
    plan.network.rpcUrl
  ]);
  return extractTxHash(out);
}

function sendSwap(plan, privateKey) {
  const args = [
    "send",
    plan.tx.to,
    "--data",
    plan.tx.data,
    "--value",
    `${plan.tx.value || "0"}wei`,
    "--private-key",
    privateKey,
    "--rpc-url",
    plan.network.rpcUrl
  ];
  const out = runCast(args);
  return extractTxHash(out);
}

const args = parseArgs(process.argv.slice(2));

try {
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args.plan) throw new Error("Missing --plan");
  const plan = loadPlan(args.plan);

  console.log("# Faroswap Execute Plan");
  console.log("");
  printTable([
    { Field: "Network", Value: `${plan.network.name} (${plan.network.chainId})` },
    { Field: "From", Value: `${plan.amountIn} ${plan.fromToken.symbol}` },
    { Field: "To estimate", Value: `${plan.estimatedOut} ${plan.toToken.symbol}` },
    { Field: "Min return", Value: `${plan.minReturnAmount} base units` },
    { Field: "Target", Value: plan.tx.to },
    { Field: "Value", Value: `${plan.tx.value} wei` },
    { Field: "Approval", Value: plan.approval ? `${plan.approval.amount} ${plan.approval.tokenSymbol} -> ${plan.approval.spender}` : "not required" },
    { Field: "Expires", Value: plan.expiresAt }
  ]);

  if (!args.broadcast) {
    console.log("");
    console.log("Dry run only. Add --broadcast --confirm CONFIRM_MAINNET_SWAP to execute, or --broadcast with a matching local policy.");
    process.exit(0);
  }

  requireFresh(plan);
  assertChain(plan);
  const privateKey = readPrivateKey(args);
  const wallet = deriveWallet(privateKey);
  if (plan.userAddress && !/^0x0{40}$/i.test(plan.userAddress) && plan.userAddress.toLowerCase() !== wallet.toLowerCase()) {
    throw new Error(`Plan was quoted for ${plan.userAddress}, but PRIVATE_KEY resolves to ${wallet}. Refresh the plan with this wallet.`);
  }

  if (args.confirm !== "CONFIRM_MAINNET_SWAP") {
    const policyCheck = evaluateMainnetAutoConfirm(readPolicy(args), {
      action: "swap",
      signer: wallet,
      tokenSymbol: plan.fromToken.symbol,
      tokenDecimals: plan.fromToken.decimals,
      amountBase: plan.amountInBase,
      amountHuman: plan.amountIn
    });
    if (!policyCheck.allowed) {
      throw new Error(`Mainnet swap execution requires --confirm CONFIRM_MAINNET_SWAP or a matching policy: ${policyCheck.reason}`);
    }
    console.log(`Auto-confirm policy: ${policyCheck.reason} (${policyCheck.source})`);
  }
  console.log(`\nWallet: ${wallet}`);

  if (plan.approval && !args["skip-approval"]) {
    const required = BigInt(plan.approval.amountBase);
    const current = allowanceOf(plan, wallet, plan.approval);
    console.log(`Current allowance: ${formatUnits(current, plan.fromToken.decimals)} ${plan.fromToken.symbol}`);
    if (current === required) {
      console.log("Approval already exact.");
    } else if (current > required && !args["keep-existing-allowance"]) {
      const resetHash = sendApprove(plan, privateKey, plan.approval.spender, "0");
      console.log(`Approval reset tx: ${resetHash} (${explorerTx(plan.network, resetHash)})`);
      const approveHash = sendApprove(plan, privateKey, plan.approval.spender, plan.approval.amountBase);
      console.log(`Exact approval tx: ${approveHash} (${explorerTx(plan.network, approveHash)})`);
    } else if (current < required) {
      if (current > 0n) {
        const resetHash = sendApprove(plan, privateKey, plan.approval.spender, "0");
        console.log(`Approval reset tx: ${resetHash} (${explorerTx(plan.network, resetHash)})`);
      }
      const approveHash = sendApprove(plan, privateKey, plan.approval.spender, plan.approval.amountBase);
      console.log(`Exact approval tx: ${approveHash} (${explorerTx(plan.network, approveHash)})`);
    } else {
      console.log("Existing allowance kept because --keep-existing-allowance was provided.");
    }
  }

  const swapHash = sendSwap(plan, privateKey);
  console.log(`Swap tx: ${swapHash} (${explorerTx(plan.network, swapHash)})`);
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
