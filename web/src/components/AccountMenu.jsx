import React, { useEffect, useRef, useState } from "react";
import { EXPLORER_URL, CHAIN_NAME } from "../lib/config.js";
import { shortAddr, formatHbar } from "../lib/format.js";
import { SOURCIFY_URL, VAULT_HASHSCAN_URL, VAULT_ADDRESS } from "../lib/links.js";

// Deterministic grey gradient avatar from the address — pure CSS, B&W-friendly.
function avatarStyle(account) {
  if (!account) return {};
  const a = parseInt(account.slice(2, 5), 16) % 360;
  return { background: `conic-gradient(from ${a}deg, #2A2A2A, #5F5F5F, #FFFFFF, #2A2A2A)` };
}

const ExtIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M4.5 2.5H9.5V7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9.5 2.5L2.5 9.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Account dropdown: pill = avatar + truncated mono address. The dropdown shows the
// truncated (copyable) address, HBAR balance, network, the Investor/Admin role
// switch, a HashScan link and Disconnect. The gear opens a real Settings sub-view
// (network + verified contract + about) — no dead controls.
export default function AccountMenu({ account, hbarBalance, role, onRoleChange, onDisconnect }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("account"); // "account" | "settings"
  const [copied, setCopied] = useState(false);
  const ref = useRef(null);

  const close = () => { setOpen(false); setView("account"); };

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
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

      {open && view === "account" && (
        <div className="acct-menu" role="menu">
          <div className="acct-menu-head">
            <span className="acct-avatar acct-avatar-lg" style={avatarStyle(account)} aria-hidden="true" />
            <button className="acct-copy" onClick={copy} title="Copy address">
              <span className="mono acct-full">{shortAddr(account)}</span>
              <span className="acct-copy-tag">{copied ? "Copied" : "Copy"}</span>
            </button>
            <button className="acct-gear" title="Settings" aria-label="Settings" type="button" onClick={() => setView("settings")}>
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
            View on HashScan <ExtIcon />
          </a>

          <button className="acct-disconnect" onClick={() => { close(); onDisconnect(); }}>Disconnect</button>
        </div>
      )}

      {open && view === "settings" && (
        <div className="acct-menu" role="menu">
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", paddingBottom: "0.75rem", marginBottom: "0.25rem", borderBottom: "1px solid var(--line)" }}>
            <button onClick={() => setView("account")} aria-label="Back" type="button" style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--text-2)", cursor: "pointer", flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1rem", color: "var(--text)" }}>Settings</span>
          </div>

          <div className="acct-grid">
            <div className="acct-cell">
              <span className="label">Network</span>
              <span className="acct-net"><span className="acct-net-dot" aria-hidden="true" />{CHAIN_NAME}</span>
            </div>
            <div className="acct-cell">
              <span className="label">Theme</span>
              <span className="acct-net">Monochrome</span>
            </div>
          </div>

          <div className="acct-row">
            <span className="label">Vault</span>
            <span className="mono acct-balance">{shortAddr(VAULT_ADDRESS)}</span>
          </div>

          {SOURCIFY_URL && (
            <a className="acct-link" href={SOURCIFY_URL} target="_blank" rel="noopener noreferrer">
              Verified contract (Sourcify) <ExtIcon />
            </a>
          )}
          {VAULT_HASHSCAN_URL && (
            <a className="acct-link" href={VAULT_HASHSCAN_URL} target="_blank" rel="noopener noreferrer">
              Vault on HashScan <ExtIcon />
            </a>
          )}

          <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--line)", fontSize: "0.78rem", color: "var(--text-3)", textAlign: "center" }}>Wafer · InfraFi for DePIN · Hedera Testnet</div>
        </div>
      )}
    </div>
  );
}
