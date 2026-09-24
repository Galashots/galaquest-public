# GalaQuest public development workflow

This workflow applies to the public active repository. It is deliberately recoverable from public Git history and GitHub state; private archive files and prior chats are not required reading for ordinary public work.

## Start from live authority

1. Orient from the current checkout using the orientation sequence below.
2. Confirm the repository is `Galashots/galaquest-public`, refresh public `main`, and record the exact starting SHA.
3. Read `AGENTS.md`, then use the `docs/GUIDANCE.md` task router to select narrow guidance, mechanical truth and relevant `docs/MISTAKES.md` tags. Do not ingest the whole handbook or lessons ledger.
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

## Autonomous production selection

When no package is already selected and Owner input is not required, choose the next production move in this order:

1. settled `docs/product/PRODUCT_VISION.md`, the owning selected Initiative/Requirement, and any applicable design contract;
2. the strongest current **player-visible** need inside that direction;
3. an available safe writer topology and acceptance surface that can carry the work to a credible result;
4. existing qualified or realistically qualifiable assets that serve that need.

Keep selected player-visible expansion active or next-ready during an authorized production session when direction and safe capacity permit. Read-only scouts may prepare the next bounded package without competing for an active writer's files or Editor. Do not request fresh Owner selection when Product authority already settles it; reserved spend, promotion and merge decisions still apply.

Asset inventory serves that need through `docs/pipeline/README.md`; it does not select Product direction. Maintenance interrupts only when it blocks the selected player outcome or repeated measured production cost justifies a bounded repair. Do not select random Issues, inventory or cleanup merely to keep agents occupied.

### Anti-polish stop

Once the current role of a feature, asset, or presentation is materially credible, move forward. Continue polishing only when the remaining defect materially hurts fun, readability, usability, identity, perceived quality, or future production throughput. "Could be nicer" by itself is not a reason to stall the next player-visible outcome.

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

Every material claim identifies the exact public SHA it proves. Missing evidence is **UNKNOWN**, not inferred PASS.

For behaviour fixes, observe the reproduction/test fail for the intended defect before the correction where practical, then rerun it after the smallest causal fix. A test merely described as red-capable is not observed red evidence. If reproduction is impractical, state the unproven claim; do not weaken behavior, thresholds or tests to satisfy CI.

Before attributing a broad/noisy failure to the candidate, compare a suitable exact base/control under materially equivalent conditions and inspect the actual failure. A new red alone does not prove causality; absent a suitable comparison, cause remains UNKNOWN. Baseline debt does not become PASS or waive a required gate.

For consequential state-changing Git/filesystem/tool commands, verify the intended postcondition, not just the exit code or acknowledgement. Check both registry and filesystem state when both matter. Automation must clean up state it owns, or deliberately retain bounded reusable state/evidence; uncontrolled temp/scratch/profile leakage is a tooling defect. Repair the producer under scope control, not by sweeping unknown active state or bypassing permissions.

### Supporting lesson ratchets

A genuinely reusable failure or materially better execution path may justify a narrow `docs/MISTAKES.md` entry, task-runbook/skill correction, or cheap regression in the **same production PR**. Treat that as supporting scope when it serves the package, not automatic scope pollution. Search existing lessons first, connect any new incident to its active prevention rule, and reforecast material expansion. No reusable lesson means no mandatory guidance churn.

### Review roles

For consequential acceptance, distinguish **Intent/Spec**, **Standards/Governance**, **Evidence/Acceptance**, and, when visible, **Product/Owner Fit**. The writer may self-check but cannot independently accept its own implementation by changing role labels. Use a fresh reviewer or genuinely independent proof toolchain proportionate to the risk; preserve reserved Owner decisions.

### Visual work and defect triage

The producer must critically inspect new or materially changed player-visible work before handoff. `.agents/skills/visual-reference-first/SKILL.md` owns BUILD -> LOOK -> REPRODUCE -> FIX -> LOOK AGAIN; `docs/review-guides/asset-visual-review.md` owns reference hierarchy, original-condition comparison, fresh unprimed critique and evidence custody. Running-game human visual judgment remains acceptance, not a machine metric.

- **Small, local, causally clear, low-risk defect in the owned surface:** fix and verify it inside the package.
- **Related but material, cross-system or package-changing defect:** reforecast or route it before absorption.
- **Genuine Product/art-direction choice:** use governing authority; ask the Owner only for an unresolved reserved decision.

Scope control is neither an excuse to hand off visibly broken changed work nor permission for uncontrolled redesign. Apply the anti-polish stop once the present role is materially credible.

## Verification surfaces

