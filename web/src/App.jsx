import React, { useState, useCallback, useEffect, useRef } from "react";
import Sidebar from "./components/Sidebar.jsx";
import AccountMenu from "./components/AccountMenu.jsx";
import Hero from "./components/Hero.jsx";
import HowItWorks from "./components/HowItWorks.jsx";
import StatusBar from "./components/StatusBar.jsx";
import Dashboard from "./components/Dashboard.jsx";
import Pools from "./components/Pools.jsx";
import Activity from "./components/Activity.jsx";
import RedemptionQueue from "./components/RedemptionQueue.jsx";
import OperatorPortal from "./components/OperatorPortal.jsx";
import Admin from "./components/Admin.jsx";
import Secondary from "./components/Secondary.jsx";
import WalletModal from "./components/WalletModal.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { useWallet } from "./hooks/useWallet.js";
import { useContracts } from "./hooks/useContracts.js";
import { formatError } from "./lib/errors.js";

// Investor-mode tabs only — anything else is Admin-gated.
const INVESTOR_TABS = new Set(["home", "pools", "deposit", "dashboard", "queue", "secondary", "activity", "operator"]);

export default function App() {
  const { account, walletClient, publicClient, connecting, connect, disconnect, wrongNetwork, switchNetwork } = useWallet();
  const contracts = useContracts(walletClient, publicClient, account);

  const [tab, setTab] = useState("home");
  const [role, setRole] = useState("investor"); // view toggle: "investor" | "admin"
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [roles, setRoles] = useState({ isOwner: false, isOperator: false });
  const [hbarBalance, setHbarBalance] = useState(null);

  // Coalesce rapid refreshKey bumps so an interactive action plus the periodic
  // tick don't cascade duplicate reads across screens.
  const refreshTimerRef = useRef(null);
  const bumpRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      setRefreshKey((k) => k + 1);
      refreshTimerRef.current = null;
    }, 250);
  }, []);
  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);

  // Background auto-refresh while connected (paused when the tab is hidden).
  useEffect(() => {
    if (!account) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      bumpRefresh();
    };
    const id = setInterval(tick, 5_000);
    return () => clearInterval(id);
  }, [account, bumpRefresh]);

  // Resolve roles (owner/operator) so the sidebar can show the Operator item.
  useEffect(() => {
    if (!account || !contracts?.configured) { setRoles({ isOwner: false, isOperator: false }); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await contracts.getRoles();
        if (!cancelled) setRoles(r);
      } catch { /* keep */ }
    })();
    return () => { cancelled = true; };
  }, [account, contracts, refreshKey]);

  // HBAR balance for the account menu.
  useEffect(() => {
    if (!account || !contracts) { setHbarBalance(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const b = await contracts.getHbarBalance();
        if (!cancelled) setHbarBalance(b);
      } catch { /* keep */ }
    })();
    return () => { cancelled = true; };
  }, [account, contracts, refreshKey]);

  const onStatus = useCallback((msg, isError = false) => {
    setStatus(msg);
    setStatusError(isError);
    bumpRefresh();
  }, [bumpRefresh]);

  const onSwitchNetwork = useCallback(async () => {
    try {
      await switchNetwork();
    } catch (e) {
      onStatus(formatError(e), true);
    }
  }, [switchNetwork, onStatus]);

  const clearStatus = useCallback(() => setStatus(null), []);

  const doConnect = useCallback(async (selectedProvider) => {
    try {
      await connect(selectedProvider);
      onStatus("Wallet connected!");
    } catch (e) {
      onStatus(formatError(e), true);
      throw e;
    }
  }, [connect, onStatus]);

  const openWalletModal = useCallback(() => setWalletModalOpen(true), []);
  const closeWalletModal = useCallback(() => setWalletModalOpen(false), []);

  // The role switch is a pure view toggle (no wallet change). Leaving Admin view
  // bounces any admin-only tab back to Pools so a stale Admin screen can't linger.
  const onRoleChange = useCallback((next) => {
    setRole(next);
    if (next !== "admin") setTab((t) => (INVESTOR_TABS.has(t) ? t : "pools"));
  }, []);

  // Auto-close modal and navigate to pools on first connect.
  useEffect(() => {
    if (account) {
      setWalletModalOpen(false);
      setTab((t) => (t === "home" ? "pools" : t));
    }
  }, [account]);

  // Disconnect: reset wallet state (hook clears account/clients + sets the
  // session flag so auto-reconnect won't re-attach) and return to the hero.
  const onDisconnect = useCallback(() => {
    disconnect();
    setRole("investor");
    setTab("home");
  }, [disconnect]);

  const goPools = useCallback(() => {
    if (account) setTab("pools");
    else openWalletModal();
  }, [account, openWalletModal]);

  const scrollToHow = useCallback(() => {
    const el = typeof document !== "undefined" ? document.getElementById("how-it-works") : null;
    if (el) el.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Hero / disconnected landing: shown when not connected, or when connected and
  // the active tab is "home" (the brand wordmark routes back here).
  if (!account || tab === "home") {
    return (
      <div className="landing-shell landing-locked">
        <Hero onEnter={goPools} connecting={connecting} />
        <div className="grain" aria-hidden="true" />
        <WalletModal
          open={walletModalOpen}
          onClose={closeWalletModal}
          onConnect={doConnect}
          connecting={connecting}
        />
      </div>
    );
  }

  const adminView = role === "admin";

  const TAB_TITLES = {
    pools: "Pools",
    deposit: "Pools",
    dashboard: "Portfolio",
    queue: "Redemption queue",
    secondary: "Secondary market",
    activity: "Activity",
    operator: "Operator",
    admin: "Admin",
  };
  const sectionTitle = TAB_TITLES[tab] || "Wafer";

  return (
    <div className="shell">
      <Sidebar
        activeTab={tab}
        onTabChange={setTab}
        role={role}
        onRoleChange={onRoleChange}
        roles={roles}
      />

      <div className="shell-body">
        <header className="topbar">
          <h1 className="topbar-title">{sectionTitle}</h1>
          <div className="topbar-right">
            <span className="topbar-net">
              <span className="topbar-net-dot" aria-hidden="true" />
              Hedera Testnet
            </span>
            <AccountMenu
              account={account}
              hbarBalance={hbarBalance}
              role={role}
              onRoleChange={onRoleChange}
              onDisconnect={onDisconnect}
            />
          </div>
        </header>

        <main className="shell-main">

          {wrongNetwork && (
            <div className="net-warning" role="alert">
              <span>Wrong network — switch to Hedera Testnet (296) to use Wafer.</span>
              <button onClick={onSwitchNetwork}>Switch network</button>
            </div>
          )}

          <StatusBar message={status} isError={statusError} onClear={clearStatus} />

          <div className="container">
            <ErrorBoundary>
              {tab === "dashboard" && <Dashboard contracts={contracts} account={account} refreshKey={refreshKey} />}
              {(tab === "pools" || tab === "deposit") && <Pools contracts={contracts} onStatus={onStatus} refreshKey={refreshKey} />}
              {tab === "queue" && <RedemptionQueue contracts={contracts} account={account} onStatus={onStatus} refreshKey={refreshKey} />}
              {tab === "operator" && <OperatorPortal contracts={contracts} account={account} onStatus={onStatus} refreshKey={refreshKey} />}
              {tab === "admin" && adminView && <Admin contracts={contracts} account={account} onStatus={onStatus} refreshKey={refreshKey} />}
              {tab === "secondary" && <Secondary contracts={contracts} account={account} publicClient={publicClient} onStatus={onStatus} refreshKey={refreshKey} />}
              {tab === "activity" && <Activity refreshKey={refreshKey} />}
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <div className="grain" aria-hidden="true" />
    </div>
  );
}
