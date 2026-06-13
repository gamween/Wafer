import {
  TokenAssociateTransaction,
  TokenGrantKycTransaction,
  TokenRevokeKycTransaction,
  TokenId,
  AccountId,
  PrivateKey,
  Client,
} from "@hashgraph/sdk";
import { operatorKey } from "./client.js";

/**
 * Onboard an investor to a KYC-gated pool share (SPEC.md §3.3):
 *   1. the investor associates the token (needs their key)
 *   2. the protocol grants KYC (operator/kyc key)
 * Only then can shares move to/from the account.
 */

export async function associateToken(
  client: Client,
  account: AccountId,
  accountKey: PrivateKey,
  tokenId: TokenId,
): Promise<void> {
  const tx = await new TokenAssociateTransaction()
    .setAccountId(account)
    .setTokenIds([tokenId])
    .freezeWith(client)
    .sign(accountKey);
  await (await tx.execute(client)).getReceipt(client);
}

export async function grantKyc(client: Client, account: AccountId, tokenId: TokenId): Promise<void> {
  const tx = await new TokenGrantKycTransaction()
    .setAccountId(account)
    .setTokenId(tokenId)
    .freezeWith(client)
    .sign(operatorKey);
  await (await tx.execute(client)).getReceipt(client);
}

export async function revokeKyc(client: Client, account: AccountId, tokenId: TokenId): Promise<void> {
  const tx = await new TokenRevokeKycTransaction()
    .setAccountId(account)
    .setTokenId(tokenId)
    .freezeWith(client)
    .sign(operatorKey);
  await (await tx.execute(client)).getReceipt(client);
}
