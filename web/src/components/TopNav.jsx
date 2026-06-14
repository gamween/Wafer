import React, { useEffect, useRef, useState } from "react";
import AccountMenu from "./AccountMenu.jsx";
import { GITHUB_URL, SPEC_URL, ONEPAGER_URL, HEDERA_URL } from "../lib/links.js";

// Uniswap-style sticky top nav (replaces the old left Sidebar).
// Left:   wafer glyph + wordmark with a caret → mega-menu (docs / GitHub / Hedera).
// Center-left: Deposit · Explore · Portfolio (+ role-gated Operator / Admin).
// Center: a search input wired to filter the Explore tables.
// Right:  "···" overflow menu + Connect (disconnected) / account pill (connected).
//
// The role switch is NOT here — it lives in the account dropdown (AccountMenu),
// matching the spec. Admin nav appears only in Admin view; Operator only for
// owner/operator. All gating is identical to the old sidebar.
function WaferGlyph() {
  return (
    <svg className="tn-glyph" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><clipPath id="tn-wfr-clip"><circle cx="12" cy="12" r="9" /></clipPath></defs>
      <g clipPath="url(#tn-wfr-clip)" stroke="#0a0a0a" strokeWidth="0.9" opacity="0.5">
        <path d="M8 1 V23 M12 1 V23 M16 1 V23 M1 8 H23 M1 12 H23 M1 16 H23" />
      </g>
      <circle cx="12" cy="12" r="9" stroke="#0a0a0a" strokeWidth="1.7" />
      <circle cx="12" cy="3.5" r="0.95" fill="#0a0a0a" />
    </svg>
  );
}

const Caret = ({ open }) => (
  <svg className="tn-caret" width="11" height="11" viewBox="0 0 12 12" fill="none"
    style={{ transform: open ? "rotate(180deg)" : "rotate(0)" }}>
    <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ExtIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M4.5 2.5H9.5V7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9.5 2.5L2.5 9.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function TopNav({
  activeTab, onTabChange, roles, role, onRoleChange,
  account, hbarBalance, connecting, onConnect, onDisconnect,
  search, onSearchChange,
}) {
  const adminView = role === "admin";

  const nav = [
    { id: "deposit", label: "Deposit" },
    { id: "explore", label: "Explore" },
    { id: "dashboard", label: "Portfolio" },
  ];
  if (roles?.isOperator || roles?.isOwner) nav.push({ id: "operator", label: "Operator" });
  if (adminView) nav.push({ id: "admin", label: "Admin" });

  // Explore absorbs pools / activity / secondary into its own sub-tabs, so any of
  // those legacy tab ids should light up the Explore item.
  const exploreTabs = new Set(["explore", "pools", "deposit-pool", "activity", "secondary", "queue"]);
  const isActive = (id) => {
    if (id === "explore") return exploreTabs.has(activeTab) && activeTab !== "deposit";
    return activeTab === id;
  };

  return (
    <header className="tn">
      <div className="tn-inner">
        {/* Brand + mega-menu */}
        <BrandMenu onTabChange={onTabChange} />

        {/* Primary nav */}
        <nav className="tn-nav" aria-label="Primary">
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`tn-link${isActive(item.id) ? " tn-link-active" : ""}${item.id === "admin" ? " tn-link-admin" : ""}`}
              onClick={() => onTabChange(item.id)}
              aria-current={isActive(item.id) ? "page" : undefined}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Search */}
        <div className="tn-search">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M13.5 13.5L15.8333 15.8333" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
            <path d="M9.35 14.54C12.22 14.54 14.54 12.22 14.54 9.35C14.54 6.49 12.22 4.17 9.35 4.17C6.49 4.17 4.17 6.49 4.17 9.35C4.17 12.22 6.49 14.54 9.35 14.54Z" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          </svg>
          <input
            aria-label="Search pools and deals"
            placeholder="Search pools, deals"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => { if (activeTab === "deposit") onTabChange("explore"); }}
          />
        </div>

        {/* Right cluster */}
        <div className="tn-right">
          <OverflowMenu />
          {account ? (
            <AccountMenu
              account={account}
              hbarBalance={hbarBalance}
              role={role}
              onRoleChange={onRoleChange}
              onDisconnect={onDisconnect}
            />
          ) : (
            <button className="tn-connect" onClick={onConnect} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function BrandMenu({ onTabChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div className="tn-brand-wrap" ref={ref}>
      <button className="tn-brand" onClick={() => onTabChange("home")} aria-label="Wafer — home">
        <img className="tn-logo-img" src="/wafer-logo.png" alt="Wafer" style={{ height: 22, width: "auto", display: "block" }} />
      </button>
      <button className="tn-brand-caret" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label="Wafer menu">
        <Caret open={open} />
      </button>
      {open && (
        <div className="tn-mega" role="menu">
          <a className="tn-mega-link" href={SPEC_URL} target="_blank" rel="noopener noreferrer" role="menuitem">Docs / SPEC <ExtIcon /></a>
          <a className="tn-mega-link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer" role="menuitem">GitHub <ExtIcon /></a>
          <a className="tn-mega-link" href={HEDERA_URL} target="_blank" rel="noopener noreferrer" role="menuitem">Hedera <ExtIcon /></a>
          <a className="tn-mega-link" href={ONEPAGER_URL} target="_blank" rel="noopener noreferrer" role="menuitem">One-pager <ExtIcon /></a>
        </div>
      )}
    </div>
  );
}

function OverflowMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="tn-overflow" ref={ref}>
      <button className="tn-overflow-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label="More">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <circle cx="4" cy="10" r="1.6" /><circle cx="10" cy="10" r="1.6" /><circle cx="16" cy="10" r="1.6" />
        </svg>
      </button>
      {open && (
        <div className="tn-overflow-menu" role="menu">
          <a className="tn-mega-link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer" role="menuitem">GitHub <ExtIcon /></a>
          <a className="tn-mega-link" href={SPEC_URL} target="_blank" rel="noopener noreferrer" role="menuitem">Documentation <ExtIcon /></a>
          <a className="tn-mega-link" href={HEDERA_URL} target="_blank" rel="noopener noreferrer" role="menuitem">Hedera Testnet <ExtIcon /></a>
        </div>
      )}
    </div>
  );
}
