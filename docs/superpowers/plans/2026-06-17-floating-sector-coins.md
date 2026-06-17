# Discover Floating Sector Coins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Discover hero to the connected web app where five floating DePIN sector coins (GPU/Wireless/Mapping/Energy/Storage) reveal their best APR on hover and expand a per-risk-class menu on click that routes into the existing Deposit flow.

**Architecture:** DOM + CSS coins (the canary/Uniswap technique) placed in a deterministic orbit, animated with `motion`. A pure `lib/sectors.js` groups on-chain pools by category and computes per-class + max APR (single source of truth, also consumed by Explore). Coins are decorative-but-interactive; all existing handlers are reused, none modified.

**Tech Stack:** Vite 6, React 19, viem, `motion` (ex-framer-motion). New test harness: Vitest + @testing-library/react + jsdom.

---

## File structure

| File | Action | Responsibility |
|------|--------|----------------|
| `web/vite.config.js` | Modify | Add Vitest `test` block |
| `web/package.json` | Modify | Add dev deps + `test` scripts; add `motion` |
| `web/src/test/setup.js` | Create | jest-dom + `matchMedia` polyfill |
| `web/src/lib/sectors.js` | Create | `poolTrailingApr`, `groupBySector` (pure) |
| `web/src/lib/sectors.test.js` | Create | Unit tests for the pure layer |
| `web/src/components/Explore.jsx` | Modify | Import `poolTrailingApr` from `sectors.js` (delete local copy) |
| `web/src/components/discover/layout.js` | Create | `orbitPositions` (pure) |
| `web/src/components/discover/layout.test.js` | Create | Unit test for orbit math |
| `web/src/components/discover/SectorCoin.jsx` | Create | One coin: float, hover capsule, click menu |
| `web/src/components/discover/SectorCoin.test.jsx` | Create | Interaction tests |
| `web/src/components/discover/SectorCoins.jsx` | Create | Orbit layout + pointer parallax |
| `web/src/components/discover/SectorCoins.test.jsx` | Create | Renders one coin per sector |
| `web/src/components/discover/discover.css` | Create | Hero + coin visuals, reduced-motion |
| `web/src/components/Discover.jsx` | Create | Fetch pools/deals, derive sectors, render hero |
| `web/src/components/Discover.test.jsx` | Create | Data → coins render test |
| `web/src/App.jsx` | Modify | Route `discover` tab + default landing |
| `web/src/components/TopNav.jsx` | Modify | Add Discover nav item |

All shell commands run against the standalone `web/` package via `pnpm -C web …` (no `cd`).

---

### Task 1: Test harness for `web/`

**Files:**
- Modify: `web/vite.config.js`
- Modify: `web/package.json`
- Create: `web/src/test/setup.js`

- [ ] **Step 1: Install dev dependencies**

Run:
```bash
pnpm -C web add -D vitest @testing-library/react @testing-library/dom @testing-library/jest-dom @testing-library/user-event jsdom
```
Expected: deps added to `web/package.json` devDependencies; lockfile updated.

- [ ] **Step 2: Add the Vitest config block**

Replace the entire contents of `web/vite.config.js` with:
```js
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  define: {
    global: "globalThis",
  },
  server: {
    fs: {
      // Allow importing the repo-root deployments/testnet.json (one level above web/).
      allow: [".."],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.js",
  },
});
```

- [ ] **Step 3: Create the test setup file**

Create `web/src/test/setup.js`:
```js
import "@testing-library/jest-dom";

// jsdom has no matchMedia; motion/react reads it for reduced-motion detection.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}
```

- [ ] **Step 4: Add test scripts to `web/package.json`**

In `web/package.json`, change the `"scripts"` block from:
```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
```
to:
```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 5: Verify the harness runs (temporary smoke test)**

Create `web/src/test/smoke.test.js`:
```js
import { describe, it, expect } from "vitest";

