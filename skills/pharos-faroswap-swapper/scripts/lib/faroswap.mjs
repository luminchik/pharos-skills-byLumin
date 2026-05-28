import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const skillRoot = path.resolve(__dirname, "..", "..");
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function loadJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, relativePath), "utf8"));
}

export function loadNetworks() {
  return loadJson("assets/networks.json");
}

export function loadTokens() {
  return loadJson("assets/tokens.json");
}

export function loadFaroswap() {
  return loadJson("assets/faroswap.json");
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const eq = item.indexOf("=");
    if (eq !== -1) {
      args[item.slice(2, eq)] = item.slice(eq + 1);
      continue;
    }
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value || "");
}

export function isTxHash(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(value || "");
}

export function normalizeAddress(value) {
  if (!isAddress(value)) throw new Error(`Invalid address: ${value}`);
  return value.toLowerCase();
}

export function selectNetwork(name = "mainnet") {
  const config = loadNetworks();
  const requested = String(name || config.defaultNetwork || "mainnet").toLowerCase();
  const network = config.networks.find((item) => {
    const aliases = item.aliases || [];
    return item.name.toLowerCase() === requested || aliases.map((alias) => alias.toLowerCase()).includes(requested);
  });
  if (!network) throw new Error(`Unknown network "${name}". Faroswap skill supports: ${config.networks.map((n) => n.name).join(", ")}`);
  return network;
}

export function tokenList(networkName = "mainnet") {
  const tokens = loadTokens();
  return tokens[networkName] || [];
}

export function resolveToken(input, networkName = "mainnet") {
  if (!input) throw new Error("Token is required");
  const text = String(input).trim();
  const lower = text.toLowerCase();
  const tokens = tokenList(networkName);
  if (["native", "gas"].includes(lower)) {
    const native = tokens.find((token) => token.native);
    if (native) return native;
  }
  const match = tokens.find((token) =>
    token.symbol.toLowerCase() === lower ||
    token.name.toLowerCase() === lower ||
    token.address.toLowerCase() === lower
  );
  if (!match) {
    throw new Error(`Unknown token "${input}". Built-ins: ${tokens.map((token) => token.symbol).join(", ")}`);
  }
  return match;
}

export function tokenByAddress(address, networkName = "mainnet") {
  const lower = String(address || "").toLowerCase();
  return tokenList(networkName).find((token) => token.address.toLowerCase() === lower) || null;
}

export function parseUnits(value, decimals) {
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid decimal amount: ${value}`);
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) throw new Error(`Amount ${value} has more than ${decimals} decimals`);
  const padded = fraction.padEnd(decimals, "0") || "0";
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded);
}

export function formatUnits(value, decimals) {
  const amount = BigInt(value || 0);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const remainder = amount % scale;
  if (remainder === 0n) return whole.toString();
  return `${whole}.${remainder.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

export function toPlainDecimal(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const [coefficient, exponentText] = text.toLowerCase().split("e");
  const exponent = Number(exponentText);
  if (!Number.isInteger(exponent)) return text;
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = `${whole}${fraction}`.replace(/^-/, "");
  const sign = coefficient.startsWith("-") ? "-" : "";
  const decimalIndex = whole.replace("-", "").length + exponent;
  if (decimalIndex <= 0) return `${sign}0.${"0".repeat(Math.abs(decimalIndex))}${digits}`;
  if (decimalIndex >= digits.length) return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

export function explorerTx(network, hash) {
  return `${network.explorerUrl.replace(/\/+$/, "")}/tx/${hash}`;
}

export function explorerAddress(network, address) {
  return `${network.explorerUrl.replace(/\/+$/, "")}/address/${address}`;
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function pathEntries() {
  return (process.env.PATH || "").split(path.delimiter).filter(Boolean);
}

export function findBinary(name) {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const isWin = process.platform === "win32";
  const candidates = [];
  if (isWin && home && ["cast", "forge"].includes(name)) {
    candidates.push(path.join(home, ".foundry", "bin", `${name}.exe`));
  }
  for (const dir of pathEntries()) {
    if (isWin) {
      candidates.push(path.join(dir, `${name}.exe`));
      candidates.push(path.join(dir, `${name}.cmd`));
      candidates.push(path.join(dir, `${name}.bat`));
    }
    candidates.push(path.join(dir, name));
  }
  return candidates.find(fileExists) || null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function defaultPrivateKeyPaths() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  return unique([
    process.env.PHAROS_PRIVATE_KEY_FILE,
    process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, "secrets", "pharos_private_key.txt") : "",
    home ? path.join(home, ".codex", "secrets", "pharos_private_key.txt") : "",
    home ? path.join(home, ".pharos", "private_key") : ""
  ]);
}

export function defaultPolicyPaths() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  return unique([
    process.env.PHAROS_POLICY_FILE,
    process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, "secrets", "pharos_policy.json") : "",
    home ? path.join(home, ".codex", "secrets", "pharos_policy.json") : "",
    home ? path.join(home, ".pharos", "policy.json") : ""
  ]);
}

function normalizePrivateKey(value, source = "private key") {
  const trimmed = String(value || "").trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) return trimmed;
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return `0x${trimmed}`;
  throw new Error(`${source} is not a 32-byte hex private key`);
}

