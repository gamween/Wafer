/**
 * Convert raw blockchain/wallet errors into short, user-friendly messages
 * tuned for Hedera testnet (HBAR gas, HTS association/KYC).
 *
 * For contract reverts we dig through `err.cause` (viem stacks the revert
 * details there, not on the top-level message) so the user sees the on-chain
 * reason — a custom-error name, a require-string, or a raw 4-byte signature.
 */
function extractRevertDetail(err) {
  let cur = err;
  for (let i = 0; i < 5 && cur; i++) {
    const customName = cur?.data?.errorName ?? cur?.cause?.data?.errorName;
    if (customName) {
      const args = cur?.data?.args ?? cur?.cause?.data?.args;
      const argStr = Array.isArray(args) && args.length ? `(${args.map(String).join(", ")})` : "";
      return `${customName}${argStr}`;
    }
    const reason = cur?.reason ?? cur?.cause?.reason;
    if (typeof reason === "string" && reason.length > 0) return reason;
    const sig = cur?.signature ?? cur?.cause?.signature;
    if (typeof sig === "string" && sig.length > 0) return `unknown error sig ${sig}`;
    cur = cur.cause;
  }
  return null;
}

export function formatError(err) {
  if (typeof console !== "undefined" && err) {
    console.error("[Wafer]", err);
  }
  const msg = err?.shortMessage || err?.message || String(err);

  if (/user (rejected|denied|cancelled)/i.test(msg)) return "Transaction cancelled.";
  if (/insufficient funds|insufficient_payer_balance|not enough hbar/i.test(msg)) return "Not enough HBAR for gas — fund your account from the Hedera testnet faucet (portal.hedera.com).";
  if (/NOT_KYCED|account_kyc_not_granted|not\s*kyc'?d|kyc\s*not\s*granted/i.test(msg)) return "KYC not granted — an admin must allowlist your address for this pool (adminGrantKyc) before you can deposit.";
  if (/token_not_associated|not associated|associate/i.test(msg)) return "Token not associated — associate the share token to your account first, then retry.";
  if (/NOT_OPERATOR/i.test(msg)) return "Not a whitelisted operator — an admin must registerOperator your address first.";
  if (/NOT_SETTLER|claim\s*settler/i.test(msg)) return "Not authorized to settle this claim — ask the admin to setAuthorizedSettler for your address.";
  if (/TIMELOCK|pending\s*after|execute\s*after/i.test(msg)) return "Timelocked action — it was queued. Re-run after the timelock window elapses to execute it.";
  if (/INSUFFICIENT_IDLE|idle\s*<\s*advance|NO_LIQUID/i.test(msg)) return "Not enough idle liquidity in the pool for this action right now.";
  if (/POOL_PAUSED|paused/i.test(msg)) return "Pool is paused — admin must unpause it before this action.";
  if (/FROZEN|account_frozen/i.test(msg)) return "Account is frozen for this pool — contact the admin.";
  if (/VALUE_TOO_LARGE/i.test(msg)) return "Amount too large — exceeds the uint64 tinybar ceiling.";
  if (/wallet not connected/i.test(msg)) return "Wallet not connected — click Connect first.";
  if (/wallet is still initializing/i.test(msg)) return "Wallet initializing — wait a second and retry.";
  if (/MetaMask account changed/i.test(msg)) return "MetaMask account changed — refresh and reconnect.";
  if (/amount is required|invalid amount|amount must be/i.test(msg)) return msg.split("\n")[0].trim();
  if (/nonce too/i.test(msg)) return "Nonce error — try resetting your wallet activity in MetaMask.";
  if (/timeout|timed out/i.test(msg)) return "Transaction timed out.";
  if (/network|chain/i.test(msg) && /switch|wrong/i.test(msg)) return "Wrong network — switch to Hedera Testnet (296).";

  if (/reverted|execution reverted/i.test(msg)) {
    const detail = extractRevertDetail(err);
    if (detail) return `Reverted: ${detail}`;
    const inline = msg.match(/reason:\s*(.+?)(\n|$)/i);
    if (inline?.[1]) return `Reverted: ${inline[1].trim()}`;
    return "Reverted (no reason). You may not have associated the share token, or you may be on the wrong account — please refresh and retry.";
  }

  const first = msg.split("\n")[0].trim();
  return first.length > 120 ? first.slice(0, 117) + "..." : first;
}
