# Unity Build Automation bridge

This is the narrow cloud seam for the existing `U2CombatPreview` review build. It does not promote the
lava gremlin candidate, publish Drive files, enable schedules, or create a second build system.

## What the bridge does

Unity Build Automation checks out an exact revision and restores its workspace cache. The checked-in
pre-build hook then downloads the two ignored custody inputs into the paths already used by
`U2CombatPreview`, using controlled HTTPS URLs and verifying both byte size and SHA-256 before Unity
starts. It never logs the URLs or bearer token and never accepts a public Google Drive link.

The existing `U2CombatPreview.PreExport()` method calls `Prepare()` and `PrepareScene()`, then temporarily
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

In Advanced settings set:

- Pre-build script: `tools/unity-build-automation/provision-u2-review-inputs.sh`
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

## Current readiness

The repository bridge is ready for configuration review. The target is **not ready for the first
cloud build until the Owner sets the two controlled URL variables (and the optional bearer secret if
needed), adds the three hook fields, and confirms that no dashboard Scene List override is active**.
