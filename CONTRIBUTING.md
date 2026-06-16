# Contributing to Wafer

Thanks for your interest. These conventions keep `main` green and the history readable.

## Branching

`main` is always deployable. Branch off `main`, open a PR, and merge — never commit directly to `main`.

Branch names: `type/short-kebab-summary` (e.g. `feat/deposit-redeem`, `fix/nav-rounding`).
Prefixes: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`.

## Commits (Conventional Commits)

`type(scope): imperative, lowercase summary`

```
feat(vault): mint pool shares on HBAR deposit
fix(nav): clamp accretion fraction to the claim term
refactor(web): remove orphaned components
chore(ci): pin the pnpm version
```

Scopes in use: `vault`, `web`, `scripts`, `contracts`, `docs`, `ci`. Keep commits small and focused —
don't mix a rename with a feature.

## Pull requests

1. Push your branch and open a PR against `main` (`gh pr create`).
2. Fill the PR template (what changed, how to test).
3. CI must be green — `compile` · `typecheck` · the 78 pure-logic tests · web build.
4. Squash- or merge-commit, then delete the branch.

## Hygiene

- Never commit secrets — `.env` is gitignored; only `.env.example` is tracked.
- `git pull --rebase` before you start; never force-push `main`.
- Update `SPEC.md` / `README.md` when on-chain behaviour changes.
