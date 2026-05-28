#!/usr/bin/env node
import {
  fetchJson,
  formatUnits,
  isAddress,
  isNativeAddress,
  loadProviders,
  parseArgs,
  parseUnits,
  printTable,
  resolveLifiToken,
  resolveLocalChain,
  writeJson
} from "./lib/bridge.mjs";

function usage() {
  console.log(`Usage:
  node scripts/bridge-discover.mjs --from pharos
  node scripts/bridge-discover.mjs --from pharos --quotes usdc --address 0xWallet --output out/routes.json
  node scripts/bridge-discover.mjs --from pharos --quotes all --address 0xWallet --limit 10 --delay-ms 1200

Options:
  --from <chain|id>            Source chain alias or chain ID. Default: pharos
  --to <chain|id,csv>          Optional destination chain aliases or IDs
  --chain-types <csv>          Default: EVM
  --include-testnets           Include LI.FI testnets
  --quotes none|usdc|native|pros|all
                                Default: none. Quotes are read-only but rate limited.
  --address <wallet>           Required for quote tests on EVM routes
  --amount-usdc <decimal>      Default: 1
  --amount-native <decimal>    Default: 0.001 source native token
  --amount-pros <decimal>      Default: 0.001 PROS
  --concurrency <n>            Default: 4 for connections, 2 for quotes
  --delay-ms <n>               Delay after each batch. Default: 500
  --limit <n>                  Limit destinations for smoke tests
  --output <file>              Save JSON discovery report

Set LIFI_API_KEY or LI_FI_API_KEY for higher LI.FI rate limits.`);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function pickToken(tokens, symbols) {
  const wanted = symbols.map((item) => item.toLowerCase());
  const candidates = tokens.filter((token) => {
    const symbol = String(token.symbol || "").toLowerCase();
    const coinKey = String(token.coinKey || "").toLowerCase();
    return wanted.includes(symbol) || wanted.includes(coinKey);
  });
  if (!candidates.length) return null;
  return (
    candidates.find((token) => token.verificationStatus === "verified" && String(token.symbol || "").toLowerCase() === "usdc") ||
    candidates.find((token) => String(token.symbol || "").toLowerCase() === "usdc") ||
    candidates.find((token) => String(token.coinKey || "").toLowerCase() === "usdc") ||
    candidates.find((token) => token.verificationStatus === "verified") ||
    candidates[0]
  );
}

function shortError(error) {
  return String(error.details || error.message || error).replace(/\s+/g, " ").slice(0, 260);
}

function asPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapBatches(items, concurrency, delayMs, mapper) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(batch.map(mapper))));
    if (delayMs > 0 && i + concurrency < items.length) await sleep(delayMs);
  }
  return results;
}

async function getLifiChainsRaw(chainTypes) {
  const providers = loadProviders();
  const query = chainTypes ? `?chainTypes=${encodeURIComponent(chainTypes)}` : "";
  const data = await fetchJson(`${providers.lifi.baseUrl}/chains${query}`);
  return data.chains || [];
}

async function getTokens(chainId) {
  const providers = loadProviders();
  const data = await fetchJson(`${providers.lifi.baseUrl}/tokens?chains=${encodeURIComponent(chainId)}`);
  return data.tokens?.[String(chainId)] || [];
}

async function getConnection(fromChainId, toChainId) {
  const providers = loadProviders();
  const data = await fetchJson(`${providers.lifi.baseUrl}/connections?fromChain=${fromChainId}&toChain=${toChainId}`);
  const connections = data.connections || [];
  return {
    connections: connections.length,
    fromTokenAddresses: unique(connections.flatMap((connection) => (connection.fromTokens || []).map((token) => token.address))),
    toTokenAddresses: unique(connections.flatMap((connection) => (connection.toTokens || []).map((token) => token.address)))
  };
}

async function getQuote({ fromChainId, toChainId, fromToken, toToken, fromAmount, address, slippage }) {
  const providers = loadProviders();
  const params = new URLSearchParams({
    fromChain: String(fromChainId),
    toChain: String(toChainId),
    fromToken,
    toToken,
    fromAmount,
    fromAddress: address,
    toAddress: address,
    slippage
  });
  return fetchJson(`${providers.lifi.baseUrl}/quote?${params.toString()}`);
}

