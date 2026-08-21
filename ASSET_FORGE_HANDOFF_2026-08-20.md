# GalaQuest Asset Forge — Detailed Session Handoff & Progress Report

**Prepared:** 2026-08-20 Mountain time (GitHub timestamps may show 2026-08-21 UTC)  
**Repository:** `Galashots/galaquest-public`  
**Main GalaQuest repository:** `GalaQuest-Public` / `galaquest-public`  
**Active Forge branch:** `feat/asset-forge`  
**Pull request:** PR #27 — `[render preview] feat: add GalaQuest Asset Forge`  
**PR base:** `feat/ranger-lodge-expansion`  
**Audited runtime implementation head before this documentation-only handoff:** `48014308c88e006d603eede0bb08da03ea4e9692`  
**PR state at handoff:** Open, draft, mergeable

---

## 1. Why this document exists

This is the takeover document for the current GalaQuest Asset Forge effort. A fresh agent should be able to read this file, inspect PR #27, and continue without replaying the debugging history or rediscovering why the Forge is built the way it is.

The immediate objective was to create a reliable human-facing manufacturing/fitting surface for GalaQuest gear while keeping Character Studio as the deterministic QA/review environment and keeping shipping gameplay assets protected from experimental candidate work.

The Forge had reached a visually promising state, but a user test revealed a serious problem: the Dawnwarden Helmet could be positioned correctly, while sword rotation appeared not to work at all. Small rotation changes and absurdly large values both appeared ineffective. That exposed that the Forge had been over-tested around the helmet path and under-tested around the full authoring workflow.

Instead of applying a sword-specific patch, the module and its connected systems were audited end-to-end. The result is a much stronger Forge architecture, a real browser acceptance harness, and two owner-approved reference placements.

---

## 2. Owner decisions that are now LOCKED

These decisions came directly from the owner and should be treated as current product direction unless explicitly reversed later.

### 2.1 Dawnwarden Helmet placement is accepted

The Dawnwarden Helmet placement is good and should not be casually re-fit. It is now the reference geometry for the first reusable headgear manufacturing frame:

`headgear-open-face-v1`

That frame is intended as the starting seat/orientation/clearance reference for future open-face helmets. It does **not** imply that every future helmet is automatically accepted, and it does **not** mean closed-face, oversized, horned, hooded, or otherwise structurally different headgear should be forced into the same profile.

### 2.2 Dawnwarden Sword placement is accepted

The owner has now accepted the Dawnwarden Sword placement based on the audited browser proof screenshot showing the corrected sword and proven rotation path.

**Do not continue tweaking the Dawnwarden Sword simply because the old Forge had rotation problems.** The current placement is now the accepted reference placement unless future animation/gameplay qualification reveals a genuine collision or readability issue.

This is a major milestone: both the helmet and sword can now serve as trusted examples for the next phase of gear manufacturing.

### 2.3 Direction after stabilization

Once the Forge is no longer buggy, the intent is to begin producing more gear rather than continuing to spend the project indefinitely on tooling. The accepted Dawnwarden Helmet negative-space/seat relationship should be leveraged as the basis for more headgear.

The right next move is therefore controlled expansion of gear production using reusable fit profiles and explicit acceptance gates, not another broad Forge rewrite.

---

## 3. Current repository / PR state

PR #27 is the active Asset Forge workstream.

At the time of this handoff:

- PR #27 is **open**.
- PR #27 is still a **draft**.
- It is **mergeable**.
- Head branch: `feat/asset-forge`.
- Base branch: `feat/ranger-lodge-expansion`.
- It is intentionally stacked on top of earlier candidate/anatomy work associated with PR #26.
- The audited implementation head before adding this handoff document is:
  `48014308c88e006d603eede0bb08da03ea4e9692`
- The exact audited head was green on:
  - `test`
  - `director-runtime-bundle`
  - `forge-review`

The handoff document itself is documentation-only. If the PR head is later than `480143...`, inspect the commit history and confirm whether only this report/comment was added before treating later runtime changes as audited.

---

## 4. What the Forge is now supposed to be

The Asset Forge is a **human authoring/manufacturing surface**.

It is not supposed to replace Character Studio, and it is not supposed to become the shipping gameplay runtime.

The division of responsibility is:

### Asset Forge

Use for:

