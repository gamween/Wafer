import { useState, useCallback, useEffect, useRef } from "react";
import { createWalletClient, createPublicClient, custom, http, defineChain } from "viem";
import { CHAIN_ID, CHAIN_NAME, RPC_URL, EXPLORER_URL, NATIVE_CURRENCY } from "../lib/config.js";

// Hedera Testnet as a viem chain. nativeCurrency.decimals = 18 (EVM weibar) —
// keep HBAR/gas math (18-dp weibar) separate from 8-dp share accounting.
export const hederaTestnet = defineChain({
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency: NATIVE_CURRENCY,
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "HashScan", url: EXPLORER_URL } },
});

// Reads go through the Hedera EVM relay directly (Hashio). The wallet
// (tx signing) stays on MetaMask's provider.
const PUBLIC_READ_TRANSPORT = http(RPC_URL, { retryCount: 3 });

const CHAIN_HEX = `0x${CHAIN_ID.toString(16)}`;

// Session flag: set on explicit Disconnect so the silent auto-reconnect effect
// (which calls eth_accounts on mount) does NOT immediately re-attach the wallet.
// Cleared on an explicit connect. Without this, "Disconnect" appears to do
// nothing because the dapp re-reads the still-authorized account next tick.
const DISCONNECT_FLAG = "wafer.disconnected";
function isDisconnected() {
  try { return typeof localStorage !== "undefined" && localStorage.getItem(DISCONNECT_FLAG) === "1"; }
  catch { return false; }
}
function setDisconnected(v) {
  try {
    if (typeof localStorage === "undefined") return;
    if (v) localStorage.setItem(DISCONNECT_FLAG, "1");
    else localStorage.removeItem(DISCONNECT_FLAG);
  } catch { /* ignore */ }
}

async function switchOrAddChain(eth) {
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_HEX }],
    });
  } catch (e) {
    if (e.code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CHAIN_HEX,
          chainName: CHAIN_NAME,
          nativeCurrency: NATIVE_CURRENCY,
          rpcUrls: [RPC_URL],
          blockExplorerUrls: [EXPLORER_URL],
        }],
      });
    } else {
      throw e;
    }
  }
}

