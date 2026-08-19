# Gear lane — generated gear, mounted on the hero, judged in the running game

Proven runs: the chest-plate cuirass (976 tri, generate-and-fit proof), and the belt lantern
(shipped, 838 tri, mounted at the right hip through three live-fit iterations) — 2026-08-13.

Gear is where the pipeline's two worlds meet: a Meshy mesh and the live rig. The mesh half is
just [props.md](props.md). This runbook is the MOUNTING half, where every hard-won rule lives.

## The mounting facts (all measured — do not re-derive)

- Meshy has **no socket/attachment system**. Every piece is a separate mesh, parented to a bone
  by the engine. `public/src/character/gear.js` is that engine code and its header comments are
  required reading before touching anything.
- The hero rig's arm chain ENDS AT THE WRISTS — `RightHand`/`LeftHand` are wrist joints, no
  finger bones, the hand cannot close. Nothing will read as "gripped" at inspection distance and
  it does not matter at the 90 CSS px play size. The weapons-carry-their-own-hand convention is
  recorded in gear.js and is due for a decision BEFORE weapon two is authored.
- **Anchor at the bone HEAD.** This rig's importer-synthesized bone tails are garbage (Spine02
  tail measured at world z=10.16 on a 1.5 m hero). Blender-side, use a Child Of constraint with
  `con.inverse_matrix = (arm.matrix_world @ pb.matrix).inverted()`.
- Transforms in `RIGID_TIER2_GEAR`/`RIGID_BELT_LANTERN` are armature-relative glTF-axis bakes ×100
  (the rig exports at 0.01 scale). They are produced by harnesses, never typed by hand.
- The character's measured axes: **+X is the character's LEFT**, heading-0 forward is **+Z**.

## The fit loop

1. **Blender pre-fit (cheap, catches disasters):**
   ```bash
   blender --background --factory-startup --python tools/blender/fit_stress_gear.py -- \
     public/assets/hero/hero_lod1_ironwood_atlas.glb tmp/<gear>.glb tmp/<gear>-fit <Bone> <height_m> [dx_left] [dy_fwd] [dz_up]
   ```
   Renders walk + sword_slash + hit + death at extreme frames from three angles. This is the
   candy-wrap check (body-through-gear) and the clip-range check. CAVEAT: it does NOT apply
   gear.js's runtime transforms to the already-baked sword/shield, so ignore where THEY sit in
   these renders — only judge the piece you are fitting.

2. **Runtime fit (the real one).** Server up (`node server.mjs`), isolated Chrome on 9224. Three
   harnesses exist, one per mount style — clone the nearest for a new slot:
   - `tools/runtime-test/fit-shield.mjs --slide --out --roll` — forearm-strap style.
   - `tools/runtime-test/fit-sword.mjs --pitch --outboard` — in-fist re-aim (shortest-arc on the
     measured blade axis; position untouched).
   - `tools/runtime-test/fit-lantern.mjs --left --up --fwd --height` — belt/body offset style.
   Each applies the fit LIVE, captures four orbit angles, and prints the baked
   position/quaternion/scale to paste into gear.js. fit-shield self-checks the bake math against
   the sword's known values — if you change the sword, update its `SWORD_IN_FILE`.

3. **Judge like the owner.** Open every capture. Compare against genre references (image-search the
   class of character — Toon-Link-class for this hero). **Optimize the static mount for the IDLE
   silhouette** (Sol's ruling, 2026-08-13): the slash has motion to sell it; idle has nothing to
   hide a bad mount. Then check the walk and a real fight capture anyway.

4. **Interactions between pieces are real.** The re-tuned shield covers the left hip at idle —
   the lantern's first fit vanished behind it and moved to the right hip. When adding a piece,
   re-capture with EVERYTHING equipped and look at the whole character.

5. **Wire + verify.** Transform into gear.js, full suite, `play-fight.mjs` 16/16,
   `drive-marks.mjs` 16/16 (it exercises the unlock-mounted lantern), open the new captures.

## Character Studio bridge (forward-compatible note, added 2026-08-16)

The CSB phase (`the private engineering archive`) is building Character
Studio as an interactive fit/tuning surface, with SR5 adding a Grip Inspector, Shield Inspector, and
Fit Envelope. Until SR5 is accepted:

- `fit-sword.mjs`, `fit-shield.mjs`, `fit-lantern.mjs`, and `fit_stress_gear.py` remain the
  authoritative fit/measurement tools for this runbook. Nothing above changes.
- After SR5 acceptance, Character Studio becomes the preferred interactive fit/tuning surface for
  this work, while the scripts above remain backends, independent cross-checks, and fallbacks —
  they are not being retired.
- Every accepted player-visible gear change still requires running-game portrait + landscape
  confirmation, regardless of which tool did the tuning.
- Animation-driven fit checks (walk/slash/hit/death, or any future Studio-driven clip check) use
  the shipping runtime clip identifier discovered from the actual loaded Hero — never the
  Meshy/source/review label. See the runtime-identity discipline in the Character Foundry skill.

Do not document unimplemented Gear Contract v2 fields as already shipped; this note only bridges
today's fit-* workflow to a future accepted Studio inspector, it does not describe one yet.

## Unlock-gated gear

The belt lantern only mounts for a guest with 3+ marks. For fitting, seed a dedicated guest
through the store's OWN api (idempotent, permanently identifiable):
```bash
node -e "import('./net/rewardStore.mjs').then(({openRewardStore})=>{const s=openRewardStore('data/rewards.db');const g='fit-<piece>-guest-0001';for(let i=1;i<=3;i++)s.apply({guestId:g,type:'mark-earned',eventId:'fit:mark:'+g+':'+i});s.apply({guestId:g,type:'lantern-unlocked',eventId:'fit:unlock:'+g});s.close();})"
```
then pin the fit page's `localStorage['gq-guest-id']` to that guest (fit-lantern.mjs shows how)
and restart the server so nothing stale is cached.
