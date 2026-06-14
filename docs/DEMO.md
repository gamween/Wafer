# Wafer — Runbook de présentation (ETHGlobal NY 2026)

Guide pour pitcher Wafer aux juges Hedera. Track visée : Hedera — Tokenization.
Tout ce qui est ci-dessous est live sur Hedera Testnet (chain 296) et prouvé on-chain.

---

## 0. À faire 5 min avant de passer

- `cd web && pnpm dev` → l'app lit l'état live du vault déployé.
- MetaMask sur Hedera Testnet (chain 296), compte = l'operator `0xf6fAc89C…` (admin + investisseur dans la démo).
- Onglets ouverts : HashScan du vault, Sourcify (vérifié), l'app.
- Optionnel (preuve live béton) : un terminal prêt à lancer `pnpm run smoke` (≈ 4 min, ~20 HBAR).
- Balance testnet : garder > 100 HBAR (le faucet recharge à 1000/jour ; un smoke complet coûte ~20 HBAR, activer un nouveau marché secondaire ~30 HBAR).

---

## 1. Le pitch (ce que tu dis)

30 secondes :
> "DePIN operators buy hardware today and earn protocol rewards on-chain over months. Wafer is the liquidity layer for that gap: investors fund a pool, the pool advances HBAR to a DePIN operator against its future on-chain rewards, and those rewards stream back into the pool — NAV rises live. It's Centrifuge/Maple, specialized for DePIN, fully on Hedera with HTS + a Solidity vault."

Le « wow », à dire clairement :
> "DePIN is the one RWA category whose cashflow is natively on-chain — no invoice, no bank, no fiat bridge. Repayment needs no trust in a human paying: the operator routes its on-chain reward stream to the vault, and you watch NAV tick up live."

---

## 2. Le déroulé de démo (2 options — fais les deux si tu as le temps)

### Option A — preuve live au terminal (`pnpm run smoke`)
C'est le plus fort : chaque étape émet une vraie tx avec un lien HashScan. Commente en direct :

1. deposit 10 HBAR → parts au NAV 1.0000.
2. proposeDeal → approveDeal (classe A, pool GPU-A) → financeClaim : avance 9 HBAR + escrow du device-NFT + mint du claim-NFT. Pointe : "NAV stays FLAT at finance — drift 0 tinybar. No double-counting."
3. drip loop (MockRewardSource) : NAV monte **1.0000 → 1.0600 → 1.0933 → 1.1000**, monotone, jamais 2.0. À repaid : le claim-NFT **burn**.
4. RUN défaut : un 2e deal, drip partiel, puis markDefault → **NAV écrit en baisse 1.16 → 0.80** (perte partagée pro-rata), collatéral wipe.

Phrase clé : *"Every number you see, I read back from the contract on-chain. The old double-count bug — deposit 100, advance 90, repay 100 showing NAV 2.0 — is dead: totalAssets is derived (idle + receivable), finance just moves cash to a receivable, and only the realized spread accretes into NAV."*

### Option B — l'app (visuel)
1. Pools / Fund a category : montre GPU-A, son NAV, sa TVL, et les deals listés dessous (lus via Mirror Node).
2. Deposit : associate (IHRC719) → l'admin t'a allowlisté (KYC) → deposit en HBAR natif → tes parts apparaissent.
3. Pool detail : NAV, deals (repaid / defaulted), liquidité idle vs déployée, file de redemption.
4. Redeem : approve + redeem au NAV (sortie garantie). Montre `maxRedeem` et la file si le cash idle ne suffit pas.
5. Operator portal : proposeDeal + escrow device-NFT. Admin : review + assign class, finance, markDefault (timelock), allowlist KYC, pause/freeze.
6. Secondary : la **pair SaucerSwap share/WHBAR live** (avec liquidité) — sortie au prix marché en plus du redeem.

---

## 3. Ce qui est réel vs simulé (à dire, ça inspire confiance)

Réel et on-chain (testnet) :
- Le vault `WaferVault` (Solidity/HSCS), Sourcify "perfect" verified.
- Les tokens HTS : part de pool fongible (KYC-gated) + claim-NFT (reçu, burn au repaid).
- Toute la compta amortized-cost, deposit/redeem, file de redemption, finance/escrow, défaut.
- Le marché secondaire : vraie pair SaucerSwap V1 share/WHBAR, KYC-enabled, avec liquidité seedée.

