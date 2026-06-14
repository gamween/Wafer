const path = require('path');
const ethers = require(process.env.ETHERS_PATH);
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
(async () => {
  const ROUTER = "0x0000000000000000000000000000000000004b40";
  const router = new ethers.Contract(ROUTER, [
    "function WHBAR() view returns (address)",
    "function whbar() view returns (address)",
    "function factory() view returns (address)",
  ], provider);
  console.log("router.factory():", await router.factory());
  console.log("router.WHBAR() (contract):", await router.WHBAR());
  console.log("router.whbar() (token):", await router.whbar());
  console.log("config whbar:", "0x0000000000000000000000000000000000003ad2");

  // Inspect the created pair: token0/token1, and is the pair really KYC granted on share?
  const PAIR = "0xb0bd9aFD2C9C08aF97970B4DEf6FB178a0C9A215";
  const pair = new ethers.Contract(PAIR, [
    "function token0() view returns (address)",
    "function token1() view returns (address)",
  ], provider);
  console.log("\npair.token0():", await pair.token0());
  console.log("pair.token1():", await pair.token1());

  // Mirror node: is the pair associated with the share token + KYC granted?
  const SHARE_ID = "0.0.9227549";
  // pair hedera id:
  const PAIR_LONG = BigInt(PAIR).toString();
  const pairId = "0.0." + Number(BigInt(PAIR) & 0xffffffffffffn);
  console.log("\npair hedera id:", pairId);
  const r = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${pairId}/tokens?token.id=${SHARE_ID}`);
  console.log("pair share-token relationship:", JSON.stringify(await r.json()));
  // operator relationship
  const r2 = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.9185964/tokens?token.id=${SHARE_ID}`);
  console.log("operator share-token relationship:", JSON.stringify(await r2.json()));
})().catch(e => { console.error(e); process.exit(1); });