export function privateKeySetupMessage() {
  const winPath = "$env:USERPROFILE\\.codex\\secrets\\pharos_private_key.txt";
  const unixPath = "~/.codex/secrets/pharos_private_key.txt";
  return [
    "Private key not found. Faroswap quotes are still available.",
    "For swap broadcasts, set PRIVATE_KEY locally or create a local secret file:",
    `- Windows PowerShell: New-Item -ItemType Directory -Force "$env:USERPROFILE\\.codex\\secrets" | Out-Null; Set-Content -NoNewline "${winPath}" "0xYOUR_PRIVATE_KEY"`,
    `- macOS/Linux: mkdir -p ~/.codex/secrets && printf "0xYOUR_PRIVATE_KEY" > ${unixPath} && chmod 600 ${unixPath}`,
    "Never paste or print private keys in chat."
  ].join("\n");
}

export function runCast(args, options = {}) {
  const binary = findBinary("cast");
  if (!binary) throw new Error("Foundry cast was not found. Install Foundry before executing or decoding swaps.");
  const result = spawnSync(binary, args, {
    cwd: skillRoot,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    env: { ...process.env, ...(options.env || {}) }
  });
  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(stderr || stdout || `cast failed with exit code ${result.status}`);
  return stdout;
}

export function parseCastUint(output) {
  const match = String(output || "").match(/\b\d+\b/);
  if (!match) return 0n;
  return BigInt(match[0]);
}

export function extractTxHash(output) {
  const transactionHash = String(output || "").match(/transactionHash\s+(0x[a-fA-F0-9]{64})/);
  if (transactionHash) return transactionHash[1];
  const matches = String(output || "").match(/0x[a-fA-F0-9]{64}/g);
  return matches?.at(-1) || "";
}

