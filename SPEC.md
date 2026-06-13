# Wafer — Technical Specification

Status: hackathon MVP (ETHGlobal NY 2026). Network: **Hedera Testnet (chain 296)**.
Vault: **Solidity smart contract** on Hedera EVM (HSCS), using HTS system contracts via
`@hiero-ledger/hiero-contracts`. Scripts + frontend: TypeScript (viem). All settlement in
on-chain USDC. Target track: **Hedera — Tokenization**.

> Single source of truth: the one-pager `Wafer — Pitchs Devrel.md` (validated by the Hedera
> devrels). This spec implements it literally: HTS tokens + a smart-contract vault + SaucerSwap.

---

## 1. Problem & product

DePIN operators (GPU/compute, wireless, mapping, energy) spend on hardware today but earn their
rewards on-chain over weeks/months. That timing gap is a financing problem — "InfraFi". Wafer
closes it: an operator sells a slice of its **future on-chain rewards** for upfront USDC;
investors buy a fungible **pool-share** token = exposure to a basket of reward streams,
tradable/redeemable any time.

- Pools standardized by **network + risk** (e.g. `GPU-A`, `WIFI-B`, `ENERGY-A`). The vault is
  **permanent**; settled claims are replaced by new ones.
- The share is a **continuously-appreciating NAV unit** (like a money-market fund share),
  **not** a zero-coupon: NAV per share rises as reward USDC flows in. No maturity on the share;
  maturity is a property of each underlying claim.
- Example: a GPU operator expects ~10,000 USDC over 90 days, receives 9,000 today; the rewards
  flow into the vault, the ~1,000 spread is the yield, shared across holders.

## 2. Architecture

```
  operator ──finance/settle──▶┌──────────────────────────────────────┐◀──deposit/redeem── investor
                              │  WaferVault.sol  (Hedera EVM, HSCS)   │
                              │  via @hiero-ledger/hiero-contracts:   │
   front (Next.js, viem) ────▶│   • creates/holds HTS pool-share      │
   reads views + Mirror Node  │   • creates/holds reward-claim NFTs   │
                              │   • mock-USDC (HTS) as settlement      │
                              │   • NAV, deposit, redeem, settle       │
                              └───────┬───────────────────┬───────────┘
                                      │ HTS @ 0x167        │ shares/USDC
                              ┌───────▼────────┐   ┌───────▼────────┐
                              │  Hedera HTS    │   │  SaucerSwap V1 │  secondary market
                              │  (tokens)      │   │  (share/USDC)  │
                              └───────┬────────┘   └────────────────┘
                                      │ reads
                              ┌───────▼────────┐
                              │  Mirror Node   │──▶ frontend (balances, holders, logs)
                              └────────────────┘
```

- The **vault is a contract** → vault logic is on-chain and verifiable (verified on HashScan).
- **No backend API** (the contract is the backend; the front talks to it directly via a wallet).
- **No HCS topic** (contract events + Mirror Node are the audit/read layer).

## 3. The `WaferVault` contract

Toolchain: **Hardhat**, Solidity **0.8.24**, `@hiero-ledger/hiero-contracts@0.1.2`
(`@openzeppelin/contracts@^5.3.0`). Inherit `HederaTokenService, KeyHelper, ExpiryHelper,
FeeHelper`. The vault is the **treasury + SUPPLY + KYC + FREEZE key** (`KeyValueType.CONTRACT_ID`)
for the tokens it creates, so it mints/burns/grants-KYC/freezes with no off-chain signer.

```solidity
import "@hiero-ledger/hiero-contracts/token-service/HederaTokenService.sol";
import "@hiero-ledger/hiero-contracts/token-service/IHederaTokenService.sol";
import "@hiero-ledger/hiero-contracts/token-service/KeyHelper.sol";
import "@hiero-ledger/hiero-contracts/token-service/ExpiryHelper.sol";
import "@hiero-ledger/hiero-contracts/token-service/FeeHelper.sol";
import "@hiero-ledger/hiero-contracts/common/HederaResponseCodes.sol";
```

Storage:
```solidity
enum ClaimStatus { Active, Repaid, Defaulted }
struct Pool  { address shareToken; address claimNft; uint64 totalAssets; uint64 totalShares; uint8 status; }
struct Claim { address operator; uint64 principalUsdc; uint64 repaidUsdc; int64 nftSerial; uint32 poolId; ClaimStatus status; }
address public usdc;                       // mock-USDC HTS token (6 dp)
mapping(uint32 => Pool)  public pools;     uint32 public poolCount;
mapping(uint256 => Claim) public claims;   uint256 public claimCount;
```

