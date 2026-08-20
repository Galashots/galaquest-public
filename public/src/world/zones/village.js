// public/src/world/zones/village.js
//
// PURE DATA. No three.js, no imports of any kind -- test/zone-data.test.mjs enforces that the same
// way test/combat-purity.test.mjs enforces it for public/src/combat/, and for the same reason: a
// zone module that only describes placements can be read, diffed and hand-tuned without touching
// (or needing to understand) three.js, the loader, or the render pipeline. world/zoneLoader.js is
// the only thing that turns this into scene objects.
//
// Phase V brief (the private engineering archive), "the layout" section: village
// mass sits SW of spawn, the Lantern Tree is its visual anchor with the Keeper beside it, street
// lanterns lead the eye from spawn into the village, and the NE quadrant (the wolf's corner) stays
// open wilderness. Nothing may occlude the lane from SPAWNS.heroes to SPAWNS.wolf.
//
// Phase Y/Task D revision (the private engineering archive, "Task D"):
// placements re-tuned against the Lantern Tree v2's MEASURED real footprint (5.5m wide x 3.1m deep
// at its shipped height -- the raw model is 1.0 x 0.563, scaled by 5.5 -- not the point-landmark the
// original Phase V layout implicitly treated it as) so nothing merges into its silhouette, the
// Keeper stands beside rather than in front of the trunk from the spawn camera, houses/market form
// two readable clusters instead of an even scatter, and the wilderness NE corner sits measurably
// (not just nominally) outside the radius-4 combat bowl -- see test/zone-data.test.mjs's own
// footprint-aware radius checks, added the same pass this comment was written in.

// THE WORLD, and why it is no longer a square.
//
// `size` is the village's own 28x28 -- x runs -14..14 and the southern half of z is unchanged, so
// every coordinate below this line means exactly what it always meant. `northMeters` is new: the
// ground now continues that far PAST z = +14, because the Wildwood Gate used to open onto two metres
// of grass and then the edge of the world.
//
// That was three separate defects wearing one coat, all three found by walking through the gate and
// looking (the private engineering archive, and the captures under .local/runtime-test/): a pine stood dead
// centre in the archway, the road stopped in a field a metre past it, and the arch read off-centre
// because the road curved east through it. None of them is really fixable while the gate is the last
// thing in the world -- a gateway has to lead somewhere or it is a sculpture. So the world grows
// north and the road becomes a trail into the trees, which is also the ground Chapter 2 is walked on.
//
// It grows in ONE direction only. A bigger square would have added 700 m2 of empty meadow south and
// west that no child has any reason to walk into, and quadrupled the ground mesh to do it.
//
// G1, 2026-08-20: 22 -> 44, for exactly the same reason and against exactly the same defect one
// stage further on. The trail's own camp had become what the gate used to be -- a place the game
// congratulates you for reaching, with nothing whatsoever in front of it and an objective chip
// ("Guard the camp for Rowan") naming a verb the world does not implement. The ground now continues
// past the camp to carry the Old Beacon road (see the road's own G1 section below and
// world/oldBeacon.js), which is the place Rowan has been talking about since they were built.
//
// STILL only north, and still sized to the content rather than rounded up: the Beacon stands at
// z = 51, its own wood closes behind it at z = 54.4-56.6, and the ground's edge at z = 58 leaves
// exactly the metre of margin world/bounds.js's WORLD_EDGE_MARGIN_METERS already assumes everywhere
// else. There is no acreage here a child has no reason to walk into.
export const ZONE = Object.freeze({ name: 'lantern-village', size: 28, northMeters: 44 });

// WHERE THE WOLVES ARE. Three spots, walked in order, one wolf alive at a time.
//
// It used to be one spot. The quest is three kills, so a child spent the whole thing standing in a
// single two-metre circle hitting the same animal three times over, with a ten-second wait in the
// middle of each -- and Keeper Aldric's own line says "the wolves OUT THERE", plural. Now a beaten
// wolf dissolves (enemies/wolf.js) and the next one is somewhere else, so the middle of the quest is
// a hunt across the map instead of a wait.
//
// Chosen by measuring, not by eye: a search over the whole wilderness for cells at least 4 m clear of
// every prop's centre (the same combat bowl test/zone-data.test.mjs enforces, so the fight always has
// room), at least 7 m from the hero spawn so nothing appears on top of a child, and at least 5 m from
// each other so each is a real walk. The east half is full of the rock huddle and the treeline, which
// is why the second is the west meadow and the third is the far side of the plaza.
//
//   [ 2.5,  8.0]  the north lane, straight up the road -- the first wolf a child ever meets
//   [-5.5,  5.0]  the west meadow, 8.5 m away, in the open between the village and the treeline
//   [ 7.0, -1.5]  east of the plaza, 14 m further still, and close enough to the village to alarm
const WOLF_PATROL = Object.freeze([
  Object.freeze([2.5, 8]),
  Object.freeze([-5.5, 5]),
  Object.freeze([7, -1.5]),
]);

export const SPAWNS = Object.freeze({
  heroes: Object.freeze([0, 0]),
  // The FIRST spot on the patrol, not a fourth copy of the number -- everything that means "where
  // does the fight start" still reads this.
  wolf: WOLF_PATROL[0],
  patrol: WOLF_PATROL,
  // Moved twice. First, from [-3.8, -3.2] (Task D): that position sat almost exactly on the
  // spawn->tree sightline (both spawn and the old keeper spot are near the x=z diagonal toward the
  // tree at [-6.5,-6.5]), which is precisely the brief's own "do not place the Keeper directly in
  // front of the trunk from the spawn camera" case -- the V3/W3 captures confirmed it, showing the
  // keeper overlapping the trunk. [-4.3, -4.0] fixed that shot.
  //
  // But a later capture (village-lane-to-wolf.png: hero at spawn, camera facing the WOLF, not the
  // tree) showed a large dark shape at the frame edge. Two rounds of investigating the longhouse as
  // the cause found nothing (moving it made the wrong-hypothesis distance worse, then better, with
  // no visible change) -- toggling each candidate's visibility live and diffing the capture (not
  // guessing from the image) proved it was [-4.3,-4.0] itself: at DEFAULT_DISTANCE=16 the wolf-facing
  // camera sits behind the hero at roughly (-4.4, 5.4, -14.6), and from THAT position the keeper and
  // the tree canopy are only ~14.7deg apart (~2.2m lateral separation at the tree's own ~8.8m
  // distance -- inside the canopy's own ~2.75m half-width) -- close enough to fuse into one
  // silhouette on screen, even though the two are perfectly readable as separate from spawn facing
  // the tree. [-4.3,-4.0] was tuned only against the tree-facing shot; nobody had checked the
  // wolf-facing one.
  //
  // [-2.8, -5.8] keeps roughly the same ~3.3-4m distance from the tree (still reads as "beside" it)
  // but at a different angle around it -- rotated toward the side of the tree the wolf-facing camera
  // does NOT look through, which widens that separation to ~24deg (~3.5m lateral, clear of the
  // canopy's 2.75m half-width plus margin) while staying off the spawn->tree diagonal the first move
  // already fixed. Verified against BOTH shots live (temporary in-scene reposition + capture) before
  // this coordinate was committed to data, not derived from the angle math alone (AGENTS.md: look
  // before you derive) -- candidate-spawn-toward-tree.png and candidate-lane-to-wolf.png both read
  // clean. zoneLoader.js still computes the keeper's facing at load time (headingToward
  // SPAWNS.heroes) -- unchanged mechanism, new input.
  keeper: Object.freeze([-2.8, -5.8]),
});

