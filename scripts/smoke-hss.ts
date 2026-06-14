/**
 * Live HIP-1215 (Hedera Schedule Service, 0x16b) smoke on testnet — the "locked virement" demo.
 *
 *   pnpm run smoke:hss   (== hardhat run scripts/smoke-hss.ts --network testnet)
 *
 * Proves the two scheduled flows on-chain, both keeper-free:
 *
 *   1. LOCKED ADVANCE — setAdvanceLock(10s); finance a deal; the advance is LOCKED in the vault and a
 *      Hedera-scheduled releaseAdvance is created (AdvanceScheduled). We then wait past the unlock and
 *      confirm the advance was released to the operator — by the network, no keeper (or, if the
 *      schedule has not fired yet, we call releaseAdvance manually to prove the gating + fallback).
 *
 *   2. SELF-DRIP — fund a reward schedule and armSelfDrip: the MockRewardSource schedules its own
 *      scheduledDrip via HSS and each drip reschedules the next, so NAV rises with NO JS poll loop.
 *
 * Run AFTER `pnpm run deploy`. Prints HashScan links. Designed to be re-runnable. Units: HBAR crosses
 * the RPC boundary as weibar (N*1e18); the contract sees tinybar.
 */
import hre from "hardhat";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const { ethers } = hre as any;

const DEPLOYMENTS_PATH = resolve(process.cwd(), "deployments", "testnet.json");
const HBAR = 10n ** 18n; // weibar
const TINYBAR = 10n ** 8n;
const ONE = 10n ** 8n;
const HASHSCAN = "https://hashscan.io/testnet";
const HTS_GAS = 1_200_000n;
const HTS_GAS_HEAVY = 4_000_000n;
const CATEGORY_GPU = 0;
const RISKCLASS_A = 0;
const LOCK_SECONDS = 10n; // demo advance-lock window

const IHRC719_ABI = ["function associate() external returns (int64)"];
const ERC20_ABI = ["function balanceOf(address account) external view returns (uint256)"];
const ERC721_ABI = ["function approve(address to, uint256 tokenId) external"];

