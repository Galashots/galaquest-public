# GalaQuest character authority map

Read this map before character-foundry work. It is an index into **public authorities that exist in this repository**, not a second contract and not a pointer into historical private work.

## Authority order

1. **Numeric/status authority:** [`docs/teardown/hero_contract.json`](../../../../docs/teardown/hero_contract.json). It is the public contract that currently exists; do not invent a companion schema or validation file that is not present.
2. **Running-game visual authority:** [`docs/GALAQUEST_VISUAL_AUTHORITY.md`](../../../../docs/GALAQUEST_VISUAL_AUTHORITY.md), the current shipped hero/gear, and exact-SHA running-game captures. Runtime pixels beat concept art when they disagree.
3. **Measured character evidence:** [`docs/foundry/construction/hero_measured.json`](../../../../docs/foundry/construction/hero_measured.json), [`docs/foundry/construction/hero_construction_master.png`](../../../../docs/foundry/construction/hero_construction_master.png), and the current fit records under [`docs/foundry/gear/`](../../../../docs/foundry/gear/).
4. **Pipeline procedure:** [`docs/pipeline/README.md`](../../../../docs/pipeline/README.md), [`docs/pipeline/characters-npcs.md`](../../../../docs/pipeline/characters-npcs.md), and [`docs/pipeline/gear.md`](../../../../docs/pipeline/gear.md).
5. **Mechanical validators and tests:** the current scripts under [`tools/foundry/`](../../../../tools/foundry/) and relevant files under [`test/`](../../../../test/). A runbook cannot make a missing dependency or nonexistent command real.
6. **Historical/private material:** provenance only, and only when a bounded task explicitly requires it. It is never a public startup prerequisite and cannot silently override the public contract.

Plans, handoffs, chat history, provider labels, and comparison packs may explain provenance. They do not override a live public contract, current runtime evidence, or an explicit owner decision.

## Current decision boundaries — re-read the live contract every session

- **Proportions:** the contract currently records `proportions.status = owner-locked-final` and `adoptedHeadsTall = 3.84`. Several owner directives inside the same contract remain individually `valueStatus: open`; do not turn those open ranges/directions into arbitrary scalar choices.
- **Topology:** `topology.status = no-gq-target`. Fixed authored connectivity remains the architectural direction, but no comparison-pack quad ratio or ring count becomes a GQ target by imitation.
- **Rig:** the contract pins `deformJointTarget = 30`, `maxInfluencesPerVertex = 4`, and `fingerChains = false`. A count is not permission to invent an undocumented socket/bone list.
- **Surface:** the contract is texture-primary and records a shared-atlas surface contract. Read the actual current values rather than copying numbers into this map.
- **Animation:** runtime clip identity comes from the actual loaded asset. Provider action ids and donor filenames are source metadata, not shipping identifiers.

If a new public artifact supersedes one of these statements, update this map in the same PR. Do not preserve two competing “current” answers.

## Conflict handling

If sources disagree:

1. prefer the live public contract for numeric/status fields it actually governs;
2. prefer exact-SHA runtime evidence for player-visible appearance and interaction;
3. use measured files as evidence, not as permission to create a new lock;
4. treat an unresolved owner choice as a stop condition rather than filling the gap yourself;
5. repair stale public guidance rather than routing around it through a private prerequisite.
