/**
 * Deploy the Wafer stack live on Hedera testnet (chain 296) and create the first pool.
 *
 *   pnpm run deploy   (== hardhat run scripts/deploy.ts --network testnet)
 *
 * Steps (SPEC §14):
 *   1. deploy WaferVault (signed by the operator's ECDSA key from .env via hardhat.config).
 *   2. createPool(Category.GPU, RiskClass.A, "Wafer GPU-A", "wGPUA") funded ~100 HBAR (two HTS
 *      creates: share-with-fee + claim-NFT) + seed dead shares (anti-inflation). gas 10M.
 *   3. read PoolCreated -> share token + claim NFT EVM addresses -> Hedera 0.0.x ids.
 *   4. registerOperator(operator, true) so the operator can proposeDeal in the smoke run.
 *   5. deploy MockRewardSource(vault) and MockDeviceNFT() (the only mocks, SPEC §9/§8).
 *   6. persist every id/address to deployments/testnet.json and VAULT_ADDRESS into .env.
 *
 * HTS-touching calls pin a high gasLimit (Hashio mis-estimates). Token creates are payable —
 * excess HBAR is refunded to the contract by the network and stays as working idle HBAR.
 */
import hre from "hardhat";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const { ethers } = hre as any;

// Hardhat runs scripts from the project root (process.cwd()).
const REPO_ROOT = process.cwd();
const DEPLOYMENTS_PATH = resolve(REPO_ROOT, "deployments", "testnet.json");
const ENV_PATH = resolve(REPO_ROOT, ".env");

// Pool taxonomy (SPEC §4.1 enums): Category.GPU = 0, RiskClass.A = 0.
const CATEGORY_GPU = 0;
const RISKCLASS_A = 0;
const POOL_NAME = "Wafer GPU-A";
const POOL_SYMBOL = "wGPUA";

const HBAR = 10n ** 18n; // 1 HBAR in weibar (RPC boundary)
// Two HTS creates (~60 + ~30 HBAR); createPool forwards the full balance to each (precompile
// refunds the excess), so ~100 HBAR funds both and the refund seeds working idle HBAR.
// INVARIANT (vault createPool): the attached value must cover BOTH the two HTS create fees AND the
// 1000-tinybar DEAD_SEED (require balance >= DEAD_SEED_TINYBAR after the creates, else SEED_HBAR_SHORT).
// 100 HBAR trivially clears this today; if SaucerSwap/HTS create fees ever rose to consume the entire
// attached value, createPool would revert SEED_HBAR_SHORT — bump POOL_FUNDING accordingly.
const POOL_FUNDING = 100n * HBAR;
const CREATE_GAS = 10_000_000n;
// Device-NFT collection create also goes through the precompile; ~40 HBAR covers it.
const DEVICE_CREATE_FUNDING = 40n * HBAR;

// SaucerSwap V1 testnet (SPEC §10): RouterV3, WHBAR token, Factory (long-zero EVM addresses).
const SAUCER_ROUTER = "0x0000000000000000000000000000000000004b40";
const SAUCER_WHBAR = "0x0000000000000000000000000000000000003ad2";
const SAUCER_FACTORY = "0x00000000000000000000000000000000000026e7";

const HASHSCAN = "https://hashscan.io/testnet";
const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";

/** HTS tokens get a "long-zero" EVM address; the Hedera id is 0.0.<lower 64 bits>. */
function evmToHederaId(evm: string): string {
  return `0.0.${BigInt(evm).toString()}`;
}

/** Resolve a deployed contract's Hedera 0.0.x id from its EVM address via the Mirror Node. */
async function resolveContractId(evm: string): Promise<string> {
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(`${MIRROR}/contracts/${evm}`, { headers: { "User-Agent": "curl/8" } });
      if (res.ok) {
        const data: any = await res.json();
        if (data.contract_id) return data.contract_id;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 2500)); // mirror lags consensus a few seconds
  }
  return ""; // best-effort; the EVM address is the canonical id anyway
}

