import type { Pool } from "./types.js";

/**
 * Pools are standardized by NETWORK + RISK only (not maturity — a permanent vault must not be
 * fragmented by claim maturity; that only splits liquidity). See SPEC.md §2.
 *
 * Token/topic ids are filled in by `pnpm bootstrap` and loaded from the environment at runtime.
 * This registry is the static definition of which pools exist for the MVP demo.
 */
export const POOL_DEFINITIONS: Omit<Pool, "shareTokenId" | "topicId">[] = [
  { id: "GPU-A", network: "GPU", risk: "A", name: "Sluice GPU-A Pool Share", symbol: "slGPUA" },
  { id: "WIFI-B", network: "WIFI", risk: "B", name: "Sluice WIFI-B Pool Share", symbol: "slWIFIB" },
  { id: "ENERGY-A", network: "ENERGY", risk: "A", name: "Sluice ENERGY-A Pool Share", symbol: "slENGA" },
];

/** MVP demo runs a single pool; expand once GPU-A is solid. */
export const MVP_POOL_ID = "GPU-A";
