import React from "react";
import VideoPixelGrid from "./VideoPixelGrid.jsx";
import "./Hero.css";

// Minimal landing: the video pixel grid as the backdrop, one sentence (a wafer
// pun that explains the app) with a marker-highlight on the payoff, and a single
// Launch app button. Neutral palette — the colour direction is being restarted.
export default function Hero({ onEnter, connecting }) {
  return (
    <section className="wf-hero">
      <div className="wf-hero-grid" aria-hidden="true">
        <VideoPixelGrid
          src="/landing.mp4"
          gridCols={150}
          gridRows={84}
          maxElevation={50}
          motionSensitivity={0.25}
          elevationSmoothing={0.2}
          colorMode="webcam"
          backgroundColor="#030303"
          mirror={false}
          gapRatio={0.05}
          invertColors={false}
          darken={0.6}
          borderColor="#ffffff"
          borderOpacity={0.06}
        />
      </div>
      <div className="wf-hero-overlay" aria-hidden="true" />

      <div className="wf-hero-copy">
        <h1 className="wf-hero-line">
          Every DePIN runs on silicon. Wafer slices the machines&apos; future on-chain rewards into{" "}
          <span className="wf-highlight">liquid, NAV-appreciating yield.</span>
        </h1>
        <button className="wf-launch" onClick={onEnter} disabled={connecting}>
          {connecting ? "Connecting…" : "Launch app"}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M17 8l4 4m0 0l-4 4m4-4H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </section>
  );
}
