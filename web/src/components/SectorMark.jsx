import "./SectorMark.css";

// A category coin icon with an optional risk-grade badge (A/B/C) in the bottom-right
// corner. Used in per-pool views (Explore table, etc.) so a pool reads as
// "sector + risk" at a glance. In per-category views (Discover) no grade is passed.
export default function SectorMark({ logo, grade, alt = "", size = 44 }) {
  const showGrade = typeof grade === "string" && /^[A-C]$/.test(grade);
  const b = Math.round(size * 0.44);
  return (
    <span className="sector-mark" style={{ width: size, height: size }}>
      <img src={logo} alt={alt} />
      {showGrade && (
        <span className="sector-grade" style={{ width: b, height: b, fontSize: Math.round(b * 0.6) }}>
          {grade}
        </span>
      )}
    </span>
  );
}
