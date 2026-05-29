#!/usr/bin/env node
import fs from "node:fs";
import {
  explorerAddress,
  formatUnits,
  isAddress,
  loadProtocols,
  loadTokens,
  parseArgs,
  parseCastUint,
  printTable,
  runCast,
  selectNetworks
} from "./lib/pharos.mjs";

function usage() {
  console.log("Usage:");
  console.log("  node scripts/defi-positions.mjs <wallet> --network mainnet");
  console.log("  node scripts/defi-positions.mjs <wallet> --network all --include-zero");
  console.log("  node scripts/defi-positions.mjs <wallet> --network mainnet --json");
  console.log("  node scripts/defi-positions.mjs <wallet> --protocol-file protocols.local.json");
  console.log("");
  console.log("Protocol definition types:");
  console.log("  erc20-balance: { name,type,contract,symbol,decimals,category }");
  console.log("  erc721-balance: { name,type,contract,symbol,category }");
  console.log("  uniswap-v3-position-manager: { name,type,contract,symbol,tokenMetadata,maxPositions }");
  console.log("  staking: { name,type,contract,stakedFunction,rewardFunction,symbol,decimals,rewardSymbol,rewardDecimals }");
}

function safeCall(args) {
  try {
    return { ok: true, output: runCast(args) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function loadExtraProtocols(file) {
  if (!file) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function protocolsFor(networkName, extra) {
  const builtIn = loadProtocols();
  const builtInList = builtIn[networkName] || [];
  const extraList = Array.isArray(extra) ? extra : extra[networkName] || [];
  return [...builtInList, ...extraList];
}

function rawIsZero(raw) {
  try {
    return BigInt(raw) === 0n;
  } catch {
    return false;
  }
}

function addIfVisible(rows, row, includeZero, jsonRows = []) {
  if (includeZero || row.Raw === undefined || !rawIsZero(row.Raw)) {
    const { Raw, Metadata, ...visible } = row;
    rows.push(visible);
    jsonRows.push(row);
    return true;
  }
  return false;
}

function addressKey(value) {
  return String(value || "").toLowerCase();
}

function shortAddress(value) {
  const text = String(value || "");
  return text.length > 12 ? `${text.slice(0, 6)}...${text.slice(-4)}` : text;
}

function tokenMetadataMap(networkTokens, protocols) {
  const map = new Map();
  for (const token of networkTokens || []) {
    map.set(addressKey(token.address), token);
  }
  for (const protocol of protocols || []) {
    for (const token of protocol.tokenMetadata || []) {
      map.set(addressKey(token.address), token);
    }
  }
  return map;
}

function tokenLabel(tokenMap, address) {
  const token = tokenMap.get(addressKey(address));
  return token?.symbol || shortAddress(address);
}

function splitTuple(output) {
  const text = String(output || "").trim();
  const body = text.startsWith("(") && text.endsWith(")") ? text.slice(1, -1) : text;
  const parts = [];
  let current = "";
  let depth = 0;
  for (const char of body) {
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function firstInteger(value) {
  const match = String(value || "").match(/-?\d+/);
  return match ? match[0] : "0";
}

function parseV3Position(output) {
  const fields = splitTuple(output);
  return {
    nonce: firstInteger(fields[0]),
    operator: fields[1],
    token0: fields[2],
    token1: fields[3],
    fee: firstInteger(fields[4]),
    tickLower: firstInteger(fields[5]),
    tickUpper: firstInteger(fields[6]),
    liquidity: firstInteger(fields[7]),
    feeGrowthInside0LastX128: firstInteger(fields[8]),
    feeGrowthInside1LastX128: firstInteger(fields[9]),
    tokensOwed0: firstInteger(fields[10]),
    tokensOwed1: firstInteger(fields[11])
  };
}

function feePercent(fee) {
  const value = Number(fee);
  if (!Number.isFinite(value)) return `${fee}`;
  return `${value / 10000}%`;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

function protocolCallUint(network, contract, signature, ...params) {
  return parseCastUint(runCast([
    "call",
    contract,
    signature,
    ...params.map((param) => String(param)),
    "--rpc-url",
    network.rpcUrl
  ]));
}

function protocolCall(network, contract, signature, ...params) {
  return runCast([
    "call",
    contract,
    signature,
    ...params.map((param) => String(param)),
    "--rpc-url",
    network.rpcUrl
  ]);
}

function addErc721Balance(rows, jsonRows, hiddenCounter, network, wallet, protocol, includeZero) {
  const raw = protocolCallUint(network, protocol.contract, protocol.balanceFunction || "balanceOf(address)(uint256)", wallet);
  const visible = addIfVisible(rows, {
    Network: network.name,
    Source: protocol.name,
    Position: protocol.symbol || "NFT position",
    Category: protocol.category || "NFT position",
    Balance: raw.toString(),
    Raw: raw.toString(),
    Contract: protocol.contract,
    Explorer: explorerAddress(network, protocol.contract),
    Metadata: {
      type: protocol.type,
      contract: protocol.contract
    }
  }, includeZero, jsonRows);
  return hiddenCounter + (raw === 0n && !visible ? 1 : 0);
}

function addV3PositionManager(rows, jsonRows, hiddenCounter, network, wallet, protocol, includeZero, tokenMap, maxNfts) {
  const balance = protocolCallUint(network, protocol.contract, "balanceOf(address)(uint256)", wallet);
  const visible = addIfVisible(rows, {
    Network: network.name,
    Source: protocol.name,
    Position: protocol.symbol || "V3-LP-NFT",
    Category: protocol.category || "concentrated liquidity NFT",
    Balance: balance.toString(),
    Raw: balance.toString(),
    Details: balance > BigInt(maxNfts) ? `showing first ${maxNfts} tokenIds` : "-",
    Contract: protocol.contract,
    Explorer: explorerAddress(network, protocol.contract),
    Metadata: {
      type: protocol.type,
      contract: protocol.contract,
      maxPositions: maxNfts
    }
  }, includeZero, jsonRows);
  hiddenCounter += balance === 0n && !visible ? 1 : 0;

  const count = Number(balance > BigInt(maxNfts) ? BigInt(maxNfts) : balance);
  for (let index = 0; index < count; index += 1) {
    const tokenId = protocolCallUint(
      network,
      protocol.contract,
      "tokenOfOwnerByIndex(address,uint256)(uint256)",
      wallet,
      index
    );
    const position = parseV3Position(protocolCall(
      network,
      protocol.contract,
      "positions(uint256)((uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128))",
      tokenId
    ));
    const token0 = tokenMap.get(addressKey(position.token0));
    const token1 = tokenMap.get(addressKey(position.token1));
    const owed0 = formatUnits(position.tokensOwed0, Number(token0?.decimals ?? 18));
    const owed1 = formatUnits(position.tokensOwed1, Number(token1?.decimals ?? 18));
    const pair = `${tokenLabel(tokenMap, position.token0)}/${tokenLabel(tokenMap, position.token1)}`;
    addIfVisible(rows, {
      Network: network.name,
      Source: protocol.name,
      Position: `#${tokenId.toString()} ${pair}`,
      Category: "concentrated liquidity position",
      Balance: `liquidity ${position.liquidity}`,
      Raw: "1",
      Details: `fee ${feePercent(position.fee)}, ticks ${position.tickLower}..${position.tickUpper}, owed ${owed0} ${tokenLabel(tokenMap, position.token0)} / ${owed1} ${tokenLabel(tokenMap, position.token1)}`,
      Contract: protocol.contract,
      Explorer: explorerAddress(network, protocol.contract),
      Metadata: {
        type: protocol.type,
        tokenId: tokenId.toString(),
        token0: position.token0,
        token1: position.token1,
        fee: position.fee,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        liquidity: position.liquidity,
        tokensOwed0: position.tokensOwed0,
        tokensOwed1: position.tokensOwed1
      }
    }, includeZero, jsonRows);
  }

  return hiddenCounter;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  usage();
  process.exit(0);
}

const wallet = args._[0] || args.wallet;

if (!wallet || !isAddress(wallet)) {
  usage();
  if (wallet) console.error(`Invalid wallet address: ${wallet}`);
  process.exit(1);
}

const includeZero = Boolean(args["include-zero"]);
const networks = selectNetworks(args.network || undefined);
const tokens = loadTokens();
const extraProtocols = loadExtraProtocols(args["protocol-file"]);
const rows = [];
const jsonRows = [];
const warnings = [];
let hiddenZero = 0;
const maxNfts = positiveInteger(args["max-nfts"], 25);

if (!args.json) {
  console.log("# Pharos DeFi Position Check");
  console.log("");
  console.log(`Wallet: ${wallet}`);
  console.log("");
}

for (const network of networks) {
  const networkProtocols = protocolsFor(network.name, extraProtocols);
  const tokenMap = tokenMetadataMap(tokens[network.name] || [], networkProtocols);
  const native = parseCastUint(runCast(["balance", wallet, "--rpc-url", network.rpcUrl]));
  const nativeVisible = addIfVisible(rows, {
    Network: network.name,
    Source: "native",
    Position: network.nativeToken,
    Category: "native",
    Balance: formatUnits(native, 18),
    Raw: native.toString(),
    Contract: "-",
    Explorer: explorerAddress(network, wallet)
  }, includeZero, jsonRows);
  if (native === 0n && !nativeVisible) hiddenZero += 1;

  for (const token of tokens[network.name] || []) {
    const call = safeCall([
      "call",
      token.address,
      "balanceOf(address)(uint256)",
      wallet,
      "--rpc-url",
      network.rpcUrl
    ]);
    const raw = call.ok ? parseCastUint(call.output) : 0n;
    const visible = addIfVisible(rows, {
      Network: network.name,
      Source: "token",
      Position: token.symbol,
      Category: token.category || "token",
      Balance: formatUnits(raw, Number(token.decimals)),
      Raw: raw.toString(),
      Contract: token.address,
      Explorer: explorerAddress(network, token.address)
    }, includeZero, jsonRows);
    if (raw === 0n && !visible) hiddenZero += 1;
  }

  for (const protocol of networkProtocols) {
    try {
      if (protocol.type === "erc20-balance") {
        const raw = protocolCallUint(network, protocol.contract, protocol.balanceFunction || "balanceOf(address)(uint256)", wallet);
        const visible = addIfVisible(rows, {
          Network: network.name,
          Source: protocol.name,
          Position: protocol.symbol,
          Category: protocol.category || "protocol token",
          Balance: formatUnits(raw, Number(protocol.decimals || 18)),
          Raw: raw.toString(),
          Details: protocol.details || "-",
          Contract: protocol.contract,
          Explorer: explorerAddress(network, protocol.contract),
          Metadata: {
            type: protocol.type,
            contract: protocol.contract
          }
        }, includeZero, jsonRows);
        if (raw === 0n && !visible) hiddenZero += 1;
      } else if (protocol.type === "erc721-balance") {
        hiddenZero = addErc721Balance(rows, jsonRows, hiddenZero, network, wallet, protocol, includeZero);
      } else if (protocol.type === "uniswap-v3-position-manager") {
        const protocolMaxNfts = args["max-nfts"] ? maxNfts : positiveInteger(protocol.maxPositions, maxNfts);
        hiddenZero = addV3PositionManager(
          rows,
          jsonRows,
          hiddenZero,
          network,
          wallet,
          protocol,
          includeZero,
          tokenMap,
          protocolMaxNfts
        );
      } else if (protocol.type === "staking") {
        const staked = protocolCallUint(
          network,
          protocol.contract,
          protocol.stakedFunction || "balanceOf(address)(uint256)",
          wallet
        );
        const visible = addIfVisible(rows, {
          Network: network.name,
          Source: protocol.name,
          Position: protocol.symbol || "staked",
          Category: "staked",
          Balance: formatUnits(staked, Number(protocol.decimals || 18)),
          Raw: staked.toString(),
          Contract: protocol.contract,
          Explorer: explorerAddress(network, protocol.contract),
          Metadata: {
            type: protocol.type,
            contract: protocol.contract
          }
        }, includeZero, jsonRows);
        if (staked === 0n && !visible) hiddenZero += 1;
        if (protocol.rewardFunction) {
          const reward = protocolCallUint(network, protocol.contract, protocol.rewardFunction, wallet);
          const rewardVisible = addIfVisible(rows, {
            Network: network.name,
            Source: protocol.name,
            Position: protocol.rewardSymbol || "reward",
            Category: "claimable reward",
            Balance: formatUnits(reward, Number(protocol.rewardDecimals || 18)),
            Raw: reward.toString(),
            Contract: protocol.contract,
            Explorer: explorerAddress(network, protocol.contract),
            Metadata: {
              type: protocol.type,
              contract: protocol.contract
            }
          }, includeZero, jsonRows);
          if (reward === 0n && !rewardVisible) hiddenZero += 1;
        }
      } else {
        warnings.push(`${network.name}: skipped unsupported protocol type "${protocol.type}" for ${protocol.name || protocol.contract}`);
      }
    } catch (error) {
      throw new Error(`${network.name}: ${protocol.name || protocol.contract} (${protocol.type}) failed: ${error.message}`);
    }
  }
}

if (args.json) {
  console.log(JSON.stringify({
    ok: true,
    wallet,
    networks: networks.map((network) => network.name),
    includeZero,
    hiddenZero,
    positions: jsonRows.map((row) => ({
      network: row.Network,
      source: row.Source,
      position: row.Position,
      category: row.Category,
      balance: row.Balance,
      raw: row.Raw,
      details: row.Details,
      contract: row.Contract,
      explorer: row.Explorer,
      metadata: row.Metadata
    })),
    warnings
  }, null, 2));
  process.exit(0);
}

printTable(rows);
console.log("");
if (hiddenZero) {
  console.log(`Hidden zero positions: ${hiddenZero}. Re-run with --include-zero to display them.`);
}
if (warnings.length) {
  console.log("");
  console.log("Warnings:");
  for (const warning of warnings) console.log(`- ${warning}`);
}
console.log("");
console.log("Note: protocol positions are registry-driven. Add verified protocol definitions with --protocol-file for LP, vault, NFT, or staking contracts.");