Use the cheapest authoritative surface that proves the claim, then escalate for a distinct risk. Before retaining, adding or removing a check, ask what unique failure it catches that a cheaper current check does not. Removal needs stronger replacement, proven duplication, a removed target, or demonstrated non-discriminating/noisy coverage, not speed alone. Distinct geometry, behavior, visual and physical-device risks are not duplicates.

Classify noisy coverage deliberately: repair, quarantine with a return condition, retarget, make diagnostic/advisory, or retain as a justified gate. Do not encode transient failure counts or silently convert execution failures to success. Reuse exact-state evidence when its relevant inputs/conditions are unchanged; repeat it for changed risk, not ceremony.

### 1. Required unit gate

```bash
node --test test/*.test.mjs
node --test prototypes/farm-slice/test/*.test.mjs prototypes/farm-slice/test/depth/*.test.mjs
```

The protected branch requires the hosted `unit` context. The checked-in `.github/workflows/test.yml` is the authority for its runtime version and commands; it also runs the farm game's own suite (`prototypes/farm-slice/test/`). Guidance integrity runs here too, so Markdown-only changes still receive the cheap required gate.

### 2. Farm game running pixels

The farm game (`prototypes/farm-slice/`) is the active client. Its rules are covered by its suite in
the required gate; its appearance and touch flow need the running game. Serve it (`node server.mjs`,
then `/farm/`, or its own `node prototypes/farm-slice/serve.mjs`), start a browser with
`node tools/runtime-test/automation-chrome.mjs`, and over CDP set an iPad viewport (1024x768 and
768x1024, `Emulation.setDeviceMetricsOverride` plus `Emulation.setTouchEmulationEnabled`), capture,
and check the console for errors. No checked-in farm driver does this yet; the legacy harnesses below
do not cover the farm game. Emulated headless captures are diagnostic: acceptance is iPad Safari and
human visual judgment (`AGENTS.md`, visual and product acceptance). The hosted instance
(`docs/public-playtest.md`) serves the same route for a real iPad; fetch its `/source-sha.json` first.

### 3. Legacy Three.js local running-game harnesses

`tools/runtime-test/` drives the retained Three.js client in real Chrome over CDP. The harnesses own their isolated runtime server; **do not pre-start `server.mjs` for them unless a specific harness explicitly says otherwise**. Open the produced captures when visual evidence matters.

### 4. Unity manifest-based browser evidence (parked)

Unity is parked (`docs/product/PRODUCT_VISION.md`, Platform); this applies only to explicitly
Unity-scoped work. For the Unity client, use the checked-in manifest-bound browser route in
[`tools/unity-playtest/README.md`](../tools/unity-playtest/README.md). It identifies the local Unity
build, its client/server SHAs, and the assertions it can prove. The legacy Three.js harnesses, Render
relay, and their captures do not provision or substitute for Unity browser evidence. A successful Unity
driver is behavior evidence only; inspect running-game pixels and physical-device acceptance separately.

`unity/AGENTS.md` owns project safety. `.agents/skills/galaquest-unity-web-playtest/SKILL.md` owns the live-Editor, focused-test, build-reuse and timeout procedures; do not substitute repeated cold builds for that loop.

### 5. Legacy Three.js on-demand Director relay on a PR

For an exact PR-head browser run in Actions, the repository owner can comment a whitelisted command such as:

```text
/director-playtest lodge
/director-playtest combat
/director-playtest co-op
```

`.github/workflows/director-playtest.yml` is the scenario whitelist and implementation authority. It checks out the actual PR head, runs PR code in a read-only job, uploads evidence, and reports from a separate write-capable job. Do not collapse that security boundary merely to simplify reporting.

### 6. Public hosted playtest

Use the Render instance when a tester has a browser but cannot reach a local machine. Follow `docs/public-playtest.md` and fetch `/source-sha.json` **before** treating the session as evidence for a commit. Per-PR preview instances are opt-in with `[render preview]` in the PR title. The same instance serves the farm game at `/farm/`. The root is retained Three.js coverage, not a Unity build/deployment guarantee.

### 7. Full browser matrix

`.github/workflows/full-playtest-matrix.yml` is broad diagnostic coverage, not the protected required gate. It is intentionally more expensive and historically noisier than `unit`; use it when the changed surface warrants broad browser coverage and interpret failures from the exact run rather than from remembered pass counts.

Automatic runs are limited by the workflow's positive path ownership to retained Three.js runtime and
harness inputs. Unrelated guidance, unit-test-only, non-runtime tooling, and Unity-only changes skip this
legacy matrix. Manual dispatch remains available, and the required `unit` gate is unfiltered. A skipped
legacy matrix does not establish Unity correctness: use the native/built-client/device acceptance surfaces
above for the actual Unity claim.

## Private-source safe ports

Follow `AGENTS.md` for the bounded private-source sequence, redistribution clearance and prohibition on duplicate active implementations.

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
