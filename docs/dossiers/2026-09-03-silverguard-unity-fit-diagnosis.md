# Silverguard Unity fit diagnosis

Date: 2026-09-03  
Scope: PR #135, `unity-visible-armor-proof`  
Evaluated source head: `994b166aadcdd1f22337690df88edd4c889dd58c`  
Clean recovery checkout: `C:\Users\Leo\Documents\GalaQuestWorktrees\unity-visible-armor-proof-recovery-lf`  
Starting public remote heads: `main=90c0e457bde31fa8cb6f4c02c5d99ba004ba7fa6`, `feat/unity-visible-armor-proof=994b166aadcdd1f22337690df88edd4c889dd58c`

## Outcome

The strongest diagnosis is **A: a legacy/source-fit defect**, not a demonstrated Unity coordinate
conversion defect. The accepted Silverguard Helmet fit is too large/low for the intended open-faced
read on this Hero. The Unity migration seam is mechanically covered by tests, but a full independent
source-to-FBX vertex residual was not reproduced in this run. Therefore the diagnosis is not a
production fit fix and Owner/runtime acceptance remains **UNKNOWN**.

No runtime fit constant, Hero rig, helmet bytes, Foundry record, or Unity proof asset was changed.

## Visual convention used

The reference pass looked at open-faced WoW helmet examples from front, three-quarter, and side
views. The convention extracted was: **an open-faced helm sits close to the crown and brow while
leaving the eye line and most of the face readable; substantial eye-line occlusion is a closed or
mask-like helm, not an open-faced Tier 3 marker.** This agrees with the public visual authority's
Tier 3 rule: “open-faced helmet” and preserved face identity.

## Evidence matrix

| Hypothesis | Evidence for | Evidence against / limit | Status |
| --- | --- | --- | --- |
| A. Legacy/source fit defect | `docs/foundry/gear/tier3_fit.json` requires a large 0.50-world-unit helmet, a Z squash of 0.857 “to make it fit at all,” and records a crown/eye clearance assumption. `tier3_fit_measured.json` gives source-space bounds down to z=1.199346 and up to z=1.539970. The current visual authority says future helmets should start shorter/fitted rather than rely on a large squash. PR #135's review record reports that the native Unity view occludes much of the face/eyes. | `public/src/character/gear.js` contains a prior four-angle face-clear judgment. The current Three.js `fit-helmet` harness could not be rerun because the isolated Chrome CDP endpoint on 9224 was unavailable, so that historical judgment was not independently reproduced. | **Primary / likely** |
| B. Migration / coordinate defect | A wrong basis would be a plausible cause of a visually displaced helmet. The PR's `VisibleArmorFitPlacement` explicitly applies the source-to-Unity basis and imported-FBX inverse; the Unity coordinate fixture and visible-armor EditMode/PlayMode checks passed. | I did not independently calculate a complete vertex-by-vertex GLB-to-FBX residual in this run. Passing the seam tests proves the tested mapping, not every imported vertex/material result. | **Not supported by current tests; not fully ruled out** |
| C. Import representation defect | The Unity package uses native FBX derivatives, so importer/material/scale behavior remains a possible secondary source of a visual difference. | The PR provenance binds the Hero and helmet source hashes and the derivative hashes; no import exception or failed asset validation was observed. There is no isolated importer-vs-source pixel/vertex comparison in the current evidence. | **Plausible but unproven** |
| D. UNKNOWN | Running-game visual acceptance was not obtained in this recovery: Chrome 9224 was unavailable and the Unity capture command did not produce a completed capture set. | Independent source-fit measurements and the existing PR review observation point more strongly to A than to a completely unknown cause. | **Acceptance remains UNKNOWN; diagnosis leans A** |

## Fit authority and recommendation

The current runtime authority is still `public/src/character/gear.js`, specifically
`RIGID_SILVERGUARD_HELMET`. The Foundry JSON remains measurement/reference evidence, and Unity
should continue consuming the canonical runtime fit through the migration seam rather than storing a
second Unity-only correction.

No corrected transform is proposed here. A defensible correction needs a source-space fit pass against
the open-face convention, followed by current Hero gameplay pixels at front, three-quarter, and side
angles. Do not repair this by adding an unexplained Unity nudge: that would conceal whether the source
fit or the imported representation is wrong. If the source fit is corrected, update the single runtime
authority first, then regenerate/bind the Unity derivatives and provenance to the same source SHA.

## Verification performed

- Fresh public clone; local recovery branch: `codex/recover-pr135-silverguard-diagnosis-lf`.
- `node --test test/unity-visible-armor-export.test.mjs`: **3 passed, 0 failed**.
- `node --test test/*.test.mjs`: **2240 passed, 1 failed, 3 skipped**. The one failure was the known
  Windows `EPERM` cleanup failure in `test/lantern-xp-award.test.mjs`; no GalaQuest assertion failed.
- `node tools/foundry/inspect_prop_candidate.mjs public/assets/gear/helmet_silverguard.glb`: **330
  triangles, 1 draw, 0.07 MB**, static prop.
- `node tools/foundry/pose_anatomy.mjs public/assets/hero/hero_lod1_ironwood_atlas.glb` and `idle`:
  completed successfully; the Hero skeleton/TRS bind checks passed. This is anatomy evidence, not fit
  acceptance.
- Unity 6000.3.23f1 `EditMode`: **16/16 passed**.
- Unity 6000.3.23f1 `PlayMode`: **4/4 passed**, including the visible-armor toggle test.
- Unity foundation validation: **passed**; three enabled scenes and URP asset were found.
- Windows Standalone build: **successful**; artifact was produced at `.local/unity/builds/windows/GalaQuest.exe`.
- WebGL build: **not completed**. The CLI invocation stopped producing progress before creating
  `.local/unity/builds/webgl`; this is an infrastructure/wrapper result, not a WebGL product failure.
- Unity review capture: **not obtained**. The batch capture did not produce images, and no editor render
  is being promoted to running-game evidence.
- Hosted Three.js fit harness: **not independently rerun** because `127.0.0.1:9224` had no CDP
  endpoint. This does not prove the hosted fit is broken or that PR #135 caused it.

Unity operations caused no tracked worktree drift after restoring the one generated settings asset.
The user's dirty root checkout at `C:\Users\Leo\Desktop\galaquest` was not inspected for repair and
was left untouched. The capture/evidence boundary follows GQ-010 and GQ-022: a capture must contain
the subject, and an instrument is not evidence until it has demonstrated the relevant failure.

## Remaining UNKNOWNs

1. Owner acceptance of the exact Unity-visible helmet remains UNKNOWN.
2. Current running-game pixels for the exact PR head remain UNKNOWN.
3. A complete GLB-to-FBX vertex residual and importer representation comparison remain UNKNOWN.
4. A corrected source-space open-face fit remains UNKNOWN; no candidate was silently promoted.
5. WebGL build completion remains UNKNOWN because the Unity CLI wrapper hung.