export function printTable(rows) {
  if (!rows.length) {
    console.log("(no rows)");
    return;
  }
  const headers = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!headers.includes(key)) headers.push(key);
    }
  }
  const widths = headers.map((header) =>
    Math.max(header.length, ...rows.map((row) => String(row[header] ?? "").length))
  );
  console.log(`| ${headers.map((h, i) => h.padEnd(widths[i])).join(" | ")} |`);
  console.log(`| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`);
  for (const row of rows) {
    console.log(`| ${headers.map((h, i) => String(row[h] ?? "").padEnd(widths[i])).join(" | ")} |`);
  }
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      "user-agent": "pharos-faroswap-swapper/0.1.0",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 500)}`);
  }
  return parsed;
}

export function quoteUrl(params) {
  const faroswap = loadFaroswap();
  const search = new URLSearchParams(params);
  return `${faroswap.quoteApiUrl}?${search.toString()}`;
}

export async function quoteSwap(input) {
  const faroswap = loadFaroswap();
  const network = selectNetwork(input.network || "mainnet");
  if (Number(network.chainId) !== 1672) throw new Error("Faroswap is supported only on Pharos mainnet chainId 1672.");
  const fromToken = resolveToken(input.from, network.name);
  const toToken = resolveToken(input.to, network.name);
  if (fromToken.address.toLowerCase() === toToken.address.toLowerCase()) {
    throw new Error("from and to tokens must be different");
  }
  const amountBase = input.amountBase !== undefined
    ? BigInt(input.amountBase)
    : parseUnits(input.amount, Number(fromToken.decimals));
  if (amountBase <= 0n) throw new Error("Swap amount must be greater than zero");
  const address = input.address ? normalizeAddress(input.address) : ZERO_ADDRESS;
  const deadline = Math.floor(Date.now() / 1000) + Number(input.deadlineMinutes || faroswap.defaultDeadlineMinutes) * 60;
  const estimateGas = input.estimateGas !== undefined
    ? String(input.estimateGas) !== "false"
    : Boolean(fromToken.native);
  const apiKey = input.apiKey || process.env.FAROSWAP_API_KEY || faroswap.publicWidgetApiKey;
  const params = {
    chainId: String(network.chainId),
    deadLine: String(input.deadline || deadline),
    apikey: apiKey,
    slippage: String(input.slippage ?? faroswap.defaultSlippagePercent),
    source: input.source || faroswap.source,
    toTokenAddress: toToken.address,
    fromTokenAddress: fromToken.address,
    userAddr: address,
    estimateGas: String(estimateGas),
    fromAmount: amountBase.toString()
  };
  const url = quoteUrl(params);
  const body = await fetchJson(url);
  if (body.status !== 200 || !body.data || !body.data.resAmount) {
    const detail = typeof body.data === "string" ? body.data : JSON.stringify(body);
    throw new Error(`Faroswap quote failed: ${detail}`);
  }
  const data = body.data;
  return {
    network,
    provider: faroswap.provider,
    quoteUrl: url.replace(apiKey, "<redacted>"),
    userAddress: address,
    fromToken,
    toToken,
    amountInBase: amountBase.toString(),
    amountIn: formatUnits(amountBase, Number(fromToken.decimals)),
    slippagePercent: String(params.slippage),
    deadline: Number(params.deadLine),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Number(params.deadLine) * 1000).toISOString(),
    apiData: data
  };
}

export function buildPlanFromQuote(quote) {
  const data = quote.apiData;
  const amountBase = BigInt(quote.amountInBase);
  const approval = data.targetApproveAddr
    ? {
        token: quote.fromToken.address,
        tokenSymbol: quote.fromToken.symbol,
        spender: data.targetApproveAddr,
        amountBase: amountBase.toString(),
        amount: quote.amountIn
      }
    : null;
  return {
    version: "0.1.0",
    kind: "faroswap-swap-plan",
    createdAt: quote.createdAt,
    expiresAt: quote.expiresAt,
    provider: quote.provider,
    network: {
      name: quote.network.name,
      chainId: quote.network.chainId,
      rpcUrl: quote.network.rpcUrl,
      explorerUrl: quote.network.explorerUrl,
      nativeToken: quote.network.nativeToken
    },
    userAddress: quote.userAddress,
    fromToken: quote.fromToken,
    toToken: quote.toToken,
    amountInBase: quote.amountInBase,
    amountIn: quote.amountIn,
    estimatedOut: toPlainDecimal(data.resAmount),
    minReturnAmount: String(data.minReturnAmount || ""),
    targetDecimals: Number(data.targetDecimals ?? quote.toToken.decimals),
    slippagePercent: quote.slippagePercent,
    priceImpact: data.priceImpact ?? null,
    fees: {
      baseFeeAmount: data.baseFeeAmount ?? null,
      baseFeeRate: data.baseFeeRate ?? null,
      additionalFeeAmount: data.additionalFeeAmount ?? null
    },
    route: {
      useSource: data.useSource || "",
      routeInfo: data.routeInfo || null,
      id: data.id || ""
    },
    approval,
    tx: {
      to: data.to,
      data: data.data,
      value: String(data.value || "0"),
      gasLimit: String(data.gasLimit || "0")
    },
    safety: {
      confirmation: "CONFIRM_MAINNET_SWAP",
      refreshAfterMinutes: 10
    }
  };
}

export async function buildPlan(input) {
  const quote = await quoteSwap(input);
  return buildPlanFromQuote(quote);
}

export function planRows(plan) {
  return [
    { Field: "Network", Value: `${plan.network.name} (${plan.network.chainId})` },
    { Field: "Provider", Value: plan.provider },
    { Field: "From", Value: `${plan.amountIn} ${plan.fromToken.symbol}` },
    { Field: "To", Value: `${plan.estimatedOut} ${plan.toToken.symbol}` },
    { Field: "Min return", Value: `${plan.minReturnAmount || "-"} base units` },
    { Field: "Slippage", Value: `${plan.slippagePercent}%` },
    { Field: "Route", Value: plan.route.useSource || "-" },
    { Field: "Target", Value: plan.tx.to },
    { Field: "Value", Value: `${plan.tx.value} wei` },
    { Field: "Approval", Value: plan.approval ? `${plan.approval.amount} ${plan.approval.tokenSymbol} -> ${plan.approval.spender}` : "not required" },
    { Field: "Gas limit", Value: plan.tx.gasLimit || "-" },
    { Field: "Expires", Value: plan.expiresAt }
  ];
}

export function readPrivateKey(args = {}) {
  if (args["private-key-file"]) {
    const filePath = path.resolve(args["private-key-file"]);
    if (!fileExists(filePath)) throw new Error(`Private key file not found: ${filePath}`);
    return normalizePrivateKey(fs.readFileSync(filePath, "utf8"), `Private key file ${filePath}`);
  }
  if (process.env.PRIVATE_KEY) return normalizePrivateKey(process.env.PRIVATE_KEY, "PRIVATE_KEY");
  for (const filePath of defaultPrivateKeyPaths()) {
    if (fileExists(filePath)) {
      return normalizePrivateKey(fs.readFileSync(filePath, "utf8"), `Private key file ${filePath}`);
    }
  }
  throw new Error(privateKeySetupMessage());
}

export function readPolicy(args = {}) {
  const candidates = unique([
    args.policy ? path.resolve(args.policy) : "",
    ...defaultPolicyPaths()
  ]);
  for (const filePath of candidates) {
    if (fileExists(filePath)) {
      const policy = JSON.parse(fs.readFileSync(filePath, "utf8"));
      policy.__source = filePath;
      return policy;
    }
  }
  return null;
}

function pickCaseInsensitive(record, key) {
  if (!record || !key) return undefined;
  const lower = String(key).toLowerCase();
  const found = Object.keys(record).find((item) => item.toLowerCase() === lower);
  return found ? record[found] : undefined;
}

function denyAutoConfirm(reason, source = "") {
  return { allowed: false, reason, source };
}

function isUnlimitedAmountPolicy(value) {
  return value === true || String(value || "").toLowerCase() === "*" || String(value || "").toLowerCase() === "unlimited";
}

export function evaluateMainnetAutoConfirm(policy, request) {
  if (!policy) return denyAutoConfirm("no policy file found");
  const source = policy.__source || "policy";
  const mainnet = policy.mainnet || {};
  const auto = typeof mainnet.autoConfirm === "object" ? mainnet.autoConfirm : {};
  const enabled = auto.enabled === true || mainnet.autoConfirm === true;
  if (!enabled) return denyAutoConfirm("mainnet auto-confirm is disabled", source);

  const expiresAt = auto.expiresAt || mainnet.expiresAt || policy.expiresAt || "";
  if (expiresAt && Date.now() > Date.parse(expiresAt)) {
    return denyAutoConfirm(`policy expired at ${expiresAt}`, source);
  }

  const signer = String(request.signer || "").toLowerCase();
  const allowedSigner = String(auto.allowedSigner || mainnet.allowedSigner || policy.allowedSigner || "").toLowerCase();
  if (allowedSigner && signer !== allowedSigner) {
    return denyAutoConfirm(`signer ${request.signer} does not match policy signer ${allowedSigner}`, source);
  }

  const actions = auto.actions || mainnet.actions || {};
  const actionConfig = actions[request.action] || {};
  if (Object.keys(actions).length && actionConfig.enabled !== true) {
    return denyAutoConfirm(`action ${request.action} is not enabled in policy`, source);
  }

  if (actionConfig.unlimited === true || isUnlimitedAmountPolicy(actionConfig.maxInputAmount) || isUnlimitedAmountPolicy(actionConfig.maxAmount)) {
    return {
      allowed: true,
      source,
      reason: `policy matched ${request.action}: unlimited ${request.tokenSymbol} amount`
    };
  }

  const limits = actionConfig.maxInputAmount || actionConfig.maxAmount || {};
  const limit = typeof limits === "string" ? limits : pickCaseInsensitive(limits, request.tokenSymbol);
  if (limit === undefined) {
    return denyAutoConfirm(`no maxInputAmount policy for ${request.tokenSymbol}`, source);
  }
  if (isUnlimitedAmountPolicy(limit)) {
    return {
      allowed: true,
      source,
      reason: `policy matched ${request.action}: unlimited ${request.tokenSymbol} amount`
    };
  }
  const limitBase = parseUnits(String(limit), Number(request.tokenDecimals));
  if (BigInt(request.amountBase) > limitBase) {
    return denyAutoConfirm(`${request.amountHuman} ${request.tokenSymbol} exceeds policy limit ${limit}`, source);
  }

  return {
    allowed: true,
    source,
    reason: `policy matched ${request.action}: ${request.amountHuman} ${request.tokenSymbol} <= ${limit}`
  };
}

export function loadPlan(planPath) {
  const plan = JSON.parse(fs.readFileSync(path.resolve(planPath), "utf8"));
  if (plan.kind !== "faroswap-swap-plan") throw new Error(`Not a Faroswap swap plan: ${plan.kind || "unknown"}`);
  return plan;
}

export function hexWords(data) {
  const body = String(data || "").replace(/^0x/, "");
  const words = [];
  for (let i = 0; i + 64 <= body.length; i += 64) words.push(body.slice(i, i + 64));
  return words;
}

export function wordToAddress(word) {
  return `0x${String(word).slice(24)}`;
}

export function wordToBigInt(word) {
  return BigInt(`0x${word || "0"}`);
}

export function selectorOf(input) {
  const text = String(input || "");
  return text.length >= 10 ? text.slice(0, 10).toLowerCase() : "";
}
