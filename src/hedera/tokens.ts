import {
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenBurnTransaction,
  TokenType,
  TokenSupplyType,
  CustomFractionalFee,
  AccountId,
  TokenId,
  Client,
  PrivateKey,
} from "@hashgraph/sdk";
import { config } from "../config.js";
import { operatorId, operatorKey } from "./client.js";

/**
 * Create the fungible pool-share token for one pool (e.g. GPU-A).
 *
 * A NAV-appreciating unit: supply is minted on deposit and burned on redeem; the share value
 * rises because NAV = vault value / shares outstanding rises as rewards flow in — not because
 * supply changes. KYC-gated (the Tokenization track's literal example) with a low fractional
 * protocol fee. See SPEC.md §3.1.
 */
export async function createPoolShareToken(
  client: Client,
  params: { name: string; symbol: string; feeCollector?: AccountId },
): Promise<TokenId> {
  const collector = params.feeCollector ?? operatorId;

  const protocolFee = new CustomFractionalFee()
    .setNumerator(config.protocolFeeBps)
    .setDenominator(10_000) // bps
    .setFeeCollectorAccountId(collector)
    .setAllCollectorsAreExempt(true); // don't tax internal mint-route transfers

  const tx = await new TokenCreateTransaction()
    .setTokenName(params.name)
    .setTokenSymbol(params.symbol)
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(config.decimals) // 6, mirror USDC
    .setInitialSupply(0) // mint on deposit
    .setSupplyType(TokenSupplyType.Infinite) // permanent vault
    .setTreasuryAccountId(operatorId)
    .setSupplyKey(operatorKey) // TODO: threshold key in prod
    .setKycKey(operatorKey)
    .setFreezeKey(operatorKey)
    .setAdminKey(operatorKey)
    .setCustomFees([protocolFee])
    .freezeWith(client)
    .sign(operatorKey);

  const receipt = await (await tx.execute(client)).getReceipt(client);
  if (!receipt.tokenId) throw new Error("share token create returned no tokenId");
  return receipt.tokenId;
}

/**
 * Create the NFT collection that holds reward claims. One collection for all claims (or one
 * per network for clean filtering). The vault account is the treasury and holds every serial;
 * claims are never sent to investors. See SPEC.md §3.2.
 */
export async function createClaimCollection(
  client: Client,
  params: { name: string; symbol: string; treasury: AccountId },
): Promise<TokenId> {
  const tx = await new TokenCreateTransaction()
    .setTokenName(params.name)
    .setTokenSymbol(params.symbol)
    .setTokenType(TokenType.NonFungibleUnique)
    .setSupplyType(TokenSupplyType.Infinite)
    .setTreasuryAccountId(params.treasury)
    .setSupplyKey(operatorKey)
    .setAdminKey(operatorKey)
    .freezeWith(client)
    .sign(operatorKey);

  const receipt = await (await tx.execute(client)).getReceipt(client);
  if (!receipt.tokenId) throw new Error("claim collection create returned no tokenId");
  return receipt.tokenId;
}

/** Mint a reward-claim NFT. metadata MUST be <= 100 bytes — pass a URI/hash, not inline JSON. */
export async function mintClaimNft(
  client: Client,
  claimTokenId: TokenId,
  metadataPointer: string,
): Promise<number> {
  const bytes = Buffer.from(metadataPointer);
  if (bytes.length > 100) throw new Error(`NFT metadata is ${bytes.length}B, max 100B — store JSON off-chain and pass a pointer`);

  const tx = await new TokenMintTransaction()
    .setTokenId(claimTokenId)
    .setMetadata([bytes])
    .freezeWith(client)
    .sign(operatorKey);

  const receipt = await (await tx.execute(client)).getReceipt(client);
  return receipt.serials[0].toNumber();
}

/** Mint `amount` (micro-units) of pool shares to the treasury. Distribute via a TransferTransaction. */
export async function mintShares(client: Client, shareTokenId: TokenId, amount: bigint): Promise<void> {
  const tx = await new TokenMintTransaction()
    .setTokenId(shareTokenId)
    .setAmount(Number(amount))
    .freezeWith(client)
    .sign(operatorKey);
  await (await tx.execute(client)).getReceipt(client);
}

/** Burn `amount` (micro-units) of pool shares from the treasury (after they return on redeem). */
export async function burnShares(client: Client, shareTokenId: TokenId, amount: bigint): Promise<void> {
  const tx = await new TokenBurnTransaction()
    .setTokenId(shareTokenId)
    .setAmount(Number(amount))
    .freezeWith(client)
    .sign(operatorKey);
  await (await tx.execute(client)).getReceipt(client);
}
