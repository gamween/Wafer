/**
 * Hour-0 setup. Creates the on-chain resources for the MVP pool (GPU-A) and prints the ids to
 * paste into .env. Idempotent-ish: re-running creates NEW resources, so run once and save.
 *
 *   pnpm bootstrap
 *
 * Then copy SHARE_TOKEN_ID / CLAIM_NFT_TOKEN_ID / NAV_TOPIC_ID into .env.
 */
import { AccountId, TokenAssociateTransaction, TokenId } from "@hashgraph/sdk";
import { client, operatorKey, shutdown } from "../src/hedera/client.js";
import { createPoolShareToken, createClaimCollection } from "../src/hedera/tokens.js";
import { createNavTopic } from "../src/hedera/topic.js";
import { config } from "../src/config.js";
import { POOL_DEFINITIONS, MVP_POOL_ID } from "../src/vault/pool.js";

async function ensureUsdcAssociated(vault: AccountId) {
  try {
    const tx = await new TokenAssociateTransaction()
      .setAccountId(vault)
      .setTokenIds([TokenId.fromString(config.usdcTokenId)])
      .freezeWith(client)
      .sign(operatorKey);
    await (await tx.execute(client)).getReceipt(client);
    console.log(`✓ vault associated USDC ${config.usdcTokenId}`);
  } catch (e) {
    console.log(`• USDC association skipped (already associated, or: ${(e as Error).message})`);
  }
}

async function main() {
  const def = POOL_DEFINITIONS.find((p) => p.id === MVP_POOL_ID)!;
  const vault = AccountId.fromString(config.vaultId);

  console.log(`Bootstrapping pool ${def.id} on ${config.network}…\n`);

  await ensureUsdcAssociated(vault);

  const shareTokenId = await createPoolShareToken(client, { name: def.name, symbol: def.symbol });
  console.log(`✓ pool-share token  SHARE_TOKEN_ID=${shareTokenId.toString()}`);

  const claimNftId = await createClaimCollection(client, {
    name: "Wafer Reward Claim",
    symbol: "wfCLAIM",
    treasury: vault,
  });
  console.log(`✓ claim NFT coll.   CLAIM_NFT_TOKEN_ID=${claimNftId.toString()}`);

  const topicId = await createNavTopic(client, `Wafer ${def.id} NAV + lifecycle`);
  console.log(`✓ HCS topic         NAV_TOPIC_ID=${topicId.toString()}`);

  console.log(`\nPaste into .env:`);
  console.log(`SHARE_TOKEN_ID=${shareTokenId.toString()}`);
  console.log(`CLAIM_NFT_TOKEN_ID=${claimNftId.toString()}`);
  console.log(`NAV_TOPIC_ID=${topicId.toString()}`);

  shutdown();
}

main().catch((err) => {
  console.error(err);
  shutdown();
  process.exit(1);
});
