# Wafer — Technical Specification (v1, ship-ready)

Status: **ETHGlobal New York 2026**. Network: **Hedera Testnet (chain 296)**. Vault: a **Solidity
contract** on Hedera EVM (HSCS) creating/holding **HTS tokens** via `@hiero-ledger/hiero-contracts`.
Scripts + frontend: TypeScript (viem + React). Settlement: **native HBAR**. Target track:
**Hedera — Tokenization**.

> This spec is the build blueprint, implemented as written and **live on Hedera Testnet**
> (Sourcify-verified; canonical addresses in [`deployments/testnet.json`](deployments/testnet.json)).
> Nothing is mocked except the **DePIN reward cashflow** (§9), modeled on-chain by `MockRewardSource`.

---

## 0. Locked decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Settlement asset | **Native HBAR** (tinybar, 8dp). USDC = roadmap. |
| D2 | Investor access | **Admin allowlist** — `adminGrantKyc(poolId, investor)`; no auto-KYC on deposit. |
| D3 | Reward routing (prod target) | **Device-NFT escrow** (Helium recipient/destination model), keeper drip via HIP-1215; bridge relayer = the one residual trust. |
| D4 | Secondary market | **In scope** — SaucerSwap V1 share/WHBAR pair, KYC-deadlock resolved (§10). |
| D5 | Redemptions | **Idle + queue + secondary** — instant up to liquid cash, remainder FIFO-queued, SaucerSwap always available. |
| D6 | Risk class / category | **On-chain** enum fields on Pool + Claim (admin assigns class). |
| D7 | Deal proposal workflow | **Implemented on-chain**: propose → review → assign-class → finance. |
| D8 | Authorized settler | **Per-claim allowlist** (operator + protocol relayer + owner) — reconciles operator-vs-relayer. |
| D9 | Admin custody | **Ownable2Step**, owner = Safe multisig in prod; `markDefault` + `financeClaim` **timelocked**; **operator whitelist**. |
| D10 | Compliance levers | **Implemented** — freeze/unfreeze + pause/unpause are real, not dead keys. |
| D11 | Share fee | **NONE (removed)** — on Hedera a fractional fee is assessed on every non-collector transfer and reverts `INVALID_ACCOUNT_ID`, breaking redeem (operator→vault) and AMM/secondary (operator→pair). A tradeable pool-share ships as a plain fungible token; a compliant fee would need permissioned transfers (roadmap). |
| D12 | NFT metadata | **32-byte keccak hash** of canonical deal JSON (≤100B, no pinning infra); full deal fields go in **events**. |
| D13 | Internal accounting width | **uint256** internally; downcast to int64 only at HTS boundaries; `require(msg.value <= type(uint64).max)`. |

---

## 1. Product & roles

DePIN operators buy hardware **today** to earn protocol rewards over **months**. Wafer is a
**financing layer, not an operator** — it never runs nodes or takes positions in DePIN networks.
Operators who already earn on-chain rewards get upfront HBAR against those future rewards; investors
supply that HBAR through pools and earn the blended yield. Centrifuge/Maple, specialized for DePIN.

- **Pools** are standardized by **category × risk class** (e.g. `GPU-A`). The vault is **permanent**;
  settled claims are replaced by new ones. The pool share is a **NAV-appreciating** unit (ERC-4626-like),
  not a zero-coupon — NAV rises as reward HBAR flows in.
- **Per-deal APR varies within a class.** Each deal carries its own `advance / expected / term` →
  its own APR. The pool NAV is the **blended, realized** return of all its deals (minus defaults),
  accrued **amortized-cost**. The class is the admin's **risk-and-return curation**, so each pool
  stays coherent. (Worked blend in §5.3.)

**Roles**

| Role | Can |
|---|---|
| **Investor** (allowlisted) | `deposit`, `redeem`, `requestRedemption` / `claimRedemption`, trade on SaucerSwap |
| **Operator** (whitelisted) | `proposeDeal`, escrow the device-NFT at finance, be paid the advance, route rewards |
| **Settler** (per-claim allowlist) | `settleRewards` (operator EOA / protocol relayer / owner) |
| **Admin** (owner = multisig, timelocked) | `createPool`, `approveDeal`+assign class, `financeClaim`, `markDefault`, `pausePool`, `freeze`, `adminGrantKyc`, `registerOperator`, `setAuthorizedSettler`, `setMinBuffer` |

