import React, { useEffect, useMemo, useState } from "react";
import DepositWidget from "./DepositWidget.jsx";
import PoolDetail from "./PoolDetail.jsx";
import Activity from "./Activity.jsx";
import {
  VAULT_CONFIGURED, CATEGORY_LABEL, CATEGORY_LOGO, RISK_CLASSES, DEAL_STATUS, poolDisplayName, EXPLORER_URL,
} from "../lib/config.js";
import { formatHbar, formatNav, formatPercent, formatTerm, dealApr, shortHash } from "../lib/format.js";

// Explore — the protocol's market surface, Uniswap-style.
// KPI row (TVL, deployed, idle, pools, blended APR) over contract reads, then
// three tabs: Pools (table → click opens detail + deposit), Deals (advance →
// expected, term, implied APR, status), Activity (Mirror Node event feed).
// `search` filters the Pools and Deals tables by name/category.

function poolTrailingApr(poolId, deals) {
  const financed = deals.filter((d) => d.poolId === poolId && (d.status === 3 || d.status === 4));
  let wSum = 0, num = 0;
  for (const d of financed) {
    const apr = dealApr(d.advance, d.expected, d.term);
    if (apr == null) continue;
    const w = Number(d.advance); wSum += w; num += apr * w;
  }
  return wSum > 0 ? num / wSum : null;
}

// Tiny inline sparkline from a pool's idle/deployed split (a cheap, real "% deployed"
// shape — no fake series). Shows a single filled bar proportion.
function MiniBar({ pct }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <span className="ex-minibar" aria-hidden="true"><span className="ex-minibar-fill" style={{ width: `${p}%` }} /></span>
  );
}

