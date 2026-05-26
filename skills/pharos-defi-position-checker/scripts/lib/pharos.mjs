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

export function loadTokens() {
  return loadJson("assets/tokens.json");
}

export function loadProtocols() {
  return loadJson("assets/protocols.json");
}

export function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value || "");
}

export function selectNetworks(name = undefined) {
  const config = loadNetworks();
  const requested = (name || config.defaultNetwork || "").toLowerCase();
  if (requested === "all" || requested === "*") return config.networks;
  const network = config.networks.find((item) => {
    const aliases = item.aliases || [];
    return item.name.toLowerCase() === requested || aliases.map((alias) => alias.toLowerCase()).includes(requested);
  });
  if (!network) {
    throw new Error(`Unknown network "${name}". Available: ${config.networks.map((item) => item.name).join(", ")}`);
  }
  return [network];
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
  if (isWin && home && name === "cast") candidates.push(path.join(home, ".foundry", "bin", "cast.exe"));
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

export function runCast(args) {
  const binary = findBinary("cast");
  if (!binary) throw new Error("cast was not found in PATH");
  const result = spawnSync(binary, args, { cwd: skillRoot, encoding: "utf8", windowsHide: true, shell: false });
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

export function formatUnits(value, decimals) {
  const amount = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const remainder = amount % scale;
  if (remainder === 0n) return whole.toString();
  return `${whole}.${remainder.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
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

export function explorerAddress(network, address) {
  return `${network.explorerUrl.replace(/\/+$/, "")}/address/${address}`;
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
