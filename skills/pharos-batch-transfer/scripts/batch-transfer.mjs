#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { arrayArg, buildPlan } from "./lib/batch.mjs";
import {
  explorerTx,
  parseArgs,
  parseTxHash,
  printTable,
  runCast,
  shellQuote
} from "./lib/pharos.mjs";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/batch-transfer.mjs --asset native --mode distributor --distributor <addr> --amount 0.05 --input recipients.csv --network mainnet");
  console.log("  node scripts/batch-transfer.mjs ... --broadcast --confirm CONFIRM_MAINNET_BATCH_TRANSFER");
}

function verifyChain(network) {
  const returned = runCast(["chain-id", "--rpc-url", network.rpcUrl]).trim();
  if (String(returned) !== String(network.chainId)) {
    throw new Error(`RPC chain id mismatch: expected ${network.chainId}, got ${returned}`);
  }
  return returned;
}

function getSigner(privateKey) {
  return runCast(["wallet", "address", "--private-key", privateKey]).trim();
}

function getNativeBalance(network, address) {
  return BigInt(runCast(["balance", address, "--rpc-url", network.rpcUrl]).trim());
}

function getTokenBalance(network, token, address) {
  return BigInt(runCast(["call", token.address, "balanceOf(address)(uint256)", address, "--rpc-url", network.rpcUrl]).match(/\d+/)?.[0] || "0");
}

function ensureDistributor(network, address) {
  if (!address) throw new Error("--distributor is required for distributor mode");
  const code = runCast(["code", address, "--rpc-url", network.rpcUrl]).trim();
  if (!code || code === "0x") throw new Error(`No contract code at distributor ${address}`);
}

function nativeDistributorArgs(plan, rows) {
  const recipients = arrayArg(rows.map((row) => row.address));
  const amounts = arrayArg(rows.map((row) => row.amountBase.toString()));
  const total = rows.reduce((sum, row) => sum + row.amountBase, 0n).toString();
  if (plan.uniform) {
    return [plan.distributor, "batchTransferUniform(address[],uint256)", recipients, plan.uniformAmountBase.toString(), "--value", total];
  }
  return [plan.distributor, "batchTransfer(address[],uint256[])", recipients, amounts, "--value", total];
}

function erc20DistributorArgs(plan, rows) {
  const recipients = arrayArg(rows.map((row) => row.address));
  const amounts = arrayArg(rows.map((row) => row.amountBase.toString()));
  if (plan.uniform) {
    return [plan.distributor, "batchTransferERC20Uniform(address,address[],uint256)", plan.token.address, recipients, plan.uniformAmountBase.toString()];
  }
  return [plan.distributor, "batchTransferERC20(address,address[],uint256[])", plan.token.address, recipients, amounts];
}

function previewCommand(network, args) {
  return `cast send ${args.map(shellQuote).join(" ")} --private-key "$PRIVATE_KEY" --rpc-url ${shellQuote(network.rpcUrl)}`;
}

function send(network, privateKey, args) {
  const output = runCast(["send", ...args, "--private-key", privateKey, "--rpc-url", network.rpcUrl]);
  const tx = parseTxHash(output);
  console.log(output);
  if (tx) console.log(`Explorer: ${explorerTx(network, tx)}`);
  return tx || "-";
}