- selecting candidate gear;
- fitting candidate gear on the real Hero skeleton;
- world-space position edits;
- world-space rotation edits;
- uniform scale edits;
- multi-angle visual inspection;
- animation inspection;
- semantic anatomy-coverage inspection;
- storing/copying exact fit packets;
- guarded Meshy generation;
- starting new compatible gear from accepted fit profiles.

### Character Studio

Keep as the deterministic QA/review harness for:

- controlled visual comparisons;
- locked loadout states;
- lighting comparison;
- animation sweeps;
- grip/shield measurements and fit envelopes;
- proving candidate vs shipping state truthfully;
- final pre-game qualification.

### Running game

Still the final reality check for:

- gameplay camera readability;
- animation behavior in actual game systems;
- collision/occlusion problems that do not appear in isolated review;
- whether the item is genuinely fun/cool/legible at play distance.

---

## 5. The bug that triggered the audit

The original symptom was simple: helmet adjustment behaved properly, but sword rotation appeared to do nothing. The user tested both small and extremely large rotation changes and saw no useful response.

The audit found that this was not a single sword-specific problem. The Forge had inconsistent transform semantics and insufficient acceptance coverage.

### Old weakness #1 — mixed transform spaces

Position was authored in world XYZ while rotation was authored in local XYZ.

That is a bad human authoring model when an item is attached to a deeply rotated animated bone such as `RightHand`. A user looking at the scene expects “rotate Y” to mean a consistent scene/world axis, not “rotate around whichever local axis the hand/sword already happens to have after multiple inherited rotations.”

### Old weakness #2 — animation could contaminate the authoring frame

A fitting tool must not produce different transforms depending on whether the hand/head happened to be in idle, run, or another animation pose when the user edited a field.

The audited implementation captures a stable reference parent transform and uses a deterministic fit pose for authoring.

### Old weakness #3 — browser proof was too narrow

The earlier real-browser harness proved the helmet Y-position path. That was useful but insufficient. It did not prove:

- switching to the sword;
- sword rotation;
- direct typed rotation values;
- actual candidate geometry moving;
- scale;
- reset after multiple edits;
- edit behavior after animation playback.

That test gap is the reason the Forge could be “green” while the real sword experience was still bad.

---

## 6. Transform architecture after the audit

The canonical fitting implementation is:

`public/src/forge/fitAuthoring.js`

### Schema

New Forge authoring packets use:

`galaquest.asset-forge-fit/2`

### Position

Position deltas are authored in stable **WORLD X / Y / Z** axes.

### Rotation

Rotation deltas are also authored in stable **WORLD X / Y / Z** axes.

The important implementation detail is that world rotation is pre-multiplied over the locked baseline world quaternion, then converted back to the local transform required by the actual parent bone.

This is why the control now corresponds to what the human sees on screen instead of to a confusing bone-local coordinate frame.

### Scale

Scale is uniform and multiplicative around the baseline.

The lower bound prevents inversion: scale delta cannot go below `-0.9`.

### Baseline/reference capture

A Forge fitting session stores the pristine candidate baseline on the anchor and captures:

- local position;
- local quaternion;
- local scale;
- parent matrix world;
- parent world quaternion.

Every edit is baseline-relative rather than accumulated. Reapplying the same fit packet must produce the same transform instead of accumulating numerical/drift errors.

### Why this matters

Animation may move the parent bone afterwards, but the fitted local transform remains stable and follows the skeleton like normal rigid gear. The user is authoring the item’s relationship to its parent using a deterministic reference frame, not the transient pose of an animation frame.

---

## 7. Deterministic Fit Pose

`public/src/forge/main.js` now calls into the Studio scene’s fit-pose behavior before applying authoring edits.

Editing a position, rotation, or scale field returns the Hero to the deterministic fit pose.

Animation is therefore an **inspection mode**, not an authoring frame.

Expected behavior:

1. Select gear.
2. Fit it in the deterministic pose.
3. Play an animation to inspect it.
4. If another transform edit is made, the Hero automatically returns to Fit Pose.
5. The fit itself is preserved and remains deterministic.

Do not remove this behavior merely because it can look like the character “snaps” when a user begins editing after animation. That snap is intentional and protects authored transforms from pose-dependent ambiguity.

---

## 8. Forge controls now proven

