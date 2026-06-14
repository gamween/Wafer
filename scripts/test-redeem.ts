/** Prove redeem works now that the share token has no fee (operator->vault pull + full-share burn). */
import hre from "hardhat";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const { ethers } = hre as any;
const HBAR = 10n ** 18n, TINYBAR = 10n ** 8n, HASHSCAN = "https://hashscan.io/testnet";

async function main() {
  const d = JSON.parse(readFileSync(resolve(process.cwd(), "deployments", "testnet.json"), "utf8"));
  const [signer] = await ethers.getSigners();
  const vault = await ethers.getContractAt("WaferVault", d.vaultAddress, signer);
  const share = new ethers.Contract(d.pool.shareTokenEvm, [
    "function approve(address,uint256) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
  ], signer);
  const poolId = d.pool.id ?? 0;
  const shares = 1n * TINYBAR; // redeem 1.0 share

  const nav: bigint = await vault.navPerShare(poolId);
  const preShares: bigint = await share.balanceOf(signer.address);
  const preHbar: bigint = await ethers.provider.getBalance(signer.address);
  console.log(`NAV ${Number(nav) / 1e8}  preShares ${Number(preShares) / 1e8}  redeeming 1.0 share...`);

  await (await share.approve(d.vaultAddress, shares, { gasLimit: 1_200_000n })).wait();
  // staticCall first (free) to surface any revert
  const [filled, queued] = await vault.redeem.staticCall(poolId, shares, { gasLimit: 4_000_000n });
  console.log(`  staticCall OK -> filled ${Number(filled) / 1e8} HBAR, queued ${Number(queued) / 1e8}`);

  const tx = await vault.redeem(poolId, shares, { gasLimit: 4_000_000n });
  await tx.wait();
  console.log(`  redeem tx: ${HASHSCAN}/transaction/${tx.hash}`);

  const postShares: bigint = await share.balanceOf(signer.address);
  const postHbar: bigint = await ethers.provider.getBalance(signer.address);
  console.log(`  shares ${Number(preShares) / 1e8} -> ${Number(postShares) / 1e8} (burned ${Number(preShares - postShares) / 1e8})`);
  console.log(`  HBAR delta (net of gas): ${Number(postHbar - preHbar) / 1e18}`);
  console.log(preShares - postShares === shares ? "  ✓ exactly 1.0 share burned (no fee) — redeem works" : "  WARN: share delta != 1.0");
}
main().catch((e) => { console.error(e); process.exit(1); });
