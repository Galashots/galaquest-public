# Stable local combat preview inputs

`U2CombatPreview.Prepare()` and `PrepareScene()` retain local candidate outputs across review builds. Their receipt lives under `.local/throughput/`; the generated Assets folder is ignored by Git and remains non-canonical.

Reuse requires matching candidate bytes, recipe/runtime code, source assets and import dependencies, project/package settings, Unity version, build target, and hand-review mode. Repeated preparation preserves output bytes, metadata/GUIDs and timestamps. Changed inputs regenerate verified owned outputs. Unknown files, changed outputs, unsaved generated assets, an open preview scene, or missing receipts stop preparation without deleting that work. A partial generation is not a reusable cache: preserve and inspect it before any explicitly authorized disposal.

Run in the existing owned Editor after external edits have actually imported. Prepare uses an additive scratch scene and saves only generated assets. Unity requires all open scenes to have paths before adding a scene: save or close untitled scenes yourself; preparation refuses them before changing outputs. Close the generated preview scene before preparing again; other named scenes and their unsaved changes remain intact. `Cleanup()` is explicit disposal of intact owned outputs and is no longer a build-finally action.

For the focused custody-dependent native regression, run `GalaQuest.Tests.U2PreviewReuseTests` in EditMode. It requires the exact gremlin FBX and texture already named by the builder; do not fabricate replacements. Test-runner success with zero discovered tests is not evidence. The test records first/repeat preparation times under `.local/throughput/`; those times exclude CLI, compilation, and test-runner setup.

Rune Forge's two additional authoring calls in its existing gameplay branch must remain when integrating this change. Its collider/raycast/visibility preflight and WebGL comparison remain separate evidence gates; preparation reuse alone does not prove them.
