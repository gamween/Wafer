# Wafer — Technical Specification

Status: hackathon MVP (ETHGlobal NY 2026). Network: Hedera Testnet. Language: TypeScript.
No Solidity. All settlement in on-chain USDC.

---

## 1. Problem & product

DePIN operators must spend on hardware today (GPUs, wireless hotspots, mapping rigs, energy
devices) but earn their rewards on-chain over weeks/months. That timing gap is a financing
problem — "InfraFi". Wafer closes it:

- An operator sells a slice of its **future on-chain rewards** for upfront USDC.
- Investors buy a fungible **pool share** giving exposure to a basket of reward streams,
  standardized by network + risk class, tradable / redeemable at any time.
- The pool is a **permanent vault**: settled claims are replaced by new ones; the share is a
  continuously-appreciating NAV unit (like a money-market fund share / aUSDC), **not** a
  zero-coupon that converges to a fixed value on a date.

Yield source = the discount between the advance and the rewards actually collected.

## 2. Domain model

| Entity | On-chain representation | Notes |
|---|---|---|
| **Reward claim** | HTS NFT (one serial) held by the pool vault account | The protocol's internal ledger of what backs the pool. Never sent to investors. |
| **Pool** | One HTS fungible token (the share) + one vault account + one HCS topic | Permanent. Standardized by network + risk: `GPU-A`, `WIFI-B`, `ENERGY-A`. |
| **Pool share** | HTS fungible token, 6 decimals, KYC-gated, with a low fractional fee | A NAV-appreciating claim on the vault. Minted on deposit, burned on redeem. |
| **USDC** | Native HTS token `0.0.429274` (testnet), 6 decimals | Settlement + redemption asset. |
| **NAV + events** | HCS topic messages | Tamper-evident, timestamped state-transition log; read via Mirror Node. |

Pools are **network + risk** only. Maturity is a property of each *claim* (the NFT term), not
a pool axis — bucketing pools by maturity would only fragment liquidity in a permanent vault.
(Duration-tiered products are a V2 strategy axis, not MVP.)

## 3. Hedera resource design

### 3.1 Pool-share fungible token (`TokenCreateTransaction`)

```
type:           FungibleCommon
decimals:       6                 # mirror USDC for clean NAV fixed-point math
initialSupply:  0                 # mint on deposit, not at creation
supplyType:     Infinite          # permanent vault, continuous mint/burn
treasury:       operator account
supplyKey:      threshold key     # backend signs mint/burn
kycKey:         threshold key     # gate who can hold/receive shares (compliance)
freezeKey:      threshold key     # freeze a compromised holder
adminKey:       threshold key     # demo-time mutability
customFees:     [ CustomFractionalFee 0.10% , collector = treasury, exempt = treasury ]
```

Shares appreciate because NAV = vault value / shares outstanding rises as rewards flow in —
**not** because supply changes. Keep the fractional fee tiny (≤ ~10 bps): it hits every
secondary-market trade, so a high rate kills liquidity. Exempt the treasury so internal
mint-route transfers aren't taxed.

### 3.2 Reward-claim NFT collection (`TokenCreateTransaction` NON_FUNGIBLE_UNIQUE)

```
type:        NonFungibleUnique
supplyType:  Infinite
treasury:    vault account (holds all claim NFTs)
supplyKey:   threshold key
```

**Metadata is capped at 100 bytes per serial and is immutable.** Put only a pointer
(URI or hash) in `setMetadata`; store the JSON (network, expectedRewards, term, riskScore)
off-chain (HCS-1 topic message / IPFS / HFS). **Mutable status** (`active → settled →
defaulted`) must NOT live in NFT metadata — track it via HCS lifecycle events keyed by the
NFT serial.

### 3.3 KYC-gated transfer (the Tokenization track's literal example)

With a KYC key set, no account can send/receive the share until granted KYC:

1. `TokenAssociateTransaction(account, [shareId])`
2. `TokenGrantKycTransaction(account, shareId)` signed by the KYC key
3. Transfers to/from the account now succeed. A non-KYC'd leg fails with
   `ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN` and the whole atomic transfer reverts.

`TokenRevokeKycTransaction` blocks a holder on demand. This is a ledger-layer whitelist, not
app-code — a clean compliance demo.

### 3.4 HCS topic (`TopicCreateTransaction`)

One topic per pool with a `submitKey` (private: only the protocol writes). Publish a compact
JSON message (≤ 1024 bytes = single chunk) on every NAV recompute and lifecycle event.

## 4. Vault operations (state machine)

All money movement uses a single atomic `TransferTransaction` whose legs net to zero per
token — both sides commit or revert together, so no escrow contract is needed.

| Operation | Effect | Atomic transfer legs | HCS event |
|---|---|---|---|
| `financeClaim(pool, operator, advance, expected, term)` | Mint claim NFT to vault; advance USDC to operator | `usdc: vault → operator (advance)` | `CLAIM_FINANCED {serial, advance, expected, term}` |
| `deposit(pool, investor, usdc)` | Mint `usdc/NAV` shares, deliver to investor | `usdc: investor → vault`, `share: vault → investor` | `DEPOSIT {investor, usdc, shares, nav}` |
| `redeem(pool, investor, shares)` | Burn shares, pay `shares × NAV` USDC | `share: investor → vault`, `usdc: vault → investor` | `REDEEM {investor, shares, usdc, nav}` |
| `settleRewards(pool, serial, usdc)` | Operator routes reward USDC into vault | `usdc: operator → vault` | `REWARD_SWEEP {serial, usdc}` then `CLAIM_SETTLED` at term |
| `markDefault(pool, serial)` | Write down a claim | none | `CLAIM_DEFAULTED {serial, loss}` |

