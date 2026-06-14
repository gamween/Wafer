import React from "react";
import { shortAddr } from "../lib/format.js";
import {
  GITHUB_URL, SPEC_URL, ONEPAGER_URL, HEDERA_DOCS_URL, X_URL,
  SOURCIFY_URL, VAULT_HASHSCAN_URL, VAULT_ADDRESS,
} from "../lib/links.js";

// Uniswap-style multi-column footer. Product / Protocol / Resources columns +
// socials, then a bottom bar with the copyright and the deployed vault address.
export default function Footer({ onTabChange }) {
  const go = (tab) => (e) => { e.preventDefault(); onTabChange?.(tab); };
  return (
    <footer className="ft">
      <div className="ft-inner">
        <div className="ft-cols">
          <div className="ft-col">
            <span className="ft-col-title">Product</span>
            <a className="ft-link" href="#" onClick={go("deposit")}>Deposit</a>
            <a className="ft-link" href="#" onClick={go("explore")}>Explore</a>
            <a className="ft-link" href="#" onClick={go("dashboard")}>Portfolio</a>
          </div>
          <div className="ft-col">
            <span className="ft-col-title">Protocol</span>
            <a className="ft-link" href={SPEC_URL} target="_blank" rel="noopener noreferrer">SPEC</a>
            <a className="ft-link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
            {SOURCIFY_URL && <a className="ft-link" href={SOURCIFY_URL} target="_blank" rel="noopener noreferrer">Verified contract</a>}
          </div>
          <div className="ft-col">
            <span className="ft-col-title">Resources</span>
            <a className="ft-link" href={ONEPAGER_URL} target="_blank" rel="noopener noreferrer">One-pager</a>
            <a className="ft-link" href={HEDERA_DOCS_URL} target="_blank" rel="noopener noreferrer">Hedera docs</a>
          </div>
          <div className="ft-col">
            <span className="ft-col-title">Social</span>
            <a className="ft-link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
            <a className="ft-link" href={X_URL} target="_blank" rel="noopener noreferrer">X</a>
          </div>
        </div>

        <div className="ft-bottom">
          <span className="ft-copy">© Wafer · Hedera Testnet</span>
          {VAULT_ADDRESS && (
            <a className="ft-vault mono" href={VAULT_HASHSCAN_URL || undefined} target="_blank" rel="noopener noreferrer" title={VAULT_ADDRESS}>
              Vault {shortAddr(VAULT_ADDRESS)}
            </a>
          )}
        </div>
      </div>
    </footer>
  );
}
