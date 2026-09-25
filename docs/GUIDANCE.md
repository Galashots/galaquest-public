# GalaQuest guidance system

GalaQuest has a strong documentation shape: a short root authority, one development workflow, focused
domain runbooks and skills, a durable product layer, and a separate historical lessons ledger. This
document defines how that system stays useful as the game and its tooling move quickly.

The goal is **high signal, low ceremony**. Guidance should let a fresh contributor act correctly from
the public checkout without needing old chat context, a private archive, a particular machine, or a
remembered session.

## The hierarchy

Use the narrowest authority that actually governs the question:

1. **`AGENTS.md` — hard repository boundaries.** Where work happens, owner-only transitions, evidence
   binding, visual acceptance, spend/licensing boundaries.
2. **`docs/product/PRODUCT_VISION.md` — settled product direction.** Owner-level product principles and
   decisions that should survive chats and implementation cycles.
3. **Current product design contracts — selected cross-system design authority.** Read a live contract when
   the current product push names one. `docs/product/PROGRESSION_CONTRACT_V0.md` holds shared
   Hero/gear/POWER/enemy/learning progression constraints and provisional tuning; the vision limits it
   to Emberworks (parked) until that tuning is re-decided for the farm game's combat. A design contract may add implementation-shaping detail but may not
   silently override Product Vision.
4. **`docs/product/PRODUCT_SYSTEM.md` — live product-memory protocol.** How GitHub Issues preserve ideas,
   signals, provenance, initiatives, lifecycle state, and links to implementation.
5. **`docs/WORKFLOW.md` — development lifecycle.** Branch/PR shape, verification surfaces,
   incremental review, PASS/FAIL/UNKNOWN semantics, task closeout.
6. **Domain guidance — how to do a class of work.** `docs/pipeline/`,
   `docs/GALAQUEST_VISUAL_AUTHORITY.md`, `docs/public-playtest.md`, `docs/review-guides/`, and
   `.agents/skills/`. `docs/CODEBASE.md` sits alongside these as the descriptive code map: it
   carries no process rules, and where it drifts from the code, the code is right.
7. **Code, contracts, tests, and checked-in workflows — mechanical truth.** A runbook cannot make a
   nonexistent command exist or override a live contract/test/workflow.
8. **`docs/MISTAKES.md` — historical lessons.** It preserves what went wrong and why. It is not a
   current command index and may discuss superseded implementations.

A lower layer may add detail but must not silently contradict a higher one. If two active sources
disagree, stop using the stale one and repair the conflict rather than choosing whichever is convenient.

GitHub Issues governed by the product system carry live product state that is intentionally too dynamic
for a committed Markdown snapshot. The Product Vision remains the authority for settled Owner direction;
Issues provide provenance and lifecycle for ideas, signals, and initiatives. A current product design
contract sits between those layers and implementation: it coordinates one selected cross-system push but
does not become a second backlog or replace the owning Issues.

## Task router

Use the matching row before choosing a work or acceptance surface. Combine rows only when the task spans domains; the table is not a universal preflight. Follow the actual caller and tests, not every file in a listed directory. Search only the relevant `docs/MISTAKES.md` index tags in the last column.

