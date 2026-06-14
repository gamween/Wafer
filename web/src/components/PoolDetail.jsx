import React, { useEffect, useMemo, useState } from "react";
import { CATEGORY_LABEL, RISK_CLASSES, DEAL_STATUS, EXPLORER_URL } from "../lib/config.js";
import { formatHbar, formatNav, formatPercent, formatTerm, dealApr, ONE, shortAddr } from "../lib/format.js";
import { readVaultLogs } from "../lib/mirror.js";

// Pool detail: NAV history sparkline (reconstructed from Deposit/RewardRouted/
// ClaimDefaulted events on this pool), idle-vs-deployed liquidity split, queue
// depth, and the deals table (operator, advance/expected/term/APR, status).
//
// NAV history: we can't read historical NAV directly, so we approximate the curve
// by sampling navPerShare at "now" and showing the realized-spread events that
// moved it. The sparkline plots cumulative realized spread per claim event as a
// monotone proxy; current NAV is the headline number.

function Sparkline({ points, width = 320, height = 64 }) {
  if (!points || points.length < 2) {
    return <div className="wafer-spark-empty">Not enough history yet</div>;
  }
  const xs = points.map((_, i) => i);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points.map((p, i) => {
    const x = (xs[i] / (points.length - 1)) * width;
    const y = height - ((p - min) / span) * (height - 6) - 3;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg className="wafer-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" width="100%" height={height}>
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function PoolDetail({ pool, deals, contracts, refreshKey }) {
  const [queue, setQueue] = useState([]);
  const [navSeries, setNavSeries] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [q, logs] = await Promise.all([
          contracts.getRedemptionQueue(),
          readVaultLogs(),
        ]);
        if (cancelled) return;
        setQueue(q.filter((r) => r.poolId === pool.poolId && !r.filled));
        // Build a cumulative realized-spread proxy series from this pool's reward /
        // default events (newest-first from mirror → reverse to chronological).
        const claimIds = new Set(deals.filter((d) => d.poolId === pool.poolId && d.claimId > 0n).map((d) => Number(d.claimId)));
        const evs = logs
          .filter((e) => (e.type === "RewardRouted" || e.type === "ClaimDefaulted") && claimIds.has(e.claimId))
          .reverse();
        let acc = Number(ONE);
        const series = [acc];
        for (const e of evs) {
          const delta = Number(e.assets ?? 0n) / 1e6; // scaled proxy step
          acc += e.type === "ClaimDefaulted" ? -delta : delta;
          series.push(acc);
        }
        setNavSeries(series.length > 1 ? series : []);
      } catch { /* keep previous */ }
    })();
    return () => { cancelled = true; };
  }, [contracts, pool.poolId, deals, refreshKey]);

  const idlePct = useMemo(() => {
    const total = Number(pool.totalAssets || 0n);
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, (Number(pool.idle || 0n) / total) * 100));
  }, [pool]);

  const queuedTotal = queue.reduce((acc, r) => acc + r.assets, 0n);

  return (
    <div className="wafer-detail-main">
      <div className="card">
        <h3>Net asset value</h3>
        <div className="wafer-nav-headline">
          <span className="wafer-nav-num">{formatNav(pool.navPerShare)}</span>
          <span className="wafer-nav-unit">HBAR / share</span>
        </div>
        <Sparkline points={navSeries} />
        <p className="wafer-detail-note">NAV rises only by realized reward spread, accreted amortized-cost over each deal's term (SPEC §5). Finance keeps NAV flat.</p>
      </div>

      <div className="card">
        <h3>Liquidity</h3>
        <div className="wafer-liq-bar" aria-hidden="true">
          <div className="wafer-liq-idle" style={{ width: `${idlePct}%` }} />
        </div>
        <div className="wafer-liq-legend">
          <div><span className="wafer-dot wafer-dot-idle" /> Idle cash <b>{formatHbar(pool.idle)} HBAR</b></div>
          <div><span className="wafer-dot wafer-dot-deployed" /> Deployed (receivable) <b>{formatHbar(pool.receivable)} HBAR</b></div>
        </div>
        <div className="vault-summary" style={{ marginTop: "0.75rem" }}>
          <div className="vault-summary-row"><span className="vault-summary-label">Total assets</span><span className="vault-summary-value">{formatHbar(pool.totalAssets)} HBAR</span></div>
          <div className="vault-summary-row"><span className="vault-summary-label">Liquid (instant-redeemable)</span><span className="vault-summary-value">{formatHbar(pool.liquidAssets)} HBAR</span></div>
          <div className="vault-summary-row"><span className="vault-summary-label">Min buffer</span><span className="vault-summary-value">{(pool.minBufferBps / 100).toFixed(2)}%</span></div>
          <div className="vault-summary-row"><span className="vault-summary-label">Redemption queue depth</span><span className="vault-summary-value">{queue.length} req · {formatHbar(queuedTotal)} HBAR</span></div>
        </div>
      </div>

      <div className="card">
        <h3>Deals financed by this pool</h3>
        <div className="mt-table-wrap">
          <table className="mt-table">
            <thead>
              <tr>
                <th style={{ width: '4rem' }}>Deal</th>
                <th style={{ width: '9rem' }}>Operator</th>
                <th style={{ width: '7rem' }}>Advance</th>
                <th style={{ width: '7rem' }}>Expected</th>
                <th style={{ width: '5rem' }}>Term</th>
                <th style={{ width: '5rem' }}>APR</th>
                <th style={{ width: '6rem' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => {
                const apr = dealApr(d.advance, d.expected, d.term);
                return (
                  <tr key={d.dealId} className="mt-row" style={{ cursor: "default" }}>
                    <td><div className="mt-cell"><span className="mt-amount">#{d.dealId}</span></div></td>
                    <td><div className="mt-cell"><a className="mt-oracle-label" href={`${EXPLORER_URL}/account/${d.operator}`} target="_blank" rel="noopener noreferrer">{shortAddr(d.operator)}</a></div></td>
                    <td><div className="mt-cell"><span className="mt-amount">{formatHbar(d.advance)}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-amount">{formatHbar(d.expected)}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-oracle-label">{formatTerm(d.term)}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-rate wafer-apr">{apr == null ? "—" : formatPercent(apr)}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-usd-pill">{DEAL_STATUS[d.status] ?? d.status}</span></div></td>
                  </tr>
                );
              })}
              {deals.length === 0 && (
                <tr><td colSpan={7}><div className="mt-cell" style={{ padding: "1rem", opacity: 0.6 }}>No deals financed yet.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