The UI in `public/forge.html` and behavior in `public/src/forge/main.js` now expose real human-friendly controls.

### Position nudges

- 1 mm
- 5 mm
- 10 mm

### Rotation nudges

- 1 degree
- 5 degrees
- 15 degrees

### Scale nudges

- 1%
- 2%
- 5%

Direct numeric entry is also supported.

A critical usability fix was made for numeric inputs: an input is not immediately normalized to zero while the user is midway through typing a negative or decimal number. An edit is only applied once the set of fields is parseable.

---

## 9. Saved fit packets and stale-fit protection

Saved browser fits are keyed by:

- Forge schema;
- source SHA;
- asset id.

The key shape is effectively:

`gq-forge-fit:${FORGE_FIT_SCHEMA}:${sourceSha}:${assetId}`

This prevents an old browser fit from being silently re-applied on top of a candidate whose accepted transform has already been baked into repository metadata.

Old schema packets should not be silently treated as current v2 authoring data.

### Important historical compatibility note

The Dawnwarden owner-fit records in `public/src/studio/candidateGear.js` are historical **v1** packets.

That is intentional.

They represent already-approved placements created before the v2 world-rotation authoring model. `candidateGear.js` explicitly preserves the v1 local-rotation interpretation when applying those historical accepted placements.

Do **not** casually “upgrade” those numbers by relabeling them as v2. If the accepted transform needs to be migrated, compute and verify an equivalent transform rather than changing the schema label and hoping the semantics match.

New fitting work should use v2.

---

## 10. Dawnwarden Helmet — accepted manufacturing reference

Candidate:

- ID: `helmet_dawnwarden_v1`
- Bone: `Head`
- GLB: `assets/gear/candidates/dawnwarden-helmet-v1.glb`
- Kind: helmet
- Semantic coverage: `hair`, `ears`
- Target world longest extent: `0.38`

Historical accepted owner fit:

- position world delta: `[0, 0.045, 0]`
- rotation delta: `[0, 0, 0]`
- scale delta: `0`

Accepted effective anchor local position:

`[-0.12855126128084882, 13.826713406476742, -4.365260824014637]`

Accepted anchor local quaternion:

`[-0.15227835255560962, -0.0053021111882924805, 0.005302196102046388, 0.9883092014676261]`

### Reusable profile

The accepted geometry relationship is now captured in:

`public/src/studio/gearFitProfiles.js`

Profile:

`OPEN_FACE_HELMET_PROFILE_V1`

Profile id:

`headgear-open-face-v1`

It captures:

- reference asset id/url;
- reference source SHA;
- `Head` bone;
- target visible extent;
- accepted local seat;
- accepted local orientation;
- `hair + ears` coverage.

### Rule for future headgear

Use this as a **starting frame** for a genuinely similar open-face helmet.

Do not treat it as automatic approval. Each new helmet still needs:

- visual fitting;
- animation sweep;
- anatomy coverage confirmation;
- gameplay/readability review;
- owner acceptance.

---

## 11. Dawnwarden Sword — accepted placement

Candidate:

- ID: `sword_dawnwarden_v1`
- Bone: `RightHand`
- GLB: `assets/gear/candidates/dawnwarden-sword-v1.glb`
- Kind: sword
- Target world longest extent: `0.9`
- Grip fraction from source minimum: `0.12`

Historical owner fit currently baked into candidate metadata:

- position world delta: `[0.09, -0.020000000000000007, 0]`
- rotation delta under historical v1 semantics: `[-64, -13, 40]`
- scale delta: `0`

Accepted effective local position:

`[-1.6385421309043957, 5.85455133950245, 2.4074804446994165]`

Accepted local scale:

`[47.38742650536052, 47.38742650536052, 47.38742650536052]`

The sword mounting path normalizes arbitrary candidate geometry to the expected local +Y sword convention and uses the shipping Ironwood sword anchor as the initial attachment reference before owner fit is applied.

### New owner ruling

As of this handoff, **the owner is happy with the sword placement** based on the audited proof image. Treat this as an accepted placement lock.

### Recommended follow-up

Create a reusable one-handed sword manufacturing profile analogous to `headgear-open-face-v1`, using the accepted Dawnwarden Sword as a reference. This is not yet implemented in the audited head.

Do not rush this by copying the helmet profile structure blindly. The weapon profile should represent weapon-specific concerns such as:

- hand bone;
- grip seat/orientation;
- blade longitudinal axis convention;
- target visible extent;
- grip fraction / normalization assumptions;
- possibly guard-to-hand clearance.

---

## 12. Candidate attachment path

The candidate mounting implementation is:

`public/src/studio/candidateGear.js`

Important rules already embedded there:

- candidate assets remain explicitly separate from shipping gear;
- sword candidates use the shipping sword anchor as the initial mount reference;
- sword payload geometry is normalized to local +Y;
- helmet candidates can use an explicit fit profile;
- new profile-driven helmets start from the accepted frame instead of a fresh geometric guess;
- historical owner fits are applied after initial candidate normalization/mounting;
- attached candidate anchors start hidden until the active loadout selects them.

This file is intentionally a Studio candidate-mounting layer, not a generic production attachment API.

---

## 13. Async candidate selection protection

The Forge now guards against a subtle UI race:

A slow earlier candidate load must not overwrite a faster later selection.

`public/src/forge/main.js` uses a selection revision token and `scene.setLoadout()` is expected to complete transactionally.

If working on candidate loading, preserve this guarantee. It is easy to reintroduce a race if new asynchronous loading work sets `current` or visibility state after a later user selection has already won.

---

## 14. Real browser proof — what is actually tested now

The dedicated browser harness is:

`tools/forge-review/review-forge.mjs`

Workflow:

`.github/workflows/forge-review.yml`

At audited head `480143...`, the real Chrome harness proved all of the following:

1. Forge boots successfully in the browser.
2. Eight real Hero animation clips populate the selector.
3. CI is Meshy-locked and cannot spend credits.
4. Fit packets advertise v2 world-space schema.
5. Dawnwarden Helmet loads as the initial locked candidate.
6. Helmet semantic coverage is exactly `hair + ears`.
7. Forge begins in deterministic fit pose.
8. Helmet +5 mm Y moves the actual anchor +0.005 m in world Y with effectively zero X/Z drift.
9. Helmet Reset restores the exact locked baseline.
10. Switching Helmet → Sword loads the real Dawnwarden Sword candidate.
11. Switching to Sword clears semantic head coverage.
12. Sword begins with accepted owner placement as zero Forge delta.
13. Visible sword rotation nudge writes +5 degrees.
14. The mounted sword anchor quaternion actually changes.
15. A real vertex of the sword candidate geometry actually moves.
16. A large typed sword rotation value is applied rather than swallowed.
17. +2% scale changes every local scale axis.
18. Reset after rotation + scale restores the exact accepted sword baseline.
19. Selecting animation starts playback and animation time actually advances.
20. Editing after animation returns automatically to deterministic Fit Pose.
21. Tablet layout exposes the drawer controls and preserves a real 3D viewport.
22. The owned test server shuts down cleanly.

The harness ended:

`FORGE REVIEW HARNESS GREEN`

### Evidence artifact

The audited run uploaded:

`asset-forge-review-48014308c88e006d603eede0bb08da03ea4e9692`

Artifact ID at the time of this session:

`9434622030`

Retention was configured for 30 days, so future agents should not depend on this artifact existing forever. The test itself is the durable proof.

The evidence set included:

- locked helmet baseline screenshot;
- sword world-rotation proof screenshot;
- audited tablet screenshot.

---

## 15. Why the sword proof is stronger than “the field changed”

A major improvement in the test philosophy is that the browser proof does not stop at checking input values.

For sword rotation it verifies three layers:

1. the visible control changes the requested rotation value;
2. the actual mounted anchor quaternion changes;
3. actual sword geometry moves in world space.

This distinction matters. The old bug could have survived a weak test that only proved an HTML input or internal delta changed while nothing visually meaningful happened.

For future Forge features, prefer this standard: prove the real scene object/geometry changed, not just the control state.

---

## 16. Meshy generation lane

The guarded Meshy bridge lives in:

`net/forgeApi.mjs`

and is wired through `server.mjs`.

Important security/spend behavior:

- Meshy API key remains server-side.
- Supported key locations:
  - `MESHY_API_KEY` environment variable;
  - gitignored `.local/meshy/api-key.txt` fallback for local work.
