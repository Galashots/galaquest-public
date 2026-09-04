# Progression A2 — Existing Mob Bank Inventory & Qualification

**Task-ID:** `PROG-A2-MOB-BANK-AUDIT`  
**Package size:** **M — Coupled read-only investigation**  
**Worker:** **Terra / Codex — read-only audit**  
**Director:** ChatGPT / GalaQuest Production Director  
**Repository:** `Galashots/galaquest-public`  
**Starting public fixed point:** `main@22d83b74b88aa5903bf5997f646db4843987da92`  
**Planning branch:** `plan/progression-a2-mob-bank-audit`  
**Owning product record:** #47 Enemy variety for the progression push  
**Governing design:** `docs/product/PROGRESSION_CONTRACT_V0.md`

## Objective

Determine what enemy/mob 3D assets GalaQuest already has access to across the public repository, known local project custody, Google Drive/synced Drive custody when actually accessible, Git history/branches, and documented provider history; qualify the serious candidates; and recommend the best **2–3 contrasting first enemy archetypes** for the progression push.

This is an inventory/decision-quality package only. It does not integrate enemies, generate assets, rig, animate, optimize, download provider output, edit files, or change runtime code.

## Product context

The first progression vertical needs enough ordinary mobs that increasing Hero strength is obvious in play. Settled direction includes:

- fixed-world / WoW-like progression: older enemies generally become trivial when outleveled;
- ordinary mobs appear in visible packs/fields and respawn;
- enemy level is visible;
- initial enemy status classes are normal + elite/boss;
- occasional much-higher-level enemies may be visible as aspiration/tension but must be clearly telegraphed and must not repeatedly farm children;
- ordinary mob XP is legitimate but modest relative to quest/learning/progression rewards;
- first enemy-variety content should create genuinely different combat situations rather than cosmetic reskins of one target profile;
- world/geography expansion is out of scope for this push;
- real pet work is sequenced later, so enemy choices should first expose Hero/gear progression and remain useful once pets arrive.

A2 informs later E3 content selection. It does **not** authorize E1/E2/E3 runtime work.

## Search sources

Treat the following as potentially relevant evidence sources:

1. current `Galashots/galaquest-public` repo and public Git history/branches;
2. current public enemy/mob asset directories and asset manifests/inventories/provenance records;
3. documented private/historical GalaQuest asset records already available in the checkout, where use is allowed as source/provenance evidence under `docs/WORKFLOW.md`;
4. known GalaQuest local asset directories already available to this environment;
5. **Google Drive / locally synced Google Drive GalaQuest custody.** The Owner specifically notes that a substantial number of mob GLBs may be stored on Google Drive. Treat Drive as an expected source, not an optional afterthought;
6. documented Meshy/provider task history and candidate ledgers, read-only.

Do not recursively search the whole computer. Do not inspect unrelated personal/work directories.

If the Codex environment cannot access Google Drive directly, state that clearly and produce a **Drive reconciliation handoff** containing:

- likely folder/file names or keywords discovered from repo/history;
- candidate names that should be searched remotely;
- what evidence is missing for each;
- any known Drive links/paths found in repository documentation.

Do not conclude “the asset does not exist” merely because Drive/provider custody is inaccessible. Use `UNKNOWN — external custody not inspected`.

## Inspect every credible candidate

For each byte-present GLB/glTF or other serious candidate with recoverable evidence, gather as much objective evidence as practical without modifying source material:

- identity/name and exact source/path;
- source/custody/provenance evidence;
- file format and size;
- whether GLB/glTF parses;
- node/mesh hierarchy;
- approximate vertices/triangles;
- material count;
- texture count/dimensions/packaging;
- skeleton/bones/skin if present;
- animation clips if present, with names and approximate durations where readily inspectable;
- transforms, scale, orientation and bounding dimensions;
- likely locomotion/attack-animation readiness;
- obvious duplicate/near-duplicate candidates;
- obvious runtime cost/texture/material concerns;
- collision/hit-volume implications that can be inferred structurally;
- whether the candidate appears compatible with GalaQuest's stylized/kid-readable visual direction at gameplay distance;
- whether it is a generic reusable enemy or tightly franchise/third-party-inspired/private material that should not be treated as public-shippable.

Use read-only GLB/glTF inspection tools, Blender headless inspection, glTF tooling, Git commands, or small analysis scripts if useful. Do not rewrite or optimize assets.

## Qualification dimensions

### 1. Custody / provenance

Classify evidence honestly:

- `CONFIRMED PUBLIC/PROJECT CUSTODY`;
- `LIKELY PROJECT CUSTODY — provenance incomplete`;
- `PRIVATE/THIRD-PARTY REFERENCE ONLY`;
- `PROVENANCE UNKNOWN`;
- `EXTERNAL CUSTODY UNKNOWN`.

Do not infer shipping rights from a filename or provider task name.

### 2. Visual/product potential

Assess likely:

- child-readable silhouette;
- “cool / threatening / exciting” factor rather than merely cute;
- readability at ordinary gameplay distance;
- contrast against the existing wolf and Warden;
- whether its appearance can communicate role before the child studies stats;
- whether it supports visible level/status danger language.

Structural/preview evidence may reject a poor candidate but cannot visually accept final running-game appearance.

### 3. Combat-archetype potential