// The SAME two placements as SPAWNS above, in the `{ x, z }` shape the rules layer, the client and
// the server all take. Derived here, from SPAWNS, rather than written out again -- so the numbers
// live in exactly one place in this repo (docs/MISTAKES.md GQ-007, and the reason Phase R2 exists).
//
// WHY HERE, and not in public/src/combat/encounter.js as the post-Phase-Y plan guessed. Two module
// boundaries decide it, and both are deliberate and test-enforced:
//   - world/zones/ modules may contain ZERO imports of any kind (test/zone-data.test.mjs), so this
//     file cannot pull a constant in from combat/.
//   - public/src/combat/ may only import from './' (test/combat-purity.test.mjs), so encounter.js
//     cannot pull one in from here either.
// They are mutually isolated on purpose, so one of them has to own the value outright. It belongs to
// the zone: a spawn point is a PLACEMENT, and encounter.js already treats it as one -- every entry
// point takes `wolfSpawn` as an argument and its own default ({x:0, z:-4}) is a neutral test
// fallback, not this village's spot. Hardcoding the village's coordinates into the pure rules layer
// would bake one zone into rules that are written to be zone-agnostic, and would have to be undone
// the moment a second zone exists.
//
// Consumers: public/src/main.js (offline fallback + the online mirror) and net/gameServer.mjs, which
// re-exports WOLF_SPAWN so its own callers and tests keep one import site.
export const WOLF_SPAWN = Object.freeze({ x: SPAWNS.wolf[0], z: SPAWNS.wolf[1] });
// The whole patrol in the same `{ x, z }` shape, for the one argument the rules layer takes. Derived
// from SPAWNS.patrol for the same reason WOLF_SPAWN is derived from SPAWNS.wolf.
export const WOLF_SPAWNS = Object.freeze(
  SPAWNS.patrol.map(([x, z]) => Object.freeze({ x, z })),
);
export const HERO_SPAWN = Object.freeze({ x: SPAWNS.heroes[0], z: SPAWNS.heroes[1] });

// The one pure data definition for the road's control points, read by world/ground.js to build the
// integrated grass+road ground mesh -- not restated there (docs/MISTAKES.md GQ-007). A polyline,
// not a network: one continuous spine reads clearly as "the route" at a glance (the brief's own
// "obvious navigational spine"), curving SW to the plaza and back rather than branching. Starts
// exactly at SPAWNS.heroes so the hero always spawns standing on the road, and its gate-crossing
// point [1.2, 2.2] matches PROPS' own fence-gate placement below exactly -- the brief's own "avoid
// restating placement coordinates in multiple modules" applied to the gate/road relationship too,
// not only to ground.js's own consumption of this data.
// RE-ROUTED after looking at the ground in the running game. The old polyline went SW from spawn to
// [-4.6,-3.9] and then immediately back NE through [-3.0,-2.2] and [-1.2,-0.6] -- an out-and-back
// whose two legs are barely 1 m apart. At widthMeters 4 with a 0.6 m soft edge, those two legs
// overlap completely, so what the child actually saw was not a road at all but one 7 m brown smear
// across the plaza, reading as mud or a stain (visible in every village capture: see
// .local/runtime-test/look-01-spawn-toward-village.png before this change).
//
// It is now a single spine that starts in the west at the market, curves past the Lantern Tree and
// the Keeper, runs through the hero spawn, and leaves through the fence gate up the lane to the
// wolf. No leg is ever within 4 m of another leg, so every metre of it reads as road; and it now
// LEADS somewhere at both ends, which the brief asked for and the out-and-back never did.
//
// Two placement constraints it still meets exactly: [1.2, 2.2] is PROPS' own fence-gate coordinate
// (not restated nearby -- the same value, so the gate is always on the road), and the [0, 0] point
// is the hero spawn, so the hero still spawns standing on it. ROAD.points[0] is deliberately NOT
// the spawn any more -- the polyline starts at the market end -- and test/zone-data.test.mjs now
// checks the property that actually matters ("the spawn is ON the road") instead of the position it
// used to stand in for.
//
// The plaza leg passes about 3.3 m north of the tree's trunk, so the road's own edge stops roughly
// 1.3 m clear of it: a road hugging a plaza tree, which is what plaza trees look like, rather than
// one driven through it.
// The two lantern posts that flank the north road where it meets the treeline, and the arch that
// stands between them. Declared HERE, above ROAD, rather than down with WILDWOOD_GATE where they
// used to live, because the road now has to be routed THROUGH the arch and a value used by two
// things lives in one place (GQ-007). Before this, the arch was placed at [2.9, 11.8] and the road
// independently passed x = 3.23 at that z -- a third of a metre out, which is small on paper and
// clearly visible in the running game as a gateway standing beside its own road.
const GATE_LANTERN_WEST = Object.freeze([1.8, 12.3]);
const GATE_LANTERN_EAST = Object.freeze([4.4, 12.2]);
// Half a metre south of the two lanterns: the only band on this lane where a 4.4 m span clears both
// the treeline behind it and the wolf's own 4 m combat bowl at [2.5, 8]. Solved (tmp/solve-gate.mjs)
// against the same measured footprints test/zone-data.test.mjs uses, not placed by eye.
const GATE_ARCH_AT = Object.freeze([2.9, 11.8]);

export const ROAD = Object.freeze({
  widthMeters: 4,
  points: Object.freeze([
    Object.freeze([-10.6, -2.2]),
    Object.freeze([-8.4, -3.0]),
    Object.freeze([-6.6, -3.6]),
    Object.freeze([-5.0, -3.7]),
    Object.freeze([-3.2, -3.1]),
    Object.freeze([-1.5, -1.7]),
    Object.freeze([0, 0]),
    Object.freeze([0.6, 1.2]),
    Object.freeze([1.2, 2.2]),
    Object.freeze([1.8, 4.2]),
    Object.freeze([2.3, 6.5]),
    // Past the wolf and on into the trees. It used to stop dead at [2.4, 7.5], which painted as a
    // patch of bare earth ending in the middle of a field -- a road has to go somewhere or it reads
    // as a stain. Running it to the treeline also puts the wolf ON the path rather than beside it
    // (the spawn is [2.5, 8]), so the thing blocking the way is the thing you have to fight, and
    // leaves the village with a visible way OUT for whatever comes after the Lantern Tree.
    Object.freeze([2.5, 8.0]),
    Object.freeze([2.7, 10.0]),
    // THROUGH THE ARCH, not past it. The gate's own coordinate, so the two can never drift apart
    // again -- see GATE_ARCH_AT above for what the drift looked like.
    GATE_ARCH_AT,

    // ── the Dark Trail ──────────────────────────────────────────────────────────────────────────
    //
    // Past the gate the road stops being the village's lane and becomes a trail into the Wildwood.
    // It used to END at [3.4, 12.6], eight tenths of a metre inside the world's own edge, which is
    // what "the road terminates abruptly just beyond the gate" meant in practice.
    //
    // It BENDS, twice, and that is the only interesting thing about these numbers: from under the
    // arch you can see perhaps fifteen metres of it before it goes behind the trees, so the trail
    // always has somewhere you have not seen yet. A straight run to the north edge would show a
    // child the whole of Chapter 2's ground from the doorway.
    Object.freeze([3.4, 14.6]),
    Object.freeze([4.2, 17.4]),
    Object.freeze([4.4, 20.2]),
    Object.freeze([3.4, 22.8]),
    Object.freeze([1.6, 25.2]),
    Object.freeze([0.2, 27.8]),
    Object.freeze([0.1, 30.6]),
    Object.freeze([1.0, 33.4]),

    // ── the Old Beacon road (G1) ────────────────────────────────────────────────────────────────
    //
    // THE STRONGEST DIRECTION SIGNAL THIS GAME OWNS, and it costs nothing: the road is painted into
    // the ground mesh's own vertex colours (world/ground.js), so continuing it out of the camp is
    // one draw call's worth of nothing and a child has already spent forty metres learning that the
    // brown means "this way". Before this, the road ended in an amoeba-shaped blot under the camp,
    // which reads as a stain rather than as a route -- the exact defect the Dark Trail section above
    // records having fixed once already at the gate.
    //
    // It BENDS ONCE, west, at [0.7, 43.4], and the bend is the point. From the camp the Beacon's
    // cresset already breaks the treeline eighteen metres off (world/oldBeacon.js explains the height
    // arithmetic that guarantees it), so the job of the route is not to hide the destination -- it is
    // to make the walk a walk. The bend is the decision point the reference sweep says a landmark
    // belongs at, which is why a waystone stands on its outside shoulder, and it is where the flanking
    // wood opens and the whole tower comes into view instead of just its top.
    //
    // It stays within about 3 degrees of the beacon's own bearing the whole way, which is not a
    // stylistic choice: PORTRAIT'S HORIZONTAL FOV IS ONLY 32 DEGREES (42 vertical against a 0.75
    // aspect), so anything more than a gentle S-curve steers the destination off the side of a
    // 768x1024 screen. Landscape's 54 degrees would have forgiven far more; portrait is the one that
    // decides.
    Object.freeze([1.9, 35.9]),
    Object.freeze([3.2, 38.4]),
    Object.freeze([2.5, 41.0]),
    Object.freeze([0.7, 43.4]),
    Object.freeze([0.9, 46.0]),
    Object.freeze([2.0, 48.2]),
    // Into the Beacon's own step. 1.4 m short of OLD_BEACON.at, so the road arrives AT the stone
    // rather than stopping in front of it or vanishing under it.
    Object.freeze([2.6, 49.6]),
  ]),
});