Functions (and the HTS call each makes):

| Function | Who | Does | HTS calls |
|---|---|---|---|
| `setUsdc(addr)` | owner | set + associate the settlement token | `associateToken(this,usdc)`, `grantTokenKyc(usdc,this)` |
| `createPool(name,symbol)` **payable** | owner | new pool: share token + claim NFT | `createFungibleTokenWithCustomFees` (6dp, 0.10% fractional fee, INFINITE), `createNonFungibleToken`, `grantTokenKyc(share,this)` |
| `financeClaim(poolId,operator,principal,meta)` | owner | mint claim NFT to vault, advance USDC | `mintToken(claimNft,0,[meta])`, `transferToken(usdc,this,operator,principal)` |
| `deposit(poolId,assets)` | investor | mint shares at NAV | `grantTokenKyc(share,investor)`, pull USDC via `transferFrom`, `mintToken(share,shares,[])`, `transferToken(share,this,investor,shares)` |
| `redeem(poolId,shares)` | investor | burn shares, pay USDC at NAV | `transferToken(share,investor,this,shares)`, `burnToken(share,shares,[])`, `transferToken(usdc,this,investor,assets)` |
| `settleRewards(poolId,claimId,amount)` | operator | route reward USDC into vault → NAV up | `transferFrom(usdc,operator,this,amount)`; `totalAssets += amount` |
| `markDefault(claimId)` | owner | write down a claim → NAV down | storage; optional `burnToken(claimNft,0,[serial])` |
| `navPerShare(poolId)` view | — | `totalShares==0 ? 1e6 : totalAssets*1e6/totalShares` | — |