function parseDestinationFilter(input) {
  if (!input) return null;
  return String(input)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => resolveLocalChain(item));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }

  const fromChain = resolveLocalChain(args.from || "pharos");
  const quotes = String(args.quotes || "none").toLowerCase();
  if (!["none", "usdc", "native", "pros", "all"].includes(quotes)) {
    throw new Error("--quotes must be one of: none, usdc, native, pros, all");
  }
  const address = args.address || args["from-address"];
  if (quotes !== "none" && !isAddress(address)) {
    throw new Error("--address must be a valid EVM wallet address when --quotes is enabled");
  }

  const chainTypes = args["chain-types"] || "EVM";
  const mainnetOnly = !args["include-testnets"];
  const allChains = await getLifiChainsRaw(chainTypes);
  const toFilter = parseDestinationFilter(args.to);
  let destinations = allChains.filter((chain) => chain.id !== fromChain.id);
  if (mainnetOnly) destinations = destinations.filter((chain) => chain.mainnet);
  if (toFilter) {
    const wantedIds = new Set(toFilter.map((chain) => chain.id));
    destinations = destinations.filter((chain) => wantedIds.has(chain.id));
  }
  destinations.sort((a, b) => a.id - b.id);
  if (args.limit) destinations = destinations.slice(0, asPositiveInt(args.limit, destinations.length));

  const connectionConcurrency = asPositiveInt(args.concurrency, 4);
  const quoteConcurrency = Math.min(connectionConcurrency, 2);
  const delayMs = asPositiveInt(args["delay-ms"], 500);
  const sourceTokens = await getTokens(fromChain.id);
  const sourceNative = sourceTokens.find((token) => isNativeAddress(token.address));
  const sourceUsdc = pickToken(sourceTokens, ["USDC"]);
  const sourcePros = pickToken(sourceTokens, ["PROS"]) || sourceNative;
  const slippage = String(args.slippage || "0.005");

  const connectionResults = await mapBatches(destinations, connectionConcurrency, delayMs, async (chain) => {
    try {
      const result = await getConnection(fromChain.id, chain.id);
      return {
        id: chain.id,
        key: chain.key,
        name: chain.name,
        chainType: chain.chainType,
        mainnet: chain.mainnet,
        ok: result.connections > 0,
        connections: result.connections,
        fromTokenCount: result.fromTokenAddresses.length,
        toTokenCount: result.toTokenAddresses.length
      };
    } catch (error) {
      return {
        id: chain.id,
        key: chain.key,
        name: chain.name,
        chainType: chain.chainType,
        mainnet: chain.mainnet,
        ok: false,
        connections: 0,
        error: shortError(error)
      };
    }
  });

  const supported = connectionResults.filter((row) => row.ok);
  const quoteResults = [];
  let quoteRateLimited = false;

  if (quotes !== "none") {
    await mapBatches(supported, quoteConcurrency, delayMs, async (row) => {
      const chain = allChains.find((item) => item.id === row.id) || row;
      const tokens = await getTokens(row.id);
      const destinationUsdc = pickToken(tokens, ["USDC"]);
      const destinationNative = tokens.find((token) => isNativeAddress(token.address));
      const destinationPros = pickToken(tokens, ["PROS"]);
      const result = {
        id: row.id,
        key: row.key,
        name: row.name
      };

      async function runQuote(kind, fromToken, toToken, amount) {
        if (quoteRateLimited) return { ok: false, skipped: true, error: "Skipped after LI.FI rate limit" };
        if (!fromToken) return { ok: false, error: `Source token missing for ${kind}` };
        if (!toToken) return { ok: false, error: `Destination token missing for ${kind}` };
        try {
          const fromAmount = parseUnits(amount, fromToken.decimals).toString();
          const quote = await getQuote({
            fromChainId: fromChain.id,
            toChainId: chain.id,
            fromToken: fromToken.address,
            toToken: toToken.address,
            fromAmount,
            address,
            slippage
          });
          return {
            ok: true,
            tool: quote.tool || "",
            includedSteps: (quote.includedSteps || []).map((step) => step.tool).filter(Boolean),
            fromAmount,
            toAmount: quote.estimate?.toAmount || "",
            toAmountHuman: quote.estimate?.toAmount ? formatUnits(quote.estimate.toAmount, toToken.decimals) : "",
            toAmountUSD: quote.estimate?.toAmountUSD || "",
            approvalAddress: quote.estimate?.approvalAddress || ""
          };
        } catch (error) {
          if (error.status === 429 || String(error.message || "").includes("HTTP 429")) quoteRateLimited = true;
          return { ok: false, error: shortError(error) };
        }
      }

      if (quotes === "usdc" || quotes === "all") {
        result.usdc = {
          fromToken: sourceUsdc ? `${sourceUsdc.symbol}:${sourceUsdc.address}` : "",
          toToken: destinationUsdc ? `${destinationUsdc.symbol}:${destinationUsdc.address}` : "",
          quote: await runQuote("USDC", sourceUsdc, destinationUsdc, String(args["amount-usdc"] || "1"))
        };
      }
      if (quotes === "native" || quotes === "all") {
        result.native = {
          fromToken: sourceNative ? `${sourceNative.symbol}:${sourceNative.address}` : "",
          toToken: destinationNative ? `${destinationNative.symbol}:${destinationNative.address}` : "",
          quote: await runQuote("native", sourceNative, destinationNative, String(args["amount-native"] || "0.001"))
        };
      }
      if (quotes === "pros" || quotes === "all") {
        result.pros = {
          fromToken: sourcePros ? `${sourcePros.symbol}:${sourcePros.address}` : "",
          toToken: destinationPros ? `${destinationPros.symbol}:${destinationPros.address}` : "",
          quote: await runQuote("PROS", sourcePros, destinationPros, String(args["amount-pros"] || "0.001"))
        };
      }
      quoteResults.push(result);
      return result;
    });
  }

  const report = {
    schema: "pharos-bridge-router-discovery/v1",
    generatedAt: new Date().toISOString(),
    provider: "Jumper / LI.FI",
    sourceChain: fromChain,
    filters: {
      chainTypes,
      mainnetOnly,
      quotes,
      limit: args.limit ? Number(args.limit) : null
    },
    sourceTokens: sourceTokens.map((token) => ({
      symbol: token.symbol,
      address: token.address,
      decimals: token.decimals,
      coinKey: token.coinKey,
      verificationStatus: token.verificationStatus
    })),
    summary: {
      destinationsChecked: destinations.length,
      connectionSupported: supported.length,
      connectionUnsupported: connectionResults.filter((row) => !row.ok).length,
      quoteTests: quoteResults.length,
      rateLimited: quoteRateLimited
    },
    connections: connectionResults,
    quotes: quoteResults
  };

  console.log("# Pharos Jumper / LI.FI Route Discovery");
  console.log("");
  printTable([
    { Field: "Source chain", Value: `${fromChain.name} (${fromChain.id})` },
    { Field: "Destinations checked", Value: report.summary.destinationsChecked },
    { Field: "Connections supported", Value: report.summary.connectionSupported },
    { Field: "Connections unsupported", Value: report.summary.connectionUnsupported },
    { Field: "Quote mode", Value: quotes },
    { Field: "Quote rate limited", Value: quoteRateLimited ? "yes" : "no" }
  ]);

  console.log("");
  console.log("Supported connections:");
  printTable(
    supported.map((row) => ({
      Chain: row.name,
      Id: row.id,
      Key: row.key,
      "From tokens": row.fromTokenCount,
      "To tokens": row.toTokenCount
    }))
  );

  const unsupported = connectionResults.filter((row) => !row.ok);
  if (unsupported.length) {
    console.log("");
    console.log("Unsupported connections:");
    printTable(unsupported.map((row) => ({ Chain: row.name, Id: row.id, Key: row.key, Error: row.error || "no connections" })));
  }

  if (quoteResults.length) {
    const flatQuotes = [];
    for (const row of quoteResults) {
      for (const kind of ["usdc", "native", "pros"]) {
        const quote = row[kind]?.quote;
        if (!quote) continue;
        flatQuotes.push({
          Chain: row.name,
          Id: row.id,
          Kind: kind,
          OK: quote.ok ? "yes" : "no",
          Tool: quote.tool || "",
          Out: quote.toAmountHuman || "",
          USD: quote.toAmountUSD || "",
          Error: quote.ok ? "" : quote.error || ""
        });
      }
    }
    console.log("");
    console.log("Quote tests:");
    printTable(flatQuotes);
  }

  if (args.output) {
    writeJson(args.output, report);
    console.log("");
    console.log(`Saved discovery report: ${args.output}`);
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
