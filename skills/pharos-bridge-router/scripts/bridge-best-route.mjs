#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  formatUnits,
  getLifiTokens,
  parseArgs,
  printTable,
  runCast,
  skillRoot,
  writeJson
} from "./lib/bridge.mjs";

function usage() {
  console.log(`Usage:
  node scripts/bridge-best-route.mjs --from pharos --to base --token USDC --amount 0.05
  node scripts/bridge-best-route.mjs --from pharos --to base --token USDC --amount 0.05 --broadcast

Compares:
  - Jumper / LI.FI
  - Interport relayed CCTP V2
  - Transporter / Chainlink CCIP

Rules:
  - Default is read-only comparison.
  - --broadcast executes only the best executable route.
  - Mainnet execution still needs CONFIRM_MAINNET_BRIDGE or local policy.`);
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

function runScript(scriptName, args) {
  const result = spawnSync(process.execPath, [path.join(skillRoot, "scripts", scriptName), ...args], {
    cwd: skillRoot,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    env: process.env
  });
  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(stderr || stdout || `${scriptName} exited ${result.status}`);
  }
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${scriptName} did not return JSON: ${error.message}`);
  }
}

function commonArgs(args) {
  const out = [
    "--from",
    String(args.from || "pharos"),
    "--to",
    String(args.to || "base"),
    "--amount",
    String(args.amount)
  ];
  if (args.address) out.push("--address", String(args.address));
  if (args["from-address"]) out.push("--from-address", String(args["from-address"]));
  if (args["to-address"]) out.push("--to-address", String(args["to-address"]));
  if (args.confirm) out.push("--confirm", String(args.confirm));
  if (args["private-key-file"]) out.push("--private-key-file", String(args["private-key-file"]));
  if (args.policy) out.push("--policy", String(args.policy));
  if (args["keep-existing-allowance"]) out.push("--keep-existing-allowance");
  return out;
}

async function nativeUsd(chainId, symbol) {
  try {
    const tokens = await getLifiTokens(chainId);
    const native = tokens.find((token) => token.address?.toLowerCase() === "0x0000000000000000000000000000000000000000") ||
      tokens.find((token) => token.symbol?.toLowerCase() === String(symbol || "").toLowerCase());
    const price = Number(native?.priceUSD || 0);
    return Number.isFinite(price) && price > 0 ? price : 0;
  } catch {
    return 0;
  }
}

function sumUsd(costs) {
  return (costs || []).reduce((total, item) => {
    const value = Number(item.amountUSD || 0);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function unitsToNumber(value, decimals) {
  return Number(formatUnits(value || 0, decimals));
}

function checkValue(raw, label) {
  const check = (raw?.safety?.checks || []).find((item) => item.check === label);
  return check?.value ?? null;
}

function estimateSourceGasUsd(chain, gasUnits, nativePrice) {
  if (!gasUnits || !nativePrice) return 0;
  try {
    const gasPrice = BigInt(runCast(["gas-price", "--rpc-url", chain.rpcUrl]).trim());
    return unitsToNumber(gasPrice * BigInt(gasUnits), 18) * nativePrice;
  } catch {
    return 0;
  }
}

function fixed(value, digits = 8) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(digits).replace(/\.?0+$/, "") || "0";
}

function shortText(value, max = 80) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function hasWarnings(route) {
  const safety = route.raw?.safety || {};
  if (Array.isArray(safety.warnings) && safety.warnings.length) return true;
  if (Array.isArray(safety.hardFailures) && safety.hardFailures.length) return true;
  if (Array.isArray(safety.checks) && safety.checks.some((check) => check.ok === false)) return true;
  return false;
}

function routeStatus(route) {
  if (!route.ok) return route.error;
  if (hasWarnings(route)) return "warnings";
  return route.executable ? "ok" : "read-only";
}

async function quoteLifi(args) {
  const raw = runScript("bridge-safe.mjs", [
    ...commonArgs(args),
    "--token",
    String(args.token || "USDC"),
    "--json"
  ]);
  const plan = raw.plan;
  const estimate = plan.quote?.estimate || {};
  const decimals = plan.toToken?.decimals ?? plan.fromToken?.decimals ?? 6;
  const fromAmount = BigInt(plan.fromAmount || 0);
  const toAmount = BigInt(estimate.toAmount || 0);
  const tokenDelta = fromAmount > toAmount ? fromAmount - toAmount : 0n;
  const tokenDeltaUsd = unitsToNumber(tokenDelta, decimals) * Number(plan.fromToken?.priceUSD || plan.toToken?.priceUSD || 1);
  const explicitFeeUsd = sumUsd(estimate.feeCosts);
  const gasUsd = sumUsd(estimate.gasCosts);
  const scoreUsd = Math.max(tokenDeltaUsd, explicitFeeUsd) + gasUsd;
  return {
    ok: raw.ok,
    provider: "lifi",
    name: "Jumper / LI.FI",
    tool: plan.tool || "-",
    receiveBase: toAmount.toString(),
    receiveHuman: formatUnits(toAmount, decimals),
    tokenFeeBase: tokenDelta.toString(),
    tokenFeeHuman: formatUnits(tokenDelta, decimals),
    nativeFeeHuman: "0",
    nativeFeeSymbol: plan.fromChain.nativeSymbol || "native",
    gasUsd,
    feeUsd: Math.max(tokenDeltaUsd, explicitFeeUsd),
    scoreUsd,
    costBasis: "LI.FI live quote: included token fees plus LI.FI gas cost estimate.",
    durationSeconds: estimate.executionDuration ?? "",
    executable: raw.ok && !hasWarnings({ raw }),
    command: `node scripts/bridge-safe.mjs --from ${args.from || "pharos"} --to ${args.to || "base"} --token ${args.token || "USDC"} --amount ${args.amount} --broadcast`,
    raw
  };
}

async function quoteInterport(args) {
  const scriptArgs = [...commonArgs(args), "--json"];
  if (args["native-fee"]) scriptArgs.push("--native-fee", String(args["native-fee"]));
  if (args["destination-gas-limit"]) scriptArgs.push("--destination-gas-limit", String(args["destination-gas-limit"]));
  const raw = runScript("interport-cctp-relay.mjs", scriptArgs);
  const plan = raw.plan;
  const nativePrice = await nativeUsd(plan.fromChain.chainId, plan.fromChain.nativeSymbol);
  const tokenFeeBase = BigInt(plan.amountBase || 0) - BigInt(plan.estimatedReceiveBase || 0);
  const tokenFeeUsd = unitsToNumber(tokenFeeBase, plan.token.decimals) * 1;
  const nativeFeeUsd = unitsToNumber(plan.nativeFeeWei, 18) * nativePrice;
  const currentAllowance = BigInt(checkValue(raw, "Source USDC allowance") || 0);
  const gasConfig = plan.estimatedSourceGas || {};
  let sourceGasUnits = Number(gasConfig.bridge || 190000);
  if (currentAllowance !== BigInt(plan.amountBase || 0)) {
    sourceGasUnits += Number(gasConfig.approval || 56000);
    if (currentAllowance > 0n) sourceGasUnits += Number(gasConfig.approvalReset || 34000);
  }
  const sourceGasUsd = estimateSourceGasUsd(plan.fromChain, sourceGasUnits, nativePrice);
  return {
    ok: raw.ok,
    provider: "interport",
    name: "Interport CCTP relay",
    tool: plan.mode || "cctp-v2",
    receiveBase: plan.estimatedReceiveBase,
    receiveHuman: formatUnits(plan.estimatedReceiveBase, plan.token.decimals),
    tokenFeeBase: tokenFeeBase.toString(),
    tokenFeeHuman: formatUnits(tokenFeeBase, plan.token.decimals),
    nativeFeeHuman: formatUnits(plan.nativeFeeWei, 18),
    nativeFeeSymbol: plan.fromChain.nativeSymbol,
    gasUsd: sourceGasUsd,
    feeUsd: tokenFeeUsd + nativeFeeUsd,
    scoreUsd: tokenFeeUsd + nativeFeeUsd + sourceGasUsd,
    costBasis: "Interport live fee API, estimated relayer reserve, and estimated source approval/bridge gas.",
    durationSeconds: "",
    executable: raw.ok && !hasWarnings({ raw }),
    command: `node scripts/interport-cctp-relay.mjs --from ${args.from || "pharos"} --to ${args.to || "base"} --amount ${args.amount} --broadcast`,
    raw
  };
}

async function quoteCcip(args) {
  const raw = runScript("ccip-transfer.mjs", [
    ...commonArgs(args),
    "--token",
    String(args.token || "USDC"),
    "--json"
  ]);
  const plan = raw.plan;
  const nativePrice = await nativeUsd(plan.fromChain.chainId, plan.fromChain.nativeSymbol);
  const nativeFeeUsd = unitsToNumber(plan.feeWei, 18) * nativePrice;
  return {
    ok: raw.ok,
    provider: "ccip",
    name: "Chainlink CCIP",
    tool: "ccip",
    receiveBase: plan.amountBase,
    receiveHuman: formatUnits(plan.amountBase, plan.token.decimals),
    tokenFeeBase: "0",
    tokenFeeHuman: "0",
    nativeFeeHuman: formatUnits(plan.feeWei, 18),
    nativeFeeSymbol: plan.fromChain.nativeSymbol,
    gasUsd: 0,
    feeUsd: nativeFeeUsd,
    scoreUsd: nativeFeeUsd,
    costBasis: "Chainlink router getFee quote converted with live native token USD price; source approval gas is not included.",
    durationSeconds: "",
    executable: raw.ok && !hasWarnings({ raw }),
    command: `node scripts/ccip-transfer.mjs --from ${args.from || "pharos"} --to ${args.to || "base"} --token ${args.token || "USDC"} --amount ${args.amount} --broadcast`,
    raw
  };
}

async function quoteProvider(provider, args) {
  try {
    if (provider === "lifi" || provider === "jumper") return await quoteLifi(args);
    if (provider === "interport") return await quoteInterport(args);
    if (provider === "ccip" || provider === "transporter") return await quoteCcip(args);
    return { ok: false, provider, name: provider, error: `Unknown provider ${provider}`, executable: false, scoreUsd: Infinity };
  } catch (error) {
    return { ok: false, provider, name: provider, error: error.message, executable: false, scoreUsd: Infinity };
  }
}

function providerList(args) {
  if (args.providers) return String(args.providers).split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const token = String(args.token || "USDC").toUpperCase();
  return token === "USDC" ? ["lifi", "interport", "ccip"] : ["lifi"];
}

function chooseBest(routes) {
  const candidates = routes.filter((route) => route.ok && route.executable && Number.isFinite(route.scoreUsd));
  candidates.sort((a, b) => a.scoreUsd - b.scoreUsd || Number(BigInt(b.receiveBase || 0) - BigInt(a.receiveBase || 0)));
  return candidates[0] || null;
}

function executionArgs(args, best) {
  const base = [...commonArgs(args), "--json", "--broadcast"];
  if (args["ignore-warnings"]) base.push("--ignore-warnings");
  if (best.provider === "lifi") {
    base.push("--token", String(args.token || "USDC"));
    return { script: "bridge-safe.mjs", args: base };
  }
  if (best.provider === "interport") {
    if (args["native-fee"]) base.push("--native-fee", String(args["native-fee"]));
    if (args["destination-gas-limit"]) base.push("--destination-gas-limit", String(args["destination-gas-limit"]));
    return { script: "interport-cctp-relay.mjs", args: base };
  }
  if (best.provider === "ccip") {
    base.push("--token", String(args.token || "USDC"));
    return { script: "ccip-transfer.mjs", args: base };
  }
  throw new Error(`Cannot execute provider ${best.provider}`);
}

function tableRows(routes, best) {
  return routes.map((route) => ({
    Provider: route.name || route.provider,
    Tool: route.tool || "-",
    Receive: route.ok ? `${route.receiveHuman} ${String(route.raw?.plan?.token?.symbol || route.raw?.plan?.toToken?.symbol || "USDC")}` : "-",
    "Token fee": route.ok ? `${route.tokenFeeHuman} USDC` : "-",
    "Native fee": route.ok ? `${route.nativeFeeHuman} ${route.nativeFeeSymbol}` : "-",
    "Gas USD": route.ok ? fixed(route.gasUsd, 6) : "-",
    "Score USD": route.ok ? fixed(route.scoreUsd, 6) : "-",
    Basis: route.ok ? shortText(route.costBasis, 42) : "-",
    Status: route === best ? "best" : shortText(routeStatus(route), 42)
  }));
}

function publicRoute(route, includeRaw = false) {
  const { raw, ...rest } = route;
  if (includeRaw) return route;
  return {
    ...rest,
    status: routeStatus(route),
    warnings: raw?.safety?.warnings || [],
    error: route.error || ""
  };
}

const args = parseArgs(process.argv.slice(2));

try {
  if (args.help || args.h) {
    usage();
    process.exit(0);
  }
  if (!args.amount) throw new Error("--amount is required");

  const providers = providerList(args);
  const routes = [];
  for (const provider of providers) routes.push(await quoteProvider(provider, args));
  const best = chooseBest(routes);
  const result = {
    ok: Boolean(best),
    broadcast: Boolean(args.broadcast),
    bestProvider: best?.provider || "",
    routes: routes.map((route) => publicRoute(route, Boolean(args["include-raw"]))),
    execution: null
  };

  if (args.output) writeJson(args.output, result);

  if (args.broadcast) {
    if (!best) throw new Error("No executable bridge route found");
    const exec = executionArgs(args, best);
    result.execution = runScript(exec.script, exec.args);
  }

  if (args.json) {
    outputJson(result);
  } else {
    console.log("# Pharos Bridge Best Route");
    console.log("");
    printTable(tableRows(routes, best));
    console.log("");
    if (best) {
      console.log(`Best route: ${best.name} (${best.tool}) with estimated score $${fixed(best.scoreUsd, 6)}.`);
      console.log(`Command: ${best.command}${args.confirm ? ` --confirm ${args.confirm}` : ""}`);
    } else {
      console.log("No executable route found. Inspect provider errors with --json.");
    }
    if (!args.broadcast) {
      console.log("");
      console.log("Dry run only. Add --broadcast to execute the current best route.");
    } else {
      console.log("");
      console.log("Execution:");
      outputJson(result.execution);
    }
  }
} catch (error) {
  if (args.json) outputJson({ ok: false, error: error.message });
  else console.error(`Error: ${error.message}`);
  process.exit(1);
}
