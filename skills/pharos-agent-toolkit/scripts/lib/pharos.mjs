import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const skillRoot = path.resolve(__dirname, "..", "..");
export const assetsDir = path.join(skillRoot, "assets");

export function loadJson(relativePath) {
  const fullPath = path.join(skillRoot, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

export function loadNetworks() {
  return loadJson("assets/networks.json");
}

export function loadTokens() {
  return loadJson("assets/tokens.json");
}

export function loadSelectors() {
  return loadJson("assets/selectors.json");
}

export function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value || "");
}

export function isTxHash(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(value || "");
}

export function explorerAddress(network, address) {
  return `${network.explorerUrl.replace(/\/+$/, "")}/address/${address}`;
}

export function explorerTx(network, txHash) {
  return `${network.explorerUrl.replace(/\/+$/, "")}/tx/${txHash}`;
}

export function selectNetworks(name = undefined) {
  const config = loadNetworks();
  const requested = (name || config.defaultNetwork || "").toLowerCase();

  if (requested === "all" || requested === "*") {
    return config.networks;
  }

  const match = config.networks.find((network) => {
    const aliases = network.aliases || [];
    return (
      network.name.toLowerCase() === requested ||
      aliases.map((alias) => alias.toLowerCase()).includes(requested)
    );
  });

  if (!match) {
    const names = config.networks.map((network) => network.name).join(", ");
    throw new Error(`Unknown network "${name}". Available networks: ${names}`);
  }

  return [match];
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function pathEntries() {
  return (process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
}

export function findBinary(name) {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const isWin = process.platform === "win32";
  const candidates = [];

  if (isWin && home && ["cast", "forge", "anvil", "chisel"].includes(name)) {
    candidates.push(path.join(home, ".foundry", "bin", `${name}.exe`));
  }

  if (isWin && name === "bash") {
    candidates.push("C:\\Program Files\\Git\\bin\\bash.exe");
    candidates.push("C:\\Program Files\\Git\\usr\\bin\\bash.exe");
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

function normalizePrivateKey(value, source = "private key") {
  const trimmed = String(value || "").trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) return trimmed;
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return `0x${trimmed}`;
  throw new Error(`${source} is not a 32-byte hex private key`);
}

export function discoverPrivateKey() {
  if (process.env.PRIVATE_KEY) {
    return { value: normalizePrivateKey(process.env.PRIVATE_KEY, "PRIVATE_KEY"), source: "PRIVATE_KEY" };
  }
  for (const filePath of defaultPrivateKeyPaths()) {
    if (fileExists(filePath)) {
      return {
        value: normalizePrivateKey(fs.readFileSync(filePath, "utf8"), `Private key file ${filePath}`),
        source: filePath
      };
    }
  }
  return null;
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
  if (!binary) {
    throw new Error(`Required binary "${name}" was not found in PATH`);
  }

  const result = spawnSync(binary, args, {
    cwd: options.cwd || skillRoot,
    env: options.env || process.env,
    encoding: "utf8",
    windowsHide: true,
    shell: false
  });

  if (result.error) {
    throw result.error;
  }

  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();

  if (result.status !== 0) {
    const details = redactText(stderr || stdout || `exit code ${result.status}`);
    const error = new Error(`${name} ${redactArgs(args).join(" ")} failed: ${details}`);
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

export function parseCastUint(output) {
  const match = String(output || "").match(/\b\d+\b/);
  if (!match) return 0n;
  return BigInt(match[0]);
}

export function formatUnits(value, decimals) {
  const amount = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const remainder = amount % scale;
  if (remainder === 0n) return whole.toString();
  const fraction = remainder.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fraction}`;
}

export function parseCastString(output) {
  const text = String(output || "").trim();
  const quoted = text.match(/^"([\s\S]*)"$/);
  if (quoted) return quoted[1];
  const tupleQuoted = text.match(/\((?:\s*)?"([\s\S]*?)"(?:\s*)?\)/);
  if (tupleQuoted) return tupleQuoted[1];
  if (text && !text.startsWith("0x")) return text.split(/\r?\n/)[0].trim();
  return "";
}

export function parseCastBool(output) {
  const text = String(output || "").trim().toLowerCase();
  if (/\btrue\b/.test(text)) return true;
  if (/\bfalse\b/.test(text)) return false;
  const uint = parseCastUint(text);
  return uint !== 0n;
}

export function parseAddressList(value) {
  if (!value) return [];
  const matches = String(value).match(/0x[a-fA-F0-9]{40}/g) || [];
  const seen = new Set();
  const addresses = [];
  for (const address of matches) {
    const key = address.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      addresses.push(address);
    }
  }
  return addresses;
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

export function readAddressesFromFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return parseAddressList(content);
}

export function ipfsToHttps(uri) {
  if (!uri || typeof uri !== "string") return uri;
  if (uri.startsWith("ipfs://ipfs/")) {
    return `https://ipfs.io/ipfs/${uri.slice("ipfs://ipfs/".length)}`;
  }
  if (uri.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`;
  }
  return uri;
}
