import fs from "node:fs";
import path from "node:path";
import {
  formatUnits,
  isAddress,
  parseUnits,
  resolveToken,
  runCast,
  selectNetwork
} from "./pharos.mjs";

export function parseRecipientRows(args, decimals) {
  const rows = [];
  const pushRow = (address, amount, source) => {
    if (!isAddress(address)) throw new Error(`Invalid recipient address in ${source}: ${address}`);
    if (/^0x0{40}$/i.test(address)) throw new Error(`Zero address is not allowed in ${source}`);
    if (!amount) throw new Error(`Missing amount for ${address}. Provide CSV amount column or --amount.`);
    rows.push({
      address,
      amountDecimal: String(amount),
      amountBase: parseUnits(amount, decimals)
    });
  };

  const pushLine = (line, source) => {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const parts = trimmed.split(/[,\t;]/).map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return;
    if (parts[0].toLowerCase() === "address" || parts[0].toLowerCase() === "recipient") return;
    pushRow(parts[0], parts[1] || args.amount || "", source);
  };

  if (args.input) {
    const fullPath = path.resolve(args.input);
    const content = fs.readFileSync(fullPath, "utf8");
    for (const line of content.split(/\r?\n/)) pushLine(line, fullPath);
  }

  if (args.recipients) {
    const raw = String(args.recipients);
    if (args.amount) {
      for (const address of raw.split(/[,\s;]+/).map((part) => part.trim()).filter(Boolean)) {
        pushRow(address, args.amount, "--recipients");
      }
    } else {
      const candidates = raw.includes("\n") ? raw.split(/\r?\n/) : raw.split(/[;]+/);
      for (const candidate of candidates) pushLine(candidate, "--recipients");
    }
  }

  for (const item of args._ || []) {
    if (args.amount && isAddress(item)) pushRow(item, args.amount, "positional args");
    else pushLine(item, "positional args");
  }

  if (!rows.length) {
    throw new Error("No recipients found. Use --input, --recipients, or positional address entries.");
  }

  const seen = new Set();
  for (const row of rows) {
    const key = row.address.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate recipient: ${row.address}`);
    seen.add(key);
    if (row.amountBase <= 0n) throw new Error(`Amount must be greater than zero for ${row.address}`);
  }

  return rows;
}

export function arrayArg(values) {
  return `[${values.join(",")}]`;
}

export function chunkRows(rows, size) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

export function sumAmounts(rows) {
  return rows.reduce((sum, row) => sum + row.amountBase, 0n);
}

export function isUniform(rows) {
  const first = rows[0]?.amountBase;
  return rows.every((row) => row.amountBase === first);
}

export function buildPlan(args) {
  const network = selectNetwork(args.network || undefined);
  const asset = String(args.asset || "native").toLowerCase();
  if (!["native", "erc20"].includes(asset)) throw new Error("--asset must be native or erc20");

  let decimals = 18;
  let token = null;
  if (asset === "erc20") {
    token = resolveToken(network, args.token);
    if (token.decimals == null) {
      const output = runCast(["call", token.address, "decimals()(uint8)", "--rpc-url", network.rpcUrl]);
      const match = output.match(/\d+/);
      if (!match) throw new Error(`Could not read decimals for ${token.address}`);
      token.decimals = Number(match[0]);
    }
    decimals = Number(token.decimals);
  }

  const rows = parseRecipientRows(args, decimals);
  const totalBase = sumAmounts(rows);
  const uniform = isUniform(rows);
  const requestedMode = String(args.mode || "auto").toLowerCase();
  if (!["auto", "direct", "distributor"].includes(requestedMode)) {
    throw new Error("--mode must be auto, direct, or distributor");
  }
  const mode = requestedMode === "auto" ? (rows.length <= 10 ? "direct" : "distributor") : requestedMode;
  const explicitChunkSize = args["chunk-size"] != null;
  const chunkSize = Number(args["chunk-size"] || (mode === "distributor" ? 300 : 1));
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new Error("--chunk-size must be a positive integer");
  if (mode === "direct" && explicitChunkSize && chunkSize !== 1) {
    throw new Error("Direct mode sends one transaction per recipient; use --chunk-size 1 or switch to --mode distributor");
  }
  const chunks = chunkRows(rows, chunkSize);

  return {
    network,
    asset,
    token,
    decimals,
    rows,
    totalBase,
    totalDisplay: formatUnits(totalBase, decimals),
    uniform,
    uniformAmountBase: rows[0].amountBase,
    uniformAmountDisplay: formatUnits(rows[0].amountBase, decimals),
    mode,
    distributor: args.distributor || "",
    chunkSize,
    chunks
  };
}

export function planJson(plan) {
  return {
    network: plan.network.name,
    asset: plan.asset,
    token: plan.token,
    decimals: plan.decimals,
    mode: plan.mode,
    distributor: plan.distributor,
    recipients: plan.rows.map((row) => ({
      address: row.address,
      amount: row.amountDecimal,
      amountBase: row.amountBase.toString()
    })),
    totalBase: plan.totalBase.toString(),
    totalDisplay: plan.totalDisplay,
    uniform: plan.uniform,
    chunkSize: plan.chunkSize,
    chunkCount: plan.chunks.length
  };
}
