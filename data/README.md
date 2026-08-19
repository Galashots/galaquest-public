# data/

The children's save lives here. This directory is **tracked** by git; its contents (the actual
`.db` files) are **not** -- see `.gitignore`'s `data/*.db*` entry, which covers the main file plus
SQLite's `-wal`/`-shm` sidecar files.

## What's in here

- `rewards.db` -- the real, persistent Lantern Marks store (`net/rewardStore.mjs`), keyed by
  guest id (a client-random token in `localStorage`, no PII). Append-only: every row is one award
  event, never mutated, never deleted. Marks and unlock state are always *derived* by counting rows,
  not stored as a mutable counter -- that is what makes a forced double-apply of the same event a
  true no-op (roadmap "Forward compatibility for XP" ruling).
- `backup-<ISO-stamp>.db` -- a timestamped copy of `rewards.db`, written automatically every time the
  store is opened over an *existing* file (roadmap "Save-data custody" ruling: a backup on server
  start, before anything else touches the file). These accumulate; nothing in this repo prunes them
  automatically yet, so an operator wanting to reclaim space deletes old ones by hand.

## Why this directory exists at all, tracked and empty

So the path `data/rewards.db` is stable and predictable across every machine that runs the server,
without a first-run script having to create the directory (though `net/rewardStore.mjs`'s
`openRewardStore()` also does that defensively via `mkdirSync(..., { recursive: true })`).

## What must never happen

- The real save must never live under `tmp/` or `.local/` -- both are scratch, and both are treated
  as disposable elsewhere in this repo.
- Tests must never open a store at a path under `data/`. Every test in `test/reward-store.test.mjs`
  opens its store under the OS temp dir (`node:os` `tmpdir()`), specifically so a test run can never
  touch, corrupt, or reset a real child's save.
