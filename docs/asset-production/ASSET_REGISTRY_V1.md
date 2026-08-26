# GalaQuest Asset Registry v1

`asset-registry-v1.json` is the current canonical inventory. The dated
`asset-platform-inventory.json` remains historical consolidation evidence and
is intentionally not rewritten; `candidate-registry.json` remains local R&D
evidence.

Every record separates lifecycle, custody, recoverability, and qualification
gates. A PASS in one gate never implies a PASS in another. Provider task
records are GET-only reconciliation evidence: 61 historical tasks are
`HTTP_404_TASK_NOT_FOUND` in the current provider context, and two readable
tasks expose expired signed output URLs (`STALE_SIGNED_URL`). No replacement
task was created and no paid operation was performed.

## Package B interface

Animation Lab v1 consumes registry records and emits evidence references for
source/target rig identity, rest-pose compatibility, clip/root-motion
inspection, visual playback, export hashes, and independent qualification
gates. Authoring, retarget promotion, and runtime integration remain outside
this package.

Run the deterministic generator after a deliberate inventory or public asset
change:

```text
node tools/asset-registry/build-registry.mjs
node --test test/asset-registry-v1.test.mjs
```
