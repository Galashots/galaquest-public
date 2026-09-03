# Migration Bridge V0

This directory owns the one-way, source-to-Unity export seam. It reads the current public
`public/src/character/speed.js` module, the public asset registry, and the two selected shipping GLBs;
it does not implement gameplay or a second movement law.

## Export

The originating SHA is explicit so a committed manifest can continue to identify the exact source
snapshot it describes. The exporter checks that every authority file and selected asset still matches
that commit before writing.

```text
node tools/unity-migration/export-bridge.mjs --source-sha <source-commit> \
  --out unity/GalaQuest/Assets/GalaQuest/Migration/BridgeManifest.json
```

The output intentionally has no timestamp. Re-running against the same source SHA and unchanged
authority files produces byte-identical JSON.

Unity imports the versioned manifest through
`GalaQuest.Editor.MigrationBridgeAssetImporter.ImportManifest`, which updates one stable
`MigrationBridgeData.asset` in place. GalaQuest semantic IDs come from the public registry; Unity
GUIDs are only Unity asset identity.

The coordinate seam is `GalaQuest.Migration.ThreeToUnityCoordinates`. It maps right-handed,
Y-up Three.js/glTF meters to left-handed, Y-up Unity meters by reflecting Z for vectors and using
the matching quaternion `(x, y, -z, -w)` transform. The fixture in the manifest and EditMode tests
prove the mapping rather than relying on a copied convention.

## Existing-asset FBX intake

`convert-assets.mjs` drives the repository's Blender batch pattern for the two selected assets. It
discovers `blender` from PATH or accepts `--blender <path>` / `GALAQUEST_BLENDER`; no workstation
path is written to repository authority. The converter reads the committed Bridge manifest for
semantic IDs and source hashes, runs `tools/blender/convert_glb_to_fbx.py`, and writes relative-path
provenance beside the Unity derivatives.

```text
node tools/unity-migration/convert-assets.mjs --blender <path-to-blender-4.5.13>
```

The conversion is transfer-only: no retargeting, geometry edits, material repair, Meshy call, or
Unity importer package is involved. Blender's built-in FBX exporter is the only DCC handoff.

The converter uses `--factory-startup`, `axis_forward=-Z`, `axis_up=Y`, unit-scale application,
embedded textures, and animation baking only for the rigged Keeper. It stabilizes the native FBX
writer's randomized object IDs and wall-clock creation header so repeated conversion of the same
source into the same destination is byte-identical. The provenance `conversionDate` is evidence
metadata only; it is intentionally excluded from derivative comparisons. The checked-in derivative
directory is `Assets/GalaQuest/Migration/SourceAssets/Deterministic/`.

`GalaQuest/Migration/Build Asset Intake Proof` configures Unity's native `ModelImporter`, builds
the two audit-only proof prefabs, and saves `Assets/GalaQuest/Migration/Scenes/MigrationProof.unity`.
`GalaQuest/Migration/Capture Review Pack` renders the fixed cameras into the ignored
`.local/unity/review-pack/` directory and writes `review-manifest.json`. The Keeper takes are read
from the FBX import; the builder never invents or renames historical clip names.
