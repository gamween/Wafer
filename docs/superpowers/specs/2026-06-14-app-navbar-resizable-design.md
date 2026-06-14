# Spec — Navbar resizable (Aceternity) sur la page app, fond noir

Date : 2026-06-14
Périmètre : **page app uniquement** (shell connecté de `web/src/App.jsx`, lignes ~200-244).
La landing (Hero / HowItWorks) n'est **pas** touchée.

## Objectif

Remplacer la navbar actuelle de l'app (`CardNav`) par le composant Aceternity
**`resizable-navbar`** (collé par l'utilisateur), sur un **fond noir uni**, en
gardant les écrans existants accessibles dessous.

## Décisions (validées avec l'utilisateur)

1. **Intégration** : ajouter Tailwind v4 + lib `motion` (composant Aceternity fidèle),
   plutôt que réécrire en CSS pur.
2. **Portée** : navbar + fond noir seulement. Les écrans (Pools, Dashboard, …) restent
   en place. Boutons conservés mais ré-stylés à la DA.
3. **Liens nav** : sections réelles de l'app.
4. **Operate / Admin** : items conditionnels en plus (comme dans `CardNav`).
5. **Process** : spec court + commit, puis implémentation directe.

## Stack & infra (risque faible pour le CSS existant)

- Dépendances : `tailwindcss@4`, `@tailwindcss/vite`, `motion`, `clsx`, `tailwind-merge`.
- **Préflight Tailwind désactivé** : on importe seulement les layers `theme` + `utilities`
  (pas le reset `base`). Comme `App.css` n'est pas « layered », il gagne la cascade →
  aucune régression sur les écrans existants. Les utilitaires Tailwind ne servent que
  dans la navbar.
- Alias `@/` → `/src` dans `vite.config.js` (+ `jsconfig.json` pour l'éditeur).
- Variante `dark` Tailwind v4 via `@custom-variant dark (&:where(.dark, .dark *))` ;
  classe `dark` posée sur le shell.

## Fichiers

- **Nouveau** `web/src/index.css` — imports Tailwind (layers theme+utilities, pas de
  preflight) + `@custom-variant dark`. Importé dans `main.jsx` **avant** `App.css`.
- **Nouveau** `web/src/lib/cn.js` — utilitaire `cn(...)` (clsx + tailwind-merge).
- **Nouveau** `web/src/components/ui/resizable-navbar.jsx` — portage JSX du composant
  Aceternity. Adaptations :
  - `motion/react` (au lieu de framer-motion), `cn` depuis `@/lib/cn` ;
  - icônes menu/X en **SVG inline** (pas de `@tabler/icons-react`) ;
  - `NavItems` : items `{ name, onClick }`, navigation SPA (appelle `item.onClick`
    puis `onItemClick` pour fermer le menu mobile) ;
  - `NavbarLogo` : marque Wafer (glyph + wordmark), `onClick` → home ;
  - `NavbarButton` : variantes conservées, primary = amber `--amber`.
- **Modifié** `web/vite.config.js` — plugin `@tailwindcss/vite` + alias `@`.
- **Nouveau** `web/jsconfig.json` — `paths` `@/*` → `src/*`.
- **Modifié** `web/src/App.jsx` — shell connecté : remplace `<CardNav>` et la
  `.shell-topbar` flottante par une seule `<Navbar>`. Items :
  - Pools → `pools`, Portfolio → `dashboard`, Redemption queue → `queue`,
    Secondary → `secondary`, Activity → `activity` ;
  - + `Operate` si `isOperator || isOwner` → `operator` ;
  - + `Admin` si vue admin → `admin`.
  - Côté droit : pill **« Hedera Testnet »** (secondary) + `AccountMenu` existant.
  - Classe `dark` + fond noir sur le shell.
- **Modifié** `web/src/App.css` — `.shell` en `#000` uni (suppression du dégradé
  radial bleu), `padding-top` du contenu ajusté pour la navbar sticky. Grain mis de
  côté sur le shell pour l'instant.

## Hors périmètre

- Landing page (Hero, HowItWorks) inchangée.
- Écrans (Pools, Dashboard, RedemptionQueue, …) inchangés.
- `CardNav.jsx` / `CardNav.css` restent dans le repo (plus utilisés sur le shell) ;
  suppression éventuelle plus tard.

## Vérification

- `pnpm build` sans erreur.
- Dev : navbar visible, fond noir, items câblés sur les onglets, menu compte
  fonctionnel, rétrécissement au scroll, menu mobile.
- Écrans existants toujours rendus correctement (pas de régression de style).