Simulé (assumé, et c'est le SEUL mock) :
- Le **cashflow DePIN** : `MockRewardSource` drip des HBAR dans le vault via `settleRewards`, à la place du flux de rewards qu'un opérateur Helium router­ait après bridge. En prod : escrow du device-NFT (Helium recipient/destination) + keeper HIP-1215 + relayer de bridge HNT→HBAR.

Dis-le franchement : *"The only thing we mock is the DePIN reward cashflow itself — we can't wire a live Helium reward stream in a hackathon. The routing mechanism (device-NFT escrow) and everything else is real on-chain logic."*

---

## 4. Pourquoi Hedera (track Tokenization)

- HTS natif : part de pool fongible **KYC-gated** (compliance), claim-NFT, le tout piloté par le contrat (clés CONTRACT_ID, aucun signataire off-chain).
- Settlement en **HBAR natif** (tinybar 8dp), pas de pont fiat.
- Frais bas + finalité ~3s → on peut driper les rewards et voir le NAV bouger en live.
- Bonus track cochés : compliance (KYC + freeze + pause), Mirror Node pour le read/audit, secondaire SaucerSwap, automatisation via HIP-1215 (roadmap keeper).

---

## 5. Liens live (à montrer)

- Vault : https://hashscan.io/testnet/contract/0x9b8752C8a7131529E5DA8Fb6EDcaDA9097FaD244
- Sourcify (verified) : https://repo.sourcify.dev/contracts/full_match/296/0x9b8752C8a7131529E5DA8Fb6EDcaDA9097FaD244/
- Part de pool (HTS) : https://hashscan.io/testnet/token/0.0.9228636  ·  Claim-NFT : https://hashscan.io/testnet/token/0.0.9228637
- Pair SaucerSwap share/WHBAR : https://hashscan.io/testnet/contract/0x22CD5257e92Ca96186cA904780B72C965ba426B1
- Vault id `0.0.9228634` · operator `0.0.9185964` (`0xf6fAc89C…`)
- One-pager : `docs/ONE-PAGER.md` (EN) / `docs/ONE-PAGER.fr.md` (FR) · Spec : `SPEC.md`

---

## 6. Q&A juges — réponses prêtes

- "Comment l'opérateur rembourse vraiment ?" → Escrow du device-NFT : qui contrôle le NFT contrôle le flux de rewards (modèle Helium recipient/destination). En démo, `MockRewardSource` le simule ; en prod, un relayer bridge HNT→HBAR et appelle `settleRewards` (cadence via HIP-1215). La seule confiance résiduelle = la custody du HBAR bridgé.
- "APR par deal vs par pool ?" → L'APR est par deal (avance/attendu/terme). Le NAV de la pool est le **blend réalisé** de tous ses deals, accru en amortized-cost ; la classe de risque est la curation risque+rendement de l'admin.
- "Et si un opérateur fait défaut ?" → markDefault écrit le carry restant en baisse → le NAV baisse, perte partagée pro-rata ; le device-NFT en escrow est retenu/liquidé. Démo : NAV 1.16 → 0.80.
- "C'est un fonds — la part est-elle tokenisée et transférable ?" → Oui, token HTS fongible KYC-gated, redeem au NAV à tout moment + marché secondaire SaucerSwap.
- "Sécurité ?" → ReentrancyGuard + CEI partout, settleRewards gated par claim + plafonné à `expected`, Ownable2Step + timelock sur finance/default, whitelist opérateurs, seed de dead-shares anti-inflation, accounting uint256. Une revue adverse a été passée et corrigée.

---

## 7. Limites connues (assume-les, ne les cache pas)

- La part de pool est un **token HTS sans custom fee** : sur Hedera une fee fractionnaire est assessée à chaque transfert non-collector et casse redeem + l'AMM (`INVALID_ACCOUNT_ID`). Une fee compliant demanderait un design de transfert permissionné → roadmap.
- Le marché secondaire s'active en **un seul appel contrat** `enableSecondaryMarket` (createPair → grantKyc(pair) → mint+approve → addLiquidityETH, tient dans le cap 15M gas de Hedera). `scripts/enable-secondary.ts` reste dispo comme fallback équivalent. Le KYC du token rend l'ajout de liquidité non-trivial (il faut KYC la pair avant le seed) — c'est géré, mais c'est une vraie particularité RWA à expliquer.
- Démo single-key : l'operator joue investisseur + opérateur + admin. En prod : owner = multisig (Ofelia/Safe) + relayer dédié + opérateurs distincts.
- Budget testnet : 1000 HBAR/jour (faucet), donc montants de démo volontairement bas (deposit 10, avance 9, etc.).

---

## 8. Relancer une démo propre (si besoin)

```bash
pnpm run deploy            # vault + pool GPU-A + mocks, écrit deployments/testnet.json + .env (~150 HBAR)
pnpm run verify <vault>    # Sourcify
pnpm run smoke             # lifecycle complet live + secondaire one-call (deposit→finance→drip→repaid/burn→default→SaucerSwap)
# le smoke active déjà le secondaire ; pnpm run enable-secondary existe en fallback (~30 HBAR)
```
Le front lit `deployments/testnet.json` → les nouvelles adresses se propagent automatiquement.
