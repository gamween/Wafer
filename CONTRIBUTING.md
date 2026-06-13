# Contributing to Wafer

We're a small team building under a 36h clock. The rules below keep `main` green and the
history readable while we move fast and in parallel.

## Branching (trunk-based, short-lived branches)

`main` is always deployable/demoable. Never commit directly to `main` — branch, PR, merge.

Branch names: `type/short-kebab-summary`

| Prefix | For |
|---|---|
| `feat/` | a new capability (`feat/deposit-redeem-flow`) |
| `fix/` | a bug fix (`fix/nav-rounding`) |
| `refactor/` | restructuring without behaviour change |
| `chore/` | tooling, config, deps |
| `docs/` | docs/specs only |
| `spike/` | throwaway exploration (`spike/saucerswap-listing`) |

Keep branches short-lived (hours, not days). Rebase on `main` before opening the PR.

## Commits (Conventional Commits)

`type(scope): imperative, lowercase summary`

```
feat(vault): mint pool shares on USDC deposit
fix(nav): clamp accretion fraction to the claim term
docs(tracks): add Privy integration plan
chore(ci): add typecheck workflow
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `build`, `spike`.
Scopes we use: `vault`, `hedera`, `nav`, `api`, `agent`, `web`, `scripts`, `docs`.

Small, focused commits. Don't mix a rename with a feature.

## Pull requests

1. Push your branch and open a PR against `main` (`gh pr create`).
2. Fill the PR template (what, which sponsor track, how to test).
3. At least **one teammate review** before merge (skip only for trivial docs/chore if the team agrees).
4. **Squash-merge** and delete the branch (`gh pr merge --squash --delete-branch`).
5. Keep PRs small — easier to review at 3am.

`main` must stay green: `pnpm typecheck` passes before merge.

## Staying in sync

- `git pull --rebase` before you start and before you push.
- Push often (at least at every working checkpoint) so teammates see your work.
- **Never** force-push `main`. Force-push only your own feature branch, with `--force-with-lease`.
- Don't commit secrets: `.env` is gitignored — only `.env.example` is tracked.

## Tagging the demo

When a state is demo-ready, tag it: `git tag -a demo-rN -m "..."` and push tags. The judging
build runs from a tag, not from a mid-refactor `main`.
