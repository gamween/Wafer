import { useEffect, useState } from "react";
import SectorCoins from "./discover/SectorCoins.jsx";
import { groupBySector } from "../lib/sectors.js";
import "./discover/discover.css";

// Discover — the connected-app hero. Reads pools + deals (same source as Explore),
// groups them into the five DePIN sectors, and renders them as floating coins.
// Purely additive: it reuses the existing onOpenDeposit handler and touches no
// contract logic.
export default function Discover({ contracts, refreshKey, onOpenDeposit }) {
  const [pools, setPools] = useState([]);
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!contracts) return;
    let cancelled = false;
    (async () => {
      try {
        const [list, dealList] = await Promise.all([contracts.getPools(), contracts.getDeals()]);
        if (cancelled) return;
        setPools(list);
        setDeals(dealList);
      } catch { /* keep last good data */ } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [contracts, refreshKey]);

  const sectors = groupBySector(pools, deals);

  return (
    <section className="discover-hero" aria-label="Discover sectors">
      <div className="discover-center">
        <img className="discover-wordmark" src="/brand/wafer-band.svg" alt="Wafer" />
        <p className="discover-tagline">Hover a sector for its best yield · click to pick a pool</p>
      </div>
      <SectorCoins sectors={sectors} onOpenDeposit={onOpenDeposit} />
      {loading && <div className="discover-loading" role="status">Loading sectors…</div>}
    </section>
  );
}