// `model` is a path relative to public/assets/, matching the convention hero.js/wolf.js's own
// *_URL constants use. `height` is the desired WORLD height in metres; zoneLoader.js measures the
// model's own bounding box at load time and scales to hit it -- see the brief: "it arrives in a
// unit-normalized bound -- measure at load like wolf.js does, do not hardcode a magic scale."
// Height re-tuned 2026-08-13 night from references, not taste: the first pass used 9 (the
// brief's guess) and the V3 captures showed the canopy filling the sky from spawn with the hero
// and keeper standing INSIDE its silhouette -- at that scale the dusky dark-phase foliage read
// as a boulder pile, not a tree. An image sweep of village plaza trees (Animal Crossing class)
// is unanimous: the landmark tree is 3-4x character height, full trunk visible, canopy ABOVE
// head height with clear ground around it. 5.5 vs the 1.48m hero is 3.7x, and the tree steps
// back so the plaza breathes between it and the keeper.
export const LANDMARKS = Object.freeze([
  Object.freeze({ model: 'world/lantern_tree.glb', at: Object.freeze([-6.5, -6.5]), rotY: 0.4, height: 5.5 }),
]);

// The arrival trigger, built from the two lantern posts declared above ROAD -- so the gate the game
// congratulates you for finding can never drift away from the lanterns that mark it (GQ-007).
export const WILDWOOD_GATE = Object.freeze({
  at: Object.freeze([
    (GATE_LANTERN_WEST[0] + GATE_LANTERN_EAST[0]) / 2,
    (GATE_LANTERN_WEST[1] + GATE_LANTERN_EAST[1]) / 2,
  ]),
  // Generous on purpose: this is a "you got here" trigger for a young player steering with a
  // thumb, not a keyhole. The posts are 2.6 m apart, so this is roughly the gateway's own mouth.
  radiusMeters: 2.6,

  // THE ARCH ITSELF, added after playing the quest to the end and looking at what a child arrives
  // at: the game said "You found the Wildwood Gate!" over an empty stretch of road. Two lamp posts
  // are not a gate. world/wildwoodGate.js builds this out of timber boxes -- see its own header for
  // why it is built rather than bought.
  //
  // Every number here was SOLVED against the same measured footprints test/zone-data.test.mjs uses
  // (tmp/solve-gate.mjs), not placed by eye:
  //
  //   at    GATE_ARCH_AT, declared above ROAD and used by BOTH -- the road is routed through this
  //         exact point, which is what fixed the arch reading a third of a metre off its own road.
  //         The position itself is unchanged: half a metre south of the two lanterns, the only band
  //         on this lane where a 4.4 m span clears both the treeline behind it (the tree at
  //         [5.4, 13] is the tight one, 0.40 m off the east post's corner) and the wolf's own 4 m
  //         combat bowl at [2.5, 8] (the posts sit 4.16 m out). Walking north you pass UNDER the
  //         arch and THEN between its two lanterns, which read as the lights inside the gateway.
  //   rotY  square to the line the two gate lanterns already stand on, so the arch and its lamps
  //         agree instead of being 2 degrees out. Derived from them, not restated (GQ-007).
  //   span  4.4 m post centre to post centre, against a 4 m road: the road passes through the
  //         gateway with its shoulders, rather than the gateway standing in the road.
  arch: Object.freeze({
    at: GATE_ARCH_AT,
    rotY: Math.atan2(-(GATE_LANTERN_EAST[1] - GATE_LANTERN_WEST[1]), GATE_LANTERN_EAST[0] - GATE_LANTERN_WEST[0]),
    spanMeters: 4.4,
  }),
});