Plus `poolCount()`, `pools(i)`, `shareBalanceOf(poolId,acct)` views and `Deposit/Redeem/ClaimFinanced/RewardRouted/Default` **events** (the front's activity feed reads them via Mirror Node).

Money is **integer micro-units (6 dp)** for USDC and shares everywhere; only format at the edge.

## 4. HTS-from-Solidity patterns (load-bearing details)

- **Token create is `payable`**: the wrapper does `.call{value: msg.value}` to the precompile
  (`0x167`). Attach **~50 HBAR** (plain) / **~60 HBAR** (with custom fees) as `msg.value`;
  excess is refunded to the contract. Set `gasLimit` **1M** (create/mint/transfer) to **10M**
  (create-with-fees). So `createPool` is `payable` and the deploy script funds it.
- **Always check `responseCode == 22 (SUCCESS)` and revert** — a low-level `.call` returns
  `success=true` even on an HTS business error. (Or use `SafeHTS` reverting wrappers.)
- **Association**: an account must associate a token before holding it. Vault auto-associates
  tokens it creates (it's treasury); it must `associateToken(this, usdc)` for USDC. Investors
  associate the **share** token themselves from their wallet via the **IHRC719 facade**
  (`associate()`), or via auto-association slots.
- **KYC-gated transfer**: with a KYC key, *both* parties to a transfer must be KYC-granted, else
  `ACCOUNT_KYC_NOT_GRANTED`. Order: associate → `grantTokenKyc` → transfer. Vault grants itself
  KYC at pool creation and grants the investor on first `deposit`.
- **Pulling USDC**: the contract can only pull an investor's USDC if the investor first
  `approve(vault, amount)` on the USDC token (ERC-20 facade via HIP-376), then the vault does
  `transferFrom`. Same model as ERC-20.

## 5. SaucerSwap integration (V1, testnet)

Use **V1 (Uniswap-v2 style)** — one call creates the pool + seeds liquidity. Live router:
**`SaucerSwapV1RouterV3 = 0.0.19264`** (EVM `0x…4b40`); Factory `0.0.9959`.

- **Create pool**: `addLiquidityNewPool(tokenA,tokenB,aDesired,bDesired,aMin,bMin,to,deadline)`
  **payable** — the ratio you seed = the initial share/USDC price (e.g. 1000:1000 → 1.00). The
  **pool-creation fee is ~$50 USD in HBAR**: read `factory.pairCreateFee()` (tinycent), convert
  via Mirror Node `/api/v1/network/exchangerate`, pass as `msg.value` (tinybar→weibar ×1e10,
  +10% buffer). Gas ~3.2M.
- **Prereqs**: associate both tokens; **+1 auto-association** to receive the LP token; **approve
  RouterV3** for both amounts (HIP-376 ERC-20 facade `approve`).
- `addLiquidity(...)` (no fee), `swapExactTokensForTokens(amountIn,minOut,[in,out],to,deadline)`.
- ⚠️ The $50 testnet-HBAR fee can be hundreds of HBAR → see §11. SaucerSwap is the part most
  likely to be HBAR-blocked; **redeem-at-NAV is the guaranteed exit**, SaucerSwap is the bonus.

## 6. Frontend (Next.js + Tailwind + shadcn, viem)

- **Chain 296** via viem `hederaTestnet` (RPC `https://testnet.hashio.io/api`). ⚠️
  `nativeCurrency.decimals = 18` (EVM weibar) — keep HBAR/gas math separate from 6-dp USDC.
- **Dev wallet** from env (`NEXT_PUBLIC_DEV_PRIVATE_KEY`, ECDSA) — NOT Privy. Public client for
  reads, wallet client for writes.
- **Writes**: deposit flow = `ensureAssociated(usdc)` → `approve(vault, micro)` →
  `ensureAssociated(share)` → `deposit(poolId, micro)`. Pin `gas` (~1M) on HTS-touching calls.
- **Reads**: NAV/pools/balances from contract `view`s; supply/holders/activity from Mirror Node
  (`/api/v1/tokens/{id}`, `/balances`, `/contracts/{id}/results/logs`, `/accounts/{evm}`).
- **Hollow-account bootstrap**: fund the dev EVM address with a few HBAR once (creates the
  account, unlimited auto-assoc by default); first signed tx promotes it. UI guard
  (`devAccountReady()`) blocks deposit until the account exists + has HBAR.
- `lib/wafer.ts` (viem clients + typed contract calls + `ensureAssociated`), `lib/mirror.ts`
  (REST), `lib/abi.ts`, `lib/format.ts`. Screens: Pools+NAV, Deposit, Redeem, Activity. Neutral
  theme via a single tokens file → drop a DA in without touching logic.

## 7. Settlement asset

The operator (`0.0.9221779`) holds no USDC, so the vault **creates a mock-USDC HTS token (6 dp)**
and uses it as the settlement asset for the demo. Real Circle USDC testnet is `0.0.429274` — a
one-line config swap once the account is funded with real USDC.

## 8. Trust model

With the vault as a contract, all vault logic (mint/burn, NAV, settlement) is **on-chain and
verifiable** (contract verified on HashScan; events + Mirror Node reconcile state). The contract
holds the token keys (`CONTRACT_ID`), so no off-chain key custody for token ops. `owner` (the
deployer EOA) gates admin funcs (`createPool`, `financeClaim`, `markDefault`); `deposit`/`redeem`
are permissionless (after KYC). Production hardening: move `owner` to a multisig; add a risk
oracle. All-USDC on-chain settlement removes any fiat-bridge trust.

## 9. Scope

IN (MVP): the `WaferVault` contract, mock-USDC, **1 pool (GPU-A)** end-to-end (finance → deposit
→ settle/NAV-rise → redeem), one **SaucerSwap pool + swap** (best-effort, HBAR-permitting), the
wired frontend skeleton. OUT: HCS topic, backend API, Privy/Arc/ENS, AI agent, real DePIN
network integration, senior/junior tranches, internal lending (all V2).

## 10. Toolchain & deploy

Hardhat + `@nomicfoundation/hardhat-toolbox`, Solidity 0.8.24, network `testnet`
(`https://testnet.hashio.io/api`, chainId 296, operator ECDSA key). Deploy via
`npx hardhat run scripts/deploy.ts --network testnet` (createPool funded with ~60 HBAR
`msg.value`). Verify on HashScan via **Sourcify** (`server-verify.hashscan.io`). viem for the
SaucerSwap + demo scripts and the front.

## 11. Known blockers & footguns (read before the build)

- **HBAR funding (hard prerequisite).** Token create = 50–60 HBAR `msg.value` each (refunded
  excess, but needed up front); SaucerSwap pool = ~$50 in testnet HBAR (can be hundreds). The
  operator's ~10 HBAR is **not enough** → top up at the portal faucet to the max. If unfunded,
  the live deploy can't complete.
- **Association + KYC ordering** is the #1 demo footgun: associate → grantKyc → transfer.
- **Allowance before deposit**: investor must `approve` USDC to the vault first.
- **Pin gas** on HTS-touching calls (Hashio mis-estimates) and check `SUCCESS (22)`.
- **Decimals**: 6 dp for USDC/shares; 18 dp EVM-side for HBAR/gas — never mix.
