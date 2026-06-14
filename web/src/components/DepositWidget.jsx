import React, { useEffect, useRef, useState } from "react";
import {
  formatHbar, formatNav, sanitizeAmountInput, parseUnits8,
  assetsForShares, ONE,
} from "../lib/format.js";
import { formatError } from "../lib/errors.js";

// Deposit / Redeem panel (investor).
//
// Deposit:  HBAR → mint shares at NAV.  Requires (1) share-token association
//   (IHRC719) and (2) admin KYC granted (D2 allowlist) — both surfaced here.
// Redeem:   shares → HBAR. Instant fill up to maxRedeem (liquid cash), remainder
//   FIFO-queued (SPEC §5/§6) — a notice shows when the instant fill can't cover.
export default function DepositWidget({ pool, contracts, onStatus, refreshKey }) {
  const [tab, setTab] = useState("deposit");
  const [amount, setAmount] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [hbarBalance, setHbarBalance] = useState(null);
  const [shareBalance, setShareBalance] = useState(null);
  const [kyc, setKyc] = useState({ associated: false, kycGranted: false });
  const [maxRedeemUnits, setMaxRedeemUnits] = useState(null);
  const inFlightRef = useRef(false);

  const nav = pool?.navPerShare ?? ONE;

  useEffect(() => {
    if (!contracts || !pool) return;
    let cancelled = false;
    (async () => {
      try {
        const [hbar, shares, kycStatus] = await Promise.all([
          contracts.getHbarBalance(),
          contracts.getShareBalance(pool.shareToken),
          contracts.getKycStatus(pool.poolId, pool.shareToken),
        ]);
        if (cancelled) return;
        setHbarBalance(hbar);
        setShareBalance(shares);
        setKyc(kycStatus);
        if (shares != null && shares > 0n) {
          const mr = await contracts.getMaxRedeem(pool.poolId, shares);
          if (!cancelled) setMaxRedeemUnits(mr);
        } else {
          setMaxRedeemUnits(0n);
        }
      } catch { /* leave previous */ }
    })();
    return () => { cancelled = true; };
  }, [contracts, pool, refreshKey]);

  const amountUnits = parseUnits8(amount);
  const isDeposit = tab === "deposit";
  const balanceUnits = isDeposit ? hbarBalance : shareBalance;
  const balanceLabel = isDeposit ? "HBAR" : "shares";

  // Redeem preview: assets at NAV, then split into instant fill vs queued.
  const redeemAssets = assetsForShares(amountUnits, nav);
  const instantFill = maxRedeemUnits == null ? null : (redeemAssets > maxRedeemUnits ? maxRedeemUnits : redeemAssets);
  const queuedRemainder = maxRedeemUnits == null ? null : (redeemAssets > maxRedeemUnits ? redeemAssets - maxRedeemUnits : 0n);
  const willQueue = !isDeposit && queuedRemainder != null && queuedRemainder > 0n;

  // Deposit preview: shares minted at NAV.
  const depositShares = nav > 0n ? (amountUnits * ONE) / nav : 0n;
  const previewUnits = isDeposit ? depositShares : redeemAssets;
  const previewLabel = isDeposit ? "shares" : "HBAR";

  const overBalance = balanceUnits != null && amountUnits > balanceUnits;
  const blockedByKyc = isDeposit && !kyc.kycGranted;
  const isDisabled = amountUnits <= 0n || overBalance || isBusy || blockedByKyc;

  const handleAmountChange = (e) => setAmount(sanitizeAmountInput(e.target.value));
  const handleMax = () => {
    if (balanceUnits == null) return;
    setAmount(formatHbar(balanceUnits).replace(/,/g, ""));
  };

  const handleAction = async () => {
    if (inFlightRef.current || isDisabled) return;
    inFlightRef.current = true;
    setIsBusy(true);
    try {
      if (isDeposit) {
        onStatus("Associating share token + depositing HBAR…");
        await contracts.deposit(pool.poolId, amountUnits, pool.shareToken);
        onStatus("Deposit successful!");
      } else {
        onStatus(willQueue ? "Redeeming — partial instant fill, remainder queued…" : "Approving share allowance + redeeming…");
        await contracts.redeem(pool.poolId, amountUnits, pool.shareToken);
        onStatus(willQueue ? "Redeemed — instant portion paid, remainder queued (see Queue)." : "Redeem successful!");
      }
      setAmount("");
    } catch (e) {
      onStatus(formatError(e), true);
    } finally {
      inFlightRef.current = false;
      setIsBusy(false);
    }
  };

  const actionLabel = isBusy
    ? "Processing…"
    : amountUnits <= 0n
      ? "Enter an amount"
      : overBalance
        ? "Insufficient balance"
        : blockedByKyc
          ? "KYC required"
          : isDeposit ? "Deposit HBAR" : willQueue ? "Redeem (partial + queue)" : "Redeem shares";

  return (
    <div className="vault-panel">
      <div className="vault-tabs">
        <button type="button" className={`vault-tab${isDeposit ? " active" : ""}`} onClick={() => { setTab("deposit"); setAmount(""); }}>Deposit</button>
        <button type="button" className={`vault-tab${!isDeposit ? " active" : ""}`} onClick={() => { setTab("redeem"); setAmount(""); }}>Redeem</button>
      </div>

      {/* Compliance status row (D2 allowlist + association) */}
      <div className="wafer-status-chips">
        <span className={`wafer-chip ${kyc.associated ? "ok" : "warn"}`}>{kyc.associated ? "Associated" : "Not associated"}</span>
        <span className={`wafer-chip ${kyc.kycGranted ? "ok" : "warn"}`}>{kyc.kycGranted ? "KYC granted" : "KYC pending"}</span>
      </div>
      {blockedByKyc && (
        <div className="vault-error-msg">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          <span>KYC not granted for this pool. Ask an admin to allowlist your address (adminGrantKyc).</span>
        </div>
      )}

      <div className="vault-input-card">
        <div className="vault-input-header">
          <span className="vault-input-title">{isDeposit ? "Deposit HBAR" : "Redeem shares"}</span>
        </div>
        <div className="vault-input-field">
          <input aria-label="Amount" className="vault-amount-input" inputMode="decimal" placeholder="0.00" value={amount} onChange={handleAmountChange} />
        </div>
        <div className="vault-input-footer">
          <span className="vault-dollar-value">NAV {formatNav(nav)} HBAR / share</span>
          <div className="vault-balance-row">
            <span className="vault-balance-label">{balanceUnits == null ? "—" : formatHbar(balanceUnits)} {balanceLabel}</span>
            <button type="button" className="vault-max-btn" onClick={handleMax} disabled={balanceUnits == null}>MAX</button>
          </div>
        </div>
      </div>

      {overBalance && (
        <div className="vault-error-msg">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          <span>Insufficient balance. You have {formatHbar(balanceUnits)} {balanceLabel}.</span>
        </div>
      )}

      {willQueue && !overBalance && (
        <div className="wafer-queue-notice">
          <span>Instant fill {formatHbar(instantFill)} HBAR · {formatHbar(queuedRemainder)} HBAR will be FIFO-queued (paid as the pool's idle cash refills).</span>
        </div>
      )}

      <div className="vault-summary">
        <div className="vault-summary-row"><span className="vault-summary-label">{isDeposit ? "You deposit" : "You redeem"}</span><span className="vault-summary-value">{formatHbar(amountUnits)} {isDeposit ? "HBAR" : "shares"}</span></div>
        <div className="vault-summary-row"><span className="vault-summary-label">{isDeposit ? "Shares minted" : "HBAR returned"} (est.)</span><span className="vault-summary-value vault-apy">{formatHbar(previewUnits)} {previewLabel}</span></div>
        {!isDeposit && (
          <div className="vault-summary-row"><span className="vault-summary-label">Max instant redeem</span><span className="vault-summary-value">{maxRedeemUnits == null ? "—" : `${formatHbar(maxRedeemUnits)} HBAR`}</span></div>
        )}
        <div className="vault-summary-row"><span className="vault-summary-label">Steps</span><span className="vault-summary-value" style={{ fontSize: "0.75rem", opacity: 0.7 }}>{isDeposit ? "associate → deposit" : "approve → redeem"}</span></div>
      </div>

      <button className="vault-action-btn" disabled={isDisabled} onClick={handleAction} type="button" aria-label={`${actionLabel} in ${pool?.name}`}>
        {actionLabel}
      </button>
    </div>
  );
}
