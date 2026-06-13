import { TransferTransaction, TokenId, AccountId, Client, PrivateKey } from "@hashgraph/sdk";

/**
 * Atomic money movement. Every operation is a single TransferTransaction whose legs net to
 * zero per token — both sides commit or revert together, so no escrow contract is needed.
 * SPEC.md §4. Amounts are integer micro-units (6 dp) for both USDC and the share token.
 *
 * Preconditions on each leg: the counterparty must have ASSOCIATED the token and (for the
 * share, which is KYC-gated) been GRANTED KYC — otherwise the whole transfer reverts with
 * TOKEN_NOT_ASSOCIATED_TO_ACCOUNT / ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN.
 */

/** DEPOSIT: investor pays USDC, receives freshly-minted shares (pre-minted to the vault). */
export function buildDeposit(params: {
  usdcId: TokenId;
  shareId: TokenId;
  investor: AccountId;
  vault: AccountId;
  usdcAmount: bigint;
  shareAmount: bigint;
}): TransferTransaction {
  return new TransferTransaction()
    .addTokenTransfer(params.usdcId, params.investor, -Number(params.usdcAmount))
    .addTokenTransfer(params.usdcId, params.vault, Number(params.usdcAmount))
    .addTokenTransfer(params.shareId, params.vault, -Number(params.shareAmount))
    .addTokenTransfer(params.shareId, params.investor, Number(params.shareAmount));
}

/** REDEEM: investor returns shares (to be burned), vault pays USDC at current NAV. */
export function buildRedeem(params: {
  usdcId: TokenId;
  shareId: TokenId;
  investor: AccountId;
  vault: AccountId;
  shareAmount: bigint;
  usdcAmount: bigint;
}): TransferTransaction {
  return new TransferTransaction()
    .addTokenTransfer(params.shareId, params.investor, -Number(params.shareAmount))
    .addTokenTransfer(params.shareId, params.vault, Number(params.shareAmount))
    .addTokenTransfer(params.usdcId, params.vault, -Number(params.usdcAmount))
    .addTokenTransfer(params.usdcId, params.investor, Number(params.usdcAmount));
}

/** FINANCE: vault advances USDC to the operator (the claim NFT is minted separately). */
export function buildAdvance(params: {
  usdcId: TokenId;
  vault: AccountId;
  operator: AccountId;
  usdcAmount: bigint;
}): TransferTransaction {
  return new TransferTransaction()
    .addTokenTransfer(params.usdcId, params.vault, -Number(params.usdcAmount))
    .addTokenTransfer(params.usdcId, params.operator, Number(params.usdcAmount));
}

/** SETTLE: operator routes reward USDC into the vault. */
export function buildRewardSweep(params: {
  usdcId: TokenId;
  operator: AccountId;
  vault: AccountId;
  usdcAmount: bigint;
}): TransferTransaction {
  return new TransferTransaction()
    .addTokenTransfer(params.usdcId, params.operator, -Number(params.usdcAmount))
    .addTokenTransfer(params.usdcId, params.vault, Number(params.usdcAmount));
}

/**
 * Execute a built transfer, co-signing with any extra keys (e.g. the investor's key authorizing
 * their USDC/share debit). The operator key is already the client default signer.
 */
export async function execTransfer(
  client: Client,
  tx: TransferTransaction,
  extraSigners: PrivateKey[] = [],
): Promise<string> {
  let frozen = tx.freezeWith(client);
  for (const k of extraSigners) frozen = await frozen.sign(k);
  const resp = await frozen.execute(client);
  const receipt = await resp.getReceipt(client);
  return `${receipt.status.toString()}:${resp.transactionId.toString()}`;
}
