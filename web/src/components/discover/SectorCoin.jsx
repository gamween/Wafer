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
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const hasPools = sector.classes.length > 0;

  const menuId = `sector-menu-${sector.category}`;

  // Outside-click / Escape / arrow-key handler (all on document to avoid double-fire)
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (!menuRef.current) return;
      const items = Array.from(menuRef.current.querySelectorAll('[role="menuitem"]'));
      if (items.length === 0) return;
      const idx = items.indexOf(document.activeElement);
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          items[(idx + 1) % items.length].focus();
          break;
        case "ArrowUp":
          e.preventDefault();
          items[(idx - 1 + items.length) % items.length].focus();
          break;
        case "Home":
          e.preventDefault();
          items[0].focus();
          break;
        case "End":
          e.preventDefault();
          items[items.length - 1].focus();
          break;
        default:
          break;
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Focus first menuitem when menu opens
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector('[role="menuitem"]');
    first?.focus();
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
        aria-controls={open ? menuId : undefined}
        ref={triggerRef}
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
            id={menuId}
            className="coin-menu"
            role="menu"
            aria-label={`${sector.label} pools`}
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            ref={menuRef}
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
