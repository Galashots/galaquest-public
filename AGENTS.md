# Agent instructions — GalaQuest

Read this first, every session. It is short on purpose; it points at the authorities rather than
restating them, because a summary that drifts from its source is worse than no summary.

## What this is

A browser MMO-inspired action-adventure aimed at young players, played on tablets in Safari and on
desktop browsers. three.js r170, plain ES modules, no bundler, no root `package.json`, vendored
dependencies.

> **Note on this repository.** This is the public GalaQuest tree. Some documents referenced by older
> notes live only in the private engineering archive and are not published; where you see "the
> private engineering archive", that content is deliberately not part of this repository. Nothing in
> the public tree depends on it at runtime or in the test suite.

## Reading order

1. `docs/MISTAKES.md` — the lessons ratchet. Cite applicable `GQ-NNN` ids in any brief or commit that
   touches what they name.
2. `docs/WORKFLOW.md` — roles (brain plans, worker executes one brief), the committed-handoff
   mechanism, and the session start/end checklist.
3. `docs/pipeline/` — the asset pipeline and its authority rules.
4. `ASSET-LICENSES.md` — where every shipped binary came from and on what basis it may be
   redistributed. Read before adding or replacing any asset.
5. Design authority notes below. **Read §14 before treating any earlier row as live**: §14.1 suspends the paid-AI-mesh
   non-goal, §14.2 reorders P1/P2, and §14.3 supersedes the §3 Engine row's TypeScript half with
   buildless JavaScript.
6. `docs/teardown/hero_contract.json` — geometry authority for character and gear work.
7. `docs/dossiers/` — per-phase research. Each gates exactly one phase and says which.
8. `the private engineering archive<X>/` — a phase's `brief.md`/`progress.md`/`state.md`, the committed
   handoff `docs/WORKFLOW.md` names as the mechanism. Check here for the phase you're resuming.
9. `docs/handoffs/` — history, newest last.

## Hard boundaries

- **No npm installs** in the runtime. It has zero dependencies and CI has no install step.
- **Push to `main` freely.** PRs, force-push, squash, and amend remain the owner's alone.
- Runtime server is port **5201**. The runtime proof drivers in `tools/runtime-test/` still use an
  isolated Chrome on port **9224 only** — never 9223.
- **Browser work outside those drivers goes through the `claude-in-chrome` extension**, attached to
  the owner's own signed-in session by his ruling of 2026-08-12 (superseding the older "never touch the
  signed-in browser" rule, which applied to the CDP-on-9223 route). Two browsers are paired and
  `list_connected_browsers` reports `isLocal: true` for **both**, which is wrong — one of them is
  the owner's work laptop, where a download or a `127.0.0.1` call goes to a machine you cannot read. Ask,
  or prove it by writing a file and looking for it, before trusting either.
- **No claim about how the game looks may come from a render.** It comes from the running game.
  A Blender render, a GLB inspection or an asset screenshot proves a file is correct and cannot
  prove the game looks right. See "Playtests are mandatory" below — this rule was bought expensively.
- **Editing a main character or an important NPC requires the artist's review pass.** the owner's ruling
  of 2026-08-15, MANDATORY, full procedure in `docs/pipeline/README.md` (iron rule 8). It covers the
  hero, the testers' characters, and any NPC a child talks to — quest-givers, shopkeepers, the Keeper —
  on **any** edit, including a re-fit, re-pose, re-texture or new clip, not only a fresh generation.
  Search references first; capture the running game at gameplay *and* inspection scale from front,
  back and three-quarter; check anatomy explicitly; sweep for overlaps and anomalies explicitly and
  say what you checked; then fix the worst thing and look again. **Think like a human artist
  reviewing their own work and iterating, not like a test suite reading a gate** — passing budgets
  is not the finish line, and a single pass that finds nothing means you did not look hard enough.
  If the defect is in the mesh or rig rather than the fit, stop and report it instead of hunting for
  a transform that hides it.
