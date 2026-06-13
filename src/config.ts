import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v || v.includes("xxxxxx")) {
    throw new Error(`Missing env ${name} — copy .env.example to .env and fill it in.`);
  }
  return v;
}

function opt(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  network: opt("HEDERA_NETWORK", "testnet") as "testnet" | "mainnet",

  operatorId: req("OPERATOR_ID"),
  operatorKey: req("OPERATOR_KEY"),
  vaultId: opt("VAULT_ID") || req("OPERATOR_ID"), // default vault = operator for the MVP

  usdcTokenId: opt("USDC_TOKEN_ID", "0.0.429274"), // native Circle USDC on testnet
  shareTokenId: opt("SHARE_TOKEN_ID"),
  claimNftTokenId: opt("CLAIM_NFT_TOKEN_ID"),
  navTopicId: opt("NAV_TOPIC_ID"),

  mirrorNodeUrl: opt("MIRROR_NODE_URL", "https://testnet.mirrornode.hedera.com/api/v1"),
  hashioRpcUrl: opt("HASHIO_RPC_URL", "https://testnet.hashio.io/api"),

  protocolFeeBps: Number(opt("PROTOCOL_FEE_BPS", "10")),
  navHeartbeatSeconds: Number(opt("NAV_HEARTBEAT_SECONDS", "15")),

  port: Number(opt("PORT", "8787")),

  // USDC and the pool share both use 6 decimals — work in integer micro-units everywhere.
  decimals: 6,
} as const;

export const ONE_USDC = 1_000_000n; // 6 dp, integer micro-units
