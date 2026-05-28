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

export function loadNetworks() {
  return loadJson("assets/networks.json");
}

export function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value || "");
}

export function selectNetwork(name = undefined) {
  const config = loadNetworks();
  const requested = (name || config.defaultNetwork || "").toLowerCase();
  const network = config.networks.find((item) => {
    const aliases = item.aliases || [];
    return item.name.toLowerCase() === requested || aliases.map((alias) => alias.toLowerCase()).includes(requested);
  });
  if (!network) {
    throw new Error(`Unknown network "${name}". Available: ${config.networks.map((item) => item.name).join(", ")}`);
  }
  return network;
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
    "Private key not found. NFT build and metadata preparation are still available.",
    "For deployment, mint, or metadata writes, set PRIVATE_KEY locally or create a local secret file:",
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
    if (String(arg).startsWith("--private-key=")) {
      return "--private-key=<redacted>";
    }
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

export function runForge(args, options = {}) {
  return runBinary("forge", args, options);
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

export function shellQuote(value) {
  if (/^[a-zA-Z0-9_./:$-]+$/.test(String(value))) return String(value);
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function copyAsset(relativePath, targetPath) {
  fs.copyFileSync(path.join(skillRoot, relativePath), targetPath);
}

export function explorerAddress(network, address) {
  return `${network.explorerUrl.replace(/\/+$/, "")}/address/${address}`;
}

export function explorerTx(network, txHash) {
  return `${network.explorerUrl.replace(/\/+$/, "")}/tx/${txHash}`;
}
