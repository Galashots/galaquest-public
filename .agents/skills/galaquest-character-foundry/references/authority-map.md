# GalaQuest character authority map

Read this map before character-foundry work. It is an index, not a second contract.

## Authority order

1. **Numeric/status authority:** [`docs/teardown/hero_contract.json`](../../../../docs/teardown/hero_contract.json), constrained by [`hero_contract.schema.json`](../../../../docs/teardown/hero_contract.schema.json) and [`tools/teardown/test/contract.test.mjs`](../../../../tools/teardown/test/contract.test.mjs).
2. **Architecture and workflow authority:** [`the private engineering archive`](../../../../the private engineering archive), especially sections 5–10 and 13.
3. **Owner-decision evidence:** [`the private engineering archive`](../../../../the private engineering archive) and immutable records such as [`2026-08-09-owner-decisions.json`](../../../../the private engineering archive). Records show what the owner saw and chose; the contract/schema are what act on a decision.
4. **Current proportion decision surface:** newest files under `docs/proportions/`, their candidate profiles under `tools/decision-lab/public/`, and the related tests/handoffs. For the current body lead, read [`2026-08-09-photo-1-reference.md`](../../../../docs/proportions/2026-08-09-photo-1-reference.md), [`2026-08-09-photo-1-body-lead-lock.json`](../../../../docs/proportions/2026-08-09-photo-1-body-lead-lock.json), its [`owner-decision record`](../../../../the private engineering archive), the unchanged [`proportion-reference-draft.json`](../../../../tools/decision-lab/public/proportion-reference-draft.json), and [`proportion-lead-lock.test.mjs`](../../../../tools/teardown/test/proportion-lead-lock.test.mjs).
5. **Comparative evidence only:** [`docs/teardown/STAGE_T_REFERENCE_BASELINES.md`](../../../../docs/teardown/STAGE_T_REFERENCE_BASELINES.md) and [`docs/teardown/report.md`](../../../../docs/teardown/report.md). These describe other people's assets and may not set GQ targets.

Plans and handoffs explain sequencing and history but do not override the live contract, schema, or a newer owner artifact. Generic Game Studio guidance is advisory only.

## Current decision boundaries — re-check live files every session

- **The Photo 1 non-foot body profile is the owner-locked lead; feet remain open.** the owner judged the rendered match on 2026-08-09. Use the body-only lock artifact above for head, torso, arms, hands, legs, and their relationships. Do not use the current wedge foot as approved geometry. The live hero contract still records the historical 4.5 adopted working value, so it is stale for production proportion direction until the complete foot choice is made and the contract/schema change is proposed. This partial lock does not satisfy the real-iPad/children gate or finally lock the complete hero profile.
- **Topology architecture is settled; the specific GQ topology target is not.** `topology.status` is `no-gq-target`. Fixed authored connectivity is required, but no comparison-pack quad ratio or ring count is normative.
- **The rig count is decided; the complete joint/socket list is not supplied by that count.** The live contract pins 30 deform joints and four influences. The spec explicitly says 30 is a budget, not an enumerated bone list.
- **Several morphology values remain open directives.** Do not pick midpoints for shoulder or hand ranges, invent a foot size, turn a limb-thickness direction into a scalar, or invent the silhouette threshold for the torso-cross-section directive.
- **Animation coverage is incomplete.** Strafe-left, strafe-right, backpedal, and the three casting phases remain source/authoring and validation work.
- **Wardrobe-scale texture assembly is open.** P0 pins the current per-character surface contract; it does not decide the eventual arbitrary-wardrobe atlas strategy.

## Conflict handling

If sources disagree:

1. Prefer the live schema/contract for current values and status.
2. Prefer the ratified spec for architecture and validation method.
3. Use owner records to prove a decision, never to silently reinterpret it.
4. Treat a newer unresolved candidate as a blocker, not permission to overwrite an older working value.
5. Report the conflict and stop at the owner boundary.

Historical implementation plans contain superseded passages, including retired ring targets and downstream 4.5-head assumptions. Read their explicit amendments, but do not use those passages as authority.
