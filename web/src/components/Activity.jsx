import React, { useEffect, useState } from "react";
import { readActivity } from "../lib/mirror.js";
import { VAULT_CONFIGURED, EXPLORER_URL } from "../lib/config.js";
import { formatHbar, shortAddr, timeAgo } from "../lib/format.js";

// Activity feed: the vault's full event surface from the Mirror Node
// (/api/v1/contracts/{id}/results/logs), decoded against VAULT_ABI.
const TYPE_META = {
  Deposit: { label: "Deposit", tone: "pos" },
  Redeem: { label: "Redeem", tone: "neutral" },
  DealProposed: { label: "Deal proposed", tone: "neutral" },
  DealApproved: { label: "Deal approved", tone: "pos" },
  DealRejected: { label: "Deal rejected", tone: "neg" },
  ClaimFinanced: { label: "Claim financed", tone: "neutral" },
  RewardRouted: { label: "Reward routed", tone: "pos" },
  ClaimRepaid: { label: "Claim repaid", tone: "pos" },
  ClaimDefaulted: { label: "Default", tone: "neg" },
  RedemptionQueued: { label: "Redemption queued", tone: "neutral" },
  RedemptionFilled: { label: "Redemption filled", tone: "pos" },
  KycGranted: { label: "KYC granted", tone: "pos" },
  KycRevoked: { label: "KYC revoked", tone: "neg" },
  Paused: { label: "Pool paused", tone: "neg" },
  Frozen: { label: "Account frozen", tone: "neg" },
  AdvanceScheduled: { label: "Advance locked (HIP-1215)", tone: "neutral" },
  AdvanceReleased: { label: "Advance released", tone: "pos" },
};

export default function Activity({ refreshKey }) {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await readActivity();
      if (!cancelled) setEvents(list);
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  return (
    <div className="markets-page">
      {!VAULT_CONFIGURED && (
        <div className="net-warning" role="status" style={{ marginBottom: "1rem" }}>
          <span>No vault configured — the live feed reads vault logs from the Mirror Node once VITE_VAULT_ADDRESS is set.</span>
        </div>
      )}
      <div className="mt-card">
        <div className="mt-toolbar">
          <div className="mt-toolbar-left">
            <span className="mt-toolbar-title">Activity</span>
            <span className="mt-count-badge">{events.length}</span>
          </div>
        </div>

        <div className="mt-table-wrap">
          <table className="mt-table">
            <thead>
              <tr>
                <th style={{ width: '10rem' }}>Event</th>
                <th style={{ width: '8rem' }}>Pool / Deal</th>
                <th style={{ width: '12rem' }}>Account / Claim</th>
                <th style={{ width: '10rem' }}>Amount</th>
                <th style={{ width: '7rem' }}>When</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev, i) => {
                const meta = TYPE_META[ev.type] || { label: ev.type, tone: "neutral" };
                const subject = ev.account
                  ? <a className="mt-oracle-label" href={`${EXPLORER_URL}/account/${ev.account}`} target="_blank" rel="noopener noreferrer">{shortAddr(ev.account)}</a>
                  : ev.claimId != null ? <span className="mt-oracle-label">claim #{ev.claimId}</span> : "—";
                const poolOrDeal = ev.poolId != null
                  ? <span className="mt-token-name">pool {ev.poolId}</span>
                  : ev.dealId != null ? <span className="mt-token-name">deal #{ev.dealId}</span> : "—";
                return (
                  <tr key={ev.txHash || i} className="mt-row" style={{ cursor: "default" }}>
                    <td><div className="mt-cell"><span className={`mt-usd-pill wafer-tone-${meta.tone}`}>{meta.label}</span></div></td>
                    <td><div className="mt-cell">{poolOrDeal}</div></td>
                    <td><div className="mt-cell">{subject}</div></td>
                    <td><div className="mt-cell"><span className="mt-amount">{ev.assets != null ? `${formatHbar(ev.assets)} HBAR` : "—"}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-oracle-label">{timeAgo(ev.ageSeconds)}</span></div></td>
                  </tr>
                );
              })}
              {events.length === 0 && (
                <tr><td colSpan={5}><div className="mt-cell" style={{ padding: "1.5rem", opacity: 0.6 }}>No events yet.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