export function useWallet() {
  const [account, setAccount] = useState(null);
  const [walletClient, setWalletClient] = useState(null);
  const [publicClient, setPublicClient] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [provider, setProvider] = useState(null);
  const [currentChainId, setCurrentChainId] = useState(null);

  // Synchronous guard so auto-reconnect (mount useEffect) and an explicit
  // Connect click can't both build clients in parallel.
  const connectingRef = useRef(false);
  // The currently-connected EIP-1193 provider, kept in a ref so disconnect can
  // revoke its permissions even after React state is cleared.
  const providerRef = useRef(null);

  const connect = useCallback(async (selectedProvider) => {
    const eth = selectedProvider || (typeof window !== "undefined" ? window.ethereum : null);
    if (!eth) throw new Error("No wallet detected. Install MetaMask or another browser wallet.");
    if (connectingRef.current) return;

    connectingRef.current = true;
    setConnecting(true);
    // An explicit connect always clears the disconnected flag so auto-reconnect
    // works on the next mount.
    setDisconnected(false);
    try {
      try {
        await eth.request({
          method: "wallet_requestPermissions",
          params: [{ eth_accounts: {} }],
        });
      } catch {
        // Not all wallets implement wallet_requestPermissions — ignore.
      }
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      if (!accounts?.[0]) throw new Error("No account returned by wallet");

      await switchOrAddChain(eth);

      const chainIdHex = await eth.request({ method: "eth_chainId" });
      const chainIdNum = parseInt(chainIdHex, 16);

      const wc = createWalletClient({
        chain: hederaTestnet,
        transport: custom(eth),
        account: accounts[0],
      });
      const pc = createPublicClient({
        chain: hederaTestnet,
        transport: PUBLIC_READ_TRANSPORT,
      });

      providerRef.current = eth;
      setProvider(eth);
      setAccount(accounts[0]);
      setWalletClient(wc);
      setPublicClient(pc);
      setCurrentChainId(chainIdNum);
    } finally {
      setConnecting(false);
      connectingRef.current = false;
    }
  }, []);

  const disconnect = useCallback(() => {
    // Persist intent so the silent auto-reconnect effect won't immediately
    // re-attach the still-authorized account.
    setDisconnected(true);
    // Revoke the dapp's account permission so the NEXT connect re-prompts the
    // wallet's account picker instead of silently returning the same account
    // (EIP-2255; best-effort — not every wallet implements wallet_revokePermissions).
    const eth = providerRef.current;
    if (eth?.request) {
      eth.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => {});
    }
    providerRef.current = null;
    setAccount(null);
    setWalletClient(null);
    setPublicClient(null);
    setProvider(null);
    setCurrentChainId(null);
  }, []);

  const switchNetwork = useCallback(async () => {
    if (!provider) return;
    await switchOrAddChain(provider);
  }, [provider]);

  // Auto-reconnect on mount. `eth_accounts` is the silent variant — it returns
  // the already-authorized account list without prompting MetaMask. If the user
  // authorized this dapp in a previous session and is still connected, rebuild
  // the viem clients with no popup.
  useEffect(() => {
    if (account) return;
    if (connectingRef.current) return;
    // Respect an explicit prior Disconnect — don't silently re-attach.
    if (isDisconnected()) return;
    const eth = typeof window !== "undefined" ? window.ethereum : null;
    if (!eth) return;
    let cancelled = false;
    connectingRef.current = true;
    (async () => {
      try {
        const accounts = await eth.request({ method: "eth_accounts" });
        if (cancelled || !accounts?.[0]) return;
        const chainIdHex = await eth.request({ method: "eth_chainId" });
        const chainIdNum = parseInt(chainIdHex, 16);

        const wc = createWalletClient({
          chain: hederaTestnet,
          transport: custom(eth),
          account: accounts[0],
        });
        const pc = createPublicClient({
          chain: hederaTestnet,
          transport: PUBLIC_READ_TRANSPORT,
        });
        if (cancelled) return;

        providerRef.current = eth;
        setProvider(eth);
        setAccount(accounts[0]);
        setWalletClient(wc);
        setPublicClient(pc);
        setCurrentChainId(chainIdNum);
      } catch {
        // Silent fail — user can still click Connect manually.
      } finally {
        connectingRef.current = false;
      }
    })();
    return () => { cancelled = true; };
  }, [account]);

  useEffect(() => {
    const eth = provider;
    if (!account || !eth) return;

    const handleAccountsChanged = (accounts) => {
      if (!accounts.length) {
        disconnect();
        return;
      }
      const newAccount = accounts[0];
      if (newAccount.toLowerCase() !== account.toLowerCase()) {
        const wc = createWalletClient({
          chain: hederaTestnet,
          transport: custom(eth),
          account: newAccount,
        });
        const pc = createPublicClient({
          chain: hederaTestnet,
          transport: PUBLIC_READ_TRANSPORT,
        });
        setAccount(newAccount);
        setWalletClient(wc);
        setPublicClient(pc);
      }
    };

    const handleChainChanged = (chainIdHex) => {
      setCurrentChainId(parseInt(chainIdHex, 16));
    };

    eth.on?.("accountsChanged", handleAccountsChanged);
    eth.on?.("chainChanged", handleChainChanged);

    return () => {
      eth.removeListener?.("accountsChanged", handleAccountsChanged);
      eth.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [account, provider, disconnect]);

  const wrongNetwork = account !== null && currentChainId !== null && currentChainId !== CHAIN_ID;

  return {
    account,
    walletClient,
    publicClient,
    connecting,
    connect,
    disconnect,
    wrongNetwork,
    currentChainId,
    switchNetwork,
  };
}
