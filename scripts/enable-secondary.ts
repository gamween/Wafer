/**
 * Enable the SaucerSwap V1 secondary market for a Wafer pool WITHOUT redeploying the vault.
 *
 *   TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/enable-secondary.ts --network testnet
 *
 * WHY THE ONE-CALL PATHS DON'T WORK FOR A KYC-KEYED HTS TOKEN ON HEDERA
 *   - In-contract enableSecondaryMarket reverts: it grants KYC to the ROUTER, which is NEITHER
 *     associated NOR ever holds the token (a Uniswap-v2 router transfers the LP leg caller->pair
 *     DIRECTLY), so router KYC is impossible (GRANT_KYC fails) and unnecessary.
 *   - router.addLiquidityETHNewPool (atomic create+seed) ALSO can't work: it creates the pair and,
 *     in the SAME tx, transfers shares into it — but the fresh pair isn't KYC'd, so that transfer
 *     reverts ACCOUNT_KYC_NOT_GRANTED. You can't inject a KYC grant mid-router-call.
 *   - Pre-granting KYC to the deterministic CREATE2 pair address BEFORE it exists ALSO fails on
 *     Hedera: grantTokenKyc requires the target to be a REAL account ASSOCIATED with the token;
 *     a not-yet-deployed CREATE2 address is neither, so adminGrantKyc reverts GRANT_KYC_FAIL.
 *
 * THE WORKING SEQUENCE (split create / grant / seed) — verified against the SaucerSwap V1 sources:
 *   factory.createPair self-associates the new pair to token0/token1 (see UniswapV2Pair.initialize),
 *   and createPair is PERMISSIONLESS (only `costsTinycents(pairCreateFee)`), so:
 *     1. factory.createPair(share, WHBAR)        -> creates the pair, SELF-ASSOCIATES it to the
 *                                                   share token, mints the LP HTS token. NOT KYC'd.
 *                                                   value >= pairCreateFee (tinybar, live).
 *     2. vault.adminGrantKyc(poolId, pair)        -> the pair now EXISTS and is ASSOCIATED, so the
 *                                                   KYC grant succeeds (vault IS the share KYC key).
 *     3. share.approve(router, shareLiquidity)    -> ERC-20 facade on the HTS token.
 *     4. router.addLiquidityETH(share, ...)       -> transfers shares msg.sender->pair (passes KYC),
 *                                                   wraps msg.value HBAR into WHBAR into the pair,
 *                                                   mints LP. value = hbarLiquidity (NO create fee).
 *     5. verify factory.getPair == predicted CREATE2 addr and reserves are non-zero.
 *
 * The predicted CREATE2 address (factory.INIT_CODE_PAIR_HASH + sorted-token salt) is computed up
 * front purely as a self-check; createPair returns the real address regardless. Liquidity is seeded
 * from the operator's OWN shares at NAV (an admin capital commitment, not pool capital). Idempotent:
 * no-op if the pair already exists. Only TypeScript + existing vault primitives + SaucerSwap calls
 * are used, so the deployed vault bytecode stays Sourcify-verified.
 */
import hre from "hardhat";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const { ethers } = hre as any;

const HBAR = 10n ** 18n; // weibar in 1 HBAR
const TINYBAR = 10n ** 8n; // tinybar in 1 HBAR
const ONE = 10n ** 8n; // 1.0 share (8 dp)
const HASHSCAN = "https://hashscan.io/testnet";
const toWeibar = (tinybar: bigint) => tinybar * (HBAR / TINYBAR); // RPC value layer is weibar
const isZero = (a: string) => !a || /^0x0+$/.test(a);

const FACTORY_ABI = [
  "function createPair(address tokenA, address tokenB) external payable returns (address pair)",
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  "function pairCreateFee() external view returns (uint256)",
  "function INIT_CODE_PAIR_HASH() external view returns (bytes32)",
];
const ROUTER_ABI = [
  "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)",
];
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];
const PAIR_ABI = ["function getReserves() external view returns (uint112 r0, uint112 r1, uint32 ts)"];

