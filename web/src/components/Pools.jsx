import React, { useEffect, useState, useMemo } from "react";
import DepositWidget from "./DepositWidget.jsx";
import PoolDetail from "./PoolDetail.jsx";
import { VAULT_CONFIGURED, CATEGORY_LABEL, CATEGORY_LOGO, RISK_CLASSES, poolDisplayName } from "../lib/config.js";
import { formatHbar, formatNav, dealApr, formatPercent } from "../lib/format.js";
import { readDealMeta } from "../lib/mirror.js";

// Pools / Fund-a-category. Lists pools by category × risk class with NAV, TVL,
// and trailing (blended) APR; under each, the deals it finances (from the Mirror
// Node DealProposed feed). Clicking a pool opens its detail + deposit/redeem.
//
// Trailing APR per pool = the volume-weighted blend of its financed deals' APRs
// (advance/expected/term), the realized return curve the pool NAV tracks.

function poolTrailingApr(pool, deals) {
  const financed = deals.filter((d) => d.poolId === pool.poolId && (d.status === 3 || d.status === 4)); // Financed | Repaid
  let wSum = 0, num = 0;
  for (const d of financed) {
    const apr = dealApr(d.advance, d.expected, d.term);
    if (apr == null) continue;
    const w = Number(d.advance);
    wSum += w; num += apr * w;
  }
  return wSum > 0 ? num / wSum : null;
}

export default function Pools({ contracts, onStatus, refreshKey }) {
  const [pools, setPools] = useState([]);
  const [deals, setDeals] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!contracts) return;
    let cancelled = false;
    (async () => {
      try {
        const [list, dealList] = await Promise.all([
          contracts.getPools(),
          contracts.getDeals(),
        ]);
        if (cancelled) return;
        setPools(list);
        setDeals(dealList);
      } catch {
        // leave previous
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [contracts, refreshKey]);

  const decorated = useMemo(() => pools.map((p) => ({
    ...p,
    name: poolDisplayName(p.category, p.class),
    network: CATEGORY_LABEL[p.category] ?? "—",
    logo: CATEGORY_LOGO[p.category] ?? "/logos/hedera.svg",
    risk: RISK_CLASSES[p.class] ?? "—",
    apr: poolTrailingApr(p, deals),
  })), [pools, deals]);

  const filtered = decorated.filter((p) =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.network.toLowerCase().includes(search.toLowerCase())
  );

  if (selected != null) {
    const pool = decorated.find((p) => p.poolId === selected);
    if (!pool) { setSelected(null); return null; }
    const poolDeals = deals.filter((d) => d.poolId === pool.poolId);
    return (
      <div className="markets-page">
        <div className="detail-header">
          <button className="detail-back" onClick={() => setSelected(null)}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back to Pools
          </button>
          <div className="detail-title">
            <div className="mt-token">
              <div className="mt-token-icon"><img src={pool.logo} alt={pool.network} /></div>
              <span className="detail-pair">{pool.name}</span>
              <span className="detail-lltv">Risk {pool.risk}</span>
            </div>
          </div>
        </div>
        <div className="detail-grid">
          <PoolDetail pool={pool} deals={poolDeals} contracts={contracts} refreshKey={refreshKey} />
          <DepositWidget pool={pool} contracts={contracts} onStatus={onStatus} refreshKey={refreshKey} />
        </div>
      </div>
    );
  }

  return (
    <div className="markets-page">
      {!VAULT_CONFIGURED && (
        <div className="net-warning" role="status" style={{ marginBottom: "1rem" }}>
          <span>No vault configured — set VITE_VAULT_ADDRESS to a deployed WaferVault.</span>
        </div>
      )}
      <div className="mt-card">
        <div className="mt-toolbar">
          <div className="mt-toolbar-left">
            <span className="mt-toolbar-title">Pools</span>
            <span className="mt-count-badge">{decorated.length}</span>
          </div>
          <div className="mt-toolbar-right">
            <div className="mt-search">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                <path d="M13.5 13.5L15.8333 15.8333" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
                <path d="M9.35 14.54C12.22 14.54 14.54 12.22 14.54 9.35C14.54 6.49 12.22 4.17 9.35 4.17C6.49 4.17 4.17 6.49 4.17 9.35C4.17 12.22 6.49 14.54 9.35 14.54Z" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
              </svg>
              <input placeholder="Filter pools" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="mt-table-wrap">
          <table className="mt-table">
            <thead>
              <tr>
                <th style={{ width: '4.375rem' }}>Category</th>
                <th style={{ width: '11rem' }}>Pool</th>
                <th style={{ width: '5rem' }}>Class</th>
                <th style={{ width: '9rem' }}>NAV / share</th>
                <th style={{ width: '9rem' }}>TVL</th>
                <th style={{ width: '7rem' }}>Trailing APR</th>
                <th style={{ width: '6rem' }}>Deals</th>
                <th style={{ width: '6rem' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const dealCount = deals.filter((d) => d.poolId === p.poolId).length;
                return (
                  <tr key={p.poolId} className="mt-row" onClick={() => setSelected(p.poolId)}>
                    <td>
                      <div className="mt-cell">
                        <div className="mt-network-icon">
                          <img src={p.logo} alt={p.network} width="44" height="44" />
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="mt-cell">
                        <div className="mt-token">
                          <span className="mt-token-name">{p.name}</span>
                          <span className="mt-oracle-label" style={{ marginLeft: "0.5rem" }}>{p.network}</span>
                        </div>
                      </div>
                    </td>
                    <td><div className="mt-cell"><span className="mt-lltv">{p.risk}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-rate">{formatNav(p.navPerShare)}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-amount">{formatHbar(p.totalAssets)} HBAR</span></div></td>
                    <td><div className="mt-cell"><span className="mt-rate wafer-apr">{p.apr == null ? "—" : formatPercent(p.apr)}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-amount">{dealCount}</span></div></td>
                    <td><div className="mt-cell"><span className={`mt-usd-pill${p.status === 1 ? " wafer-pill-warn" : ""}`}>{p.status === 1 ? "Paused" : "Active"}</span></div></td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8}><div className="mt-cell" style={{ padding: "1.5rem", opacity: 0.6 }}>No pools yet. An admin creates pools by category × class.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
