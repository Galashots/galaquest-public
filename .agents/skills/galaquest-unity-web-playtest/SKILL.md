---
name: galaquest-unity-web-playtest
description: Build and verify GalaQuest's Unity WebGL client. Use for Unity browser regressions, candidate review builds, build-cache decisions, and client/server evidence provenance.
---

# GalaQuest Unity Web Playtest

## Choose the execution surface

- Follow `docs/WORKFLOW.md` for branch authority. An authorized sequential package can reuse a clean,
  owned Unity checkout and its Library cache; a new package does not inherently need another import.
- **Local preflight:** when Unity is installed on the workstation, start the pinned GalaQuest Editor on
  the intended owned checkout before iterative work if it is not already open. Wait for initial import
  and script compilation to settle, confirm the intended project/checkout and no Safe Mode or unexplained
  compile errors, and keep that Editor/project open through the iteration loop when practical. The worker
  owns this startup; do not make the Owner pre-open Unity.
- Prefer the connected Unity CLI/Pipeline/live Editor for local scene, prefab, authoring, focused-test,
  and review-camera iteration when available. A cold batch launch is a CI/fallback/final-evidence path,
  not the ordinary local edit-test loop.
- Keep Unity test and batch commands on `-buildTarget WebGL`. Switching build targets can invalidate
  useful imports and build cache even when gameplay source has not changed.
- Run one Unity batch operation per project and follow its existing process/session to termination.
  A client/connector observation timeout that does not inject an Editor error leaves the outcome UNKNOWN;
  inspect the original operation and do not launch another one merely because observation stopped.
- Treat an Editor/Pipeline execution timeout as part of the operation when it reaches the Editor. If a
  `run_script` `timeout_ms` or another Editor request emits `LogError`, reports a main-thread operation
  timeout, or makes StrictMode/build validation fail, that build gate is FAIL even when compilation or
  linking workers continue afterward. Before a known long strict build, size the run-specific request
  timeout above the established healthy baseline. After an injected timeout, preserve the failed receipt,
  follow the original workers to termination, verify settings/scene/source restoration and cleanliness,
  then retry unchanged inputs with only the observation/request budget changed when that is the causal fix.
- When a known healthy batch build is active, wait on that process instead of issuing frequent status
  probes or log tails. Reinspect only when completion is expected or elapsed time materially exceeds the
  established baseline.
- Use the checked-in build entry point appropriate to the current asset state. Candidate build
  helpers and their manifests do not grant asset promotion or replace the normal release build.

## Refresh external edits through the live Editor

After changing assets or scripts outside Unity, use the connected Editor's refresh menu through CLI.
This works without Computer Use screenshots or an Owner click to focus the Editor.
Run these commands from the intended repository root:

```powershell
$project = (Resolve-Path 'unity/GalaQuest').Path
pwsh -NoProfile -File tools/unity/preflight.ps1
if ($LASTEXITCODE -ne 0) { throw 'Unity preflight failed; do not refresh.' }
unity status --format json
unity command editor_status --project-path "$project" --format json
unity command menu --project-path "$project" --path 'Assets/Refresh' --format json
unity command editor_status --project-path "$project" --format json
```

Before refreshing, verify the reported project path is the intended owned checkout and the Editor is
ready, with Play Mode stopped and no compilation/domain reload in progress. Every Editor command
must explicitly target that project, even when only one Editor is connected. Verify the responding
project path and pinned Editor version; a discovery listing alone is not readiness evidence.

Require the menu result to confirm execution, then allow any import/compilation to finish. Check the
Editor log/Console for errors and verify the changed asset or script was actually imported before
using it as evidence. A successful menu request or `unity status` alone does not prove import completion;
use `editor_status` to confirm readiness. A no-change refresh timing is not a changed-asset benchmark.

If a command times out **without** an Editor/Pipeline error, its outcome is UNKNOWN: inspect the existing
Editor/log and wait for active work before retrying. If the timed-out request itself emitted an Editor
error or failed StrictMode/build validation, use the FAIL handling above rather than relabelling it as an
observation timeout. If Pipeline is unavailable, diagnose project identity, startup, compilation and
Safe Mode first. Where supported, screenshot-free native window activation is a focus fallback, but
verify that a refresh actually occurred. Request Owner input only when available control paths fail;
do not substitute Reimport All, a build-target switch, or another cold Editor launch for a routine refresh.