- **Rigs and poses are checked against human anatomy, always, for every biped.** the owner's rulings of
  2026-08-14 — our characters "look all weird like they're wearing a human costume. Standing
  strangely", and "rigging and skeletons must always be checked and in alignment with human anatomy
  for bipeds." Full reference in `docs/pipeline/README.md` (iron rule 9); run
  `node tools/foundry/pose_anatomy.mjs <file.glb> [clip ...]` on any rig or clip before accepting it.
  **Humans notice when something is not quite human, with an extremely keen eye** — the brain runs
  dedicated body-perception hardware, viewers read action, gender and mood from a dozen moving dots
  alone, and movement makes the uncanny valley *steeper*, so a good model with a bad clip is worse
  than a good model standing still. That cost is accepted deliberately, because we get it right.
  Three facts to carry: **the trunk is two rigid masses** — bend from the lower back, twist from the
  chest, nothing hinges at the waist (our `Spine` moves **0.5–3.1°** across whole clips against ~30°
  available, so the torso swings from the hips and the robe creases at the belt); **stillness is the
  defect, not limb angle** — proven by a controlled same-body clip swap where arm abduction got
  *worse* and the character looked *better*; and **silhouette proportion is free, kinematic anatomy
  is constrained** — chunky heads-tall is our art direction, but joint placement, segment ratios and
  which part of the spine bends must stay human. Left/right limb difference is **reported, not
  graded**: human asymmetry is normal and right-biased, so judge it on mechanical consequence (a
  mirrored clip is not mirrored; gear sits at different distances) rather than on a threshold. The
  hero's **11.93%** upper-arm difference is grandfathered for this slice as deliberate rig debt —
  C2 works with the arm as it is and does not correct it through animation.
- **Look up reference images BEFORE deriving anything visual.** Never work out how a thing should
  look, sit, hang or be held from geometry, symmetry or first principles. Go and see how games
  already do it — search World of Warcraft first, because its image supply is effectively unlimited.
  See "Look before you derive" below. This rule was also bought expensively.
- Never edit `docs/teardown/hero_contract.json` or hand-author `docs/decisions/*.json`.
- `docs/gally/` and `tools/teardown/test/gally-phase0-contracts.test.mjs` are **off limits**. Gally
  is a parallel side-project by owner ruling, revisited after the first slice.
- `tmp/`, `.local/`, and `data/*.db` are ignored. Large third-party archives belong in `tmp/`.
  The children's save file must never live in ignored scratch.

## Look before you derive

**The rule: if you are about to decide how something should LOOK, you must look at reference images
first. Not after. Not if stuck. First.**

This applies to every visual question, not only gear: how a weapon is carried, how armour sits on a
shoulder, how a character stands at rest, how a wolf holds its head when it snarls, how a tree is
massed, what a health bar looks like, how a hit registers, what a low-level zone reads like.

**Where to look: World of Warcraft, first and by default.** Not because GalaQuest should look like
WoW — it should not, it is a stylised kid-MMO — but because WoW has twenty years of screenshots of
every conceivable item on every conceivable body, and it solved these presentation problems for a
third-person camera decades ago. A search like `wow character holding a shield` or
`wow warrior sword and board` returns dozens of usable answers in seconds. Runescape, Zelda, Fortnite
and Genshin are fine secondary sources. the owner's own reference art outranks all of them when it exists.

**How, concretely:**

1. Name the thing in plain words, the way a player would: "character holding a shield", not
   "left-hand rigid attachment orientation".
2. Search images. Look at **at least three** examples, ideally from different angles.
3. Write down the convention you extracted, in one sentence, before you touch any numbers.
4. Build to that convention, then verify in the running game per "Playtests are mandatory".
5. Put the convention in a comment next to the values, so the next agent inherits the reasoning and
   not just the magic numbers.

