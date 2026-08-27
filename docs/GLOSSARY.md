# GalaQuest working glossary

Shared vocabulary so briefs, PRs, handoffs, and ledger entries can use one word instead of a
paragraph. Definitions here are pointers, not authority: the linked document or code owns each
concept, and if this page drifts from an authority, the authority is right — repair this page in
the same PR.

## Process and evidence

- **Owner** — the human with final product and merge authority. Owner-only transitions (merge,
  close, promote, provider spend) are listed in `AGENTS.md`.
- **Production Director** — the coordinating review role that audits packages and routes findings
  the worker cannot durably record itself (`docs/WORKFLOW.md`, `docs/product/PRODUCT_SYSTEM.md`).
- **Package** — one bounded implementation objective framed as
  `objective -> size -> surfaces -> exclusions -> gates -> checkpoints -> side-quest destination`
  (`docs/WORKFLOW.md`).
- **Package class (S/M/L/XL)** — size by change surface, coupling, and acceptance burden, not
  hours or lines (`docs/WORKFLOW.md`).
- **Scope reforecast** — the explicit stop when a discovery would change the locked package:
  include, resize/split, side-quest, or leave in conversation (`docs/WORKFLOW.md`).
- **Side quest** — a valuable separable finding routed to an existing authority (product Issue,
  engineering Issue, PR note) instead of widening the active package.
- **Checkpoint / checkpoint SHA** — an exact, runnable, reviewable commit inside an
  Owner-authorized large PR; review findings bind to it and do not retroactively move.
- **Exact-SHA binding** — every material claim names the public commit it proves; a claim without
  one is not evidence.
- **PASS / FAIL / UNKNOWN** — the only gate states. A missing artifact, run, or inaccessible
  surface is UNKNOWN, never inferred PASS.
- **Fixed point** — the closeout state a task ends at: suite run, branch pushed, exact head
  recorded, gates stated, unresolved Owner decisions listed (`docs/WORKFLOW.md`).
- **Red-capable** — a reproduction or test demonstrated able to fail on the defect it guards, not
  merely seen passing.
- **Sabotage test** — deliberately breaking an instrument or input once to prove the check can go
  red (`docs/MISTAKES.md`, GQ-022).
- **Ratchet** — the mechanical promotion ladder in `docs/MISTAKES.md`: OBSERVED (1st hit) → RULE
  (2nd hit, stable GQ-NNN id) → ENFORCED (2nd hit + mechanically expressible as a check; the named
  test exists). Also the guidance ratchet rule in
  `docs/GUIDANCE.md`: fix the misleading doc and add the smallest check that would have caught it.
- **Foreknowledge helped** — the ledger field recording that an entry actually prevented a repeat;
  entries that never help get rewritten or deleted, not promoted.
- **Baseline debt** — checks red on `main` itself (much of the full browser matrix); reds that
  reproduce the base are classified, not repaired, on a feature branch (`docs/WORKFLOW.md`,
  final-checkpoint stop boundary).
- **Safe port** — the bounded sequence for using private material: inspect once → define the exact
  public-safe surface → implement in public → test → bind to the public SHA (`docs/WORKFLOW.md`).
- **Writer topology** — one write-worker per package by default; readers, reviewers, and auditors
  may fan out, and an auditor does not silently become a second writer (`docs/WORKFLOW.md`).

## Runtime and harness

- **Harness** — a `tools/runtime-test/` script driving real Chrome over CDP against its own
  isolated server; `drive-*` walk gameplay, `review-*` capture visual evidence, `fit-*` check gear
  placement.
- **Director relay** — the on-demand `/director-playtest <scenario>` PR comment that runs one
  whitelisted harness against the exact PR head in Actions
  (`.github/workflows/director-playtest.yml`).
- **Guest id** — the per-device identity minted at boot (`public/src/net/guestId.js`); harnesses
  must seed or clear it before first navigation (`docs/MISTAKES.md`, GQ-008, GQ-016).
- **Snapshot / reconciliation** — the server's 10 Hz authoritative state and the client's
  frame-loop convergence toward it (`net/`, `public/src/net/`); most frame-rate lessons in the
  ledger live here.

## Product vocabulary

Gameplay and progression terms — hearts, marks, POWER, gear tiers, the Beacon arc — are owned by
`docs/product/PRODUCT_VISION.md`, `docs/product/PROGRESSION_CONTRACT_V0.md`, and the code they
name; read those rather than trusting a secondhand definition here.
