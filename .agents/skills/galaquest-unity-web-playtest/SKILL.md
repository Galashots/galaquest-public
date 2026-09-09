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
- Run one Unity batch operation per project. Follow its existing process/session to termination;
  a tool observation timeout is not a failed build and does not justify launching another.
- When a known healthy batch build is active, wait on that process instead of issuing frequent status
  probes or log tails. Reinspect only when completion is expected or elapsed time materially exceeds the
  established baseline.
- Use the checked-in build entry point appropriate to the current asset state. Candidate build
  helpers and their manifests do not grant asset promotion or replace the normal release build.

## Refresh external edits through the live Editor

After changing assets or scripts outside Unity, use the connected Editor's refresh menu through CLI.
This works without Computer Use screenshots or an Owner click to focus the Editor.

```powershell
unity status --format json
unity command editor_status --format json
unity command menu --path 'Assets/Refresh' --format json
unity command editor_status --format json
```

Before refreshing, verify the reported project path is the intended owned checkout and the Editor is
ready, with Play Mode stopped and no compilation/domain reload in progress. If multiple Editors are
connected, select the intended target using the installed CLI's help before issuing commands.

Require the menu result to confirm execution, then allow any import/compilation to finish. Check the
Editor log/Console for errors and verify the changed asset or script was actually imported before
using it as evidence. A successful menu request or `unity status` alone does not prove import completion;
use `editor_status` to confirm readiness. A no-change refresh timing is not a changed-asset benchmark.

If a command times out, its outcome is unknown: inspect the existing Editor/log and wait for active
work before retrying. If Pipeline is unavailable, diagnose project identity, startup, compilation and
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
- A successful driver proves its assertions. Inspect the generated running-game images separately,
  following `docs/review-guides/asset-visual-review.md` for changed visuals. Record the strongest
  remaining defect. Desktop input and screenshots cannot establish physical iPad acceptance.
- Keep new incidents in the checkpoint or mistakes ledger; update this procedure only with reusable
  corrections. Keep root `AGENTS.md` as the short routing and authority surface.
