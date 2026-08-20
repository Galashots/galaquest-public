# GalaQuest guidance system

GalaQuest has a strong documentation shape: a short root authority, one development workflow, focused
domain runbooks and skills, and a separate historical lessons ledger. This document defines how that
system stays useful as the game and its tooling move quickly.

The goal is **high signal, low ceremony**. Guidance should let a fresh contributor act correctly from
the public checkout without needing old chat context, a private archive, a particular machine, or a
remembered session.

## The hierarchy

Use the narrowest authority that actually governs the question:

1. **`AGENTS.md` — hard repository boundaries.** Where work happens, owner-only transitions, evidence
   binding, visual acceptance, spend/licensing boundaries.
2. **`docs/WORKFLOW.md` — development lifecycle.** Branch/PR shape, verification surfaces,
   incremental review, PASS/FAIL/UNKNOWN semantics, task closeout.
3. **Domain guidance — how to do a class of work.** `docs/pipeline/`,
   `docs/GALAQUEST_VISUAL_AUTHORITY.md`, `docs/public-playtest.md`, `docs/review-guides/`, and
   `.agents/skills/`.
4. **Code, contracts, tests, and checked-in workflows — mechanical truth.** A runbook cannot make a
   nonexistent command exist or override a live contract/test/workflow.
5. **`docs/MISTAKES.md` — historical lessons.** It preserves what went wrong and why. It is not a
   current command index and may discuss superseded implementations.

A lower layer may add detail but must not silently contradict a higher one. If two active sources
disagree, stop using the stale one and repair the conflict rather than choosing whichever is convenient.

## What durable guidance should contain

Prefer statements that survive a new branch, agent, machine, and month:

- public repository paths that exist;
- capability and acceptance requirements;
- exact commands that are currently runnable;
- stable authority boundaries;
- evidence semantics such as exact-SHA binding and PASS/FAIL/UNKNOWN;
- measured historical costs clearly labelled as estimates or evidence, never permission.

Avoid turning transient session state into project law:

- "current PR #N" as an enduring routing rule;
- a model name, effort setting, browser tab id, local Chrome arrangement, or machine-specific
  executable path when the requirement is really capability-based;
- a remembered test count as a gate;
- a private path as a required public startup dependency;
- an old credit authorization or budget ceiling as present permission to spend.

If a dated historical fact matters, keep it dated and label it as history. Do not phrase it as a
current instruction.

## Continual guidance linting

`test/guidance-integrity.test.mjs` runs inside the existing required `unit` job. It deliberately uses
only Node built-ins: guidance integrity must not introduce an npm install or a second CI system.

The scanner is intentionally narrow. It checks objective failure modes that can send a contributor
down a dead path:

- broken **relative Markdown links** in active guidance;
- repo-local path references such as `tools/...`, `docs/...`, `.github/...`, `public/...`, `test/...`,
  `net/...`, or `data/...` that resolve to nothing;
- machine-local absolute paths accidentally promoted into durable instructions;
- durable authority files reintroducing PR-number-specific routing or repository-encoded
  provider-spend authorization;
- the spend runbook preserving the rule that budgets and ceilings do not grant authority.

It does **not** lint tone, line length, heading style, prose taste, external URLs, or exact heading
anchors. Those checks are subjective, network-dependent, or too brittle for the value they provide.

### Scope

The test automatically walks the active guidance roots named in its `GUIDANCE_DIRS` list and scans the
core guidance files in `GUIDANCE_FILES`. New Markdown added under an existing guidance directory is
picked up automatically.

When a genuinely new guidance area is created elsewhere, add its directory to the test in the same PR.
Do not copy the same rule into several files merely so the scanner can see it.

`docs/MISTAKES.md` is intentionally outside the current-path scan because it is a historical ledger and
must be allowed to describe removed implementations. Current runbooks should link to the durable lesson
rather than copy an obsolete command out of the ledger.

`docs/GALAQUEST_VISUAL_AUTHORITY.md` is the one deliberate current-path exception. Part of its job is to
inventory **missing** canonical reference roles so nobody pretends those authorities exist. Its relative
Markdown links are still linted, but the raw repo-path existence scan is not applied to it. Any missing
reference named there must be explicitly labelled **MISSING IN PUBLIC**; the exception is not permission
to hide dead executable commands in that file.

### False positives and intentional examples

Prefer examples that point to real tools and use placeholders only for data operands, for example:

`node tools/runtime-test/drive-ranger.mjs <scenario>`

If an ordinary runbook needs to discuss a path that deliberately does not exist, describe it as
historical/missing in prose rather than formatting the dead path as a current repo-local instruction. A
growing allowlist is a smell: repair the document architecture before adding exceptions.

## Ratchet rule

When guidance causes a real failure, fix two things:

1. correct the misleading document;
2. add the smallest mechanical check that would have caught that class of drift, when the check can
   stay objective and cheap.

Do not respond to a documentation failure by making the prose louder. Do not respond to one typo by
building a generalized style framework.

## Update discipline

In the PR that changes a stable surface, ask:

- Did a command or path move? Update the active runbook that points to it.
- Did a new verification surface land? Update `docs/WORKFLOW.md` or the relevant domain guide.
- Did a provider client or spend shape change? Update its guarded tool README and pipeline runbook,
  but keep authorization outside durable budget numbers.
- Did a reusable failure mode appear? Record it once in `docs/MISTAKES.md` and promote only the stable
  prevention rule into the runbook contributors actually read.
- Did a product decision become superseded? Mark the old statement historical or remove it from active
  guidance; do not leave two "current" answers.

The fixed point is simple: a fresh contributor should be able to start from public `main`, follow the
active Markdown, and reach the same executable surfaces the repository actually contains.
