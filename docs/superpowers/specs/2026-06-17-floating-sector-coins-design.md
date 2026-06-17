# Discover — Floating Sector Coins

- **Date:** 2026-06-17
- **Status:** Approved (design) — pending implementation plan
- **Scope:** Web app only (`web/`). New in-app surface + one decorative-but-interactive component family. No contract, hook, or business-logic changes.

## 1. Context & problem

The Wafer investor dApp (`Vite 6 + React 19 + viem`) currently lands a connected
user on the **Deposit** tab. There is no visual entry point that communicates the
breadth of the protocol (five DePIN sectors) or invites discovery.

We want a Uniswap-style **floating coins** hero: a small set of premium, drifting,
hoverable tokens. Each token represents a DePIN **sector**; hovering reveals the
sector's best yield; clicking opens a menu of that sector's risk-class pools, each
of which routes straight into the existing Deposit flow.

The effect is the artistic direction borrowed from reference projects; **all
existing buttons, handlers, and on-chain logic stay untouched**. We only add a new
view and reuse existing handlers.

## 2. Goals / non-goals

**Goals**
- A dedicated in-app **Discover** view that becomes the connected landing.
- Five floating sector coins (GPU, Wireless, Mapping, Energy, Storage).
- Hover → capsule showing sector label + **max APR** across its pools.
- Click → dropdown of the sector's risk classes (A/B/C) with per-class APR; clicking
  a row opens that exact pool in **Deposit** via the existing `onOpenDeposit(poolId)`.
- Clean, small, single-purpose components; pure, testable data layer. Built to scale.
- Graceful degradation when a sector or class has no pool.
- Respect `prefers-reduced-motion`.

**Non-goals**
- No changes to contracts, ABIs, `useContracts`, `useWallet`, or any read/write path.
- No changes to the marketing Hero/landing (`Hero.jsx`).
- No physics engine, no WebGL/3D, no canvas (see §4).
- Not a dense token cloud — exactly five deliberate hero coins.

## 3. Research convergence (why this shape)

A multi-agent survey dissected the user's reference repo `carluzh/canary` and the
real `Uniswap/interface`. Both implement floating coins the **same way**: plain
**DOM + CSS** (absolutely-positioned elements, blue-noise/Poisson layout, hover via
CSS), with **no canvas, no WebGL, no physics, and no JS animation loop**. canary's
coins are in fact static until hovered. Key reusable ideas: deterministic layout,
per-coin depth variation (tilt/opacity), a staggered mount-in, a pointer-events:none
wrapper so only the coins are interactive (page content underneath stays clickable),
and a hover capsule that reveals metadata.

## 4. Chosen approach

**DOM + CSS coins, deliberately placed in an orbit around the Wafer wordmark,
animated with `motion` (formerly framer-motion).**

The interaction model is decisive: a **click-expandable menu with three clickable
rows** is rich DOM interaction (focus, keyboard, hit targets, accessibility). DOM is
the correct medium. A canvas approach was rejected because per-row click hit-testing
and accessibility on a canvas are fragile and don't scale.

Rejected alternatives:
- **Verbatim canary port (Poisson scatter + `poisson-disk-sampling`):** random
  scatter reads as less intentional for exactly five hero coins, is static by
  default, and we'd still bolt on the dropdown. More ported code than needed.
- **Canvas field:** wrong medium for a precise, accessible click menu (above).

## 5. Architecture

Small units, one purpose each, communicating through explicit props.

| Unit | File | Responsibility | Depends on |
|------|------|----------------|------------|
| `Discover` (view) | `web/src/components/Discover.jsx` | Fetch pools+deals, derive sectors, render the hero shell (centered wordmark + coin field) | `contracts`, `refreshKey`, `onOpenDeposit`; `sectors.js` |
| `SectorCoins` | `web/src/components/discover/SectorCoins.jsx` | Orbit layout of the five coins + global pointer-parallax tilt | `SectorCoin` |
| `SectorCoin` | `web/src/components/discover/SectorCoin.jsx` | One coin: idle float, hover capsule (label + max APR), click dropdown (A/B/C rows) | `onOpenDeposit` |
| `sectors` (pure) | `web/src/lib/sectors.js` | `groupBySector(pools, deals)` → per-category `{ category, label, logo, classes[], maxApr }` | `config.js`, `format.js` |
| styles | `web/src/components/discover/discover.css` | Navy/amber re-skin, float keyframes, reduced-motion guard | — |

### Data shape produced by `groupBySector`

```js
// One entry per category (all 5 always present, even with no pools).
{
  category: 0,                 // enum index
  label: "GPU / Compute",      // CATEGORY_LABEL
  logo: "/logos/gpu.png",      // CATEGORY_LOGO
  classes: [                   // only classes that have a pool, sorted A,B,C
    { risk: "A", poolId: 3, apr: 0.091 },
    { risk: "B", poolId: 4, apr: 0.124 },
    { risk: "C", poolId: 5, apr: 0.142 },
  ],
  maxApr: 0.142,               // max of non-null class aprs, or null
}
```

