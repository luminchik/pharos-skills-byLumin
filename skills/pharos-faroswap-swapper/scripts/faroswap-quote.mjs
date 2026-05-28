#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  buildPlan,
  loadTokens,
  parseArgs,
  planRows,
  printTable
} from "./lib/faroswap.mjs";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/faroswap-quote.mjs --from PROS --to USDC --amount 0.001 --address 0xWallet");
  console.log("  node scripts/faroswap-quote.mjs --from USDC --to PROS --amount 1 --address 0xWallet --output plan.json");
  console.log("  node scripts/faroswap-quote.mjs --matrix --address 0xWallet --amount 0.001");
}

function boolArg(value, fallback = undefined) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  return !["false", "0", "no"].includes(String(value).toLowerCase());
}

async function quoteOne(args) {
  const plan = await buildPlan({
    network: args.network || "mainnet",
    from: args.from,
    to: args.to,
    amount: args.amount,
    address: args.address,
    slippage: args.slippage,
    deadlineMinutes: args["deadline-minutes"],
    estimateGas: boolArg(args["estimate-gas"])
  });

  console.log("# Faroswap Quote");
  console.log("");
  printTable(planRows(plan));
  if (plan.route.routeInfo) {
    console.log("");
    console.log("Route pools:");
    const rows = [];
    for (const subRoute of plan.route.routeInfo.subRoute || []) {
      for (const midPath of subRoute.midPath || []) {
        for (const pool of midPath.poolDetails || []) {
          rows.push({
            Pool: pool.poolName || "-",
            Address: pool.pool || "-",
            In: pool.poolInAmount || "-",
            Out: pool.poolOutAmount || "-",
            Part: String(pool.poolPart ?? "-")
          });
        }
      }
    }
    printTable(rows);
  }

  if (args.output) {
    const output = path.resolve(args.output);
    fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    console.log(`\nPlan JSON: ${output}`);
  }
}

async function quoteMatrix(args) {
  const tokens = loadTokens().mainnet || [];
  const rows = [];
  for (const from of tokens) {
    for (const to of tokens) {
      if (from.symbol === to.symbol) continue;
      try {
        const plan = await buildPlan({
          network: "mainnet",
          from: from.symbol,
          to: to.symbol,
          amount: args.amount || "0.001",
          address: args.address,
          slippage: args.slippage,
          estimateGas: from.native
        });
        rows.push({
          Pair: `${from.symbol}->${to.symbol}`,
          In: `${plan.amountIn} ${from.symbol}`,
          Out: `${plan.estimatedOut} ${to.symbol}`,
          MinReturn: plan.minReturnAmount,
          Target: plan.tx.to,
          ValueWei: plan.tx.value,
          Approval: plan.approval ? plan.approval.spender : "-"
        });
      } catch (error) {
        rows.push({
          Pair: `${from.symbol}->${to.symbol}`,
          In: `${args.amount || "0.001"} ${from.symbol}`,
          Out: "ERROR",
          MinReturn: "-",
          Target: "-",
          ValueWei: "-",
          Approval: error.message
        });
      }
    }
  }
  console.log("# Faroswap Built-In Pair Matrix");
  console.log("");
  printTable(rows);
}

const args = parseArgs(process.argv.slice(2));

try {
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (args.matrix) {
    await quoteMatrix(args);
  } else {
    for (const required of ["from", "to", "amount"]) {
      if (!args[required]) throw new Error(`Missing --${required}`);
    }
    await quoteOne(args);
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