- Paid actions require `GALAQUEST_FORGE_TOKEN` on the server.
- The browser must send the unlock token.
- Image-to-3D generation is rejected unless `approvedPaidTask: true` is present.
- The UI requires the explicit spend checkbox.
- CI intentionally has no Meshy key/token and proves generation stays locked.
- The browser does not receive the provider API key.
- The browser does not receive a provider-signed model URL; GLB bytes are proxied through the guarded same-origin bridge.
- Character generation can create a task but is intentionally not auto-mounted as Hero gear; it exits to a separate character-intake/rigging lane.

### Spend status for this work

No Meshy credits were spent while building or auditing this Forge stage.

Do not spend Meshy credits in automated tests.

---

## 17. Generated helmet behavior

When a newly generated candidate is a helmet, the Forge now starts it from the accepted open-face helmet profile rather than from a generic “bounding box center a little above the head” guess.

That should massively reduce useless fitting churn for compatible headgear.

This is exactly the intended manufacturing advantage of the profile system: convert one owner-approved placement into a repeatable high-quality starting frame without pretending that profile reuse removes the need for human acceptance.

---

## 18. Current Forge module map

PR #27 currently changes these Forge-related files:

### Browser / UI

- `public/forge.html`
- `public/src/forge/main.js`
- `public/src/forge/responsive.js`

### Fit model

- `public/src/forge/fitAuthoring.js`

### Studio/candidate connection

- `public/src/studio/candidateGear.js`
- `public/src/studio/gearFitProfiles.js`
- `public/src/studio/scene.js`

### Meshy/server bridge

- `net/forgeApi.mjs`
- `server.mjs`

### Tests

- `test/forge-api.test.mjs`
- `test/forge-fit-authoring.test.mjs`
- `test/forge-owner-fit.test.mjs`
- `tools/forge-review/review-forge.mjs`
- `.github/workflows/forge-review.yml`

A new agent should inspect these files before changing Forge behavior. Avoid solving a Forge issue only in `forge.html` or `main.js` without checking the corresponding Studio/candidate and fit layers.

---

## 19. CI / local verification expectations

Before claiming a Forge change is complete, at minimum run/verify:

### Unit tests

`node --test test/*.test.mjs`

### Director runtime bundle

Use the repository’s existing `director-runtime-bundle` workflow/check.

### Real browser Forge review

`node tools/forge-review/review-forge.mjs`

The GitHub `forge-review` workflow launches isolated Chrome and runs the browser proof.

If working locally, the harness expects its owned server/browser infrastructure as defined by the script/workflow. Do not replace the real-browser acceptance with only unit tests.

---

## 20. Preview environment

A Vercel preview/alias was created during this session for manual Forge inspection:

`https://galaquest-forge-runtime-galashots1.vercel.app/forge.html`

Treat hosting URLs as a convenience, not the source of truth. The repository code, exact commit SHA, and browser harness are authoritative. If the preview appears stale, verify against the branch and hard-refresh before assuming the code regressed.

---

## 21. What is accepted vs what is still only candidate status

This distinction is important.

### Accepted now

- Dawnwarden Helmet **placement**.
- Dawnwarden Sword **placement**.
- Forge world-space authoring model.
- Deterministic fit-pose behavior.
- Helmet open-face manufacturing profile as a reusable starting frame.
- Browser test strategy that verifies actual scene geometry.

### Not automatically accepted/shipping yet

The Dawnwarden GLBs are still under candidate paths and the source code itself warns that candidate placement is not the same thing as full production qualification.

Before actual shipping promotion, still require appropriate:

- animation sweeps;
- Character Studio review;
- running-game visual review;
- final owner signoff on the asset as a production item;
- any asset cleanup/re-export work required for shipping quality.

Do not equate “placement accepted” with “all production gates complete.”

---

## 22. Things a new agent should NOT regress

1. **Do not restore local-space rotation controls** for the human Forge UI.
2. **Do not author transforms from whatever animation pose happens to be playing.**
3. **Do not remove the deterministic Fit Pose transition on edit.**
4. **Do not collapse Forge and Character Studio into one giant page/system.**
5. **Do not let candidate gear masquerade as shipping gear.**
6. **Do not silently load old fit schemas as v2.**
7. **Do not double-apply owner fits from local storage after they are baked into metadata.**
8. **Do not remove source-SHA/schema fit versioning.**
9. **Do not let async candidate loads overwrite newer user selections.**
10. **Do not judge a transform fix only from HTML input state.** Verify the actual mounted object/geometry.
11. **Do not spend Meshy credits in CI or without explicit human approval.**
12. **Do not treat `headgear-open-face-v1` as a universal helmet fit.**
13. **Do not casually move the accepted Dawnwarden Helmet or Sword.** Both placements are now owner-approved.

