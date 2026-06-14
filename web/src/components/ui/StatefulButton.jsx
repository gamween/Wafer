import React, { useRef, useState } from "react";
import "./StatefulButton.css";

// Stateful button: keeps the caller's button styling (pass the same className) and
// only animates the inner state idle → loading (spinner) → success (check) → idle
// around an async onClick. Uses the `sbtn` namespace (NOT `sb`, which collides with
// the old Sidebar's `.sb { height:100vh }` rule). Layout is inline so it can't
// blow up if the stylesheet is late; spinner/check use currentColor.
const OVERLAY = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  pointerEvents: "none",
};

export default function StatefulButton({ onClick, children, className = "", disabled, successMs = 1500, ...rest }) {
  const [state, setState] = useState("idle"); // "idle" | "loading" | "success"
  const timer = useRef(null);

  const handle = async (e) => {
    if (state !== "idle" || disabled) return;
    setState("loading");
    try {
      await onClick?.(e);
      setState("success");
      timer.current = setTimeout(() => setState("idle"), successMs);
    } catch {
      setState("idle"); // caller surfaces the error; just reset the visual
    }
  };

  const fade = (target) => ({ opacity: state === target ? 1 : 0, transition: "opacity 0.18s ease" });

  return (
    <button
      type="button"
      className={`sbtn ${className} sbtn-${state}`}
      onClick={handle}
      disabled={disabled || state !== "idle"}
      aria-busy={state === "loading"}
      {...rest}
      style={{ position: "relative", ...(rest.style || {}) }}
    >
      <span style={{ ...fade("idle"), display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>{children}</span>
      <span aria-hidden="true" style={{ ...OVERLAY, ...fade("loading") }}>
        <span
          className="sbtn-spin"
          style={{ width: "1.05em", height: "1.05em", border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%" }}
        />
      </span>
      <span aria-hidden="true" style={{ ...OVERLAY, ...fade("success") }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path className="sbtn-checkpath" d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}
