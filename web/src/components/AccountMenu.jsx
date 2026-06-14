import React, { useEffect, useRef, useState } from "react";
import { EXPLORER_URL, CHAIN_NAME } from "../lib/config.js";
import { shortAddr, formatHbar } from "../lib/format.js";

// Derive a deterministic 2-stop gradient from the address for the avatar — pure
// CSS, no deps, black-and-white-friendly (greys only).
function avatarStyle(account) {
  if (!account) return {};
  const h = account.slice(2, 8);
  const a = parseInt(h.slice(0, 3), 16) % 360;
  return { background: `conic-gradient(from ${a}deg, #2A2A2A, #5F5F5F, #FFFFFF, #2A2A2A)` };
}

// Account menu pinned top-right of the nav. Pill = avatar + truncated mono
// address; the dropdown shows avatar + full address + copy, HBAR balance, network,
// the role switch (Investor / Admin), a gear (settings placeholder), a HashScan
// link, and a WORKING Disconnect (hook handles wallet_revokePermissions).
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
        <span className="acct-avatar" style={avatarStyle(account)} aria-hidden="true" />
        <span className="acct-addr mono">{shortAddr(account)}</span>
        <svg className="acct-caret" width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? "rotate(180deg)" : "rotate(0)" }}>
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="acct-menu" role="menu">
          <div className="acct-menu-head">
            <span className="acct-avatar acct-avatar-lg" style={avatarStyle(account)} aria-hidden="true" />
            <button className="acct-copy" onClick={copy} title="Copy address">
              <span className="mono acct-full">{account}</span>
              <span className="acct-copy-tag">{copied ? "Copied" : "Copy"}</span>
            </button>
            <button className="acct-gear" title="Settings (coming soon)" aria-label="Settings" type="button" onClick={() => { /* settings placeholder */ }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
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
