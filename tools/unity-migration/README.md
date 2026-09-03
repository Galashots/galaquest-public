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
