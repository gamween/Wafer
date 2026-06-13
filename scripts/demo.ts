/**
 * Scripted end-to-end demo for judging (SPEC.md §4). Requires `pnpm bootstrap` first and the
 * ids in .env. Uses the operator as a stand-in operator/investor for a self-contained run —
 * for the real demo, split into distinct accounts (and an investor via Privy).
 *
 *   pnpm demo
 *
 * Story: finance a GPU claim -> investor deposits -> rewards stream in -> NAV ticks up ->
 *        investor redeems at NAV. Watch the NAV rise live; every step lands on the HCS topic.
 */
import { AccountId, TokenId } from "@hashgraph/sdk";
import { client, operatorId, operatorKey, shutdown } from "../src/hedera/client.js";
import { config, ONE_USDC } from "../src/config.js";
import { VaultService } from "../src/vault/vault-service.js";
import { POOL_DEFINITIONS, MVP_POOL_ID } from "../src/vault/pool.js";

async function main() {
  const def = POOL_DEFINITIONS.find((p) => p.id === MVP_POOL_ID)!;
  const pool = { ...def, shareTokenId: config.shareTokenId, topicId: config.navTopicId };
  const vault = new VaultService(
    pool,
    AccountId.fromString(config.vaultId),
    TokenId.fromString(config.usdcTokenId),
    TokenId.fromString(config.claimNftTokenId),
  );

  const log = (label: string, nav: { navPerShare: number; activeClaims: number }) =>
    console.log(`  ${label.padEnd(24)} NAV=${nav.navPerShare.toFixed(6)}  active claims=${nav.activeClaims}`);

  console.log(`\n=== Wafer demo · pool ${def.id} ===\n`);

  log("genesis", await vault.currentNav());

  // 1. finance a claim: advance 9 USDC against 10 USDC expected over 90 days
  const claim = await vault.financeClaim({
    operatorId,
    advance: 9n * ONE_USDC,
    expected: 10n * ONE_USDC,
    termDays: 90,
  });
  console.log(`\n  financed claim #${claim.serial}: advance 9 / expected 10 USDC`);
  log("after finance", await vault.currentNav());

  // 2. investor deposits 10 USDC (operator stands in as investor here)
  await vault.deposit({ investor: operatorId, investorKey: operatorKey, usdcAmount: 10n * ONE_USDC });
  log("after deposit 10 USDC", await vault.currentNav());

  // 3. rewards stream in over the term (here: two sweeps of 5 USDC)
  await vault.settleRewards({ serial: claim.serial, operator: operatorId, operatorKey, usdcAmount: 5n * ONE_USDC });
  log("after reward sweep 5", await vault.currentNav());
  await vault.settleRewards({ serial: claim.serial, operator: operatorId, operatorKey, usdcAmount: 5n * ONE_USDC });
  log("after reward sweep 5", await vault.currentNav());

  console.log(`\n→ NAV rose as rewards landed; claim #${claim.serial} settled. Every step is on the HCS topic.`);
  console.log(`  Mirror Node: ${config.mirrorNodeUrl}/topics/${config.navTopicId}/messages\n`);

  shutdown();
}

main().catch((err) => {
  console.error(err);
  shutdown();
  process.exit(1);
});
