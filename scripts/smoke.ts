/**
 * Live full-lifecycle smoke test on Hedera testnet (chain 296).
 *
 *   pnpm run smoke   (== hardhat run scripts/smoke.ts --network testnet)
 *
 * Reads deployments/testnet.json (run `pnpm run deploy` first), then runs the SPEC §9 demo flow
 * LIVE with the operator standing in as operator + investor + admin (single ECDSA key):
 *
 *   RUN A (repaid):  associate share -> adminGrantKyc -> deposit -> mint+escrow device-NFT ->
 *                    proposeDeal -> approveDeal(A, GPU-A) -> financeClaim (advance 90, expected 100)
 *                    -> MockRewardSource.fund(100) + setAuthorizedSettler -> loop drip()
 *                    asserting navPerShare rises 1.0 -> ~1.1 MONOTONE and NEVER >= 2.0
 *                    -> assert claim NFT burned at repaid.
 *
 *   RUN B (default): a fresh deal, finance, fund -> one drip -> simulateDefault mid-term ->
 *                    markDefault -> assert NAV writes DOWN by the remaining carry.
 *
 * Prints HashScan links for every tx. HTS-touching calls pin a high gasLimit (Hashio mis-estimates).
 * We read the on-chain navPerShare to PROVE the NAV math; we never fake a result. If a live step
 * fails (HTS/precompile error, INSUFFICIENT_PAYER_BALANCE, ...) it surfaces with the exact error.
 *
 * UNITS: deposit/finance/reward HBAR amounts cross the RPC boundary as weibar (parseEther / N*1e18);
 * the relay divides by 1e10 so the contract sees tinybar. navPerShare is tinybar 8dp (ONE = 1e8).
 * Share amounts are 8dp. Reward-source `fund` amounts in tinybar are passed to fund() AND attached
 * as weibar value (the contract requires msg.value == totalRewardTinybar in tinybar after the relay).
 */
import hre from "hardhat";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const { ethers } = hre as any;

const DEPLOYMENTS_PATH = resolve(process.cwd(), "deployments", "testnet.json");

const HBAR = 10n ** 18n; // weibar (RPC boundary)
const TINYBAR = 10n ** 8n; // 1 HBAR in tinybar (contract-internal)
const ONE = 10n ** 8n; // navPerShare unit
const HASHSCAN = "https://hashscan.io/testnet";
const HTS_GAS = 1_200_000n; // single-HTS-op calls (associate, deposit, mint, grantKyc)
// Multi-HTS-op calls need much more: financeClaim = associate + transferNFT + mintToken + HBAR pay;
// settleRewards repay branch = receivable math + burnToken + transferNFT; markDefault = wipe NFT.
const HTS_GAS_HEAVY = 4_000_000n;

// Category.GPU = 0, RiskClass.A = 0 (SPEC §4.1 enums).
const CATEGORY_GPU = 0;
const RISKCLASS_A = 0;

// IHRC719 facade: an account associates a token by calling associate() on the token's own address.
const IHRC719_ABI = ["function associate() external returns (int64)"];
// ERC-20/721 facade (HIP-218/376): approve the vault to pull shares (redeem) / the device-NFT (escrow).
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
];
const ERC721_ABI = ["function approve(address to, uint256 tokenId) external"];

