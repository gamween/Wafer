import React, { useEffect, useRef, useState } from "react";
import {
  VAULT_CONFIGURED, CATEGORIES, CATEGORY_LABEL, RISK_CLASSES, DEAL_STATUS, CLAIM_STATUS,
  ADDRESSES, poolDisplayName, EXPLORER_URL,
} from "../lib/config.js";
import {
  formatHbar, formatTerm, dealApr, formatPercent, parseUnits8, sanitizeAmountInput,
  settledFraction, shortAddr,
} from "../lib/format.js";
import { formatError } from "../lib/errors.js";

// Admin (owner = multisig, timelocked). Review pending deals → assign class+pool,
// financeClaim + markDefault (timelocked: a queued action shows its executeAfter and
// a Cancel button), KYC allowlist, operator whitelist, pause/freeze, and the full
// enableSecondaryMarket flow (KYC-grant router → create+seed share/WHBAR pair at NAV
// → KYC-grant the new pair) per SPEC §10.
export default function Admin({ contracts, account, onStatus, refreshKey }) {
  const [roles, setRoles] = useState({ isOwner: false });
  const [deals, setDeals] = useState([]);
  const [claims, setClaims] = useState([]);
  const [pools, setPools] = useState([]);
  const [timelock, setTimelock] = useState(0n);
  const [assign, setAssign] = useState({}); // dealId → { class, poolId }
  const [opAddr, setOpAddr] = useState("");
  const [kyc, setKyc] = useState({ poolId: 0, addr: "" });
  const [secCfg, setSecCfg] = useState(null); // { router, whbar, factory }
  const [pairs, setPairs] = useState({}); // poolId → pair address ("" if none)
  const [pending, setPending] = useState({ finance: {}, default: {} }); // id → executeAfter (sec)
  const [busy, setBusy] = useState("");
  const inFlightRef = useRef(false);

  const reload = async () => {
    if (!contracts) return;
    const [r, d, c, p, tl, sc] = await Promise.all([
      contracts.getRoles(), contracts.getDeals(), contracts.getClaims(), contracts.getPools(),
      contracts.getTimelockDelay(), contracts.getSecondaryConfig(),
    ]);
    setRoles(r); setDeals(d); setClaims(c); setPools(p); setTimelock(tl); setSecCfg(sc);
    // Per-pool created pair.
    const pairEntries = {};
    await Promise.all(p.map(async (pool) => { pairEntries[pool.poolId] = await contracts.getSecondaryPair(pool.poolId); }));
    setPairs(pairEntries);
    // Timelock pending actions (only meaningful when delay > 0).
    if (Number(tl) > 0) {
      const fin = {}; const def = {};
      await Promise.all(d.filter((x) => x.status === 1).map(async (x) => {
        const ea = await contracts.getPendingAfter(contracts.financeActionHash(x.dealId));
        if (ea > 0n) fin[x.dealId] = ea;
      }));
      await Promise.all(c.filter((x) => x.status === 0).map(async (x) => {
        const ea = await contracts.getPendingAfter(contracts.defaultActionHash(x.claimId));
        if (ea > 0n) def[x.claimId] = ea;
      }));
      setPending({ finance: fin, default: def });
    } else {
      setPending({ finance: {}, default: {} });
    }
  };

  const hasPair = (addr) => addr && /^0x0*[1-9a-f]/i.test(addr);
  const cfgSet = secCfg && hasPair(secCfg.router); // SaucerSwap addresses wired on-chain

  useEffect(() => {
    let cancelled = false;
    (async () => { try { if (!cancelled) await reload(); } catch { /* keep */ } })();
    return () => { cancelled = true; };
  }, [contracts, refreshKey]);

  const poolName = (poolId) => {
    const p = pools.find((x) => x.poolId === poolId);
    return p ? poolDisplayName(p.category, p.class) : `pool ${poolId}`;
  };

  const run = async (key, label, fn) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true; setBusy(key);
    try {
      onStatus(`${label}…`);
      await fn();
      onStatus(`${label} — done.`);
    } catch (e) {
      onStatus(formatError(e), true);
    } finally { inFlightRef.current = false; setBusy(""); }
  };

  const pendingDeals = deals.filter((d) => d.status === 0); // Proposed
  const approvedDeals = deals.filter((d) => d.status === 1); // Approved (ready to finance)
  const activeClaims = claims.filter((c) => c.status === 0); // Active (defaultable)

  // Enable the share/WHBAR SaucerSwap market for a pool (SPEC §10): read the live pair-create fee,
  // seed ~1000 shares (8dp) at NAV vs the equivalent HBAR, and call enableSecondaryMarket (which
  // KYC-grants the router, creates+seeds the pair, then KYC-grants the new pair). One owner action.
  const enableSecondary = async (pool) => {
    const fee = await contracts.getPairCreateFeeTinybar(secCfg.factory);
    if (fee <= 0n) throw new Error("Could not read the SaucerSwap pair-create fee — try again.");
    // Seed 1000 shares (1000e8 8dp) priced at NAV against the matching HBAR leg (tinybar).
    const shareLiquidity8dp = 1000n * 100_000_000n; // 1000.00000000 shares
    const nav = BigInt(pool.navPerShare || 100_000_000n);
    const hbarLiquidityTinybar = (shareLiquidity8dp * nav) / 100_000_000n; // shares * NAV
    return contracts.enableSecondaryMarket({
      poolId: pool.poolId,
      shareLiquidity8dp,
      hbarLiquidityTinybar,
      pairCreateFeeTinybar: fee,
    });
  };

  const setAssignField = (dealId, k, v) => setAssign((a) => ({ ...a, [dealId]: { ...(a[dealId] || {}), [k]: v } }));

  if (!VAULT_CONFIGURED) {
    return <div className="net-warning" role="status"><span>No vault configured — set VITE_VAULT_ADDRESS.</span></div>;
  }

  return (
    <div>
      {!roles.isOwner && (
        <div className="net-warning" role="status" style={{ marginBottom: "1rem" }}>
          <span>You are not the vault owner ({shortAddr(roles.owner)}). Admin actions will revert. Connect the owner account.</span>
        </div>
      )}
      <div className="card">
        <h2>Admin overview</h2>
        <div className="balances-grid">
          <div className="balance-item"><div className="balance-label">Owner</div><div className="balance-value" style={{ fontSize: "0.95rem" }}>{shortAddr(roles.owner)}</div></div>
          <div className="balance-item"><div className="balance-label">Timelock delay</div><div className="balance-value" style={{ fontSize: "0.95rem" }}>{Number(timelock) === 0 ? "0 (instant)" : formatTerm(timelock)}</div></div>
          <div className="balance-item"><div className="balance-label">Pending deals</div><div className="balance-value">{pendingDeals.length}</div></div>
          <div className="balance-item"><div className="balance-label">Active claims</div><div className="balance-value">{activeClaims.length}</div></div>
        </div>
      </div>

      {/* Timelock / pending actions (D9) — consolidated view of queued financeClaim /
          markDefault actions read straight from the on-chain pendingAfter mapping. */}
      <div className="card">
        <h2>Timelock — pending actions {Number(timelock) > 0 && <span className="wafer-tl-tag">delay {formatTerm(timelock)}</span>}</h2>
        {Number(timelock) === 0 ? (
          <p className="wafer-detail-note">
            Timelock delay is 0 — financeClaim and markDefault execute immediately (no pending window).
            Set a delay (setTimelockDelay) to require a queue → execute window; queued actions then appear here
            with their executeAfter time, read live from the vault's <code>pendingAfter</code> mapping.
          </p>
        ) : (() => {
          const items = [
            ...Object.entries(pending.finance).map(([id, ea]) => ({ kind: "finance", id: Number(id), ea })),
            ...Object.entries(pending.default).map(([id, ea]) => ({ kind: "default", id: Number(id), ea })),
          ].filter((x) => x.ea != null && x.ea > 0n);
          if (items.length === 0) {
            return <p className="wafer-detail-note">No actions currently queued. Queue a financeClaim or markDefault below; it will appear here until its executeAfter time, then it can be executed.</p>;
          }
          return (
            <div className="mt-table-wrap">
              <table className="mt-table">
                <thead>
                  <tr>
                    <th style={{ width: '8rem' }}>Action</th>
                    <th style={{ width: '6rem' }}>Target</th>
                    <th style={{ width: '12rem' }}>Execute after</th>
                    <th style={{ width: '6rem' }}>State</th>
                    <th style={{ width: '12rem' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const ready = BigInt(Math.floor(Date.now() / 1000)) >= it.ea;
                    const isFin = it.kind === "finance";
                    const label = isFin ? `Finance deal #${it.id}` : `Default claim #${it.id}`;
                    const exec = isFin
                      ? () => contracts.financeClaim(it.id).then(reload)
                      : () => contracts.markDefault(it.id).then(reload);
                    const cancel = isFin
                      ? () => contracts.cancelTimelock(contracts.financeActionHash(it.id)).then(reload)
                      : () => contracts.cancelTimelock(contracts.defaultActionHash(it.id)).then(reload);
                    const k = `${it.kind}-${it.id}`;
                    return (
                      <tr key={k} className="mt-row" style={{ cursor: "default" }}>
                        <td><div className="mt-cell"><span className="mt-token-name">{label}</span></div></td>
                        <td><div className="mt-cell"><span className="mt-amount">{isFin ? `deal ${it.id}` : `claim ${it.id}`}</span></div></td>
                        <td><div className="mt-cell"><span className="mt-oracle-label">{new Date(Number(it.ea) * 1000).toLocaleString()}</span></div></td>
                        <td><div className="mt-cell"><span className={`mt-usd-pill${ready ? "" : " wafer-pill-warn"}`}>{ready ? "ready" : "pending"}</span></div></td>
                        <td>
                          <div className="mt-cell" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                            <button className="btn-primary btn-sm" disabled={!ready || busy === `tl-${k}`} onClick={() => run(`tl-${k}`, `Executing ${label}`, exec)}>Execute</button>
                            <button className="btn-secondary btn-sm" disabled={busy === `tlx-${k}`} onClick={() => run(`tlx-${k}`, `Cancelling ${label}`, cancel)}>Cancel</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      {/* Pending deals → approve (assign class + pool) / reject */}
      <div className="card">
        <h2>Pending deals — review &amp; assign</h2>
        <div className="mt-table-wrap">
          <table className="mt-table">
            <thead>
              <tr>
                <th style={{ width: '4rem' }}>Deal</th>
                <th style={{ width: '8rem' }}>Operator</th>
                <th style={{ width: '6rem' }}>Category</th>
                <th style={{ width: '6rem' }}>Advance</th>
                <th style={{ width: '5rem' }}>APR</th>
                <th style={{ width: '5rem' }}>Class</th>
                <th style={{ width: '8rem' }}>Pool</th>
                <th style={{ width: '11rem' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingDeals.map((d) => {
                const a = assign[d.dealId] || {};
                const cls = a.class ?? 0;
                const matchingPools = pools.filter((p) => p.category === d.category);
                const poolId = a.poolId != null ? a.poolId : (matchingPools[0]?.poolId ?? "");
                const apr = dealApr(d.advance, d.expected, d.term);
                return (
                  <tr key={d.dealId} className="mt-row" style={{ cursor: "default" }}>
                    <td><div className="mt-cell"><span className="mt-amount">#{d.dealId}</span></div></td>
                    <td><div className="mt-cell"><a className="mt-oracle-label" href={`${EXPLORER_URL}/account/${d.operator}`} target="_blank" rel="noopener noreferrer">{shortAddr(d.operator)}</a></div></td>
                    <td><div className="mt-cell"><span className="mt-token-name">{CATEGORY_LABEL[d.category] ?? d.category}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-amount">{formatHbar(d.advance)}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-rate wafer-apr">{apr == null ? "—" : formatPercent(apr)}</span></div></td>
                    <td>
                      <div className="mt-cell">
                        <select className="wafer-mini-select" value={cls} onChange={(e) => setAssignField(d.dealId, "class", Number(e.target.value))}>
                          {RISK_CLASSES.map((c, i) => <option key={c} value={i}>{c}</option>)}
                        </select>
                      </div>
                    </td>
                    <td>
                      <div className="mt-cell">
                        <select className="wafer-mini-select" value={poolId} onChange={(e) => setAssignField(d.dealId, "poolId", Number(e.target.value))}>
                          {matchingPools.length === 0 && <option value="">no {CATEGORY_LABEL[d.category]} pool</option>}
                          {matchingPools.map((p) => <option key={p.poolId} value={p.poolId}>{poolDisplayName(p.category, p.class)}</option>)}
                        </select>
                      </div>
                    </td>
                    <td>
                      <div className="mt-cell" style={{ gap: "0.4rem" }}>
                        <button className="btn-primary btn-sm" disabled={poolId === "" || busy === `approve-${d.dealId}`} onClick={() => run(`approve-${d.dealId}`, `Approving deal #${d.dealId}`, () => contracts.approveDeal(d.dealId, cls, poolId).then(reload))}>Approve</button>
                        <button className="btn-secondary btn-sm" disabled={busy === `reject-${d.dealId}`} onClick={() => run(`reject-${d.dealId}`, `Rejecting deal #${d.dealId}`, () => contracts.rejectDeal(d.dealId).then(reload))}>Reject</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {pendingDeals.length === 0 && (
                <tr><td colSpan={8}><div className="mt-cell" style={{ padding: "1rem", opacity: 0.6 }}>No pending deals.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Approved deals → financeClaim (timelocked) */}
      <div className="card">
        <h2>Approved deals — finance {Number(timelock) > 0 && <span className="wafer-tl-tag">timelocked</span>}</h2>
        <div className="mt-table-wrap">
          <table className="mt-table">
            <thead>
              <tr>
                <th style={{ width: '4rem' }}>Deal</th>
                <th style={{ width: '8rem' }}>Pool</th>
                <th style={{ width: '7rem' }}>Advance</th>
                <th style={{ width: '7rem' }}>Expected</th>
                <th style={{ width: '5rem' }}>Term</th>
                <th style={{ width: '8rem' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {approvedDeals.map((d) => {
                const ea = pending.finance[d.dealId];
                const queued = ea != null && ea > 0n;
                const ready = queued && BigInt(Math.floor(Date.now() / 1000)) >= ea;
                return (
                <tr key={d.dealId} className="mt-row" style={{ cursor: "default" }}>
                  <td><div className="mt-cell"><span className="mt-amount">#{d.dealId}</span></div></td>
                  <td><div className="mt-cell"><span className="mt-token-name">{poolName(d.poolId)}</span></div></td>
                  <td><div className="mt-cell"><span className="mt-amount">{formatHbar(d.advance)}</span></div></td>
                  <td><div className="mt-cell"><span className="mt-amount">{formatHbar(d.expected)}</span></div></td>
                  <td><div className="mt-cell"><span className="mt-oracle-label">{formatTerm(d.term)}</span></div></td>
                  <td>
                    <div className="mt-cell" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                      <button className="btn-primary btn-sm" disabled={busy === `fin-${d.dealId}` || (queued && !ready)} onClick={() => run(`fin-${d.dealId}`, `Financing deal #${d.dealId}`, () => contracts.financeClaim(d.dealId).then(reload))}>
                        {Number(timelock) === 0 ? "Finance" : queued ? (ready ? "Execute" : `Pending ${new Date(Number(ea) * 1000).toLocaleTimeString()}`) : "Queue"}
                      </button>
                      {queued && (
                        <button className="btn-secondary btn-sm" disabled={busy === `finx-${d.dealId}`} onClick={() => run(`finx-${d.dealId}`, `Cancelling finance #${d.dealId}`, () => contracts.cancelTimelock(contracts.financeActionHash(d.dealId)).then(reload))}>Cancel</button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
              {approvedDeals.length === 0 && (
                <tr><td colSpan={6}><div className="mt-cell" style={{ padding: "1rem", opacity: 0.6 }}>No approved deals awaiting finance.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Active claims → markDefault (timelocked) */}
      <div className="card">
        <h2>Active claims — settlement &amp; default {Number(timelock) > 0 && <span className="wafer-tl-tag">timelocked</span>}</h2>
        <div className="mt-table-wrap">
          <table className="mt-table">
            <thead>
              <tr>
                <th style={{ width: '4rem' }}>Claim</th>
                <th style={{ width: '7rem' }}>Pool</th>
                <th style={{ width: '8rem' }}>Settled / Expected</th>
                <th style={{ width: '7rem' }}>Carry</th>
                <th style={{ width: '8rem' }}>Progress</th>
                <th style={{ width: '8rem' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {activeClaims.map((c) => {
                const frac = settledFraction(c.settled, c.expected);
                const ea = pending.default[c.claimId];
                const queued = ea != null && ea > 0n;
                const ready = queued && BigInt(Math.floor(Date.now() / 1000)) >= ea;
                return (
                  <tr key={c.claimId} className="mt-row" style={{ cursor: "default" }}>
                    <td><div className="mt-cell"><span className="mt-amount">#{c.claimId}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-token-name">{poolName(c.poolId)}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-amount">{formatHbar(c.settled)} / {formatHbar(c.expected)}</span></div></td>
                    <td><div className="mt-cell"><span className="mt-amount">{formatHbar(c.carry)}</span></div></td>
                    <td>
                      <div className="mt-cell" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.25rem" }}>
                        <div className="wafer-progress"><div className="wafer-progress-fill" style={{ width: `${(frac * 100).toFixed(1)}%` }} /></div>
                      </div>
                    </td>
                    <td>
                      <div className="mt-cell" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                        <button className="btn-secondary btn-sm wafer-danger" disabled={busy === `def-${c.claimId}` || (queued && !ready)} onClick={() => run(`def-${c.claimId}`, `Marking claim #${c.claimId} default`, () => contracts.markDefault(c.claimId).then(reload))}>
                          {Number(timelock) === 0 ? "Mark default" : queued ? (ready ? "Execute default" : `Pending ${new Date(Number(ea) * 1000).toLocaleTimeString()}`) : "Queue default"}
                        </button>
                        {queued && (
                          <button className="btn-secondary btn-sm" disabled={busy === `defx-${c.claimId}`} onClick={() => run(`defx-${c.claimId}`, `Cancelling default #${c.claimId}`, () => contracts.cancelTimelock(contracts.defaultActionHash(c.claimId)).then(reload))}>Cancel</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {activeClaims.length === 0 && (
                <tr><td colSpan={6}><div className="mt-cell" style={{ padding: "1rem", opacity: 0.6 }}>No active claims.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="wafer-admin-cols">
        {/* Operator whitelist */}
        <div className="card">
          <h3>Operator whitelist</h3>
          <label className="wafer-field"><span>Operator address</span>
            <input value={opAddr} onChange={(e) => setOpAddr(e.target.value.trim())} placeholder="0x…" />
          </label>
          <div className="wafer-form-actions">
            <button className="btn-primary btn-sm" disabled={!opAddr || busy === "op-on"} onClick={() => run("op-on", "Registering operator", () => contracts.registerOperator(opAddr, true).then(reload))}>Whitelist</button>
            <button className="btn-secondary btn-sm" disabled={!opAddr || busy === "op-off"} onClick={() => run("op-off", "Removing operator", () => contracts.registerOperator(opAddr, false).then(reload))}>Remove</button>
          </div>
        </div>

        {/* KYC allowlist */}
        <div className="card">
          <h3>KYC allowlist (D2)</h3>
          <label className="wafer-field"><span>Pool</span>
            <select value={kyc.poolId} onChange={(e) => setKyc((k) => ({ ...k, poolId: Number(e.target.value) }))}>
              {pools.map((p) => <option key={p.poolId} value={p.poolId}>{poolDisplayName(p.category, p.class)}</option>)}
            </select>
          </label>
          <label className="wafer-field"><span>Investor address</span>
            <input value={kyc.addr} onChange={(e) => setKyc((k) => ({ ...k, addr: e.target.value.trim() }))} placeholder="0x…" />
          </label>
          <div className="wafer-form-actions">
            <button className="btn-primary btn-sm" disabled={!kyc.addr || busy === "kyc-on"} onClick={() => run("kyc-on", "Granting KYC", () => contracts.adminGrantKyc(kyc.poolId, kyc.addr))}>Grant</button>
            <button className="btn-secondary btn-sm" disabled={!kyc.addr || busy === "kyc-off"} onClick={() => run("kyc-off", "Revoking KYC", () => contracts.adminRevokeKyc(kyc.poolId, kyc.addr))}>Revoke</button>
          </div>
        </div>
      </div>

      {/* Pool compliance levers */}
      <div className="card">
        <h2>Pool compliance levers (D10)</h2>
        {!cfgSet && (
          <p className="wafer-detail-note">
            SaucerSwap addresses not wired on-chain yet — call setSecondaryConfig(router, WHBAR, factory)
            once (owner) before enabling a market. Defaults: router {shortAddr(ADDRESSES.saucerRouter)},
            WHBAR {shortAddr(ADDRESSES.whbar)}, factory {shortAddr(ADDRESSES.saucerFactory)}.
            <button className="btn-secondary btn-sm" style={{ marginLeft: "0.5rem" }} disabled={busy === "seccfg"} onClick={() => run("seccfg", "Wiring SaucerSwap config", () => contracts.setSecondaryConfig(ADDRESSES.saucerRouter, ADDRESSES.whbar, ADDRESSES.saucerFactory).then(reload))}>Wire defaults</button>
          </p>
        )}
        <div className="mt-table-wrap">
          <table className="mt-table">
            <thead>
              <tr>
                <th style={{ width: '9rem' }}>Pool</th>
                <th style={{ width: '6rem' }}>Status</th>
                <th style={{ width: '7rem' }}>Min buffer</th>
                <th style={{ width: '9rem' }}>Secondary pair</th>
                <th style={{ width: '16rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pools.map((p) => {
                const pair = pairs[p.poolId];
                const live = hasPair(pair);
                return (
                <tr key={p.poolId} className="mt-row" style={{ cursor: "default" }}>
                  <td><div className="mt-cell"><span className="mt-token-name">{poolDisplayName(p.category, p.class)}</span></div></td>
                  <td><div className="mt-cell"><span className={`mt-usd-pill${p.status === 1 ? " wafer-pill-warn" : ""}`}>{p.status === 1 ? "Paused" : "Active"}</span></div></td>
                  <td><div className="mt-cell"><span className="mt-oracle-label">{(p.minBufferBps / 100).toFixed(2)}%</span></div></td>
                  <td><div className="mt-cell">{live ? <a className="mt-oracle-label" href={`${EXPLORER_URL}/contract/${pair}`} target="_blank" rel="noopener noreferrer">{shortAddr(pair)}</a> : <span className="mt-oracle-label">none</span>}</div></td>
                  <td>
                    <div className="mt-cell" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                      {p.status === 1
                        ? <button className="btn-secondary btn-sm" disabled={busy === `unpause-${p.poolId}`} onClick={() => run(`unpause-${p.poolId}`, "Unpausing pool", () => contracts.unpausePool(p.poolId).then(reload))}>Unpause</button>
                        : <button className="btn-secondary btn-sm wafer-danger" disabled={busy === `pause-${p.poolId}`} onClick={() => run(`pause-${p.poolId}`, "Pausing pool", () => contracts.pausePool(p.poolId).then(reload))}>Pause</button>}
                      <button className="btn-secondary btn-sm" disabled={!cfgSet || live || busy === `sec-${p.poolId}`} onClick={() => run(`sec-${p.poolId}`, "Enabling SaucerSwap market (create + seed pair, KYC-grant)", () => enableSecondary(p).then(reload))} title="KYC-grant router, create + seed the share/WHBAR pair at NAV, then KYC-grant the new pair (SPEC §10 steps 1-4)">
                        {live ? "Market live" : "Enable secondary"}
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
              {pools.length === 0 && (
                <tr><td colSpan={5}><div className="mt-cell" style={{ padding: "1rem", opacity: 0.6 }}>No pools.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