Recommend the role each serious candidate could support **without implementing it**. Useful role vocabulary may include:

- fast fragile chaser;
- slow tank/brute;
- ranged/spitter/caster;
- evasive/skirmisher;
- pack/swarm creature;
- charger;
- elite threat;
- ambient/trivial low-level creature;
- other distinct role justified by asset shape/animation evidence.

Do not invent complex AI merely because an asset looks interesting. Favor archetypes that create a clear gameplay contrast with modest implementation complexity.

### 4. Animation/rig readiness

Distinguish:

- already rigged + useful clips present;
- rigged but missing key clips;
- unrigged but plausibly straightforward;
- animation/rig structurally problematic;
- unknown because only task/thumbnail records exist.

An asset with no attack animation may still be valuable; record the actual gap rather than rejecting automatically.

### 5. Runtime readiness

Consider:

- geometry complexity;
- texture/memory burden;
- material/draw-call implications;
- repeated-mob suitability;
- scale/pivot/orientation problems;
- browser GLB compatibility;
- obvious need for optimization before shipping.

Repeated ordinary mobs should face a stricter practical performance lens than a one-off boss/showpiece.

## Disposition

Put each credible candidate into one of:

**A — Strong first-variety candidate**  
Good value for near-term progression work; no material blocker presently known.

**B — Promising, needs bounded qualification/rig/animation/optimization**  
Worth near-term attention but not ready to integrate as-is.

**C — Useful later / elite / showpiece candidate**  
Valuable, but not ideal for first ordinary-mob variety.

**D — Blocked / custody or provenance unknown**  
Potentially useful but cannot responsibly advance yet.

**E — Reject for first progression vertical**  
Poor contrast/value, unsuitable runtime cost, redundant, inappropriate provenance, or otherwise not worth near-term effort.

This is audit classification only, not production promotion.

## Required archetype recommendation

Recommend **2–3 first contrasting enemy archetypes**, not 2–3 pretty meshes.

For each recommended archetype identify:

- candidate asset(s) that could serve it;
- player-readable fantasy;
- combat contrast versus current wolf;
- approximate relative difficulty niche;
- minimum additional animation/rig/content work known;
- likely integration risk;
- why it helps prove Hero/gear progression;
- whether it should be Normal or Elite initially.

Prefer a portfolio with materially different combat reads. Example shape only, not a mandated answer:

`quick pack threat + slow durable brute + ranged/zone threat`

If the existing asset bank cannot honestly support three good archetypes, recommend fewer and state the gap.

## Required deliverable

Return one Markdown report in the Codex chat. **Do not commit it.**

### 1. Audit fixed point

- repository and inspected main SHA;
- sources actually accessible;
- whether Google Drive/synced Drive was accessible;
- inaccessible sources.

### 2. Executive findings

5–10 bullets covering:

- real size/quality of the recoverable mob bank;
- whether Drive materially expands it;
- strongest existing candidates;
- major animation/rig/runtime/provenance blockers;
- major archetype gaps;
- whether enough existing content exists to avoid fresh generation for E3.

### 3. Complete candidate inventory

Table with at least:

`Candidate | Source/custody | Technical summary | Rig/animation state | Provenance confidence | Likely combat role | Runtime suitability | Disposition | Reason`

Include weaker candidates for audit traceability; do not report only favorites.

### 4. Technical qualification

Useful objective metrics for serious A/B/C candidates.

### 5. Ranked shortlist

**Maximum 6 serious candidates.** Rank and explain.

### 6. Recommended first archetype portfolio

**Maximum 3 archetypes.** Explain the role, candidate asset, contrast, known gaps and implementation risk.

### 7. Animation/rig gap matrix

For shortlisted candidates, identify what already exists versus what would still need to be created/qualified.

### 8. Performance/repetition assessment

Identify which candidates look safe for repeated mob-field use and which are better kept rare/showpiece/elite.

### 9. Google Drive / external-custody reconciliation

If Drive was accessible, identify the useful Drive-discovered assets separately from repo-local assets.

If Drive was inaccessible, provide the Director handoff described above rather than assuming absence.

### 10. Unknowns / follow-up

Identify anything requiring:

- Director Google Drive reconciliation;
- Meshy/provider-history reconciliation;
- provenance/license confirmation;
- rig/animation work;
- runtime optimization;
- running-game visual test;
- fresh asset production.

### 11. Recommended next actions

Separate:

- what should inform E3;
- what should wait until after E2/E3 proof;
- what is merely an asset side quest.

## Hard exclusions

Do **not**:

- edit GLBs/glTFs;
- rig or animate assets;
- generate new art or models;
- call paid providers;
- download Meshy/provider model output;
- optimize/remesh/retexture;
- integrate enemies;
- modify combat, AI, protocol, world, spawn, XP, loot, nameplate, or progression code;
- create branches, commits, PRs or Issues;
- broaden into gear/pets/world expansion;
- begin E1, E2 or E3.

If an exciting side quest appears, record it and continue the audit.

## Closing standard

A2 is complete when the Production Director can make a confident decision about:

1. whether existing custody supplies E3;
2. which 2–3 combat archetypes deserve first implementation;
3. which assets are safe leads versus blocked/expensive distractions;
4. what remaining external-custody reconciliation is actually worth doing.

Do not optimize for exhaustive archaeology after those decisions are supportable.