**What it cost to learn.** On 2026-08-12 the shield was fitted to the hero's hand. It was solved
carefully: hand-bone axes measured on the live rig, the blade axis mirrored across the sagittal
plane, orthonormal bases constructed, a degenerate basis diagnosed and corrected, quaternions carried
to twelve places, the bind-pose bake verified to 0.00002 rig units against the known-good sword. The
geometry was right. The answer was wrong: **a shield is not held in the fist, it is strapped to the
outside of the forearm.** Six WoW screenshots settled in seconds what an hour of basis vectors could
not, because it is a convention, and conventions are observed, never derived. the owner's words for it:
"All it takes is me searching Google images ... and I can clearly see this stuff."

Three separate wrong fits shipped through review before the references arrived. Each was internally
consistent and satisfied every constraint that had been stated in words. That is the failure mode
this rule exists to stop: **a self-consistent wrong answer is the most expensive kind, because
nothing in the maths ever complains.**

**Red flags that mean you are deriving when you should be looking:**

- You are reasoning about mirrors, symmetry planes, or "the natural axis" of something physical.
- You are about to write "should be perpendicular to" about a real-world object.
- You have iterated on the same visual more than twice and it still looks off.
- You are choosing between interpretations of what the owner meant by a physical word.
- You could not name three games that already ship the thing you are building.

## Playtests are mandatory

This section exists because it did not, and the cost was a game nobody had looked at.

**Rule 1 — a visual claim comes from the running game.**

```
node server.mjs
```

Then open http://localhost:5201 and look at it. Renders prove a file is correct. They cannot prove
the game looks right, and on 2026-08-12 they actively concealed that it did not.

**Rule 2 — a feature is not validated by the children unless the children played it.** Showing them
images is a perception test, not a playtest. Its result transfers only as far as the images match
what the game actually draws, and that correspondence must be checked rather than assumed.

**Rule 3 — for any player-visible change, the worker must also personally inspect and interact with
the running game. A harness proves behaviour, but it does not substitute for playing the result.**

This closes the loophole between the other two rules. A driver in `tools/runtime-test/` can walk the
hero, read `window.__galaQuestRuntime` and assert that a thing happened — and it will report green on
a beat that is unreadable, mistimed, or ugly, because none of those are propositions it was asked to
check. Automated proof is necessary and it is not sufficient. Open the game, play the change at
gameplay framing, and judge it as the child will.

**What it cost to learn.** The hero rendered in-game as a featureless white silhouette: emissive
white flooding the surface, and `metallicFactor`/`roughnessFactor` omitted so glTF defaulted both to
1.0, leaving no diffuse response. The 1024 atlas loaded, decoded, and contributed nothing to a single
pixel. Every appearance decision this project had made — the chest-armour painting, the
Meshy-brightens-albedo correction, the tier colours, the 2/255 pixel comparisons, and the one-second
test both testers sat through — was judged against `tools/blender/render_glb.py` output. None of it had
ever reached the screen. Five analysis tools, three dossiers, a formal grilling session and a
child-validated perception test did not catch it, because every one of them verified the **asset**
and not one of them opened the **game**.

**In practice:**

- A commit claiming an asset looks right carries a runtime observation, not a render.
- `the private engineering archive` records the date of the last real playtest. If that date is older than the
  newest visual change, the change is **unproven**, and must be described that way.
- A tier, a gear piece or a zone is done when the children have played it on the iPad — not when it
  renders correctly, and not when a tool passes.
- Renders and GLB inspection keep their job: proving a file is what it claims to be. They are
  evidence about assets and never evidence about the game.

## Generating assets with Meshy

**Read `<local path>` before the first Meshy call**, whether API or
browser. It is the single source of truth for both agents and it is kept outside the repo because it
applies across the owner's projects.

The two rules that cost money if missed: the Rigging **API is bipedal-humanoid only** — never send a
quadruped to it. The logged-in browser account now has a confirmed `Quadruped Dog` path, but a
text-to-3D wolf can still exceed Meshy's 300K-face browser rig gate and must be remeshed first — and
**no task that consumes credits runs without the owner authorizing that specific work.** See
`the private engineering archive` for the measured browser result and
`<local path>` for the step-by-step workflow.