---

## 23. Recommended next implementation step: sword manufacturing profile

Now that the sword placement is approved, the next small infrastructure task should be to distill that accepted placement into a reusable weapon fit profile, analogous to the open-face helmet profile.

Suggested concept:

`weapon-onehand-sword-v1`

Potential fields:

- reference asset id/url;
- reference source SHA;
- `RightHand` bone;
- accepted grip-seat local position;
- accepted orientation;
- target visible extent;
- canonical longitudinal-axis convention (`+Y` after normalization);
- grip fraction / grip point assumption;
- optional guard/hand clearance metadata.

Keep the profile as a starting manufacturing frame, not an auto-acceptance mechanism.

This should be a contained task. Do not turn it into a new generic attachment framework unless real additional gear types prove that generalization is needed.

---

## 24. Recommended next content step: start making gear

The tooling is finally good enough that the project should begin harvesting value from it.

The best first production batch is **more headgear based on the accepted open-face profile**, because:

- the reference frame is already locked;
- the semantic hide rules are understood (`hair + ears` for this family);
- helmets create a strong visible silhouette change;
- they are relatively isolated rigid attachments compared with deformable chest/leg armor;
- they are ideal for proving that the profile system actually reduces production time.

Recommended initial batch:

- 3–5 visually distinct open-face helmets;
- deliberately varied silhouettes/material themes rather than tiny cosmetic variations;
- keep them candidate-only until visual/animation/gameplay acceptance;
- measure whether starting from `headgear-open-face-v1` genuinely reduces manual fitting time.

After that, create additional fit families only when a real asset demands them, e.g.:

- closed-face helmet;
- oversized/horned helmet;
- one-handed sword;
- shield;
- rigid shoulder item;
- back item.

Avoid making a giant taxonomy before real assets demonstrate the need.

---

## 25. Recommended gear acceptance pipeline going forward

Use a repeatable staged pipeline:

### Stage A — Concept / generation

- Produce or select reference.
- Generate/import candidate bytes.
- Keep candidate path/provenance explicit.

### Stage B — Normalize

- Correct axis/orientation assumptions.
- Correct obvious generated-material/export defects for review.
- Choose the closest accepted fit profile if appropriate.

### Stage C — Forge fit

- Fit in deterministic Fit Pose.
- Use world-space position/rotation.
- Save/copy exact packet.
- Owner accepts placement.

### Stage D — Animation qualification

- Sweep representative clips.
- Check hand/head clearance.
- Check silhouette and clipping.

### Stage E — Character Studio QA

- Compare against shipping baseline.
- Use locked views/lighting.
- Measure where useful.

### Stage F — Running-game qualification

- Test at real gameplay camera distance.
- Confirm readability and cool factor.
- Confirm no gameplay-only clipping/occlusion issues.

### Stage G — Promotion

- Only after acceptance, move from candidate semantics/path to production/shipping architecture as appropriate.
- Preserve provenance and tests.

---

## 26. Product/design direction behind the Forge

The larger GalaQuest asset strategy is not to replace a character that is already coherent merely to spend generation credits. The highest-value art investment is gear progression that materially changes silhouette and fantasy:

- big weapons;
- memorable helmets;
- strong shoulder shapes;
- distinctive shields;
- visible back items;
- eventually class-defining armor/equipment sets;
- a smaller number of aspirational “holy crap” endgame pieces.

At gameplay distance, silhouette and high-level material/color changes matter more than tiny surface details.

The Forge should therefore optimize for **fast, trustworthy iteration on visible progression gear**, not become an end in itself.

---

## 27. Known limitations / remaining risks

### PR stacking

PR #27 is stacked and currently bases on `feat/ranger-lodge-expansion`, not directly on `main`. Before merge, confirm dependency/retargeting order with PR #26 and the expansion branch.

### Candidate status

The accepted helmet and sword placements are still candidate assets. Placement approval alone is not production qualification.

