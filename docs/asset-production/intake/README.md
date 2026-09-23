# Gear intake records

One JSON record per rigid-gear intake, written by `node tools/assets/gear-intake.mjs`. The file name is
the item's semantic id, so the Dawnwarden sword is recorded as `gear.sword.dawnwarden.json`.

A record is evidence about the mechanical steps that ran — source and reduced GLB hashes and triangle
counts, the Unity FBX hash, the Blender version, and the exact commands — and it is not an acceptance.
Every record states `"status": "CANDIDATE"` with `fit`, `cavity` and `visual` all `"UNKNOWN"`; those
questions belong to the fit contract and the human review that follow, and promotion into shipped
production stays Owner-controlled.

Records are deterministic: identical inputs produce byte-identical files, so a diff means the inputs
differed. Do not hand-edit a record; re-run the tool.

These records are deliberately absent from `docs/asset-production/asset-registry-v1.json`: the registry
declares shipped `public/assets` payload, and an intake candidate is neither shipped nor a runtime asset.
