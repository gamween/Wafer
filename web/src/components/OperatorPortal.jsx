import React, { useEffect, useRef, useState } from "react";
import {
  CATEGORIES, CATEGORY_LABEL, DEAL_STATUS, CLAIM_STATUS,
  ADDRESSES, poolDisplayName,
} from "../lib/config.js";
import {
  formatHbar, formatTerm, dealApr, formatPercent, parseUnits8, sanitizeAmountInput,
  settledFraction,
} from "../lib/format.js";
import { formatError } from "../lib/errors.js";

const DAY = 86_400;

// Operator portal: propose a deal (company/description/category/advance/expected/
// term), mint + escrow a collateral device-NFT, and track the operator's deals and
// financed claims (reward/settlement progress). Operator must be whitelisted
// (registerOperator) — surfaced at the top.
export default function OperatorPortal({ contracts, account, onStatus, refreshKey }) {
  const [roles, setRoles] = useState({ isOperator: false });
  const [deals, setDeals] = useState([]);
  const [claims, setClaims] = useState([]);
  const [pools, setPools] = useState([]);
  const [device, setDevice] = useState(null); // { serial, collection } after mint
  const [form, setForm] = useState({
    company: "", description: "", category: 0, advance: "", expected: "", termDays: "90",
  });
  const [busy, setBusy] = useState("");
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!contracts) return;
    let cancelled = false;
    (async () => {
      try {
        const [r, d, c, p] = await Promise.all([
          contracts.getRoles(), contracts.getDeals(), contracts.getClaims(), contracts.getPools(),
        ]);
        if (cancelled) return;
        setRoles(r); setDeals(d); setClaims(c); setPools(p);
      } catch { /* keep */ }
    })();
    return () => { cancelled = true; };
  }, [contracts, refreshKey]);

  const myDeals = deals.filter((d) => account && d.operator?.toLowerCase?.() === account.toLowerCase());
  const myClaims = claims.filter((c) => account && c.operator?.toLowerCase?.() === account.toLowerCase());
  const poolName = (poolId) => {
    const p = pools.find((x) => x.poolId === poolId);
    return p ? poolDisplayName(p.category, p.class) : `pool ${poolId}`;
  };

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const advanceUnits = parseUnits8(form.advance);
  const expectedUnits = parseUnits8(form.expected);
  const termSeconds = BigInt(Math.max(0, Math.floor(Number(form.termDays) || 0)) * DAY);
  const aprPreview = dealApr(advanceUnits, expectedUnits, termSeconds);
  // proposeDeal requires a non-zero device collection (ZERO_DEVICE revert) and
  // financeClaim needs a serial the operator actually owns + approved — so require
  // the mint+escrow step before proposing.
  const formValid = advanceUnits > 0n && expectedUnits >= advanceUnits && termSeconds > 0n && !!device;

  const mintDevice = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true; setBusy("mint");
    try {
      onStatus("Minting collateral device-NFT…");
      const { serial, collection } = await contracts.mintDeviceNft(form.company || "wafer-device");
      onStatus("Approving vault to escrow the device…");
      await contracts.approveDeviceEscrow(collection, serial);
      setDevice({ serial, collection });
      onStatus(`Device-NFT serial #${serial} minted + approved for escrow.`);
    } catch (e) {
      onStatus(formatError(e), true);
    } finally { inFlightRef.current = false; setBusy(""); }
  };

  const submitDeal = async () => {
    if (inFlightRef.current || !formValid) return;
    inFlightRef.current = true; setBusy("propose");
    try {
      const details = JSON.stringify({
        company: form.company, description: form.description, category: CATEGORIES[form.category],
      });
      onStatus("Submitting deal proposal…");
      await contracts.proposeDeal({
        category: form.category,
        advance: advanceUnits,
        expected: expectedUnits,
        term: termSeconds,
        details,
        deviceNft: device?.collection || ADDRESSES.deviceCollection,
        deviceSerial: device?.serial ?? 0,
      });
      onStatus("Deal proposed — pending admin review.");
      setForm({ company: "", description: "", category: 0, advance: "", expected: "", termDays: "90" });
      setDevice(null);
    } catch (e) {
      onStatus(formatError(e), true);
    } finally { inFlightRef.current = false; setBusy(""); }
  };

  return (
    <div>
      {!roles.isOperator && (
        <div className="net-warning" role="status" style={{ marginBottom: "1rem" }}>
          <span>This address is not a whitelisted operator. An admin must registerOperator your address before you can propose deals.</span>
        </div>
      )}

      <div className="card">
        <h2>Propose a deal</h2>
        <div className="wafer-form-grid">
          <label className="wafer-field">
            <span>Company</span>
            <input value={form.company} onChange={(e) => setField("company", e.target.value)} placeholder="Acme GPU Co." />
          </label>
          <label className="wafer-field">
            <span>Category</span>
            <select value={form.category} onChange={(e) => setField("category", Number(e.target.value))}>
              {CATEGORIES.map((c, i) => <option key={c} value={i}>{CATEGORY_LABEL[i]}</option>)}
            </select>
          </label>
          <label className="wafer-field wafer-field-wide">
            <span>Description</span>
            <input value={form.description} onChange={(e) => setField("description", e.target.value)} placeholder="50× H100 nodes, 6-month reward stream" />
          </label>
          <label className="wafer-field">
            <span>Advance (HBAR)</span>
            <input inputMode="decimal" value={form.advance} onChange={(e) => setField("advance", sanitizeAmountInput(e.target.value))} placeholder="90" />
          </label>
          <label className="wafer-field">
            <span>Expected repayment (HBAR)</span>
            <input inputMode="decimal" value={form.expected} onChange={(e) => setField("expected", sanitizeAmountInput(e.target.value))} placeholder="100" />
          </label>
          <label className="wafer-field">
            <span>Term (days)</span>
            <input inputMode="numeric" value={form.termDays} onChange={(e) => setField("termDays", e.target.value.replace(/[^0-9]/g, ""))} placeholder="90" />
          </label>
        </div>

        <div className="vault-summary" style={{ marginTop: "0.75rem" }}>
          <div className="vault-summary-row"><span className="vault-summary-label">Implied APR</span><span className="vault-summary-value vault-apy">{aprPreview == null ? "—" : formatPercent(aprPreview)}</span></div>
          <div className="vault-summary-row"><span className="vault-summary-label">Device collateral</span><span className="vault-summary-value">{device ? `serial #${device.serial} (escrow approved)` : "none yet"}</span></div>
        </div>

        <div className="wafer-form-actions">
          <button className="btn-secondary" disabled={!roles.isOperator || busy === "mint"} onClick={mintDevice}>
            {busy === "mint" ? "Minting…" : device ? "Re-mint device" : "Mint + escrow device-NFT"}
          </button>
          <button className="btn-primary" disabled={!roles.isOperator || !formValid || busy === "propose"} onClick={submitDeal}>
            {busy === "propose" ? "Submitting…" : "Propose deal"}
          </button>
        </div>
        {expectedUnits > 0n && expectedUnits < advanceUnits && (
          <p className="wafer-detail-note" style={{ color: "var(--red)" }}>Expected repayment must be ≥ advance.</p>
        )}
        {!device && (
          <p className="wafer-detail-note">Mint + escrow a device-NFT first — it is the collateral pulled into the vault at finance.</p>
        )}
      </div>

      <div className="card">
        <h2>Your deals</h2>
        <div className="mt-table-wrap">
          <table className="mt-table">
            <thead>
              <tr>
                <th style={{ width: '4rem' }}>Deal</th>
                <th style={{ width: '7rem' }}>Category</th>
                <th style={{ width: '7rem' }}>Advance</th>
                <th style={{ width: '7rem' }}>Expected</th>
                <th style={{ width: '5rem' }}>Term</th>
                <th style={{ width: '5rem' }}>APR</th>
                <th style={{ width: '7rem' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {myDeals.map((d) => {
                const apr = dealApr(d.advance, d.expected, d.term);
                return (
                  <tr key={d.dealId} className="mt-row" style={{ cursor: "default" }}>
                    <td><div className="mt-cell"><span className="mt-amount">#{d.dealId}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-token-name">{CATEGORY_LABEL[d.category] ?? d.category}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-amount">{formatHbar(d.advance)}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-amount">{formatHbar(d.expected)}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-oracle-label">{formatTerm(d.term)}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-rate wafer-apr">{apr == null ? "—" : formatPercent(apr)}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-usd-pill">{DEAL_STATUS[d.status] ?? d.status}</span></div></td>
                  </tr>
                );
              })}
              {myDeals.length === 0 && (
                <tr><td colSpan={7}><div className="mt-cell" style={{ padding: "1rem", opacity: 0.6 }}>No deals proposed yet.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Your financed claims</h2>
        <div className="mt-table-wrap">
          <table className="mt-table">
            <thead>
              <tr>
                <th style={{ width: '4rem' }}>Claim</th>
                <th style={{ width: '7rem' }}>Pool</th>
                <th style={{ width: '7rem' }}>Settled</th>
                <th style={{ width: '7rem' }}>Expected</th>
                <th style={{ width: '8rem' }}>Reward progress</th>
                <th style={{ width: '6rem' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {myClaims.map((c) => {
                const frac = settledFraction(c.settled, c.expected);
                return (
                  <tr key={c.claimId} className="mt-row" style={{ cursor: "default" }}>
                    <td><div className="mt-cell"><span className="mt-amount">#{c.claimId}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-token-name">{poolName(c.poolId)}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-amount">{formatHbar(c.settled)}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-amount">{formatHbar(c.expected)}</span></div></td>
                    <td>
                      <div className="mt-cell" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.25rem" }}>
                        <div className="wafer-progress"><div className="wafer-progress-fill" style={{ width: `${(frac * 100).toFixed(1)}%` }} /></div>
                        <span className="mt-oracle-label">{(frac * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td><div className="mt-cell"><span className="mt-usd-pill">{CLAIM_STATUS[c.status] ?? c.status}</span></div></td>
                  </tr>
                );
              })}
              {myClaims.length === 0 && (
                <tr><td colSpan={6}><div className="mt-cell" style={{ padding: "1rem", opacity: 0.6 }}>No financed claims yet.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