The API key is at `.local/meshy/api-key.txt` (gitignored). Never print, log, commit, or put it in a
URL. `.local/meshy/verify-key.mjs` is a free pre-flight that reads the balance without exposing the
value.

## Working conventions

- **One coherent task per commit.** Generated assets never share a commit with runtime logic.
- **Behaviour changes go red first**, against external authority or observed state, and the commit
  message carries the measurements — the failure output as well as the fix.
- **Evidence, not adjectives.** Every browser claim names the browser, viewport, target, exact head,
  observed values, and limitations. Attractive renders are not acceptance evidence.
- **Say what you did not verify.** Dossiers separate verified facts from hypotheses, and every
  hypothesis names how to settle it. A confident guess costs more than an admitted gap.
- Check `$?` explicitly before any irreversible step. Piping a gating command through `head`/`tail`
  masks its exit code and the following `&&` will fire anyway.

## Verification

```
node --test test/*.test.mjs
```

**Do not trust a test count written in a document — run the suite and read the number off it.** This
line said "115 tests" for long enough to be wrong twice, and was already wrong on the day it was
written. Counts change several times a session and a stale one here teaches an agent to think the
suite is broken when it is fine.

The invariant worth remembering instead: **CI passes exactly one fewer than a local run on the owner's
machine, and skips one more.** Two tests skip for environmental reasons, and neither is a failure:

- **the hero GLB measurement** — needs `tools/teardown`'s dependencies, which are installed on the owner's
  machine but not in CI, because the CI workflow deliberately has no install step. Runs locally,
  skips in CI. A *local* run that skips this one means `npm ci` in `tools/teardown` has not been done.
- **the Kenney external-URI sabotage** — needs a raw CC0 pack under gitignored `tmp/`, so it can
  never exist in CI and only exists locally if someone downloaded it. Skips in both, normally.

So the healthy shape is **local 1 skip, CI 2 skips**, of the same total. (This paragraph previously
said CI "skips one", which stopped being true the moment the Kenney sabotage landed — the exact
staleness GQ-003 is about, in the paragraph warning about staleness. Measured 2026-08-15: local
410/409/1, CI 410/408/2.) CI runs Node 24 on every push and pull request.

Browser proofs: `node tools/runtime-test/drive-touch.mjs` and `drive-two-clients.mjs`. **Every harness
in `tools/runtime-test/` spawns and owns its own server now (Phase H1)** — do not start one first,
and never point one at 5201. They need only the isolated Chrome on 9224.

## Lessons

the owner's instruction, 2026-08-13: *"All lessons learned must be tracked where appropriate to avoid
repeated gotchas."* They live in `docs/MISTAKES.md` now, not here — a lesson earns a stable `GQ-NNN`
id on its second repeat and, past that, either a test in `test/` or a one-sentence stated reason it
can't be one. Read it before any work that touches something a lesson already names.

**When a rule gets broken, the fix is a test, not a stronger sentence.**

## Asset budgets

Measure a GLB before shipping it, against the contract rather than by eye:

```
node tools/budget/glb_budget.mjs public/assets/hero/hero.glb
```

**Score the equipped character, not the file.** Sol's Q10 ruling is that we budget against the worst
legal runtime state, and a hero wearing a tier is several files at once. Pass every file the state
loads, repeating one that is worn twice, and add `--as-one-character`. Scored that way on
2026-08-12, Tier 3 breaches three budgets at once — **6 draw calls against 4, 5 atlases against 1,
and 8,125 triangles against an 8,000 LOD1 target** — none of which is visible one file at a time,
and none of which the hair split caused. See `the private engineering archive`.