### Profile coverage

Only the first open-face helmet profile is currently formalized. Other categories should not be forced into it.

### Historical v1 accepted fits

The Dawnwarden accepted placement packets use v1 semantics. This is supported deliberately. Avoid accidental schema reinterpretation.

### Meshy live generation

The bridge is guarded, but live generation still depends on deployment/server environment configuration. CI intentionally does not prove paid provider execution.

### Preview hosting

A hosted preview can become stale or change. Verify exact branch SHA when debugging apparent UI/runtime differences.

---

## 28. Suggested fresh-session startup procedure

A new agent should do this in order:

1. Treat `Galashots/galaquest-public` / `GalaQuest-Public` as the main repo.
2. Open PR #27 and inspect its current head/base/state.
3. Read this handoff fully.
4. Compare current branch head against audited runtime head `480143...`.
5. Inspect any commits after the handoff to identify whether runtime code changed.
6. Read the Forge module map in Section 18 before editing.
7. Preserve the accepted Dawnwarden Helmet and Sword placements.
8. Run/inspect unit + runtime-bundle + real browser Forge proof before declaring a new Forge change stable.
9. Prefer moving into gear production over another broad tooling rewrite unless a concrete production blocker is demonstrated.

---

## 29. Recommended next-session mission

The strongest next-session mission is:

> Treat the Forge core as provisionally stabilized. First formalize the accepted Dawnwarden Sword into a reusable one-handed sword fit profile, with tests that prove the profile reproduces the accepted placement. Then use the accepted `headgear-open-face-v1` frame to begin a small batch of new, visually distinct open-face helmet candidates. Keep all new assets candidate-only, run Forge + animation + Studio review, and do not change the accepted Dawnwarden Helmet/Sword placements unless qualification uncovers a real defect.

That mission gives the project immediate content value while still closing the last obvious reusable-manufacturing gap on weapons.

---

## 30. Short status summary for an agent that only has 60 seconds

- Main repo: `Galashots/galaquest-public`.
- Active Forge PR: #27, branch `feat/asset-forge`, draft/open/mergeable.
- Audited runtime head: `48014308c88e006d603eede0bb08da03ea4e9692`.
- Helmet placement: **OWNER ACCEPTED**.
- Sword placement: **OWNER ACCEPTED**.
- Helmet reusable profile exists: `headgear-open-face-v1`.
- Sword reusable profile: **next recommended small infrastructure task**.
- Forge authoring schema: `galaquest.asset-forge-fit/2`.
- Position: WORLD XYZ.
- Rotation: WORLD XYZ.
- Editing returns Hero to deterministic Fit Pose.
- Browser harness proves real sword geometry moves under rotation.
- `test`, `director-runtime-bundle`, `forge-review`: green at audited head.
- Meshy credits spent during Forge build/audit: **0**.
- Next focus: **start producing more gear**, beginning with open-face helmets, rather than another broad Forge rewrite.

---

## 31. Source-of-truth files to read first

In priority order:

1. `ASSET_FORGE_HANDOFF_2026-08-20.md` — this document.
2. `public/src/forge/fitAuthoring.js` — transform semantics.
3. `public/src/forge/main.js` — human workflow, input parsing, Fit Pose, selection, Meshy UI integration.
4. `public/src/studio/gearFitProfiles.js` — accepted reusable manufacturing frames.
5. `public/src/studio/candidateGear.js` — candidate normalization, mount behavior, historical accepted fits.
6. `public/src/studio/scene.js` — real Hero scene, loadouts, animation, Fit Pose and review integration.
7. `tools/forge-review/review-forge.mjs` — real browser acceptance contract.
8. `.github/workflows/forge-review.yml` — CI execution contract.
9. `net/forgeApi.mjs` — guarded Meshy provider bridge.
10. PR #27 conversation/history for owner decisions and proof context.

---

## 32. Final handoff note

The important change in this session was not merely “sword rotation got fixed.” The Forge graduated from a promising tool with a helmet-centric happy path into a much more defensible manufacturing surface with consistent transform semantics and real browser proof of the complete first gear-fitting workflow.

The project should now exploit that work. The helmet and sword are both placement-locked. The next phase should create visible gear, validate that reusable fit profiles actually accelerate production, and only expand the tooling where real new gear categories expose a concrete need.
