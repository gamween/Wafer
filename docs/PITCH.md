# Wafer — Pitch & Submission Pack (ETHGlobal NY 2026)

> **À quoi sert ce fichier.** Tout ce qu'il te faut pour (1) le **deck** qui précède la démo,
> (2) la **démo live**, (3) la **vidéo** ETHGlobal (2–4 min), (4) remplir le **formulaire
> ETHGlobal** champ par champ (copier-coller). Les *consignes* sont en français ; le *contenu
> destiné aux juges* (slides, narration, copy du formulaire) est en **anglais**, prêt à coller.
>
> Tracks visées : **Hedera (main, $15 000)** + **Tokenization on Hedera ($3 000)**.
> Le runbook détaillé de la démo live reste [`docs/DEMO.md`](DEMO.md) ; ici c'est la version
> condensée + tout le reste.

---

## 0. Le pitch en une phrase (à mémoriser)

> **Wafer is InfraFi: a KYC-gated, NAV-appreciating tokenized credit fund on Hedera that advances
> HBAR to DePIN operators against their future on-chain rewards — and you watch the fund's NAV tick
> up live as those rewards stream back in.**

Le « wow » à dire d'une traite :
> **DePIN is the one real-world asset whose cashflow is *natively* on-chain — no invoice, no bank,
> no fiat bridge. So repayment needs zero trust in a human paying: the operator routes its reward
> stream to the vault, and NAV rises on its own.**

Positionnement marché : *« Centrifuge / Maple, but specialized for DePIN reward streams, fully on
Hedera HTS. »*

---

## 1. Le DECK (avant la démo) — 7 slides

Format hackathon : deck court (≈90 s), puis tu bascules en **démo live**. Garde 1 idée par slide,
gros texte, peu de mots. Ci-dessous : **texte exact à mettre sur la slide** + **speaker notes**.

### Slide 1 — Title
**On-slide :**
- `WAFER` (wordmark blanc sur noir — `web/public/wafer-logo.png`)
- *InfraFi liquidity for DePIN — on Hedera.*
- petit : ETHGlobal New York 2026 · Hedera Testnet
**Notes :** « Hi, we're Wafer. We built a tokenized credit fund on Hedera that finances the
physical infrastructure economy — DePIN. »

### Slide 2 — Problem
**On-slide :**
- **DePIN operators buy hardware today, earn protocol rewards over months.**
- That timing gap = capital they don't have.
- Legacy credit can't underwrite an on-chain reward stream.
**Notes :** « A GPU/compute, wireless, or mapping operator has to pay for hardware now, but rewards
trickle in for months. No bank will lend against an on-chain reward stream. That gap is the
problem. »

### Slide 3 — Solution
**On-slide :**
- **Wafer is a financing layer, not an operator.** We never run nodes.
- **Investors** fund a pool → get a KYC-gated, NAV-appreciating **HTS share**.
- **Operators** sell future rewards → get **HBAR now**.
**Notes :** « Wafer sits in the middle. Investors supply capital and hold a tokenized fund share.
Operators who *already* earn on-chain rewards come to us for cash now. We are Centrifuge/Maple,
specialized for DePIN. »

### Slide 4 — The wow (pourquoi DePIN)
**On-slide :**
- **DePIN cashflow is *natively on-chain*.** No invoice. No bank. No fiat bridge.
- **Repayment needs no trust in a human paying** — the operator *routes* its reward stream to the
  vault.
- **NAV ticks up live** as rewards land.
**Notes :** C'est LE slide qui gagne la track. « Every other RWA — invoices, real estate — needs a
human or a bank to actually pay you back. DePIN doesn't. The hardware pays the vault directly,
on-chain. That's why DePIN is the killer RWA for crypto-native credit. »

### Slide 5 — How it works (lifecycle)
**On-slide (5 étapes, en flèche) :**
1. Operator proposes a deal → 2. Admin assigns a **risk class** → 3. Pool **finances**: advances
HBAR + mints a **claim NFT** → 4. Rewards **stream in** → **NAV rises** → 5. Repaid: NFT **burns**.
Default: **NAV writes down**, loss shared pro-rata.
- petit, en bas : *Investors redeem at NAV anytime — or exit on SaucerSwap.*
**Notes :** « The pool's NAV is the blended, realized return of all its deals, accrued at
amortized cost. Per-deal APR differences become one diversified pool yield. »

