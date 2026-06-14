import React, { useRef, useState } from "react";
import "./StatefulButton.css";

// Stateful button: keeps the caller's button styling (pass the same className) and
// only animates the inner state idle → loading (spinner) → success (check) → idle
// around an async onClick. Aesthetics are untouched — spinner/check use
// currentColor so they match whatever button you wrap.
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
    } catch (err) {
      setState("idle"); // caller surfaces the error (onStatus); just reset visual
    }
  };

  return (
    <button
      type="button"
      className={`sb ${className} sb-${state}`}
      onClick={handle}
      disabled={disabled || state !== "idle"}
      aria-busy={state === "loading"}
      {...rest}
    >
      <span className="sb-label">{children}</span>
      <span className="sb-spinner" aria-hidden="true" />
      <span className="sb-check" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>
      </span>
    </button>
  );
}
