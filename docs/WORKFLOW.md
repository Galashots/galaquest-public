# GalaQuest public development workflow

This workflow applies to the public active repository. It is deliberately recoverable from public Git history and GitHub state; private archive files and prior chats are not required reading for ordinary public work.

## Start from live authority

1. Orient from the current checkout using the orientation sequence below.
2. Confirm the repository is `Galashots/galaquest-public`, refresh public `main`, and record the exact starting SHA.
3. Read `AGENTS.md`, then only the public authorities relevant to the task (`docs/CODEBASE.md` for the code map, `docs/GUIDANCE.md`, visual/pipeline docs, tests, workflows, contracts). Route into `docs/MISTAKES.md` through its index — skim or search by tag for the surfaces the task touches; do not read the ledger end to end.
4. Refresh live GitHub branch/PR/CI/deployment state before trusting a handoff or prior chat report.
5. Run the relevant baseline tests from the checkout when execution is available. Record actual results, not remembered counts.

Do not recursively search the machine for another checkout when the intended repository is not already known.

Use this orientation sequence at the known checkout:

```bash
git rev-parse --show-toplevel
git status -sb
git remote -v
git rev-parse HEAD
git worktree list
git fetch origin main
```

Record the exact refreshed `main` SHA before creating a task branch. Inspect intervening commits when the
dispatch brief names an expected base; stop for reforecast if they overlap the locked guidance surface.

## Work-package contract and scope control

Before a writer begins, frame every implementation package as:

`objective -> size -> included surfaces -> explicit exclusions -> acceptance gates -> checkpoint plan -> side-quest destination`

Keep the frame explicit and low-ceremony; do not require filler text for fields that do not apply.

### Package classes

Classify by change surface, coupling, and acceptance burden — not hours, token count, or lines changed.

- **S — Bounded:** one behavior or narrow surface with an obvious causal seam and targeted acceptance.
- **M — Coupled:** one coherent objective across several tightly related modules, documents, or surfaces;
  a small number of deliberate checkpoints may help.
- **L — Vertical:** one coherent player or production outcome crossing multiple disciplines or substantial
  acceptance surfaces; an explicit checkpoint plan is required before execution.
- **XL — Program:** too broad for an ordinary PR by default. Decompose it into S/M/L packages under one
  shared Initiative, design, or contract. One XL PR requires an exceptional explicit Owner decision and
  a reviewable checkpoint plan.

### Scope reforecast gate

A new request or discovery stays outside the active package until its effect is classified. Reforecast when
it adds a new product outcome, subsystem/domain, persistence or networking, asset/provider work, a materially
new acceptance surface, or enough coupling to move the package up a class.

1. **Necessary to finish the locked objective:** include it and update the size/checkpoint frame if materially expanded.
2. **Useful but scope-changing:** stop that addition and explicitly choose resize or split.
3. **Valuable but separable:** report it as a side quest and keep the package moving.
4. **Interesting but low-value:** leave it in conversation without creating backlog noise.

Owner direction remains authoritative, but an Owner addition introduced mid-package does not silently rewrite
the contract. Surface the choice plainly: “This is a useful addition, but it changes the locked package.
Do we resize this PR, split a follow-up, or keep the current push moving?” If resize is chosen, update the
package frame and checkpoint plan before implementing the expansion.

### Side-quest destinations

Do not create a parallel side-quest backlog. Route worthwhile separable findings to the existing authority:

- product-facing lifecycle value -> an existing or new product Issue under `docs/product/PRODUCT_SYSTEM.md`;
- engineering/process follow-up -> a normal engineering Issue or future brief;
- small implementation note -> the PR or handoff;
- asset/provenance observation -> the relevant asset inventory/provenance authority;
- passing thought -> conversation only.

A worker without authorization to create or update the durable destination reports the finding to the Production
Director instead of broadening the PR.

## One coherent objective per public branch/PR

- Branch from current public `main`; use one coherent objective per branch and pull request, whether the
  package is product-facing or engineering/process work.
- Do not push directly to `main` or rewrite shared history.
- Keep the package size and included surfaces explicit. Commits should separate generated/public assets from
  unrelated runtime logic when practical.
- A worker brief or issue may define file ownership, scope, acceptance seams, and stop conditions, but the public GitHub diff and exact SHA remain the state under review.

### Large PRs are reviewed by checkpoint, not by wishful thinking

When the owner explicitly chooses a long-running, larger PR, keep the **coherent objective singular** even if implementation spans many commits.

- Publish exact-SHA checkpoints that are runnable and reviewable on their own.
- At each checkpoint, run the required unit gate plus the evidence relevant to the surface changed so far.
- Review findings against the checkpoint SHA; do not let later commits retroactively turn an earlier UNKNOWN into PASS.
- Keep unrelated cleanup out of the branch so incremental review remains meaningful.
- A checkpoint approval is not merge approval. Re-run final-head acceptance after the last change and before merge.

This lets a substantial gameplay vertical be reviewed continuously without splitting one coherent experience into artificial PRs or postponing all scrutiny until the end.

### Final-checkpoint stop boundary