### Slide 6 — Why Hedera / HTS (track fit)
**On-slide :**
- **HTS fungible pool-share** — KYC + freeze keys held by the contract = compliant fund unit.
- **HTS claim-NFT** — on-chain receipt of each financed deal, burned at maturity.
- **Native HBAR** settlement · **Mirror Node** read/audit · **SaucerSwap** secondary · Sourcify-verified.
**Notes :** « The share is a real HTS token — the keys are held by the vault contract itself, no
off-chain signer. It's KYC-gated at the protocol level, which is exactly what a tokenized fund
share needs. Everything settles in native HBAR. »

### Slide 7 — What's live → (transition démo)
**On-slide :**
- ✅ **Live on Hedera Testnet** — vault deployed, Sourcify-verified.
- ✅ Full lifecycle proven on-chain: finance → reward drip → NAV↑ → repaid/burn → default/write-down.
- ✅ Live **SaucerSwap share/WHBAR** pair.
- **→ Let me show you.**
**Notes :** « None of this is slideware — it's deployed and verified on testnet. Let me walk you
through it live. » → bascule sur l'app / le terminal.

> **Roadmap slide (optionnelle, si Q&A le demande, pas dans le flow principal) :** real
> per-network reward routing (Helium/Render/io.net) · redemption queue/epochs · custom fractional
> protocol fee (permissioned-transfer design) · stablecoin denomination · more categories & risk
> classes.

---

## 2. La DÉMO live (≈3 min) — version condensée

> Runbook complet (checklist 5 min avant, deux options, phrases clés) → [`docs/DEMO.md`](DEMO.md).
> Ici, le squelette.

**Setup :** `cd web && pnpm dev` · MetaMask sur Hedera Testnet (296), compte = operator
`0xf6fAc89C…` (joue admin + investisseur + opérateur) · onglets ouverts : app, HashScan du vault,
Sourcify.

**Deux façons de prouver — fais la B en visuel, garde A en réserve « preuve béton » :**

**A. Terminal `pnpm run smoke` (la preuve la plus forte, ~4 min, ~20 HBAR).** Chaque étape émet une
vraie tx + lien HashScan : deposit → finance (avance HBAR + escrow device-NFT + mint claim-NFT) →
drip rewards (NAV `1.0000 → 1.1000`, monotone) → repaid (claim-NFT **burn**) → 2e deal en **défaut**
(NAV écrit en baisse `1.16 → 0.80`). Phrase clé : *« Every number I show, I read back from the
contract on-chain. »*

**B. L'app (visuel, ce que les juges retiennent) :**
1. **Explore / Pools** — GPU-A, son NAV, sa TVL, les deals listés (lus via Mirror Node).
2. **Deposit** — associate (IHRC719) → KYC allowlist → deposit HBAR natif → parts au NAV.
3. **Pool detail** — NAV, deals (repaid/defaulted), idle vs déployé, file de redemption.
4. **Redeem** — approve + redeem au NAV (sortie garantie) ; montre `maxRedeem` + la file.
5. **Operator + Admin** — proposeDeal + escrow device-NFT ; review, assign class, finance,
   markDefault (timelock), KYC, pause/freeze.
6. **Secondary** — la **pair SaucerSwap share/WHBAR live** : sortie au prix marché en plus du redeem.

**À dire absolument (honnêteté = confiance) :** *« The only thing we simulate is the DePIN reward
cashflow itself — we can't wire a live Helium reward stream in a hackathon. The routing mechanism
(device-NFT escrow) and every other line of logic is real, on-chain. »*

---

## 3. La VIDÉO démo ETHGlobal (2–4 min)

**Contraintes (cf. screenshots ETHGlobal) :** 2–4 min · ≥720p · **audio clair, voix, PAS de
musique** · **pas d'accélération** (vérifié manuellement = disqualifiant). Vise **~2:45–3:15**.

