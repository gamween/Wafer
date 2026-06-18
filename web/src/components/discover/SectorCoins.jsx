import { useEffect, useRef } from "react";
import SectorCoin from "./SectorCoin.jsx";
import { orbitPositions } from "./layout.js";

// Lays the coins out in an orbit and applies a subtle whole-field parallax tilt
// toward the pointer (rAF-batched, written to CSS vars; the actual tilt lives in
// discover.css and is disabled under prefers-reduced-motion).
export default function SectorCoins({ sectors, onOpenDeposit }) {
  const ref = useRef(null);
  const frame = useRef(0);
  const positions = orbitPositions(sectors.length);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

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
