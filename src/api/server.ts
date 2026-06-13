import Fastify from "fastify";
import cors from "@fastify/cors";
import { AccountId, PrivateKey, TokenId } from "@hashgraph/sdk";
import { config } from "../config.js";
import { VaultService } from "../vault/vault-service.js";
import { POOL_DEFINITIONS, MVP_POOL_ID } from "../vault/pool.js";
import type { Pool } from "../vault/types.js";

/**
 * Thin HTTP surface over the VaultService (SPEC.md §8). For the MVP it serves the single
 * GPU-A pool; the share token + topic ids come from the environment (set by `pnpm bootstrap`).
 *
 * NOTE: investor keys are passed in requests here only for the hackathon demo. In the real
 * flow the investor signs in their own wallet (Privy embedded wallet) and the API receives a
 * signed transaction, never a raw key.
 */

function loadMvpPool(): Pool {
  const def = POOL_DEFINITIONS.find((p) => p.id === MVP_POOL_ID)!;
  if (!config.shareTokenId || !config.navTopicId) {
    throw new Error("SHARE_TOKEN_ID / NAV_TOPIC_ID not set — run `pnpm bootstrap` and fill .env");
  }
  return { ...def, shareTokenId: config.shareTokenId, topicId: config.navTopicId };
}

async function main() {
  const pool = loadMvpPool();
  const vault = new VaultService(
    pool,
    AccountId.fromString(config.vaultId),
    TokenId.fromString(config.usdcTokenId),
    TokenId.fromString(config.claimNftTokenId),
  );

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get("/pools", async () => [{ ...pool, nav: await vault.currentNav() }]);
  app.get("/pools/:id/nav", async () => vault.currentNav());

  app.post("/claims", async (req) => {
    const b = req.body as { operatorId: string; advance: string; expected: string; termDays: number };
    return vault.financeClaim({
      operatorId: AccountId.fromString(b.operatorId),
      advance: BigInt(b.advance),
      expected: BigInt(b.expected),
      termDays: b.termDays,
    });
  });

  app.post("/pools/:id/deposit", async (req) => {
    const b = req.body as { investorId: string; investorKey: string; usdcAmount: string };
    return vault.deposit({
      investor: AccountId.fromString(b.investorId),
      investorKey: PrivateKey.fromStringDer(b.investorKey),
      usdcAmount: BigInt(b.usdcAmount),
    });
  });

  app.post("/pools/:id/redeem", async (req) => {
    const b = req.body as { investorId: string; investorKey: string; shares: string };
    return vault.redeem({
      investor: AccountId.fromString(b.investorId),
      investorKey: PrivateKey.fromStringDer(b.investorKey),
      shareAmount: BigInt(b.shares),
    });
  });

  app.post("/claims/:serial/settle", async (req) => {
    const serial = Number((req.params as { serial: string }).serial);
    const b = req.body as { operatorId: string; operatorKey: string; usdcAmount: string };
    await vault.settleRewards({
      serial,
      operator: AccountId.fromString(b.operatorId),
      operatorKey: PrivateKey.fromStringDer(b.operatorKey),
      usdcAmount: BigInt(b.usdcAmount),
    });
    return { ok: true };
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