## Build after the cheaper checks

When a cold test launch repeats a Material Upgrader import, compare the persisted URP project upgrade
marker with the pinned package's upgrader count and the versioned material assets. Test-mode upgrade
state can remain in memory only. Inspect and commit the pinned Editor's completed migration output
(including project settings) when appropriate; never bump the marker alone to bypass an unapplied
migration. Recheck the affected materials and subsequent imports before claiming a timing improvement.

1. Reproduce and fix the behavior with the narrowest meaningful JavaScript/Unity tests first.
2. For authored interactions, preflight the intended gameplay camera in Editor/PlayMode before WebGL:
   active collider, reachable/ordered raycast, projected screen position, and basic gameplay-frame
   legibility/HUD overlap. Do not pay IL2CPP/WebAssembly cost to discover a defect the Editor can expose.
   For a claim about default-state discoverability or readability, assert every required task control in
   the target viewport **before** scripted orbit, recenter, reposition, zoom, or other corrective camera
   input. A helper action that makes a control visible cannot prove it was visible on arrival. If the
   intended player flow genuinely requires adjusting the view first, the cue and that action are part of
   the product requirement and must be exercised as such rather than hidden in harness setup. When a
   sibling, enemy, world label, or other presentation can overlap the controls, include at least one
   crowded/interference state at the narrow target viewport before accepting the layout.
3. Treat generated review inputs as cache inputs. If a build helper rewrites unchanged temporary assets,
   dirties its generated scene, or otherwise invalidates the incremental build merely because it ran,
   stop the repeat-build loop and make the generator a content-hash no-op or reuse the stable generated
   inputs before continuing.
4. Settle and commit the runtime inputs before a browser evidence build. Do not edit its inputs
   while the build runs. Preserve source-cleanliness and output-hash guards.
5. For candidate iteration, `U2CombatPreview` supports `GQ_FAST_REVIEW_BUILD=1`: BuildTimes
   optimization and disabled compression, restored after the build. Record that flavor in evidence.
   A first native compilation can still be expensive; do not promise a speedup without measurement.
6. Reuse a verified build for checks whose client inputs have not changed. Use a fast review build only
   for a claim that genuinely requires the built browser client. Reserve the full optimized WebGL build
   for a checkpoint/final/performance gate, not ordinary coordinate, label, camera, or interaction tuning.
   Physical iPad Safari acceptance remains a separate gate.

## Use the matching browser harness

- Unity manifest-based drivers belong in `tools/unity-playtest/`. Read its `README.md` for runnable
  commands, manifest requirements and browser configuration.
- `tools/runtime-test/` is discovered by the legacy Three.js suites. Those launchers do not provide
  Unity builds. Do not place a Unity-only driver there or register it without supplying its actual
  launch prerequisites. Reuse the existing owned-server helper across the two driver surfaces.
- For session/travel changes, preserve the negative-path checklist in that README: open old sockets,
  queued contribution, same-room observer snapshots, invalid/missing acknowledgements and retired callbacks.
- Start isolated browser contexts and clear the owned origin before seeding fixture profiles.
  Exercise real input and close only the browser/server processes owned by the driver.

## Bind and inspect the evidence

- Record the Unity client build SHA and Node server SHA separately, plus build hashes. If deliberately
  running an older client against a newer server, verify the relevant source diff and keep both SHAs;
  do not relabel old pixels as a new build.
- This skill owns Unity/WebGL execution and provenance, not artistic acceptance. A successful driver proves
  its assertions only. For changed visuals, use `.agents/skills/visual-reference-first/SKILL.md` for the
  make/look/fix loop and `docs/review-guides/asset-visual-review.md` for evidence/acceptance. Desktop input
  and screenshots cannot establish physical iPad acceptance.
- Keep new incidents in the checkpoint or mistakes ledger; update this procedure only with reusable
  corrections. Keep root `AGENTS.md` as the short routing and authority surface.
