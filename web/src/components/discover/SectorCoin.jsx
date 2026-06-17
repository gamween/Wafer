import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { formatPercent } from "../../lib/format.js";

// One floating sector coin. Decorative at rest, interactive on hover/click:
//   hover → capsule shows label + max APR
//   click → menu of the sector's risk-class pools; a row opens it in Deposit
// The component is contract-agnostic: it takes a plain sector object (from
// lib/sectors.js groupBySector) plus the existing onOpenDeposit handler.
export default function SectorCoin({ sector, style, onOpenDeposit }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const hasPools = sector.classes.length > 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const aprLabel = sector.maxApr == null ? "—" : `max ${formatPercent(sector.maxApr)}`;

  return (
    <div className="coin" style={style} ref={ref}>
      <motion.button
        type="button"
        className="coin-btn"
        disabled={!hasPools}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { if (hasPools) setOpen((o) => !o); }}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.96 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        <img className="coin-img" src={sector.logo} alt="" aria-hidden="true" />
        <span className="coin-cap">
          <span className="coin-cap-label">{sector.label}</span>
          <span className="coin-cap-apr">{aprLabel}</span>
        </span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.ul
            className="coin-menu"
            role="menu"
            aria-label={`${sector.label} pools`}
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <li className="coin-menu-title" aria-hidden="true">{sector.label}</li>
            {sector.classes.map((c) => (
              <li key={c.poolId} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="coin-menu-row"
                  onClick={() => { onOpenDeposit?.(c.poolId); setOpen(false); }}
                >
                  <span className="coin-menu-class">Class {c.risk}</span>
                  <span className="coin-menu-apr">{c.apr == null ? "—" : formatPercent(c.apr)}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
