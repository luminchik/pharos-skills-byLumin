#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  fetchJson,
  formatUnits,
  isAddress,
  isNativeAddress,
  loadProviders,
  parseArgs,
  parseUnits,
  printTable,
  resolveLocalChain,
  writeJson
} from "./lib/bridge.mjs";

function usage() {
  console.log(`Usage:
  node scripts/bridge-quote-matrix.mjs --address 0xWallet --direction both --output out/pharos-quote-matrix.json
  node scripts/bridge-quote-matrix.mjs --address 0xWallet --connections-file out/lifi-pharos-direction-matrix-merged-2026-05-27.json --max-tests 25

Options:
  --address <wallet>           Wallet used as fromAddress/toAddress for read-only quote tests
  --direction outbound|inbound|both
                                Default: both
  --connections-file <file>    Optional LI.FI connection matrix JSON to avoid rediscovery
  --output <file>              Default: out/lifi-pharos-quote-matrix.json
  --max-tests <n>              Stop after n new quote calls; rerun with same --output to resume
  --delay-ms <n>               Delay between quote calls. Default: 1500
  --include-fallback-swaps     Also test USDC/native cross-chain swap fallbacks
  --retry-failed               Re-test routes already marked failed

This script is read-only. It never signs or broadcasts transactions.
Set LIFI_API_KEY or LI_FI_API_KEY for higher LI.FI quote limits.`);
}

