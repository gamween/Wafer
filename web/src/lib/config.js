// Wafer network + address config — Hedera Testnet (chain 296).
//
// Money rule: pool shares and pool accounting are 8-decimal integer units
// (tinybar / share micro-units), matching the WaferVault contract. Settlement is
// native HBAR — there is no ERC-20 settlement token. HBAR is 18 decimals EVM-side
// (weibar) for msg.value / gas; that boundary is handled in useContracts.js.
//
// NO mock mode at ship — the app reads live from the deployed VAULT_ADDRESS and
// degrades gracefully (empty lists, "—") when an address is unset or a read fails.
//
// ADDRESS AUTO-SYNC: every contract address below is sourced from the repo-root
// deployments/testnet.json (imported at build time — Vite/Rollup supports JSON
// import). A future redeploy that rewrites that file auto-propagates here with no
// code change. VITE_VAULT_ADDRESS (and the other VITE_* vars) still override.
import deployment from "../../../deployments/testnet.json";

export const CHAIN_ID = deployment?.chainId ?? 296;
export const CHAIN_NAME = "Hedera Testnet";

// Public Hedera EVM relay (JSON-RPC) and Mirror Node REST base.
export const RPC_URL =
  import.meta.env.VITE_RPC_URL || "https://testnet.hashio.io/api";
export const MIRROR_NODE_URL =
  import.meta.env.VITE_MIRROR_NODE_URL || "https://testnet.mirrornode.hedera.com";
export const EXPLORER_URL = "https://hashscan.io/testnet";

export const NATIVE_CURRENCY = { name: "HBAR", symbol: "HBAR", decimals: 18 };

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ---- Canonical deployment (deployments/testnet.json) ----
// Read straight from the deployment record so the front never drifts from chain.
const dep = deployment ?? {};
const pool0 = dep.pool ?? {};
const mocks = dep.mocks ?? {};
const secondary = dep.secondary ?? {};
const pairs = dep.secondaryPair ?? {};

function norm(addr, fallback) {
  const v = (addr || fallback || "").trim();
  return v ? v.toLowerCase() : "";
}

export const ADDRESSES = {
  // WaferVault EVM address — from deployments.json (vaultAddress); override with
  // VITE_VAULT_ADDRESS. Empty/unset = the app degrades to read-only "—".
  vault: norm(import.meta.env.VITE_VAULT_ADDRESS, dep.vaultAddress),
  // Default per-pool share token (pool 0). Normally read from pools(id).shareToken;
  // this is only the pre-read fallback. From pool.shareTokenEvm.
  shareToken: norm(import.meta.env.VITE_SHARE_TOKEN, pool0.shareTokenEvm),
  // Pool 0 claim NFT collection (the receipts). From pool.claimNftEvm.
  claimNft: norm(import.meta.env.VITE_CLAIM_NFT, pool0.claimNftEvm),
  // MockDeviceNFT collateral helper (operator portal escrow flow) + its collection.
  deviceNft: norm(import.meta.env.VITE_DEVICE_NFT, mocks.deviceNft?.evm),
  deviceCollection: norm(import.meta.env.VITE_DEVICE_COLLECTION, mocks.deviceNft?.collectionEvm),
  // MockRewardSource demo keeper.
  rewardSource: norm(import.meta.env.VITE_REWARD_SOURCE, mocks.rewardSource?.evm),
  // SaucerSwap V1 testnet (SPEC §10) — RouterV3, Factory, WHBAR token.
  saucerRouter: norm(import.meta.env.VITE_SAUCER_ROUTER, secondary.router),
  saucerFactory: norm(import.meta.env.VITE_SAUCER_FACTORY, secondary.factory),
  whbar: norm(import.meta.env.VITE_WHBAR, secondary.whbar),
};

// Per-pool live secondary-market pair addresses from deployments.json
// (secondaryPair[poolId].pair). These are the KYC-enabled, liquidity-seeded
// SaucerSwap V1 share/WHBAR pairs created via the admin enable-secondary flow.
// The vault's secondaryPair(poolId) view is still the runtime source of truth;
// this is the deploy-recorded fallback (and the seed for the Secondary screen).
export const SECONDARY_PAIRS = Object.fromEntries(
  Object.entries(pairs).map(([poolId, rec]) => [Number(poolId), norm(rec?.pair)]),
);

// Convenience: the recorded pair for a pool (lower-cased, "" if none recorded).
export function recordedPair(poolId) {
  return SECONDARY_PAIRS[Number(poolId)] || "";
}

// True when the app has a live vault address to talk to. When false, screens show
// a "configure VITE_VAULT_ADDRESS" notice instead of throwing.
export const VAULT_CONFIGURED = !!ADDRESSES.vault && ADDRESSES.vault !== ZERO_ADDRESS;

// ---- Taxonomy (matches the on-chain enums in WaferVault.sol) ----
// enum Category { GPU, Wireless, Mapping, Energy, Storage }
export const CATEGORIES = ["GPU", "Wireless", "Mapping", "Energy", "Storage"];
export const CATEGORY_LABEL = {
  0: "GPU / Compute",
  1: "Wireless",
  2: "Mapping",
  3: "Energy",
  4: "Storage",
};
// enum RiskClass { A, B, C }
export const RISK_CLASSES = ["A", "B", "C"];
// enum DealStatus { Proposed, Approved, Rejected, Financed, Repaid, Defaulted }
export const DEAL_STATUS = ["Proposed", "Approved", "Rejected", "Financed", "Repaid", "Defaulted"];
// enum ClaimStatus { Active, Repaid, Defaulted }
export const CLAIM_STATUS = ["Active", "Repaid", "Defaulted"];
// enum PoolStatus { Active, Paused }
export const POOL_STATUS = ["Active", "Paused"];

// Per-pool display logo (category → asset). On-chain category drives the rest.
export const CATEGORY_LOGO = {
  0: "/logos/gpu.png",       // GPU / Compute
  1: "/logos/wireless.png",  // Wireless
  2: "/logos/mapping.png",   // Mapping
  3: "/logos/energy.png",    // Energy
  4: "/logos/storage.png",   // Storage
};

// Build a conventional pool display name from category + class (e.g. "GPU-A").
export function poolDisplayName(categoryIdx, classIdx) {
  const cat = CATEGORIES[categoryIdx] ?? `CAT${categoryIdx}`;
  const cls = RISK_CLASSES[classIdx] ?? `${classIdx}`;
  const short = cat === "Wireless" ? "WIFI" : cat.toUpperCase();
  return `${short}-${cls}`;
}
