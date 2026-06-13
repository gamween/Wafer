# Wafer — One-pager (brouillon de travail, en alignement — non figé)

> Liquidité InfraFi pour le DePIN, sur Hedera. Du capital investisseur poolé finance des deals
> curés ; les remboursements font monter la NAV. Settlement : HBAR natif (testnet) — cible
> production : USDC. Track visée : Hedera Tokenization. Version EN : [`ONE-PAGER.md`](ONE-PAGER.md).

## L'idée

Les opérateurs DePIN (compute/GPU, wireless, mapping, énergie) doivent acheter du hardware
aujourd'hui pour gagner des rewards on-chain sur plusieurs mois. Wafer finance ce trou de
trésorerie et le transforme en **part de fonds liquide qui s'apprécie (NAV)**. DePIN est la
catégorie phare ; les mêmes rails financent n'importe quel deal avec une avance, un remboursement
et une maturité.

## Deux faces (modèle Centrifuge / Maple)

- **Investisseurs** : déposent des HBAR dans une pool (par catégorie + classe de risque, ex.
  `GPU-A`) et reçoivent une **part de pool** fongible qui s'apprécie au NAV. Redeem au NAV à tout
  moment. Exposition **diversifiée sur tous les deals de la pool** — un fonds de crédit court terme
  tokenisé. On ne choisit pas un deal ; on achète la pool.
- **Boîtes** (opérateurs DePIN d'abord) : **proposent un deal** — entreprise, description, avance,
  remboursement, maturité, catégorie. Un **admin** review et attribue une **classe de risque** →
  la pool correspondante **finance** (avance des HBAR + mint un NFT de créance détenu par le vault).

Les « deals » vivent donc côté **offre** (ce que la pool finance), curés par l'admin. Les
investisseurs financent la **pool**, pas un deal individuel. (Le backing deal-spécifique = tranches
junior à la Goldfinch — option V2, voir plus bas.)

## Pourquoi le wow, c'est DePIN

DePIN est la seule catégorie RWA dont le cashflow est **nativement on-chain** : du vrai hardware
gagne des rewards protocolaires automatiquement, sur une adresse on-chain — pas de facture, pas de
banque, pas de pont fiat. Le remboursement **n'exige aucune confiance dans un humain qui paie** ni
settlement off-chain : l'opérateur **route son flux de rewards on-chain vers le vault** pour la
durée, et **la NAV monte en live** à mesure que les rewards tombent. (Les deals non-DePIN
remboursent par un envoi on-chain — mêmes rails, story de confiance plus faible. DePIN, c'est là
que le modèle est trust-minimized.)

## Cycle de vie

1. Une boîte propose un deal (intake off-chain).
2. L'admin review + attribue une classe → route vers la pool correspondante.
3. La pool **finance** : avance des HBAR à la boîte, mint le NFT de créance (détenu par le vault).
4. Le **remboursement** arrive — routage de rewards DePIN ; en plusieurs versements ou en lump →
   la **NAV monte**.
5. Au remboursement complet, le **NFT burn** (créance Repaid). En cas de défaut → **write-down**
   (la NAV baisse), perte partagée sur la pool.
6. Les investisseurs détiennent / redeem leurs parts au NAV en continu ; marché secondaire sur
   SaucerSwap (part / WHBAR).

## Stack Hedera

- **Token de parts HTS fongible** (clés KYC + freeze, petite fee fractionnaire) — l'unité de fonds tokenisée.
- **NFT de créance HTS** — la trace on-chain de chaque deal financé, détenu par le vault.
- **Contrat `WaferVault`** (HSCS, via `@hiero-ledger/hiero-contracts`) — pools, financement, NAV,
  deposit/redeem, settlement, défaut. Settlement en **HBAR natif**.
- **SaucerSwap** — marché secondaire (part / WHBAR).
- Live sur testnet : vault `0xc452D23791F9fC0c43B82E298b337B0A3525cd0A`, pool GPU-A, vérifié Sourcify.

## Ouvert / à affiner (non figé)

- **Liquidité :** parts élastiques (mint au dépôt / burn au redeem). Redemptions servies depuis les
  HBAR oisifs ; quand la pool est entièrement déployée, **file / epoch** de redemption (façon
  Centrifuge / Maple).
- **Backing deal-spécifique (V2) :** **tranches** à la Goldfinch — back un deal en junior /
  first-loss vs la senior pool diversifiée — si on veut une vraie expo « j'investis dans ce deal ».
- **Asset de settlement :** HBAR pour le MVP testnet ; **USDC** la cible prod (dénomination stable).
- **Confiance du remboursement :** DePIN = routage de rewards on-chain (trust-minimized) ; autres
  catégories = envoi on-chain (testnet) / escrow-SPV (prod).
- **Propositions :** intake off-chain + enregistrement on-chain du deal à l'approbation admin
  (métadonnées off-chain).

## Démo

Dépose des HBAR → parts au NAV. L'admin finance un deal DePIN (avance + NFT). Des rewards HBAR
streament vers le vault → **la NAV monte en live**. Le NFT burn au settlement. L'investisseur
redeem au NAV pour le gain. Swap secondaire sur SaucerSwap comme sortie alternative.
