import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const skillRoot = path.resolve(__dirname, "..", "..");

export function loadJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, relativePath), "utf8"));
}

export function loadChains() {
  return loadJson("assets/chains.json");
}

export function loadProviders() {
  return loadJson("assets/providers.json");
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
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
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

export function isNativeAddress(value) {
  return String(value || "").toLowerCase() === "0x0000000000000000000000000000000000000000";
}

export function nowIso() {
  return new Date().toISOString();
}

export function parseUnits(value, decimals) {
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid decimal amount: ${value}`);
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) throw new Error(`Amount ${value} has more than ${decimals} decimals`);
  const fractionUnits = fraction.padEnd(decimals, "0") || "0";
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fractionUnits);
}

export function formatUnits(value, decimals) {
  const amount = BigInt(value || 0);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const remainder = amount % scale;
  if (remainder === 0n) return whole.toString();
  const fraction = remainder.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fraction}`;
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
  const providers = loadProviders();
  const apiKey = process.env.LIFI_API_KEY || process.env.LI_FI_API_KEY || "";
  const isLifiUrl = String(url).startsWith(providers.lifi.baseUrl);
  const authHeaders = isLifiUrl && apiKey ? { "x-lifi-api-key": apiKey } : {};
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      "user-agent": "pharos-bridge-router/0.1.0",
      ...authHeaders,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    let details = text;
    try {
      const parsed = JSON.parse(text);
      const reasons = [];
      for (const item of parsed.errors?.filteredOut || []) {
        if (item.reason) reasons.push(item.reason);
      }
      for (const item of parsed.errors?.failed || []) {
        for (const failures of Object.values(item.subpaths || {})) {
          for (const failure of failures || []) {
            if (failure.message) reasons.push(`${failure.tool || "tool"}: ${failure.message}`);
          }
        }
      }
      const suffix = reasons.length ? ` Reasons: ${[...new Set(reasons)].slice(0, 5).join(" | ")}` : "";
      details = `${parsed.message || JSON.stringify(parsed)}${suffix}`;
    } catch {
      // keep original text
    }
    const error = new Error(`HTTP ${response.status} from ${url}: ${details}`);
    error.status = response.status;
    error.url = url;
    error.details = details;
    throw error;
  }
  if (!text) return null;
  return JSON.parse(text);
}

export function resolveLocalChain(input) {
  if (input === undefined || input === null || input === "") return null;
  const text = String(input).trim().toLowerCase();
  const numeric = Number(text);
  if (Number.isInteger(numeric) && numeric > 0) {
    return {
      id: numeric,
      key: text,
      name: `Chain ${numeric}`,
      aliases: [text],
      mainnet: true
    };
  }
  const config = loadChains();
  const match = config.chains.find((chain) => {
    const aliases = chain.aliases || [];
    return chain.key.toLowerCase() === text || chain.name.toLowerCase() === text || aliases.map((a) => a.toLowerCase()).includes(text);
  });
  if (!match) {
    throw new Error(`Unknown chain "${input}". Use a chain ID or one of: ${config.chains.map((c) => c.key).join(", ")}`);
  }
  return match;
}

export async function getLifiChains() {
  const providers = loadProviders();
  const data = await fetchJson(`${providers.lifi.baseUrl}/chains`);
  return data.chains || [];
}

export async function enrichChain(chain) {
  const chains = await getLifiChains();
  const remote = chains.find((item) => item.id === chain.id);
  if (!remote) return chain;
  return {
    ...chain,
    name: remote.name || chain.name,
    key: remote.key || chain.key,
    rpcUrl: remote.metamask?.rpcUrls?.[0] || chain.rpcUrl,
    explorerUrl: remote.metamask?.blockExplorerUrls?.[0] || chain.explorerUrl,
    nativeSymbol: remote.nativeToken?.symbol || chain.nativeSymbol,
    nativeToken: remote.nativeToken,
    mainnet: remote.mainnet ?? chain.mainnet
  };
}

export async function getLifiTokens(chainId) {
  const providers = loadProviders();
  const data = await fetchJson(`${providers.lifi.baseUrl}/tokens?chains=${encodeURIComponent(chainId)}`);
  return data.tokens?.[String(chainId)] || [];
}

export async function resolveLifiToken(chainId, input, decimalsOverride = undefined) {
  if (!input) throw new Error("Token is required");
  const text = String(input).trim();
  const lower = text.toLowerCase();
  const tokens = await getLifiTokens(chainId);

  if (["native", "gas"].includes(lower)) {
    const nativeToken = tokens.find((token) => isNativeAddress(token.address));
    if (nativeToken) return nativeToken;
  }

  const nativeToken = tokens.find((token) => isNativeAddress(token.address));
  if (nativeToken && nativeToken.symbol?.toLowerCase() === lower) {
    return nativeToken;
  }

  if (isAddress(text)) {
    const exact = tokens.find((token) => token.address.toLowerCase() === lower);
    if (exact) return exact;
    if (decimalsOverride === undefined) throw new Error(`Token ${text} is not in LI.FI token list for chain ${chainId}; pass --from-decimals for custom source tokens.`);
    return {
      address: text,
      chainId,
      symbol: text,
      name: text,
      decimals: Number(decimalsOverride)
    };
  }

  const exactSymbol = tokens.filter((token) => token.symbol?.toLowerCase() === lower || token.coinKey?.toLowerCase() === lower);
  if (exactSymbol.length) {
    return exactSymbol.find((token) => token.verificationStatus === "verified") || exactSymbol[0];
  }

  throw new Error(`Token "${input}" was not found on LI.FI chain ${chainId}`);
}