## 2. Architecture

```
 operator ─propose/escrow/route─▶┌─────────────────────────────────────┐◀─deposit/redeem─ investor
                                 │   WaferVault.sol  (Hedera EVM, HSCS)  │
   admin ─approve/finance/class─▶│   @hiero-ledger/hiero-contracts:      │
                                 │   • HTS pool-share (KYC+freeze+fee)   │
   relayer ─settleRewards────────▶│   • HTS reward-claim NFT (receipt)   │
   (bridged HNT→HBAR)            │   • device-NFT escrow (collateral)    │
   MockRewardSource (demo) ──────▶│   • amortized-cost NAV, deposit,     │
                                 │     redeem+queue, settle, default     │
   front (Vite+React+viem) ─────▶└──────┬──────────────────┬────────────┘
   reads views + Mirror Node            │ HTS @ 0x167       │ shares/WHBAR
                              ┌──────────▼─────┐    ┌────────▼────────┐
                              │   Hedera HTS   │    │  SaucerSwap V1  │ secondary (share/WHBAR)
                              └──────────┬─────┘    └─────────────────┘
                                         │ reads (logs/balances)
                              ┌──────────▼─────┐
                              │   Mirror Node  │──▶ frontend feed + indexer
                              └────────────────┘
```

The vault is the backend: all logic on-chain and verifiable. No HTTP API, no HCS topic — contract
events + Mirror Node are the read/audit layer.

## 3. Units & conventions

- **Inside the EVM everything is TINYBAR** (1 HBAR = 1e8). `msg.value`, `address(this).balance`,
  `call{value:}` are all tinybar (verified by probe). `ONE = 1e8`, share decimals = **8**.
- The **JSON-RPC boundary uses weibar** (1e18). The Hashio relay divides tx `value` by 1e10 →
  tinybar. **Front sends `value = N * 1e18` weibar** (`parseEther(N)`) for N HBAR; the contract sees
  `N * 1e8` tinybar. **No hand-scaling inside the contract.** Amounts finer than 1 tinybar are
  truncated by the relay.
- **Money math is uint256 internally**; downcast to **int64** only when calling HTS (HTS amounts are
  int64). Every payable entrypoint does `require(msg.value <= type(uint64).max, "VALUE_TOO_LARGE")`.
- All HTS calls **must check `responseCode == 22 (SUCCESS)` and revert otherwise** (a low-level
  `.call` returns `success=true` on HTS business errors). Use `SafeHTS`-style reverting wrappers.

## 4. Data model

### 4.1 On-chain storage

```solidity
enum DealStatus  { Proposed, Approved, Rejected, Financed, Repaid, Defaulted }
enum ClaimStatus { Active, Repaid, Defaulted }
enum PoolStatus  { Active, Paused }
enum Category    { GPU, Wireless, Mapping, Energy, Storage }   // extensible
enum RiskClass   { A, B, C }

struct Pool {
    address shareToken;       // HTS fungible, 8dp, KYC+freeze+fee keys = vault
    address claimNft;         // HTS NFT collection (the receipts), supply/wipe = vault
    Category category;
    RiskClass class;
    uint256 idleTinybar;      // on-hand HBAR cash backing shares (CASH leg)
    uint256 receivableTinybar;// Σ carry of Active claims (ACCRUAL leg)
    uint256 totalShares;      // mirrors HTS supply, 8dp
    uint256 queuedShares;     // shares waiting in the redemption queue
    uint16  minBufferBps;     // min idle/(idle+recv) kept free for redemptions (default 0)
    PoolStatus status;
}
// totalAssets(pool) = idleTinybar + receivableTinybar   (DERIVED — never stored)

struct Deal {                 // the proposal + its lifecycle
    address operator;
    bytes32 detailsHash;      // keccak of canonical off-chain JSON (company/description/...)
    uint256 advanceTinybar;   // requested upfront
    uint256 expectedTinybar;  // total repayment target (expected >= advance)
    uint64  termSeconds;
    Category category;        // proposed
    RiskClass class;          // ASSIGNED by admin on approve
    uint32  poolId;           // ASSIGNED by admin on approve
    address deviceNft;        // collateral collection (escrowed at finance)
    int64   deviceSerial;
    DealStatus status;
    uint256 claimId;          // set once financed
}

struct Claim {                // the financed receivable (amortized-cost)
    uint32  poolId;
    address operator;
    uint256 advanceTinybar;   // initial carrying cost
    uint256 expectedTinybar;  // face / repayment target
    uint256 carryTinybar;     // current amortized book value (→0 at Repaid/Default)
    uint256 settledTinybar;   // cumulative reward HBAR routed in
    uint64  startTime;        // accretion clock start (= finance time)
    uint64  termSeconds;
    int64   nftSerial;        // claim-NFT serial held by vault
    address deviceNft;        // escrowed collateral, returned on Repaid
    int64   deviceSerial;
    ClaimStatus status;
}

struct RedemptionRequest { address investor; uint32 poolId; uint256 shares; uint64 ts; bool filled; }

address public owner;                                  // Ownable2Step; multisig in prod
mapping(uint32  => Pool)  public pools;   uint32  public poolCount;
mapping(uint256 => Deal)  public deals;   uint256 public dealCount;
mapping(uint256 => Claim) public claims;  uint256 public claimCount;
mapping(address => bool)  public isOperator;           // whitelist (D9)
mapping(uint256 => mapping(address => bool)) public claimSettler;  // per-claim allowlist (D8)
RedemptionRequest[] public redemptionQueue; mapping(uint32 => uint256) public queueHead;
// timelock: mapping(bytes32 => uint64) public pendingAfter;  for markDefault/financeClaim
uint256 constant ONE = 1e8; uint8 constant SHARE_DECIMALS = 8;
```

