/**
 * Resolve OPERATOR_ID (0.0.x) from OPERATOR_KEY by deriving the EVM address and looking it up
 * on the Mirror Node. Also reports HBAR + USDC balance so we can confirm the account is funded.
 *   pnpm tsx scripts/resolve-operator.ts
 */
import "dotenv/config";
import { PrivateKey } from "@hashgraph/sdk";

const keyStr = (process.env.OPERATOR_KEY ?? "").trim();
const mirror = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com/api/v1";
const usdc = process.env.USDC_TOKEN_ID ?? "0.0.429274";

if (!keyStr) throw new Error("OPERATOR_KEY missing in .env");

let key: PrivateKey;
try {
  key = PrivateKey.fromStringECDSA(keyStr);
} catch {
  key = PrivateKey.fromStringED25519(keyStr); // fallback
}

const evm = "0x" + key.publicKey.toEvmAddress();
console.log("EVM address :", evm);

const res = await fetch(`${mirror}/accounts/${evm}`);
if (!res.ok) {
  console.error(`Mirror lookup failed (${res.status}). Account may not be created/funded yet.`);
  process.exit(1);
}
const data: any = await res.json();
const accountId = data.account;
const hbarTinybar = Number(data.balance?.balance ?? 0);
const tokens: any[] = data.balance?.tokens ?? [];
const usdcRow = tokens.find((t) => t.token_id === usdc);

console.log("OPERATOR_ID :", accountId);
console.log("HBAR        :", (hbarTinybar / 1e8).toFixed(4), "ℏ");
console.log("USDC assoc. :", usdcRow ? `yes (${(Number(usdcRow.balance) / 1e6).toFixed(2)} USDC)` : "NO — associate + fund USDC");
console.log("\nRESOLVED_OPERATOR_ID=" + accountId);
