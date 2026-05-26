import fs from "node:fs";
import path from "node:path";
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

export function loadSelectors() {
  return loadJson("assets/selectors.json");
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

export function explorerAddress(network, address) {
  return `${network.explorerUrl.replace(/\/+$/, "")}/address/${address}`;
}

export function explorerTx(network, hash) {
  return `${network.explorerUrl.replace(/\/+$/, "")}/tx/${hash}`;
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

export async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "accept": "application/json", "user-agent": "pharos-tx-history-summarizer/0.1.0" }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response.json();
}
