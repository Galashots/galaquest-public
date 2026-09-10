# Unity Build Automation bridge

This is the narrow cloud seam for the existing `U2CombatPreview` review build. It does not promote the
lava gremlin candidate, publish Drive files, enable schedules, or create a second build system.

## What the bridge does

Unity Build Automation checks out an exact revision and restores its workspace cache. The checked-in
pre-build hook then downloads the two ignored custody inputs into the paths already used by
`U2CombatPreview`, using controlled HTTPS URLs and verifying both byte size and SHA-256 before Unity
starts. It never logs the URLs or bearer token and never accepts a public Google Drive link.

`PreExport()` first proves the checkout is clean, then seeds the Editor's scene state. Unity always keeps
at least one scene open, and Build Automation starts on its own unsaved untitled scene, so no amount of
closing scenes can reach the named-scene state the preview authoring requires: closing the last scene
fails. `SeedBatchModeScene()` therefore opens the committed
`Assets/GalaQuest/Emberworks/Scenes/EmberworksDeep.unity` with `OpenSceneMode.Single`, which replaces the
host's untitled scene with one named, saved scene. It runs in batch mode only, so an interactive Editor
never has scene state replaced and unsaved developer work still stops the build through
`RequireNamedScenes()`. `BuildWebGL` seeds the same way for local `-batchmode` runs. Both authoring flows
below stay additive.

The existing `U2CombatPreview.PreExport()` method then calls `Prepare()` and `PrepareScene()`, and temporarily
sets `EditorBuildSettings.scenes` to the generated
`Assets/U2CombatPreviewTemporary/EmberworksFightPreview.unity`. This prevents the cloud build from
silently using the checked-in default scene. `PostExport(string)` writes
`candidate-build-manifest.json` beside the WebGL `Build/` directory and records the exact checked-out
SHA, the candidate input hashes, and the hashes of every WebGL output file.

The direct local method remains `GalaQuest.Editor.U2CombatPreview.BuildWebGL`. It still uses the same
preparation, scene, input validation, deterministic output directory, and manifest writer.

## Unity Build Automation configuration

The Owner-created target should retain these Basic settings:

- repository: `Galashots/galaquest-public`
- Project subdirectory: `unity/GalaQuest`
- platform: WebGL
- Unity: `6000.3.23f1`
- builder: Windows MICRO
- workspace caching: enabled
- cache compression: low
- automatic builds: off
- schedules: off
- cloud tests: off

In Advanced settings set (script paths resolve from the configured Unity project subdirectory):

- Pre-build script: `../../tools/unity-build-automation/provision-u2-review-inputs.sh`
- Pre-export method: `GalaQuest.Editor.U2CombatPreview.PreExport`
- Post-export method: `GalaQuest.Editor.U2CombatPreview.PostExport`
- Scene List override: empty/unset. The pre-export method selects the generated review scene after
  preparation; a dashboard scene override would bypass that selection.

Set these custom environment variables on the target. The first two must be controlled, short-lived
HTTPS download URLs or an authenticated asset gateway; do not use public Drive sharing URLs.

```text
GQ_U2_GREMLIN_FBX_URL=<Owner-provided controlled HTTPS URL>
GQ_U2_GREMLIN_TEXTURE_URL=<Owner-provided controlled HTTPS URL>
GQ_U2_REVIEW_ASSET_BEARER_TOKEN=<optional Owner secret, only if the gateway requires it>
```

`GQ_FAST_REVIEW_BUILD=1` is optional. Leave it unset for parity with the normal optimized local
candidate build; set it only for an explicitly fast review iteration. The bridge also checks the
Build Automation-provided `BUILD_REVISION` and `SCM_REVISION` when present against Git `HEAD`.

The provisioner derives the checkout root from its checked-in `tools/unity-build-automation/`
script location rather than invoking Git from `PROJECT_DIRECTORY`, so controlled inputs land under the repository's ignored `.local/m2/`
tree. Pre-export's clean-source guard tolerates only the exact Build Automation files observed before
`PreExport`: its generated manifest/meta chain, injected CloudBuild helper DLL/readme/meta files,
compiler response files (`csc.rsp`, `gmcs.rsp`, `smcs.rsp`, `us.rsp` and their metas), and the known
`build.json`, `build_manifest.json`, `build_stats.json`, and `editoranalytics_session.json` metadata.
The allowlist uses exact paths rather than broad generated directories; any other tracked or untracked
path, including an adjacent file under `Assets/__UnityCloud__/` or `.build/`, fails and is named.

The pre-build and post-export hooks are enough for the first bridge run. No Unity service credential,
paid feature, Cloud Content Delivery bucket, schedule, or cloud test is required by this package.

## First-build command and outputs

The Unity Cloud build target should execute its normal WebGL export with the configured hooks. The
repository build entry used by the hooks is:

```text
Pre-export:  GalaQuest.Editor.U2CombatPreview.PreExport
Unity export: target WebGL, using the generated scene selected by PreExport
Post-export: GalaQuest.Editor.U2CombatPreview.PostExport
```

The expected artifact contains the normal Unity WebGL output under `Build/` plus:

```text
candidate-build-manifest.json
```

The manifest's `sourceSha` is the client SHA, `sceneRecipe` is `U2CombatPreview`,
`buildFlavor` is `LOCAL_CANDIDATE_REVIEW`, `productionPromotion` is `false`, and `files` contains
the byte size and SHA-256 of each file under `Build/`. The existing `travel.mjs` or `forge.mjs` driver
can consume that manifest after the artifact is staged at `/unity/`; browser acceptance and physical
iPad acceptance remain separate gates.

## Build #1 recovery status

Build #1 verified that Build Automation checked out the requested source, detected Unity `6000.3.23f1`,
and presented the configured environment-variable keys. It also showed that the original pre-build
path was looked up from the project subdirectory and skipped, after which Build Automation's generated
manifest tripped the original all-or-nothing clean check. The repository repair corrects the documented
dashboard path, discovers the real Git root during provisioning, and narrowly admits that generated
manifest state.

Builds #2-#7 each cleared one further environment assumption: the pre-build script's shell and line
endings, its Git-independent root resolution, and the Build Automation generated state admitted by the
clean check. Build #7 (`d4db26f`) failed at `Could not close Unity batch-mode untitled housekeeping
scene`, proving that the untitled host scene cannot be closed; the seeded-scene bootstrap above replaces
that approach. No dashboard change is required for Build #8 beyond pointing the target at the branch
carrying the fix.

Before Build #2, the Owner must change the dashboard Pre-build script field to
`../../tools/unity-build-automation/provision-u2-review-inputs.sh` and retain the existing pre-export,
post-export, environment-variable, and empty Scene List settings. Build #2 is still required to prove
the real authenticated private-asset transfer, Unity import/build, post-export manifest, and artifact;
repository tests use no private token or controlled asset bytes.
