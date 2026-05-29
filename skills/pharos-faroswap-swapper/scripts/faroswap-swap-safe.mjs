#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  buildPlan,
  evaluateMainnetAutoConfirm,
  explorerTx,
  extractTxHash,
  formatUnits,
  parseArgs,
  parseCastUint,
  parseUnits,
  planRows,
  printTable,
  readPolicy,
  readPrivateKey,
  resolveToken,
  runCast
} from "./lib/faroswap.mjs";

function usage() {
  console.log(`Usage:
  node scripts/faroswap-swap-safe.mjs --from PROS --to USDC --amount 0.001
  node scripts/faroswap-swap-safe.mjs --from PROS --to USDC --target-out 5
  node scripts/faroswap-swap-safe.mjs --from USDC --to PROS --target-out 5 --broadcast

Defaults:
  - Uses the signer from the local private key when --address is omitted.
  - Keeps the swap plan ephemeral unless --save-plan <file> is provided.
  - For --target-out, quickly finds an input whose minReturnAmount is at least the target.`);
}

function deriveWallet(args) {
  const privateKey = readPrivateKey(args);
  return runCast(["wallet", "address", "--private-key", privateKey]).trim();
}

function calldataWord(data, index) {
  const body = String(data || "").replace(/^0x/, "").slice(8);
  const word = body.slice(index * 64, index * 64 + 64);
  if (word.length !== 64) return null;
  return BigInt(`0x${word}`);
}

function expectedOutBase(plan) {
  return calldataWord(plan.tx.data, 3);
}

function minOutBase(plan) {
  const value = plan.minReturnAmount ? BigInt(plan.minReturnAmount) : null;
  return value ?? calldataWord(plan.tx.data, 4);
}

function amountToBase(value, token) {
  return parseUnits(String(value), Number(token.decimals));
}

function amountFromBase(value, decimals) {
  return formatUnits(BigInt(value), Number(decimals));
}

function writePlan(filePath, plan) {
  const fullPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return fullPath;
}

function assertFresh(plan) {
  const expires = Date.parse(plan.expiresAt || "");
  if (Number.isFinite(expires) && Date.now() > expires) {
    throw new Error(`Plan expired at ${plan.expiresAt}. Refresh before execution.`);
  }
}

function assertChain(plan) {
  const chainId = parseCastUint(runCast(["chain-id", "--rpc-url", plan.network.rpcUrl]));
  if (chainId !== BigInt(plan.network.chainId)) {
    throw new Error(`RPC chain-id mismatch. Expected ${plan.network.chainId}, got ${chainId}`);
  }
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
  const out = runCast([
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
  ]);
  return extractTxHash(out);
}

async function quoteAmountBase(args, fromToken, amountBase, slippage) {
  return buildPlan({
    network: "mainnet",
    from: args.from,
    to: args.to,
    amountBase,
    address: args.address,
    slippage,
    estimateGas: args["estimate-gas"] ?? true
  });
}

async function findTargetOutPlan(args, fromToken, toToken) {
  const targetBase = amountToBase(args["target-out"], toToken);
  const slippage = args.slippage || "0.000001";
  const maxQuotes = Number(args["max-quotes"] || 8);
  const oneInputBase = 10n ** BigInt(Number(fromToken.decimals));
  const oneQuote = await quoteAmountBase(args, fromToken, oneInputBase, slippage);
  let quoteCount = 1;
  const oneMin = minOutBase(oneQuote) || expectedOutBase(oneQuote);
  if (!oneMin || oneMin <= 0n) throw new Error("Could not estimate Faroswap output for one input unit");

  let high = (targetBase * oneInputBase) / oneMin;
  high = (high * 102n) / 100n + 1n;
  let highPlan = await quoteAmountBase(args, fromToken, high, slippage);
  quoteCount += 1;
  let highMin = minOutBase(highPlan);
  let expansions = 0;
  while ((!highMin || highMin < targetBase) && expansions < 6) {
    high *= 2n;
    highPlan = await quoteAmountBase(args, fromToken, high, slippage);
    quoteCount += 1;
    highMin = minOutBase(highPlan);
    expansions += 1;
  }
  if (!highMin || highMin < targetBase) {
    throw new Error(`Could not find input amount that reaches ${args["target-out"]} ${toToken.symbol}`);
  }

  let low = 1n;
  let best = highPlan;
  for (let i = 0; i < maxQuotes; i += 1) {
    const mid = (low + high) / 2n;
    const plan = await quoteAmountBase(args, fromToken, mid, slippage);
    quoteCount += 1;
    const minOut = minOutBase(plan);
    if (minOut && minOut >= targetBase) {
      best = plan;
      high = mid - 1n;
    } else {
      low = mid + 1n;
    }
  }
  best.targetOut = {
    amount: String(args["target-out"]),
    amountBase: targetBase.toString(),
    mode: "min-return-at-least-target",
    quotesUsed: quoteCount
  };
  return best;
}