APR per class reuses the **existing** logic already in `Explore.jsx`
(`poolTrailingApr(poolId, deals)` / `dealApr`). That logic will be lifted into
`sectors.js` (or imported) so there is a single source of truth — no re-derivation.

## 6. Interaction model

1. **Idle:** each coin floats (gentle translateY bob + micro-rotation), desynced
   per coin so the field feels alive but calm. A subtle whole-field parallax tilts
   toward the cursor.
2. **Hover:** the coin lifts/sharpens, gains a warm amber glow, and a capsule
   appears: `GPU / Compute · max 14.2%`.
3. **Click:** the capsule expands into a menu (one coin open at a time):
   ```
   GPU / Compute
   ──────────────────
   Class A · 9.1%    →
   Class B · 12.4%   →
   Class C · 14.2%   →
   ```
   Clicking a row calls `onOpenDeposit(poolId)` → opens that exact pool in the
   existing Deposit card. Esc or outside-click closes the menu.

**Degradation:** sector with no pools → coin renders, capsule shows `—`, menu
disabled. Missing class → that row is omitted. `maxApr === null` → capsule shows `—`.

**Accessibility:** coins are real `<button>`s; the dropdown is keyboard-navigable;
the field wrapper is `pointer-events:none` with coins `pointer-events:auto` so
nothing underneath is blocked; motion is gated behind `prefers-reduced-motion`.

## 7. Routing changes (`App.jsx` + `TopNav.jsx`)

Additive only — no handler is modified.
- Add `"discover"` to `INVESTOR_TABS`.
- Connected default landing: `deposit` → `discover` (the post-connect effect and
  `goApp()` target `discover`).
- Render branch: `{tab === "discover" && <Discover contracts={contracts} refreshKey={refreshKey} onOpenDeposit={openDeposit} />}`.
- `TopNav` gains a **Discover** nav item; the logo/home click routes here.
- The disconnected/Hero landing (`!account || tab === "home"`) is unchanged.

## 8. Visual & motion

- Transparent background (the existing `#030303` shell shows through).
- Amber accent `#f59e0b` for glow and active borders; dark-glass capsule/menu
  (not canary's white pill — re-skinned for the navy theme).
- Slow float (~7–10s loops), low-amplitude parallax — premium, not cartoonish.
- `@media (prefers-reduced-motion: reduce)`: freeze drift/parallax, render a static
  scatter. (No reduced-motion handling exists in the codebase today; we add it.)

## 9. Dependencies & assets

- **Add:** `motion` (~15 KB gz; modern framer-motion). Used for float, hover spring,
  and `AnimatePresence`/`layout` menu open/close. User approved adding libs.
- **Assets (placeholders):** existing `/logos/{gpu,wireless,mapping,energy,storage}.png`.
  Designed to be swapped for higher-fidelity illustrations later by changing only the
  `CATEGORY_LOGO` `src` values — no component change.

## 10. Built to scale (durability notes)

- **Single source of truth for APR:** sector/APR math lives once in `sectors.js`;
  `Explore` and `Discover` consume the same function rather than each re-deriving.
- **Data-driven coins:** the five coins are produced from `CATEGORIES`/`CATEGORY_LABEL`/
  `CATEGORY_LOGO`. Adding a sixth sector on-chain means adding one taxonomy entry —
  the coin field grows automatically, no Discover code change.
- **Isolation:** `SectorCoin` knows nothing about contracts; it takes a plain sector
  object + `onOpenDeposit`. It can be rendered in Storybook/tests with fixture data.
- **Layout independent of count:** orbit positions are computed from the number of
  sectors, so the field stays balanced as sectors are added/removed.

## 11. What is explicitly NOT touched

Contracts, ABIs, `useContracts`, `useWallet`, `DepositCard`/`DepositWidget`,
`Explore`, `Portfolio`, `OperatorPortal`, `Admin`, and every existing handler
(`onOpenDeposit`, `onTabChange`, `connect`, etc.). The only edits to existing files
are the additive routing wiring in `App.jsx` and a nav item in `TopNav.jsx`.

## 12. Testing

- `sectors.js` is pure → unit-testable with fixture pools/deals (covers grouping,
  per-class APR, max, and degradation paths). Note: `web/` has no JS test runner
  today (tests are Hardhat/contracts); standing up a lightweight Vitest setup for the
  pure lib is recommended but tracked as follow-up, not a blocker for this feature.
- Manual: verify hover capsule, click dropdown rows → Deposit pre-fill, Esc/outside
  close, empty-sector and missing-class states, and reduced-motion freeze.

## 13. Open questions / future work

- Higher-fidelity sector illustrations (user sourcing from fab.com/Pinterest) — swap
  later via `CATEGORY_LOGO`.
- Optional: small TVL/idle figure in the capsule alongside APR (out of scope now).
- Optional: Vitest harness for `web/` pure libs.
