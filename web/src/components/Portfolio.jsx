import React, { useEffect, useMemo, useState } from "react";
import RedemptionQueue from "./RedemptionQueue.jsx";
import Activity from "./Activity.jsx";
import { VAULT_CONFIGURED, poolDisplayName, CATEGORY_LABEL, CATEGORY_LOGO, EXPLORER_URL } from "../lib/config.js";
import { formatHbar, formatNav, assetsForShares, shortAddr } from "../lib/format.js";

// Portfolio — the connected wallet's positions (restyle of Dashboard).
// Address header + big total value (Σ shares × NAV), tabs Overview / Positions /
// Activity, a value bar derived from real holdings (no fake series), and right-
// column action cards (Deposit / Redeem). Redemption queue lives under Positions.
export default function Portfolio({ contracts, account, onStatus, refreshKey, onOpenDeposit }) {
  const [rows, setRows] = useState([]);
  const [hbarBalance, setHbarBalance] = useState(null);
  const [pendingRedemptions, setPendingRedemptions] = useState(0);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    if (!contracts) return;
    let cancelled = false;
    (async () => {
      try {
        const pools = await contracts.getPools();
        const [balances, hbar, queue] = await Promise.all([
          Promise.all(pools.map((p) => contracts.getShareBalance(p.shareToken))),
          contracts.getHbarBalance(),
          contracts.getRedemptionQueue(),
        ]);
        if (cancelled) return;
        const next = pools.map((p, i) => {
          const shares = balances[i] ?? 0n;
          return {
            poolId: p.poolId,
            name: poolDisplayName(p.category, p.class),
            network: CATEGORY_LABEL[p.category] ?? "—",
            logo: CATEGORY_LOGO[p.category] ?? "/logos/hedera.svg",
            navPerShare: p.navPerShare,
            shares,
            value: assetsForShares(shares, p.navPerShare),
          };
        });
        setRows(next);
        setHbarBalance(hbar);
        if (account) {
          setPendingRedemptions(queue.filter((r) => !r.filled && r.investor?.toLowerCase?.() === account.toLowerCase()).length);
        }
      } catch { /* keep */ }
    })();
    return () => { cancelled = true; };
  }, [contracts, account, refreshKey]);

  const held = rows.filter((r) => r.shares > 0n);
  const totalValue = held.reduce((acc, r) => acc + (r.value ?? 0n), 0n);

  // Allocation bar: real per-pool share of the wallet's total value. No fake data —
  // empty state when there are no positions.
  const allocation = useMemo(() => {
    const tot = Number(totalValue);
    if (tot <= 0) return [];
    return held.map((r) => ({ ...r, pct: (Number(r.value) / tot) * 100 }));
  }, [held, totalValue]);

  return (
    <div className="pf-page">
      {!VAULT_CONFIGURED && (
        <div className="net-warning" role="status" style={{ marginBottom: "1rem" }}>
          <span>No vault configured — set VITE_VAULT_ADDRESS to see live positions.</span>
        </div>
      )}

      {/* Header */}
      <div className="pf-head">
        <div className="pf-head-id">
          <span className="label">Portfolio</span>
          <a className="pf-addr mono" href={account ? `${EXPLORER_URL}/account/${account}` : undefined} target="_blank" rel="noopener noreferrer">
            {shortAddr(account)}
          </a>
        </div>
        <div className="pf-head-value">
          <span className="pf-value-num mono">{formatHbar(totalValue)}</span>
          <span className="pf-value-unit">HBAR</span>
        </div>
        <span className="pf-value-sub">Total share value at current NAV</span>
      </div>

      <div className="pf-grid">
        <div className="pf-main">
          {/* Value / allocation bar — derived from holdings, empty when none */}
          <div className="card">
            <h3>Allocation</h3>
            {allocation.length === 0 ? (
              <div className="pf-empty">
                <span>No positions yet.</span>
                <button className="btn-secondary btn-sm" onClick={() => onOpenDeposit?.()}>Deposit into a pool</button>
              </div>
            ) : (
              <>
                <div className="pf-alloc-bar" aria-hidden="true">
                  {allocation.map((r, i) => (
                    <span key={r.poolId} className="pf-alloc-seg" style={{ width: `${r.pct}%`, opacity: 1 - i * 0.14 }} title={`${r.name} ${r.pct.toFixed(0)}%`} />
                  ))}
                </div>
                <div className="pf-alloc-legend">
                  {allocation.map((r) => (
                    <span key={r.poolId} className="pf-alloc-item"><span className="wafer-dot wafer-dot-idle" />{r.name}<b>{r.pct.toFixed(0)}%</b></span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Sub-tabs */}
          <div className="ex-subtabs">
            <button className={`ex-subtab${tab === "overview" ? " active" : ""}`} onClick={() => setTab("overview")}>Overview</button>
            <button className={`ex-subtab${tab === "positions" ? " active" : ""}`} onClick={() => setTab("positions")}>Positions</button>
            <button className={`ex-subtab${tab === "activity" ? " active" : ""}`} onClick={() => setTab("activity")}>Activity</button>
          </div>

          {tab === "overview" && (
            <div className="card">
              <h3>Summary</h3>
              <div className="balances-grid">
                <div className="balance-item">
                  <div className="balance-label">Total share value</div>
                  <div className="balance-value">{formatHbar(totalValue)} <span style={{ fontSize: "0.6em", color: "var(--text-2)" }}>HBAR</span></div>
                </div>
                <div className="balance-item">
                  <div className="balance-label"><img src="/logos/hedera.svg" alt="" className="balance-icon" /> HBAR balance</div>
                  <div className="balance-value">{hbarBalance == null ? "—" : formatHbar(hbarBalance)}</div>
                </div>
                <div className="balance-item">
                  <div className="balance-label">Positions</div>
                  <div className="balance-value">{held.length}</div>
                </div>
                <div className="balance-item">
                  <div className="balance-label">Pending redemptions</div>
                  <div className="balance-value">{pendingRedemptions}</div>
                </div>
              </div>
            </div>
          )}

          {tab === "positions" && (
            <>
              <div className="mt-card">
                <div className="mt-toolbar">
                  <div className="mt-toolbar-left">
                    <span className="mt-toolbar-title">Positions</span>
                    <span className="mt-count-badge">{held.length}</span>
                  </div>
                </div>
                <div className="mt-table-wrap">
                  <table className="mt-table">
                    <thead>
                      <tr>
                        <th style={{ width: '14rem' }}>Pool</th>
                        <th style={{ width: '10rem' }}>Your shares</th>
                        <th style={{ width: '8rem' }}>NAV / share</th>
                        <th style={{ width: '10rem' }}>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {held.map((r) => (
                        <tr key={r.poolId} className="mt-row" onClick={() => onOpenDeposit?.(r.poolId)}>
                          <td>
                            <div className="mt-cell">
                              <div className="mt-network-icon"><img src={r.logo} alt={r.network} width="44" height="44" /></div>
                              <div className="mt-token" style={{ marginLeft: "0.5rem" }}>
                                <span className="mt-token-name">{r.name}</span>
                                <span className="mt-oracle-label" style={{ marginLeft: "0.5rem" }}>{r.network}</span>
                              </div>
                            </div>
                          </td>
                          <td><div className="mt-cell"><span className="mt-amount">{formatHbar(r.shares)}</span></div></td>
                          <td><div className="mt-cell"><span className="mt-rate">{formatNav(r.navPerShare)}</span></div></td>
                          <td><div className="mt-cell"><span className="mt-amount">{formatHbar(r.value)} HBAR</span></div></td>
                        </tr>
                      ))}
                      {held.length === 0 && (
                        <tr><td colSpan={4}><div className="mt-cell" style={{ padding: "1.5rem", opacity: 0.6 }}>No positions yet — deposit into a pool to mint shares.</div></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Redemption queue under Positions */}
              <RedemptionQueue contracts={contracts} account={account} onStatus={onStatus} refreshKey={refreshKey} />
            </>
          )}

          {tab === "activity" && <Activity refreshKey={refreshKey} />}
        </div>

        {/* Right action cards */}
        <aside className="pf-side">
          <div className="card pf-action-card">
            <h3>Deposit</h3>
            <p className="pf-action-desc">Add HBAR to a pool and mint NAV-appreciating shares.</p>
            <button className="dc-action" onClick={() => onOpenDeposit?.()}>Deposit</button>
          </div>
          <div className="card pf-action-card">
            <h3>Redeem</h3>
            <p className="pf-action-desc">Burn shares for HBAR — instant up to the pool's liquid buffer, remainder queued.</p>
            <button className="btn-secondary" style={{ width: "100%" }} onClick={() => onOpenDeposit?.()}>Redeem</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