// `scale` is a multiplier on the model's own authored size (default 1) -- unlike LANDMARKS, these
// are shipped at a size already believable next to a 1m grid (the Kenney kit's own convention), so
// no bounding-box measurement is needed to place them.
//
// Phase Y/Task D: two house clusters instead of a scatter (the brief's own "houses/market props as
// clusters framing the village, not evenly distributed") -- a NW cluster (cottage-2 alone, a quiet
// second building) and a SW cluster (cottage-1 + longhouse + the market huddle), both measured
// clear of the tree's real canopy footprint and of each other (test/ground-layout-check-style
// verification during authoring; no placement here overlaps another or the tree -- see
// test/zone-data.test.mjs). The longhouse also moved IN from [-3,-10.5] to [-7.5,-9.8]: Task C's own
// camera-comparison work found the follow camera, at the new DEFAULT_DISTANCE=16, swings close
// enough to props near the world's south edge to loom in frame for headings facing away from the
// village -- pulling the longhouse toward the rest of the SW cluster (still clearly part of "the
// village mass") reduces that reach instead of ignoring it.
//
// (The dark shape still visible at the frame edge in an early village-lane-to-wolf.png capture was
// investigated as a possible longhouse regression -- confirmed NOT the longhouse, by toggling each
// candidate object's visibility live and diffing the capture. It was the Lantern Keeper's silhouette
// fusing with the tree canopy from that specific camera; see SPAWNS.keeper's own comment for the
// actual fix.)
export const PROPS = Object.freeze([
  Object.freeze({ model: 'props/village/house-cottage.glb', at: Object.freeze([-11.5, -7.5]), rotY: 0.35 }),
  Object.freeze({ model: 'props/village/house-cottage.glb', at: Object.freeze([-11.5, -1.5]), rotY: 1.57 }),
  Object.freeze({ model: 'props/village/house-longhouse.glb', at: Object.freeze([-7.5, -9.8]), rotY: 0 }),

  Object.freeze({ model: 'props/village/stall-green.glb', at: Object.freeze([-9.2, -4.2]), rotY: 0.8 }),
  Object.freeze({ model: 'props/village/stall-bench.glb', at: Object.freeze([-8.0, -3.3]), rotY: 0.8 }),
  Object.freeze({ model: 'props/village/cart.glb', at: Object.freeze([-9.7, -5.5]), rotY: -0.5 }),

  // The village-of-lanterns motif: street lanterns as wayfinding punctuation ALONG the road's own
  // waypoints (ROAD.points above), not scattered -- five lanterns roughly bracket the spawn->plaza
  // curve and the plaza->gate return, each offset a little off the road's own centreline so none
  // sits in the walkable path itself.
  Object.freeze({ model: 'props/village/lantern.glb', at: Object.freeze([-1.8, -1.5]), rotY: 0 }),
  Object.freeze({ model: 'props/village/lantern.glb', at: Object.freeze([-3.0, -2.3]), rotY: 0.6 }),
  Object.freeze({ model: 'props/village/lantern.glb', at: Object.freeze([-5.8, -4.5]), rotY: 1.2 }),
  // [0.9, 1.4] until the opening shot started pointing at the village. The game now opens with the
  // camera behind the hero looking SW at the Lantern Tree, which puts the camera 15 m up the NE lane
  // -- and this lantern sat 0.35 m off that camera-to-hero line, so the very first frame had a lamp
  // post driven straight through the hero's chest. Moved to the far side of the lane, where it is
  // 1.2 m off the sightline: still the last village light before the road leaves the plaza, now
  // standing beside the hero instead of through him.
  Object.freeze({ model: 'props/village/lantern.glb', at: Object.freeze([2.3, 0.6]), rotY: 2.1 }),
  Object.freeze({ model: 'props/village/lantern.glb', at: Object.freeze([1.6, 3.5]), rotY: 3.0 }),

  // THE WILDWOOD GATE, and the reason it is two lanterns rather than a signpost we do not own.
  // The relight runs outward from the tree, nearest lantern first, so these two -- the furthest
  // from it in the whole zone -- are the LAST to catch: the light finishes its run by leaving the
  // village and marking the way into the trees. Standing where the north lane meets the treeline,
  // they flank the road (ROAD's own [3.4, 12.6] end point) without standing in it.
  //
  // Nothing between here and the village lights, because the combat bowl forbids props within 4 m
  // of the wolf spawn and that is exactly the stretch of lane the wolf holds. The unlit gap is not
  // a compromise: the lit path stops where the wolf's ground begins and picks up again beyond it.
  Object.freeze({ model: 'props/village/lantern.glb', at: GATE_LANTERN_WEST, rotY: 0.5 }),
  Object.freeze({ model: 'props/village/lantern.glb', at: GATE_LANTERN_EAST, rotY: 2.7 }),

  // A symbolic boundary between village and wilderness on the lane toward the wolf, NOT a collision
  // barrier (out of scope this pass -- see the brief). rotY is pi/2, not 0: fence.glb's own long
  // axis is Z (measured 0.075m wide x 1.000m deep), so rotY 0 stood four panels side-by-side like
  // comb teeth with gaps between them rather than joined end-to-end into one run -- a real bug found
  // by looking at the V3/W3 captures, not visible from the data alone. At pi/2 each 1m-long panel's
  // centres are 1m apart along X, which is exactly touching edge-to-edge: 0, then the gate at
  // ROAD.points' own gate-crossing coordinate, matching it exactly rather than restating it nearby.
  Object.freeze({ model: 'props/village/fence.glb', at: Object.freeze([-0.8, 2.2]), rotY: Math.PI / 2 }),
  Object.freeze({ model: 'props/village/fence.glb', at: Object.freeze([0.2, 2.2]), rotY: Math.PI / 2 }),
  Object.freeze({ model: 'props/village/fence-gate.glb', at: Object.freeze([1.2, 2.2]), rotY: Math.PI / 2 }),
  Object.freeze({ model: 'props/village/fence.glb', at: Object.freeze([2.2, 2.2]), rotY: Math.PI / 2 }),

  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-11, 5]), rotY: 0.2, scale: 1.1 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-9, 9]), rotY: 1.0, scale: 0.9 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-12, -11]), rotY: 2.4, scale: 1.3 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([6, -10]), rotY: 0.7, scale: 1.0 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([9, -6]), rotY: 3.4, scale: 1.15 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([8, 12]), rotY: 0.5 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([12, 3]), rotY: 2.8 }),

  // Wilderness-corner dressing, outside the radius-4 combat bowl around the wolf spawn (2.5, 8) --
  // re-measured against each rock's own real footprint, not just its centre point (Task D also
  // fixed test/zone-data.test.mjs's radius checks the same way, after finding the OLD [6, 5] placement
  // still failed a body-aware check despite passing the old centre-only one: 4.61m centre distance,
  // but the rock's own ~0.66m half-width put its edge at 3.95m, inside the 4m bowl). Pushed out
  // further than a centre-only tune would have caught.
  Object.freeze({ model: 'props/village/rock-small.glb', at: Object.freeze([9, 3]), rotY: 0.3 }),
  Object.freeze({ model: 'props/village/rock-large.glb', at: Object.freeze([10, 11]), rotY: 1.9 }),
  Object.freeze({ model: 'props/village/rock-wide.glb', at: Object.freeze([12, 9]), rotY: 0.9 }),
  Object.freeze({ model: 'props/village/rock-small.glb', at: Object.freeze([6.5, 12.3]), rotY: 2.5 }),

  // ── the treeline ────────────────────────────────────────────────────────────────────────────
  //
  // Placed after looking at the wilderness in the running game rather than at the layout on paper.
  // Walking out to the wolf, the frame was an empty green field with three props in it and a
  // visible edge where the 28x28 ground plane stops (moment-02-at-the-wolf.png). render/sky.js's
  // fog now dissolves that edge into the horizon, and these give the horizon something to BE:
  // a ring of trees at roughly x/z = +/-12.5, which the fog holds at half strength so they read as
  // distance rather than as a fence of models.
  //
  // Rules every one of these respects, all test-enforced in test/zone-data.test.mjs: outside radius
  // 1.5 of the hero spawn, outside radius 4 of the wolf spawn INCLUDING each model's own footprint
  // (tree radius 0.512), and inside the ground plane's own +/-14. Deliberately NOT an even ring --
  // the spacing varies from 2.2 m to 4.5 m and the scales from 0.85 to 1.35, because an evenly
  // spaced line of identical trees reads as wallpaper. The north run steps out to z=13.2 where it
  // passes the wolf's bowl (at x=2.5 that is 5.2 m of clearance against the 4 m floor).
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-12.4, 12.6]), rotY: 0.4, scale: 1.2 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([-9.6, 13.0]), rotY: 2.2, scale: 0.95 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-6.2, 12.4]), rotY: 1.1, scale: 1.35 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-3.4, 13.1]), rotY: 3.0, scale: 0.9 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([-0.6, 12.7]), rotY: 0.7, scale: 1.15 }),
  // THE GAP IS THE POINT. A tree stood at [2.5, 13.2] until 2026-08-15 -- dead centre in the
  // archway, filling the one rectangle of the frame the whole gate exists to draw a child's eye
  // through (.local/runtime-test/heal-01-hurt.png, taken while checking something else entirely).
  // It is now the first tree of the Wildwood's own east side, further up the trail at [6.6, 15.1],
  // where it frames the way through instead of blocking it. The two neighbours below are LEFT
  // ALONE: at x = -0.6 and 5.4 they stand just outside the posts at 0.7 and 5.1, so they close the
  // treeline around the opening, which is what a gateway in a wood should look like.
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([5.4, 13.0]), rotY: 2.6, scale: 1.3 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([9.8, 12.9]), rotY: 0.2, scale: 1.0 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([12.6, 11.4]), rotY: 1.4, scale: 1.25 }),

  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([12.8, 6.7]), rotY: 2.9, scale: 1.1 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([12.4, 0.4]), rotY: 1.6, scale: 0.85 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([12.9, -3.8]), rotY: 0.9, scale: 1.3 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([12.2, -8.6]), rotY: 2.4, scale: 1.0 }),

  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([9.4, -12.6]), rotY: 0.6, scale: 1.15 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([4.0, -13.0]), rotY: 3.1, scale: 0.95 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-0.8, -12.7]), rotY: 1.9, scale: 1.25 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-5.6, -13.1]), rotY: 0.3, scale: 0.9 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-9.8, -12.8]), rotY: 2.7, scale: 1.2 }),

  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([-12.7, -9.4]), rotY: 1.2, scale: 1.05 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-13.0, -4.2]), rotY: 2.1, scale: 1.3 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-12.5, 1.6]), rotY: 0.5, scale: 0.95 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-12.9, 7.2]), rotY: 2.8, scale: 1.2 }),

  // The wolf's own corner, so the fight happens somewhere instead of in an empty field. A loose
  // huddle of rocks and two trees at the edge of the combat bowl -- close enough to frame the fight
  // from the approach, far enough out that the bowl itself stays clear for the fight's own footwork
  // (the nearest body edge is 4.4 m from the spawn).
  // [-1.9, 9.6] first, which the body-aware bowl check rejected: 4.68 m centre distance looks
  // clear of the 4 m floor until rock-large's own 0.835 m half-width puts its edge at 3.85 m.
  Object.freeze({ model: 'props/village/rock-large.glb', at: Object.freeze([-2.6, 10.0]), rotY: 0.8 }),
  Object.freeze({ model: 'props/village/rock-wide.glb', at: Object.freeze([-1.2, 11.2]), rotY: 2.3 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-3.6, 10.4]), rotY: 1.5, scale: 1.1 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([7.4, 9.4]), rotY: 0.4, scale: 1.05 }),
  Object.freeze({ model: 'props/village/rock-small.glb', at: Object.freeze([7.0, 5.2]), rotY: 1.7 }),

  // ── the other two wolf grounds ──────────────────────────────────────────────────────────────
  //
  // The wolf used to live at one spot and that spot was dressed (the huddle just above). Now it walks
  // a three-point patrol, and the second and third fights were happening in bare grass -- played end
  // to end, rounds two and three are a hero and a wolf alone in an empty field with a lamp post.
  //
  // Every coordinate here was SOLVED, not placed by eye, against the same rules test/zone-data.test.mjs
  // enforces: at least 4 m clear of all three combat bowls counting the model's own footprint, off the
  // road, off every other prop, inside the plane. Three candidates from the first pass were thrown out
  // when the check was re-run with the test's real measured radii instead of the ones I had guessed --
  // rock-small is 0.663 m, not the 0.33 I assumed, and two placements were 3.9 m into a bowl.
  //
  // THE WEST PASTURE, around [-5.5, 5]. A fallen fence run on its far side, which is the little bit of
  // story the fight needs: this was the village's grazing land and the wall has come down. Three
  // panels end to end at rotY pi/2, the same joining rule the village fence documents.
  Object.freeze({ model: 'props/village/fence-broken.glb', at: Object.freeze([-11.9, 3.1]), rotY: Math.PI / 2 }),
  Object.freeze({ model: 'props/village/fence-broken.glb', at: Object.freeze([-10.9, 3.1]), rotY: Math.PI / 2 }),
  Object.freeze({ model: 'props/village/fence-broken.glb', at: Object.freeze([-9.9, 3.1]), rotY: Math.PI / 2 }),
  Object.freeze({ model: 'props/village/rock-large.glb', at: Object.freeze([-6.2, 9.8]), rotY: 1.1 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([-9.4, 7.5]), rotY: 2.0, scale: 1.1 }),
  Object.freeze({ model: 'props/village/rock-wide.glb', at: Object.freeze([-4.1, 0.4]), rotY: 0.6 }),

  // THE EAST SHOULDER, around [7, -1.5]. Rockier and more open than the pasture, so the two arenas do
  // not read as the same field twice.
  Object.freeze({ model: 'props/village/rock-wide.glb', at: Object.freeze([10.6, 1.7]), rotY: 2.2 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([10.5, -6.5]), rotY: 0.9, scale: 1.05 }),
  Object.freeze({ model: 'props/village/rock-small.glb', at: Object.freeze([2.3, -5.4]), rotY: 1.4 }),
  Object.freeze({ model: 'props/village/rock-small.glb', at: Object.freeze([8.1, -7.5]), rotY: 2.8 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([7.4, 3.4]), rotY: 1.7, scale: 0.95 }),

  // ── THE WILDWOOD, north of the gate ─────────────────────────────────────────────────────────
  //
  // Every one of these was SOLVED against the trail rather than placed by eye (tmp/solve-wildwood.mjs):
  // two rows a side, an inner wall about 4.4 m off the trail's centreline and an outer one about
  // 8.4 m behind it, each walked along the trail's own arc length with a fixed, non-random wobble in
  // spacing, distance and scale. Twenty candidates were rejected by the solver for standing on the
  // road surface, overlapping a neighbour's measured body, or hanging off the new north edge; these
  // are what survived.
  //
  // TWO ROWS AND NOT ONE, which is the only decision here worth arguing with. A single line of trees
  // beside a path reads as a stage flat -- you see the gap behind every trunk. Two rows means you see
  // trees BEHIND trees, and the wood has a depth the child cannot see the end of, which is most of
  // what makes a wood feel like one. It costs about twenty draw calls, measured in the running game
  // rather than assumed, and the far half sits past render/sky.js's FOG_NEAR anyway.
  //
  // No random numbers, here or in the solver: the same wood has to come out of both testers' iPads.
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([11.8, 14]), rotY: -0.95, scale: 1.1 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([-1.6, 14.3]), rotY: -1.85, scale: 1.35 }),
  // The tree that used to stand in the archway, rehoused. See the treeline note above.
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([6.6, 15.1]), rotY: 1.8, scale: 1.05 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([8.8, 17.3]), rotY: -1.6, scale: 1.35 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([-5.5, 17.4]), rotY: -0.43, scale: 1.45 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-1.9, 17.9]), rotY: -1.08, scale: 1.1 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([10.7, 19.2]), rotY: -0.83, scale: 1.1 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-1.5, 20.6]), rotY: 1.23, scale: 1.2 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-5.8, 21.5]), rotY: 2.65, scale: 1.25 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([8.9, 21.6]), rotY: 0.33, scale: 1.15 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-3.9, 23.1]), rotY: 2.77, scale: 1.25 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([8.7, 23.7]), rotY: -0.06, scale: 1.45 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([12.2, 25.1]), rotY: 0.59, scale: 1 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([6.5, 26.4]), rotY: 0.71, scale: 1 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-5.1, 27.6]), rotY: -2.74, scale: 0.95 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-9.8, 27.7]), rotY: -2.86, scale: 0.95 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([8.7, 29.6]), rotY: 1.36, scale: 1.2 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([5.4, 29.8]), rotY: 2.25, scale: 1.3 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([9.6, 31.8]), rotY: 2.13, scale: 1.3 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([-7.1, 33.2]), rotY: -2.09, scale: 1.35 }),

  // Boulders where the trail bends, so the two turns have something to turn AROUND rather than
  // being kinks in a line of trees. Same solver, same clearances.
  Object.freeze({ model: 'props/village/rock-large.glb', at: Object.freeze([7.4, 22.4]), rotY: 1.1 }),
  Object.freeze({ model: 'props/village/rock-wide.glb', at: Object.freeze([-2.6, 25.6]), rotY: 2.4 }),
  Object.freeze({ model: 'props/village/rock-small.glb', at: Object.freeze([3.6, 31.4]), rotY: 0.5 }),

  // ── THE OLD TRAIL LIGHTS ────────────────────────────────────────────────────────────────────
  //
  // Chapter 2's whole new verb, and it is six lamp posts. `dormant: true` is the only thing that
  // distinguishes them from the five street lanterns in the village: zoneLoader.js keeps their
  // glows OUT of the Lantern Tree's relight chain, so lighting the tree does not light these. They
  // stay dark until a child walks up to one CARRYING the lantern they earned in Chapter 1 -- see
  // world/trail.js for the rule and main.js for where it is ticked.
  //
  // That is the design in one line: the Chapter 1 reward stops being a thing on your belt and
  // becomes the thing that lets you go further. Nothing new to press, no new button on a screen
  // that already has two; walking near it with your light IS the interaction, which is the only
  // kind a young player discovers without being told.
  //
  // SPACED SO YOU CAN SEE THE NEXT ONE FROM THE LAST: 6.0 to 7.5 m apart, checked
  // (tmp/solve-trail-lights.mjs) rather than eyeballed. Further apart than about nine and "follow
  // the lights" stops being a mechanic and becomes a scavenger hunt. They alternate sides of the
  // trail so the lit path reads as a corridor rather than a fence.
  //
  // Each is 2.3 to 2.8 m off the road's centreline -- just off the surface a child walks on, which
  // is where a real trail marker stands, and close enough that its glow falls on the path.
  Object.freeze({ model: 'props/village/lantern.glb', at: Object.freeze([0.7, 15.2]), rotY: 2.0, dormant: true }),
  Object.freeze({ model: 'props/village/lantern.glb', at: Object.freeze([6.9, 18.4]), rotY: 3.9, dormant: true }),
  Object.freeze({ model: 'props/village/lantern.glb', at: Object.freeze([1.0, 21.0]), rotY: 0.7, dormant: true }),
  Object.freeze({ model: 'props/village/lantern.glb', at: Object.freeze([4.4, 25.9]), rotY: 2.6, dormant: true }),
  Object.freeze({ model: 'props/village/lantern.glb', at: Object.freeze([-2.3, 29.2]), rotY: 1.1, dormant: true }),
  // The last one stands in the clearing, so waking it lights the camp below.
  Object.freeze({ model: 'props/village/lantern.glb', at: Object.freeze([3.5, 33.1]), rotY: 3.4, dormant: true }),

  // ── THE ABANDONED CAMP ──────────────────────────────────────────────────────────────────────
  //
  // Where the trail ends, and the answer to "the road stops in an empty field", which is a defect
  // this project has now shipped twice. A trail has to arrive somewhere.
  //
  // It is built out of four props we already own and it has to be readable in one glance by a
  // young player, so it says exactly one thing: somebody was here and they left in a hurry. The
  // cart is ON ITS SIDE (`tiltZ` -- zoneLoader.js applies it, and it exists for this: an upright
  // cart in a clearing is a cart, a cart on its side is a story). A pen's fence has come down. A
  // bench sits where it was dropped. Nothing is burnt, nothing is bloody: this is a game for young
  // players, and "they ran" is frightening enough.
  //
  // Two wildwood trees were REMOVED to make this clearing rather than the camp being squeezed
  // between them, because a camp is where the trees are not.
  Object.freeze({ model: 'props/village/cart.glb', at: Object.freeze([-2.9, 32.4]), rotY: 0.9, tiltZ: 1.35 }),
  Object.freeze({ model: 'props/village/stall-bench.glb', at: Object.freeze([4.3, 34.4]), rotY: 2.2 }),
  Object.freeze({ model: 'props/village/fence-broken.glb', at: Object.freeze([-4.6, 30.4]), rotY: 0 }),
  Object.freeze({ model: 'props/village/fence-broken.glb', at: Object.freeze([-4.6, 31.4]), rotY: 0 }),
  Object.freeze({ model: 'props/village/fence-broken.glb', at: Object.freeze([-4.6, 32.4]), rotY: 0 }),
  Object.freeze({ model: 'props/village/rock-wide.glb', at: Object.freeze([6.6, 32.4]), rotY: 0.4 }),

  // ── THE OLD BEACON ROAD, north of the camp (G1) ─────────────────────────────────────────────
  //
  // Everything from here down was SOLVED against the real measured footprints and the real extended
  // road rather than placed by eye -- the same discipline (and the same FOOTPRINT_RADIUS_METERS
  // table) test/zone-data.test.mjs enforces and the Wildwood block above already used. Placement
  // order was deliberate and is worth keeping if these are ever re-solved: the WAYFINDING furniture
  // first (lamps, then the funnel boulders), then the wood filled in around it. Solved the other way
  // round, the trees ate every spot a lamp needed and the solver quietly returned a beautiful empty
  // forest with no route through it.

  // THE TWO APPROACH LAMPS. Dormant, so the lantern earned in Chapter 1 is still the thing that
  // wakes them: the reward stays a tool for the whole of the new stretch instead of expiring at the
  // camp. `road: 'beacon'` is the ONLY thing separating them from the six Dark Trail lamps above --
  // see TRAIL_LIGHTS and BEACON_ROAD_LIGHTS below for why that split has to exist (CAMP and ROWAN
  // are both derived from the trail's own last two lamps, so appending to that list would have
  // silently moved the camp trigger eighteen metres up the road).
  //
  // Spaced 6.2-6.8 m apart and 2.3 m off the road's centreline, which are the Dark Trail's own
  // numbers rather than new ones, and alternating sides for the same reason it does: a lit corridor
  // rather than a fence. The chain continues unbroken from the camp lamp at [3.5, 33.1] -- reference
  // rule 4, beacons come in chains.
  //
  // TWO AND NOT THREE, and the third one is worth recording because it was BUILT and then taken out
  // after walking the road. On this route's own spacing a third lamp lands at about z 49, which is
  // inside the Beacon's own 4.6 m arrival radius -- so waking it and arriving fired on the same
  // frame, stacking the relight chime, the arrival sound and the banner on top of each other, and
  // leaving nothing between the last thing a child collects and the thing they came for. Ending the
  // warm chain 6.1 m short is better than a tidier spacing: THE OLD LIGHTS DO NOT REACH THE BEACON,
  // and the last stretch of the walk is lit by the cold thing at the end of it instead.
  Object.freeze({ model: 'props/village/lantern.glb', at: Object.freeze([0.6, 39.2]), rotY: 1.9, dormant: true, road: 'beacon' }),
  Object.freeze({ model: 'props/village/lantern.glb', at: Object.freeze([3.1, 44.9]), rotY: 4.2, dormant: true, road: 'beacon' }),

  // THE FUNNEL. Two boulders where the road leaves the camp and two more at the bend: a natural
  // gateway made of things this world is already made of, rather than a second built arch. They are
  // the reason the way out of the camp reads as a way out and not as a gap the trees happen to leave.
  Object.freeze({ model: 'props/village/rock-large.glb', at: Object.freeze([-1.4, 36.9]), rotY: 0.9 }),
  Object.freeze({ model: 'props/village/rock-wide.glb', at: Object.freeze([6.2, 34.9]), rotY: 2.5 }),
  Object.freeze({ model: 'props/village/rock-small.glb', at: Object.freeze([4.6, 44.5]), rotY: 1.3 }),
  Object.freeze({ model: 'props/village/rock-wide.glb', at: Object.freeze([-2.5, 44.7]), rotY: 0.4 }),

  // THE FLANKING WOOD. Two rows a side again (about 4.7 m and 8.8 m off the centreline, with the
  // same fixed non-random wobble the Wildwood block above documents), so the child walks a corridor
  // and sees trees behind trees rather than a stage flat. Deliberately DENSER per metre than the
  // Dark Trail's: this is a shorter stretch and the brief for it is "a short dense path with
  // changing beats", not a long run.
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([6.7, 40.3]), rotY: 1.53, scale: 1.35 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([6.7, 44.9]), rotY: -0.03, scale: 1.2 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([7.6, 47]), rotY: -0.84, scale: 0.95 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([-3.6, 49.5]), rotY: -0.9, scale: 0.95 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([10.5, 34.3]), rotY: 0.62, scale: 1.45 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([11.9, 41.7]), rotY: 1.39, scale: 1 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([9.5, 43]), rotY: 1.37, scale: 1.15 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([9.2, 45.3]), rotY: -0.19, scale: 1.3 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-7.7, 38.2]), rotY: -0.21, scale: 1.2 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([-5.5, 39.9]), rotY: 0.56, scale: 1.45 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-3.9, 41.8]), rotY: -1, scale: 1.25 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([-5.7, 37]), rotY: -0.23, scale: 1.1 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-7.6, 44.3]), rotY: -0.25, scale: 1.3 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([-7.1, 46.5]), rotY: 1.29, scale: 1.35 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-6.7, 51.1]), rotY: -1.04, scale: 0.9 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([-5.3, 52.5]), rotY: 0.5, scale: 1.45 }),

  // THE WOOD CLOSING BEHIND THE BEACON. Two rows across the whole width at z 54-56.6, so a child who
  // walks past the Beacon walks into forest rather than into the visible end of the ground -- the
  // one thing the north edge of this world has never had. The gap directly behind the tower is on
  // purpose: nothing stands within 4.5 m of it, so the silhouette a child is meant to read stays
  // clean, and the second row closes that hole from 5.4 m back.
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-11.2, 54.7]), rotY: -1.55, scale: 1.35 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-8.3, 54]), rotY: -0.94, scale: 0.9 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([-6.4, 54.5]), rotY: -0.33, scale: 1.2 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-3.5, 54.9]), rotY: 0.28, scale: 1.45 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-1.5, 54.2]), rotY: 0.89, scale: 1 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([9, 54.8]), rotY: 0.23, scale: 1.15 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([10.9, 54.4]), rotY: 0.84, scale: 0.95 }),
  // The rear row sits PAST the walkable clamp at z = 57 rather than short of it -- found by a check
  // that failed: at z 56.0-56.6 a child could walk to the clamp and stand in open grass with the
  // whole wood behind them, which is the one thing this row exists to prevent. Scales are capped at
  // 1.2 here so that each trunk's own measured body still clears the ground mesh's edge at z = 58.
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([-8, 57]), rotY: -1.04, scale: 1.05 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([-5.4, 57.2]), rotY: -0.43, scale: 1.15 }),
  Object.freeze({ model: 'props/village/tree-crooked.glb', at: Object.freeze([0.2, 57.1]), rotY: 0.79, scale: 1.2 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([5.9, 57.0]), rotY: -1.09, scale: 1 }),
  Object.freeze({ model: 'props/village/tree.glb', at: Object.freeze([12.4, 57.2]), rotY: 0.13, scale: 1.1 }),
]);