const PHAROS_ID = 1672;
const ZERO = "0x0000000000000000000000000000000000000000";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function shortError(error) {
  return String(error.details || error.message || error).replace(/\s+/g, " ").slice(0, 260);
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function tokenId(token) {
  if (!token) return "";
  return `${token.chainId}:${String(token.address || "").toLowerCase()}`;
}

function tokenLabel(token) {
  if (!token) return "";
  return `${token.symbol || token.coinKey || "TOKEN"}:${token.address}`;
}

function uniqueByAddress(tokens) {
  const seen = new Set();
  const result = [];
  for (const token of tokens.filter(Boolean)) {
    const key = String(token.address || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(token);
  }
  return result;
}

function bestToken(tokens, symbols) {
  const wanted = symbols.map((item) => item.toLowerCase());
  const candidates = tokens.filter((token) => {
    const symbol = String(token.symbol || "").toLowerCase();
    const coinKey = String(token.coinKey || "").toLowerCase();
    return wanted.includes(symbol) || wanted.includes(coinKey);
  });
  if (!candidates.length) return null;
  return (
    candidates.find((token) => token.verificationStatus === "verified" && wanted.includes(String(token.symbol || "").toLowerCase())) ||
    candidates.find((token) => wanted.includes(String(token.symbol || "").toLowerCase())) ||
    candidates.find((token) => token.verificationStatus === "verified") ||
    candidates[0]
  );
}

function tokenSet(tokens) {
  return {
    native: tokens.find((token) => isNativeAddress(token.address)),
    usdc: bestToken(tokens, ["USDC"]),
    usdce: bestToken(tokens, ["USDCe", "USDC.e", "USDC.e"]),
    usdt: bestToken(tokens, ["USDT"]),
    weth: bestToken(tokens, ["WETH"]),
    link: bestToken(tokens, ["LINK"]),
    pros: bestToken(tokens, ["PROS"]),
    wpros: bestToken(tokens, ["WPROS"])
  };
}

function pushCandidate(candidates, candidate) {
  if (!candidate.fromToken || !candidate.toToken) return;
  const key = `${candidate.kind}:${tokenId(candidate.fromToken)}->${tokenId(candidate.toToken)}:${candidate.amount}`;
  if (candidates.some((item) => item.key === key)) return;
  candidates.push({ ...candidate, key });
}

function buildCandidates(direction, pharosTokens, otherTokens, includeFallbackSwaps) {
  const p = tokenSet(pharosTokens);
  const o = tokenSet(otherTokens);
  const candidates = [];

  if (direction === "outbound") {
    pushCandidate(candidates, { kind: "USDC_TO_USDC", fromToken: p.usdc, toToken: o.usdc, amount: "1" });
    pushCandidate(candidates, { kind: "USDCe_TO_USDCe", fromToken: p.usdce, toToken: o.usdce || o.usdc, amount: "1" });
    pushCandidate(candidates, { kind: "WETH_TO_WETH", fromToken: p.weth, toToken: o.weth, amount: "0.001" });
    pushCandidate(candidates, { kind: "LINK_TO_LINK", fromToken: p.link, toToken: o.link, amount: "1" });
    pushCandidate(candidates, { kind: "PROS_TO_PROS", fromToken: p.native || p.pros, toToken: o.pros, amount: "0.001" });
    pushCandidate(candidates, { kind: "WPROS_TO_WPROS", fromToken: p.wpros, toToken: o.wpros || o.pros, amount: "0.001" });
    if (includeFallbackSwaps) {
      pushCandidate(candidates, { kind: "PROS_TO_NATIVE", fromToken: p.native || p.pros, toToken: o.native, amount: "0.001" });
      pushCandidate(candidates, { kind: "USDC_TO_NATIVE", fromToken: p.usdc, toToken: o.native, amount: "1" });
      pushCandidate(candidates, { kind: "USDC_TO_USDT", fromToken: p.usdc, toToken: o.usdt, amount: "1" });
    }
  } else {
    pushCandidate(candidates, { kind: "USDC_TO_USDC", fromToken: o.usdc, toToken: p.usdc, amount: "1" });
    pushCandidate(candidates, { kind: "USDCe_TO_USDCe", fromToken: o.usdce || o.usdc, toToken: p.usdce || p.usdc, amount: "1" });
    pushCandidate(candidates, { kind: "WETH_TO_WETH", fromToken: o.weth, toToken: p.weth, amount: "0.001" });
    pushCandidate(candidates, { kind: "LINK_TO_LINK", fromToken: o.link, toToken: p.link, amount: "1" });
    pushCandidate(candidates, { kind: "PROS_TO_PROS", fromToken: o.pros, toToken: p.native || p.pros, amount: "0.001" });
    pushCandidate(candidates, { kind: "WPROS_TO_WPROS", fromToken: o.wpros || o.pros, toToken: p.wpros || p.pros || p.native, amount: "0.001" });
    if (includeFallbackSwaps) {
      pushCandidate(candidates, { kind: "NATIVE_TO_PROS", fromToken: o.native, toToken: p.native || p.pros, amount: "0.001" });
      pushCandidate(candidates, { kind: "NATIVE_TO_USDC", fromToken: o.native, toToken: p.usdc, amount: "0.001" });
      pushCandidate(candidates, { kind: "USDT_TO_USDC", fromToken: o.usdt, toToken: p.usdc, amount: "1" });
    }
  }

  return candidates;
}

async function getLifiChains() {
  const providers = loadProviders();
  const data = await fetchJson(`${providers.lifi.baseUrl}/chains?chainTypes=EVM`);
  return data.chains || [];
}

async function getTokens(chainId, cache) {
  if (cache.has(chainId)) return cache.get(chainId);
  const providers = loadProviders();
  const data = await fetchJson(`${providers.lifi.baseUrl}/tokens?chains=${encodeURIComponent(chainId)}`);
  const tokens = data.tokens?.[String(chainId)] || [];
  cache.set(chainId, tokens);
  return tokens;
}

async function getConnection(fromChainId, toChainId) {
  const providers = loadProviders();
  const data = await fetchJson(`${providers.lifi.baseUrl}/connections?fromChain=${fromChainId}&toChain=${toChainId}`);
  return (data.connections || []).length > 0;
}

function routeKey(direction, otherChainId) {
  return `${direction}:${direction === "outbound" ? `${PHAROS_ID}->${otherChainId}` : `${otherChainId}->${PHAROS_ID}`}`;
}

function initialReport(args, address, output) {
  return {
    schema: "pharos-bridge-router-quote-matrix/v1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provider: "Jumper / LI.FI",
    address,
    output,
    settings: {
      direction: args.direction || "both",
      includeFallbackSwaps: Boolean(args["include-fallback-swaps"])
    },
    routes: []
  };
}

function summarize(report) {
  const routes = report.routes || [];
  const outbound = routes.filter((route) => route.direction === "outbound");
  const inbound = routes.filter((route) => route.direction === "inbound");
  return {
    routes: routes.length,
    ok: routes.filter((route) => route.status === "ok").length,
    failed: routes.filter((route) => route.status === "failed").length,
    pending: routes.filter((route) => route.status === "pending").length,
    noConnection: routes.filter((route) => route.status === "no_connection").length,
    outboundOk: outbound.filter((route) => route.status === "ok").length,
    inboundOk: inbound.filter((route) => route.status === "ok").length,
    quoteAttempts: routes.reduce((sum, route) => sum + (route.attempts?.length || 0), 0)
  };
}

function findNextAttempt(route, retryFailed) {
  if (route.status === "ok") return null;
  if (route.status === "failed" && !retryFailed) return null;
  const attempted = new Set((route.attempts || []).map((attempt) => attempt.key));
  return (route.candidates || []).find((candidate) => !attempted.has(candidate.key)) || null;
}

async function quote(candidate, route, address, slippage) {
  const providers = loadProviders();
  const fromAmount = parseUnits(candidate.amount, candidate.fromToken.decimals).toString();
  const params = new URLSearchParams({
    fromChain: String(route.fromChain.id),
    toChain: String(route.toChain.id),
    fromToken: candidate.fromToken.address,
    toToken: candidate.toToken.address,
    fromAmount,
    fromAddress: address,
    toAddress: address,
    slippage
  });
  return fetchJson(`${providers.lifi.baseUrl}/quote?${params.toString()}`);
}

function quoteAttemptRecord(candidate, quoteResult) {
  return {
    key: candidate.key,
    kind: candidate.kind,
    amount: candidate.amount,
    fromToken: {
      symbol: candidate.fromToken.symbol,
      address: candidate.fromToken.address,
      decimals: candidate.fromToken.decimals
    },
    toToken: {
      symbol: candidate.toToken.symbol,
      address: candidate.toToken.address,
      decimals: candidate.toToken.decimals
    },
    ok: true,
    tool: quoteResult.tool || "",
    includedSteps: (quoteResult.includedSteps || []).map((step) => step.tool).filter(Boolean),
    toAmount: quoteResult.estimate?.toAmount || "",
    toAmountHuman: quoteResult.estimate?.toAmount
      ? formatUnits(quoteResult.estimate.toAmount, candidate.toToken.decimals)
      : "",
    toAmountUSD: quoteResult.estimate?.toAmountUSD || "",
    txTarget: quoteResult.transactionRequest?.to || "",
    approvalAddress: quoteResult.estimate?.approvalAddress || "",
    testedAt: new Date().toISOString()
  };
}

function failedAttemptRecord(candidate, error) {
  return {
    key: candidate.key,
    kind: candidate.kind,
    amount: candidate.amount,
    fromToken: {
      symbol: candidate.fromToken.symbol,
      address: candidate.fromToken.address,
      decimals: candidate.fromToken.decimals
    },
    toToken: {
      symbol: candidate.toToken.symbol,
      address: candidate.toToken.address,
      decimals: candidate.toToken.decimals
    },
    ok: false,
    error: shortError(error),
    httpStatus: error.status || null,
    testedAt: new Date().toISOString()
  };
}

async function loadConnectionRows(args, chains) {
  const from = resolveLocalChain("pharos");
  const directions = String(args.direction || "both").toLowerCase();
  if (!["outbound", "inbound", "both"].includes(directions)) {
    throw new Error("--direction must be outbound, inbound, or both");
  }

  const connectionFile = args["connections-file"];
  const cached = readJsonIfExists(connectionFile);
  if (cached?.rows?.length) {
    return cached.rows
      .filter((row) => row.id !== PHAROS_ID)
      .map((row) => ({
        chain: chains.find((chain) => chain.id === row.id) || {
          id: row.id,
          key: row.key,
          name: row.name,
          mainnet: true
        },
        outbound: Boolean(row.outbound?.ok),
        inbound: Boolean(row.inbound?.ok)
      }));
  }

  const rows = [];
  const destinations = chains.filter((chain) => chain.mainnet && chain.id !== from.id).sort((a, b) => a.id - b.id);
  for (const chain of destinations) {
    const outbound = directions === "inbound" ? false : await getConnection(PHAROS_ID, chain.id);
    const inbound = directions === "outbound" ? false : await getConnection(chain.id, PHAROS_ID);
    rows.push({ chain, outbound, inbound });
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }

  const address = args.address;
  if (!isAddress(address)) throw new Error("--address must be a valid EVM wallet address");
  const output = args.output || path.join("out", "lifi-pharos-quote-matrix.json");
  const maxTests = asPositiveInt(args["max-tests"], Number.MAX_SAFE_INTEGER);
  const delayMs = asPositiveInt(args["delay-ms"], 1500);
  const retryFailed = Boolean(args["retry-failed"]);
  const includeFallbackSwaps = Boolean(args["include-fallback-swaps"]);
  const direction = String(args.direction || "both").toLowerCase();
  const slippage = String(args.slippage || "0.005");

  const chains = await getLifiChains();
  const pharosChain = chains.find((chain) => chain.id === PHAROS_ID) || resolveLocalChain("pharos");
  const connectionRows = await loadConnectionRows(args, chains);
  const tokenCache = new Map();
  const pharosTokens = await getTokens(PHAROS_ID, tokenCache);
  const report = readJsonIfExists(output) || initialReport(args, address, output);
  report.address = address;
  report.updatedAt = new Date().toISOString();
  report.settings = {
    ...(report.settings || {}),
    direction,
    includeFallbackSwaps,
    slippage
  };

  const byKey = new Map((report.routes || []).map((route) => [route.key, route]));
  for (const row of connectionRows) {
    const otherChain = row.chain;
    const otherTokens = await getTokens(otherChain.id, tokenCache);
    const routeDirections = [];
    if ((direction === "outbound" || direction === "both") && row.outbound) routeDirections.push("outbound");
    if ((direction === "inbound" || direction === "both") && row.inbound) routeDirections.push("inbound");
    if (!routeDirections.length) {
      for (const routeDirection of direction === "both" ? ["outbound", "inbound"] : [direction]) {
        const key = routeKey(routeDirection, otherChain.id);
        if (!byKey.has(key)) {
          byKey.set(key, {
            key,
            direction: routeDirection,
            status: "no_connection",
            fromChain: routeDirection === "outbound" ? pharosChain : otherChain,
            toChain: routeDirection === "outbound" ? otherChain : pharosChain,
            candidates: [],
            attempts: [],
            selectedAttempt: null
          });
        }
      }
      continue;
    }

    for (const routeDirection of routeDirections) {
      const key = routeKey(routeDirection, otherChain.id);
      const candidates = buildCandidates(routeDirection, pharosTokens, otherTokens, includeFallbackSwaps).map((candidate) => ({
        key: candidate.key,
        kind: candidate.kind,
        amount: candidate.amount,
        fromToken: {
          chainId: candidate.fromToken.chainId,
          symbol: candidate.fromToken.symbol,
          address: candidate.fromToken.address,
          decimals: candidate.fromToken.decimals
        },
        toToken: {
          chainId: candidate.toToken.chainId,
          symbol: candidate.toToken.symbol,
          address: candidate.toToken.address,
          decimals: candidate.toToken.decimals
        }
      }));
      const existing = byKey.get(key);
      const route = existing || {
        key,
        direction: routeDirection,
        status: "pending",
        attempts: [],
        selectedAttempt: null
      };
      route.fromChain = routeDirection === "outbound" ? pharosChain : otherChain;
      route.toChain = routeDirection === "outbound" ? otherChain : pharosChain;
      route.candidates = uniqueByAddress(candidates.map((candidate) => candidate.fromToken)).length ? candidates : [];
      if (!route.candidates.length) route.status = "failed";
      if (route.status !== "ok" && route.status !== "failed") route.status = "pending";
      byKey.set(key, route);
    }
  }

  report.routes = [...byKey.values()].sort((a, b) => {
    const directionOrder = { outbound: 0, inbound: 1 };
    if (a.direction !== b.direction) return directionOrder[a.direction] - directionOrder[b.direction];
    return a.toChain.id - b.toChain.id || a.fromChain.id - b.fromChain.id;
  });

  let testsRun = 0;
  let rateLimited = false;
  while (testsRun < maxTests) {
    const route = report.routes.find((item) => findNextAttempt(item, retryFailed));
    if (!route) break;
    const candidate = findNextAttempt(route, retryFailed);
    const fromLabel = `${route.fromChain.name} (${route.fromChain.id})`;
    const toLabel = `${route.toChain.name} (${route.toChain.id})`;
    console.error(`[quote ${testsRun + 1}/${maxTests}] ${fromLabel} -> ${toLabel} ${candidate.kind}`);
    try {
      const result = await quote(candidate, route, address, slippage);
      const attempt = quoteAttemptRecord(candidate, result);
      route.attempts = [...(route.attempts || []), attempt];
      route.selectedAttempt = attempt;
      route.status = "ok";
    } catch (error) {
      if (error.status === 429 || String(error.message || "").includes("HTTP 429")) {
        rateLimited = true;
        route.lastError = shortError(error);
        break;
      }
      route.attempts = [...(route.attempts || []), failedAttemptRecord(candidate, error)];
      route.selectedAttempt = null;
      route.status = findNextAttempt(route, retryFailed) ? "pending" : "failed";
      route.lastError = route.attempts.at(-1).error;
    }
    testsRun += 1;
    report.updatedAt = new Date().toISOString();
    report.summary = summarize(report);
    writeJson(output, report);
    if (testsRun < maxTests && delayMs > 0) await sleep(delayMs);
  }

  report.updatedAt = new Date().toISOString();
  report.summary = {
    ...summarize(report),
    testsRunThisInvocation: testsRun,
    rateLimited
  };
  writeJson(output, report);

  console.log("# Pharos LI.FI Quote Matrix");
  console.log("");
  printTable([
    { Field: "Output", Value: output },
    { Field: "Routes", Value: report.summary.routes },
    { Field: "Quote OK", Value: report.summary.ok },
    { Field: "Failed", Value: report.summary.failed },
    { Field: "Pending", Value: report.summary.pending },
    { Field: "No connection", Value: report.summary.noConnection },
    { Field: "Outbound OK", Value: report.summary.outboundOk },
    { Field: "Inbound OK", Value: report.summary.inboundOk },
    { Field: "Quote attempts", Value: report.summary.quoteAttempts },
    { Field: "Tests this run", Value: testsRun },
    { Field: "Rate limited", Value: rateLimited ? "yes" : "no" }
  ]);

  const okRoutes = report.routes.filter((route) => route.status === "ok");
  if (okRoutes.length) {
    console.log("");
    console.log("Successful routes:");
    printTable(
      okRoutes.map((route) => ({
        Direction: route.direction,
        From: route.fromChain.name,
        To: route.toChain.name,
        Pair: route.selectedAttempt?.kind || "",
        Tool: route.selectedAttempt?.tool || "",
        Out: route.selectedAttempt?.toAmountHuman || "",
        USD: route.selectedAttempt?.toAmountUSD || ""
      }))
    );
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