describe("harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```
Run: `pnpm -C web test`
Expected: PASS (1 passed). Then delete the smoke file:
```bash
rm web/src/test/smoke.test.js
```

- [ ] **Step 6: Commit**

```bash
git add web/vite.config.js web/package.json web/pnpm-lock.yaml web/src/test/setup.js
git commit -m "test(web): add vitest + react-testing-library harness"
```

---

### Task 2: `sectors.js` pure data layer

**Files:**
- Create: `web/src/lib/sectors.js`
- Test: `web/src/lib/sectors.test.js`
- Modify: `web/src/components/Explore.jsx`

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/sectors.test.js`:
```js
import { describe, it, expect } from "vitest";
import { poolTrailingApr, groupBySector } from "./sectors.js";

// 100 HBAR advance in 8-dp units; one full year term → year/term = 1.
const ADV = 100_00000000n;
const YEAR = 31_536_000n; // 365*24*60*60
const deal = (poolId, expectedHbar, status = 4) => ({
  poolId, status, advance: ADV, expected: BigInt(expectedHbar) * 1_00000000n, term: YEAR,
});

describe("poolTrailingApr", () => {
  it("returns null when a pool has no financed deals", () => {
    expect(poolTrailingApr(0, [])).toBe(null);
  });

  it("ignores non-financed deals (status not 3 or 4)", () => {
    // status 0 (Proposed) must not count.
    expect(poolTrailingApr(0, [{ ...deal(0, 110), status: 0 }])).toBe(null);
  });

  it("computes the advance-weighted APR across financed deals", () => {
    // Single deal: expected 110 vs advance 100 over a year → 0.10.
    expect(poolTrailingApr(0, [deal(0, 110)])).toBeCloseTo(0.1, 6);
  });
});

describe("groupBySector", () => {
  it("always returns one entry per category (5), even with no pools", () => {
    const sectors = groupBySector([], []);
    expect(sectors).toHaveLength(5);
    expect(sectors[0]).toMatchObject({ category: 0, label: "GPU / Compute", logo: "/logos/gpu.png" });
    expect(sectors[0].classes).toEqual([]);
    expect(sectors[0].maxApr).toBe(null);
  });

  it("groups pools by category, sorts classes A→B→C, and computes maxApr", () => {
    const pools = [
      { poolId: 2, category: 0, class: 2 }, // GPU-C
      { poolId: 0, category: 0, class: 0 }, // GPU-A
      { poolId: 1, category: 0, class: 1 }, // GPU-B
    ];
    const deals = [deal(0, 110), deal(1, 120), deal(2, 115)]; // 0.10, 0.20, 0.15
    const gpu = groupBySector(pools, deals)[0];
    expect(gpu.classes.map((c) => c.risk)).toEqual(["A", "B", "C"]);
    expect(gpu.classes.map((c) => c.poolId)).toEqual([0, 1, 2]);
    expect(gpu.maxApr).toBeCloseTo(0.2, 6);
  });

  it("keeps a class row with null apr but excludes it from maxApr", () => {
    const pools = [
      { poolId: 0, category: 3, class: 0 }, // Energy-A, financed
      { poolId: 1, category: 3, class: 1 }, // Energy-B, no deals → null apr
    ];
    const energy = groupBySector(pools, [deal(0, 110)])[3];
    expect(energy.classes).toHaveLength(2);
    expect(energy.classes[1].apr).toBe(null);
    expect(energy.maxApr).toBeCloseTo(0.1, 6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C web test src/lib/sectors.test.js`
Expected: FAIL — `Failed to resolve import "./sectors.js"` (module does not exist yet).

- [ ] **Step 3: Implement `sectors.js`**

Create `web/src/lib/sectors.js`:
```js
// Pure sector/APR derivation — the single source of truth for "pools grouped by
// DePIN category, with per-risk-class and max APR". Consumed by both Discover
// (floating coins) and Explore (blended-APR KPI / table). No React, no I/O.
import { CATEGORIES, CATEGORY_LABEL, CATEGORY_LOGO, RISK_CLASSES } from "./config.js";
import { dealApr } from "./format.js";

// Advance-weighted trailing APR for one pool, over its financed deals
// (DealStatus 3 = Financed, 4 = Repaid). Returns a ratio (0.11 = 11%) or null.
export function poolTrailingApr(poolId, deals) {
  const financed = deals.filter((d) => d.poolId === poolId && (d.status === 3 || d.status === 4));
  let wSum = 0, num = 0;
  for (const d of financed) {
    const apr = dealApr(d.advance, d.expected, d.term);
    if (apr == null) continue;
    const w = Number(d.advance);
    wSum += w;
    num += apr * w;
  }
  return wSum > 0 ? num / wSum : null;
}

// Group pools into the five fixed categories. Always returns 5 entries (a sector
// with no pools still gets a coin). Classes are sorted A→B→C; maxApr is the max of
// the non-null class APRs (null when none are known).
export function groupBySector(pools, deals) {
  return CATEGORIES.map((_, category) => {
    const classes = pools
      .filter((p) => p.category === category)
      .map((p) => ({
        risk: RISK_CLASSES[p.class] ?? String(p.class),
        poolId: p.poolId,
        apr: poolTrailingApr(p.poolId, deals),
      }))
      .sort((a, b) => RISK_CLASSES.indexOf(a.risk) - RISK_CLASSES.indexOf(b.risk));

    const knownAprs = classes.map((c) => c.apr).filter((a) => a != null);
    return {
      category,
      label: CATEGORY_LABEL[category] ?? `CAT${category}`,
      logo: CATEGORY_LOGO[category] ?? "/logos/hedera.svg",
      classes,
      maxApr: knownAprs.length ? Math.max(...knownAprs) : null,
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C web test src/lib/sectors.test.js`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Refactor Explore to use the shared helper**

In `web/src/components/Explore.jsx`, add the import after the existing `format.js` import line (currently line 9):
```js
import { poolTrailingApr } from "../lib/sectors.js";
```
Then delete the now-duplicate local definition (currently lines 17–26):
```js
function poolTrailingApr(poolId, deals) {
  const financed = deals.filter((d) => d.poolId === poolId && (d.status === 3 || d.status === 4));
  let wSum = 0, num = 0;
  for (const d of financed) {
    const apr = dealApr(d.advance, d.expected, d.term);
    if (apr == null) continue;
    const w = Number(d.advance); wSum += w; num += apr * w;
  }
  return wSum > 0 ? num / wSum : null;
}
```
Leave the rest of `Explore.jsx` unchanged (it still calls `poolTrailingApr(...)` identically).

- [ ] **Step 6: Verify Explore still builds and tests pass**

Run: `pnpm -C web build && pnpm -C web test`
Expected: build succeeds; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/sectors.js web/src/lib/sectors.test.js web/src/components/Explore.jsx
git commit -m "refactor(web): extract sector/APR grouping into lib/sectors.js"
```

---

### Task 3: Add the `motion` dependency

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Install motion**

Run: `pnpm -C web add motion`
Expected: `motion` added to `web/package.json` dependencies.

- [ ] **Step 2: Verify it imports**

Run:
```bash
pnpm -C web exec node -e "import('motion/react').then(m => console.log(typeof m.motion, typeof m.AnimatePresence))"
```
Expected: prints `object function` (or `function function`) — the import resolves.

- [ ] **Step 3: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml
git commit -m "build(web): add motion (framer-motion successor) for coin animation"
```

---

### Task 4: `SectorCoin` component

**Files:**
- Create: `web/src/components/discover/SectorCoin.jsx`
- Test: `web/src/components/discover/SectorCoin.test.jsx`

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/discover/SectorCoin.test.jsx`:
```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SectorCoin from "./SectorCoin.jsx";

const sector = {
  category: 0,
  label: "GPU / Compute",
  logo: "/logos/gpu.png",
  classes: [
    { risk: "A", poolId: 0, apr: 0.1 },
    { risk: "B", poolId: 1, apr: 0.2 },
    { risk: "C", poolId: 2, apr: 0.15 },
  ],
  maxApr: 0.2,
};

describe("SectorCoin", () => {
  it("shows the label and max APR capsule", () => {
    render(<SectorCoin sector={sector} onOpenDeposit={() => {}} />);
    expect(screen.getByText("GPU / Compute")).toBeInTheDocument();
    expect(screen.getByText("max 20.00%")).toBeInTheDocument();
  });

  it("opens a 3-class menu on click", async () => {
    const user = userEvent.setup();
    render(<SectorCoin sector={sector} onOpenDeposit={() => {}} />);
    await user.click(screen.getByRole("button", { name: /GPU \/ Compute/ }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    expect(screen.getByRole("menuitem", { name: /Class B/ })).toHaveTextContent("20.00%");
  });

  it("routes the clicked class into Deposit and closes", async () => {
    const user = userEvent.setup();
    const onOpenDeposit = vi.fn();
    render(<SectorCoin sector={sector} onOpenDeposit={onOpenDeposit} />);
    await user.click(screen.getByRole("button", { name: /GPU \/ Compute/ }));
    await user.click(screen.getByRole("menuitem", { name: /Class B/ }));
    expect(onOpenDeposit).toHaveBeenCalledWith(1);
  });

  it("is disabled and shows — when the sector has no pools", () => {
    const empty = { ...sector, classes: [], maxApr: null };
    render(<SectorCoin sector={empty} onOpenDeposit={() => {}} />);
    expect(screen.getByRole("button", { name: /GPU \/ Compute/ })).toBeDisabled();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C web test src/components/discover/SectorCoin.test.jsx`
Expected: FAIL — cannot resolve `./SectorCoin.jsx`.

- [ ] **Step 3: Implement `SectorCoin.jsx`**

Create `web/src/components/discover/SectorCoin.jsx`:
```jsx
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C web test src/components/discover/SectorCoin.test.jsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/discover/SectorCoin.jsx web/src/components/discover/SectorCoin.test.jsx
git commit -m "feat(web): SectorCoin — floating sector coin with hover APR + class menu"
```

---

### Task 5: `SectorCoins` orbit layout

**Files:**
- Create: `web/src/components/discover/layout.js`
- Test: `web/src/components/discover/layout.test.js`
- Create: `web/src/components/discover/SectorCoins.jsx`
- Test: `web/src/components/discover/SectorCoins.test.jsx`

- [ ] **Step 1: Write the failing layout test**

Create `web/src/components/discover/layout.test.js`:
```js
import { describe, it, expect } from "vitest";
import { orbitPositions } from "./layout.js";

describe("orbitPositions", () => {
  it("returns one position per coin", () => {
    expect(orbitPositions(5)).toHaveLength(5);
    expect(orbitPositions(0)).toEqual([]);
  });

  it("places the first coin at top-center of the box", () => {
    const [first] = orbitPositions(5, 34);
    expect(first.x).toBeCloseTo(50, 5);
    expect(first.y).toBeCloseTo(16, 5); // 50 - radius
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C web test src/components/discover/layout.test.js`
Expected: FAIL — cannot resolve `./layout.js`.

- [ ] **Step 3: Implement `layout.js`**

Create `web/src/components/discover/layout.js`:
```js
// Deterministic orbit placement for N coins, as percentage offsets inside the hero
// box. Coin 0 starts at top-center, going clockwise. Layout is derived from the
// count, so adding a sector rebalances the ring automatically.
export function orbitPositions(count, radius = 34) {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const angle = (-90 + (360 / count) * i) * (Math.PI / 180);
    return {
      x: 50 + radius * Math.cos(angle),
      y: 50 + radius * Math.sin(angle),
    };
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C web test src/components/discover/layout.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing SectorCoins test**

Create `web/src/components/discover/SectorCoins.test.jsx`:
```jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SectorCoins from "./SectorCoins.jsx";

const sectors = [
  { category: 0, label: "GPU / Compute", logo: "/logos/gpu.png", classes: [{ risk: "A", poolId: 0, apr: 0.1 }], maxApr: 0.1 },
  { category: 1, label: "Wireless", logo: "/logos/wireless.png", classes: [], maxApr: null },
];

describe("SectorCoins", () => {
  it("renders one coin button per sector", () => {
    render(<SectorCoins sectors={sectors} onOpenDeposit={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("GPU / Compute")).toBeInTheDocument();
    expect(screen.getByText("Wireless")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm -C web test src/components/discover/SectorCoins.test.jsx`
Expected: FAIL — cannot resolve `./SectorCoins.jsx`.

- [ ] **Step 7: Implement `SectorCoins.jsx`**

Create `web/src/components/discover/SectorCoins.jsx`:
```jsx
import { useRef } from "react";
import SectorCoin from "./SectorCoin.jsx";
import { orbitPositions } from "./layout.js";

// Lays the coins out in an orbit and applies a subtle whole-field parallax tilt
// toward the pointer (rAF-batched, written to CSS vars; the actual tilt lives in
// discover.css and is disabled under prefers-reduced-motion).
export default function SectorCoins({ sectors, onOpenDeposit }) {
  const ref = useRef(null);
  const frame = useRef(0);
  const positions = orbitPositions(sectors.length);

  const onPointerMove = (e) => {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width;   // -0.5 … 0.5
      const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      el.style.setProperty("--px", dx.toFixed(3));
      el.style.setProperty("--py", dy.toFixed(3));
    });
  };

  return (
    <div className="coins-field" ref={ref} onPointerMove={onPointerMove}>
      {sectors.map((sector, i) => (
        <SectorCoin
          key={sector.category}
          sector={sector}
          onOpenDeposit={onOpenDeposit}
          style={{
            left: `${positions[i].x}%`,
            top: `${positions[i].y}%`,
            "--float-delay": `${i * -1.3}s`,
            "--float-dur": `${7 + (i % 3)}s`,
            "--tilt": `${(i % 2 ? 1 : -1) * 4}deg`,
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm -C web test src/components/discover/SectorCoins.test.jsx`
Expected: PASS (1 test).

- [ ] **Step 9: Commit**

```bash
git add web/src/components/discover/layout.js web/src/components/discover/layout.test.js web/src/components/discover/SectorCoins.jsx web/src/components/discover/SectorCoins.test.jsx
git commit -m "feat(web): SectorCoins orbit layout + pointer parallax"
```

---

### Task 6: `Discover` view

**Files:**
- Create: `web/src/components/Discover.jsx`
- Test: `web/src/components/Discover.test.jsx`
- Create: `web/src/components/discover/discover.css` (empty placeholder so the import resolves; filled in Task 8)

- [ ] **Step 1: Create the empty stylesheet so the import resolves**

Create `web/src/components/discover/discover.css`:
```css
/* Discover hero + floating coin visuals — filled in Task 8. */
```

- [ ] **Step 2: Write the failing test**

Create `web/src/components/Discover.test.jsx`:
```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Discover from "./Discover.jsx";

const ADV = 100_00000000n;
const YEAR = 31_536_000n;
const mockContracts = {
  getPools: vi.fn().mockResolvedValue([
    { poolId: 0, category: 0, class: 0 },
    { poolId: 1, category: 0, class: 1 },
  ]),
  getDeals: vi.fn().mockResolvedValue([
    { poolId: 0, status: 4, advance: ADV, expected: 110_00000000n, term: YEAR }, // 0.10
    { poolId: 1, status: 4, advance: ADV, expected: 120_00000000n, term: YEAR }, // 0.20
  ]),
};

describe("Discover", () => {
  it("renders all five sector coins", () => {
    render(<Discover contracts={mockContracts} onOpenDeposit={() => {}} />);
    // groupBySector always yields 5 sectors, so 5 coins render before data resolves.
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });

  it("shows the fetched max APR for a sector after load", async () => {
    render(<Discover contracts={mockContracts} onOpenDeposit={() => {}} />);
    expect(await screen.findByText("max 20.00%")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm -C web test src/components/Discover.test.jsx`
Expected: FAIL — cannot resolve `./Discover.jsx`.

- [ ] **Step 4: Implement `Discover.jsx`**

Create `web/src/components/Discover.jsx`:
```jsx
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
        <img className="discover-wordmark" src="/wafer-logo.png" alt="Wafer" />
        <p className="discover-tagline">Hover a sector for its best yield · click to pick a pool</p>
      </div>
      <SectorCoins sectors={sectors} onOpenDeposit={onOpenDeposit} />
      {loading && <div className="discover-loading" role="status">Loading sectors…</div>}
    </section>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm -C web test src/components/Discover.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/Discover.jsx web/src/components/Discover.test.jsx web/src/components/discover/discover.css
git commit -m "feat(web): Discover hero view wiring sector data to coins"
```

---

### Task 7: Route Discover as the connected landing

**Files:**
- Modify: `web/src/App.jsx`
- Modify: `web/src/components/TopNav.jsx`

- [ ] **Step 1: Add the Discover import to `App.jsx`**

In `web/src/App.jsx`, after the line:
```js
import Explore from "./components/Explore.jsx";
```
add:
```js
import Discover from "./components/Discover.jsx";
```

- [ ] **Step 2: Register the `discover` tab**

In `web/src/App.jsx`, change:
```js
const INVESTOR_TABS = new Set(["home", "deposit", "explore", "dashboard", "operator", "activity", "queue"]);
```
to:
```js
const INVESTOR_TABS = new Set(["home", "discover", "deposit", "explore", "dashboard", "operator", "activity", "queue"]);
```

- [ ] **Step 3: Land on Discover after connect**

In `web/src/App.jsx`, in the auto-navigate effect, change:
```js
      setWalletModalOpen(false);
      setTab((t) => (t === "home" ? "deposit" : t));
```
to:
```js
      setWalletModalOpen(false);
      setTab((t) => (t === "home" ? "discover" : t));
```

- [ ] **Step 4: Point `goApp` at Discover**

In `web/src/App.jsx`, change:
```js
  const goApp = useCallback(() => {
    if (account) setTab("deposit");
    else openWalletModal();
  }, [account, openWalletModal]);
```
to:
```js
  const goApp = useCallback(() => {
    if (account) setTab("discover");
    else openWalletModal();
  }, [account, openWalletModal]);
```

- [ ] **Step 5: Render the Discover branch**

In `web/src/App.jsx`, inside `<ErrorBoundary>`, immediately before the `{tab === "deposit" && (` block, add:
```jsx
            {tab === "discover" && (
              <Discover
                contracts={contracts}
                refreshKey={refreshKey}
                onOpenDeposit={openDeposit}
              />
            )}
```

- [ ] **Step 6: Add the Discover nav item to `TopNav.jsx`**

In `web/src/components/TopNav.jsx`, change:
```js
  const nav = [
    { id: "deposit", label: "Deposit" },
    { id: "explore", label: "Explore" },
    { id: "dashboard", label: "Portfolio" },
  ];
```
to:
```js
  const nav = [
    { id: "discover", label: "Discover" },
    { id: "deposit", label: "Deposit" },
    { id: "explore", label: "Explore" },
    { id: "dashboard", label: "Portfolio" },
  ];
```

- [ ] **Step 7: Verify build + full test run**

Run: `pnpm -C web build && pnpm -C web test`
Expected: build succeeds; all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/App.jsx web/src/components/TopNav.jsx
git commit -m "feat(web): route Discover as connected landing + nav item"
```

---

### Task 8: Discover hero + coin visuals (navy/amber, reduced-motion safe)

**Files:**
- Modify: `web/src/components/discover/discover.css`

- [ ] **Step 1: Fill in the stylesheet**

Replace the entire contents of `web/src/components/discover/discover.css` with:
```css
/* Discover hero — floating DePIN sector coins. Decorative layer; the coins are the
   only interactive elements. Palette tracks the app: deep navy bg + amber accent. */

.discover-hero {
  position: relative;
  width: 100%;
  min-height: clamp(420px, 70vh, 760px);
  overflow: visible;
}

/* Centered wordmark + tagline, behind the coins. */
.discover-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  text-align: center;
  pointer-events: none;
  z-index: 1;
}
.discover-wordmark { height: 40px; width: auto; opacity: 0.95; }
.discover-tagline {
  margin: 0;
  font-size: 0.85rem;
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.55);
}
.discover-loading {
  position: absolute;
  bottom: 1rem; left: 50%;
  transform: translateX(-50%);
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.45);
  z-index: 1;
}

/* The coin field: pointer-events:none so only coins capture input; a subtle 3D
   parallax tilt is driven by --px/--py written from SectorCoins. */
.coins-field {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  transform: perspective(1100px)
    rotateY(calc(var(--px, 0) * 6deg))
    rotateX(calc(var(--py, 0) * -6deg));
  transform-style: preserve-3d;
  transition: transform 0.25s ease-out;
}

/* A single coin slot. The float lives here so it composes with the inner button's
   hover-scale (set by motion) without the two transforms fighting. */
.coin {
  position: absolute;
  pointer-events: auto;
  animation: coin-float var(--float-dur, 8s) ease-in-out infinite;
  animation-delay: var(--float-delay, 0s);
  will-change: transform;
}
@keyframes coin-float {
  0%, 100% { transform: translate(-50%, -50%) rotate(var(--tilt, 0deg)); }
  50%      { transform: translate(-50%, calc(-50% - 12px)) rotate(calc(var(--tilt, 0deg) * -1)); }
}

/* The coin button itself. */
.coin-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 0;
  background: none;
  border: 0;
  cursor: pointer;
  color: #fff;
}
.coin-btn:disabled { cursor: default; opacity: 0.5; }
.coin-btn:focus-visible { outline: 2px solid #f59e0b; outline-offset: 6px; border-radius: 12px; }

.coin-img {
  width: clamp(56px, 7vw, 84px);
  height: auto;
  filter: drop-shadow(0 6px 18px rgba(0, 0, 0, 0.5));
  transition: filter 0.18s ease;
}
.coin-btn:hover:not(:disabled) .coin-img {
  filter: drop-shadow(0 10px 26px rgba(245, 158, 11, 0.45));
}

/* Hover capsule (label + max APR). Hidden until hover/focus. */
.coin-cap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  background: rgba(10, 12, 18, 0.85);
  border: 1px solid rgba(245, 158, 11, 0.35);
  backdrop-filter: blur(6px);
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.18s ease, transform 0.18s ease;
  white-space: nowrap;
}
.coin-btn:hover:not(:disabled) .coin-cap,
.coin-btn:focus-visible .coin-cap,
.coin-btn[aria-expanded="true"] .coin-cap {
  opacity: 1;
  transform: translateY(0);
}
.coin-cap-label { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.01em; }
.coin-cap-apr { font-size: 0.72rem; color: #f59e0b; font-variant-numeric: tabular-nums; }

/* Click-expanded menu of the sector's risk-class pools. */
.coin-menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  padding: 0.35rem;
  list-style: none;
  min-width: 168px;
  border-radius: 12px;
  background: rgba(10, 12, 18, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  z-index: 6;
}
.coin-menu-title {
  padding: 0.3rem 0.6rem 0.4rem;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.45);
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  margin-bottom: 0.25rem;
}
.coin-menu-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  width: 100%;
  padding: 0.45rem 0.6rem;
  background: none;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  color: #fff;
  font-size: 0.8rem;
}
.coin-menu-row:hover { background: rgba(245, 158, 11, 0.14); }
.coin-menu-class { color: rgba(255, 255, 255, 0.8); }
.coin-menu-apr { color: #f59e0b; font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  .coin {
    animation: none;
    transform: translate(-50%, -50%) rotate(var(--tilt, 0deg));
  }
  .coins-field { transform: none; transition: none; }
}
```

- [ ] **Step 2: Verify build + tests still pass**

Run: `pnpm -C web build && pnpm -C web test`
Expected: build succeeds; all tests PASS (CSS does not affect tests).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/discover/discover.css
git commit -m "style(web): Discover hero + floating coin visuals (reduced-motion safe)"
```

---

### Task 9: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the dev server**

Run: `pnpm -C web dev`
Open the printed local URL.

- [ ] **Step 2: Verify the Discover landing**

Connect a wallet (or use the existing connect flow). Confirm:
- After connect you land on **Discover** (not Deposit), and **Discover** is the active nav item.
- Five coins (GPU, Wireless, Mapping, Energy, Storage) float gently around the Wafer wordmark.
- Hovering a coin lifts it, glows amber, and shows the `… · max X%` capsule.
- Clicking a coin opens the A/B/C menu; clicking a row opens that exact pool in **Deposit**.
- A sector with no pools shows `—` and its coin is not clickable.
- Moving the cursor tilts the field subtly (parallax).
- The other tabs (Deposit, Explore, Portfolio) and their buttons behave exactly as before.

- [ ] **Step 3: Verify reduced-motion**

Enable OS "Reduce motion" and reload. Confirm coins are static (no float, no parallax) but hover/click still work.

- [ ] **Step 4: Final full check + commit (if any tweaks were made)**

Run: `pnpm -C web test && pnpm -C web build`
Expected: all tests PASS; build succeeds.
```bash
git add -A
git commit -m "chore(web): verify Discover floating sector coins"
```

---

## Self-review

**Spec coverage:**
- §5 architecture (Discover, SectorCoins, SectorCoin, sectors.js, css) → Tasks 2, 4, 5, 6, 8. ✓
- §5 `groupBySector` shape (5 sectors, sorted classes, maxApr, degradation) → Task 2 tests. ✓
- §6 interaction (idle float, hover capsule, click menu → onOpenDeposit, Esc/outside close, degradation, a11y) → Tasks 4, 8. ✓
- §7 routing (INVESTOR_TABS, default landing, render branch, TopNav item) → Task 7. ✓
- §8 visual/motion + prefers-reduced-motion → Task 8. ✓
- §9 deps (`motion`) + placeholder logos → Task 3; logos come from `CATEGORY_LOGO`. ✓
- §10 single source of truth (Explore consumes shared helper) → Task 2 Step 5. ✓
- §11 only App/TopNav/Explore touched among existing files → Tasks 2, 7. ✓
- §12 testing (pure lib unit-tested; manual checklist) → Tasks 2, 4, 5, 6, 9. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows full code. The Task 6 Step 1 empty CSS is intentional (filled in Task 8) and labeled. ✓

**Type/name consistency:** `poolTrailingApr(poolId, deals)` and `groupBySector(pools, deals)` are defined in Task 2 and consumed identically in Tasks 5/6 and Explore. Sector object keys (`category`, `label`, `logo`, `classes[{risk,poolId,apr}]`, `maxApr`) match across `sectors.js`, `SectorCoin`, `SectorCoins`, `Discover`, and all test fixtures. `orbitPositions(count, radius)` defined and used consistently. `onOpenDeposit(poolId)` matches the existing App handler signature. CSS vars `--px/--py/--float-delay/--float-dur/--tilt` are written in `SectorCoins.jsx` and read in `discover.css`. ✓