export function explorerTx(chain, txHash) {
  if (!chain?.explorerUrl) return txHash;
  return `${chain.explorerUrl.replace(/\/+$/, "")}/tx/${txHash}`;
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
    "Private key not found. Read-only quotes and status checks are still available.",
    "For bridge broadcasts, set PRIVATE_KEY locally or create a local secret file:",
    `- Windows PowerShell: New-Item -ItemType Directory -Force "$env:USERPROFILE\\.codex\\secrets" | Out-Null; Set-Content -NoNewline "${winPath}" "0xYOUR_PRIVATE_KEY"`,
    `- macOS/Linux: mkdir -p ~/.codex/secrets && printf "0xYOUR_PRIVATE_KEY" > ${unixPath} && chmod 600 ${unixPath}`,
    "Never paste or print private keys in chat."
  ].join("\n");
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

export function tryReadPrivateKey(args = {}) {
  try {
    return readPrivateKey(args);
  } catch {
    return "";
  }
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

function containsNumber(values, value) {
  if (!Array.isArray(values) || !values.length) return true;
  return values.map((item) => Number(item)).includes(Number(value));
}

function containsText(values, value) {
  if (!Array.isArray(values) || !values.length) return true;
  const lower = String(value || "").toLowerCase();
  return values.map((item) => String(item).toLowerCase()).includes(lower);
}

function denyAutoConfirm(reason, source = "") {
  return { allowed: false, reason, source };
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

  if (!containsNumber(actionConfig.allowedFromChains, request.fromChainId)) {
    return denyAutoConfirm(`from chain ${request.fromChainId} is not allowed`, source);
  }
  if (!containsNumber(actionConfig.allowedToChains, request.toChainId)) {
    return denyAutoConfirm(`to chain ${request.toChainId} is not allowed`, source);
  }
  if (!containsText(actionConfig.allowedTools, request.tool)) {
    return denyAutoConfirm(`tool ${request.tool || "-"} is not allowed`, source);
  }

  const limits = actionConfig.maxAmount || actionConfig.maxFromAmount || {};
  const limit = pickCaseInsensitive(limits, request.tokenSymbol);
  if (limit === undefined) {
    return denyAutoConfirm(`no maxAmount policy for ${request.tokenSymbol}`, source);
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

function redactText(value) {
  return String(value).replace(/0x[a-fA-F0-9]{64}/g, "<redacted-private-key>");
}

function redactArgs(args) {
  let redactNext = false;
  return args.map((arg) => {
    if (redactNext) {
      redactNext = false;
      return "<redacted>";
    }
    if (arg === "--private-key") {
      redactNext = true;
      return arg;
    }
    if (String(arg).startsWith("--private-key=")) return "--private-key=<redacted>";
    return redactText(arg);
  });
}

export function runBinary(name, args, options = {}) {
  const binary = findBinary(name);
  if (!binary) throw new Error(`Required binary "${name}" was not found in PATH`);
  const result = spawnSync(binary, args, {
    cwd: options.cwd || skillRoot,
    env: options.env || process.env,
    encoding: "utf8",
    windowsHide: true,
    shell: false
  });
  if (result.error) throw result.error;
  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  if (result.status !== 0) {
    const command = `${name} ${redactArgs(args).join(" ")}`;
    const details = redactText(stderr || stdout || `exit code ${result.status}`);
    const error = new Error(`${command} failed: ${details}`);
    error.stdout = stdout;
    error.stderr = stderr;
    error.status = result.status;
    throw error;
  }
  return stdout;
}

export function runCast(args, options = {}) {
  return runBinary("cast", args, options);
}

export function shellPrivateKeyExpression() {
  return process.platform === "win32" ? "$env:PRIVATE_KEY" : "$PRIVATE_KEY";
}

export function castSendPreview(txRequest, rpcUrl, options = {}) {
  const value = BigInt(txRequest.value || "0x0").toString();
  const data = options.compact ? "<calldata-from-plan>" : txRequest.data || "0x";
  const parts = [
    "cast",
    "send",
    txRequest.to,
    "--data",
    data,
    "--value",
    `${value}wei`,
    "--private-key",
    shellPrivateKeyExpression()
  ];
  if (rpcUrl) parts.push("--rpc-url", rpcUrl);
  return parts.join(" ");
}

export function calldataSummary(data) {
  const text = String(data || "0x");
  const bytes = text.startsWith("0x") ? Math.max(0, (text.length - 2) / 2) : text.length;
  if (text.length <= 26) return `${text} (${bytes} bytes)`;
  return `${text.slice(0, 18)}...${text.slice(-8)} (${bytes} bytes)`;
}

export function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function planAgeSeconds(plan) {
  const created = Date.parse(plan.createdAt || "");
  if (!Number.isFinite(created)) return Infinity;
  return Math.floor((Date.now() - created) / 1000);
}
