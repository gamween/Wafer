import { config } from "../config.js";
import type { LedgerEvent } from "../vault/types.js";

/**
 * Mirror Node REST read layer (SPEC.md §6). The frontend uses these to recompute NAV/TVL
 * independently of the backend — the whole point of publishing state on-chain.
 * Node 22 has global fetch.
 */
const BASE = config.mirrorNodeUrl;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`mirror ${path} -> ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** NAV + lifecycle history from the pool's HCS topic (messages are base64-encoded JSON). */
export async function getTopicEvents(topicId: string, limit = 100): Promise<LedgerEvent[]> {
  const data = await get<{ messages: { message: string; consensus_timestamp: string }[] }>(
    `/topics/${topicId}/messages?limit=${limit}&order=desc`,
  );
  return data.messages.map((m) => JSON.parse(Buffer.from(m.message, "base64").toString("utf8")) as LedgerEvent);
}

/** Token balances for an account (e.g. the vault's USDC + share holdings). */
export async function getAccountTokens(accountId: string): Promise<{ token_id: string; balance: number }[]> {
  const data = await get<{ tokens: { token_id: string; balance: number }[] }>(`/accounts/${accountId}/tokens`);
  return data.tokens;
}

/** Shares outstanding (total supply) for the pool share token. */
export async function getTokenSupply(tokenId: string): Promise<bigint> {
  const data = await get<{ total_supply: string }>(`/tokens/${tokenId}`);
  return BigInt(data.total_supply);
}

/** Holders of the pool share token. */
export async function getTokenHolders(tokenId: string): Promise<{ account: string; balance: number }[]> {
  const data = await get<{ balances: { account: string; balance: number }[] }>(`/tokens/${tokenId}/balances`);
  return data.balances;
}

/** Claim NFTs currently held by the vault account. */
export async function getVaultClaims(claimTokenId: string, vaultId: string): Promise<{ serial_number: number; metadata: string }[]> {
  const data = await get<{ nfts: { serial_number: number; metadata: string }[] }>(
    `/tokens/${claimTokenId}/nfts?account.id=${vaultId}`,
  );
  return data.nfts;
}
