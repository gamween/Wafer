import React from "react";

// Quiet "How it works" strip shown under the hero on the home route. Three
// steps, restyled to the amber-night system — no globe, no heavy 3D.
const STEPS = [
  {
    n: "01",
    t: "Operators borrow against future rewards",
    d: "A DePIN operator proposes a deal — advance now against expected on-chain rewards — backed by a device-NFT held in escrow.",
  },
  {
    n: "02",
    t: "Pools finance, NAV accretes",
    d: "Investors deposit HBAR into a category × class pool and mint shares. NAV rises only as realized reward spread is accreted over each deal's term.",
  },
  {
    n: "03",
    t: "Redeem any time",
    d: "Burn shares for HBAR at NAV — instant up to the liquidity buffer, the rest FIFO-queued. Or exit on the SaucerSwap share/WHBAR market.",
  },
];

export default function HowItWorks({ onEnter }) {
  return (
    <section className="hiw" id="how-it-works">
      <div className="hiw-head">
        <span className="label">How it works</span>
        <h2 className="hiw-title">A liquid fund for infrastructure rewards.</h2>
      </div>
      <div className="hiw-grid">
        {STEPS.map((s) => (
          <div className="hiw-card" key={s.n}>
            <span className="hiw-num mono">{s.n}</span>
            <h3 className="hiw-step-title">{s.t}</h3>
            <p className="hiw-step-desc">{s.d}</p>
          </div>
        ))}
      </div>
      <div className="hiw-foot">
        <button className="btn-amber" onClick={onEnter}>Enter the pools</button>
      </div>
    </section>
  );
}