// Where the trail's story beats happen, as pure coordinates. Derived from PROPS rather than written
// out again (GQ-007): the camp trigger is the LAST trail light, because that is the one standing in
// the clearing, so moving that lamp moves the trigger with it and the two can never disagree.
//
// SPLIT IN TWO on 2026-08-20 (G1), and this is the one edit in this file that could have gone wrong
// silently. The Old Beacon road adds two more dormant lamps, and the obvious thing -- letting them
// fall into TRAIL_LIGHTS with the other six -- would have moved CAMP.at (the LAST dormant lamp) and
// ROWAN.facing (the second-to-last) eighteen metres up the new road, so the camp's "you got here"
// trigger would have fired at the Beacon and Rowan would have spent the game staring past the child
// at a lamp post. Nothing in the types would have said so. `road: 'beacon'` is the marker that keeps
// the two chains apart; both halves stay derived from PROPS rather than retyped (GQ-007).
const DORMANT_LIGHTS = PROPS.filter((prop) => prop.dormant === true);
export const TRAIL_LIGHTS = Object.freeze(
  DORMANT_LIGHTS.filter((prop) => prop.road !== 'beacon').map((prop) => prop.at),
);
/** The lamps on the Old Beacon road, in the order a child walks past them. Same dormant rule and
 *  the same world/trail.js wake radius as TRAIL_LIGHTS -- a separate list, not a separate mechanic.
 *  There are two, and the count is a DESIGN decision rather than an accident of spacing: see the
 *  `road: 'beacon'` block in PROPS for why a third one had to come out. */
