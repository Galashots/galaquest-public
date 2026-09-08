# Right-hand grip review candidate

The Owner authorized a bounded repair of the hero's open right hand and supplied three real grip photographs. The candidate curls the fingers around an authored grip axis, with the thumb outside near the index finger. The canonical Hero FBX, prefab, skeleton and animation clips remain unchanged. The Owner approved this exact candidate for playtest integration on 2026-09-07: “Grip approved good work.” The documented base crease and pommel contact remain polish items.

The original hand has no finger joints. Simply bending its existing long faces produced inward folds, so the candidate replaces 356 hand triangles with a locally refined surface. The original vertex and attribute buffers remain intact; the replacement interpolates the existing UV coordinates, normals and skin weights. Unity verifies the actual imported position, UV and bone correspondence instead of assuming Blender and Unity share vertex indices. The complete candidate hero has 12,140 triangles and retains the original 24-bone rig.

The existing Ironwood sword is fitted to a marker derived from that hand surface and the original bind pose. Its actual blade axis is independent of the prefab's import rotation. The candidate uses a longer longitudinal fit while preserving the radial scale, so the hilt spans the curled fingers. This remains a seeded review fit.

## Reproduction

The [candidate receipt](../../asset-production/HERO_RIGHT_GRIP_CANDIDATE_2026-09-07.json) pins the source and candidate bytes and links the derivative's controlled Drive working custody. The candidate inherits the existing character's [licence basis](../../../ASSET-LICENSES.md); it is not CC0. The personal reference photographs are not published.

Run the checked-in recipe with Blender 5.2 in background mode:

```text
blender --background --factory-startup --python tools/assets/author-hero-grip-candidate.py
```

An optional `-- --render` appends neutral diagnostic stills. Outputs go to the ignored `.local/m2/hero-grip-candidate` directory. The recipe checks the source FBX hash and never saves over it. Reproduction of the qualified bytes is checked separately from visual acceptance.

The approved mesh and prefab now live in the committed `Movement/HeroGrip` Unity folder. The regular playtest scene uses that mesh, and new scene authoring uses that prefab. `U2CombatPreview` uses the approved asset by default; it no longer requires the local hand JSON. Set `GQ_U2_GRIP_REVIEW=1` only to reproduce the original custody-tier import for diagnostics. The existing local gremlin candidate is also required by the combined fight preview; its [receipt](../../asset-production/LAVA_GREMLIN_CANDIDATE_2026-09-07.json) identifies those inputs.

For graphics-enabled Unity PlayMode review, also set `GQ_U2_REVIEW=1` and `GQ_U2_CAPTURE=1`, then run `U2CombatPresentationPlayModeTests`. The test exercises the native slash, damage, down/recovery and rejoin, and captures both whole-character and hand views. Images are sampled poses, not frame-accurate impact evidence. Close-up cameras use an appropriate near plane; the first exploratory camera clipped through the hand and was corrected.

`U2CombatPreview.BuildWebGL` requires committed source, stages temporary gremlin review assets, records the hand source hash and approval in the build manifest, and cleans up temporary assets. The gremlin remains a review candidate. `HeroGripAuthoring.AuthorApproved` records the permanent approved hand binding; the source FBX and original Hero prefab remain preserved.

## Verified checkpoint and Owner review

The connected preview source is **b8b9735e3777570f4d887e0e0ad07d3eaeba66f5**. A new test against the actual scene failed before the local-hero correction: the scene retained `char1` while the remote spawn prefab used `HeroRightGrip`. The correction changes only the temporary scene's local mesh and bounds, retaining its hero transform and movement/camera bindings. The passing test reopens the saved preview and also verifies that the canonical scene bytes remain unchanged.

The strict WebGL build and real two-browser run pass at that SHA, with both client and server matching it. The first player reduced the enemy from 30 to 20 to 10 health; the sibling finished it. The run also verified stopped held input after recovery, mute/unmute, rejoin and touch orbit, with zero browser errors. Four compressed build files total 19,229,420 bytes. Hosted [test run 34172494273](https://github.com/Galashots/galaquest-public/actions/runs/34172494273), [test run 34172492121](https://github.com/Galashots/galaquest-public/actions/runs/34172492121), and [director bundle 34172494265](https://github.com/Galashots/galaquest-public/actions/runs/34172494265) pass.

The native Unity combat test and diagnostic images below were produced at **a5ecf5fc8e62e485e4776493b933c4b83bbbd117**. The candidate bytes, native clips and fit are unchanged in the later connected-scene correction. The [evidence manifest](hand-grip-evidence.json) keeps these source identities separate and records the test, build and image hashes.

![Unity PlayMode close-up: four curled fingers and outside thumb; little finger grazes the pommel](hand-unity-palm.png)

![Unity PlayMode close-up: remaining crease at the little-finger base](hand-unity-back.png)

![Unity PlayMode: sampled native slash with the repaired grip](hand-unity-slash.png)

![Actual browser at b8b9735: held sword after touch orbit](hand-browser-orbit.png)

![Actual browser at b8b9735: sampled sword sweep](hand-browser-slash.png)

The large inward folds from the first drafts are resolved in the inspected Unity views. The strongest remaining hand concerns are the little-finger base crease, narrow bevel faces and contact with the pommel in close-up. Eight narrow/base triangles oppose the differential-facing estimate; this is not a clean geometry pass. The preview uses a fixed grip pose with the existing hand bone. Finger animation is not added.

The browser frames show the sword following the hand and a readable sweep after orbit. The default cavern wall still blocks part of the view, and the environment remains greybox. Physical Safari comfort, audible sound quality and continuous-motion judgment remain open. Owner visual approval for this grip was received on 2026-09-07. The [Owner packet in controlled Drive custody](https://drive.google.com/drive/folders/1m51k_mc8ThoyN6KMKaERGj4NMDgiATVn) includes the defect-exposing angles. The review decision is approved for playtest integration; the original candidate evidence remains tied to its tested source commits.

The [earlier connected fight checkpoint](fight-checkpoint.md) records the broader combat implementation and its previous source SHA.

## Playtest admission

At **113a3623d87fdd94680aea3ba7e00c4d0e2338cc**, the approved mesh/prefab and scene binding are committed. The focused Unity EditMode check passes with no local hand source required. It verifies the scene mesh identity, 24 original bones/bind poses, preserved source hash and original prefab, and approved geometry counts. Hosted [unit run 34175254286](https://github.com/Galashots/galaquest-public/actions/runs/34175254286), [unit run 34175252080](https://github.com/Galashots/galaquest-public/actions/runs/34175252080) and [director bundle 34175254285](https://github.com/Galashots/galaquest-public/actions/runs/34175254285) pass.

The original visual evidence remains at its recorded source commits; this admission changes custody and default asset binding. It does not create new physical-iPad or full-level acceptance. The Owner decision is durable here and in the receipt. Moving the completed Drive packet to the reviewed archive remains administrative follow-up: the connector has no move action, and the browser was signed out.