function writeReport(reportPath, rows) {
  fs.writeFileSync(reportPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

const args = parseArgs(process.argv.slice(2));

try {
  if (args.help) {
    usage();
    process.exit(0);
  }

  const plan = buildPlan(args);
  console.log("# Pharos Batch Transfer Execute Plan");
  console.log("");
  printTable([
    { Field: "Network", Value: `${plan.network.name} (${plan.network.nativeToken})` },
    { Field: "Chain ID", Value: String(plan.network.chainId) },
    { Field: "Asset", Value: plan.asset === "native" ? plan.network.nativeToken : `${plan.token.symbol} (${plan.token.address})` },
    { Field: "Mode", Value: plan.mode },
    { Field: "Recipients", Value: String(plan.rows.length) },
    { Field: "Total", Value: plan.totalDisplay },
    { Field: "Chunks", Value: String(plan.chunks.length) },
    { Field: "Broadcast", Value: args.broadcast ? "yes" : "no" }
  ]);

  if (plan.mode === "distributor") {
    ensureDistributor(plan.network, plan.distributor);
  }

  if (!args.broadcast) {
    console.log("");
    console.log("Preview commands:");
    for (let i = 0; i < Math.min(plan.chunks.length, 3); i += 1) {
      let callArgs;
      if (plan.mode === "distributor" && plan.asset === "native") callArgs = nativeDistributorArgs(plan, plan.chunks[i]);
      else if (plan.mode === "distributor") callArgs = erc20DistributorArgs(plan, plan.chunks[i]);
      else if (plan.asset === "native") {
        const row = plan.chunks[i][0];
        callArgs = [row.address, "--value", `${row.amountBase}wei`];
      } else {
        const row = plan.chunks[i][0];
        callArgs = [plan.token.address, "transfer(address,uint256)", row.address, row.amountBase.toString()];
      }
      console.log("```bash");
      console.log(previewCommand(plan.network, callArgs));
      console.log("```");
    }
    console.log("Add --broadcast with exact confirmation to execute.");
    process.exit(0);
  }

  const privateKey = process.env.PRIVATE_KEY || "";
  if (!privateKey) throw new Error("PRIVATE_KEY must be set for --broadcast");
  const expectedConfirm = plan.network.environment === "mainnet"
    ? "CONFIRM_MAINNET_BATCH_TRANSFER"
    : "CONFIRM_TESTNET_BATCH_TRANSFER";
  if (args.confirm !== expectedConfirm) throw new Error(`--broadcast requires --confirm ${expectedConfirm}`);

  const chainId = verifyChain(plan.network);
  const signer = getSigner(privateKey);
  const nativeBalance = getNativeBalance(plan.network, signer);
  if (plan.asset === "native" && nativeBalance <= plan.totalBase) {
    throw new Error(`Insufficient ${plan.network.nativeToken}: balance must exceed transfer total plus gas`);
  }
  if (plan.asset === "erc20") {
    const tokenBalance = getTokenBalance(plan.network, plan.token, signer);
    if (tokenBalance < plan.totalBase) throw new Error(`Insufficient ${plan.token.symbol}: balance below transfer total`);
  }

  console.log("");
  console.log("Broadcast preflight:");
  printTable([
    { Field: "Signer", Value: signer },
    { Field: "RPC chain id", Value: chainId },
    { Field: `Native balance (${plan.network.nativeToken})`, Value: nativeBalance.toString() },
    { Field: "Report", Value: args.report || "(auto temp report)" }
  ]);

  const report = [];
  const reportPath = path.resolve(args.report || path.join(os.tmpdir(), `pharos-batch-transfer-${Date.now()}-${process.pid}.json`));

  if (plan.mode === "distributor" && plan.asset === "erc20") {
    console.log("");
    console.log("Approving distributor for exact batch total...");
    const approveTx = send(plan.network, privateKey, [
      plan.token.address,
      "approve(address,uint256)",
      plan.distributor,
      plan.totalBase.toString()
    ]);
    report.push({ action: "approve", tx: approveTx, explorer: approveTx === "-" ? "-" : explorerTx(plan.network, approveTx) });
    writeReport(reportPath, report);
  }

  for (let i = 0; i < plan.chunks.length; i += 1) {
    const rows = plan.chunks[i];
    let callArgs;
    if (plan.mode === "distributor" && plan.asset === "native") callArgs = nativeDistributorArgs(plan, rows);
    else if (plan.mode === "distributor") callArgs = erc20DistributorArgs(plan, rows);
    else if (plan.asset === "native") {
      const row = rows[0];
      callArgs = [row.address, "--value", `${row.amountBase}wei`];
    } else {
      const row = rows[0];
      callArgs = [plan.token.address, "transfer(address,uint256)", row.address, row.amountBase.toString()];
    }

    console.log("");
    console.log(`Broadcasting chunk ${i + 1}/${plan.chunks.length} (${rows.length} recipients)...`);
    const tx = send(plan.network, privateKey, callArgs);
    report.push({
      action: plan.mode === "distributor" ? "distributor-transfer" : "direct-transfer",
      chunk: i + 1,
      recipients: rows.length,
      tx,
      explorer: tx === "-" ? "-" : explorerTx(plan.network, tx)
    });
    writeReport(reportPath, report);
  }

  console.log("");
  console.log("Batch transfer summary:");
  printTable(report.map((row) => ({
    Action: row.action,
    Chunk: row.chunk || "-",
    Recipients: row.recipients || "-",
    Tx: row.tx,
    Explorer: row.explorer
  })));
  console.log(`Report JSON: ${reportPath}`);
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