export const BEACON_ROAD_LIGHTS = Object.freeze(
  DORMANT_LIGHTS.filter((prop) => prop.road === 'beacon').map((prop) => prop.at),
);
// THE BLACK BRAMBLE, across the trail between the third and fourth lights.
//
// Chapter 2's second verb: a thing in the world a sword can change (world/bramble.js builds it,
// world/trail.js owns the three blows it takes). It is placed at the trail's first bend, which is
// the one stretch where a child cannot see past it before they arrive -- so it is a surprise rather
// than a chore visible from two lamps away.
//
// `spanMeters` 5.6 against a 4 m road: it covers the surface AND both shoulders, so from the trail
// there is no gap to steer through and it reads as blocking even though nothing in this game
// actually collides (see bramble.js's header for why that is honest rather than lazy).
//
// `rotY` -0.367 is square to the trail's own [4.4, 20.2] -> [3.4, 22.8] leg: atan2 of that leg's
// perpendicular. It is a literal because deriving it would mean indexing into ROAD.points, which is
// a worse coupling than a number with a test on it -- test/dark-trail.test.mjs asserts the bramble
// really is square to the nearest road leg, which is the property, and it would catch this number
// going stale the moment the trail is re-routed.
export const BRAMBLES = Object.freeze([
  Object.freeze({ at: Object.freeze([3.9, 21.5]), rotY: -0.367, spanMeters: 5.6 }),
]);

