/** Domain types. Money is integer micro-units (6 dp) everywhere — never floats for value. */

export type RiskClass = "A" | "B";
export type Network = "GPU" | "WIFI" | "ENERGY" | "MAPPING";

/** A pool = one HTS share token + one vault account + one HCS topic, by network + risk. */
export interface Pool {
  id: string; // e.g. "GPU-A"
  network: Network;
  risk: RiskClass;
  name: string; // "Wafer GPU-A Pool Share"
  symbol: string; // "wfGPUA"
  shareTokenId: string;
  topicId: string;
}

export type ClaimStatus = "active" | "settled" | "defaulted";

/** A financed reward claim, represented on-chain by one NFT serial held in the vault. */
export interface Claim {
  serial: number;
  poolId: string;
  operatorId: string;
  advance: bigint; // USDC advanced now
  expected: bigint; // USDC of rewards expected over the term
  termDays: number;
  financedAt: number; // unix seconds
  rewardsReceived: bigint; // running total swept in
  status: ClaimStatus;
}

export interface NavSnapshot {
  poolId: string;
  navPerShare: number; // USDC per share (display); compute in fixed-point internally
  totalPoolValue: bigint; // micro-USDC
  sharesOutstanding: bigint; // micro-shares
  activeClaims: number;
  ts: number;
}

/** HCS event log entries (kept compact, < 1024 bytes). `t` = type. */
export type LedgerEvent =
  | { t: "NAV"; pool: string; ts: number; nav: number; tpv: string; shares: string; claims: number }
  | { t: "CLAIM_FINANCED"; pool: string; ts: number; serial: number; op: string; advance: string; expected: string; term: number }
  | { t: "DEPOSIT"; pool: string; ts: number; investor: string; usdc: string; shares: string; nav: number }
  | { t: "REDEEM"; pool: string; ts: number; investor: string; shares: string; usdc: string; nav: number }
  | { t: "REWARD_SWEEP"; pool: string; ts: number; serial: number; usdc: string }
  | { t: "CLAIM_SETTLED"; pool: string; ts: number; serial: number }
  | { t: "CLAIM_DEFAULTED"; pool: string; ts: number; serial: number; loss: string };
