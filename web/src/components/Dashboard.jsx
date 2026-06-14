import React, { useEffect, useState } from "react";
import { VAULT_CONFIGURED, poolDisplayName, CATEGORY_LABEL } from "../lib/config.js";
import { formatHbar, formatNav, assetsForShares } from "../lib/format.js";

// Dashboard: the connected wallet's pool-share positions + HBAR value at current
// NAV, plus a count of pending redemption requests. Reads share balances from
// each pool's share-token ERC-20 facade (no vault aggregate view).
export default function Dashboard({ contracts, account, refreshKey }) {
  const [rows, setRows] = useState([]);
  const [hbarBalance, setHbarBalance] = useState(null);
  const [pendingRedemptions, setPendingRedemptions] = useState(0);

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
          const value = assetsForShares(shares, p.navPerShare);
          return {
            poolId: p.poolId,
            name: poolDisplayName(p.category, p.class),
            network: CATEGORY_LABEL[p.category] ?? "—",
            navPerShare: p.navPerShare,
            shares,
            value,
          };
        });
        setRows(next.filter((r) => r.shares > 0n).length ? next : next);
        setHbarBalance(hbar);
        if (account) {
          setPendingRedemptions(queue.filter((r) => !r.filled && r.investor?.toLowerCase?.() === account.toLowerCase()).length);
        }
      } catch {
        // leave previous
      }
    })();
    return () => { cancelled = true; };
  }, [contracts, account, refreshKey]);

  const totalValue = rows.reduce((acc, r) => acc + (r.value ?? 0n), 0n);

  return (
    <div>
      {!VAULT_CONFIGURED && (
        <div className="net-warning" role="status" style={{ marginBottom: "1rem" }}>
          <span>No vault configured — set VITE_VAULT_ADDRESS to a deployed WaferVault to see live positions.</span>
        </div>
      )}

      <div className="card">
        <h2>Your Portfolio</h2>
        <div className="balances-grid">
          <div className="balance-item">
            <div className="balance-label">Total share value</div>
            <div className="balance-value">{formatHbar(totalValue)} <span style={{ fontSize: "0.7em", color: "rgba(255,255,255,0.5)" }}>HBAR</span></div>
          </div>
          <div className="balance-item">
            <div className="balance-label"><img src="/logos/hedera.svg" alt="HBAR" className="balance-icon" /> HBAR balance</div>
            <div className="balance-value">{hbarBalance == null ? "—" : formatHbar(hbarBalance)}</div>
          </div>
          <div className="balance-item">
            <div className="balance-label">Pending redemptions</div>
            <div className="balance-value">{pendingRedemptions}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Pool positions</h2>
        <div className="mt-table-wrap">
          <table className="mt-table">
            <thead>
              <tr>
                <th style={{ width: '12rem' }}>Pool</th>
                <th style={{ width: '10rem' }}>Your shares</th>
                <th style={{ width: '9rem' }}>NAV / share</th>
                <th style={{ width: '10rem' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter((r) => r.shares > 0n).map((r) => (
                <tr key={r.poolId} className="mt-row" style={{ cursor: "default" }}>
                  <td>
                    <div className="mt-cell">
                      <span className="mt-token-name">{r.name}</span>
                      <span className="mt-oracle-label" style={{ marginLeft: "0.5rem" }}>{r.network}</span>
                    </div>
                  </td>
                  <td><div className="mt-cell"><span className="mt-amount">{formatHbar(r.shares)}</span></div></td>
                  <td><div className="mt-cell"><span className="mt-rate">{formatNav(r.navPerShare)}</span></div></td>
                  <td><div className="mt-cell"><span className="mt-amount">{formatHbar(r.value)} HBAR</span></div></td>
                </tr>
              ))}
              {rows.filter((r) => r.shares > 0n).length === 0 && (
                <tr><td colSpan={4}><div className="mt-cell" style={{ padding: "1.5rem", opacity: 0.6 }}>No positions yet — deposit into a pool to mint shares.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
