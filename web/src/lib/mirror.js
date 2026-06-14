// Hedera Mirror Node REST reads — the audit/read layer for Wafer (SPEC §2, §6).
//
// Activity feed reads contract event logs from
//   {MIRROR}/api/v1/contracts/{idOrEvmAddress}/results/logs
// and decodes them against the WaferVault event ABIs. KYC status, token supply,
// and deal history also come from the Mirror Node / decoded events.
//
// No mock mode: helpers read live and degrade to empty arrays / null on failure —
// nothing here throws.

import { decodeEventLog, getAddress, createPublicClient, http } from "viem";
import { ADDRESSES, MIRROR_NODE_URL, RPC_URL, VAULT_CONFIGURED } from "./config.js";
import { VAULT_ABI } from "./abi.js";

const LOGS_LIMIT = 100;

// Wallet-free read-only client over the Hedera EVM relay, so mirror helpers can
// read the contract before the user connects a wallet (landing page hero).
let _readClient = null;
function readClient() {
  if (!VAULT_CONFIGURED) return null;
  if (!_readClient) {
    _readClient = createPublicClient({ transport: http(RPC_URL, { retryCount: 2 }) });
  }
  return _readClient;
}

function ageFrom(log) {
  const blockTimestamp = log?.timestamp ? Number(log.timestamp.split(".")[0]) : null;
  return blockTimestamp ? Math.max(0, Math.floor(Date.now() / 1000) - blockTimestamp) : null;
}

// Map a decoded event to the normalized shape screens render. Returns null for
// events we don't surface (keeps the feed focused).
function normalizeEvent(decoded, log) {
  const { eventName, args } = decoded;
  const base = { type: eventName, ageSeconds: ageFrom(log), txHash: log?.transaction_hash ?? null, raw: args };
  switch (eventName) {
    case "Deposit":
      return { ...base, poolId: Number(args.poolId), account: args.investor, assets: args.assetsTinybar, shares: args.sharesMinted };
    case "Redeem":
      return { ...base, poolId: Number(args.poolId), account: args.investor, shares: args.sharesBurned, assets: args.assetsTinybar };
    case "ClaimFinanced":
      return { ...base, poolId: Number(args.poolId), claimId: Number(args.claimId), dealId: Number(args.dealId), account: args.operator, assets: args.advance };
    case "RewardRouted":
      return { ...base, claimId: Number(args.claimId), assets: args.amount };
    case "ClaimRepaid":
      return { ...base, claimId: Number(args.claimId) };
    case "ClaimDefaulted":
      return { ...base, claimId: Number(args.claimId), assets: args.loss };
    case "DealProposed":
      return { ...base, dealId: Number(args.dealId), account: args.operator, category: Number(args.category), assets: args.advance };
    case "DealApproved":
      return { ...base, dealId: Number(args.dealId), poolId: Number(args.poolId) };
    case "DealRejected":
      return { ...base, dealId: Number(args.dealId) };
    case "RedemptionQueued":
      return { ...base, poolId: Number(args.poolId), account: args.investor, requestId: Number(args.requestId), assets: args.assetsTinybar };
    case "RedemptionFilled":
      return { ...base, account: args.investor, requestId: Number(args.requestId), assets: args.assetsTinybar };
    case "KycGranted":
      return { ...base, poolId: Number(args.poolId), account: args.investor };
    case "KycRevoked":
      return { ...base, poolId: Number(args.poolId), account: args.investor };
    case "Paused":
      return { ...base, poolId: Number(args.poolId) };
    case "Frozen":
      return { ...base, poolId: Number(args.poolId), account: args.account };
    default:
      return null; // skip OwnershipTransferred, ActionQueued, etc. from the feed
  }
}

// Fetch + decode ALL the vault's recent events (raw decoded list, newest first).
// The activity screen filters this; other screens reuse it for deal/proposal
// metadata that lives in events (DealProposed full fields). Empty on failure.
let _logsCache = { at: 0, logs: [] };
export async function readVaultLogs({ force = false } = {}) {
  if (!VAULT_CONFIGURED) return [];
  if (!force && Date.now() - _logsCache.at < 4000) return _logsCache.logs;
  try {
    const url = `${MIRROR_NODE_URL}/api/v1/contracts/${ADDRESSES.vault}/results/logs?order=desc&limit=${LOGS_LIMIT}`;
    const r = await fetch(url);
    if (!r.ok) return _logsCache.logs;
    const data = await r.json();
    const logs = Array.isArray(data?.logs) ? data.logs : [];
    const out = [];
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({ abi: VAULT_ABI, data: log.data, topics: log.topics });
        const norm = normalizeEvent(decoded, log);
        if (norm) out.push(norm);
      } catch {
        // Unknown / non-Wafer log — skip.
      }
    }
    _logsCache = { at: Date.now(), logs: out };
    return out;
  } catch {
    return _logsCache.logs;
  }
}

