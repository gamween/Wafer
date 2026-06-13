import { TokenId, AccountId, PrivateKey } from "@hashgraph/sdk";
import { client } from "../hedera/client.js";
import { config } from "../config.js";
import { mintShares, burnShares, mintClaimNft } from "../hedera/tokens.js";
import { publishEvent } from "../hedera/topic.js";
import {
  buildDeposit,
  buildRedeem,
  buildAdvance,
  buildRewardSweep,
  execTransfer,
} from "../hedera/transfers.js";
import { getAccountTokens, getTokenSupply } from "../hedera/mirror.js";
import { computeNav, sharesForDeposit, usdcForRedeem } from "./nav.js";
import type { Claim, NavSnapshot, Pool } from "./types.js";

/**
 * Orchestrates the vault: it is the "no-Solidity contract". All logic lives here in TypeScript;
 * every state transition is evidenced on-ledger (HTS tx + HCS event) and reconcilable via the
 * Mirror Node. SPEC.md §4 + §7.
 *
 * Claim state is held in-memory for the MVP (swap for SQLite/Postgres post-hackathon); the
 * authoritative facts (balances, supply, events) are always on-chain.
 */
export class VaultService {
  private claims = new Map<number, Claim>();

  constructor(
    private readonly pool: Pool,
    private readonly vaultId: AccountId,
    private readonly usdcId: TokenId,
    private readonly claimNftId: TokenId,
  ) {}

  // --- reads ---------------------------------------------------------------

  async currentNav(): Promise<NavSnapshot> {
    const [tokens, supply] = await Promise.all([
      getAccountTokens(this.vaultId.toString()),
      getTokenSupply(this.pool.shareTokenId),
    ]);
    const usdcRow = tokens.find((t) => t.token_id === this.usdcId.toString());
    const idleUsdc = BigInt(usdcRow?.balance ?? 0);
    return computeNav({
      poolId: this.pool.id,
      idleUsdc,
      claims: [...this.claims.values()],
      sharesOutstanding: supply,
      nowSec: Math.floor(Date.now() / 1000),
    });
  }

  // --- writes --------------------------------------------------------------

  /** Finance a claim: mint the NFT to the vault and advance USDC to the operator. */
  async financeClaim(p: { operatorId: AccountId; advance: bigint; expected: bigint; termDays: number }): Promise<Claim> {
    // store mutable detail off the NFT (status changes over time); pointer goes on-chain
    const meta = `wafer://${this.pool.id}/claim`; // TODO: HCS-1 / IPFS pointer to full JSON
    const serial = await mintClaimNft(client, this.claimNftId, meta);

    await execTransfer(
      client,
      buildAdvance({ usdcId: this.usdcId, vault: this.vaultId, operator: p.operatorId, usdcAmount: p.advance }),
    );

    const claim: Claim = {
      serial,
      poolId: this.pool.id,
      operatorId: p.operatorId.toString(),
      advance: p.advance,
      expected: p.expected,
      termDays: p.termDays,
      financedAt: Math.floor(Date.now() / 1000),
      rewardsReceived: 0n,
      status: "active",
    };
    this.claims.set(serial, claim);

    await this.emit({ t: "CLAIM_FINANCED", pool: this.pool.id, ts: claim.financedAt, serial, op: claim.operatorId, advance: p.advance.toString(), expected: p.expected.toString(), term: p.termDays });
    await this.publishNav();
    return claim;
  }

  /** Investor deposits USDC, receives freshly-minted shares at current NAV (atomic). */
  async deposit(p: { investor: AccountId; investorKey: PrivateKey; usdcAmount: bigint }): Promise<{ shares: bigint; nav: number }> {
    const nav = await this.currentNav();
    const shares = sharesForDeposit(p.usdcAmount, nav);

    await mintShares(client, TokenId.fromString(this.pool.shareTokenId), shares);
    await execTransfer(
      client,
      buildDeposit({
        usdcId: this.usdcId,
        shareId: TokenId.fromString(this.pool.shareTokenId),
        investor: p.investor,
        vault: this.vaultId,
        usdcAmount: p.usdcAmount,
        shareAmount: shares,
      }),
      [p.investorKey], // investor authorizes the USDC debit
    );

    await this.emit({ t: "DEPOSIT", pool: this.pool.id, ts: now(), investor: p.investor.toString(), usdc: p.usdcAmount.toString(), shares: shares.toString(), nav: nav.navPerShare });
    await this.publishNav();
    return { shares, nav: nav.navPerShare };
  }

  /** Investor redeems shares for USDC at current NAV (atomic), then shares are burned. */
  async redeem(p: { investor: AccountId; investorKey: PrivateKey; shareAmount: bigint }): Promise<{ usdc: bigint; nav: number }> {
    const nav = await this.currentNav();
    const usdc = usdcForRedeem(p.shareAmount, nav);

    await execTransfer(
      client,
      buildRedeem({
        usdcId: this.usdcId,
        shareId: TokenId.fromString(this.pool.shareTokenId),
        investor: p.investor,
        vault: this.vaultId,
        shareAmount: p.shareAmount,
        usdcAmount: usdc,
      }),
      [p.investorKey],
    );
    await burnShares(client, TokenId.fromString(this.pool.shareTokenId), p.shareAmount);

    await this.emit({ t: "REDEEM", pool: this.pool.id, ts: now(), investor: p.investor.toString(), shares: p.shareAmount.toString(), usdc: usdc.toString(), nav: nav.navPerShare });
    await this.publishNav();
    return { usdc, nav: nav.navPerShare };
  }

  /** Operator routes reward USDC into the vault; settles the claim once fully repaid. */
  async settleRewards(p: { serial: number; operator: AccountId; operatorKey: PrivateKey; usdcAmount: bigint }): Promise<void> {
    const claim = this.claims.get(p.serial);
    if (!claim) throw new Error(`unknown claim serial ${p.serial}`);

    await execTransfer(
      client,
      buildRewardSweep({ usdcId: this.usdcId, operator: p.operator, vault: this.vaultId, usdcAmount: p.usdcAmount }),
      [p.operatorKey],
    );
    claim.rewardsReceived += p.usdcAmount;
    await this.emit({ t: "REWARD_SWEEP", pool: this.pool.id, ts: now(), serial: p.serial, usdc: p.usdcAmount.toString() });

    if (claim.rewardsReceived >= claim.expected) {
      claim.status = "settled";
      await this.emit({ t: "CLAIM_SETTLED", pool: this.pool.id, ts: now(), serial: p.serial });
    }
    await this.publishNav();
  }

  // --- internals -----------------------------------------------------------

  private async publishNav(): Promise<void> {
    const nav = await this.currentNav();
    await this.emit({ t: "NAV", pool: this.pool.id, ts: nav.ts, nav: nav.navPerShare, tpv: nav.totalPoolValue.toString(), shares: nav.sharesOutstanding.toString(), claims: nav.activeClaims });
  }

  private async emit(event: Parameters<typeof publishEvent>[2]): Promise<void> {
    await publishEvent(client, TopicIdString(this.pool.topicId), event);
  }
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

// small helper to keep imports tidy
import { TopicId } from "@hashgraph/sdk";
function TopicIdString(id: string): TopicId {
  return TopicId.fromString(id);
}
