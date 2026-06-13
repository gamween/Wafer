import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Persistence for the public ids created by `pnpm bootstrap`.
 *
 * Two sinks, kept in sync:
 *  - `deployments/testnet.json` — committed, so a clean clone knows the live pool.
 *  - `.env` — gitignored, so the running backend/scripts pick the ids up at runtime.
 *
 * Only **public ids** (tokens, topic, accounts) are written. Secret keys are never touched
 * by the JSON writer and never logged. The `.env` updater rewrites only the id lines and
 * leaves secret lines (OPERATOR_KEY, DEMO_INVESTOR_KEY) byte-for-byte intact.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
export const DEPLOYMENTS_PATH = resolve(REPO_ROOT, "deployments", "testnet.json");
const ENV_PATH = resolve(REPO_ROOT, ".env");

export interface Deployment {
  network: string;
  createdAt: string;
  updatedAt: string;
  operatorId: string;
  vaultId: string;
  /** settlement token: real Circle USDC (0.0.429274) or a freshly-minted mock. */
  usdcTokenId: string;
  usdcIsMock: boolean;
  shareTokenId: string;
  claimNftTokenId: string;
  navTopicId: string;
  demoInvestorId: string;
  pool: { id: string; name: string; symbol: string };
  hashscan: Record<string, string>;
}

const HASHSCAN = "https://hashscan.io/testnet";
export const hashscanToken = (id: string) => `${HASHSCAN}/token/${id}`;
export const hashscanTopic = (id: string) => `${HASHSCAN}/topic/${id}`;
export const hashscanAccount = (id: string) => `${HASHSCAN}/account/${id}`;
/** Accepts an SDK TransactionId string (`0.0.x@sec.nanos`) and links the HashScan tx page. */
export const hashscanTx = (txId: string) => {
  const norm = txId.replace("@", "-").replace(/\.(\d+)$/, "-$1");
  return `${HASHSCAN}/transaction/${norm}`;
};

export function loadDeployment(): Partial<Deployment> {
  if (!existsSync(DEPLOYMENTS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(DEPLOYMENTS_PATH, "utf8")) as Deployment;
  } catch {
    return {};
  }
}

export function saveDeployment(d: Deployment): void {
  mkdirSync(dirname(DEPLOYMENTS_PATH), { recursive: true });
  writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(d, null, 2) + "\n");
}

/**
 * Rewrite specific KEY=value lines in `.env`, preserving comments, ordering, and every other
 * line (including secrets) exactly. Adds the key if it isn't present. Never logs values.
 */
export function updateEnv(updates: Record<string, string>): void {
  if (!existsSync(ENV_PATH)) return; // never create a .env from scratch — secrets must pre-exist
  const lines = readFileSync(ENV_PATH, "utf8").split("\n");
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const m = line.match(/^(\s*)([A-Z0-9_]+)=/);
    if (m && updates[m[2]] !== undefined) {
      seen.add(m[2]);
      return `${m[1]}${m[2]}=${updates[m[2]]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  writeFileSync(ENV_PATH, out.join("\n"));
}