/** Rewrite specific keys in .env without touching secrets/comments. */
function updateEnv(updates: Record<string, string>): void {
  if (!existsSync(ENV_PATH)) return;
  const lines = readFileSync(ENV_PATH, "utf8").split("\n");
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const m = line.match(/^(\s*)([A-Z0-9_]+)=/);
    if (m && updates[m[2]] !== undefined) {
      seen.add(m[2]);
      // preserve any trailing inline comment
      const comment = line.includes("#") ? "   " + line.slice(line.indexOf("#")) : "";
      return `${m[1]}${m[2]}=${updates[m[2]]}${comment}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(updates)) if (!seen.has(k)) out.push(`${k}=${v}`);
  writeFileSync(ENV_PATH, out.join("\n"));
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`\n=== Deploy Wafer stack · chain ${net.chainId} ===`);
  console.log(`deployer : ${deployer.address}`);
  console.log(`balance  : ${ethers.formatEther(bal)} HBAR\n`);

  // 1. Deploy the vault.
  const Vault = await ethers.getContractFactory("WaferVault");
  const vault = await Vault.deploy({ gasLimit: 6_000_000n });
  await vault.waitForDeployment();
  const vaultAddr: string = await vault.getAddress();
  const deployTx = vault.deploymentTransaction();
  console.log(`vault deployed: ${vaultAddr}`);
  console.log(`  tx: ${HASHSCAN}/transaction/${deployTx?.hash}`);

  // 2. Create the first pool (GPU-A): two funded HTS creates + dead-share seed.
  console.log(`\ncreating pool "${POOL_NAME}" (${POOL_SYMBOL}, GPU/A) — funding ${POOL_FUNDING / HBAR} HBAR...`);
  const cpTx = await vault.createPool(CATEGORY_GPU, RISKCLASS_A, POOL_NAME, POOL_SYMBOL, {
    value: POOL_FUNDING,
    gasLimit: CREATE_GAS,
  });
  const cpReceipt = await cpTx.wait();
  console.log(`  createPool tx: ${HASHSCAN}/transaction/${cpTx.hash}`);

  // 3. Parse PoolCreated for the token addresses.
  let poolId = 0;
  let shareTokenEvm = "";
  let claimNftEvm = "";
  for (const log of cpReceipt!.logs) {
    try {
      const parsed = vault.interface.parseLog(log);
      if (parsed?.name === "PoolCreated") {
        poolId = Number(parsed.args.poolId);
        shareTokenEvm = parsed.args.shareToken;
        claimNftEvm = parsed.args.claimNft;
      }
    } catch {
      /* not our event */
    }
  }
  if (!shareTokenEvm) throw new Error("PoolCreated event not found — pool creation may have failed");

  const shareTokenId = evmToHederaId(shareTokenEvm);
  const claimNftId = evmToHederaId(claimNftEvm);
  console.log(`  poolId       : ${poolId}`);
  console.log(`  share token  : ${shareTokenEvm}  (${shareTokenId})`);
  console.log(`  claim NFT    : ${claimNftEvm}  (${claimNftId})`);

  // Sanity: genesis NAV must be ONE (1e8) — the dead-share seed pins it.
  const nav = await vault.navPerShare(poolId);
  console.log(`  navPerShare  : ${nav.toString()} (genesis, expect 100000000)`);
  if (nav.toString() !== "100000000") {
    console.warn(`  WARN: genesis NAV != ONE (${nav.toString()}) — check dead-share seeding`);
  }

  // 4. Whitelist the operator so it can proposeDeal in the smoke run.
  console.log(`\nregisterOperator(${deployer.address}, true)...`);
  const roTx = await vault.registerOperator(deployer.address, true, { gasLimit: 200_000n });
  await roTx.wait();
  console.log(`  registerOperator tx: ${HASHSCAN}/transaction/${roTx.hash}`);

  // 4b. Wire the SaucerSwap V1 addresses on-chain so enableSecondaryMarket works (SPEC §10).
  console.log(`\nsetSecondaryConfig(router, WHBAR, factory)...`);
  const scTx = await vault.setSecondaryConfig(SAUCER_ROUTER, SAUCER_WHBAR, SAUCER_FACTORY, { gasLimit: 200_000n });
  await scTx.wait();
  console.log(`  setSecondaryConfig tx: ${HASHSCAN}/transaction/${scTx.hash}`);

  // 5. Deploy the demo mocks (SPEC §9 reward source, §8 device-NFT collateral).
  console.log(`\ndeploying MockRewardSource(vault)...`);
  const RewardSrc = await ethers.getContractFactory("MockRewardSource");
  const rewardSrc = await RewardSrc.deploy(vaultAddr, { gasLimit: 2_000_000n });
  await rewardSrc.waitForDeployment();
  const rewardSrcAddr: string = await rewardSrc.getAddress();
  console.log(`  MockRewardSource: ${rewardSrcAddr}`);

  console.log(`\ndeploying MockDeviceNFT + createCollection...`);
  const DeviceNFT = await ethers.getContractFactory("MockDeviceNFT");
  const deviceNft = await DeviceNFT.deploy({ gasLimit: 3_000_000n });
  await deviceNft.waitForDeployment();
  const deviceNftAddr: string = await deviceNft.getAddress();
  console.log(`  MockDeviceNFT: ${deviceNftAddr}`);

  const ccTx = await deviceNft.createCollection("Wafer Device", "wDEV", {
    value: DEVICE_CREATE_FUNDING,
    gasLimit: CREATE_GAS,
  });
  await ccTx.wait();
  const deviceTokenEvm: string = await deviceNft.token();
  const deviceTokenId = evmToHederaId(deviceTokenEvm);
  console.log(`  device collection: ${deviceTokenEvm}  (${deviceTokenId})`);
  console.log(`  createCollection tx: ${HASHSCAN}/transaction/${ccTx.hash}`);

  // Resolve Hedera ids via Mirror Node (best-effort; EVM address is canonical anyway).
  const vaultHederaId = await resolveContractId(vaultAddr);
  const rewardSrcHederaId = await resolveContractId(rewardSrcAddr);
  const deviceNftHederaId = await resolveContractId(deviceNftAddr);

  // 6. Persist.
  const now = new Date().toISOString();
  const prior = existsSync(DEPLOYMENTS_PATH) ? JSON.parse(readFileSync(DEPLOYMENTS_PATH, "utf8")) : {};
  const deployment = {
    network: "testnet",
    chainId: Number(net.chainId),
    createdAt: now,
    updatedAt: now,
    settlementAsset: "HBAR",
    operator: deployer.address,
    vaultAddress: vaultAddr,
    vaultId: vaultHederaId,
    pool: {
      id: poolId,
      name: POOL_NAME,
      symbol: POOL_SYMBOL,
      category: "GPU",
      class: "A",
      shareTokenEvm,
      shareTokenId,
      claimNftEvm,
      claimNftId,
    },
    mocks: {
      rewardSource: { evm: rewardSrcAddr, id: rewardSrcHederaId },
      deviceNft: {
        evm: deviceNftAddr,
        id: deviceNftHederaId,
        collectionEvm: deviceTokenEvm,
        collectionId: deviceTokenId,
      },
    },
    secondary: {
      router: SAUCER_ROUTER,
      whbar: SAUCER_WHBAR,
      factory: SAUCER_FACTORY,
    },
    hashscan: {
      vault: `${HASHSCAN}/contract/${vaultAddr}`,
      shareToken: `${HASHSCAN}/token/${shareTokenId}`,
      claimNft: `${HASHSCAN}/token/${claimNftId}`,
      rewardSource: `${HASHSCAN}/contract/${rewardSrcAddr}`,
      deviceNft: `${HASHSCAN}/contract/${deviceNftAddr}`,
      deviceCollection: `${HASHSCAN}/token/${deviceTokenId}`,
      deployTx: `${HASHSCAN}/transaction/${deployTx?.hash}`,
      createPoolTx: `${HASHSCAN}/transaction/${cpTx.hash}`,
    },
    sourcify: `https://repo.sourcify.dev/contracts/full_match/296/${vaultAddr}/`,
  };
  mkdirSync(dirname(DEPLOYMENTS_PATH), { recursive: true });
  writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(deployment, null, 2) + "\n");
  updateEnv({
    VAULT_ADDRESS: vaultAddr,
    SHARE_TOKEN_ID: shareTokenId,
    CLAIM_NFT_TOKEN_ID: claimNftId,
  });

  console.log(`\n✓ wrote ${DEPLOYMENTS_PATH}`);
  console.log(`✓ wrote VAULT_ADDRESS to .env`);
  console.log(`\nHashScan:`);
  for (const [k, v] of Object.entries(deployment.hashscan)) console.log(`  ${k.padEnd(16)}: ${v}`);
  console.log(`\nNext: pnpm run verify ${vaultAddr}   then   pnpm run smoke\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
