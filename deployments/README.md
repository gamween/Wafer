# deployments/

Public, committed record of the live Hedera Testnet resources created by `pnpm bootstrap`.

- `testnet.json` — token ids, topic id, vault + demo-investor account ids, and HashScan links
  for the current demo pool. Written and kept up to date by `scripts/bootstrap.ts`.

Only **public ids** live here — never private keys. A clean clone reads this file (and the
gitignored `.env`) to know which live pool to talk to. `bootstrap` is idempotent: it reuses
ids already present here / in `.env` instead of creating duplicates.
