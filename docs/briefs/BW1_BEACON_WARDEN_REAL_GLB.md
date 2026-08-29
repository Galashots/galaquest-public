# BW1 — Real Beacon Warden GLB integration

**Package class:** M — Coupled · **Owning initiative:** #90 · **Related requirement:** #79
**Base:** `main@6d771109615c0751e8861ff958d24e4bfdb4b7bf` · **Branch:** `feat/beacon-warden-real-glb`

Replace the procedural stand-in Beacon Warden body with the Owner's already-generated, already-rigged
Warden GLB, using that asset's **own** existing clips, and get it into the running encounter without
turning the change into the whole #90 encounter redesign.

This brief is also the checkpoint record. **C1 (asset qualification) and C2 (running-game
integration) are complete.** The identity question that stopped C1 was answered by the Owner on
2026-08-28: the `Meshy_AI_Thornbound_Warlock_biped` asset **is** the Beacon Warden.

## Objective

1. The procedural Warden body is replaced by the real Warden GLB, loaded through the production asset path.
2. Scale, origin, orientation and grounding are correct at normal gameplay framing.
3. The Warden reads immediately as a hostile boss rather than architecture (#79).
4. The Warden's own existing attack clip(s) drive the fight where semantically appropriate.
5. The existing three-phase fight logic is preserved; only a minimal adapter is allowed.
6. The player cannot walk through the Warden.
7. Provenance, licensing and production-asset identity are recorded accurately.
8. Runtime cost is measured from real bytes.

## Locked package contract

Included surfaces: the Warden's rendering/model loading, its animation adapter, Warden-specific asset
catalogue/provenance entries, the production derivative, minimal collision/separation, minimal
health/name anchor adaptation, targeted tests, targeted runtime evidence, and narrow Studio support
needed to inspect the Warden and its clips.

Explicitly excluded: #87 corpse loot, sword-drop/personal-loot redesign, moving the Wildwood Blade
reward, thorn asset replacement, thorn wither/retract, Beacon activation redesign, the full #90
boss-death world-state sequence, #78, #88, #89, #91, pets, NPC replacement, music, generalized zone
loading, the generalized Development Studio #92, material library #93, and PR #85/#86 corrections.

**No new provider generation or paid credit spend is authorized.** Only the already-generated asset and
its already-generated animations may be used.

## Current fixed-point facts (refreshed at the base SHA)

- The Warden's logical identity `beacon_warden` is stable. Its **body** is a procedural stand-in built
  in `public/src/enemies/warden.js`; that file's own header states the replacement contract: a
  generated GLB may replace the geometry **without `buildWarden`'s returned surface, the mode names, or
  the exported constants changing**. Those three things are the contract; the boxes are not.
- The fight rules live in `public/src/world/beaconSiege.js` and are pure and shared by client and
  server. The presenter is driven entirely by `(mode, modeSeconds, phase)`.
- Warden modes the rules can publish: `dormant`, `waking`, `idle`, `walk`, `overhead`, `sweep`,
  `pulse`, `hit`, `dying`, `dead`.
- The boss bar is anchored body-relative at `WARDEN_HEIGHT_METERS + 0.32` in `public/src/main.js`,
  importing the constant rather than restating it. **Preserving `WARDEN_HEIGHT_METERS = 2.6` therefore
  keeps the health/name anchor correct with no HUD change.**
- `worldObstacles()` in `public/src/world/obstacles.js` is a **static** blocker list (Beacon plinth,
  Lantern Tree). The Warden is not in it and cannot be — it moves.
- `separateFromEnemies` is exported from `public/src/combat/encounter.js` and is applied to the
  ordinary enemy collection in `net/gameServerCore.mjs`. **The siege never calls it.** That is the
  mechanism behind #79's "children could walk through it": the Warden has no separation at all today.
- `test/warden.test.mjs` pins the stand-in's *brief* — height band, shoulders over hips, long arms,
  exactly one pale-cyan accent on one shoulder, iron/stone/timber palette, no thin filigree — plus the
  pure pose function. Those palette/parts assertions describe the boxes, not the contract.

## Asset custody and identity

### What was recovered

| Field | Value |
| --- | --- |
| Provider source | `Meshy_AI_Thornbound_Warlock_biped.zip`, Google Drive (My Drive root), dated 2026-08-27 |
| Source SHA-256 | `56448250399a3078a4ed4ef79a66fdd6c2cfedabbee0ee46f674e087abca8c1c` |
| Source size | 19,938,516 bytes |
| Contents | three per-motion rigged GLBs: `Axe_Spin_Attack`, `Running`, `Walking` |
| Concept reference | an owner-generated concept image dated the same day, ~25 minutes before the model download |

The large provider source stays in the external Drive archive under current custody rules. Only the
optimized production derivative is committed.

### Identity — asked, and answered

**Resolved 2026-08-28: the Owner confirmed this asset is the Beacon Warden.** The reasoning that made
it a stop condition is kept below, because the shape of the doubt is the useful part: the asset
matched every stated attribute and was still not *identified*, and the difference between those two
things is what a worker must not paper over.

### Why identity was not settled by evidence alone

The Owner's authority (#90, and the BW1 dispatch) states that a real Beacon Warden already exists,
already rigged, already carrying attack animations. The recovered asset matches **every** stated
attribute and is the **only** asset that does:

- it is the sole rigged humanoid character asset anywhere in reachable custody newer than 2026-08-21;
- it is rigged, and it carries an attack clip plus locomotion;
- it was generated 2026-08-27, one day before #90 was written;
- its thorn theme is coherent with #90's thorn-barrier gatekeeper setpiece.

But nothing in the repository, in GitHub Issues, or in the Drive archive names it as the Beacon Warden.
The provider name is **Thornbound Warlock**. Its art direction also contradicts the committed canonical
Warden brief in three specific ways that `test/warden.test.mjs` currently enforces:

| Committed Warden brief | Recovered asset |
| --- | --- |
| "No antlers" | a large antlered crown |
| Exactly one cold pale-cyan accent | dark bronze/moss with a green accent |
| Weathered dark iron, ash-grey stone, aged timber | mossy stone and bronze |

One point does agree, and it is worth recording because it is easy to miss: the brief's "no weapon —
the arms end in heavy stone-gauntlet fists" holds. The concept image shows a staff; **the generated
model has empty gauntleted fists** and no staff geometry.

Reconciling those differences meant retiring committed, test-enforced art direction for this boss —
an Owner product decision, not a worker inference. With the Owner's confirmation, the palette and
antler assertions in `test/warden.test.mjs` retired **with the box geometry they described**, which is
the intended consequence of the redesign rather than a weakened test. The shipped file is named
`beacon_warden.glb` for its role, since a vendor name is not a runtime identifier.

## C1 result — asset recovery and qualification

Every number below is measured from the real bytes at this branch head.

### Structure and cost

| Measure | Source (per-motion file) | Production derivative |
| --- | ---: | ---: |
| Bytes | 6,767,308 | **618,224** |
| Triangles | 3,898 | 3,898 |
| Primitives / draw floor | 1 | 1 |
| Materials | 1 | 1 |
| Skins / joints | 1 / 24 | 1 / 24 |
| Texture | 2048² PNG, 6,471,988 B | 1024² JPEG, 239,082 B |
| Animations | 1 | 3 |

Shipped path: `public/assets/enemies/beacon_warden.glb`
SHA-256 `17177d6bb6b2556cefa0f8c7747613492bcd14b8068a8ed7438d5ed996ce8a7d`.

During C1, while identity was open, this lived in the tool-only Studio candidate store under the
provider's own name so the filename could not become a lie about identity. Once the Owner confirmed it
IS the Warden, it moved to the production enemy family under its ROLE name — a vendor name is not a
runtime identifier. The bytes are unchanged across that move; the SHA-256 above is the same file.

Built with the repository's own pipeline, no new tooling:

```bash
node tools/foundry/merge_clips.mjs --into <walking>.glb --out tmp/bw1/warden-merged.glb \
  --from "<axe-spin>.glb=attack_spin" --from "<running>.glb=run"
python tools/budget/recompress_glb.py tmp/bw1/warden-merged.glb tmp/bw1/warden-ship.glb --size 1024 --quality 85
node tools/budget/glb_budget.mjs tmp/bw1/warden-ship.glb
```

`node tools/budget/glb_budget.mjs` against `docs/teardown/hero_contract.json`: **every gate PASS** —
LOD0 target and hard cap, LOD1 target, draw count, payload (618,224 vs 1,572,864), atlas size, one atlas.
The raw provider file **fails** payload and atlas; the derivative is what makes it shippable.

### Clip inventory — measured, not inferred

| Clip in derivative | Source clip | Duration |
| --- | --- | ---: |
| `Armature\|walking_man\|baselayer` | Walking | 1.07 s |
| `attack_spin` | `Armature\|Axe_Spin_Attack\|baselayer` | 2.50 s |
| `run` | `Armature\|running\|baselayer` | 0.63 s |

All three source files carry the standard Meshy 24-joint biped and were checked with
`node tools/foundry/verify_native_clip.mjs` in **strict** mode: *same joint set, same order, same
hierarchy, same rest pose* for both merged clips. The merge is therefore native, not a retarget.

**There is no idle clip, and no hit, death, or overhead clip.** The asset supplies three clips against
ten modes the rules can publish. This is the single largest C2 design constraint and it is a measured
fact, not a worry.

### Three.js load proof

Loaded through the game's own vendored `GLTFLoader` in real Chrome and driven over CDP:

- loads clean, no console error, no magenta placeholder;
- **world height 2.3000 m**, bounding box min `(-0.9366, -0.0000, -0.4324)`, max `(0.9366, 2.3000, 0.4324)`;
- **feet sit at Y = 0** — the origin is at the soles, so the asset grounds correctly with no pivot
  correction and none of the buried-half-the-model failure a centred pivot causes;
- all three clips bind to an `AnimationMixer` and animate with no skinning tears;
- captured at four bearings plus five frames across the attack arc and one walk frame.

Worker visual self-check at inspection scale: it reads unambiguously as a large hostile armoured
creature, correctly proportioned against a 1.48 m hero reference, and the attack clip reads as a wide
sweeping strike. **This is the worker's own judgment and is explicitly not the visual acceptance gate.**

### Spend

Meshy balance read before and after all work: **662 → 662**. Only free `GET` calls were made (balance,
task lists, task detail). No task was created. **No provider spend occurred.**

The provider account holds **no** retrievable Warden task: the rigging and animation task lists are
empty and only two unrelated image-to-3D tasks exist (`wolf-enemy`, `human-base-body`). The Drive
archive is the only custody route for this asset, which is why it is recorded above by hash.

## C2 result — running-game integration

The procedural body is gone and the real Warden fights in the actual encounter. What shipped:

- **`enemies/warden.js`** loads the GLB through the production asset path, clones it with
  SkeletonUtils, cures the Meshy material defects with `normaliseCharacterMaterial`, and drives it
  from an `AnimationMixer`. `buildWarden`'s returned surface, the mode names and every exported
  constant are unchanged — the file's own long-standing promise about how a GLB would arrive.
- **Clips** are mapped only to what the asset owns. `walk` plays `walking_man`; `overhead` and
  `sweep` both play `attack_spin`, because the asset owns exactly one attack and inventing a second
  would mean grafting another character's motion onto this rig. No Hero or Keeper clip is used.
- **The seven clipless modes** (dormant, waking, idle, pulse, hit, dying, dead) are posed at the group
  level from the existing pure `wardenPose`, so the kneel, the wake, the flinch and the death fold all
  survive without a bone-axis calibration this package did not measure.
- **Collision** imports the existing `separateFromEnemies` law and points it at the Warden on both the
  server and offline client prediction. A dead Warden stops blocking; the dormant kneel does not.
- **The boss bar is untouched.** Holding `WARDEN_HEIGHT_METERS` at 2.6 and scaling the asset to it
  keeps the anchor correct with no HUD change.

### The invisible boss, and the check that now catches it

The first integration **scaled the body 113x and skinned it to a head height of 155.95 m**, off camera.
Nothing threw, no console error appeared, all 3,898 triangles were submitted every frame, and
`drive-beacon-siege.mjs` reported **ALL CHECKS PASSED** — against a boss nobody could see. Every
assertion in that harness asked about state; none asked whether there was a body in the world.

Cause: `Box3.setFromObject` on a freshly cloned, not-yet-parented hierarchy measured stale world
matrices and returned 0.023 m instead of the authored 2.3, so `WARDEN_HEIGHT_METERS / measured` came
back as 113 rather than 1.13. The self-correcting measurement converged confidently on the wrong
answer because it agreed with itself.

Fixed by `root.updateMatrixWorld(true)` before measuring. The prevention is the part that matters: the
presenter now publishes the `Head` **bone's** world height, and the harness asserts a sane band.
Verified red-capable by restoring the bug — it produced `head bone at 155.95 m against a 2.6 m Warden`
while `wardenBuilt` stayed true. Recorded in `docs/MISTAKES.md`.

### The second bug: one asset gating the whole zone

C2's first attempt made `buildWarden` async and had `zoneLoader` await it. `zone.ready` is what hands
`main.js` **every** presenter in the zone, so a 618 KB fetch ended up in front of all of them. The Old
Beacon went dark on reload — `built false, stirring false, glow null` — for a landmark that has nothing
to do with the Warden.

It was caught by the hosted browser matrix, not by the unit gate and not by the siege harness, and it
was confirmed causal rather than assumed: `drive-old-beacon` passes **65/65 on the package base**
(`main@6d77110`) and failed on `a5ad74e`; an A/B with the new collision disabled **still** failed, which
ruled the separation out and left the await. The matrix agreed, adding `drive-old-beacon`,
`drive-relight` and `drive-cart-loot` to the base's four pre-existing reds.

`buildWarden` is synchronous again and attaches its body when it lands, which is the degrade-to-nothing
shape the keeper, villagers and Rowan already use. `drive-old-beacon` is back to 65/65, identical to base.

## How C2 was executed

1. **Scale.** Author the derivative or its loader to `WARDEN_HEIGHT_METERS`. Measured 2.3000 m against
   the committed 2.6 m is a uniform ×1.1304. Keeping the constant intact keeps the boss-bar anchor and
   `test/warden.test.mjs`'s height-band reasoning correct with **no HUD redesign** (objective 11).
2. **Presenter.** Keep `buildWarden`'s returned surface, the mode names and the exported constants
   exactly as they are — the file's own stated contract — and swap the merged-box body for the GLB
   behind it. `setMode/setHeading/setPosition/update/setBrazier/getState` do not change, so `main.js`
   and the server need no rewiring.
3. **Clips.** Map only what the asset actually owns, and do **not** graft Hero or Keeper clips onto it
   merely because the 24 joint names match:
   - `walk` → `walking_man`;
   - `sweep` → `attack_spin` (a spin/sweep is the semantically honest match for the horizontal
     front-arc attack; its 2.50 s runs against `WARDEN_SWEEP_SECONDS` 2.2 s, so it needs a time scale
     or a trimmed window rather than a new clip);
   - `overhead`, `pulse`, `idle`, `dormant`, `waking`, `hit`, `dying`, `dead` have **no** native clip.
     Cover them from the rig's own rest pose plus the existing procedural `wardenPose` drive, which
     already exists and is already tested. Do not buy or invent clips inside this package; if the gap
     proves unacceptable, that is a reforecast, not a silent expansion.
4. **Collision.** The minimal correct fix is to apply the **existing** `separateFromEnemies` law from
   `public/src/combat/encounter.js` to the Warden with a Warden-sized minimum, rather than authoring a
   second separation rule (GQ-007/GQ-011). Measured body half-width is 0.937 m at 2.3 m, about 1.06 m
   once scaled to 2.6 m — materially wider than a wolf, so the minimum is a genuinely new authored
   number, not a restatement. It must be applied on the **server** and in client prediction through the
   same shared law, exactly as the ordinary enemy collection already is.
5. **Evidence.** Drive the existing `tools/runtime-test/drive-beacon-siege.mjs` seam for running-game
   proof in landscape and portrait gameplay framing plus one attack frame, then a hosted `[render
   preview]` bound to its exact `/source-sha.json`.

## Acceptance gates

| Gate | State |
| --- | --- |
| Source identity / provenance | **PASS** — custody by SHA-256; Owner confirmed identity 2026-08-28 |
| Production GLB validation | **PASS** |
| Current asset-budget checks | **PASS** (all seven gates) |
| No unexpected external texture/resource dependency | **PASS** — one embedded 1024² JPEG, one material, no external URI |
| No provider spend | **PASS** — Meshy balance 662 → 662, zero task creations |
| Unit gate `node --test test/*.test.mjs` | **PASS** — 2,069 passing; the two local reds are Windows-only artifacts (CRLF `CLAUDE.md`, `EPERM` temp-dir teardown) and hosted CI is the authority |
| Runtime — real Warden in the running fight | **PASS** — `drive-beacon-siege.mjs` ALL CHECKS PASSED, including the new body-in-the-world check at `head bone 1.34 m`, and "no console errors across the whole siege" |
| Visual worker self-check | **PASS** — captures opened; the Warden is visible, correctly scaled against the hero, grounded, boss bar on its head, attacking from its own clip. Not an acceptance gate. |
| Owner visual acceptance | **PASS** — 2026-08-29, Owner inspected the hosted preview (`galaquest-playtest-pr-99`) bound to `/source-sha.json` = `ae5f92d`, and approved: "Looks good!!" |
| Independent Director audit | **UNKNOWN** — needs a fresh context |

### What that acceptance does and does not cover

It is appearance approval of the running game at the exact PR head, which is the gate `AGENTS.md`
reserves for a human and which no machine evidence can substitute for. It is **not** a child/iPad
playtest, and it is not a judgement on the same-clip attack limitation below — that was flagged before
the Owner looked, and left open deliberately.

## Known limitations, recorded rather than hidden

- **The overhead and the sweep play the same clip.** The asset owns one attack. The two attacks stay
  mechanically distinct (arc, contact timing, who they hit) but no longer differ in silhouette. The
  fight's "which dodge is being asked for" read is weaker than it was with the procedural body.
- **The overhead's raised arms are gone.** Restoring a distinct overhead means driving arm bones
  procedurally, which needs a measured per-bone axis calibration this package deliberately did not do
  — Meshy exports this rig with a rotated Armature, so the pitch axis cannot be typed from intuition.
- **There is no idle, kneel, hit or death clip.** Those modes hold the rest pose with group-level
  lean/sink from `wardenPose`. The kneel and the death fold read at gameplay distance; they are not
  animation.

## Side quests found, not fixed here

- **The Warden has no collision today.** Root-caused above to the siege never calling the existing
  `separateFromEnemies`. It belongs to this package's C2 and is recorded so it is not lost if BW1 is
  re-scoped; it is not fixed on this branch while the package is stopped.
- **`docs/pipeline/briefs/beacon-warden.md`** is recorded in the asset-platform inventory as living
  only on the unmerged PR #11 branch, hardcoding paths that do not exist. If the Owner confirms a new
  Warden direction, that stale historical brief and the committed art direction in
  `public/src/enemies/warden.js` will disagree with each other; the inventory's `HISTORICAL_ONLY`
  disposition should be revisited then.
