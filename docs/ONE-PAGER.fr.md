# Wafer

> Liquidité InfraFi pour le DePIN, sur Hedera. Du capital investisseur poolé finance les futurs
> rewards on-chain des opérateurs DePIN contre des HBAR immédiats ; les investisseurs détiennent une
> part de pool KYC-gated qui s'apprécie au NAV — un fonds de crédit court terme tokenisé.
> Hedera Testnet (chain 296) · track visée : **Hedera Tokenization** · EN : [`ONE-PAGER.md`](ONE-PAGER.md).

## Problème

Les opérateurs DePIN (GPU/compute, wireless, mapping, énergie, stockage) doivent acheter du hardware
**aujourd'hui** pour gagner des rewards protocolaires sur **plusieurs mois**. Ce décalage de
trésorerie, c'est du capital qu'ils n'ont pas — et le crédit classique ne sait pas adosser un flux
de rewards on-chain.

## Ce qu'est Wafer

Une **couche de financement, pas un opérateur.** Wafer ne fait jamais tourner de nodes et ne prend
aucune position dans les réseaux DePIN. Les opérateurs qui gagnent **déjà** des rewards on-chain
viennent chez Wafer pour du cash immédiat contre ces rewards futurs ; les investisseurs fournissent
ce cash via des pools et en touchent le rendement. Pensez Centrifuge / Maple, spécialisé pour les
flux de rewards DePIN.

## Deux faces

- **Investisseurs** : financent une **pool** (catégorie × classe de risque, ex. `GPU-A`) et
  reçoivent une **part de pool** fongible, **KYC-gated**, qui s'apprécie au NAV. Exposition
  **diversifiée sur tous les deals de la pool** — on achète la pool, pas un deal. Redeem au NAV.
- **Opérateurs** : proposent un **deal** (entreprise, description, avance, remboursement, maturité,
  catégorie). Un **admin** review et attribue une **classe de risque** (en pesant risque *et* APR
  proposé) → la pool correspondante **finance** : avance des HBAR + mint un **NFT de créance**
  détenu par le vault.

## Pourquoi le wow, c'est DePIN

DePIN est la seule catégorie RWA dont le cashflow est **nativement on-chain** : le hardware gagne
des rewards automatiquement sur une adresse on-chain — pas de facture, pas de banque, pas de pont
fiat. Le remboursement **n'exige aucune confiance dans un humain qui paie** : l'opérateur **route
son flux de rewards vers le vault** pour la durée (redirection d'adresse de payout, escrow du
device-NFT, ou keeper autorisé), et **le NAV monte en live** à mesure que les rewards tombent. Tout
dans Wafer est de la vraie logique on-chain ; **seul le cashflow de rewards de l'opérateur est
simulé** en démo (une source de rewards de substitution) — le mécanisme de routage est réel, on ne
peut juste pas brancher un réseau DePIN live pendant un hackathon.

## Économie

Chaque deal porte sa propre avance / remboursement attendu / maturité → son **propre APR**. Le NAV
de la pool est le **rendement réalisé et blended** de tous ses deals (moins les défauts), accru en
**amortized-cost** — les écarts d'APR par deal deviennent un seul rendement de pool diversifié. La
classe de risque est la **curation risque-et-rendement** de l'admin, pour que chaque pool ait un
profil cohérent.

## Cycle de vie

1. L'opérateur propose un deal.
2. L'admin review + attribue une classe → route vers la pool correspondante.
3. La pool **finance** : avance des HBAR, mint le NFT de créance — le **reçu on-chain** (l'état
   économique vit dans le contrat ; l'affichage off-chain via Mirror Node).
4. Les rewards **arrivent** → le NAV de la pool monte vers le remboursement attendu.
5. Remboursement complet → le **NFT burn**. Défaut → **write-down** (le NAV baisse), perte partagée
   sur la pool.
6. Les investisseurs détiennent / **redeem au NAV** en continu.

## Stack Hedera

- **Token de parts HTS fongible** (clés KYC + freeze détenues par le vault, petite fee fractionnaire) — l'unité de fonds tokenisée.
- **NFT de créance HTS** — le reçu on-chain de chaque deal financé, détenu par le vault, burn à maturité.
- **Contrat `WaferVault`** (HSCS, via `@hiero-ledger/hiero-contracts`) — pools, financement, NAV
  amortized-cost, deposit/redeem, settlement des rewards, défaut. **HBAR natif**.
- **Mirror Node** — le front lit NAV/pools/deals/activité (termes des deals émis en events). Vérifié Sourcify.

## Roadmap

Intégrations réelles de routage de rewards par réseau (Helium, Render, io.net…) · marché secondaire
sur **SaucerSwap** (part / WHBAR) pour une sortie instantanée · **file / epoch** de redemption quand
une pool est entièrement déployée · option de dénomination en stablecoin · plus de catégories et de
classes plus fines.

## Démo

Finance `GPU-A` en HBAR → parts au NAV. L'admin finance un deal DePIN (avance + NFT). Des rewards
HBAR arrivent dans le vault → **le NAV monte en live**. Le NFT burn au settlement. L'investisseur
redeem au NAV pour le gain.