| Work category | Task guidance | Mechanical truth / proof entry point | Lesson tags |
| --- | --- | --- | --- |
| **Farm game (three.js)** | `docs/product/PRODUCT_VISION.md`; `prototypes/farm-slice/CONTRACT.md`; `docs/CODEBASE.md` | Owning module in `prototypes/farm-slice/src/` (`rules/` state, `render/` diorama, `ui/` touch UI, `depth/` depth lanes) and `prototypes/farm-slice/content/`; its suite in `prototypes/farm-slice/test/`; running-game pixels at `/farm/` on iPad viewports | gameplay, visual, tests |
| **Unity gameplay / scene / prefab** | Parked (`docs/product/PRODUCT_VISION.md`, Platform): only for explicitly Unity-scoped work. `unity/AGENTS.md`; `.agents/skills/galaquest-unity-web-playtest/SKILL.md` for Editor iteration | Actual scene/prefab and caller in `unity/GalaQuest/Assets/GalaQuest/`; governing tests in `unity/GalaQuest/Assets/GalaQuest/Tests/` | code, tests, visual |
| **Unity WebGL / browser acceptance** | Parked, as above. `.agents/skills/galaquest-unity-web-playtest/SKILL.md`; `tools/unity-playtest/README.md` | Matching driver in `tools/unity-playtest/`, build manifest, separate client/server SHAs, actual captures; device proof separately | harness, evidence, ci |
| **Player-visible assets** | `docs/pipeline/README.md`; `docs/asset-production/ASSET_REGISTRY_V1.md`; `.agents/skills/visual-reference-first/SKILL.md`; `docs/review-guides/asset-visual-review.md` | `docs/asset-production/asset-registry-v1.json` (farm-game models: the batch manifest named in `ASSET_REGISTRY_V1.md`, bound by `test/farm-asset-provenance.test.mjs`), actual source/derivative hashes, destination import and running-game pixels | assets, visual, evidence |
| **HUD / UI** | `docs/product/PRODUCT_VISION.md`; `docs/GALAQUEST_VISUAL_AUTHORITY.md`; `.agents/skills/visual-reference-first/SKILL.md`; `docs/review-guides/asset-visual-review.md`; `unity/AGENTS.md` for Unity | Owning presenter/input path in `prototypes/farm-slice/src/ui/` for the farm game, retained `public/src/ui/`, or parked `unity/GalaQuest/Assets/GalaQuest/Runtime/Gameplay/`; the owning suite plus target-viewport running pixels | visual, harness, tests |
| **Network / protocol / session** | `docs/CODEBASE.md`; `unity/AGENTS.md` when changing Unity | `net/gameServerCore.mjs` caller/producer; `public/src/net/protocolCore.js`; Unity reader in `unity/GalaQuest/Assets/GalaQuest/Runtime/Network/`; `test/protocol.test.mjs` and relevant Unity session tests | net, tests, harness |
| **Persistence / progression** | `docs/product/PROGRESSION_CONTRACT_V0.md`; `docs/CODEBASE.md` | Producer and fold in `public/src/progression/facts.js`; `net/rewardStore.mjs`; `test/reward-store.test.mjs`; restore/restart consumers and Unity progression tests | persistence, net, tests |
| **Product / content expansion** | `docs/product/PRODUCT_VISION.md`; `docs/product/PRODUCT_SYSTEM.md`; owning live Initiative/Requirement and its selected design contract | Owning Issue acceptance outcome against actual content/runtime in `prototypes/farm-slice/content/` and `prototypes/farm-slice/src/`; use `docs/asset-production/asset-registry-v1.json` only for assets serving that outcome | gameplay, visual, assets |
| **Consequential acceptance / review** | `docs/WORKFLOW.md`; `docs/review-guides/asset-visual-review.md` when visible | Exact diff, applicable checks in `test/` and `.github/workflows/`, independent evidence; actual runtime/device pixels when relevant | evidence, ci, tests |
| **Provider-backed asset work** | `docs/pipeline/README.md`; selected asset lane; `tools/meshy/README.md` when applicable; `docs/pipeline/google-drive-asset-custody.md` | `docs/asset-production/asset-registry-v1.json` (farm-game batches: their manifest, per `ASSET_REGISTRY_V1.md`), exact source/hash and recovery coordinate, guarded client in `tools/meshy/`, destination qualification | assets, evidence, visual |
| **Legacy Three.js diagnostics** | `docs/CODEBASE.md`; `docs/WORKFLOW.md` verification surfaces | `tools/runtime-test/review-suites.mjs`, matching driver and `.github/workflows/full-playtest-matrix.yml`; not farm-game or Unity acceptance | harness, net, ci |

**Routing grants read context, not write ownership.** A bounded writer may need callers, producers, codecs/parsers and governing tests outside its writable module. Inspect them without expanding the write scope.

Before designing a new protocol/contract, field, or limit, search literal wire/type identifiers, then read the actual caller/producer, codec/parser, and governing tests. Preserve existing contracts rather than inventing a parallel one from an isolated module.

## Runtime-local capability is not project authority

Runtime-local state may include model/runtime memory, user or global instructions, local hooks,
MCP/connector configuration, browser/session state, local credentials, machine-local prompts, and
runtime-specific settings. These may provide capability, but they are not GalaQuest project authority
unless the repository's actual authority explicitly says so.

Access is not authorization: a credential proves access, an installed connector proves capability, and
local memory or prompts do not override checked-in GalaQuest rules. When the repository reserves a
decision to the Owner, a current explicit Owner instruction remains authoritative for that decision;
runtime-local state cannot manufacture, supersede, or revoke that authority. Durable rules should be
recoverable from the public repository and live GitHub state rather than a particular runtime's private
state.

## Checked-in skill discovery

Checked-in skill content has one canonical repository location: `.agents/skills/`. A runtime that
auto-discovers that directory may use the discovery; a runtime that does not must explicitly read or
load the relevant canonical skill when the task requires it. Do not mirror skill prose into another
repository tree merely to satisfy a runtime discovery convention.

Runtime-global or vendor-provided skills are capability, not GalaQuest authority. They rank below the
checked-in skills and runbooks above and should be selected only when they add a capability the current
task actually needs. Their installation paths, client-specific setup commands, and runtime inventories are
machine/runtime state rather than durable repository guidance.

A vendor skill never authorizes a package upgrade, a new engine/cloud service, analytics, monetization,
paid AI/provider usage, or other Owner-controlled transition. Do not add a second Editor-control path
alongside the Unity CLI/Pipeline route that `unity/AGENTS.md` already owns without an explicit package.

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

Product guidance under `docs/product/` is a first-class guidance root. Its Markdown must therefore obey
the same live-path and relative-link rules as other active runbooks.

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

## Ratchet and update discipline

Correct misleading guidance at the narrow authority that owns it; add a cheap objective regression when useful. `docs/WORKFLOW.md` owns including a reusable lesson in the same production PR. Search existing lessons before adding history; link a new incident to its active prevention rule, not another copy of the warning.

When a tool, path or proof surface changes, repair its callers and task route together. Remove or explicitly supersede obsolete instructions. `docs/product/PRODUCT_SYSTEM.md` owns product decisions and provenance; guarded client runbooks own provider procedure, never blanket spend permission.

Before adding prose or a check, identify its unique job and the existing authority it replaces or complements. Do not create another handbook, backlog, style framework, or universal checklist to fix a local routing failure.
