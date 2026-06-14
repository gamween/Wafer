/**
 * Redeploy ONLY the MockRewardSource against the existing vault and patch deployments/testnet.json.
 *
 *   pnpm run redeploy-mock   (== hardhat run scripts/redeploy-mock.ts --network testnet)
 *
 * The mock is independent of the vault (it just calls vault.settleRewards), so a gas/config tweak to
 * the mock doesn't require a full stack redeploy. Updates mocks.rewardSource (+ hashscan link) only.
 */
import hre from "hardhat";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const { ethers } = hre as any;
const DEPLOYMENTS_PATH = resolve(process.cwd(), "deployments", "testnet.json");
const HASHSCAN = "https://hashscan.io/testnet";
const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";

async function resolveContractId(evm: string): Promise<string> {
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(`${MIRROR}/contracts/${evm}`, { headers: { "User-Agent": "curl/8" } });
      if (res.ok) { const data: any = await res.json(); if (data.contract_id) return data.contract_id; }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return "";
}

async function main() {
  if (!existsSync(DEPLOYMENTS_PATH)) throw new Error("deployments/testnet.json missing — run `pnpm run deploy` first");
  const d = JSON.parse(readFileSync(DEPLOYMENTS_PATH, "utf8"));
  const vaultAddr: string = d.vaultAddress;
  if (!vaultAddr) throw new Error("vaultAddress missing in deployments/testnet.json");

  const [deployer] = await ethers.getSigners();
  console.log(`\n=== Redeploy MockRewardSource against vault ${vaultAddr} ===`);
  console.log(`deployer: ${deployer.address}\n`);

  const RewardSrc = await ethers.getContractFactory("MockRewardSource");
  const rewardSrc = await RewardSrc.deploy(vaultAddr, { gasLimit: 2_500_000n });
  await rewardSrc.waitForDeployment();
  const addr: string = await rewardSrc.getAddress();
  const id = await resolveContractId(addr);
  console.log(`new MockRewardSource: ${addr}  (${id})`);

  d.mocks = d.mocks || {};
  d.mocks.rewardSource = { evm: addr, id };
  d.hashscan = d.hashscan || {};
  d.hashscan.rewardSource = `${HASHSCAN}/contract/${addr}`;
  d.updatedAt = new Date().toISOString();
  writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(d, null, 2) + "\n");
  console.log(`✓ patched deployments/testnet.json mocks.rewardSource`);
  console.log(`  ${HASHSCAN}/contract/${addr}\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
