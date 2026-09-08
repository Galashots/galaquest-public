# Right-hand grip review candidate

The Owner authorized a bounded repair of the hero's open right hand and supplied three real grip photographs. The candidate curls the fingers around an authored grip axis, with the thumb outside near the index finger. The canonical Hero FBX, prefab, skeleton and animation clips remain unchanged. No asset is promoted by this work.

The original hand has no finger joints. Simply bending its existing long faces produced inward folds, so the candidate replaces 356 hand triangles with a locally refined surface. The original vertex and attribute buffers remain intact; the replacement interpolates the existing UV coordinates, normals and skin weights. Unity verifies the actual imported position, UV and bone correspondence instead of assuming Blender and Unity share vertex indices. The complete candidate hero has 12,140 triangles and retains the original 24-bone rig.

The existing Ironwood sword is fitted to a marker derived from that hand surface and the original bind pose. Its actual blade axis is independent of the prefab's import rotation. The candidate uses a longer longitudinal fit while preserving the radial scale, so the hilt spans the curled fingers. This remains a seeded review fit.

## Reproduction

The [candidate receipt](../../asset-production/HERO_RIGHT_GRIP_CANDIDATE_2026-09-07.json) pins the source and candidate bytes and links the derivative's controlled Drive working custody. The candidate inherits the existing character's [licence basis](../../../ASSET-LICENSES.md); it is not CC0. The personal reference photographs are not published.

Run the checked-in recipe with Blender 5.2 in background mode:

```text
blender --background --factory-startup --python tools/assets/author-hero-grip-candidate.py
```

An optional `-- --render` appends neutral diagnostic stills. Outputs go to the ignored `.local/m2/hero-grip-candidate` directory. The recipe checks the source FBX hash and never saves over it. Reproduction of the qualified bytes is checked separately from visual acceptance.

Set `GQ_U2_GRIP_REVIEW=1` when running `U2CombatPreview` to stage the candidate. Otherwise, the preview continues using the canonical hero. The existing local gremlin candidate is also required by the combined fight preview; its [receipt](../../asset-production/LAVA_GREMLIN_CANDIDATE_2026-09-07.json) identifies those inputs.

For graphics-enabled Unity PlayMode review, also set `GQ_U2_REVIEW=1` and `GQ_U2_CAPTURE=1`, then run `U2CombatPresentationPlayModeTests`. The test exercises the native slash, damage, down/recovery and rejoin, and captures both whole-character and hand views. Images are sampled poses, not frame-accurate impact evidence. Close-up cameras use an appropriate near plane; the first exploratory camera clipped through the hand and was corrected.

`U2CombatPreview.BuildWebGL` requires committed source, stages only temporary review assets, records the hand candidate hash in the build manifest, and cleans up its temporary assets. It does not replace the canonical scene or hero.

## Current review limits

Exploratory Unity tests passed. The large inward finger folds from the first drafts are resolved in inspected Unity views. A small crease at the little-finger base and narrow bevel faces remain visible at inspection scale. The producer must include that angle in the review packet.

Exact-commit Unity evidence, actual browser evidence, physical Safari verification and Owner visual acceptance remain pending at this source checkpoint. The [connected fight checkpoint](fight-checkpoint.md) records earlier runtime evidence and its separate source SHA.
