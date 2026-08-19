# GalaQuest public development workflow

This workflow applies to the public active repository. It is deliberately recoverable from public Git history and GitHub state; private archive files are not required reading for ordinary public work.

## Start from live authority

1. Orient from the current checkout with the commands in `AGENTS.md`.
2. Confirm the repository is `Galashots/galaquest-public`, refresh public `main`, and record the exact starting SHA.
3. Read `AGENTS.md`, then only the public authorities relevant to the task (`docs/MISTAKES.md`, visual/pipeline docs, tests, workflows, contracts).
4. Refresh live GitHub branch/PR/CI state before trusting a handoff or prior chat report.
5. Run the relevant baseline tests from the checkout when execution is available. Record actual results, not remembered counts.

Do not recursively search the machine for another checkout when the intended repository is not already known.

## One bounded task, one public branch/PR

- Branch from current public `main`; use one coherent task per branch and pull request.
- Do not push directly to `main` or rewrite shared history.
- Commits should separate generated/public assets from runtime logic when practical.
- A worker brief or issue may define file ownership, scope, acceptance seams, and stop conditions, but the public GitHub diff and exact SHA remain the state under review.
- Do not silently expand scope. New product decisions or owner-only transitions remain owner-controlled.

## Evidence and acceptance

Every material claim identifies the exact public SHA it proves.

For behaviour changes:
- establish a red-capable reproduction or test before accepting a causal theory when practical;
- prefer the smallest causal fix;
- do not weaken product behaviour, prediction constants, thresholds, or tests merely to satisfy hosted CI;
- rerun the affected local and hosted evidence after the fix.

For player-visible changes:
- inspect the running game personally;
- automated browser/runtime checks prove behaviour but do not visually accept appearance;
- use reference images before deriving visual conventions;
- machine measurements may reject a result but human running-game inspection is required for visual acceptance.

A missing artifact, missing hosted run, or unverified runtime surface is **UNKNOWN**, not inferred PASS.

## Private-source safe ports

Private GalaQuest material is source/provenance only unless explicitly being inspected for a bounded safe port.

Use this sequence:

`inspect private source once -> define exact public-safe file/behaviour surface -> implement/port in public -> test public -> bind acceptance to public SHA`

Do not maintain duplicate active implementations. Do not bulk-merge private PRs into public. Third-party/franchise-inspired private gear stays private.

The current PR #11 safe-port order and locked sword placement rule are defined in `AGENTS.md`.

## Hosted CI and diagnostics

The checked-in files under `.github/workflows/` are the workflow authority. For hosted failures, inspect the exact workflow definition, run metadata, jobs, logs, and artifacts before assigning cause.

Maintenance warnings from Actions/runtime versions may be repaired separately, but they are not a substitute explanation for gameplay failures.

## End a task by fixed point

Before handing off or asking for merge/review:

1. Run the relevant test suite/harnesses and record their actual outcome.
2. Push the task branch and refresh the remote head SHA.
3. Check exact-head hosted CI where it is part of acceptance.
4. Review the session for a reusable new failure mode. Update `docs/MISTAKES.md` or another public runbook only when a genuinely new durable lesson was learned; do not duplicate existing rules.
5. Hand off by public branch/PR, exact SHA, evidence paths/run IDs, and explicit gate states: **PASS / FAIL / UNKNOWN**.

Do not merge, close, promote, spend provider credits, or make other owner-only transitions unless explicitly authorized.
