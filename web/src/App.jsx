import React, { useState, useCallback, useEffect, useRef } from "react";
import TopNav from "./components/TopNav.jsx";
import Footer from "./components/Footer.jsx";
import Hero from "./components/Hero.jsx";
import HowItWorks from "./components/HowItWorks.jsx";
import StatusBar from "./components/StatusBar.jsx";
import DepositCard from "./components/DepositCard.jsx";
import Explore from "./components/Explore.jsx";
import Discover from "./components/Discover.jsx";
import Portfolio from "./components/Portfolio.jsx";
import OperatorPortal from "./components/OperatorPortal.jsx";
import Admin from "./components/Admin.jsx";
import WalletModal from "./components/WalletModal.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { useWallet } from "./hooks/useWallet.js";
import { useContracts } from "./hooks/useContracts.js";
import { formatError } from "./lib/errors.js";

// Investor-mode tabs only — anything else is Admin-gated.
const INVESTOR_TABS = new Set(["home", "discover", "deposit", "explore", "dashboard", "operator", "activity", "queue"]);

export default function App() {
  const { account, walletClient, publicClient, connecting, connect, disconnect, wrongNetwork, switchNetwork } = useWallet();
  const contracts = useContracts(walletClient, publicClient, account);

  const [tab, setTab] = useState("home");
  const [role, setRole] = useState("investor"); // view toggle: "investor" | "admin"
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [roles, setRoles] = useState({ isOwner: false, isOperator: false });
  const [hbarBalance, setHbarBalance] = useState(null);
  const [search, setSearch] = useState("");
  const [depositPoolId, setDepositPoolId] = useState(undefined); // pre-fill the Deposit card
  const [exploreSubTab, setExploreSubTab] = useState("pools");

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

  // Resolve roles (owner/operator) so the nav can show the Operator item.
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
  // bounces any admin-only tab back to Deposit so a stale Admin screen can't linger.
  const onRoleChange = useCallback((next) => {
    setRole(next);
    if (next !== "admin") setTab((t) => (INVESTOR_TABS.has(t) ? t : "deposit"));
  }, []);

  // Tab change with side-effects for the cross-screen routing helpers.
  const onTabChange = useCallback((next) => {
    if (next === "explore") {
      setExploreSubTab("pools");
    }
    setTab(next);
  }, []);

  // Auto-close modal and navigate to Deposit on first connect.
  useEffect(() => {
    if (account) {
      setWalletModalOpen(false);
      setTab((t) => (t === "home" ? "discover" : t));
    }
  }, [account]);

  // Disconnect: reset wallet state and return to the hero.
  const onDisconnect = useCallback(() => {
    disconnect();
    setRole("investor");
    setTab("home");
  }, [disconnect]);

  const goApp = useCallback(() => {
    if (account) setTab("discover");
    else openWalletModal();
  }, [account, openWalletModal]);

  // Open the Deposit card, optionally pre-filled with a pool (from Explore /
  // Portfolio drilldowns).
  const openDeposit = useCallback((poolId) => {
    if (poolId != null) setDepositPoolId(poolId);
    setTab("deposit");
  }, []);

  // Hero / disconnected landing.
  if (!account || tab === "home") {
    return (
      <div className="landing-shell landing-locked">
        <Hero onEnter={goApp} connecting={connecting} />
        <HowItWorks onEnter={goApp} />
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

  return (
    <div className="shell-v2">
      <TopNav
        activeTab={tab}
        onTabChange={onTabChange}
        roles={roles}
        role={role}
        onRoleChange={onRoleChange}
        account={account}
        hbarBalance={hbarBalance}
        connecting={connecting}
        onConnect={openWalletModal}
        onDisconnect={onDisconnect}
        search={search}
        onSearchChange={setSearch}
      />

      <main className="main-v2">
        {wrongNetwork && (
          <div className="net-warning" role="alert" style={{ maxWidth: 1240, margin: "0 auto 1rem" }}>
            <span>Wrong network — switch to Hedera Testnet (296) to use Wafer.</span>
            <button onClick={onSwitchNetwork}>Switch network</button>
          </div>
        )}

        <StatusBar message={status} isError={statusError} onClear={clearStatus} />

        <div className="container-v2">
          <ErrorBoundary>
            {tab === "discover" && (
              <Discover
                contracts={contracts}
                refreshKey={refreshKey}
                onOpenDeposit={openDeposit}
              />
            )}
            {tab === "deposit" && (
              <DepositCard
                contracts={contracts}
                account={account}
                onStatus={onStatus}
                refreshKey={refreshKey}
                initialPoolId={depositPoolId}
                onConnect={openWalletModal}
                connecting={connecting}
              />
            )}
            {(tab === "explore" || tab === "pools" || tab === "activity") && (
              <Explore
                contracts={contracts}
                account={account}
                publicClient={publicClient}
                onStatus={onStatus}
                refreshKey={refreshKey}
                search={search}
                initialSubTab={tab === "activity" ? "activity" : exploreSubTab}
                onOpenDeposit={openDeposit}
              />
            )}
            {(tab === "dashboard" || tab === "queue") && (
              <Portfolio
                contracts={contracts}
                account={account}
                onStatus={onStatus}
                refreshKey={refreshKey}
                onOpenDeposit={openDeposit}
              />
            )}
            {tab === "operator" && <OperatorPortal contracts={contracts} account={account} onStatus={onStatus} refreshKey={refreshKey} />}
            {tab === "admin" && adminView && <Admin contracts={contracts} account={account} onStatus={onStatus} refreshKey={refreshKey} />}
          </ErrorBoundary>
        </div>

        <Footer onTabChange={onTabChange} />
      </main>

      <div className="grain" aria-hidden="true" />
    </div>
  );
}