**Two things that number needs beside it, or it will be re-derived wrongly.** It scores
`hero_lod1_6800.glb` plus four Tier 3 pieces. That hero file is **not what the runtime loads** —
`HERO_URL` is `hero_lod1_ironwood_atlas.glb`, which already has Tier 2 gear baked in as extra
primitives, and scoring *that* against the same Tier 3 pieces gives a different and non-comparable
8,455 / 7 / 4. And **there is no Tier 3 attachment code at all**: `gear.js` exports only
`RIGID_TIER2_GEAR` and `attachRigidTier2Gear`, so no Tier 3 state is reachable in the running game.
The children saw Tier 3 through `docs/foundry/test/tier_test.html`, not gameplay. The breach is real
and worth fixing; it is a projection of a state the game cannot currently enter.

What that measurement established on 2026-08-12, so nobody re-derives it: **the 1 MB payload cap is
a texture-encoding problem, not a geometry one.** Every shipped asset breaches it, and the texture is
65–99% of each file because Meshy and Blender both hand back PNG. `tools/budget/recompress_glb.py`
took the hero from 2,559,588 bytes to roughly a megabyte with geometry and clips bit-identical, and at
a true 90px play size **not one pixel differs by more than 2/255**. (This line used to quote
1,064,392 bytes as the result. `hero.glb` has measured 1,021,440 since it was re-shipped three
minutes after that sentence was written — the exact figure is in
`the private engineering archive` and pinned by `test/hero-asset.test.mjs`, which are
the two places to trust for it.)

Two things to know before reaching for it. It refuses any material whose `alphaMode` is not `OPAQUE`,
and that check is real — the PNGs do carry alpha, all of it opaque export residue. And
`test/hero-asset.test.mjs` **pins the hero's byte count on purpose**, so re-encoding the shipped hero
is a deliberate asset change that must update that pin; the other assertions in that test are exactly
what proves the re-encode was safe.

Geometry is a separate, real problem: the naked hero is 15,642 triangles against an **LOD1 target of
8,000**. No texture work fixes that — it needs decimation. `tools/blender/decimate_hero.py` does it;
a symmetric collapse to 6,800 changes **six pixels of 8,100** at play size.

## Fitting gear to the hero

Four tools, in the order you need them:

| Tool | Does |
|---|---|
| `tools/meshy/flatten_bg.py` | Vets a reference image before you spend credits |
| `tools/meshy/image_to_3d.mjs` | One image to one GLB, cost from `consumed_credits` |
| `tools/blender/slice_profile.py` | Width of a mesh at each height — how gear gets sized |
| `tools/blender/fit_gear.py` | Places gear on a bone and prints the numbers a runtime needs |
| `tools/foundry/shell_classify.py` | Recovers disconnected shells from the GLB and tests a cut height |
| `tools/foundry/rig_axes.py` | Bone world frames, scale uniformity, and whether two bones mirror |

**Size gear against a profile, never a bounding box.** The head's box is 0.4489 wide, so a 0.49-wide
helmet looks like it clears it by 9%. It does not — the head is 0.444 wide at ear level and 0.159
near the crown, while the generated helmet was widest at its bottom rim. That produced a mushroom.

**Two traps in `fit_gear.py`, both already paid for.** The armature root carries a scale of 0.01, so
anything under a hand `Bone` inherits it: a 0.47-unit sword from a 1.0-unit source needs a bone-local
scale of **47, not 0.47**. And Blender's bone-local numbers must never reach three.js — Blender is
Z-up and re-derives its own bone axes on import, glTF is Y-up. The tool leads with the glTF-space
rest transform relative to the hero root and labels the Blender figures `INSPECTION_ONLY`.

**Never trust the Blender importer as evidence.** It fabricates an unweighted `Icosphere` that is not
in the file, and it synthesizes bone TAILS — this rig's run to 1,233 units on a 1.5-unit character.
Verify by parsing the GLB's own JSON chunk.

**Meshy brightens albedo by ~45 levels** (reference steel median 109, returned 154), which is why
assets keep coming back near-white. Ask the concept artist for steel darker than you want it.

**`consumed_credits` is the cost, not the balance delta.** Two concurrent generations moved the
balance by 30 while each task cost 15, and the owner runs his own Meshy work in the same account.