function ensureBroadcastAllowed(args, plan, wallet) {
  if (args.confirm === "CONFIRM_MAINNET_SWAP") return;
  const policyCheck = evaluateMainnetAutoConfirm(readPolicy(args), {
    action: "swap",
    signer: wallet,
    tokenSymbol: plan.fromToken.symbol,
    tokenDecimals: plan.fromToken.decimals,
    amountBase: plan.amountInBase,
    amountHuman: plan.amountIn
  });
  if (!policyCheck.allowed) {
    throw new Error(`Mainnet swap requires --confirm CONFIRM_MAINNET_SWAP or a matching policy: ${policyCheck.reason}`);
  }
  console.log(`Auto-confirm policy: ${policyCheck.reason} (${policyCheck.source})`);
}

function executePlan(args, plan) {
  assertFresh(plan);
  assertChain(plan);
  const privateKey = readPrivateKey(args);
  const wallet = runCast(["wallet", "address", "--private-key", privateKey]).trim();
  if (plan.userAddress && !/^0x0{40}$/i.test(plan.userAddress) && plan.userAddress.toLowerCase() !== wallet.toLowerCase()) {
    throw new Error(`Plan was quoted for ${plan.userAddress}, but private key resolves to ${wallet}`);
  }
  ensureBroadcastAllowed(args, plan, wallet);
  console.log(`Wallet: ${wallet}`);

  if (plan.approval && !args["skip-approval"]) {
    const required = BigInt(plan.approval.amountBase);
    const current = allowanceOf(plan, wallet, plan.approval);
    console.log(`Current allowance: ${formatUnits(current, plan.fromToken.decimals)} ${plan.fromToken.symbol}`);
    if (current !== required) {
      if (current > 0n && !args["keep-existing-allowance"]) {
        const resetHash = sendApprove(plan, privateKey, plan.approval.spender, "0");
        console.log(`Approval reset tx: ${resetHash} (${explorerTx(plan.network, resetHash)})`);
      }
      if (current < required || !args["keep-existing-allowance"]) {
        const approveHash = sendApprove(plan, privateKey, plan.approval.spender, plan.approval.amountBase);
        console.log(`Exact approval tx: ${approveHash} (${explorerTx(plan.network, approveHash)})`);
      }
    } else {
      console.log("Approval already exact.");
    }
  }

  const swapHash = sendSwap(plan, privateKey);
  console.log(`Swap tx: ${swapHash} (${explorerTx(plan.network, swapHash)})`);
}

const args = parseArgs(process.argv.slice(2));

try {
  if (args.help || args.h) {
    usage();
    process.exit(0);
  }
  if (!args.from || !args.to) throw new Error("--from and --to are required");
  if (!args.amount && !args["target-out"]) throw new Error("Provide --amount for exact-input or --target-out for target-output");
  if (args.amount && args["target-out"]) throw new Error("Use either --amount or --target-out, not both");
  if (!args.address && (args.broadcast || args["target-out"])) {
    args.address = deriveWallet(args);
  }

  const fromToken = resolveToken(args.from, "mainnet");
  const toToken = resolveToken(args.to, "mainnet");
  const plan = args["target-out"]
    ? await findTargetOutPlan(args, fromToken, toToken)
    : await buildPlan({
        network: "mainnet",
        from: args.from,
        to: args.to,
        amount: args.amount,
        address: args.address,
        slippage: args.slippage,
        estimateGas: args["estimate-gas"] ?? true
      });

  if (args.json && !args.broadcast) {
    console.log(JSON.stringify({
      ok: true,
      broadcast: false,
      savedPlan: args["save-plan"] ? writePlan(args["save-plan"], plan) : "",
      plan
    }, null, 2));
  } else {
    console.log("# Faroswap Safe Swap");
    console.log("");
    printTable(planRows(plan));
    if (plan.targetOut) {
      const minOut = minOutBase(plan);
      const expOut = expectedOutBase(plan);
      console.log("");
      printTable([
        { Field: "Target out", Value: `${plan.targetOut.amount} ${toToken.symbol}` },
        { Field: "Expected out", Value: expOut === null ? "-" : `${amountFromBase(expOut, toToken.decimals)} ${toToken.symbol}` },
        { Field: "Minimum out", Value: minOut === null ? "-" : `${amountFromBase(minOut, toToken.decimals)} ${toToken.symbol}` },
        { Field: "Quotes used", Value: String(plan.targetOut.quotesUsed) }
      ]);
    }

    if (args["save-plan"]) {
      console.log(`Saved plan: ${writePlan(args["save-plan"], plan)}`);
    } else {
      console.log("Plan: ephemeral (not saved). Use --save-plan <file> to keep it.");
    }

    if (!args.broadcast) {
      console.log("Dry run only. Add --broadcast to execute with a matching policy or CONFIRM_MAINNET_SWAP.");
    } else {
      executePlan(args, plan);
    }
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