export const CAMP = Object.freeze({
  at: TRAIL_LIGHTS[TRAIL_LIGHTS.length - 1],
  // Generous, like the gate's: this is a "you got here" trigger for a thumb, not a keyhole.
  radiusMeters: 4.5,
});

// THE WRECKED CART, as a place to search rather than a placement to retype. `tiltZ` is the one
// marker in PROPS for "this cart is on its side" (see the abandoned-camp comment above) and there is
// only ever one, so finding it by that field IS finding the cart -- the same "derive it, do not
// restate it" rule CAMP itself already follows against TRAIL_LIGHTS.
// Exported (GP2) so main.js can find this exact placement's own THREE.Object3D at render time
// (zoneLoader.js names every prop instance `prop-${prop.model}`) and give it a small jolt/settle
// reaction when the cart is searched -- without zoneLoader.js needing to hand back a prop registry
// nothing else has ever needed.
export const CART_PROP = PROPS.find((prop) => prop.tiltZ != null);

// GP3: the Workshop's shell. Exported the same way CART_PROP is, for the identical reason -- so
// main.js can find this exact placement's own THREE.Object3D by name and dress it the instant
// Workshop I is bought. Found by model path rather than by a distinguishing field like the cart's
// own tiltZ: this prop carries nothing else that marks it unique, so its model path (the GP3
// brief's own "the unique existing longhouse") IS the uniqueness key -- true today because PROPS
// above lists house-longhouse.glb exactly once.
export const WORKSHOP_PROP = PROPS.find((prop) => prop.model === 'props/village/house-longhouse.glb');
export const CART_SEARCH = Object.freeze({
  at: CART_PROP.at,
  // Generous, the same reasoning CAMP and WILDWOOD_GATE give their own radii: a "search this" trigger
  // for a thumb, not a keyhole. Tighter than CAMP's 4.5 because the cart is one specific object in
  // the clearing, not the clearing itself.
  radiusMeters: 2.4,
});

// GP3-4: the Workshop's own interaction zone, same shape/reasoning as CART_SEARCH just above --
// generous enough for a thumb-and-eyes approach, not a keyhole around one specific object.
export const WORKSHOP_INTERACT = Object.freeze({
  at: WORKSHOP_PROP.at,
  radiusMeters: 2.4,
});

// THE WILDWOOD BLADE. Rowan's reward, name-checked in their own intro line ("See that sword?") before
// the Beacon is ever reachable -- so it has to already be standing in the clearing when a child first
// hears about it. Built rather than bought (world/wildwoodBlade.js), the same trade the gate and the
// bramble already make.
//
// [2.6, 31.0]: within 3 m of Rowan (close enough that "see that sword" reads as a gesture at
// something actually in view), clear of every camp prop by at least 1 m, and clear of the road's own
// surface -- all three checked in test/rowan-camp.test.mjs against the real layout.
export const WILDWOOD_BLADE = Object.freeze({
  at: Object.freeze([2.6, 31.0]),
  rotY: 0.4,
});