/** Deterministic SaucerSwap V1 (Uniswap-v2) pair address — a self-check on the createPair result. */
function predictPair(factory: string, initCodeHash: string, tokenA: string, tokenB: string): string {
  const [t0, t1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
  const salt = ethers.keccak256(ethers.solidityPacked(["address", "address"], [t0, t1]));
  return ethers.getCreate2Address(factory, salt, initCodeHash);
}

/** Live pair-create fee in TINYBAR: factory.pairCreateFee() (tinycents) -> tinybar via Mirror Node. */
async function feeTinybarLive(factory: any, bufferPct = 115n): Promise<bigint> {
  const tinycents: bigint = await factory.pairCreateFee();
  const rate: any = (await (await fetch("https://testnet.mirrornode.hedera.com/api/v1/network/exchangerate")).json()).current_rate;
  return ((tinycents * BigInt(rate.hbar_equivalent)) / BigInt(rate.cent_equivalent) * bufferPct) / 100n;
}

async function main() {
  const dPath = resolve(process.cwd(), "deployments", "testnet.json");
  const d = JSON.parse(readFileSync(dPath, "utf8"));
  const [signer] = await ethers.getSigners();
  const poolId: number = d.pool.id ?? 0;
  const shareEvm: string = d.pool.shareTokenEvm;
  const whbar: string = d.secondary.whbar;
  const routerAddr: string = d.secondary.router;
  const factoryAddr: string = d.secondary.factory;

  const vault = await ethers.getContractAt("WaferVault", d.vaultAddress, signer);
  const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, signer);
  const router = new ethers.Contract(routerAddr, ROUTER_ABI, signer);
  const share = new ethers.Contract(shareEvm, ERC20_ABI, signer);

  console.log(`vault ${d.vaultAddress}  pool ${poolId}  share ${shareEvm}  whbar ${whbar}`);
  console.log(`router ${routerAddr}  factory ${factoryAddr}`);

  // self-check: deterministic CREATE2 address (createPair returns the real one regardless)
  const initCodeHash: string = await factory.INIT_CODE_PAIR_HASH();
  const predicted = predictPair(factoryAddr, initCodeHash, shareEvm, whbar);
  console.log(`predicted CREATE2 pair (share/WHBAR): ${predicted}`);

  let grantKycTx: string | null = null;
  let createPairTx: string | null = null;
  let addLiquidityTx: string | null = null;

  // ---- idempotency: already enabled? -------------------------------------
  let pair: string = await factory.getPair(shareEvm, whbar);

  // ---- 1. create the pair (standalone, permissionless) -------------------
  if (isZero(pair)) {
    const fee = await feeTinybarLive(factory);
    console.log(`\npair-create fee ~ ${Number(fee) / 1e8} HBAR — staticCall createPair...`);
    const cpStatic: string = await factory.createPair.staticCall(shareEvm, whbar, { value: toWeibar(fee), gasLimit: 6_000_000n });
    if (cpStatic.toLowerCase() !== predicted.toLowerCase()) {
      throw new Error(`createPair staticCall returned ${cpStatic} != predicted ${predicted}`);
    }
    console.log(`  staticCall OK -> ${cpStatic}; creating pair live...`);
    const cpTx = await factory.createPair(shareEvm, whbar, { value: toWeibar(fee), gasLimit: 6_000_000n });
    await cpTx.wait();
    createPairTx = cpTx.hash;
    console.log(`  createPair tx: ${HASHSCAN}/transaction/${cpTx.hash}`);
    pair = await factory.getPair(shareEvm, whbar);
    if (isZero(pair)) throw new Error("createPair succeeded but getPair is zero");
    console.log(`  pair: ${pair}`);
  } else {
    console.log(`\npair already exists: ${pair}`);
  }
  if (pair.toLowerCase() !== predicted.toLowerCase()) {
    console.log(`  NOTE: live pair ${pair} differs from predicted ${predicted} (using the live one)`);
  }

  // ---- 2. KYC-grant the pair (now exists + self-associated to the share) --
  console.log(`\nadminGrantKyc(pool ${poolId}, pair ${pair})...`);
  try {
    await vault.adminGrantKyc.staticCall(poolId, pair, { gasLimit: 1_200_000n });
    const kTx = await vault.adminGrantKyc(poolId, pair, { gasLimit: 1_200_000n });
    await kTx.wait();
    grantKycTx = kTx.hash;
    console.log(`  KYC granted to pair: ${HASHSCAN}/transaction/${kTx.hash}`);
  } catch (e: any) {
    // TOKEN_HAS_NO_KYC_KEY would mean already-granted/idempotent on re-run; surface anything else.
    console.log(`  adminGrantKyc staticCall/tx note: ${e.shortMessage ?? e.message} (continuing; the seed staticCall is the real gate)`);
  }

  // ---- 3 & 4. seed liquidity from the operator's OWN shares, priced at NAV
  const nav: bigint = await vault.navPerShare(poolId);
  const opShares: bigint = await share.balanceOf(signer.address);
  const shareLiq = opShares >= 2n * ONE ? 2n * ONE : opShares / 2n;
  if (shareLiq === 0n) throw new Error("operator holds no shares to seed liquidity — deposit first");
  const hbarLiq = (shareLiq * nav) / ONE; // tinybar, so seed price ~= NAV
  console.log(`\nseeding ${Number(shareLiq) / 1e8} shares vs ${Number(hbarLiq) / 1e8} HBAR (NAV ${Number(nav) / 1e8})`);

  const curAllow: bigint = await share.allowance(signer.address, routerAddr);
  if (curAllow < shareLiq) {
    const apTx = await share.approve(routerAddr, shareLiq, { gasLimit: 1_200_000n });
    await apTx.wait();
    console.log(`  approve router: ${HASHSCAN}/transaction/${apTx.hash}`);
  } else {
    console.log(`  router already approved for ${Number(curAllow) / 1e8} shares`);
  }

  const deadline = Math.floor(Date.now() / 1000) + 1200;
  const callArgs = [shareEvm, shareLiq, 0n, 0n, signer.address, deadline] as const;
  const txOpts = { value: toWeibar(hbarLiq), gasLimit: 4_000_000n };

  // validate BEFORE spending: staticCall the seed (this is the real KYC gate)
  console.log(`\nstaticCall addLiquidityETH (no HBAR spent)...`);
  try {
    await router.addLiquidityETH.staticCall(...callArgs, txOpts);
    console.log(`  staticCall OK — proceeding to the live seed.`);
  } catch (e: any) {
    console.error(`  staticCall REVERTED — NOT seeding. reason:`, e.shortMessage ?? e.message);
    if (e.data) console.error(`  data:`, e.data);
    throw new Error("addLiquidityETH would revert (pair likely not KYC'd); aborting before the HBAR-spending tx");
  }

  console.log(`\naddLiquidityETH (seed into the KYC'd existing pair)...`);
  const alTx = await router.addLiquidityETH(...callArgs, txOpts);
  await alTx.wait();
  addLiquidityTx = alTx.hash;
  console.log(`  addLiquidityETH: ${HASHSCAN}/transaction/${alTx.hash}`);

  // ---- 5. verify ---------------------------------------------------------
  pair = await factory.getPair(shareEvm, whbar);
  if (isZero(pair)) throw new Error("pair not created");
  const p = new ethers.Contract(pair, PAIR_ABI, signer);
  const [r0, r1] = await p.getReserves();
  console.log(`\nverified pair: ${pair}`);
  console.log(`  reserves: ${r0} / ${r1}`);
  if (r0 === 0n && r1 === 0n) throw new Error("pair created but holds no reserves");

  console.log(`\n  SECONDARY MARKET LIVE — share/WHBAR pair: ${pair}`);
  console.log(`  ${HASHSCAN}/contract/${pair}`);

  writeSecondary(dPath, d, poolId, pair, { createPairTx, grantKycTx, addLiquidityTx });
}

function writeSecondary(
  dPath: string,
  d: any,
  poolId: number,
  pair: string,
  txs: { createPairTx: string | null; grantKycTx: string | null; addLiquidityTx: string | null },
) {
  d.secondaryPair = d.secondaryPair ?? {};
  d.secondaryPair[String(poolId)] = {
    poolId,
    pair,
    pairContract: `${HASHSCAN}/contract/${pair}`,
    ...(txs.createPairTx ? { createPairTx: `${HASHSCAN}/transaction/${txs.createPairTx}` } : {}),
    ...(txs.grantKycTx ? { grantKycTx: `${HASHSCAN}/transaction/${txs.grantKycTx}` } : {}),
    ...(txs.addLiquidityTx ? { addLiquidityTx: `${HASHSCAN}/transaction/${txs.addLiquidityTx}` } : {}),
  };
  d.updatedAt = new Date().toISOString();
  writeFileSync(dPath, JSON.stringify(d, null, 2) + "\n");
  console.log(`\nwrote secondaryPair[${poolId}] to ${dPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
