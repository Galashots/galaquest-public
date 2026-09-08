---
name: galaquest-unity-web-playtest
description: Build and verify GalaQuest's Unity WebGL client. Use for Unity browser regressions, candidate review builds, build-cache decisions, and client/server evidence provenance.
---

# GalaQuest Unity Web Playtest

## Choose the execution surface

- Follow `docs/WORKFLOW.md` for branch authority. An authorized sequential package can reuse a clean,
  owned Unity checkout and its Library cache; a new package does not inherently need another import.
- Keep Unity test and batch commands on `-buildTarget WebGL`. Switching build targets can invalidate
  useful imports and build cache even when gameplay source has not changed.
- Run one Unity batch operation per project. Follow its existing process/session to termination;
  a tool observation timeout is not a failed build and does not justify launching another.
- Use the checked-in build entry point appropriate to the current asset state. Candidate build
  helpers and their manifests do not grant asset promotion or replace the normal release build.

## Build after the cheaper checks

1. Reproduce and fix the behavior with the narrowest meaningful JavaScript/Unity tests first.
2. Settle and commit the runtime inputs before a browser evidence build. Do not edit its inputs
   while the build runs. Preserve source-cleanliness and output-hash guards.
3. For candidate iteration, `U2CombatPreview` supports `GQ_FAST_REVIEW_BUILD=1`: BuildTimes
   optimization and disabled compression, restored after the build. Record that flavor in evidence.
   A first native compilation can still be expensive; do not promise a speedup without measurement.
4. Reuse a verified build for checks whose client inputs have not changed. Final optimized-build
   performance and physical iPad Safari acceptance remain separate gates.

## Use the matching browser harness

- Unity manifest-based drivers belong in `tools/unity-playtest/`. Read its `README.md` for runnable
  commands, manifest requirements and browser configuration.
- `tools/runtime-test/` is discovered by the legacy Three.js suites. Those launchers do not provide
  Unity builds. Do not place a Unity-only driver there or register it without supplying its actual
  launch prerequisites. Reuse the existing owned-server helper across the two driver surfaces.
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