Preconditions on every share/USDC leg: the counterparty account must have **associated** the
token and (for the share) been **granted KYC**, else the transfer reverts.

Optional: wrap `settleRewards` in a **Scheduled Transaction** (`ScheduleCreateTransaction`,
`setWaitForExpiry(true)`) for "set-and-forget" reward sweeps — a third native service for the
No-Solidity track. Max expiry is **62 days** (HIP-423), so the backend re-creates the next
schedule each cycle; state that as a design choice, not a gap.

## 5. NAV model (amortized cost)

A pool's NAV per share:

```
navPerShare = totalPoolValue / sharesOutstanding          (1.0 at genesis)

totalPoolValue = idleUsdc(vault, pool)
               + Σ carryingValue(claim)   for each outstanding claim

carryingValue(claim, now) =
    advance + (expected − advance) × min(1, elapsed / term)   # accretes advance → expected
    − rewardsAlreadyReceived(claim)                           # avoid double counting
    (defaulted claim → written down to recovered value)
```

Intuition: the discount accretes linearly over the claim term, so carrying value (and NAV)
rises continuously; as actual reward USDC arrives it replaces the accrued receivable with
cash. At settlement, carrying = expected = cash received. This is standard fund accounting
(amortized cost) and avoids instant NAV jumps when new claims are bought at a discount.

NAV is recomputed on every state change and on a heartbeat, then published to HCS. The
frontend can recompute it independently from Mirror Node data — the point of publishing it.

## 6. Read layer (Mirror Node REST)

Base: `https://testnet.mirrornode.hedera.com/api/v1`

| Need | Endpoint |
|---|---|
| NAV / event history | `GET /topics/{topicId}/messages` (base64-decode the JSON) |
| Pool TVL (USDC + share balances) | `GET /accounts/{vaultId}/tokens` |
| Shares outstanding / holders | `GET /tokens/{shareTokenId}` , `GET /tokens/{shareTokenId}/balances` |
| Claim NFTs in vault | `GET /tokens/{claimTokenId}/nfts?account.id={vaultId}` |

## 7. Trust model

There is no on-ledger contract; the operator account holds the treasury + supply/KYC keys.
This is **trust-minimized and audited-by-design, not trustless** — and we say so:

1. Every state transition (mint, burn, NAV, settlement) is published to HCS and reflected in
   Mirror Node. Any deviation between published NAV and on-ledger balances is publicly
   detectable in real time; the frontend recomputes NAV independently of the backend.
2. Keys are held behind a Hedera **threshold key (multi-sig)** (`KeyList` / threshold) so no
   single team member can act unilaterally — pure SDK, no contract.
3. Mainnet hardening path (explicit, scoped): move keys to MPC / multi-party custody, or
   migrate vault authority to an audited contract. The HTS tokens and HCS audit trail are
   unchanged either way. All-USDC on-chain settlement already removes the biggest off-chain
   trust vector (no fiat bridge).

Pitch line: *"Wafer is HTS-native and verifiable-by-construction: the operator orchestrates,
but the Hashgraph is the source of truth."*

## 8. API surface (backend)

```
GET  /pools                      list pools + current NAV + TVL
GET  /pools/:id/nav              NAV history (from HCS via Mirror Node)
POST /pools/:id/deposit          { investorId, usdcAmount }     → shares minted
POST /pools/:id/redeem           { investorId, shares }         → usdc paid at NAV
POST /claims                     { poolId, operatorId, advance, expected, termDays } → serial
POST /claims/:serial/settle      { usdcAmount }                 → reward swept, NAV updated
POST /investors/:id/kyc          associate + grant KYC for a pool share
```

## 9. Product framing to defend at judging

- **Risk class** (A/B) comes from operator/device reward history + uptime — assume "operators
  already in run-rate" (financing demonstrated revenue, not speculation).
- **Secondary market**: redeem-at-NAV is the primary, demoable exit. A constant-product AMM
  (SaucerSwap) prices a continuously-appreciating share poorly (one-directional IL for LPs),
  so SaucerSwap is roadmap / price-discovery, scoped to the Tokenization submission only.
- **Reward routing**: the operator commits its reward payout address to the vault for the
  term — the key assumption to implement or mock cleanly.

## 10. Out of scope (V2)

Senior/junior tranches · internal lending against shares · duration-tiered pool products ·
direct integration with a live DePIN network's reward contracts · on-chain risk oracle ·
migrating vault authority to an audited contract.

## 11. Open questions to resolve during the build

- Exact NAV recompute cadence (heartbeat interval) and rounding policy (6 dp fixed-point).
- Who seeds the initial SaucerSwap pool liquidity (if the stretch is built).
- Default handling: recovery value model + who triggers `markDefault`.
- Confirm testnet USDC `0.0.429274` is faucet-fundable to your accounts in hour 0; else mock
  USDC via `TokenCreateTransaction` (same code path, swap the id).