**The hands are not mirrored, so never derive one hand's gear transform from the other's.** Both
hand bones measure determinant +1 — the rig was never symmetrized — and their X axes point opposite
ways. Negating an offset would place gear in roughly the right spot with the wrong orientation,
which is the failure that looks almost correct. `gear.js` solves each item independently as
`bone.matrixWorld⁻¹ · desiredWorld`; that is correct for any chain scale and must not be
"simplified" into a hardcoded 100. Re-measure with `tools/foundry/rig_axes.py`.

## Runtime rules that are easy to get wrong

Verified against the three.js r170 source, not inferred. Full working in
`the private engineering archive`.

- **A draw call is a visible glTF primitive.** three.js does not batch across meshes, and it does not
  merge geometry groups even when they share a material. `heroMaxDraws: 4` means four primitives.
- **`setDrawRange` is the only zero-draw way to hide part of a mesh.** It is two integers, uploads
  nothing, and three.js's own example calls it every frame. It expresses one contiguous window, so
  what it hides has to be contiguous in the index buffer.
- **Never resize an index attribute in place.** `WebGLAttributes` throws
  `"Resizing buffer attributes is not supported"`. Keep one worst-case-sized buffer and use
  `addUpdateRange`.
- **`mixer.update()` must run before `renderer.render()`.** The mixer writes only local TRS; the
  renderer refreshes world matrices at the top of `render()`. Reversed, every frame shows the
  previous pose and nothing ever throws.
- **Never set `matrixAutoUpdate` or `matrixWorldAutoUpdate` false under the armature.** On a bone it
  freezes the limb; on gear it detaches the prop while its bone keeps moving.
- **There is no clean cut on this hero.** Of 1,362 candidate heights, only 0.0000 and 1.5000 split no
  shell. Do not plan a height-based body split; the covered region needs authored replacement
  geometry. `tools/foundry/shell_classify.py --sweep` re-measures it.
- **Do not use `SkeletonUtils.retarget()`.** Issue #25751 ran three years and was closed by a
  JSDoc-only commit shipped in r184; we are pinned to r170, so the reported behaviour is what we get.
  Retarget offline in Blender with constraints plus `bpy.ops.nla.bake(visual_keying=True)`.
- **Never send this hero to Mixamo's auto-rigger.** It is documented to fail on disjoined parts and
  the mesh is 978 disconnected shells. Mixamo is a clip source only, via "Without Skin".
- **Author locomotion in place, not with root motion.** The server owns position.
- **Light layers are tested against the CAMERA, not against each object.** `projectObject` pushes a
  light only when `light.layers.test(camera.layers)`, and the pushed set then lights everything that
  camera draws. So layers cannot be used to light one object differently from another in a single
  pass -- but a camera rendering its OWN layer sees no scene lights at all unless lights are put on
  that layer too. `render/heroPreview.js`'s showcase pass carries its own key/fill/kicker rig for
  exactly this reason; without it the hero renders black.
- **`scene.background` repaints the whole frame at the top of every `render()` call.** A second pass
  with `renderer.autoClear = false` does not clear, but the background box/quad is still added to the
  render list and still covers everything the first pass drew. Null `scene.background` for the extra
  pass and restore it after.
- **`renderOrder` cannot put a transparent object behind an opaque one.** three.js keeps two render
  lists and always draws the opaque one first; `renderOrder` only sorts WITHIN a list. A translucent
  backdrop that must land behind opaque subjects needs its own render pass (and therefore its own
  layer), not a negative renderOrder.
- **`renderer.clearDepth()` is what makes an overlay pass immune to world geometry.** Depth values
  left by a previous pass belong to that camera's projection; a second camera's fragments tested
  against them occlude arbitrarily. Measured on this game: with the clear removed and the follow
  camera pinched to `MIN_DISTANCE` at a building edge, the Hero screen renders no hero at all, while
  every one of the harness's own 64 checks still passes.
