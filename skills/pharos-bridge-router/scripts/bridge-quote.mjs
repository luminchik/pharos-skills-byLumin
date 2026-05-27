#!/usr/bin/env node
import {
  castSendPreview,
  calldataSummary,
  enrichChain,
  formatUnits,
  isAddress,
  isNativeAddress,
  loadProviders,
  nowIso,
  parseArgs,
  parseUnits,
  printTable,
  resolveLifiToken,
  resolveLocalChain,
  writeJson,
  fetchJson
} from "./lib/bridge.mjs";

function usage() {
  console.log(`Usage:
  node scripts/bridge-quote.mjs --from pharos --to base --from-token PROS --to-token PROS --amount 0.01 --address 0xWallet
  node scripts/bridge-quote.mjs --from pharos --to arbitrum --from-token USDC --to-token USDC --amount 10 --address 0xWallet --output plan.json

Options:
  --provider lifi|jumper       Default: lifi
  --from <chain|id>            Source chain alias or chain ID
  --to <chain|id>              Destination chain alias or chain ID
  --from-token <symbol|addr>   Source token
  --to-token <symbol|addr>     Destination token
  --amount <decimal>           Human amount in source token units
  --address <wallet>           Wallet used as fromAddress and toAddress
  --from-address <wallet>      Optional source address override
  --to-address <wallet>        Optional destination recipient override
  --slippage <decimal>         Default: 0.005
  --output <file>              Save executable plan JSON
  --from-decimals <n>          Required only for custom source token addresses not in LI.FI token list`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }

  const provider = String(args.provider || "lifi").toLowerCase();
  if (!["lifi", "jumper"].includes(provider)) throw new Error(`Unsupported quote provider "${args.provider}". Use lifi or jumper.`);

  const fromChain = await enrichChain(resolveLocalChain(args.from || "pharos"));
  const toChain = await enrichChain(resolveLocalChain(args.to));
  const fromAddress = args["from-address"] || args.address;
  const toAddress = args["to-address"] || args.address || fromAddress;
  if (!isAddress(fromAddress)) throw new Error("--address or --from-address must be a valid EVM address");
  if (!isAddress(toAddress)) throw new Error("--to-address must be a valid EVM address");
  if (!args.amount) throw new Error("--amount is required");

  const fromToken = await resolveLifiToken(fromChain.id, args["from-token"] || "PROS", args["from-decimals"]);
  const toToken = await resolveLifiToken(toChain.id, args["to-token"] || args["from-token"] || "PROS");
  const fromAmount = parseUnits(args.amount, fromToken.decimals).toString();
  const slippage = String(args.slippage || "0.005");
  const providers = loadProviders();

  const params = new URLSearchParams({
    fromChain: String(fromChain.id),
    toChain: String(toChain.id),
    fromToken: fromToken.address,
    toToken: toToken.address,
    fromAmount,
    fromAddress,
    toAddress,
    slippage
  });

  const quoteUrl = `${providers.lifi.baseUrl}/quote?${params.toString()}`;
  const quote = await fetchJson(quoteUrl);
  const tx = quote.transactionRequest || {};
  const includedTools = (quote.includedSteps || []).map((step) => step.tool).filter(Boolean).join(", ");
  const approvalAddress = quote.estimate?.approvalAddress || "";
  const requiresApproval = !isNativeAddress(fromToken.address) && approvalAddress;
  const valueWei = BigInt(tx.value || "0x0").toString();

  console.log("# Pharos Bridge Quote");
  console.log("");
  printTable([
    {
      Field: "Provider",
      Value: "Jumper / LI.FI"
    },
    {
      Field: "Route",
      Value: `${fromChain.name} (${fromChain.id}) -> ${toChain.name} (${toChain.id})`
    },
    {
      Field: "Source token",
      Value: `${fromToken.symbol} ${fromToken.address}`
    },
    {
      Field: "Destination token",
      Value: `${toToken.symbol} ${toToken.address}`
    },
    {
      Field: "Amount in",
      Value: `${args.amount} ${fromToken.symbol} (${fromAmount} base units)`
    },
    {
      Field: "Estimated out",
      Value: quote.estimate?.toAmount ? `${formatUnits(quote.estimate.toAmount, toToken.decimals)} ${toToken.symbol}` : "-"
    },
    {
      Field: "USD in/out",
      Value: `${quote.estimate?.fromAmountUSD || "-"} / ${quote.estimate?.toAmountUSD || "-"}`
    },
    {
      Field: "Tool",
      Value: quote.tool || "-"
    },
    {
      Field: "Included steps",
      Value: includedTools || "-"
    },
    {
      Field: "Tx target",
      Value: tx.to || "-"
    },
    {
      Field: "Tx value",
      Value: `${valueWei} wei`
    },
    {
      Field: "Calldata",
      Value: calldataSummary(tx.data)
    },
    {
      Field: "Gas limit",
      Value: tx.gasLimit || "-"
    },
    {
      Field: "Approval",
      Value: requiresApproval ? `${approvalAddress} (exact amount recommended)` : "not required for native source token"
    }
  ]);

  console.log("");
  console.log("Transaction preview:");
  console.log("```bash");
  console.log(castSendPreview(tx, fromChain.rpcUrl, { compact: !args["show-calldata"] }));
  console.log("```");

  if (requiresApproval) {
    console.log("");
    console.log("Approval preview:");
    console.log("```bash");
    console.log(`cast send ${fromToken.address} "approve(address,uint256)" ${approvalAddress} ${fromAmount} --private-key ${process.platform === "win32" ? "$env:PRIVATE_KEY" : "$PRIVATE_KEY"}${fromChain.rpcUrl ? ` --rpc-url ${fromChain.rpcUrl}` : ""}`);
    console.log("```");
  }

  const plan = {
    schema: "pharos-bridge-router-plan/v1",
    provider: "lifi",
    createdAt: nowIso(),
    quoteId: quote.id || "",
    fromChain,
    toChain,
    fromToken,
    toToken,
    fromAmount,
    humanAmount: String(args.amount),
    fromAddress,
    toAddress,
    slippage,
    tool: quote.tool || "",
    includedTools,
    approvalAddress,
    requiresApproval: Boolean(requiresApproval),
    transactionRequest: tx,
    quote
  };

  if (args.output) {
    writeJson(args.output, plan);
    console.log("");
    console.log(`Saved plan: ${args.output}`);
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
