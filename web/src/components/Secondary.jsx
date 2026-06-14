import React, { useEffect, useState } from "react";
import { getContract } from "viem";
import {
  ADDRESSES, VAULT_CONFIGURED, EXPLORER_URL, poolDisplayName, recordedPair,
} from "../lib/config.js";
import { SAUCER_FACTORY_ABI } from "../lib/abi.js";
import { formatHbar, formatUnits8, parseUnits8, sanitizeAmountInput, shortAddr } from "../lib/format.js";
import { formatError } from "../lib/errors.js";

const ONE8 = 100_000_000n;

// Secondary market (SaucerSwap V1, SPEC §10, D4). The share/WHBAR pair is the
// always-on exit alongside redeem. Each pool's pair was created + seeded + KYC-
// enabled on-chain by the admin via the one-call enableSecondaryMarket flow
// (KYC-grant router → addLiquidityETHNewPool at NAV → KYC-grant the new pair).
//
// This screen is functional against the LIVE pair: it resolves the pair address
// (vault record → deployments.json → factory), shows it + a HashScan link, reads
// live reserves via the pair's getReserves() to derive the share/WHBAR price, and
// offers an in-app BUY (HBAR → share via the router) — gated on the buyer being
// associated + KYC'd (the share is KYC-keyed) — plus a deep link to the SaucerSwap
// testnet UI for this exact pair as the always-available fallback.
export default function Secondary({ contracts, account, publicClient, onStatus, refreshKey }) {
  const [pools, setPools] = useState([]);
  const [rows, setRows] = useState({}); // poolId → { pair, reserveShare, reserveWhbar, price }
  const [buy, setBuy] = useState({}); // poolId → { amount, quote, busy }
  const [kyc, setKyc] = useState({}); // poolId → { associated, kycGranted }

  useEffect(() => {
    if (!contracts) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await contracts.getPools();
        if (cancelled) return;
        setPools(list);
        const factory = (publicClient && ADDRESSES.saucerFactory)
          ? getContract({ address: ADDRESSES.saucerFactory, abi: SAUCER_FACTORY_ABI, client: { public: publicClient } })
          : null;
        const next = {};
        const kycNext = {};
        for (const p of list) {
          // Resolve the pair: vault on-chain record → deployments.json record → factory lookup.
          let pair = "";
          try { pair = await contracts.getSecondaryPair(p.poolId); } catch {}
          if (!hasPair(pair)) pair = recordedPair(p.poolId);
          if (!hasPair(pair) && factory) {
            try { pair = await factory.read.getPair([p.shareToken, ADDRESSES.whbar]); } catch {}
          }
          let reserveShare = 0n, reserveWhbar = 0n, price = null;
          if (hasPair(pair)) {
            const res = await contracts.getPairReserves(pair, p.shareToken);
            if (res) {
              reserveShare = res.reserveShare;
              reserveWhbar = res.reserveWhbar;
              // price = WHBAR per share (8dp), derived from live reserves.
              price = reserveShare > 0n ? (reserveWhbar * ONE8) / reserveShare : null;
            }
          }
          next[p.poolId] = { pair, reserveShare, reserveWhbar, price };
          // Surface the connected wallet's association + KYC for this pool's share token.
          if (account) {
            try { kycNext[p.poolId] = await contracts.getKycStatus(p.poolId, p.shareToken); } catch {}
          }
        }
        if (!cancelled) { setRows(next); setKyc(kycNext); }
      } catch { /* keep */ }
    })();
    return () => { cancelled = true; };
  }, [contracts, publicClient, account, refreshKey]);

  function hasPair(addr) { return addr && /^0x0*[1-9a-f]/i.test(addr); }

  // SaucerSwap testnet swap UI deep link for a specific share token (WHBAR-paired).
  const swapUiLink = (shareToken) =>
    `https://testnet.saucerswap.finance/swap?inputCurrency=HBAR&outputCurrency=${shareToken}`;

  const setBuyField = (poolId, k, v) => setBuy((b) => ({ ...b, [poolId]: { ...(b[poolId] || {}), [k]: v } }));

  // Live quote: how many shares for the typed HBAR amount, via router getAmountsOut.
  const onAmount = async (pool, raw) => {
    const amount = sanitizeAmountInput(raw);
    setBuyField(pool.poolId, "amount", amount);
    const tinybar = parseUnits8(amount);
    if (tinybar <= 0n) { setBuyField(pool.poolId, "quote", null); return; }
    try {
      const out = await contracts.quoteBuyShares(ADDRESSES.saucerRouter, ADDRESSES.whbar, pool.shareToken, tinybar);
      setBuyField(pool.poolId, "quote", out);
    } catch { setBuyField(pool.poolId, "quote", null); }
  };

  const doBuy = async (pool) => {
    const state = buy[pool.poolId] || {};
    const tinybar = parseUnits8(state.amount);
    if (tinybar <= 0n) return;
    setBuyField(pool.poolId, "busy", true);
    try {
      onStatus?.("Buying shares on SaucerSwap (HBAR → share)…");
      await contracts.swapBuyShares({
        routerAddr: ADDRESSES.saucerRouter,
        whbar: ADDRESSES.whbar,
        shareToken: pool.shareToken,
        hbarInTinybar: tinybar,
      });
      onStatus?.("Swap successful — shares received.");
      setBuyField(pool.poolId, "amount", "");
      setBuyField(pool.poolId, "quote", null);
    } catch (e) {
      onStatus?.(formatError(e), true);
    } finally {
      setBuyField(pool.poolId, "busy", false);
    }
  };

  return (
    <div className="markets-page">
      {!VAULT_CONFIGURED && (
        <div className="net-warning" role="status" style={{ marginBottom: "1rem" }}>
          <span>No vault configured — set VITE_VAULT_ADDRESS.</span>
        </div>
      )}
      <div className="card">
        <h2>Secondary market — SaucerSwap V1</h2>
        <p className="wafer-detail-note">
          Pool shares trade against WHBAR on SaucerSwap as the always-on exit alongside redeem (SPEC §10).
          The share token is KYC-keyed, so each pair (and the router) was KYC-granted as part of the admin's
          one-call <code>enableSecondaryMarket</code> flow (KYC-grant router → seed liquidity at NAV →
          KYC-grant the new pair). Buying in-app requires your wallet to be associated and KYC-granted on the
          share token; otherwise use the SaucerSwap deep link (subject to the same on-chain KYC gate).
        </p>
        <div className="vault-summary" style={{ marginTop: "0.75rem" }}>
          <div className="vault-summary-row"><span className="vault-summary-label">RouterV3</span><span className="vault-summary-value"><a className="mt-oracle-label" href={`${EXPLORER_URL}/contract/${ADDRESSES.saucerRouter}`} target="_blank" rel="noopener noreferrer">{shortAddr(ADDRESSES.saucerRouter)}</a></span></div>
          <div className="vault-summary-row"><span className="vault-summary-label">Factory</span><span className="vault-summary-value"><a className="mt-oracle-label" href={`${EXPLORER_URL}/contract/${ADDRESSES.saucerFactory}`} target="_blank" rel="noopener noreferrer">{shortAddr(ADDRESSES.saucerFactory)}</a></span></div>
          <div className="vault-summary-row"><span className="vault-summary-label">WHBAR token</span><span className="vault-summary-value"><a className="mt-oracle-label" href={`${EXPLORER_URL}/token/${ADDRESSES.whbar}`} target="_blank" rel="noopener noreferrer">{shortAddr(ADDRESSES.whbar)}</a></span></div>
        </div>
      </div>

      {pools.map((p) => {
        const row = rows[p.poolId] || {};
        const live = hasPair(row.pair);
        const k = kyc[p.poolId] || {};
        const canBuy = live && account && k.associated && k.kycGranted;
        const state = buy[p.poolId] || {};
        return (
          <div className="card" key={p.poolId}>
            <div className="mt-toolbar" style={{ marginBottom: "0.75rem" }}>
              <div className="mt-toolbar-left">
                <span className="mt-toolbar-title">{poolDisplayName(p.category, p.class)} / WHBAR</span>
                <span className={`mt-usd-pill${live ? "" : " wafer-pill-warn"}`}>{live ? "Live pair" : "No pair"}</span>
              </div>
            </div>

            <div className="vault-summary">
              <div className="vault-summary-row"><span className="vault-summary-label">Share token</span><span className="vault-summary-value"><a className="mt-oracle-label" href={`${EXPLORER_URL}/token/${p.shareToken}`} target="_blank" rel="noopener noreferrer">{shortAddr(p.shareToken)}</a></span></div>
              <div className="vault-summary-row"><span className="vault-summary-label">Pair</span><span className="vault-summary-value">{live ? <a className="mt-oracle-label" href={`${EXPLORER_URL}/contract/${row.pair}`} target="_blank" rel="noopener noreferrer">{shortAddr(row.pair)}</a> : <span className="mt-oracle-label">not created</span>}</span></div>
              {live && (
                <>
                  <div className="vault-summary-row"><span className="vault-summary-label">Reserves (live)</span><span className="vault-summary-value">{formatHbar(row.reserveShare)} shares · {formatHbar(row.reserveWhbar)} WHBAR</span></div>
                  <div className="vault-summary-row"><span className="vault-summary-label">Price</span><span className="vault-summary-value vault-apy">{row.price == null ? "—" : `${formatUnits8(row.price, 6)} WHBAR / share`}</span></div>
                </>
              )}
            </div>

            {live && (
              <>
                {account && (!k.associated || !k.kycGranted) && (
                  <div className="wafer-queue-notice" style={{ marginTop: "0.75rem" }}>
                    <span>
                      In-app buy is blocked: {!k.associated && "share token not associated"}{!k.associated && !k.kycGranted && " · "}{!k.kycGranted && "KYC not granted for this pool"}.
                      The share token is KYC-keyed — associate it and ask an admin to allowlist your address (adminGrantKyc), or use the SaucerSwap link below.
                    </span>
                  </div>
                )}
                <div className="vault-input-card" style={{ marginTop: "0.75rem" }}>
                  <div className="vault-input-header"><span className="vault-input-title">Buy shares with HBAR</span></div>
                  <div className="vault-input-field">
                    <input aria-label="HBAR amount" className="vault-amount-input" inputMode="decimal" placeholder="0.00" value={state.amount || ""} onChange={(e) => onAmount(p, e.target.value)} />
                  </div>
                  <div className="vault-input-footer">
                    <span className="vault-dollar-value">{state.quote != null && state.quote > 0n ? `≈ ${formatHbar(state.quote)} shares` : "HBAR → share (WHBAR path)"}</span>
                  </div>
                </div>
                <div className="wafer-form-actions" style={{ marginTop: "0.75rem" }}>
                  <button className="btn-primary btn-sm" disabled={!canBuy || state.busy || parseUnits8(state.amount) <= 0n} onClick={() => doBuy(p)} title={canBuy ? "Swap HBAR for shares via the router" : "Associate + KYC required to receive the KYC-keyed share"}>
                    {state.busy ? "Swapping…" : "Buy in-app"}
                  </button>
                  <a className="btn-secondary btn-sm" href={swapUiLink(p.shareToken)} target="_blank" rel="noopener noreferrer">Open in SaucerSwap ↗</a>
                </div>
              </>
            )}
            {!live && (
              <p className="wafer-detail-note" style={{ marginTop: "0.5rem" }}>
                No SaucerSwap pair for this pool yet. An admin enables it once via the one-call enableSecondaryMarket flow (Admin → Pool compliance levers → Enable secondary).
              </p>
            )}
          </div>
        );
      })}
      {pools.length === 0 && (
        <div className="card"><p className="wafer-detail-note">No pools.</p></div>
      )}
    </div>
  );
}