// ── THE OLD BEACON (G1) ─────────────────────────────────────────────────────────────────────────
//
// Where the new road goes, and the place Rowan has been naming since they were built ("The old
// Beacon has gone cold too"). world/oldBeacon.js builds it -- see that file's header for the
// reference sweep the form came out of and for the camera arithmetic that fixes its height.
//
// [2.6, 51.0] is 17.9 m from the camp's own centre and 1.4 m past the road's new end. That distance
// was chosen against the two things that actually constrain it, not by feel:
//
//   NEAR ENOUGH that the whole stretch is 18 m of walking -- about 7 s at a full run, 16 s at the
//   half-deflection push a young player actually holds (character/speed.js's own measured case).
//   The Dark Trail from the gate to the camp is 22 m, so this is a comparable leg rather than a new
//   expedition, and it is dressed at a higher prop density than that trail rather than a lower one.
//
//   FAR ENOUGH that at the camp it sits 33.7 m from the follow camera, where render/sky.js's fog is
//   about 14% -- present, hazed, and unmistakably somewhere else. A Beacon a child could touch from
//   the cart would be a prop; this one is a destination.
//
// `rotY` is DERIVED from the road's own last-but-one point rather than typed, the same rule
// WILDWOOD_GATE.arch.rotY follows: the step and the brace face back down the way the child comes in,
// and they cannot drift off the road if the road is ever re-routed.
const BEACON_AT = Object.freeze([2.6, 51.0]);
const BEACON_ROAD_APPROACH = ROAD.points[ROAD.points.length - 2];
export const OLD_BEACON = Object.freeze({
  at: BEACON_AT,
  rotY: Math.atan2(BEACON_ROAD_APPROACH[0] - BEACON_AT[0], BEACON_ROAD_APPROACH[1] - BEACON_AT[1]),
  // Generous, the same reasoning CAMP and WILDWOOD_GATE give their own radii: a "you got here"
  // trigger for a thumb, not a keyhole. Wider than CAMP's 4.5 because the plinth is 4.1 m across and
  // the arrival has to fire while the child is still far enough back to see the whole tower --
  // 4.6 m from the centre is 2.5 m clear of the stone, which is where it reads best.
  radiusMeters: 4.6,
});

// The two marker stones on the way up. Not props (nothing in the Kenney kit is a standing stone and
// we are not commissioning one) -- world/oldBeacon.js builds both out of the Beacon's own slate as a
// single merged mesh, the same trade the gate, the bramble and the blade all already make.
//
// WHERE, and why exactly two: the first stands where the road leaves Rowan's camp, so the way out
// reads as a MADE way rather than as a gap between two trees; the second stands on the outside
// shoulder of the bend, which is the only place on this route where a child has a choice to make and
// therefore the only place the reference sweep says a small landmark earns its keep. Both are 2.5 m
// or more clear of the road surface and at least 0.9 m clear of every prop body.
export const BEACON_WAYSTONES = Object.freeze([
  Object.freeze({ at: Object.freeze([5.2, 36.8]), rotY: 0.7, leanRadians: 0.07 }),
  Object.freeze({ at: Object.freeze([-1.6, 42.0]), rotY: 2.4, leanRadians: -0.09 }),
]);

// THE PEOPLE WHO LIVE HERE.
//
// Placed after walking up the road and looking: the village was a set of very good buildings with
// nobody in them, one old man beside the tree, and no reason for a child to believe anyone lived
// there. world/villagers.js clones them off the Keeper's own rig -- see its header for why that is
// the honest trade and not a shortcut we are hiding.
//
// Every one of them is STAGED AROUND THE PROBLEM, which is the point: this is a village whose tree
// has gone dark, so the market is still open but nobody is buying, someone is standing in their
// doorway watching the road the wolves come down, and someone is looking up at the dark tree. A
// child should be able to read "something is wrong here and these people care about it" off the
// silhouettes alone, before anyone says a word.
//
//   at      where they stand
//   facing  what they are looking at (a coordinate, so it stays true if the thing moves)
//   tint    a multiplier over the Keeper's own colormap, so they are three dye lots of the same
//           homespun rather than three of the same man
//
// The first pass had all three tinted within a few percent of white and their heights within 12 cm,
// and the capture was unambiguous: four identical old men. Sand, slate and dun, and a 28 cm spread
// in height, is what it took to read as three people. The tints stay desaturated on purpose -- this
// colormap carries the face and the hands as well as the robe, and anything stronger dyes the man.
//
// Clearances were checked against the same measured prop footprints test/zone-data.test.mjs uses:
// each stands at least 0.35 m clear of every prop body, and all three are well outside the combat
// bowls and off the hero's own spawn circle.
export const VILLAGERS = Object.freeze([
  // THE MARKET. Beside her own stall at the roadside, looking up and down the road rather than at
  // her goods -- nobody is coming. Tallest of the three and the first one visible from the spawn.
  Object.freeze({
    at: Object.freeze([-7.6, -4.4]),
    facing: Object.freeze([0, 0]),
    heightMeters: 1.70,
    tint: 0xe8d9b8,
    phase01: 0,
    lookPeriodSeconds: 9.0,
  }),
  // THE DOORWAY. Outside the north cottage, facing the lane the wolves come down. Shorter, and the
  // slowest to look away, because she is watching for something.
  Object.freeze({
    at: Object.freeze([-9.6, -0.2]),
    facing: Object.freeze([2.5, 8]),
    heightMeters: 1.42,
    tint: 0xa9b0bd,
    phase01: 0.37,
    lookPeriodSeconds: 13.0,
  }),
  // THE TREE. Standing under the Lantern Tree looking up at it -- the only one of the three who is
  // not looking at the road, and the one that makes the tree read as the thing this village is
  // upset about. Facing the tree's own coordinate, not a number copied from it.
  Object.freeze({
    at: Object.freeze([-4.0, -8.8]),
    facing: LANDMARKS[0].at,
    heightMeters: 1.55,
    tint: 0xc2a98c,
    phase01: 0.68,
    lookPeriodSeconds: 11.0,
  }),
]);

// The Lantern Keeper NPC. Not in PROPS (it animates and has a presenter of its own) and not in
// LANDMARKS (it is not scaled off a `height` field the same way -- see zoneLoader.js's
// KEEPER_TARGET_HEIGHT_METERS, measured against the running game rather than derived from this
// data module). Kept here anyway, distinct from SPAWNS.keeper, so the model path lives beside every
// other model path this zone names -- test/zone-data.test.mjs checks all of them against what V1
// shipped in one pass.
export const KEEPER = Object.freeze({ model: 'world/keeper.glb' });

// ── ROWAN, and what they send a child to do ─────────────────────────────────────────────────────
//
// The camp used to ask "who left this camp?" and never answer -- a dead end with a fresh coat of
// paint on it. The second playtest (the private engineering archive, 2026-08-15) is the evidence this beat
// exists to answer: the camp's own unresolved "who left this here, and what do they have" question,
// plus younger players independently asking for a new weapon -- read together as a want for visible
// progression, not just atmosphere. Rowan answers the first and gives the second. They followed the
// tracks up from wherever they came from and are camped here, watching the way they came.
//
// [0.8, 31.6]: inside CAMP's own radius (about 3.1 m from CAMP.at) rather than merely near it -- a
// story NPC standing just outside the "you got here" trigger would greet a child the rest of the
// game has not yet told they have arrived. Clear of every camp prop by at least 1 m (checked in
// test/rowan-camp.test.mjs against the real placements, not assumed).
//
// `facing`: the trail light BEFORE the camp, not a fourth copy of that coordinate (GQ-007) -- they
// are watching back down the trail they came up, the same "facing is a coordinate, so it stays true
// if the thing moves" convention VILLAGERS already documents.
export const ROWAN = Object.freeze({
  // Aldric's own rig, cloned the way the three villagers already are -- we do not own a second NPC
  // model, and this is a temporary representation for this slice (see world/rowan.js).
  model: KEEPER.model,
  at: Object.freeze([0.8, 31.6]),
  facing: TRAIL_LIGHTS[TRAIL_LIGHTS.length - 2],
});
