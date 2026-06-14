import React, { useEffect, useRef, useState } from "react";
import { EXPLORER_URL, CHAIN_NAME } from "../lib/config.js";
import { shortAddr, formatHbar } from "../lib/format.js";

// Account menu pinned top-right (ART-DIRECTION §3). Pill + truncated mono
// address; the dropdown shows the full address + copy, HBAR balance, network,
// the role switch (redundant with the sidebar, fine), and a WORKING Disconnect.
export default function AccountMenu({ account, hbarBalance, role, onRoleChange, onDisconnect }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard unavailable */ }
  };

  const isAdmin = role === "admin";

  return (
    <div className="acct" ref={ref}>
      <button className="acct-pill" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="acct-dot" aria-hidden="true" />
        <span className="acct-addr mono">{shortAddr(account)}</span>
        <svg className="acct-caret" width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? "rotate(180deg)" : "rotate(0)" }}>
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="acct-menu" role="menu">
          <div className="acct-row">
            <span className="label">Address</span>
            <button className="acct-copy" onClick={copy} title="Copy address">
              <span className="mono acct-full">{account}</span>
              <span className="acct-copy-tag">{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>

          <div className="acct-grid">
            <div className="acct-cell">
              <span className="label">HBAR balance</span>
              <span className="mono acct-balance">{hbarBalance == null ? "—" : formatHbar(hbarBalance)}</span>
            </div>
            <div className="acct-cell">
              <span className="label">Network</span>
              <span className="acct-net"><span className="acct-net-dot" aria-hidden="true" />{CHAIN_NAME}</span>
            </div>
          </div>

          <div className="acct-row acct-roles-row">
            <span className="label">View</span>
            <div className="acct-roles" role="group" aria-label="Role view">
              <button className={`acct-role${!isAdmin ? " active" : ""}`} onClick={() => onRoleChange("investor")} aria-pressed={!isAdmin}>Investor</button>
              <button className={`acct-role${isAdmin ? " active" : ""}`} onClick={() => onRoleChange("admin")} aria-pressed={isAdmin}>Admin</button>
            </div>
          </div>

          <a className="acct-link" href={`${EXPLORER_URL}/account/${account}`} target="_blank" rel="noopener noreferrer">
            View on HashScan
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 2.5H9.5V7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" /><path d="M9.5 2.5L2.5 9.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </a>

          <button className="acct-disconnect" onClick={() => { setOpen(false); onDisconnect(); }}>Disconnect</button>
        </div>
      )}
    </div>
  );
}
