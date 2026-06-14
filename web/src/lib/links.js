// External links surfaced in the top nav mega-menu and the footer.
// Contract links are derived from deployments/testnet.json (via config.js) so they
// auto-follow a redeploy — nothing here is hand-maintained per deployment.
import deployment from "../../../deployments/testnet.json";
import { ADDRESSES, EXPLORER_URL } from "./config.js";

export const GITHUB_URL = "https://github.com/aiden-fianso/Wafer";
// SPEC / docs + one-pager live in the repo; link straight to them on GitHub.
export const SPEC_URL = `${GITHUB_URL}/blob/main/SPEC.md`;
export const ONEPAGER_URL = `${GITHUB_URL}#readme`;
export const HEDERA_URL = "https://hedera.com";
export const HEDERA_DOCS_URL = "https://docs.hedera.com";
export const X_URL = "https://x.com";

// Sourcify full-match record for the deployed vault (verified source), straight
// from the deployment file; falls back to a HashScan contract link.
export const SOURCIFY_URL =
  deployment?.sourcify ||
  (ADDRESSES.vault ? `https://repo.sourcify.dev/contracts/full_match/296/${ADDRESSES.vault}/` : "");

// HashScan link for the deployed vault contract.
export const VAULT_HASHSCAN_URL =
  deployment?.hashscan?.vault ||
  (ADDRESSES.vault ? `${EXPLORER_URL}/contract/${ADDRESSES.vault}` : "");

// The deployed vault EVM address (for the footer "deployed vault" line).
export const VAULT_ADDRESS = ADDRESSES.vault || "";
