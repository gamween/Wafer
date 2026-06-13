import { Client, AccountId, PrivateKey } from "@hashgraph/sdk";
import { config } from "../config.js";
import { parsePrivateKey } from "./keys.js";

/**
 * A single shared Hedera Client authenticated as the protocol operator.
 *
 * The operator account is the treasury + supply/KYC authority for the MVP. In a hardened
 * deployment the supply/KYC/admin keys would sit behind a threshold key (KeyList) — see
 * SPEC.md §7. `operatorKey` is exported so callers can co-sign transactions that require it.
 *
 * The operator key is a raw-hex ECDSA key; `parsePrivateKey` tries ECDSA first then falls
 * back to ED25519/DER so the same code works regardless of how the key was exported.
 */
export const operatorId = AccountId.fromString(config.operatorId);
export const operatorKey: PrivateKey = parsePrivateKey(config.operatorKey);

export const client: Client = (
  config.network === "mainnet" ? Client.forMainnet() : Client.forTestnet()
).setOperator(operatorId, operatorKey);

export function shutdown(): void {
  client.close();
}
