#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { arrayArg, buildPlan, planJson } from "./lib/batch.mjs";
import { explorerAddress, parseArgs, printTable, shellQuote } from "./lib/pharos.mjs";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/batch-plan.mjs --asset native --amount 0.05 --recipients 0xA,0xB --network mainnet");
  console.log("  node scripts/batch-plan.mjs --asset native --mode distributor --distributor <addr> --amount 0.05 --input recipients.csv");
  console.log("  node scripts/batch-plan.mjs --asset erc20 --token USDC --input recipients.csv --network mainnet");
}

function commandPreview(plan, rows) {
  const recipients = arrayArg(rows.map((row) => row.address));
  const amounts = arrayArg(rows.map((row) => row.amountBase.toString()));
  const total = rows.reduce((sum, row) => sum + row.amountBase, 0n).toString();

  if (plan.mode === "distributor" && !plan.distributor) {
    return "Deploy or provide --distributor before broadcast.";
  }

  if (plan.mode === "distributor" && plan.asset === "native" && plan.uniform) {
    return `cast send ${plan.distributor} "batchTransferUniform(address[],uint256)" ${shellQuote(recipients)} ${plan.uniformAmountBase} --value ${total} --private-key "$PRIVATE_KEY" --rpc-url ${shellQuote(plan.network.rpcUrl)}`;
  }
  if (plan.mode === "distributor" && plan.asset === "native") {
    return `cast send ${plan.distributor} "batchTransfer(address[],uint256[])" ${shellQuote(recipients)} ${shellQuote(amounts)} --value ${total} --private-key "$PRIVATE_KEY" --rpc-url ${shellQuote(plan.network.rpcUrl)}`;
  }
  if (plan.mode === "distributor" && plan.asset === "erc20" && plan.uniform) {
    return `cast send ${plan.distributor} "batchTransferERC20Uniform(address,address[],uint256)" ${plan.token.address} ${shellQuote(recipients)} ${plan.uniformAmountBase} --private-key "$PRIVATE_KEY" --rpc-url ${shellQuote(plan.network.rpcUrl)}`;
  }
  if (plan.mode === "distributor" && plan.asset === "erc20") {
    return `cast send ${plan.distributor} "batchTransferERC20(address,address[],uint256[])" ${plan.token.address} ${shellQuote(recipients)} ${shellQuote(amounts)} --private-key "$PRIVATE_KEY" --rpc-url ${shellQuote(plan.network.rpcUrl)}`;
  }

  if (plan.asset === "native") {
    const row = rows[0];
    return `cast send ${row.address} --value ${row.amountBase}wei --private-key "$PRIVATE_KEY" --rpc-url ${shellQuote(plan.network.rpcUrl)}`;
  }
  const row = rows[0];
  return `cast send ${plan.token.address} "transfer(address,uint256)" ${row.address} ${row.amountBase} --private-key "$PRIVATE_KEY" --rpc-url ${shellQuote(plan.network.rpcUrl)}`;
}

const args = parseArgs(process.argv.slice(2));

try {
  if (args.help) {
    usage();
    process.exit(0);
  }

  const plan = buildPlan(args);
  if (args.output) {
    fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(planJson(plan), null, 2)}\n`, "utf8");
  }

  const assetLabel = plan.asset === "native"
    ? plan.network.nativeToken
    : `${plan.token.symbol} (${plan.token.address})`;

  console.log("# Pharos Batch Transfer Plan");
  console.log("");
  printTable([
    { Field: "Network", Value: `${plan.network.name} (${plan.network.nativeToken})` },
    { Field: "Chain ID", Value: String(plan.network.chainId) },
    { Field: "Asset", Value: assetLabel },
    { Field: "Mode", Value: plan.mode },
    { Field: "Recipients", Value: String(plan.rows.length) },
    { Field: "Uniform", Value: plan.uniform ? `yes (${plan.uniformAmountDisplay})` : "no" },
    { Field: "Total", Value: `${plan.totalDisplay} ${plan.asset === "native" ? plan.network.nativeToken : plan.token.symbol}` },
    { Field: "Chunks", Value: `${plan.chunks.length} x <=${plan.chunkSize}` },
    { Field: "Distributor", Value: plan.distributor ? explorerAddress(plan.network, plan.distributor) : "-" }
  ]);

  console.log("");
  console.log("First recipients:");
  printTable(plan.rows.slice(0, 10).map((row, index) => ({
    "#": String(index + 1),
    Recipient: row.address,
    Amount: row.amountDecimal,
    BaseUnits: row.amountBase.toString()
  })));
  if (plan.rows.length > 10) console.log(`... ${plan.rows.length - 10} more recipients hidden`);

  console.log("");
  console.log("Command previews:");
  for (let i = 0; i < Math.min(plan.chunks.length, 3); i += 1) {
    console.log(`Chunk ${i + 1}:`);
    console.log("```bash");
    console.log(commandPreview(plan, plan.chunks[i]));
    console.log("```");
  }
  if (plan.chunks.length > 3) console.log(`... ${plan.chunks.length - 3} more chunks hidden`);

  if (args.output) console.log(`\nPlan JSON: ${path.resolve(args.output)}`);
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
