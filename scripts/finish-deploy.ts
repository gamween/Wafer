/**
 * One-off recovery: finish a half-completed `pnpm run deploy` against an ALREADY-deployed vault.
 *
 *   VAULT=0x... POOL_ID=0 SHARE=0x... CLAIM=0x... \
 *     TS_NODE_PROJECT=tsconfig.hardhat.json hardhat run scripts/finish-deploy.ts --network testnet
 *
 * Deploys MockRewardSource + MockDeviceNFT (+ createCollection) against the existing vault, then
 * writes deployments/testnet.json. Used when the main deploy ran out of testnet HBAR mid-way after
 * the vault/pool/secondary-config were already created (no point burning another 100 HBAR on a new
 * pool). The vault, pool, operator whitelist and SaucerSwap config are assumed already on-chain.
 */
import hre from "hardhat";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const { ethers } = hre as any;

const REPO_ROOT = process.cwd();
const DEPLOYMENTS_PATH = resolve(REPO_ROOT, "deployments", "testnet.json");
const ENV_PATH = resolve(REPO_ROOT, ".env");

const HBAR = 10n ** 18n;
// HTS NFT-collection create is ~$1; the precompile refunds excess to the contract. Trimmed to fit
// the remaining operator budget (override with DEVICE_FUNDING_HBAR).
const DEVICE_CREATE_FUNDING = BigInt(process.env.DEVICE_FUNDING_HBAR ?? "22") * HBAR;
const CREATE_GAS = 10_000_000n;

const HASHSCAN = "https://hashscan.io/testnet";
const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";

const SAUCER_ROUTER = "0x0000000000000000000000000000000000004b40";
const SAUCER_WHBAR = "0x0000000000000000000000000000000000003ad2";
const SAUCER_FACTORY = "0x00000000000000000000000000000000000026e7";

const POOL_NAME = "Wafer GPU-A";
const POOL_SYMBOL = "wGPUA";

function evmToHederaId(evm: string): string {
  return `0.0.${BigInt(evm).toString()}`;
}