### 4.2 What lives where (NFT = receipt, not a database)

- **Contract storage** = the source of truth for *money* (Pool, Deal, Claim, queue). Mutable.
- **Claim NFT** = the on-chain *receipt*, one serial per financed deal, **held by the vault**
  (treasury), **burned at Repaid**. Metadata = **32-byte keccak hash** of the canonical deal JSON
  (HTS NFT metadata is ≤100 bytes and **immutable at mint** — no live state can live there).
- **Device NFT** = the operator's collateral (external collection; `MockDeviceNFT` in demo),
  **escrowed** into the vault at finance, returned at Repaid, retained/liquidated on Default.
- **Off-chain (events → Mirror Node)** = human-readable display data: company, description,
  category, class, advance, expected, term, APR. Emitted in `DealProposed`/`ClaimFinanced`.

## 5. Accounting — amortized cost (the locked math)

**Design (locked): finance keeps NAV FLAT (carry-at-advance), NAV rises only by realized spread,
accreted over the term.** `totalAssets` is **derived** (`idle + receivable`), so it can't drift —
this kills the old double-count bug class. (IFRS-9 / effective-interest method.)

### 5.1 Formulas (all tinybar)

```
navPerShare         = totalShares == 0 ? ONE : (idle + receivable) * ONE / totalShares

deposit(assets)     require(investor KYC'd)            // D2 allowlist
                    shares = totalShares==0 || (idle+recv)==0 ? assets
                                                              : assets * totalShares / (idle+recv)
                    idle += assets; totalShares += shares; mint+transfer shares      // NAV flat

financeClaim        require(idle >= advance)
                    idle -= advance; receivable += advance                          // NAV FLAT (I3)
                    claim = {carry: advance, expected, settled:0, start: now, term}
                    escrow deviceNft into vault; mint claim NFT to vault; pay advance LAST (CEI)

settleRewards(pay)  require(claimSettler[claimId][msg.sender]); require(c.status==Active)
                    idle += pay; c.settled += pay
                    target   = c.advance + (c.expected - c.advance) * min(now-c.start, term) / term
                    newCarry = target > c.settled ? target - c.settled : 0
                    receivable += newCarry - c.carry; c.carry = newCarry            // only spread lifts NAV
                    if (c.settled >= c.expected) {                                   // full repayment
                        receivable -= c.carry; c.carry = 0; c.status = Repaid
                        burn claim NFT; return deviceNft to operator
                    }

redeem(shares)      assets = shares * (idle + receivable) / totalShares
                    fill = min(assets, liquidAssets)                                // pay from CASH only (I7)
                    totalShares -= shares; idle -= fill; burn shares; pay fill LAST
                    if (assets > fill) enqueue RedemptionRequest(remainder)         // D5 queue

markDefault         require(c.status==Active)                                       // timelocked (D9)
                    loss = c.carry; receivable -= loss; c.carry = 0; c.status = Defaulted
                    retain/wipe deviceNft                                           // NAV falls loss/totalShares
```

