import React, { useEffect, useRef, useState } from "react";
import { VAULT_CONFIGURED, poolDisplayName } from "../lib/config.js";
import { formatHbar, timeAgo } from "../lib/format.js";
import { formatError } from "../lib/errors.js";

// Redemption queue: the connected wallet's pending FIFO redemption requests and
// their position. A request can be claimed (paid out) once the pool's idle cash
// covers it (claimRedemption). Position = how many unfilled requests sit ahead.
export default function RedemptionQueue({ contracts, account, onStatus, refreshKey }) {
  const [queue, setQueue] = useState([]);
  const [pools, setPools] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!contracts) return;
    let cancelled = false;
    (async () => {
      try {
        const [q, p] = await Promise.all([contracts.getRedemptionQueue(), contracts.getPools()]);
        if (cancelled) return;
        setQueue(q);
        setPools(p);
      } catch { /* keep */ }
    })();
    return () => { cancelled = true; };
  }, [contracts, refreshKey]);

  const poolName = (poolId) => {
    const p = pools.find((x) => x.poolId === poolId);
    return p ? poolDisplayName(p.category, p.class) : `pool ${poolId}`;
  };
  const poolLiquid = (poolId) => pools.find((x) => x.poolId === poolId)?.liquidAssets ?? 0n;

  const mine = queue.filter((r) => !r.filled && account && r.investor?.toLowerCase?.() === account.toLowerCase());

  // Position = unfilled requests ahead in the same pool (lower requestId = earlier).
  const positionOf = (req) =>
    queue.filter((r) => !r.filled && r.poolId === req.poolId && r.requestId < req.requestId).length;

  const claim = async (requestId) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusyId(requestId);
    try {
      onStatus("Claiming queued redemption…");
      await contracts.claimRedemption(requestId);
      onStatus("Redemption claimed — HBAR paid out.");
    } catch (e) {
      onStatus(formatError(e), true);
    } finally {
      inFlightRef.current = false;
      setBusyId(null);
    }
  };

  return (
    <div className="markets-page">
      {!VAULT_CONFIGURED && (
        <div className="net-warning" role="status" style={{ marginBottom: "1rem" }}>
          <span>No vault configured — set VITE_VAULT_ADDRESS.</span>
        </div>
      )}
      <div className="mt-card">
        <div className="mt-toolbar">
          <div className="mt-toolbar-left">
            <span className="mt-toolbar-title">Your redemption queue</span>
            <span className="mt-count-badge">{mine.length}</span>
          </div>
        </div>
        <div className="mt-table-wrap">
          <table className="mt-table">
            <thead>
              <tr>
                <th style={{ width: '5rem' }}>Req #</th>
                <th style={{ width: '9rem' }}>Pool</th>
                <th style={{ width: '9rem' }}>Amount owed</th>
                <th style={{ width: '6rem' }}>Position</th>
                <th style={{ width: '7rem' }}>Requested</th>
                <th style={{ width: '9rem' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((req) => {
                const fillable = poolLiquid(req.poolId) >= req.assets;
                const ageSeconds = req.ts > 0n ? Math.max(0, Math.floor(Date.now() / 1000) - Number(req.ts)) : null;
                return (
                  <tr key={req.requestId} className="mt-row" style={{ cursor: "default" }}>
                    <td><div className="mt-cell"><span className="mt-amount">#{req.requestId}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-token-name">{poolName(req.poolId)}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-amount">{formatHbar(req.assets)} HBAR</span></div></td>
                    <td><div className="mt-cell"><span className="mt-oracle-label">{positionOf(req) === 0 ? "next" : `${positionOf(req)} ahead`}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-oracle-label">{timeAgo(ageSeconds)}</span></div></td>
                    <td>
                      <div className="mt-cell">
                        <button
                          className="btn-primary btn-sm"
                          disabled={!fillable || busyId === req.requestId}
                          onClick={() => claim(req.requestId)}
                          title={fillable ? "Claim now — idle cash covers it" : "Waiting on pool idle cash to refill"}
                        >
                          {busyId === req.requestId ? "…" : fillable ? "Claim" : "Pending"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {mine.length === 0 && (
                <tr><td colSpan={6}><div className="mt-cell" style={{ padding: "1.5rem", opacity: 0.6 }}>No pending redemptions. Redeems that exceed instant liquidity appear here.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