// Activity feed: the full normalized event list (alias of readVaultLogs).
export async function readActivity() {
  return readVaultLogs();
}

// Off-chain deal display metadata lives in events (SPEC §4.2). Build a map
// dealId → { operator, category, advance, expected, term, detailsHash, age } from
// DealProposed logs, so the Pools/Operator/Admin screens can show human fields the
// on-chain Deal struct stores only as hashes.
export async function readDealMeta() {
  const logs = await readVaultLogs();
  const meta = {};
  for (const ev of logs) {
    if (ev.type !== "DealProposed" || ev.dealId == null) continue;
    if (meta[ev.dealId]) continue; // newest-first; keep first seen
    const a = ev.raw || {};
    meta[ev.dealId] = {
      dealId: ev.dealId,
      operator: a.operator,
      category: Number(a.category),
      advance: a.advance,
      expected: a.expected,
      term: a.term,
      detailsHash: a.detailsHash,
      deviceNft: a.deviceNft,
      deviceSerial: a.deviceSerial,
      ageSeconds: ev.ageSeconds,
    };
  }
  return meta;
}

// Read an HTS token's metadata (supply, decimals, name) from the Mirror Node.
export async function readTokenSupply(tokenIdOrAddr) {
  if (!tokenIdOrAddr) return null;
  try {
    const url = `${MIRROR_NODE_URL}/api/v1/tokens/${tokenIdOrAddr}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    return {
      tokenId: data?.token_id ?? null,
      name: data?.name ?? null,
      symbol: data?.symbol ?? null,
      decimals: data?.decimals != null ? Number(data.decimals) : null,
      totalSupply: data?.total_supply != null ? BigInt(data.total_supply) : null,
    };
  } catch {
    return null;
  }
}

// Read an account's KYC status for an HTS token from the Mirror Node token
// relationships endpoint. The contract is the source of truth (isKyced view); this
// is a fallback / surfacing path when the EVM read is unavailable. `account` is an
// EVM address; we resolve it to a Hedera account id via the accounts endpoint.
// Returns { associated, kycGranted } or null on failure.
export async function readTokenKycStatus(accountEvm, tokenIdOrAddr) {
  if (!accountEvm || !tokenIdOrAddr) return null;
  try {
    const acctRes = await fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${accountEvm}`);
    if (!acctRes.ok) return null;
    const acct = await acctRes.json();
    const accountId = acct?.account;
    if (!accountId) return null;
    const relRes = await fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${accountId}/tokens?token.id=${tokenIdOrAddr}`);
    if (!relRes.ok) return { associated: false, kycGranted: false };
    const rel = await relRes.json();
    const tokens = Array.isArray(rel?.tokens) ? rel.tokens : [];
    const match = tokens.find((t) => true); // single token query → 0 or 1 row
    if (!match) return { associated: false, kycGranted: false };
    return {
      associated: true,
      kycGranted: match.kyc_status === "GRANTED",
    };
  } catch {
    return null;
  }
}

// Aggregate TVL across pools for the landing page hero. Sums totalAssets(i) from
// the contract through a wallet-free read client. Returns whole-HBAR Numbers.
export async function readAggregateStats() {
  const client = readClient();
  if (!client) return { tvl: 0, shares: 0, ok: false };
  try {
    const count = Number(await client.readContract({
      address: ADDRESSES.vault, abi: VAULT_ABI, functionName: "poolCount",
    }));
    let totalAssets = 0n;
    let totalShares = 0n;
    for (let i = 0; i < count; i++) {
      const [ta, pool] = await Promise.all([
        client.readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: "totalAssets", args: [i] }),
        client.readContract({ address: ADDRESSES.vault, abi: VAULT_ABI, functionName: "pools", args: [i] }),
      ]);
      totalAssets += BigInt(ta);
      totalShares += BigInt(pool[6]); // totalShares
    }
    return {
      tvl: Number(totalAssets / 100_000_000n),
      shares: Number(totalShares / 100_000_000n),
      ok: true,
    };
  } catch {
    return { tvl: 0, shares: 0, ok: false };
  }
}

// Normalize an EVM address for HashScan account links, tolerating shorthand.
export function toChecksum(addr) {
  try {
    return getAddress(addr);
  } catch {
    return addr;
  }
}
