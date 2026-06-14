import React from "react";

// Left sidebar shell (ART-DIRECTION §3). Wafer wordmark + slice glyph at top,
// vertical nav (Pools / Portfolio / Activity, + role-gated extras), and the
// role switch (Investor / Admin) pinned to the bottom. The role switch is a
// VIEW toggle in app state — not a wallet change. Admin nav + screens are
// hidden in Investor mode and only appear in Admin mode.

export default function Sidebar({ activeTab, onTabChange, role, onRoleChange, roles }) {
  const isAdminView = role === "admin";

  // Base investor nav. Operator is shown when the connected wallet is a
  // whitelisted operator (or owner, so they can demo it). Admin tab only in
  // Admin view (and only meaningful for the owner, but the toggle is freely
  // available per spec — actions revert with a clear notice otherwise).
  const nav = [
    { id: "pools", label: "Pools" },
    { id: "dashboard", label: "Portfolio" },
    { id: "queue", label: "Queue" },
    { id: "secondary", label: "Market" },
    { id: "activity", label: "Activity" },
  ];
  if (roles?.isOperator || roles?.isOwner) nav.splice(3, 0, { id: "operator", label: "Operator" });
  if (isAdminView) nav.push({ id: "admin", label: "Admin" });

  return (
    <aside className="sb">
      <button className="sb-brand" onClick={() => onTabChange("home")} aria-label="Wafer — home">
        <span className="sb-logo">
          <svg className="sb-logo-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <defs><clipPath id="wfr-clip"><circle cx="12" cy="12" r="9" /></clipPath></defs>
            <g clipPath="url(#wfr-clip)" stroke="#0E1E2E" strokeWidth="0.9" opacity="0.5">
              <path d="M8 1 V23 M12 1 V23 M16 1 V23 M1 8 H23 M1 12 H23 M1 16 H23" />
            </g>
            <circle cx="12" cy="12" r="9" stroke="#0E1E2E" strokeWidth="1.7" />
            <circle cx="12" cy="3.5" r="0.95" fill="#0E1E2E" />
          </svg>
        </span>
        <span className="sb-wordmark">Wafer</span>
      </button>

      <nav className="sb-nav" aria-label="Primary">
        {nav.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`sb-link${active ? " sb-link-active" : ""}${item.id === "admin" ? " sb-link-admin" : ""}`}
              onClick={() => onTabChange(item.id)}
              aria-current={active ? "page" : undefined}
            >
              <span className="sb-link-bar" aria-hidden="true" />
              <span className="sb-link-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sb-foot">
        <span className="sb-foot-label">View</span>
        <div className="sb-roles" role="group" aria-label="Role view">
          <button
            type="button"
            className={`sb-role${!isAdminView ? " sb-role-active" : ""}`}
            onClick={() => onRoleChange("investor")}
            aria-pressed={!isAdminView}
          >
            Investor
          </button>
          <button
            type="button"
            className={`sb-role${isAdminView ? " sb-role-active" : ""}`}
            onClick={() => onRoleChange("admin")}
            aria-pressed={isAdminView}
          >
            Admin
          </button>
        </div>
      </div>
    </aside>
  );
}
