#!/usr/bin/env node
import {
  buildPlan,
  formatUnits,
  parseCastUint,
  printTable,
  runCast,
  selectNetwork,
  tokenList
} from "./lib/faroswap.mjs";

try {
  const network = selectNetwork("mainnet");
  const chainId = parseCastUint(runCast(["chain-id", "--rpc-url", network.rpcUrl]));
  const rows = [
    { Check: "RPC chain-id", Result: chainId === 1672n ? "ok" : `bad (${chainId})` }
  ];
  const plan = await buildPlan({
    from: "PROS",
    to: "USDC",
    amount: "0.001",
    address: "0x0000000000000000000000000000000000000000",
    estimateGas: false
  });
  rows.push({ Check: "Faroswap quote", Result: `${plan.estimatedOut} USDC min ${plan.minReturnAmount}` });
  const code = runCast(["code", plan.tx.to, "--rpc-url", network.rpcUrl]);
  rows.push({ Check: "Router code", Result: code && code !== "0x" ? "ok" : "missing" });

  for (const token of tokenList("mainnet").filter((item) => !item.native)) {
    const symbol = runCast(["call", token.address, "symbol()(string)", "--rpc-url", network.rpcUrl]).replace(/^"|"$/g, "");
    const decimals = parseCastUint(runCast(["call", token.address, "decimals()(uint8)", "--rpc-url", network.rpcUrl]));
    rows.push({
      Check: `${token.symbol} metadata`,
      Result: symbol === token.symbol && Number(decimals) === Number(token.decimals) ? "ok" : `${symbol}/${decimals}`
    });
  }

  console.log("# Faroswap Doctor");
  console.log("");
  printTable(rows);
  console.log("");
  console.log(`Smoke quote: 0.001 PROS -> ${plan.estimatedOut} USDC; min ${formatUnits(plan.minReturnAmount, plan.toToken.decimals)} USDC`);
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