`liquidAssets(pool) = idle` (optionally minus the `minBufferBps` reserve). `maxRedeem` view =
`min(userAssets, liquidAssets)` so the front never quotes an un-fillable instant redeem.

### 5.2 Invariants

- **I1** cash solvency: Σ pools' `idle` ≤ `address(this).balance`; `receivable` is off-balance (a promise).
- **I2** asset identity: `totalAssets == idle + receivable`, always (derived, no slot to drift).
- **I3** finance neutrality: `financeClaim` leaves `idle + receivable` (and NAV) unchanged.
- **I4** receivable composition: `receivable == Σ Active claims' carry`.
- **I5** carry bounds: `0 ≤ carry ≤ max(advance, expected)`; `carry == 0` once Repaid/Defaulted.
- **I6** no over-recognition: recognized income per claim never exceeds `expected - advance`
  (target clamped to term).
- **I7** redeem from cash only: instant fill requires `idle ≥ fill`; receivables are illiquid → queue.
- **I8** genesis: `totalShares == 0 ⇔ navPerShare == ONE`.
- **I9** units: every money field and every `msg.value`/`call{value:}` is tinybar; no 1e10/1e18 inside.
- **I10** queue is a senior liability: NAV and share conversions divide over `netAssets = idle +
  receivable - queuedShares`, NEVER gross `totalAssets`. A partially-filled redeemer burns ALL their
  shares at `redeem` but the unfilled portion's HBAR is earmarked in `queuedShares` and excluded from
  the base remaining holders share — so a large queued redemption cannot inflate other holders' NAV.
  `claimRedemption` decrements `idle` and `queuedShares` equally, leaving remaining-holder NAV flat.

### 5.3 Worked examples

**Single deal (no double-count).** deposit 100 → idle100/recv0, NAV 1.000. finance advance 90
(expected 100, 90d) → idle10/recv90, NAV **1.000 (flat)**. settle 30@t30 → idle40, target
90+10·30/90=93.33, carry 63.33, recv63.33, NAV 1.0333. settle 30@t60 → idle70, carry36.67, NAV
1.0667. settle 40@t90 → settled100≥100 ⇒ Repaid, carry0, idle110, recv0, **NAV 1.100**. (Buggy
contract would show 100+100 ⇒ **NAV 2.0** — the 90 of principal counted twice.)

**Blend of 2 deals, different APR (the product premise).** deposit 200 → NAV 1.0. Deal A
advance90/expected100 (~11%); Deal B advance50/expected60 (20%). finance both → idle60/recv140, NAV
**1.0**. @t45 settle A 50, B 30 → idle140, carryA45, carryB25, recv70, **NAV 1.05**. @t90 settle A 50
(→Repaid), B 30 (→Repaid) → idle220, recv0, **NAV 1.10**. Blended pool return = 10% (the 20 HBAR
spread over 200, idle drag included); per-deal APRs (11%, 20%) are absorbed into one pool NAV.

**Default.** From the blend @t45 (idle140/recv70, NAV1.05), B defaults → loss = carryB 25, recv 45,
**NAV 0.925**. Investors keep cash already received; the unrecovered 25 carry is the realized loss,
shared pro-rata. Device-NFT B is retained/liquidated.

## 6. Lifecycle / state machines

**Deal:** `Proposed` —(admin approve: assign class + pool)→ `Approved` | `Rejected` —(admin
finance: escrow device-NFT + advance + mint claim NFT)→ `Financed`(claim `Active`) —(settle to
expected)→ `Repaid`(claim NFT burned, device-NFT returned) | —(markDefault)→ `Defaulted`(write-down,
device-NFT retained).

**Redemption:** instant fill up to `liquidAssets`; remainder → FIFO `redemptionQueue`, served as
`settleRewards`/`deposit` refill `idle` (a `claimRedemption`/auto-fill pays queued requests in
order); SaucerSwap is the always-on alternative exit at market price.

## 7. Contract surface