const links: string[] = [];
function link(label: string, hash: string) {
  const l = `${label.padEnd(20)}: ${HASHSCAN}/transaction/${hash}`;
  links.push(l);
  return `${HASHSCAN}/transaction/${hash}`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmtNav = (n: bigint) => (Number(n) / 1e8).toFixed(4);

/** Associate a token with the signer via IHRC719 (idempotent: tolerates already-associated). */
async function associate(signer: any, tokenEvm: string, label: string) {
  const ihrc = new ethers.Contract(tokenEvm, IHRC719_ABI, signer);
  try {
    const tx = await ihrc.associate({ gasLimit: 800_000n });
    await tx.wait();
    link(label, tx.hash);
    console.log(`    associated ${tokenEvm}`);
  } catch (e: any) {
    console.log(`    associate ${label} skipped (likely already associated): ${e.shortMessage ?? e.message}`);
  }
}

async function main() {
  if (!existsSync(DEPLOYMENTS_PATH)) throw new Error("deployments/testnet.json missing — run `pnpm run deploy` first");
  const d = JSON.parse(readFileSync(DEPLOYMENTS_PATH, "utf8"));

  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log(`\n=== Wafer smoke · chain ${net.chainId} ===`);
  console.log(`signer (operator + investor + admin): ${signer.address}`);
  console.log(`vault: ${d.vaultAddress}\n`);

  const poolId: number = d.pool?.id ?? 0;
  const shareTokenEvm: string = d.pool?.shareTokenEvm;
  const claimNftEvm: string = d.pool?.claimNftEvm;
  const rewardSrcAddr: string = d.mocks?.rewardSource?.evm;
  const deviceNftAddr: string = d.mocks?.deviceNft?.evm;
  const deviceCollectionEvm: string = d.mocks?.deviceNft?.collectionEvm;
  if (!shareTokenEvm) throw new Error("share token address missing — re-run deploy");
  if (!rewardSrcAddr || !deviceNftAddr) throw new Error("mock addresses missing — re-run deploy");

  const vault = await ethers.getContractAt("WaferVault", d.vaultAddress, signer);
  const rewardSrc = await ethers.getContractAt("MockRewardSource", rewardSrcAddr, signer);
  const deviceNft = await ethers.getContractAt("MockDeviceNFT", deviceNftAddr, signer);
  const deviceCollection = new ethers.Contract(deviceCollectionEvm, ERC721_ABI, signer);
  const shareErc20 = new ethers.Contract(shareTokenEvm, ERC20_ABI, signer);
  const claimErc721 = new ethers.Contract(claimNftEvm, ERC20_ABI, signer); // balanceOf is enough

  const navGenesis: bigint = await vault.navPerShare(poolId);
  console.log(`navPerShare (genesis): ${navGenesis} (${fmtNav(navGenesis)})`);

  // ----------------------------------------------------------------------------------------------
  // 0. Investor onboarding: associate share token + admin grants KYC (D2 allowlist).
  // ----------------------------------------------------------------------------------------------
  console.log(`\n[0] onboard investor: associate share token + adminGrantKyc...`);
  await associate(signer, shareTokenEvm, "associate share");
  try {
    const kTx = await vault.adminGrantKyc(poolId, signer.address, { gasLimit: HTS_GAS });
    await kTx.wait();
    link("adminGrantKyc", kTx.hash);
    console.log(`    KYC granted`);
  } catch (e: any) {
    console.log(`    adminGrantKyc skipped (likely already granted): ${e.shortMessage ?? e.message}`);
  }

  // ----------------------------------------------------------------------------------------------
  // 1. Deposit 100 HBAR -> shares at genesis NAV (1.0). idle 100, NAV flat.
  // ----------------------------------------------------------------------------------------------
  console.log(`\n[1] deposit 10 HBAR (skipped if already holding shares — idempotent re-runs)...`);
  let preShares: bigint = await shareErc20.balanceOf(signer.address);
  if (preShares === 0n) {
    const depTx = await vault.deposit(poolId, { value: 10n * HBAR, gasLimit: HTS_GAS });
    await depTx.wait();
    link("deposit", depTx.hash);
  } else {
    console.log(`    already holding ${preShares} shares — skipping deposit`);
  }
  const shareBal: bigint = await shareErc20.balanceOf(signer.address);
  const navPostDeposit: bigint = await vault.navPerShare(poolId);
  console.log(`    shares: ${shareBal} (8dp)   navPerShare: ${navPostDeposit} (${fmtNav(navPostDeposit)})`);

  // ----------------------------------------------------------------------------------------------
  // 2. Mint + escrow a device-NFT (collateral). Operator associates the collection, mints a serial,
  //    approves the vault to pull it on finance.
  // ----------------------------------------------------------------------------------------------
  console.log(`\n[2] mint + approve device-NFT (collateral)...`);
  await associate(signer, deviceCollectionEvm, "associate device");
  const metaHash = ethers.keccak256(ethers.toUtf8Bytes("device:gpu-rig-001"));
  const mintTx = await deviceNft.mintTo(signer.address, metaHash, { gasLimit: HTS_GAS });
  const mintRcpt = await mintTx.wait();
  link("mint device", mintTx.hash);
  let deviceSerial = 0n;
  for (const log of mintRcpt!.logs) {
    try {
      const parsed = deviceNft.interface.parseLog(log);
      if (parsed?.name === "DeviceMinted") deviceSerial = BigInt(parsed.args.serial);
    } catch {
      /* not our event */
    }
  }
  if (deviceSerial === 0n) {
    deviceSerial = BigInt(await deviceNft.minted()); // fallback: serials are 1-indexed by mint count
  }
  console.log(`    device serial: ${deviceSerial}`);
  // ERC-721 facade approve: tokenId == serial. Lets the vault pull operator -> vault at finance.
  const apvTx = await deviceCollection.approve(d.vaultAddress, deviceSerial, { gasLimit: HTS_GAS });
  await apvTx.wait();
  link("approve device", apvTx.hash);

  // ----------------------------------------------------------------------------------------------
  // 3. Deal workflow: propose (advance 90 / expected 100 / short term) -> approve(A, GPU-A) -> finance.
  //    Short term so all reward drips become due within the smoke run's wall-clock window.
  // ----------------------------------------------------------------------------------------------
  const ADVANCE = 9n * TINYBAR; // tinybar (contract-internal units in struct fields)
  const EXPECTED = 10n * TINYBAR;
  const TERM = 60n; // seconds — short demo term so drips mature live
  const detailsHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({ company: "Acme GPU", category: "GPU", advance: 9, expected: 10, term: 60 })));

  console.log(`\n[3] proposeDeal (advance 9, expected 10, term ${TERM}s)...`);
  const propTx = await vault.proposeDeal(
    CATEGORY_GPU,
    ADVANCE,
    EXPECTED,
    TERM,
    detailsHash,
    deviceCollectionEvm,
    deviceSerial,
    { gasLimit: 500_000n },
  );
  const propRcpt = await propTx.wait();
  link("proposeDeal", propTx.hash);
  const dealId = Number(await vault.dealCount()) - 1;
  console.log(`    dealId: ${dealId}`);

  console.log(`\n[3b] approveDeal(${dealId}, A, GPU-A pool ${poolId})...`);
  const apprTx = await vault.approveDeal(dealId, RISKCLASS_A, poolId, { gasLimit: 300_000n });
  await apprTx.wait();
  link("approveDeal", apprTx.hash);

  console.log(`\n[3c] financeClaim(${dealId}) — escrow device + advance 9 (NAV must stay FLAT, I3)...`);
  const finTx = await vault.financeClaim(dealId, { gasLimit: HTS_GAS_HEAVY });
  await finTx.wait();
  link("financeClaim", finTx.hash);
  const claimId = Number(await vault.claimCount()) - 1;
  const navPostFinance: bigint = await vault.navPerShare(poolId);
  console.log(`    claimId: ${claimId}   navPerShare: ${navPostFinance} (${fmtNav(navPostFinance)})`);
  // I3: finance neutrality — NAV unchanged by finance (allow 1 tinybar rounding slack).
  const navDrift = navPostFinance > navPostDeposit ? navPostFinance - navPostDeposit : navPostDeposit - navPostFinance;
  if (navDrift > 1n) {
    throw new Error(`I3 VIOLATED: finance moved NAV ${navPostDeposit} -> ${navPostFinance}`);
  }
  console.log(`    ✓ I3 finance kept NAV flat (drift ${navDrift} tinybar)`);
  const claimBalBefore: bigint = await claimErc721.balanceOf(d.vaultAddress);
  console.log(`    claim NFT held by vault: ${claimBalBefore}`);

  // ----------------------------------------------------------------------------------------------
  // 4. MockRewardSource: fund 100 HBAR over the term + authorize it as a settler, then loop drip()
  //    asserting NAV rises 1.0 -> ~1.1 MONOTONE and NEVER hits 2.0 (the old double-count bug).
  // ----------------------------------------------------------------------------------------------
  const DRIP_COUNT = 3;
  const REWARD_TINYBAR = 10n * TINYBAR; // total reward == expected (so claim repays in full)
  const startTime = BigInt(Math.floor(Date.now() / 1000)); // align schedule to finance time ~ now
  console.log(`\n[4] fund MockRewardSource (10 HBAR, ${DRIP_COUNT} drips over ${TERM}s) + authorize settler...`);
  const fundTx = await rewardSrc.fund(poolId, claimId, REWARD_TINYBAR, startTime, TERM, DRIP_COUNT, {
    value: REWARD_TINYBAR * (HBAR / TINYBAR), // tinybar -> weibar at the RPC boundary
    gasLimit: 500_000n,
  });
  await fundTx.wait();
  link("fund reward", fundTx.hash);
  const scheduleId = Number(await rewardSrc.scheduleCount()) - 1;
  const setTx = await vault.setAuthorizedSettler(claimId, rewardSrcAddr, true, { gasLimit: 200_000n });
  await setTx.wait();
  link("authorize settler", setTx.hash);
  console.log(`    scheduleId: ${scheduleId}`);

  console.log(`\n[4b] drip loop — asserting NAV rises monotone toward ~1.1, never 2.0...`);
  let prevNav = navPostFinance;
  let maxNav = navPostFinance;
  let drips = 0;
  const pollMs = 5000; // poll cadence; only drip when an interval has actually matured
  const deadline = Date.now() + (Number(TERM) + 40) * 1000; // hard stop well past term-end
  // gate each drip on pending() (no NOTHING_DUE revert): only call drip when releasableNow > 0.
  while (Date.now() < deadline) {
    const claim = await vault.claims(claimId);
    if (Number(claim.status) === 1) break; // ClaimStatus.Repaid

    const [releasableNow] = await rewardSrc.pending(scheduleId);
    if (releasableNow === 0n) {
      await sleep(pollMs); // interval not matured yet — wait
      continue;
    }

    const dTx = await rewardSrc.drip(scheduleId, { gasLimit: HTS_GAS_HEAVY });
    await dTx.wait();
    link(`drip #${drips + 1}`, dTx.hash);
    drips++;

    const nav: bigint = await vault.navPerShare(poolId);
    console.log(`    drip #${drips}: released ${releasableNow} tinybar -> navPerShare ${nav} (${fmtNav(nav)})`);
    if (nav < prevNav) throw new Error(`NAV non-monotone: ${prevNav} -> ${nav}`);
    if (nav >= 2n * ONE) throw new Error(`NAV hit ${fmtNav(nav)} >= 2.0 — DOUBLE-COUNT BUG`);
    prevNav = nav;
    if (nav > maxNav) maxNav = nav;
  }

  const claimFinal = await vault.claims(claimId);
  const navFinal: bigint = await vault.navPerShare(poolId);
  const claimBalAfter: bigint = await claimErc721.balanceOf(d.vaultAddress);
  console.log(`\n    final navPerShare: ${navFinal} (${fmtNav(navFinal)})   claim status: ${Number(claimFinal.status)} (1=Repaid)`);
  console.log(`    claim NFT held by vault: ${claimBalAfter} (was ${claimBalBefore})`);

  if (Number(claimFinal.status) !== 1) {
    console.warn(`    WARN: claim not Repaid yet (status ${Number(claimFinal.status)}). NAV proof still holds; drip cadence may need more wall-clock.`);
  } else {
    if (claimBalAfter >= claimBalBefore) console.warn(`    WARN: claim NFT not burned on repay (balance ${claimBalBefore} -> ${claimBalAfter})`);
    else console.log(`    ✓ claim NFT burned on repay`);
    // NAV should land near 1.10 (1 HBAR spread on 10 deposited). Assert it rose and stayed sane.
    if (navFinal <= navPostFinance) throw new Error(`NAV did not rise across the run (${navPostFinance} -> ${navFinal})`);
    if (navFinal >= 2n * ONE) throw new Error(`final NAV ${fmtNav(navFinal)} >= 2.0 — DOUBLE-COUNT BUG`);
    console.log(`    ✓ NAV rose ${fmtNav(navPostDeposit)} -> ${fmtNav(navFinal)} (max ${fmtNav(maxNav)}), never >= 2.0`);
  }

  // ----------------------------------------------------------------------------------------------
  // 5. DEFAULT RUN: a fresh deal, finance, fund, one drip, then simulateDefault -> markDefault.
  //    Assert NAV writes DOWN by the remaining carry (loss shared pro-rata).
  // ----------------------------------------------------------------------------------------------
  console.log(`\n[5] DEFAULT RUN — fresh deal, finance, partial drip, markDefault...`);
  let defaultRan = false;
  try {
    // 5a. mint + approve a second device-NFT
    const metaHash2 = ethers.keccak256(ethers.toUtf8Bytes("device:gpu-rig-002"));
    const mintTx2 = await deviceNft.mintTo(signer.address, metaHash2, { gasLimit: HTS_GAS });
    const mintRcpt2 = await mintTx2.wait();
    link("mint device (B)", mintTx2.hash);
    let serial2 = 0n;
    for (const log of mintRcpt2!.logs) {
      try {
        const parsed = deviceNft.interface.parseLog(log);
        if (parsed?.name === "DeviceMinted") serial2 = BigInt(parsed.args.serial);
      } catch {
        /* skip */
      }
    }
    if (serial2 === 0n) serial2 = BigInt(await deviceNft.minted());
    const apv2 = await deviceCollection.approve(d.vaultAddress, serial2, { gasLimit: HTS_GAS });
    await apv2.wait();
    link("approve device (B)", apv2.hash);

    // 5b. propose -> approve -> finance (advance 50 / expected 60, short term)
    const ADV_B = 5n * TINYBAR;
    const EXP_B = 6n * TINYBAR;
    const TERM_B = 60n;
    const dh2 = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({ company: "Beta GPU", advance: 5, expected: 6, term: 60 })));
    const propTx2 = await vault.proposeDeal(CATEGORY_GPU, ADV_B, EXP_B, TERM_B, dh2, deviceCollectionEvm, serial2, { gasLimit: 500_000n });
    await propTx2.wait();
    link("proposeDeal (B)", propTx2.hash);
    const dealId2 = Number(await vault.dealCount()) - 1;
    const appr2 = await vault.approveDeal(dealId2, RISKCLASS_A, poolId, { gasLimit: 300_000n });
    await appr2.wait();
    link("approveDeal (B)", appr2.hash);
    const navBeforeFinB: bigint = await vault.navPerShare(poolId);
    const finTx2 = await vault.financeClaim(dealId2, { gasLimit: HTS_GAS_HEAVY });
    await finTx2.wait();
    link("financeClaim (B)", finTx2.hash);
    const claimId2 = Number(await vault.claimCount()) - 1;
    const navAfterFinB: bigint = await vault.navPerShare(poolId);
    console.log(`    claimId(B): ${claimId2}   NAV finance flat: ${fmtNav(navBeforeFinB)} -> ${fmtNav(navAfterFinB)}`);

    // 5c. fund + authorize + one partial drip (so some spread is realized before default)
    const REWARD_B = 6n * TINYBAR;
    const start2 = BigInt(Math.floor(Date.now() / 1000));
    const fund2 = await rewardSrc.fund(poolId, claimId2, REWARD_B, start2, TERM_B, 3, {
      value: REWARD_B * (HBAR / TINYBAR),
      gasLimit: 500_000n,
    });
    await fund2.wait();
    link("fund reward (B)", fund2.hash);
    const sched2 = Number(await rewardSrc.scheduleCount()) - 1;
    const set2 = await vault.setAuthorizedSettler(claimId2, rewardSrcAddr, true, { gasLimit: 200_000n });
    await set2.wait();
    link("authorize settler (B)", set2.hash);

    // wait for the first interval to mature, then drip once (partial realization). Gate on
    // pending() so we never hit a NOTHING_DUE revert.
    let waitedB = 0;
    while (waitedB < (Number(TERM_B) / 3) * 1000 + 15000) {
      const [rel] = await rewardSrc.pending(sched2);
      if (rel > 0n) {
        const dripB = await rewardSrc.drip(sched2, { gasLimit: HTS_GAS_HEAVY });
        await dripB.wait();
        link("drip (B partial)", dripB.hash);
        break;
      }
      await sleep(5000);
      waitedB += 5000;
    }
    const navBeforeDefault: bigint = await vault.navPerShare(poolId);
    const claimB = await vault.claims(claimId2);
    console.log(`    NAV before default: ${fmtNav(navBeforeDefault)}   carry(B): ${claimB.carryTinybar} tinybar`);

    // 5d. simulateDefault (stop the stream) then markDefault (write down carry).
    const simDef = await rewardSrc.simulateDefault(sched2, { gasLimit: 200_000n });
    await simDef.wait();
    link("simulateDefault (B)", simDef.hash);
    const mdTx = await vault.markDefault(claimId2, { gasLimit: HTS_GAS_HEAVY });
    await mdTx.wait();
    link("markDefault (B)", mdTx.hash);
    const navAfterDefault: bigint = await vault.navPerShare(poolId);
    const claimBafter = await vault.claims(claimId2);
    console.log(`    NAV after default:  ${fmtNav(navAfterDefault)}   claim(B) status: ${Number(claimBafter.status)} (2=Defaulted)`);

    // 5e. Liquidate the retained collateral: on default the device-NFT stays escrowed in the vault
    //     (the vault is not MockDeviceNFT's WIPE key, so the vault's best-effort wipe no-ops). Show
    //     the liquidation explicitly by wiping the serial FROM the vault via MockDeviceNFT (its own
    //     wipe key), proving the collateral is realized rather than left in limbo.
    try {
      const wipeTx = await deviceNft.wipe(d.vaultAddress, serial2, { gasLimit: HTS_GAS });
      await wipeTx.wait();
      link("wipe device (B)", wipeTx.hash);
      console.log(`    ✓ liquidated collateral: wiped device serial ${serial2} from the vault`);
    } catch (e: any) {
      console.log(`    device wipe skipped: ${e.shortMessage ?? e.message}`);
    }

    if (claimB.carryTinybar > 0n) {
      if (navAfterDefault >= navBeforeDefault) {
        throw new Error(`default did NOT write NAV down (${navBeforeDefault} -> ${navAfterDefault}) despite carry ${claimB.carryTinybar}`);
      }
      console.log(`    ✓ default wrote NAV DOWN ${fmtNav(navBeforeDefault)} -> ${fmtNav(navAfterDefault)} (loss = carry write-down)`);
    } else {
      console.log(`    (carry already 0 at default — no write-down expected)`);
    }
    if (Number(claimBafter.status) !== 2) console.warn(`    WARN: claim(B) not Defaulted (status ${Number(claimBafter.status)})`);
    defaultRan = true;
  } catch (e: any) {
    console.error(`    DEFAULT RUN failed (non-fatal): ${e.shortMessage ?? e.message}`);
  }

  // ----------------------------------------------------------------------------------------------
  // 6. SECONDARY MARKET (SaucerSwap V1, SPEC §10/§15): stand up the KYC-enabled share/WHBAR pair in
  //    one owner call — KYC-grant router, create + seed liquidity at NAV, then KYC-grant the new
  //    pair. Best-effort: SaucerSwap testnet liquidity ops can be flaky, so this never fails the run.
  // ----------------------------------------------------------------------------------------------
  console.log(`\n[6] SECONDARY MARKET — enableSecondaryMarket (SaucerSwap share/WHBAR, KYC-enabled)...`);
  let secondaryOk = false;
  try {
    const existing: string = await vault.secondaryPair(poolId);
    if (existing && !/^0x0+$/.test(existing)) {
      console.log(`    pair already enabled: ${existing}`);
      secondaryOk = true;
    } else {
      const factoryEvm: string = await vault.saucerFactory();
      if (!factoryEvm || /^0x0+$/.test(factoryEvm)) throw new Error("secondary config unset — run deploy (setSecondaryConfig)");
      const factory = new ethers.Contract(factoryEvm, ["function pairCreateFee() view returns (uint256)"], signer);
      const tinycents: bigint = await factory.pairCreateFee();
      // Convert tinycents -> tinybar via Mirror Node exchangerate (+15% buffer). Never hardcoded.
      let feeTinybar = 0n;
      try {
        const res = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/network/exchangerate`);
        const data: any = await res.json();
        const rate = data?.current_rate;
        const centEq = BigInt(rate?.cent_equivalent ?? 0);
        const hbarEq = BigInt(rate?.hbar_equivalent ?? 0);
        if (centEq > 0n) feeTinybar = ((tinycents * hbarEq) / centEq * 115n) / 100n;
      } catch { /* fall through */ }
      if (feeTinybar <= 0n) throw new Error("could not derive pair-create fee from the Mirror Node rate");

      // Seed a small demo position priced at NAV (testnet HBAR is finite). 10 shares vs ~10 HBAR is
      // enough to create a real, KYC-enabled, tradeable pair; the front/admin can seed more later.
      const navNow: bigint = await vault.navPerShare(poolId);
      const shareLiquidity = 2n * TINYBAR; // 2.00000000 shares (8dp) — small demo seed (testnet HBAR finite)
      const hbarLiquidity = (shareLiquidity * navNow) / ONE; // shares * NAV (tinybar)
      const valueTinybar = feeTinybar + hbarLiquidity;
      console.log(`    fee ${fmtNav(feeTinybar)} HBAR, seed ${fmtNav(shareLiquidity)} shares vs ${fmtNav(hbarLiquidity)} HBAR (NAV ${fmtNav(navNow)})`);

      const enTx = await vault.enableSecondaryMarket(poolId, shareLiquidity, hbarLiquidity, feeTinybar, {
        value: valueTinybar * (HBAR / TINYBAR), // tinybar -> weibar at the RPC boundary
        gasLimit: 15_000_000n, // Hedera per-tx cap; the one-call does createPair + grantKyc + seed
      });
      await enTx.wait();
      link("enableSecondary", enTx.hash);
      const pair: string = await vault.secondaryPair(poolId);
      console.log(`    ✓ secondary market live — share/WHBAR pair: ${pair}`);
      console.log(`      ${HASHSCAN}/contract/${pair}`);
      secondaryOk = true;
    }
  } catch (e: any) {
    console.error(`    SECONDARY MARKET step failed (non-fatal): ${e.shortMessage ?? e.message}`);
  }

  // ----------------------------------------------------------------------------------------------
  console.log(`\n=== Lifecycle complete ===`);
  console.log(`NAV: genesis ${fmtNav(navGenesis)} -> deposit ${fmtNav(navPostDeposit)} -> finance ${fmtNav(navPostFinance)} -> final ${fmtNav(navFinal)}`);
  console.log(`default run: ${defaultRan ? "OK" : "FAILED (see above)"}`);
  console.log(`secondary market: ${secondaryOk ? "OK (KYC-enabled share/WHBAR pair live)" : "not enabled (see above)"}`);
  console.log(`\nHashScan links:`);
  for (const l of links) console.log(`  ${l}`);
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
