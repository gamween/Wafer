import React, { useEffect, useRef, useState } from "react";
import {
  formatHbar, formatNav, sanitizeAmountInput, parseUnits8,
  assetsForShares, ONE, formatPercent, dealApr,
} from "../lib/format.js";
import { VAULT_CONFIGURED, poolDisplayName, CATEGORY_LABEL, CATEGORY_LOGO, RISK_CLASSES } from "../lib/config.js";
import { formatError } from "../lib/errors.js";

// Centered Uniswap-swap-card-style Deposit / Redeem panel — the default screen
// after connect. Same on-chain logic as DepositWidget (deposit / redeem / associate
// / allowance / maxRedeem) plus a pool selector (category × class). Reads pools live
// from the vault; nothing is mocked.
//
// Deposit: HBAR in → shares minted at NAV (steps: associate → deposit).
// Redeem:  shares in → HBAR out, split instant (≤ liquidAssets) vs FIFO-queued
//          (steps: approve → redeem).
export default function DepositCard({ contracts, account, onStatus, refreshKey, initialPoolId, onConnect, connecting }) {
  const [pools, setPools] = useState([]);
  const [deals, setDeals] = useState([]);
  const [poolId, setPoolId] = useState(initialPoolId ?? null);
  const [selectorOpen, setSelectorOpen] = useState(false);

  const [tab, setTab] = useState("deposit");
  const [amount, setAmount] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [hbarBalance, setHbarBalance] = useState(null);
  const [shareBalance, setShareBalance] = useState(null);
  const [kyc, setKyc] = useState({ associated: false, kycGranted: false });
  const [maxRedeemUnits, setMaxRedeemUnits] = useState(null);
  const inFlightRef = useRef(false);
  const selRef = useRef(null);

  // Load pools + deals (deals power the trailing-APR badge on the selector).
  useEffect(() => {
    if (!contracts) return;
    let cancelled = false;
    (async () => {
      try {
        const [list, dealList] = await Promise.all([contracts.getPools(), contracts.getDeals()]);
        if (cancelled) return;
        setPools(list);
        setDeals(dealList);
        setPoolId((cur) => (cur != null ? cur : list[0]?.poolId ?? null));
      } catch { /* keep */ }
    })();
    return () => { cancelled = true; };
  }, [contracts, refreshKey]);

  useEffect(() => {
    if (initialPoolId != null) setPoolId(initialPoolId);
  }, [initialPoolId]);

  useEffect(() => {
    const h = (e) => { if (selRef.current && !selRef.current.contains(e.target)) setSelectorOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const pool = pools.find((p) => p.poolId === poolId) || null;
  const nav = pool?.navPerShare ?? ONE;

  // Per-pool balances + KYC + maxRedeem (same reads as DepositWidget).
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
      } catch { /* keep */ }
    })();
    return () => { cancelled = true; };
  }, [contracts, pool, refreshKey]);

  const trailingApr = (p) => {
    if (!p) return null;
    const financed = deals.filter((d) => d.poolId === p.poolId && (d.status === 3 || d.status === 4));
    let wSum = 0, num = 0;
    for (const d of financed) {
      const apr = dealApr(d.advance, d.expected, d.term);
      if (apr == null) continue;
      const w = Number(d.advance); wSum += w; num += apr * w;
    }
    return wSum > 0 ? num / wSum : null;
  };

  const amountUnits = parseUnits8(amount);
  const isDeposit = tab === "deposit";
  const balanceUnits = isDeposit ? hbarBalance : shareBalance;
  const balanceLabel = isDeposit ? "HBAR" : "shares";

  const redeemAssets = assetsForShares(amountUnits, nav);
  const instantFill = maxRedeemUnits == null ? null : (redeemAssets > maxRedeemUnits ? maxRedeemUnits : redeemAssets);
  const queuedRemainder = maxRedeemUnits == null ? null : (redeemAssets > maxRedeemUnits ? redeemAssets - maxRedeemUnits : 0n);
  const willQueue = !isDeposit && queuedRemainder != null && queuedRemainder > 0n;

  const depositShares = nav > 0n ? (amountUnits * ONE) / nav : 0n;
  const previewUnits = isDeposit ? depositShares : redeemAssets;
  const previewLabel = isDeposit ? "shares" : "HBAR";

  const overBalance = balanceUnits != null && amountUnits > balanceUnits;
  const blockedByKyc = isDeposit && !kyc.kycGranted;
  const noPool = !pool;
  const isDisabled = !account ? false : (amountUnits <= 0n || overBalance || isBusy || blockedByKyc || noPool);

  const handleAmountChange = (e) => setAmount(sanitizeAmountInput(e.target.value));
  const handleMax = () => {
    if (balanceUnits == null) return;
    setAmount(formatHbar(balanceUnits).replace(/,/g, ""));
  };

  const handleAction = async () => {
    if (!account) { onConnect?.(); return; }
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
        onStatus(willQueue ? "Redeemed — instant portion paid, remainder queued (see Portfolio)." : "Redeem successful!");
      }
      setAmount("");
    } catch (e) {
      onStatus(formatError(e), true);
    } finally {
      inFlightRef.current = false;
      setIsBusy(false);
    }
  };

  const actionLabel = !account
    ? "Connect wallet"
    : noPool
      ? "No pool available"
      : isBusy
        ? "Processing…"
        : amountUnits <= 0n
          ? "Enter an amount"
          : overBalance
            ? "Insufficient balance"
            : blockedByKyc
              ? "KYC required"
              : isDeposit ? "Deposit HBAR" : willQueue ? "Redeem (partial + queue)" : "Redeem shares";

  const poolMeta = (p) => ({
    name: poolDisplayName(p.category, p.class),
    network: CATEGORY_LABEL[p.category] ?? "—",
    logo: CATEGORY_LOGO[p.category] ?? "/logos/hedera.svg",
    risk: RISK_CLASSES[p.class] ?? "—",
  });

  return (
    <div className="dc-wrap">
      <div className="dc-card">
        <div className="dc-tabs">
          <button type="button" className={`dc-tab${isDeposit ? " active" : ""}`} onClick={() => { setTab("deposit"); setAmount(""); }}>Deposit</button>
          <button type="button" className={`dc-tab${!isDeposit ? " active" : ""}`} onClick={() => { setTab("redeem"); setAmount(""); }}>Redeem</button>
        </div>

        {!VAULT_CONFIGURED && (
          <div className="dc-notice">No vault configured — set VITE_VAULT_ADDRESS to a deployed WaferVault.</div>
        )}

        {/* Amount box */}
        <div className="dc-box">
          <div className="dc-box-top">
            <span className="dc-box-label">{isDeposit ? "You pay" : "You redeem"}</span>
            <span className="dc-box-bal">
              {balanceUnits == null ? "—" : formatHbar(balanceUnits)} {balanceLabel}
              <button type="button" className="dc-max" onClick={handleMax} disabled={balanceUnits == null}>MAX</button>
            </span>
          </div>
          <div className="dc-box-row">
            <input
              aria-label="Amount"
              className="dc-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={handleAmountChange}
            />
            <span className="dc-unit">{isDeposit ? "HBAR" : "shares"}</span>
          </div>
        </div>

        {/* Pool selector (category × class) */}
        <div className="dc-selector-wrap" ref={selRef}>
          <span className="dc-box-label dc-selector-label">Pool</span>
          <button type="button" className="dc-selector" onClick={() => setSelectorOpen((o) => !o)} disabled={pools.length === 0}>
            {pool ? (
              <span className="dc-selector-cur">
                <img className="dc-selector-logo" src={poolMeta(pool).logo} alt="" />
                <span className="dc-selector-name">{poolMeta(pool).name}</span>
                <span className="dc-selector-net">{poolMeta(pool).network}</span>
              </span>
            ) : (
              <span className="dc-selector-name">{pools.length === 0 ? "No pools" : "Select pool"}</span>
            )}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: selectorOpen ? "rotate(180deg)" : "rotate(0)" }}>
              <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {selectorOpen && pools.length > 0 && (
            <div className="dc-selector-menu" role="listbox">
              {pools.map((p) => {
                const m = poolMeta(p);
                const apr = trailingApr(p);
                return (
                  <button key={p.poolId} type="button" className={`dc-selector-opt${p.poolId === poolId ? " active" : ""}`}
                    onClick={() => { setPoolId(p.poolId); setSelectorOpen(false); setAmount(""); }} role="option" aria-selected={p.poolId === poolId}>
                    <img className="dc-selector-logo" src={m.logo} alt="" />
                    <span className="dc-selector-opt-main">
                      <span className="dc-selector-name">{m.name}</span>
                      <span className="dc-selector-net">{m.network} · Risk {m.risk}</span>
                    </span>
                    <span className="dc-selector-apr">{apr == null ? "—" : formatPercent(apr)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Compliance chips */}
        {account && pool && (
          <div className="dc-chips">
            <span className={`wafer-chip ${kyc.associated ? "ok" : "warn"}`}>{kyc.associated ? "Associated" : "Not associated"}</span>
            <span className={`wafer-chip ${kyc.kycGranted ? "ok" : "warn"}`}>{kyc.kycGranted ? "KYC granted" : "KYC pending"}</span>
          </div>
        )}

        {blockedByKyc && account && (
          <div className="vault-error-msg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            <span>KYC not granted for this pool. Ask an admin to allowlist your address (adminGrantKyc).</span>
          </div>
        )}
        {overBalance && account && (
          <div className="vault-error-msg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            <span>Insufficient balance. You have {formatHbar(balanceUnits)} {balanceLabel}.</span>
          </div>
        )}
        {willQueue && !overBalance && (
          <div className="wafer-queue-notice">
            Instant fill {formatHbar(instantFill)} HBAR · {formatHbar(queuedRemainder)} HBAR will be FIFO-queued (paid as the pool's idle cash refills).
          </div>
        )}

        {/* Summary */}
        <div className="dc-summary">
          <div className="dc-summary-row"><span>NAV / share</span><span className="dc-summary-val">{formatNav(nav)} HBAR</span></div>
          <div className="dc-summary-row"><span>{isDeposit ? "Shares received (est.)" : "HBAR returned (est.)"}</span><span className="dc-summary-val dc-pos">{formatHbar(previewUnits)} {previewLabel}</span></div>
          {!isDeposit && (
            <div className="dc-summary-row"><span>Max instant redeem</span><span className="dc-summary-val">{maxRedeemUnits == null ? "—" : `${formatHbar(maxRedeemUnits)} HBAR`}</span></div>
          )}
          <div className="dc-summary-row"><span>Steps</span><span className="dc-summary-val dc-muted">{isDeposit ? "associate → deposit" : "approve → redeem"}</span></div>
        </div>

        <button className="dc-action" disabled={isDisabled || (account && noPool)} onClick={handleAction} type="button">
          {!account && connecting ? "Connecting…" : actionLabel}
        </button>
      </div>

      <p className="dc-foot-note">
        Pool shares appreciate only by realized reward spread (NAV-accreting, SPEC §5). Redeem is instant up to the
        pool's liquid buffer; the remainder is FIFO-queued and paid as idle cash refills.
      </p>
    </div>
  );
}