| Function | Access | Notes |
|---|---|---|
| `createPool(category, class, name, symbol)` **payable** | owner | 2 HTS creates (share-with-fee + NFT), **seed dead shares** (anti-inflation), grant vault self-KYC. Attach ~100 HBAR, gas 10M. |
| `registerOperator(addr, bool)` | owner | operator whitelist (D9) |
| `proposeDeal(category, advance, expected, term, detailsHash, deviceNft, deviceSerial)` | operator | creates `Deal{Proposed}`; emits `DealProposed` (full fields) |
| `approveDeal(dealId, class, poolId)` / `rejectDeal(dealId)` | owner | assigns class+pool (must match pool category); `Approved` |
| `financeClaim(dealId)` | owner (**timelocked**) | `require(idle≥advance)`; pull device-NFT into escrow; mint claim NFT to vault; create Claim; pay advance **last** (CEI, nonReentrant). Sets default `claimSettler` = {operator, owner}. |
| `setAuthorizedSettler(claimId, addr, bool)` | owner | add relayer/keeper to a claim's settler set (D8) |
| `settleRewards(poolId, claimId)` **payable** | claim settler | amortized accrual + cap at `expected`; auto-Repaid+burn+return device-NFT |
| `markDefault(claimId)` | owner (**timelocked**) | write down `carry`; retain device-NFT |
| `adminGrantKyc(poolId, investor)` / `adminRevokeKyc(...)` | owner | allowlist (D2) |
| `deposit(poolId)` **payable** | investor (KYC'd) | mint shares at NAV; nonReentrant |
| `redeem(poolId, shares)` | investor | instant fill ≤ liquid; queue remainder; approve+transferFrom share pull (fee-exempt); nonReentrant |
| `claimRedemption(requestId)` | investor | pay a queued request once idle covers it |
| `pausePool/unpausePool(poolId)`, `freeze/unfreeze(poolId, acct)` | owner | real compliance levers (D10) |
| `setMinBuffer(poolId, bps)` | owner | redemption buffer (D5) |
| views | — | `navPerShare`, `totalAssets`, `liquidAssets`, `maxRedeem`, `previewDeposit/Redeem`, `pools/deals/claims` getters, `queueLength` |

**Events (full off-chain surface, D12):** `PoolCreated`, `OperatorRegistered`, `DealProposed(dealId,
operator, category, advance, expected, term, detailsHash)`, `DealApproved(dealId, class, poolId)`,
`DealRejected`, `ClaimFinanced(claimId, dealId, poolId, operator, advance, expected, term, serial,
deviceNft, deviceSerial)`, `RewardRouted(claimId, amount, newCarry, settled)`, `ClaimRepaid(claimId,
serial)`, `ClaimDefaulted(claimId, loss)`, `Deposit`, `Redeem`, `RedemptionQueued`,
`RedemptionFilled`, `KycGranted/Revoked`, `Paused/Frozen`.

**Security (every ship-blocker from the review is addressed):**
- `nonReentrant` (OZ) on `deposit/redeem/financeClaim/settleRewards/markDefault/claimRedemption`;
  **CEI** everywhere (all `call{value:}` last). On Hedera EVM `call{value:}` triggers recipient
  `receive()/fallback()`, so this is real, not cosmetic.
- `settleRewards` **gated** to `claimSettler`, **requires `Active`**, **caps accrual at `expected`**
  → no NAV spiking/sandwich, no resurrecting a defaulted claim.
- **Pool seeding** (dead shares minted to the vault at `createPool`) **+ virtual offset** in share
  math → first-depositor inflation closed.
- **uint256 internal accounting**, `require(msg.value <= type(uint64).max)`, downcast only at HTS.
- **Ownable2Step**; `markDefault`/`financeClaim` behind a **timelock** (pending → execute window so
  holders can exit ahead of an adverse action); **operator whitelist**; owner = multisig in prod.
- **No custom fee** on the share token (D11): on Hedera a fractional fee is assessed on every
  non-collector transfer and reverts `INVALID_ACCOUNT_ID`, which would break redeem (operator→vault)
  and the AMM/secondary transfer (operator→pair). The share ships as a plain, freely-transferable
  fungible token (redeem-safe, SaucerSwap-compatible).
- **Redeem is liquidity-aware** (instant ≤ `liquidAssets`, else queue) → no silent bank-run revert.

## 8. HTS token configuration

- **Pool-share** — `createFungibleTokenWithCustomFees` with **empty fee arrays (no custom fee, D11)**:
  8dp, INFINITE supply, treasury = vault, **5 keys** (supply, **kyc**, **freeze**, **wipe**, **pause**)
  = `KeyValueType.CONTRACT_ID` (NO fee_schedule key — no fee, D11). `pausePool`/`unpausePool` call HTS
  `pauseToken`/`unpauseToken` (real token-level halt of ALL transfers incl. secondary), and `freeze`
  is per-account — so KYC + freeze + pause are three real compliance levers. No fractional fee — a fee
  breaks redeem + AMM transfers on Hedera (see D11). KYC flow: investor **associates** (IHRC719) → admin `adminGrantKyc` → transfers
  allowed (both parties must be KYC'd; vault self-grants at create). The same `adminGrantKyc` grants
  the SaucerSwap **pair** KYC when enabling the secondary market.
- **Claim NFT** — `createNonFungibleToken`: supply + wipe keys = vault, treasury = vault. Minted to
  the vault; metadata = 32-byte keccak hash; **burned via `burnToken(nft,0,[serial])`** at Repaid
  (treasury-held → no transfer needed).
- **Device NFT** — external collection (operator's). Escrow = `transferNFT(device, operator, vault,
  serial)` at finance (operator pre-approves); return at Repaid; wipe/retain at Default. Demo uses a
  `MockDeviceNFT` the operator mints+escrows.

## 9. Reward routing (only the cashflow is mocked)

**Production target (D3): device-NFT escrow.** On Helium each Hotspot is an NFT and the
lazy-distributor `recipient.destination` PDA decides where rewards go; control of the NFT (or its
destination) = control of the cashflow → an **on-chain-enforceable lien** aligning who-controls-the-
asset with who-bears-the-credit-risk. Keeper/drip cadence via **Hedera HIP-1215** scheduled
transactions (no external keeper). The **one irreducible off-chain step** is the HNT→HBAR
bridge/swap relayer that calls `settleRewards` — its trust is **custody-of-the-bridged-HBAR only**;
state it honestly to judges. (Payout-redirection = trust-the-operator/not enforceable;
keeper-sweep = revocable — both documented as alternatives.)

**Demo simulation — `MockRewardSource` (Hedera, tinybar):** the ONLY mock. Models "the escrowed
device-NFT's reward stream, post-bridge."
```solidity
constructor(address vault)
fund(uint32 poolId, uint256 claimId, uint64 totalRewardTinybar, uint64 startTime,
     uint64 termSeconds, uint32 dripCount) payable onlyOwner   // prefund + linear schedule
drip(uint256 scheduleId)            // permissionless keeper trigger; releases all due intervals via
                                    // vault.settleRewards{value: amt}(poolId, claimId); reverts NOTHING_DUE early
pending(uint256 scheduleId) view returns (uint64 releasableNow, uint64 remaining)
simulateDefault(uint256 scheduleId) onlyOwner   // stop mid-term to demo markDefault
armSelfDrip(uint256 scheduleId) payable onlyOwner  // HIP-1215: schedule a keeper-free maturity settle
scheduledDrip(uint256 scheduleId)                  // HSS-fired settlement (releases all due intervals)
```

**HIP-1215 scheduled transactions (IMPLEMENTED, live on testnet, system contract `0x16b`):** two
keeper-free flows beyond the prod-roadmap framing above:
- **Locked advance** — `WaferVault.setAdvanceLock(seconds)`; when set, `financeClaim` keeps the advance
  in the vault and schedules `releaseAdvance(claimId)` via HSS to auto-pay the operator at unlock
  (`AdvanceScheduled`/`AdvanceReleased`). `releaseAdvance` is permissionless but gated by unlock-time +
  once-only — the network releases the "locked virement" with no keeper.
- **Self-scheduled settle** — `MockRewardSource.armSelfDrip` schedules one `scheduledDrip` at maturity
  that settles the reward in a single network-executed tx (no JS loop). NOTE: HIP-1215 returns
  `NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION` for nested/multiple self-schedules per tx, so a
  per-interval recurring chain is not possible on-chain — it is one scheduled maturity settle; the
  manual `drip()` remains the per-interval path. Proven by `pnpm run smoke:hss`.
`MockRewardSource` is added to the claim's `claimSettler` set. Demo keeper = a script loop (prod =
HIP-1215). Demo script: createPool → adminGrantKyc → deposit 100 → proposeDeal → approveDeal(class)
→ financeClaim(advance 90, expected 100) → `fund(100)` → loop `drip()` asserting NAV 1.0→1.1
monotone (never 2.0) → claim NFT burns; a second run uses `simulateDefault` → `markDefault` → NAV
writes down.

## 10. SaucerSwap V1 integration (in scope, D4)

Testnet: **RouterV3 `0.0.19264`** (`0x…4b40`), **Factory `0.0.9959`** (`0x…26e7`), **WHBAR token
`0.0.15058`** (`0x…3ad2`), WHBAR contract `0.0.15057`. Use the **HBAR-paired** path:
`addLiquidityETHNewPool(token, amountTokenDesired, amountTokenMin, amountETHMin, to, deadline)`
**payable** — router wraps HBAR→WHBAR internally (no WHBAR association/pre-wrap needed).

- **Fee:** `factory.pairCreateFee()` returns **tinycents (~$50)**; convert live via Mirror Node
  `/api/v1/network/exchangerate` (`cent_equivalent/hbar_equivalent`), +buffer. **Never hardcode HBAR.**
  Gas ~3.2M. `msg.value = feeInTinybar + HBAR liquidity`.
- **Prereqs:** `to` needs a **free auto-association slot** for the LP token (its id doesn't exist
  pre-create — can't pre-associate); **approve RouterV3** for the share token amount.
- **KYC deadlock (resolved — verified live):** the share token is KYC-keyed, so only the **pair**
  must be KYC-granted before receiving shares. The **router does NOT** need KYC — a Uniswap-v2 router
  transfers the LP leg **caller→pair directly** (granting the router KYC fails `TOKEN_NOT_ASSOCIATED`
  and is unnecessary). The atomic `addLiquidityETHNewPool` can't work (it seeds the fresh un-KYC'd
  pair in one tx → `ACCOUNT_KYC_NOT_GRANTED`). **Working sequence** (`scripts/enable-secondary.ts`,
  proven on testnet): (1) `factory.createPair(share, WHBAR)` — permissionless, self-associates the
  new pair to both tokens, pays the create fee (~$50 live-derived, ~30 HBAR); (2) `adminGrantKyc(
  poolId, pair)` — pair now exists+associated so the grant succeeds; (3) `approve(router, shareLiq)`;
  (4) `router.addLiquidityETH(share, …)` — seeds →pair (LP token to the owner; the vault has no
  auto-association slot). Liquidity is owner-seeded (admin capital, not pool accounting). Addresses
  wired once via `setSecondaryConfig(router, whbar, factory)` (deploy does this). The in-contract
  **one-call `enableSecondaryMarket(poolId, shareLiq, hbarLiq, fee)` now implements exactly this
  sequence and works live** (createPair → grantKyc(pair) → mint+approve → addLiquidityETH), fitting
  Hedera's 15M per-tx gas cap; `scripts/enable-secondary.ts` is an equivalent fallback.
- **Seed price (8dp):** seed `amountTokenDesired` in **share 8dp units** vs HBAR so price ≈ NAV.
  E.g. NAV 1.0 → seed 1000.00000000 shares (1000e8) against 1000 HBAR (`value = 1000e18` weibar).
  Compute the share leg in 8dp, the HBAR leg in weibar at the RPC boundary.

## 11. Frontend (Vite 6 + React 19 + viem 2, MetaMask)

SPA in `web/`, chain 296 via `defineChain` (RPC `https://testnet.hashio.io/api`, explorer
`hashscan.io/testnet`, `nativeCurrency.decimals = 18`). MetaMask / EIP-6963; no Privy, no backend.
Gas override on HTS-touching calls (`gas ~1M`, `maxFeePerGas = liveBaseFee×5 + tip`).

**Screens**
- **Landing** — pitch + globe.
- **Pools / Fund a category** — list pools by `category × class` with NAV, TVL, trailing APR; below
  each, the deals it finances (operators, advance/expected/term/APR) from the Mirror Node feed —
  "fund the pool" CTA.
- **Pool detail** — NAV chart, deals table, liquidity (idle vs deployed), queue depth.
- **Deposit / Redeem widget** — association + KYC status surfaced; `maxRedeem` shown; queue notice
  when instant can't fill.
- **Redemption queue** — the wallet's pending requests + position.
- **Operator portal** — `proposeDeal` form (company/description/category/advance/expected/term),
  device-NFT escrow approval, the operator's claims + reward status.
- **Admin** — pending deals review + **assign class/pool**, `financeClaim`, `markDefault` (with the
  timelock pending list), KYC allowlist, operator whitelist, pause/freeze, `enableSecondaryMarket`.
- **Activity** — Mirror Node event feed. **Secondary** — SaucerSwap swap/exit.

**EVM checklist (load-bearing)**
- **Deposit:** (1) `IHRC719(shareToken).associate()` if `!isAssociated()` (selector `0x0a754de6`,
  value 0); (2) ensure admin KYC granted (surface status from Mirror Node; else block + request);
  (3) `deposit(poolId)` payable with `value = parseEther(N)` (18dp → relay → tinybar); (4) confirm
  via `balanceOf` (8dp) + `navPerShare`.
- **Redeem:** (1) `approve(vault, shares)` on the share token (ERC-20 facade, 8dp units); (2)
  `redeem(poolId, shares)` → instant fill + queue; (3) confirm balance/HBAR + allowance consumed.
- Wallet/RPC HBAR amounts = 18dp (`parseEther`); share amounts = 8dp; **never hand-scale
  `msg.value` in contract math** (already tinybar).

`web/lib`: `config.js` (chain + addresses + category/class taxonomy), `abi.js` (vault + ERC-20 +
IHRC719 + SaucerSwap router), `format.js` (8dp/tinybar + weibar boundary), `mirror.js`,
`errors.js`. The app reads live from the deployed `VITE_VAULT_ADDRESS` (no mock mode at ship).

## 12. Design history (shipped)

The shipped contract is the amortized-cost redesign described above. For the record, the key changes
from the earliest prototype were: `Pool.totalAssets` split into derived **`idleTinybar` +
`receivableTinybar`** (killing the double-count bug); a single `financeClaim(poolId, operator,
principal)` replaced by the **`proposeDeal` → `approveDeal` → `financeClaim(dealId)`** workflow;
`settleRewards` made amortized + gated + capped and `markDefault` writing down **carry, not
principal**; plus Ownable2Step, a timelock, the operator allowlist, and the redemption queue. All of
this is live and verified — see [`deployments/testnet.json`](deployments/testnet.json).

## 13. Testing (required before "ship")

Pure-logic + integration tests must cover: finance-keeps-NAV-flat (I3); time-accretion target;
**blended 2-claim** different-APR (§5.3); default writes down **carry not advance**;
repaid-residual recognition + clamp at `expected`; `uint64` ceiling `require`; reentrancy (malicious
operator/receiver); `settleRewards` access control + `Active`-only + cap; **redeem fee-exemption**
(full-share burn succeeds); redemption instant-fill + **queue**; KYC gating (unassociated/un-KYC'd
deposit reverts); pool-seeding anti-inflation; SaucerSwap seed at NAV + KYC-grant ordering
(testnet/fork). `pnpm test` (pure math, no network) + `pnpm smoke` (full lifecycle live, HashScan
links).

## 14. Toolchain & deploy

Hardhat + toolbox, Solidity **0.8.24** (optimizer + `viaIR`), network `testnet` (Hashio, chain 296,
ECDSA operator key). ESM repo → `hardhat.config.cts` via `tsconfig.hardhat.json`. `pnpm run deploy`
(deploy + `createPool` funded ~100 HBAR, seed dead shares, persist ids + `VAULT_ADDRESS`),
`pnpm run smoke`, `pnpm run verify <addr>` (**Sourcify**, chain 296). `pnpm run deploy` **not**
`pnpm deploy` (shadowed). `.env` (gitignored, never committed): `OPERATOR_ID/KEY`, `HASHIO_RPC_URL`,
`MIRROR_NODE_URL`. Keys pasted in chat are treated as exposed → rotate after the event.

## 15. Scope

**IN (ship):** the `WaferVault` contract (amortized-cost, proposal workflow, queue, freeze/pause,
operator whitelist, timelock), native-HBAR settlement, `MockRewardSource` + `MockDeviceNFT`, ≥1 pool
(`GPU-A`) end-to-end (propose → approve → finance+escrow → drip/NAV-rise → repaid/burn; + a default
run), the **SaucerSwap** share/WHBAR market with KYC enabled, the full frontend (investor + operator
+ admin), live + Sourcify-verified on testnet, lifecycle proven by `pnpm smoke`.

**OUT (roadmap):** real per-network reward integrations + the HNT→HBAR bridge relayer, HIP-1215
production keeper, USDC denomination, multi-pool taxonomy expansion, redemption epochs, senior/junior
tranches, HCS topic, backend indexer.
