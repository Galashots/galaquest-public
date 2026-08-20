# GalaQuest public development workflow

This workflow applies to the public active repository. It is deliberately recoverable from public Git history and GitHub state; private archive files and prior chats are not required reading for ordinary public work.

## Start from live authority

1. Orient from the current checkout with the commands in `AGENTS.md`.
2. Confirm the repository is `Galashots/galaquest-public`, refresh public `main`, and record the exact starting SHA.
3. Read `AGENTS.md`, then only the public authorities relevant to the task (`docs/GUIDANCE.md`, `docs/MISTAKES.md`, visual/pipeline docs, tests, workflows, contracts).
4. Refresh live GitHub branch/PR/CI/deployment state before trusting a handoff or prior chat report.
5. Run the relevant baseline tests from the checkout when execution is available. Record actual results, not remembered counts.

Do not recursively search the machine for another checkout when the intended repository is not already known.

## One coherent objective per public branch/PR

- Branch from current public `main`; use one coherent product objective per branch and pull request.
- Do not push directly to `main` or rewrite shared history.
- Small tasks should stay small. Commits should separate generated/public assets from unrelated runtime logic when practical.
- A worker brief or issue may define file ownership, scope, acceptance seams, and stop conditions, but the public GitHub diff and exact SHA remain the state under review.
- Do not silently expand scope. New product decisions or owner-only transitions remain owner-controlled.

### Large PRs are reviewed by checkpoint, not by wishful thinking

When the owner explicitly chooses a long-running, larger PR, keep the **product objective singular** even if implementation spans many commits.

- Publish exact-SHA checkpoints that are runnable and reviewable on their own.
- At each checkpoint, run the required unit gate plus the evidence relevant to the surface changed so far.
- Review findings against the checkpoint SHA; do not let later commits retroactively turn an earlier UNKNOWN into PASS.
- Keep unrelated cleanup out of the branch so incremental review remains meaningful.
- A checkpoint approval is not merge approval. Re-run final-head acceptance after the last change and before merge.

This lets a substantial gameplay vertical be reviewed continuously without splitting one coherent experience into artificial PRs or postponing all scrutiny until the end.

## Evidence and acceptance

Every material claim identifies the exact public SHA it proves.

For behaviour changes:

- establish a red-capable reproduction or test before accepting a causal theory when practical;
- prefer the smallest causal fix;
- do not weaken product behaviour, prediction constants, thresholds, or tests merely to satisfy hosted CI;
- rerun the affected evidence after the fix.

For player-visible changes:

- inspect the running game personally;
- automated browser/runtime checks prove behaviour but do not visually accept appearance;
- use reference images before deriving visual conventions;
- machine measurements may reject a result but human running-game inspection is required for visual acceptance.

A missing artifact, missing hosted run, inaccessible browser surface, or unverified runtime is **UNKNOWN**, not inferred PASS.

## Verification surfaces

Use the cheapest surface that proves the claim, then escalate when the product risk warrants it.

### 1. Required unit gate

```bash
node --test test/*.test.mjs
```

The protected branch requires the hosted `unit` context. The checked-in `.github/workflows/test.yml` is the authority for its runtime version and command. Guidance integrity runs here too, so Markdown-only changes still receive the cheap required gate.

### 2. Local running-game harnesses

`tools/runtime-test/` drives real Chrome over CDP. The harnesses own their isolated runtime server; **do not pre-start `server.mjs` for them unless a specific harness explicitly says otherwise**. Open the produced captures when visual evidence matters.

### 3. On-demand Director relay on a PR

For an exact PR-head browser run in Actions, the repository owner can comment a whitelisted command such as:

```text
/director-playtest lodge
/director-playtest combat
/director-playtest co-op
```

`.github/workflows/director-playtest.yml` is the scenario whitelist and implementation authority. It checks out the actual PR head, runs PR code in a read-only job, uploads evidence, and reports from a separate write-capable job. Do not collapse that security boundary merely to simplify reporting.

### 4. Public hosted playtest

Use the Render instance when a tester has a browser but cannot reach a local machine. Follow `docs/public-playtest.md` and fetch `/source-sha.json` **before** treating the session as evidence for a commit. Per-PR preview instances are opt-in with `[render preview]` in the PR title.

### 5. Full browser matrix

`.github/workflows/full-playtest-matrix.yml` is broad diagnostic coverage, not the protected required gate. It is intentionally more expensive and historically noisier than `unit`; use it when the changed surface warrants broad browser coverage and interpret failures from the exact run rather than from remembered pass counts. Markdown-only diffs skip this matrix by design.

## Private-source safe ports

Private GalaQuest material is source/provenance only unless explicitly being inspected for a bounded safe port.

Use this sequence:

`inspect private source once -> define exact public-safe file/behaviour surface -> implement/port in public -> test public -> bind acceptance to public SHA`

Do not maintain duplicate active implementations. Do not bulk-merge private branches into public. Third-party/franchise-inspired private gear stays private unless its use is explicitly cleared.

## Hosted CI and diagnostics

The checked-in files under `.github/workflows/` are the workflow authority. For hosted failures, inspect the exact workflow definition, run metadata, jobs, logs, and artifacts before assigning cause.

Maintenance warnings from Actions/runtime versions may be repaired separately, but they are not a substitute explanation for gameplay failures.

## End a task by fixed point

Before handing off or asking for merge/review:

1. Run the relevant test suite/harnesses and record their actual outcome.
2. Push the task branch and refresh the remote head SHA.
3. Check exact-head hosted CI where it is part of acceptance.
4. For player-visible work, inspect the actual running-game evidence at that head.
5. Review the session for a reusable new failure mode. Update `docs/MISTAKES.md` or another public runbook only when a genuinely new durable lesson was learned; do not duplicate existing rules.
6. Hand off by public branch/PR, exact SHA, evidence paths/run IDs, and explicit gate states: **PASS / FAIL / UNKNOWN**.

Do not merge, close, promote, spend provider credits, or make other owner-only transitions unless explicitly authorized.
