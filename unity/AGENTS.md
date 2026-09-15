# Unity foundation guidance

This directory is the Unity production foundation. Keep these rules durable and project-local.

## Foundation authority

- Pin the Unity Editor to `6000.3.23f1` and use the Universal Render Pipeline (URP) as the production baseline.
- Preserve every Unity `.meta` file and its GUID identity. Unity GUIDs identify Unity assets; they are not GalaQuest semantic IDs and must not become gameplay or content identifiers.
- Use Visible Meta Files and Force Text serialization for project authoring.
- Prefer Unity Editor APIs for scene, prefab, and serialized asset authoring. Direct YAML editing is exceptional; when it is necessary, validate the result through the Unity Editor and its command-line gates.
- Generated Unity directories are derived state, not authority. Do not treat `Library`, `Temp`, `Logs`, `UserSettings`, `obj`, `Builds`, `MemoryCaptures`, or `Recordings` as source truth.
- Do not opportunistically upgrade packages. Change package versions only as part of an explicit, reviewed task.

## Automation and validation

- Read `.agents/skills/galaquest-unity-web-playtest/SKILL.md` for the live-Editor refresh, test-discovery/input, grounding, build-reuse and timeout procedures. Prefer checked-in C# automation for repeatable authoring and validation.
- Discover through the official Unity CLI (`unity editors -i`, `unity status`), not guessed executable paths. Run `tools/unity/preflight.ps1` before declaring the workstation unavailable; its decision logic and tests are `tools/unity/preflight-lib.ps1` and `tools/unity/preflight.tests.ps1`.
- Explicitly set `--project-path` on every `unity command`. Verify the responding `projectPath` and `unityVersion` against the owned checkout and `ProjectVersion.txt`; never close or operate another session's Editor to obtain a target.
- Readiness requires `editor_status` with `status: ready`, `compiling: false` and `domainReloadInProgress: false`. A discovery listing or process is not readiness proof; failed/malformed responses are UNKNOWN. Safe Mode, compile errors and unexplained Console errors fail validation.
- Prefer the already-open owned Editor and CLI/Pipeline loop. Start the pinned Editor on that checkout only when needed; startup and refresh are worker responsibilities, not routine Owner gates. Preserve raw batch mode for CI/fallback/final evidence, not repeated cold iteration.
- Bind generated `.local/unity/review-pack/` evidence to exact source state. For changed Unity-visible work, use `.agents/skills/visual-reference-first/SKILL.md` and `docs/review-guides/asset-visual-review.md`; self-review is not independent acceptance and source/DCC metrics do not replace running pixels.

## Migration boundaries

- Unity is the production client. The retained Three.js client is a legacy/reference diagnostic surface and does not define Unity acceptance.
- The existing Node server and protocol remain authoritative until an approved package explicitly changes them.
- Networking libraries stay behind a GalaQuest-owned abstraction; do not let provider APIs become gameplay contracts.
- Centralize future coordinate conversion rather than scattering axis or unit fixes through content code.
- Future migration importers must be deterministic and idempotent: the same source and settings produce the same result, and rerunning them does not duplicate or drift assets.

## Owner and provider boundaries

- Do not make paid provider calls without explicit Owner authorization for that specific work.
- Do not merge, push to `main`, or force-push without separate authorization.
- Durable guidance must not contain machine-local executable paths, user-specific checkout paths, or environment-specific commands that cannot travel with the repository.
