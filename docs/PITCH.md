# Wafer — Runbook de présentation live (ETHGlobal NY 2026)

> **À quoi sert ce fichier.** Le script de ta **présentation en direct**, en 2 temps :
> **(1) le deck** (`WaferPres.pdf`, 7 slides) — où tu prends le temps d'**expliquer simplement** —
> puis **(2) le front** (l'app live déployée). Les *consignes* sont en français ; ce que tu *dis aux
> juges* est en **anglais**, prêt à lire.
>
> Track : **Hedera (main, $15 000)** + **Tokenization on Hedera ($3 000)**.
> Objectif n°1 : **qu'un juge qui ne connaît pas le DePIN comprenne en 2 minutes.**

---

## 0. Le pitch en une phrase (à mémoriser)

> **Wafer is InfraFi: a KYC-gated, NAV-appreciating tokenized credit fund on Hedera that advances
> HBAR to DePIN operators against their future on-chain rewards — and you watch NAV tick up live as
> those rewards stream back in.**

Le **wow** (à dire lentement, c'est l'idée qui gagne la track) :
> **DePIN is the one real-world asset whose cashflow is *natively* on-chain. So repayment needs zero
> trust in a human paying back — the hardware itself routes its rewards to the vault, and NAV rises
> on its own.**

Positionnement : *« Centrifuge / Maple, but specialized for DePIN reward streams, fully on Hedera. »*

---

## 1. Plan (2 temps, ~5 min) + règles de clarté

| Temps | Support | Ce que ça prouve | Durée |
|---|---|---|---|
| **1. Le DECK** | `WaferPres.pdf` (7 slides) | Le **pourquoi** + le **comment**, expliqués simplement | ~2:30 |
| **2. Le FRONT** | L'app déployée (Vercel) | C'est **réel, fini, utilisable** | ~2:00 |

**3 règles pour qu'ils comprennent (tiens-les toute la prés) :**
1. **Une idée par slide.** Ne lis pas la slide — dis l'idée avec **tes mots**, puis avance.
2. **Une analogie par concept abstrait.** À chaque mot crypto (NAV, escrow, HTS…), ajoute tout de
   suite l'image du quotidien. *Le juge retient l'image, pas le jargon.*
3. **Reviens toujours au fil rouge :** l'opérateur a besoin de cash maintenant → le pool l'avance →
   **le matériel rembourse tout seul** → le NAV (la valeur de la part) monte. Tout ramène à ça.

---

## 2. TEMPS 1 — Le DECK (expliqué à fond, slide par slide)

> **Comment présenter le deck :** lentement, une idée à la fois. Le deck doit poser **l'histoire** ;
> la démo prouvera que c'est réel. Pour chaque slide ci-dessous : ce qui est **à l'écran**, ce que tu
> **dis** (anglais), et l'**image simple** à donner si tu vois un juge décrocher.

### Slide 1 — Title · *Wafer — InfraFi liquidity for DePIN — on Hedera.*
**Dis :**
> « Hi, we're Wafer. Quick context first: **DePIN** means decentralized physical infrastructure —
> real hardware, like GPUs for AI, wireless hotspots, or mapping cars, that earns crypto rewards for
> doing useful physical work. We built a tokenized credit fund on Hedera that **finances that
> hardware**. Let me show you the problem we solve. »

🟢 *Image simple :* « DePIN = real machines earning crypto. We fund the machines. »

### Slide 2 — Problem · *DePIN operators buy hardware today, earn rewards over months.*
**Dis :**
> « Here's the pain. An operator buys, say, five thousand dollars of Helium hotspots **today** — but
> the rewards only trickle in **over a year**. That's a timing gap: they need capital now, and they
> don't have it. And no bank will lend to them — a bank has no idea how to underwrite 'a stream of
> crypto rewards from a wireless hotspot.' So the capital that would let DePIN scale just isn't there. »

🟢 *Image simple :* « You pay for the machine now, it pays you back slowly. Banks can't help. »

### Slide 3 — Solution · *Financing layer, not an operator.*
**Dis :**
> « Wafer sits in the middle of a two-sided market. On one side, **investors** who want yield: they
> put HBAR into a pool and get a tokenized fund share back. On the other side, **operators** who want
> cash now: they sell a slice of their future rewards and get HBAR today. We never run any hardware
> ourselves — we're purely the financing layer. Think of us as a **credit fund** — Centrifuge or
> Maple — but specialized for DePIN. »

🟢 *Image simple :* « Investors lend, operators borrow, Wafer is the fund in the middle. »

### Slide 4 — WoW Effect · *(LE slide. Ralentis. C'est ici que tu gagnes la track.)*
**Dis (prends 30–40 s, c'est le cœur) :**
> « Now, *why is DePIN special* for a credit fund? Every other real-world asset — an invoice, a
> mortgage — needs a **human or a bank to actually pay you back**. That's the risk: someone might not
> pay. DePIN is different: **its cashflow is born on-chain**. The hardware earns rewards
> automatically, on-chain, forever — no invoice, no bank, no fiat.
>
> And here's the mechanism that makes it bulletproof. On a network like Helium, **every device is an
> NFT, and that NFT decides where its rewards get deposited.** So the operator hands that device-NFT
> to our vault as collateral — and now **the vault controls where the rewards go**. It's exactly like
> signing over the direct-deposit of your paycheck to your lender: the operator literally *can't*
> redirect the money, because the code holds the key. **Repayment needs no trust in a human paying** —
> the machine pays the vault, and the fund's value ticks up live. »
>
> *(Honnêteté à dire — ça inspire confiance) :* « The one piece we still trust off-chain is a relayer
> that swaps the reward token into HBAR at the moment of payout. That's the only residual trust:
> custody of the bridged HBAR for that instant — and we're upfront about it. »

🟢 *Image simple :* « The device-NFT = the direct-deposit slip for the rewards. We hold it, so the
machine pays us automatically. »

### Slide 5 — How it works (lifecycle) · *propose → class → finance → rewards → repaid/default*
**Dis :**
> « The full lifecycle, five steps. **One** — an operator proposes a deal: 'advance me 9 HBAR against
> 10 of future rewards.' **Two** — an admin assigns a risk class, like an underwriter rating it A, B,
> or C. **Three** — the pool finances it: it advances the HBAR and mints a **claim NFT**, an on-chain
> receipt of the loan held by the vault. **Four** — the rewards stream back in, and the pool's **NAV**
> — the value of one fund share — ticks up. **Five** — full repayment **burns** the receipt NFT; a
> **default** writes the NAV **down**, and the loss is shared fairly across everyone in the pool, like
> a fund taking a loss. Investors can redeem at NAV anytime, or sell on SaucerSwap. »
>
> *(Si on te demande « what's NAV? ») :* « NAV is net asset value — the value of one share, like an
> ETF's price. It starts at 1.0; as rewards come in, it goes to 1.1, and that's your yield, live. »

🟢 *Image simple :* « It's a fund. The share value goes up as the loans get repaid, down if one defaults. »

### Slide 6 — Why Hedera / HTS · *compliant fund unit, native services*
**Dis :**
> « Why Hedera specifically. The fund share isn't a hand-rolled token — it's a native **Hedera Token
> Service** token, and its **KYC and freeze controls are held by the vault contract itself**, with no
> off-chain signer. That means it's a **compliant fund unit at the protocol level** — exactly what a
> tokenized security needs. The loan receipt is a native NFT. Settlement is in **native HBAR** —
> three-second finality, fees in cents. We read all the live data from the **Mirror Node**, the
> secondary market is **SaucerSwap**, and the contract is **Sourcify-verified**. And we use a second
> native service — **Scheduled Transactions, HIP-1215**: the advance is a *locked transfer the Hedera
> network itself releases on a schedule*, with no bot, no keeper. »

🟢 *Image simple :* « The fund share IS a Hedera token, with compliance built into the chain — not bolted on. »

### Slide 7 — What's live · *(transition vers l'app)*
**Dis :**
> « And none of this is a mockup. The vault is **live on Hedera Testnet and Sourcify-verified**. The
> entire lifecycle is proven on-chain — finance, reward stream, NAV up, repaid-and-burn, and a default
> write-down. The SaucerSwap pair is live. So let me stop talking and **show you the real app.** »

🟢 *Image simple :* « Everything I just described is deployed and working. Here it is. »

> *(Slide roadmap, seulement si on te le demande en Q&A) :* real per-network reward routing
> (Helium/Render/io.net) replacing the simulated cashflow · redemption epochs · a compliant custom
> fee (permissioned-transfer design) · stablecoin denomination · more categories & risk classes.

---

## 3. TEMPS 2 — Le FRONT (l'app live, déployée)

> **But :** montrer un **produit fini**. Idéalement l'URL **Vercel** publique (sinon `cd web && pnpm
> dev` — même rendu). Préparé : un pool GPU-A à NAV > 1.00 avec un deal en cours (lance un finance +
> drip avant, ou `pnpm run smoke`, pour que le NAV bouge en live).

**Ouverture :**
> « Same contract, now the product — live and **deployed on Vercel**, anyone can open this URL. It's a
> React app talking to the contract directly through your wallet, reading state from the Hedera Mirror
> Node. No backend server — the smart contract *is* the backend. »

**Parcours (clic par clic, dis une phrase par écran) :**
1. **Landing → How it works** — le hero + la bande 3 étapes. *« The pitch in three steps. »*
2. **Explore / Pools** — KPI row (TVL · Deployed · Idle · Pools · Blended APR) + pool **GPU-A** (NAV,
   TVL, Trailing APR, % deployed). *« The protocol's live state, read straight from the chain. »*
3. **Deposit** — chips **Associated / KYC granted** → montant → **Deposit HBAR** → parts au NAV.
   *« The share is a KYC-gated Hedera token: associate, get allowlisted, deposit, receive fund shares. »*
4. **Operator** — *Propose a deal* + **mint & escrow device-NFT**. *« The operator posts the device-NFT
   as collateral — that's the direct-deposit slip for the rewards I mentioned. »*
5. **Admin** — assign **Class A** + pool → **Approve** → **Finance**. *« Risk class, route to the pool,
   finance — HBAR advanced, claim NFT minted. »*
6. **Explore → Activity** — pointe l'event **"Advance locked (HIP-1215)"**. *« And there's the locked,
   scheduled transfer — the network will release it on its own. »*
7. **NAV monte** (Pool detail / Operator claims) — un drip tombe, auto-refresh. *« Watch the NAV tick
   up — that's the yield, read live from the contract. »*
8. **Redeem** — `Max instant redeem` + notice **instant + FIFO queue**. *« Exit at NAV, instant up to
   the liquidity buffer, the rest fairly queued. »*
9. **Secondary** — **GPU-A / WHBAR — Live pair**, réserves + price + lien HashScan. *« Or sell on a
   live SaucerSwap market — our KYC-gated share against wrapped HBAR. »*

**Clôture :**
> « So: a compliant tokenized fund, financing real-world infrastructure, where the repayment is
> enforced by the chain itself — live on Hedera, deployed, verifiable end to end. Wafer — InfraFi
> for DePIN. Thank you. »

---

## 4. Ce qu'on a construit (à glisser en slide 6/7 et en Q&A)

- **Contrat `WaferVault` (Solidity, HSCS)** — compta **amortized-cost** (NAV dérivé `idle +
  receivable`, tue le double-comptage), workflow propose→approve→finance, file de redemption, défaut.
- **2 tokens HTS** pilotés par le contrat : part de fonds **5 clés** (supply/kyc/freeze/wipe/**pause
  token-level réelle**) + claim-NFT reçu (burné à maturité), + **escrow device-NFT** (collatéral).
- **HIP-1215 / Hedera Schedule Service** (2ᵉ service natif) — **avance verrouillée** auto-libérée par
  le réseau + **settle auto-schedulé**, **sans keeper**.
- **Marché secondaire SaucerSwap** en **un seul appel** contrat.
- **Sécurité + audit adverse multi-agents** corrigé (overflow guard, earmark file senior, fee fantôme,
  surplus sweep, ReentrancyGuard+CEI, Ownable2Step+timelock, dead-shares anti-inflation) · **78 tests**.
- **Livré** : déployé + **Sourcify-verified** + **frontend déployé sur Vercel**.

---

## 5. Q&A juges — réponses prêtes

- **« How does the operator actually repay? »** → Device-NFT escrow: whoever controls the NFT controls
  the reward stream (Helium recipient/destination model). The maturity settle is already scheduled
  on-chain via HIP-1215; in prod a relayer bridges the real reward token to HBAR. Only residual trust
  = custody of the bridged HBAR. *(C'est aussi le cœur de la slide 4 — tu l'as déjà raconté.)*
- **« Per-deal vs per-pool APR? »** → APR is per deal; the pool NAV is the *blended realized* return,
  accrued amortized-cost; the risk class is the admin's risk/return curation.
- **« What on default? »** → `markDefault` writes the remaining carry down → NAV falls, loss shared
  pro-rata; escrowed device-NFT retained/liquidated. Demo: NAV 1.16 → 0.80.
- **« Is the share really tokenized & transferable? »** → Yes — a fungible HTS token, KYC-gated,
  redeemable at NAV anytime, plus a SaucerSwap secondary enabled per pool in one contract call.
- **« Where are the custom fees the bounty mentions? »** → Wafer is an *accumulating* fund: yield
  compounds into NAV (like an accumulating ETF). A plain HTS fractional fee on a KYC-gated token
  breaks redeem and the AMM, so a compliant take-rate needs a permissioned-transfer design — roadmap.
- **« Security? »** → ReentrancyGuard + CEI everywhere, `settleRewards` gated by claim & capped at
  `expected`, Ownable2Step + timelock, operator allowlist, dead-shares seed, int64 overflow guards,
  real token-level pause. A two-phase adversarial review was run and fixed.

---

## 6. Liens live (à montrer / coller) — déploiement 2026-06-14

> ⚠️ Adresses à jour (HEAD `a4ef16e`). L'ancien vault `0x9b8752…` est mort.

- **App déployée (Vercel) :** `[colle l'URL Vercel ici]` *(sinon `cd web && pnpm dev`).*
- **Vault (HashScan) :** https://hashscan.io/testnet/contract/0x4B821d6bC76203C3C21131849C40d04C84bb75d5
- **Sourcify (verified) :** https://repo.sourcify.dev/contracts/full_match/296/0x4B821d6bC76203C3C21131849C40d04C84bb75d5/
- **Pool-share (HTS) :** https://hashscan.io/testnet/token/0.0.9231169 · **Claim-NFT :** https://hashscan.io/testnet/token/0.0.9231170
- **SaucerSwap pair :** https://hashscan.io/testnet/contract/0x4B6dEAcA611177F74433A57A3bF6f9b1b95BC182
- Vault id `0.0.9231166` · operator `0.0.9185964` (`0xf6fAc89C…`) · GitHub `github.com/aiden-fianso/Wafer`

---

## 7. Checklist avant de présenter

- [ ] **App ouverte** : URL Vercel (ou `cd web && pnpm dev`) + MetaMask sur Hedera Testnet (296),
      compte operator `0xf6fAc89C…`.
- [ ] **Pool « vivant » pré-chargé** : NAV > 1.00 + un deal en cours + l'event **"Advance locked
      (HIP-1215)"** dans Explore → Activity. *(Si le pool est « usé » — NAV < 1 — redéploie frais :
      `pnpm run deploy` puis `pnpm run smoke` pour le bel arc 1.0 → 1.1.)*
- [ ] **Onglets prêts** : deck `WaferPres.pdf` · l'app · **HashScan du vault** · **Sourcify verified**.
- [ ] **Répété le deck à voix haute** : une idée/slide, une analogie/concept, et la slide 4 (le wow)
      racontée *lentement*. 2 temps : deck (~2:30) → front (~2:00).