Once the final planned checkpoint is feature-complete, the worker's role shifts from implementation to
**causality classification and handoff**. Do not turn broad validation into an open-ended cleanup phase.

- Run the required final-head gates and, when warranted, one broad diagnostic pass such as the full browser matrix.
- A newly red check may be investigated far enough to determine whether the active package plausibly caused it.
- If the failure reproduces on the package base/current `main`, is asset-gated, is timing/flaky without causal evidence,
  or belongs to another package or engineering surface, record that classification and route any worthwhile follow-up;
  do not repair it on the completed feature branch.
- If evidence establishes a new in-scope regression caused by the package, make the smallest causal correction,
  rerun the affected acceptance seam, then return to handoff.
- Do not keep cycling through baseline debt, harness hardening, unrelated cleanup, opportunistic polish, or repeated
  broad revalidation after causality is closed.
- When required gates are PASS and any remaining reds are evidence-backed non-blocking/UNKNOWN items, stop and hand off.
  The Production Director or Owner decides whether a separate follow-up package is worth opening.

This stop boundary is part of package discipline: a conscientious worker finding more things to investigate is not,
by itself, evidence that the current package should continue.

## Writer topology

Default to one write-worker per bounded package. Read-only investigation, research, playtesting, specialist
review, and independent audit may fan out in parallel. Multiple simultaneous write lanes are allowed only
when they are genuinely independent, file/authority ownership is explicit, and the merge plan is obvious
before work begins.

A reviewer or auditor does not silently become a second writer. A worker should not edit another active
package's branch merely because it found a related problem. Roles are capability- and task-based; do not
encode fixed model assignments.

## Context and session health

Treat a session as degraded when practical signals accumulate, such as a converged task changing domain,
competing superseded SHAs/branches/decisions, runtime-reported context pressure, expensive recovery of the
current state, reliance on memory instead of live authority, accumulating unrelated side quests, or a fresh
independent validation becoming more valuable than more discussion in the same context. Do not use token or
context percentages or a fixed conversation-length limit as the gate.

When pressure becomes material:

1. stop broadening the active package;
2. ratchet durable decisions and lessons to their existing authority;
3. pin the exact branch, PR, and SHA;
4. record required gates as PASS / FAIL / UNKNOWN and list unresolved Owner decisions;
5. record the next permitted action;
6. hand off by reference rather than duplicating large source material;
7. continue in a fresh session/runtime when that reduces stale-context risk.

Keep the fixed-point record proportional to the task rather than imposing a giant handoff template.

## Evidence and acceptance

Every material claim identifies the exact public SHA it proves.

For behaviour changes:

- establish a red-capable reproduction or test before accepting a causal theory when practical;
- prefer the smallest causal fix;
- do not weaken product behaviour, prediction constants, thresholds, or tests merely to satisfy hosted CI;
- rerun the affected evidence after the fix.

### Mandatory visual self-review before handoff

For every new or materially changed player-visible asset, **the producer must perform and record a visual self-review before asking anyone else to accept it**. Follow `docs/review-guides/asset-visual-review.md` and the `visual-reference-first` skill.

The minimum review posture is:

1. inspect the relevant accepted GalaQuest visual/runtime authority and Owner-provided references;
2. when web/image-search capability exists, compare against at least three attributable external examples that genuinely test the convention or quality bar; prefer official game/studio/publisher material or real-world references over anonymous reposts or AI collections;
3. if the intended target is materially verbal/ambiguous and no canonical reference settles it, use a Production Director-generated **non-canonical target reference** when that would reduce expensive guesswork, explicitly stating what attributes it controls;
4. for Unity-bound assets, inspect the actual import in Unity at neutral inspection scale **and** intended gameplay framing; inspect motion in Play Mode for animation/VFX/cloth/moving parts;
5. record the strongest defect, mismatch, or disconfirming comparison found — not only positive observations;
6. fix, reject, or reforecast material defects before requesting independent review.

A producer's own visual review can prove that the worker looked critically at its output; it cannot independently accept its own consequential implementation.

If Unity, image search, or the generated evidence cannot be accessed, that visual gate is **UNKNOWN**, not waived. Route the missing check to a capable runtime/reviewer before consequential acceptance.

Visual evidence should be easy for the Owner to inspect from a phone. Attach key stills to the PR/review surface when practical. Store large raw/source masters and large recordings in the Owner-controlled Google Drive custody/review tier when available, link them from the exact-SHA PR/handoff, and preserve an exact-SHA evidence manifest. Do not commit large binaries merely to make review convenient.

Do not copy third-party comparison imagery into Git/Drive solely as evidence unless its project custody is cleared; preserve source links/search terms instead.

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
4. For player-visible work, complete the mandatory producer visual self-review and inspect the actual running-game evidence at that head; do not ask the independent reviewer to discover defects the producer already could have caught.
5. Review the session for a reusable new failure mode. Update `docs/MISTAKES.md` or another public runbook only when a genuinely new durable lesson was learned; do not duplicate existing rules.
6. Hand off by public branch/PR, exact SHA, evidence paths/run IDs, and explicit gate states: **PASS / FAIL / UNKNOWN**.

Do not merge, close, promote, spend provider credits, or make other owner-only transitions unless explicitly authorized.