export default function Explore({ contracts, account, publicClient, onStatus, refreshKey, search, initialSubTab, onOpenDeposit }) {
  const [pools, setPools] = useState([]);
  const [deals, setDeals] = useState([]);
  const [subTab, setSubTab] = useState(initialSubTab || "pools");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (initialSubTab) setSubTab(initialSubTab); }, [initialSubTab]);

  useEffect(() => {
    if (!contracts) return;
    let cancelled = false;
    (async () => {
      try {
        const [list, dealList] = await Promise.all([contracts.getPools(), contracts.getDeals()]);
        if (cancelled) return;
        setPools(list);
        setDeals(dealList);
      } catch { /* keep */ } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [contracts, refreshKey]);

  const decorated = useMemo(() => pools.map((p) => {
    const total = Number(p.totalAssets || 0n);
    const deployedPct = total > 0 ? (Number(p.receivable || 0n) / total) * 100 : 0;
    return {
      ...p,
      name: poolDisplayName(p.category, p.class),
      network: CATEGORY_LABEL[p.category] ?? "—",
      logo: CATEGORY_LOGO[p.category] ?? "/logos/hedera.svg",
      risk: RISK_CLASSES[p.class] ?? "—",
      apr: poolTrailingApr(p.poolId, deals),
      deployedPct,
    };
  }), [pools, deals]);

  // Protocol KPIs — all derived from live contract reads; "—" when unavailable.
  const kpis = useMemo(() => {
    if (pools.length === 0) return { tvl: null, deployed: null, idle: null, count: 0, apr: null };
    let tvl = 0n, deployed = 0n, idle = 0n;
    for (const p of pools) { tvl += p.totalAssets || 0n; deployed += p.receivable || 0n; idle += p.idle || 0n; }
    // Blended APR weighted by each pool's deployed (receivable) balance.
    let wSum = 0, num = 0;
    for (const p of decorated) {
      if (p.apr == null) continue;
      const w = Number(p.receivable || 0n) || 1;
      wSum += w; num += p.apr * w;
    }
    return { tvl, deployed, idle, count: pools.length, apr: wSum > 0 ? num / wSum : null };
  }, [pools, decorated]);

  const q = (search || "").trim().toLowerCase();
  const filteredPools = decorated.filter((p) => !q || p.name.toLowerCase().includes(q) || p.network.toLowerCase().includes(q));
  const filteredDeals = useMemo(() => {
    return deals.filter((d) => {
      if (!q) return true;
      const cat = (CATEGORY_LABEL[d.category] ?? "").toLowerCase();
      return cat.includes(q) || `#${d.dealId}`.includes(q) || shortHash(d.detailsHash).toLowerCase().includes(q);
    });
  }, [deals, q]);

  // Pool detail drilldown (reuses PoolDetail + DepositWidget data logic).
  if (selected != null) {
    const pool = decorated.find((p) => p.poolId === selected);
    if (!pool) { setSelected(null); return null; }
    const poolDeals = deals.filter((d) => d.poolId === pool.poolId);
    return (
      <div className="markets-page">
        <div className="detail-header">
          <button className="detail-back" onClick={() => setSelected(null)}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to Explore
          </button>
          <div className="detail-title">
            <div className="mt-token">
              <div className="mt-token-icon"><img src={pool.logo} alt={pool.network} /></div>
              <span className="detail-pair">{pool.name}</span>
              <span className="detail-lltv">Risk {pool.risk}</span>
            </div>
          </div>
          <button className="btn-secondary btn-sm" style={{ marginLeft: "auto" }} onClick={() => onOpenDeposit?.(pool.poolId)}>Open in Deposit</button>
        </div>
        <div className="detail-grid">
          <PoolDetail pool={pool} deals={poolDeals} contracts={contracts} refreshKey={refreshKey} />
          <DepositWidget pool={pool} contracts={contracts} onStatus={onStatus} refreshKey={refreshKey} />
        </div>
      </div>
    );
  }

  return (
    <div className="ex-page">
      {!VAULT_CONFIGURED && (
        <div className="net-warning" role="status" style={{ marginBottom: "1rem" }}>
          <span>No vault configured — set VITE_VAULT_ADDRESS to a deployed WaferVault.</span>
        </div>
      )}

      {/* KPI row */}
      <div className="ex-kpis">
        <div className="ex-kpi"><span className="ex-kpi-label">Total TVL</span><span className="ex-kpi-val">{kpis.tvl == null ? "—" : `${formatHbar(kpis.tvl)}`}</span><span className="ex-kpi-unit">HBAR</span></div>
        <div className="ex-kpi"><span className="ex-kpi-label">Deployed</span><span className="ex-kpi-val">{kpis.deployed == null ? "—" : `${formatHbar(kpis.deployed)}`}</span><span className="ex-kpi-unit">HBAR</span></div>
        <div className="ex-kpi"><span className="ex-kpi-label">Idle</span><span className="ex-kpi-val">{kpis.idle == null ? "—" : `${formatHbar(kpis.idle)}`}</span><span className="ex-kpi-unit">HBAR</span></div>
        <div className="ex-kpi"><span className="ex-kpi-label">Pools</span><span className="ex-kpi-val">{kpis.count}</span></div>
        <div className="ex-kpi"><span className="ex-kpi-label">Blended APR</span><span className="ex-kpi-val ex-kpi-apr">{kpis.apr == null ? "—" : formatPercent(kpis.apr)}</span></div>
      </div>

      {/* Sub-tabs */}
      <div className="ex-subtabs">
        <button className={`ex-subtab${subTab === "pools" ? " active" : ""}`} onClick={() => setSubTab("pools")}>Pools</button>
        <button className={`ex-subtab${subTab === "deals" ? " active" : ""}`} onClick={() => setSubTab("deals")}>Deals</button>
        <button className={`ex-subtab${subTab === "activity" ? " active" : ""}`} onClick={() => setSubTab("activity")}>Activity</button>
      </div>

      {subTab === "pools" && (
        <div className="mt-card">
          <div className="mt-table-wrap">
            <table className="mt-table">
              <thead>
                <tr>
                  <th style={{ width: '3rem' }}>#</th>
                  <th style={{ width: '14rem' }}>Pool</th>
                  <th style={{ width: '5rem' }}>Class</th>
                  <th style={{ width: '8rem' }}>NAV / share</th>
                  <th style={{ width: '9rem' }}>TVL</th>
                  <th style={{ width: '7rem' }}>Trailing APR</th>
                  <th style={{ width: '10rem' }}>% Deployed</th>
                  <th style={{ width: '6rem' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredPools.map((p, i) => (
                  <tr key={p.poolId} className="mt-row" onClick={() => setSelected(p.poolId)}>
                    <td><div className="mt-cell"><span className="mt-lltv">{i + 1}</span></div></td>
                    <td>
                      <div className="mt-cell">
                        <div className="mt-network-icon"><img src={p.logo} alt={p.network} width="44" height="44" /></div>
                        <div className="mt-token" style={{ marginLeft: "0.5rem" }}>
                          <span className="mt-token-name">{p.name}</span>
                          <span className="mt-oracle-label" style={{ marginLeft: "0.5rem" }}>{p.network}</span>
                        </div>
                      </div>
                    </td>
                    <td><div className="mt-cell"><span className="mt-lltv">{p.risk}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-rate">{formatNav(p.navPerShare)}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-amount">{formatHbar(p.totalAssets)} HBAR</span></div></td>
                    <td><div className="mt-cell"><span className="mt-rate wafer-apr">{p.apr == null ? "—" : formatPercent(p.apr)}</span></div></td>
                    <td>
                      <div className="mt-cell" style={{ gap: "0.5rem" }}>
                        <MiniBar pct={p.deployedPct} />
                        <span className="mt-lltv">{p.deployedPct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td><div className="mt-cell"><span className={`mt-usd-pill${p.status === 1 ? " wafer-pill-warn" : ""}`}>{p.status === 1 ? "Paused" : "Active"}</span></div></td>
                  </tr>
                ))}
                {!loading && filteredPools.length === 0 && (
                  <tr><td colSpan={8}><div className="mt-cell" style={{ padding: "1.5rem", opacity: 0.6 }}>{q ? "No pools match your search." : "No pools yet. An admin creates pools by category × class."}</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === "deals" && (
        <div className="mt-card">
          <div className="mt-table-wrap">
            <table className="mt-table">
              <thead>
                <tr>
                  <th style={{ width: '3rem' }}>#</th>
                  <th style={{ width: '9rem' }}>Company / details</th>
                  <th style={{ width: '7rem' }}>Category</th>
                  <th style={{ width: '8rem' }}>Advance → Expected</th>
                  <th style={{ width: '5rem' }}>Term</th>
                  <th style={{ width: '6rem' }}>Implied APR</th>
                  <th style={{ width: '7rem' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredDeals.map((d) => {
                  const apr = dealApr(d.advance, d.expected, d.term);
                  return (
                    <tr key={d.dealId} className="mt-row" style={{ cursor: "default" }}>
                      <td><div className="mt-cell"><span className="mt-lltv">#{d.dealId}</span></div></td>
                      <td><div className="mt-cell"><a className="mt-oracle-label" href={`${EXPLORER_URL}/account/${d.operator}`} target="_blank" rel="noopener noreferrer">{shortHash(d.detailsHash)}</a></div></td>
                      <td><div className="mt-cell"><span className="mt-token-name">{CATEGORY_LABEL[d.category] ?? d.category}</span></div></td>
                      <td><div className="mt-cell"><span className="mt-amount">{formatHbar(d.advance)} → {formatHbar(d.expected)}</span></div></td>
                      <td><div className="mt-cell"><span className="mt-oracle-label">{formatTerm(d.term)}</span></div></td>
                      <td><div className="mt-cell"><span className="mt-rate wafer-apr">{apr == null ? "—" : formatPercent(apr)}</span></div></td>
                      <td><div className="mt-cell"><span className={`mt-usd-pill ${d.status === 5 ? "wafer-tone-neg" : d.status === 4 ? "wafer-tone-pos" : "wafer-tone-neutral"}`}>{DEAL_STATUS[d.status] ?? d.status}</span></div></td>
                    </tr>
                  );
                })}
                {!loading && filteredDeals.length === 0 && (
                  <tr><td colSpan={7}><div className="mt-cell" style={{ padding: "1.5rem", opacity: 0.6 }}>{q ? "No deals match your search." : "No deals yet."}</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === "activity" && <Activity refreshKey={refreshKey} />}
    </div>
  );
}