async function resolveContractId(evm: string): Promise<string> {
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(`${MIRROR}/contracts/${evm}`, { headers: { "User-Agent": "curl/8" } });
      if (res.ok) {
        const data: any = await res.json();
        if (data.contract_id) return data.contract_id;
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return "";
}

function updateEnv(updates: Record<string, string>): void {
  if (!existsSync(ENV_PATH)) return;
  const lines = readFileSync(ENV_PATH, "utf8").split("\n");
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const m = line.match(/^(\s*)([A-Z0-9_]+)=/);
    if (m && updates[m[2]] !== undefined) {
      seen.add(m[2]);
      const comment = line.includes("#") ? "   " + line.slice(line.indexOf("#")) : "";
      return `${m[1]}${m[2]}=${updates[m[2]]}${comment}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(updates)) if (!seen.has(k)) out.push(`${k}=${v}`);
  writeFileSync(ENV_PATH, out.join("\n"));
}

async function main() {
  const vaultAddr = process.env.VAULT;
  if (!vaultAddr) throw new Error("set VAULT=0x... (the already-deployed vault address)");
  const poolId = Number(process.env.POOL_ID ?? "0");

  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`\n=== Finish Wafer deploy · chain ${net.chainId} ===`);
  console.log(`deployer : ${deployer.address}`);
  console.log(`balance  : ${ethers.formatEther(bal)} HBAR`);
  console.log(`vault    : ${vaultAddr}\n`);

  const vault = await ethers.getContractAt("WaferVault", vaultAddr, deployer);
  const pool = await vault.pools(poolId);
  const shareTokenEvm: string = pool.shareToken;
  const claimNftEvm: string = pool.claimNft;
  if (!shareTokenEvm || /^0x0+$/.test(shareTokenEvm)) throw new Error("pool not created on this vault");
  const shareTokenId = evmToHederaId(shareTokenEvm);
  const claimNftId = evmToHederaId(claimNftEvm);
  console.log(`  share token : ${shareTokenEvm} (${shareTokenId})`);
  console.log(`  claim NFT   : ${claimNftEvm} (${claimNftId})`);

  const nav = await vault.navPerShare(poolId);
  console.log(`  navPerShare : ${nav.toString()} (expect 100000000)`);

  let rewardSrcAddr: string = process.env.REWARD_SRC ?? "";
  if (rewardSrcAddr) {
    console.log(`\nreusing MockRewardSource: ${rewardSrcAddr}`);
  } else {
    console.log(`\ndeploying MockRewardSource(vault)...`);
    const RewardSrc = await ethers.getContractFactory("MockRewardSource");
    const rewardSrc = await RewardSrc.deploy(vaultAddr, { gasLimit: 2_000_000n });
    await rewardSrc.waitForDeployment();
    rewardSrcAddr = await rewardSrc.getAddress();
    console.log(`  MockRewardSource: ${rewardSrcAddr}`);
  }

  let deviceNftAddr: string = process.env.DEVICE_NFT ?? "";
  let deviceNft: any;
  if (deviceNftAddr) {
    console.log(`\nreusing MockDeviceNFT: ${deviceNftAddr}`);
    deviceNft = await ethers.getContractAt("MockDeviceNFT", deviceNftAddr, deployer);
  } else {
    console.log(`\ndeploying MockDeviceNFT...`);
    const DeviceNFT = await ethers.getContractFactory("MockDeviceNFT");
    deviceNft = await DeviceNFT.deploy({ gasLimit: 3_000_000n });
    await deviceNft.waitForDeployment();
    deviceNftAddr = await deviceNft.getAddress();
    console.log(`  MockDeviceNFT: ${deviceNftAddr}`);
  }

  let deviceTokenEvm: string = await deviceNft.token();
  if (!deviceTokenEvm || /^0x0+$/.test(deviceTokenEvm)) {
    console.log(`  createCollection (funding ${DEVICE_CREATE_FUNDING / HBAR} HBAR)...`);
    const ccTx = await deviceNft.createCollection("Wafer Device", "wDEV", {
      value: DEVICE_CREATE_FUNDING,
      gasLimit: CREATE_GAS,
    });
    await ccTx.wait();
    deviceTokenEvm = await deviceNft.token();
  } else {
    console.log(`  collection already created: ${deviceTokenEvm}`);
  }
  const deviceTokenId = evmToHederaId(deviceTokenEvm);
  console.log(`  device collection: ${deviceTokenEvm} (${deviceTokenId})`);

  const vaultHederaId = await resolveContractId(vaultAddr);
  const rewardSrcHederaId = await resolveContractId(rewardSrcAddr);
  const deviceNftHederaId = await resolveContractId(deviceNftAddr);

  const now = new Date().toISOString();
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
      id: poolId, name: POOL_NAME, symbol: POOL_SYMBOL, category: "GPU", class: "A",
      shareTokenEvm, shareTokenId, claimNftEvm, claimNftId,
    },
    mocks: {
      rewardSource: { evm: rewardSrcAddr, id: rewardSrcHederaId },
      deviceNft: { evm: deviceNftAddr, id: deviceNftHederaId, collectionEvm: deviceTokenEvm, collectionId: deviceTokenId },
    },
    secondary: { router: SAUCER_ROUTER, whbar: SAUCER_WHBAR, factory: SAUCER_FACTORY },
    hashscan: {
      vault: `${HASHSCAN}/contract/${vaultAddr}`,
      shareToken: `${HASHSCAN}/token/${shareTokenId}`,
      claimNft: `${HASHSCAN}/token/${claimNftId}`,
      rewardSource: `${HASHSCAN}/contract/${rewardSrcAddr}`,
      deviceNft: `${HASHSCAN}/contract/${deviceNftAddr}`,
      deviceCollection: `${HASHSCAN}/token/${deviceTokenId}`,
    },
    sourcify: `https://repo.sourcify.dev/contracts/full_match/296/${vaultAddr}/`,
  };
  mkdirSync(dirname(DEPLOYMENTS_PATH), { recursive: true });
  writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(deployment, null, 2) + "\n");
  updateEnv({ VAULT_ADDRESS: vaultAddr, SHARE_TOKEN_ID: shareTokenId, CLAIM_NFT_TOKEN_ID: claimNftId });
  console.log(`\n✓ wrote ${DEPLOYMENTS_PATH}`);
  console.log(`✓ wrote VAULT_ADDRESS to .env`);
  console.log(`\nNext: pnpm run smoke\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