### Checklist d'enregistrement
- [ ] Écran propre : ferme Slack/notifs, masque la barre de favoris, plein écran.
- [ ] Résolution ≥ 1280×720 (1080p idéal). QuickTime (macOS) « New Screen Recording » ou OBS.
- [ ] **Micro testé** — voix > silence > musique. Parle lentement, scripté.
- [ ] Onglets pré-chargés : app (`pnpm dev`), HashScan du vault, Sourcify verified.
- [ ] MetaMask déjà connecté au compte operator sur le réseau 296 (évite de filmer un login lent).
- [ ] Si tu filmes le terminal smoke : lance-le **avant** ou coupe les temps morts (cut, pas
      speed-up — l'accélération est interdite).

### Plan de tournage + narration (script à lire)

> Total visé ~3:00. Les `[ ]` = ce qui est à l'écran. Le texte = ce que tu dis.

**[0:00–0:25] — Hook (sur la landing page de l'app).**
[ ] Hero « Invest in the Infrastructure Economy ».
> « This is Wafer — a tokenized credit fund on Hedera for the DePIN economy. DePIN operators buy
> hardware today and earn protocol rewards on-chain over months. Wafer closes that gap: investors
> fund a pool, the pool advances HBAR to operators against their future rewards, and the fund's NAV
> rises live as those rewards stream back. It's all real, on Hedera Testnet — let me show you. »

**[0:25–1:00] — Invest side (Explore + Deposit).**
[ ] Explore/Pools : GPU-A, NAV, TVL, deals listés. Puis Deposit.
> « Here's the GPU-A pool — its live NAV and TVL, read straight from the contract and Mirror Node.
> I'll deposit HBAR. The pool share is a native Hedera Token Service token, KYC-gated — so I first
> associate it and the admin allowlists me. I deposit, and I receive fund shares at the current
> NAV. This share is the tokenized fund unit. »

**[1:00–1:50] — Finance a deal + NAV rises (Admin/Operator → Pool detail).**
[ ] Operator proposeDeal → Admin assign class + finance → Pool detail, NAV qui monte.
> « Now the financing engine. An operator proposes a deal against its future rewards. As admin I
> assign a risk class and finance it: the pool advances HBAR and mints a claim NFT — the on-chain
> receipt — held by the vault. As the operator's rewards stream in, watch the NAV per share tick up,
> from 1.00 upward. Every cent of that is read back from the contract on-chain — no database. When
> the deal fully repays, the claim NFT burns. If it defaults, the NAV writes *down* and the loss is
> shared pro-rata across the pool. »

**[1:50–2:25] — Exit (Redeem + Secondary).**
[ ] Redeem au NAV ; puis l'onglet Secondary (pair SaucerSwap).
> « Investors exit two ways. Redeem at NAV — burn shares, get HBAR back, guaranteed by the vault.
> Or sell on the open market: this is a live SaucerSwap pair, our share token against wrapped HBAR,
> for an instant secondary exit. »

**[2:25–2:55] — Proof + why Hedera (HashScan + Sourcify).**
[ ] HashScan du vault + Sourcify « verified ».
> « None of this is a mock. The vault is deployed and Sourcify-verified on Hedera Testnet. The share
> token and the claim NFT are real HTS tokens whose KYC and freeze keys are held by the contract
> itself — no off-chain signer. Native HBAR settlement, ~3-second finality, fees in cents. The one
> thing we simulate is the DePIN reward cashflow — we can't wire a live Helium stream in a weekend —
> but the routing mechanism and every other line is real on-chain logic. »

**[2:55–3:05] — Close.**
[ ] Retour logo Wafer.
> « Wafer — InfraFi liquidity for DePIN, tokenized on Hedera. Thanks for watching. »

> **Astuce :** enregistre la voix d'abord en lisant le script, puis filme l'écran en suivant — ou
> filme l'écran et redouble la voix par-dessus. Plus propre qu'en une prise.

---

## 4. Formulaire ETHGlobal — tout, prêt à coller

### 4.1 Demonstration link
Mets l'URL de la **vidéo** (Loom / YouTube unlisted / Google Drive public) une fois enregistrée. Si
tu as un déploiement public de l'app, mets-le ; sinon la vidéo suffit. Tu peux aussi pointer la
landing déployée. *(Ne pas laisser le placeholder.)*

### 4.2 Short description (≤ 100 caractères)
Choisis-en une (compte vérifié) :
- `InfraFi on Hedera: a KYC-gated tokenized fund that finances DePIN operators' on-chain rewards.` **(94)**
- `Fund DePIN operators' on-chain rewards via a KYC-gated tokenized pool on Hedera. NAV rises live` **(96)**
- `On Hedera: a tokenized, KYC-gated credit fund that turns DePIN reward streams into liquid yield.` **(96)**

→ Recommandée : **la 1ʳᵉ** (dit « tokenized fund » + « KYC-gated » + « DePIN » + « Hedera » : tous
les mots-clés de la track).

### 4.3 Description (≥ 280 caractères) — copier-coller
```
Wafer is InfraFi: a tokenized, NAV-appreciating credit fund on Hedera that finances the DePIN
economy. DePIN operators (GPU/compute, wireless, mapping, energy, storage) must buy hardware today
but earn protocol rewards on-chain over months — a capital-timing gap that legacy credit can't
underwrite. Wafer closes it. Investors fund a pool (category x risk class, e.g. GPU-A) and receive a
fungible, KYC-gated, NAV-appreciating Hedera Token Service share — a tokenized fund unit. The pool
advances HBAR to an operator against its future rewards and mints a claim NFT, the on-chain receipt
held by the vault. As the operator routes its reward stream back in, the pool's NAV ticks up live,
accrued at amortized cost; when a deal repays in full the claim NFT burns, and on default the NAV
writes down with the loss shared pro-rata across the pool. Investors redeem at NAV anytime or exit
on a live SaucerSwap secondary market. The wow: DePIN is the one real-world asset whose cashflow is
natively on-chain, so repayment needs no trust in a human paying — the hardware pays the vault
directly. Everything is real on-chain logic on Hedera Testnet; only the DePIN reward cashflow itself
is simulated for the demo.
```

### 4.4 How it's made (≥ 280 caractères) — copier-coller
```
Wafer is a single Solidity contract, WaferVault, deployed on Hedera's EVM (HSCS, Solidity 0.8.24,
optimizer + viaIR). It creates and manages two Hedera Token Service tokens via the
@hiero-ledger/hiero-contracts system-contract bindings (the HTS precompile at 0x167): a fungible
pool-share token whose KYC and freeze keys are held by the contract itself — no off-chain signer —
and a claim NFT minted as the on-chain receipt of each financed deal and burned at maturity.
Settlement is native HBAR with 8-decimal tinybar accounting (no USDC, no fiat bridge, no token
association for settlement). NAV is computed at amortized cost from a derived totalAssets = idle
cash + receivable, which kills a classic double-count bug (deposit 100, advance 90, repay 100 must
not read NAV 2.0): financing just moves cash into a receivable, and only the realized spread accretes
into NAV. Security: ReentrancyGuard + checks-effects-interactions throughout, settleRewards gated by
the claim and capped at the expected repayment, Ownable2Step plus a timelock on finance/default, an
operator allowlist, and a dead-shares seed against inflation attacks; a full adversarial review was
run and fixed. The frontend is React + Vite + viem talking to the contract directly via the wallet,
reading NAV/pools/deals/activity from the Hedera Mirror Node — no backend. The contract is verified
on Sourcify. The secondary market is a real SaucerSwap V1 share/WHBAR pair brought up in a single
contract call, enableSecondaryMarket, that creates the pair, grants it KYC, mints and approves, and
adds liquidity — all within Hedera's 15M-gas cap; KYC-gating the share makes seeding an AMM
non-trivial (the pair must be KYC'd before liquidity), a genuine RWA edge we handle on-chain. The
only simulated piece is the DePIN reward cashflow (a stand-in reward source drips HBAR via
settleRewards); the routing mechanism — device-NFT escrow, Helium-style recipient/destination
redirection, with an HIP-1215 keeper on the roadmap — is real.
```

### 4.5 Tech Stack (les multi-selects)
Sélectionne (et tape en « Other » ce qui manque) :
- **Ethereum developer tools :** `Hardhat`. (Other si besoin : `Sourcify`, `Hashio RPC`.)
- **Blockchain networks :** `Hedera` (Hedera Testnet, chain 296).
- **Programming languages :** `Solidity`, `TypeScript`, `JavaScript`.
- **Web frameworks :** `React`, `Vite`. (Other : `viem`.)
- **Databases :** aucune → choisis `None` si dispo ; sinon Other : `Hedera Mirror Node (REST read layer)`.
- **Design tools :** mets ce que tu as réellement utilisé ; si rien → Other : `hand-coded CSS` (et
  `AI-generated art refs` si tu cites les mockups).
- **Other tech (champ libre, « type and enter ») :** `Hedera Token Service (HTS)`,
  `@hiero-ledger/hiero-contracts`, `Hedera Mirror Node`, `SaucerSwap V1`, `HBAR`, `IHRC719`,
  `Sourcify`, `MetaMask`.

### 4.6 Describe how AI tools were used — copier-coller
```
Claude Code (Anthropic) was the primary AI pair-programmer. It was used to implement the WaferVault
Solidity contract — the HTS token lifecycle via the system-contract bindings, the amortized-cost NAV
accounting (including the derived-totalAssets fix for the deposit/finance/repay double-count), and
the deposit/redeem/finance/settle/default state machine — and to write the pure-logic accounting and
state-machine test mirrors. It also ran an adversarial self-review of the contract that surfaced and
fixed the queue-NAV netting bug, and helped build the React + viem frontend and the deploy/smoke
scripts. All AI-generated code was reviewed, tested on Hedera Testnet, and verified on-chain.
```

### 4.7 Images
- **Logo (carré 512×512) :** `web/public/favicon-512.png` (déjà 512×512). Alternative :
  `web/public/apple-touch-icon.png`, ou crop carré de la « bee » orange du hero.
- **Cover image (16:9, ~640×360) :** `docs/art-refs/hero-landing-mockup.png` (déjà 16:9), ou un
  screenshot propre de la landing déployée.
- **Screenshots (min 3, jusqu'à 6) — capture ceux-ci :**
  1. **Explore / Pools** — GPU-A avec NAV + TVL + deals.
  2. **Pool detail** — NAV, deals (repaid/defaulted), idle vs déployé, file de redemption.
  3. **Deposit** — flow HBAR → parts (montre le NAV).
  4. **Operator / Admin** — proposeDeal + assign class + finance.
  5. **Secondary** — la pair SaucerSwap share/WHBAR.
  6. **HashScan / Sourcify** — le vault `0x9b8752…` vérifié (la preuve on-chain).

### 4.8 Select prizes
Coche : **Hedera (le prix principal / overall $15,000)** + **Tokenization on Hedera ($3,000)**.
*(Privy / ENS / No-Solidity ne sont pas construits — ne pas les cocher.)*

#### Bloc par-prix « How are you using this Protocol / API? » (Hedera – $15,000)

**Champ texte (`*`, why applicable) — copier-coller :**
```
Wafer is built end-to-end on Hedera. A Solidity vault on the HSCS creates and manages two Hedera
Token Service tokens — a KYC-gated fungible fund share and a claim NFT — with the token's
KYC/freeze/supply keys held by the contract itself, no off-chain signer. Settlement is native HBAR
(8-dp tinybar), the frontend reads NAV/pools/deals from the Hedera Mirror Node, the contract is
Sourcify-verified, and the secondary market is a live SaucerSwap share/WHBAR pair. HTS is the core
of the product: the tokenized fund unit IS an HTS token.
```

**Link to the line of code** (permalink figé sur le commit — survit à l'audit) :
```
https://github.com/aiden-fianso/Wafer/blob/5c221e26eb4db4044eed5ff385e7973e86852c4a/contracts/WaferVault.sol#L421
```
Alternatives : KYC-gating `…/WaferVault.sol#L292` (`grantTokenKyc`) · claim-NFT
`…/WaferVault.sol#L454` (`createNonFungibleToken`).
> ⚠️ Si tu pushes l'audit **avant** de soumettre, régénère le permalink au nouveau HEAD (sur GitHub,
> ouvre le fichier et tape `y` pour figer l'URL sur le dernier commit).

**Étoiles « How easy is it to use the API/Protocol? » :** **8/10** (crédible, non flagorneur ; 7 si
tu veux refléter la friction HTS).

**Additional feedback for the Sponsor (optionnel, mais bien vu) — copier-coller :**
```
HTS through the 0x167 precompile is powerful but has sharp edges for a Solidity team: the precompile
returns success=true even on business errors, so you must check responseCode == 22 on every single
call or money paths fail silently. The int64 token amounts force careful downcasting from uint256 for
8-dp accounting. The biggest one: a KYC-gated token plus a custom fractional fee breaks redeem and
the SaucerSwap AMM (INVALID_ACCOUNT_ID) because the fee is assessed on non-collector transfers and
the pair isn't a fee collector — a compliant fund share needs a permissioned-transfer design that
isn't obvious from the docs. Clearer docs on KYC-token + AMM interaction, and on custom-fee
exemptions, would save a lot of time.
```

> Note : si le formulaire affiche le **même bloc par-prix** pour *Tokenization on Hedera*, réutilise
> le même texte mais pointe le permalink vers la ligne **KYC** (`#L292`) — c'est l'argument le plus
> fort pour cette track.

#### Which other partners' technologies have you used? (multiselect, hors prix)
Sélectionne **SaucerSwap** s'il est listé (marché secondaire — tu ne postules pas à son prix). Sinon
laisse vide (champ optionnel ; Privy/ENS non utilisés).

### 4.9 Video
Upload/lien de la vidéo §3. Re-vérifie : 2–4 min, ≥720p, voix claire, **pas accélérée**.

### 4.10 Future (roadmap)
```
Real per-network reward-routing integrations (Helium, Render, io.net) replacing the simulated reward
source; an HIP-1215 keeper to automate reward sweeps; a redemption queue/epoch model for when a pool
is fully deployed; a custom fractional protocol fee via a permissioned-transfer token design (a plain
HTS fractional fee currently breaks redeem and the AMM on a KYC-gated token); a stablecoin
denomination option; and more categories and finer risk classes.
```

---

## 5. Q&A juges — réponses prêtes (condensé)

> Version longue → [`docs/DEMO.md`](DEMO.md) §6.

- **« How does the operator actually repay? »** → Device-NFT escrow: whoever controls the NFT
  controls the reward stream (Helium recipient/destination model). In the demo a stand-in reward
  source simulates it; in prod a relayer bridges the reward token to HBAR and calls `settleRewards`,
  cadenced by an HIP-1215 keeper. Only residual trust = custody of the bridged HBAR.
- **« Per-deal vs per-pool APR? »** → APR is per deal (advance/expected/term). The pool's NAV is the
  *blended realized* return across all deals, accrued amortized-cost; the risk class is the admin's
  risk-and-return curation.
- **« What on default? »** → `markDefault` writes the remaining carry down → NAV falls, loss shared
  pro-rata; escrowed device-NFT is retained/liquidated. Demo: NAV 1.16 → 0.80.
- **« Is the share really tokenized and transferable? »** → Yes — a fungible HTS token, KYC-gated,
  redeemable at NAV anytime, plus a live SaucerSwap secondary.
- **« Where are the custom fees / dividends the bounty mentions? »** → Wafer is an *accumulating*
  fund: yield compounds into NAV rather than being distributed, so holders realize gains at
  redeem/secondary sale (like an accumulating ETF). A custom fractional protocol fee is on the
  roadmap — on a KYC-gated HTS token a plain fractional fee breaks redeem and the AMM, so it needs a
  permissioned-transfer design.
- **« Security? »** → ReentrancyGuard + CEI everywhere, `settleRewards` gated by claim and capped at
  `expected`, Ownable2Step + timelock on finance/default, operator allowlist, dead-shares
  anti-inflation seed, uint256 accounting. Adversarial review run and fixed.

---

## 6. Liens live (à montrer / coller)

- **Vault (HashScan) :** https://hashscan.io/testnet/contract/0x9b8752C8a7131529E5DA8Fb6EDcaDA9097FaD244
- **Sourcify (verified) :** https://repo.sourcify.dev/contracts/full_match/296/0x9b8752C8a7131529E5DA8Fb6EDcaDA9097FaD244/
- **Pool-share (HTS) :** https://hashscan.io/testnet/token/0.0.9228636 · **Claim-NFT :** https://hashscan.io/testnet/token/0.0.9228637
- **SaucerSwap pair share/WHBAR :** https://hashscan.io/testnet/contract/0x22CD5257e92Ca96186cA904780B72C965ba426B1
- Vault id `0.0.9228634` · operator `0.0.9185964` (`0xf6fAc89C…`)

---

## 7. Checklist finale avant submit

- [ ] **GitHub public** (la track l'exige : repo public, commits fréquents, version control).
- [ ] **Vidéo** uploadée + lien dans « demonstration link » et « Video » (2–4 min, ≥720p, voix, non accélérée).
- [ ] **Short description** collée (≤100, vérifiée).
- [ ] **Description** + **How it's made** collées (≥280 chacune).
- [ ] **Tech stack** : tous les selects requis (*) remplis (n'oublie pas Databases* + Design tools*).
- [ ] **AI tools** collé.
- [ ] **Logo** (favicon-512) + **Cover** (hero mockup) + **≥3 screenshots** uploadés.
- [ ] **Prizes** : Hedera overall + Tokenization on Hedera cochés.
- [ ] App qui tourne (`cd web && pnpm dev`) + onglets HashScan/Sourcify prêts pour la présentation live.
- [ ] Balance testnet > 100 HBAR si tu comptes lancer `pnpm run smoke` en live.