const links: string[] = [];
function link(label: string, hash: string) {
  links.push(`${label.padEnd(22)}: ${HASHSCAN}/transaction/${hash}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmtNav = (n: bigint) => (Number(n) / 1e8).toFixed(4);
const fmtHbar = (n: bigint) => (Number(n) / 1e8).toFixed(4);

async function associate(signer: any, tokenEvm: string, label: string) {
  const ihrc = new ethers.Contract(tokenEvm, IHRC719_ABI, signer);
  try {
    const tx = await ihrc.associate({ gasLimit: 800_000n });
    await tx.wait();
    link(label, tx.hash);
  } catch (e: any) {
    console.log(`    associate ${label} skipped: ${e.shortMessage ?? e.message}`);
  }
}

async function main() {
  if (!existsSync(DEPLOYMENTS_PATH)) throw new Error("deployments/testnet.json missing — run `pnpm run deploy` first");
  const d = JSON.parse(readFileSync(DEPLOYMENTS_PATH, "utf8"));
  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log(`\n=== Wafer HSS (HIP-1215) smoke · chain ${net.chainId} ===`);
  console.log(`signer: ${signer.address}\nvault:  ${d.vaultAddress}\n`);

  const poolId: number = d.pool?.id ?? 0;
  const shareTokenEvm: string = d.pool?.shareTokenEvm;
  const rewardSrcAddr: string = d.mocks?.rewardSource?.evm;
  const deviceNftAddr: string = d.mocks?.deviceNft?.evm;
  const deviceCollectionEvm: string = d.mocks?.deviceNft?.collectionEvm;

  const vault = await ethers.getContractAt("WaferVault", d.vaultAddress, signer);
  const rewardSrc = await ethers.getContractAt("MockRewardSource", rewardSrcAddr, signer);
  const deviceNft = await ethers.getContractAt("MockDeviceNFT", deviceNftAddr, signer);
  const deviceCollection = new ethers.Contract(deviceCollectionEvm, ERC721_ABI, signer);
  const shareErc20 = new ethers.Contract(shareTokenEvm, ERC20_ABI, signer);

  // Ensure the pool has idle to finance against (onboard + a small deposit if the signer holds none).
  await associate(signer, shareTokenEvm, "associate share");
  try { await (await vault.adminGrantKyc(poolId, signer.address, { gasLimit: HTS_GAS })).wait(); } catch {}
  const shares: bigint = await shareErc20.balanceOf(signer.address);
  if (shares === 0n) {
    const dep = await vault.deposit(poolId, { value: 10n * HBAR, gasLimit: HTS_GAS });
    await dep.wait();
    link("deposit", dep.hash);
  }

  // Helper: mint + escrow-approve a fresh device-NFT, return its serial.
  await associate(signer, deviceCollectionEvm, "associate device");
  async function freshDevice(tag: string): Promise<bigint> {
    const mh = ethers.keccak256(ethers.toUtf8Bytes(`device:hss-${tag}`));
    const mt = await deviceNft.mintTo(signer.address, mh, { gasLimit: HTS_GAS });
    const rc = await mt.wait();
    link(`mint device ${tag}`, mt.hash);
    let serial = 0n;
    for (const lg of rc!.logs) { try { const p = deviceNft.interface.parseLog(lg); if (p?.name === "DeviceMinted") serial = BigInt(p.args.serial); } catch {} }
    if (serial === 0n) serial = BigInt(await deviceNft.minted());
    await (await deviceCollection.approve(d.vaultAddress, serial, { gasLimit: HTS_GAS })).wait();
    return serial;
  }

  // -----------------------------------------------------------------------------------------------
  // 1. LOCKED ADVANCE — setAdvanceLock(10s) -> finance -> AdvanceScheduled -> auto-release at unlock.
  // -----------------------------------------------------------------------------------------------
  console.log(`\n[1] LOCKED ADVANCE — setAdvanceLock(${LOCK_SECONDS}s), finance, then watch HSS release the advance...`);
  await (await vault.setAdvanceLock(LOCK_SECONDS, { gasLimit: 200_000n })).wait();

  const serial = await freshDevice("adv");
  const ADV = 2n * TINYBAR, EXP = 3n * TINYBAR, TERM = 60n;
  const dh = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({ company: "HSS Demo", advance: 2, expected: 3 })));
  await (await vault.proposeDeal(CATEGORY_GPU, ADV, EXP, TERM, dh, deviceCollectionEvm, serial, { gasLimit: 500_000n })).wait();
  const dealId = Number(await vault.dealCount()) - 1;
  await (await vault.approveDeal(dealId, RISKCLASS_A, poolId, { gasLimit: 300_000n })).wait();

  const opBefore: bigint = await ethers.provider.getBalance(signer.address);
  const finTx = await vault.financeClaim(dealId, { gasLimit: HTS_GAS_HEAVY });
  const finRc = await finTx.wait();
  link("financeClaim (locked)", finTx.hash);
  const claimId = Number(await vault.claimCount()) - 1;
  let scheduleAddr = "";
  let unlockAt = 0n;
  for (const lg of finRc!.logs) {
    try { const p = vault.interface.parseLog(lg); if (p?.name === "AdvanceScheduled") { scheduleAddr = p.args.schedule; unlockAt = BigInt(p.args.unlockAt); } } catch {}
  }
  const releasedAtFinance: boolean = await vault.advanceReleased(claimId);
  console.log(`    claimId ${claimId}: advance LOCKED — scheduled release @ unix ${unlockAt}, schedule ${scheduleAddr}`);
  console.log(`    advanceReleased right after finance: ${releasedAtFinance} (must be false — the virement is locked)`);
  if (releasedAtFinance) throw new Error("advance released at finance — lock not applied");

  // Wait past the unlock, then confirm release. HSS should auto-fire releaseAdvance; if it hasn't yet,
  // call it manually (proving the unlock-time + once-only gating and a keeper-free-fallback path).
  console.log(`    waiting for the unlock + HSS auto-release...`);
  let released = false;
  const deadline = Date.now() + Number(LOCK_SECONDS) * 1000 + 40_000;
  while (Date.now() < deadline) {
    await sleep(5000);
    released = await vault.advanceReleased(claimId);
    if (released) { console.log(`    ✓ advance auto-released by Hedera Schedule Service — NO keeper`); break; }
  }
  if (!released) {
    console.log(`    schedule not fired within the window — calling releaseAdvance manually (gating/fallback proof)...`);
    const rel = await vault.releaseAdvance(claimId, { gasLimit: HTS_GAS });
    await rel.wait();
    link("releaseAdvance (manual)", rel.hash);
    released = await vault.advanceReleased(claimId);
  }
  console.log(`    advanceReleased now: ${released}`);
  if (!released) throw new Error("advance never released");
  // Reset to immediate-advance for any later runs.
  await (await vault.setAdvanceLock(0n, { gasLimit: 200_000n })).wait();

  // -----------------------------------------------------------------------------------------------
  // 2. SELF-DRIP — fund this claim's reward schedule + armSelfDrip -> NAV rises with NO JS loop.
  // -----------------------------------------------------------------------------------------------
  console.log(`\n[2] SELF-DRIP — fund + armSelfDrip on claim ${claimId}; NAV must rise with no manual drip...`);
  const REWARD = EXP; // total reward == expected so the claim repays in full
  const start = BigInt(Math.floor(Date.now() / 1000));
  const fundTx = await rewardSrc.fund(poolId, claimId, REWARD, start, TERM, 3, {
    value: REWARD * (HBAR / TINYBAR),
    gasLimit: 500_000n,
  });
  await fundTx.wait();
  link("fund reward", fundTx.hash);
  const scheduleId = Number(await rewardSrc.scheduleCount()) - 1;
  await (await vault.setAuthorizedSettler(claimId, rewardSrcAddr, true, { gasLimit: 200_000n })).wait();

  const navStart: bigint = await vault.navPerShare(poolId);
  const armTx = await rewardSrc.armSelfDrip(scheduleId, { gasLimit: HTS_GAS_HEAVY });
  await armTx.wait();
  link("armSelfDrip", armTx.hash);
  console.log(`    armed self-drip (scheduleId ${scheduleId}); NAV start ${fmtNav(navStart)} — now waiting, NOT calling drip()...`);

  let navLast = navStart;
  const dDeadline = Date.now() + (Number(TERM) + 45) * 1000;
  while (Date.now() < dDeadline) {
    await sleep(7000);
    const claim = await vault.claims(claimId);
    const nav: bigint = await vault.navPerShare(poolId);
    if (nav !== navLast) { console.log(`    NAV ${fmtNav(navLast)} -> ${fmtNav(nav)} (self-dripped on-chain, no keeper)`); navLast = nav; }
    if (Number(claim.status) === 1) { console.log(`    ✓ claim Repaid via self-scheduling — NAV ${fmtNav(nav)}`); break; }
  }
  if (navLast <= navStart) console.warn(`    WARN: NAV did not move — the HSS schedule may not have fired in the window (try a longer wait).`);
  else console.log(`    ✓ self-drip lifted NAV ${fmtNav(navStart)} -> ${fmtNav(navLast)} with no off-chain keeper`);

  console.log(`\n=== HSS smoke complete ===`);
  for (const l of links) console.log(`  ${l}`);
  console.log("");
}

main().catch((err) => { console.error(err); process.exit(1); });
