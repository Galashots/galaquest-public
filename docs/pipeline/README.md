# The GalaQuest asset pipeline — operator runbooks

**Written 2026-08-13 night, from measured runs, not theory.** Every credit figure below was
bracketed with real balance reads the night it was written. These runbooks exist so that ANY
competent operator — including a Sonnet-class agent with no memory of how we got here — can take
an asset from idea to shipped GLB without re-deriving the pipeline or re-burning the credits we
already burned learning it.

## The lanes

| You are making | Runbook | Measured cost | Wall clock |
|---|---|---:|---|
| A prop or piece of scenery (Meshy) | [props.md](props.md) | 15 credits | ~15 min |
| A character or NPC, rigged + animated | [characters-npcs.md](characters-npcs.md) | 23 credits + 3/extra motion | ~45 min |
| Wearable/held gear that mounts on the hero | [gear.md](gear.md) | 15 credits + fit time | ~1 h |
| Background village/world dressing (CC0) | [cc0-background.md](cc0-background.md) | 0 credits | ~30 min |
| The reference image any of the above starts from | [references.md](references.md) | 0 credits | ~10 min |

> **Public-repo gap (found 2026-08-20, A1 asset lane).** The generation tools these runbooks invoke
> — `tools/meshy/gen_prop.mjs` and its siblings — are **not present in the public repository**. Every
> *post*-generation tool cited below does exist here (`verify_native_clip.mjs`, `merge_clips.mjs`,
> `pose_anatomy.mjs`, `recompress_glb.py`, `glb_budget.mjs`). Until a Meshy client is ported into
> `tools/meshy/`, the credit-spending steps of every lane are executable only where that client and
> `.local/meshy/api-key.txt` exist. Treat those steps as private-only rather than assuming a missing
> file. See `docs/pipeline/briefs/beacon-warden.md`.

## Iron rules — read before any lane

1. **The API key is never printed, logged, committed, screenshotted, or put in a URL.** It lives
   at `.local/meshy/api-key.txt` (relative to the MAIN checkout `<repo root>`,
   not the worktree) and starts `msy_`. Every tool in this pipeline reads it from that file at
   run time. If it leaks, ask the owner to rotate it — never create credentials.
2. **Generation spends the owner's real money.** Do not start a credit-consuming task without his
   explicit authorization for that work. Read the balance before and after EVERY spend and record
   both — `tools/meshy/gen_prop.mjs` does this for you; if you write a new tool, copy that shape:
   ```
   curl -s -H "Authorization: Bearer $KEY" https://api.meshy.ai/openapi/v1/balance
   ```
3. **A malformed API request costs nothing.** Validation rejects before charging (measured
   several times). When unsure of a request body, send it and read the 400 rather than guessing.
4. **Everything gets LOOKED AT, whole — and judged against SEARCHED REFERENCES, not your own
   taste.** the owner's standing rule, stated twice on 2026-08-13 and binding on every agent: *"visual
   checks don't just mean looking at our own images... we're looking for references. Don't know
   how a shield looks? Search it up. Image search — can be very specific: '3D character holding
   a shield'. Don't know how armor should look? WoW character headpieces, shoulderpieces. Look
   at MULTIPLE images. Get a good idea of how it should look."* The procedure: (1) image-search
   the specific thing (genre-specific: this hero is Toon-Link-class; armor language is
   WoW-class), (2) look at several results, not one, (3) capture the RUNNING GAME whole-frame,
   (4) put them side by side, THEN modify. This has already caught: a robe-tearing idle, a
   shield reading as a floating wheel, a horizontal idle sword, a cuirass five metres in the
   air. A render is evidence about an asset; only the running game is evidence about the game;
   and neither means anything without a reference to judge it against.
5. **Raw Meshy output never ships.** The API's minimum texture is 2K PNG (~3 MB GLBs). Always
   recompress: `python tools/budget/recompress_glb.py in.glb out.glb --size 512 --quality 85`
   (512 for props/gear, 1024 for landmarks/NPCs). Then score it:
   `node tools/budget/glb_budget.mjs out.glb` — every gate must PASS or carry a written ruling.
6. **Multi-MB third-party inputs live in `tmp/` (gitignored), shipped GLBs in `public/assets/`,
   and generated assets never share a commit with unrelated runtime logic.**
7. **Verify GLBs by parsing them, not by importing into Blender** — the importer fabricates
   phantom meshes (a documented incident) and synthesizes garbage bone tails (measured z=10.16 on
   a 1.5 m hero). Twenty lines of Node on the JSON chunk is authoritative.
8. **Every edit to a main character or an important NPC gets an artist's review pass. MANDATORY —
   see the section below.** Rule 4 says look at everything against searched references. This one is
   stronger and narrower: for the hero, the testers' characters, and any NPC a child talks to
   (quest-givers, shopkeepers, the Keeper), a change is not finished when the numbers pass. It is
   finished when someone has *looked at it the way an artist looks at their own work* — anatomy,
   overlaps, silhouette — and iterated.

9. **A pose is measured against human anatomy, not against our own last build. MANDATORY — see
   "How a human body actually stands and bends" below.** the owner's ruling of 2026-08-14: our characters
   "look all weird like they're wearing a human costume. Standing strangely." Every clip we own
   fails the same two anatomical facts, and both are measurable before anything ships:
   `node tools/foundry/pose_anatomy.mjs <file.glb> [clip ...]`.
10. **Lessons are part of the asset deliverable.** Any asset run that exposes a new failure mode,
    wrong assumption, misleading visual/mechanical gate, credit-burning retry cause, fit convention,
    or runtime integration gotcha must update `docs/MISTAKES.md` and the stable runbook/skill future
    operators will actually read before the work is considered institutionalized. Follow the
    ledger's first-hit/repeat promotion rules; do not invent a GQ ID early. This applies across
    Meshy, T2D, characters, props, gear, rigging, animation, materials, fit, review and runtime
    integration — not just Character Studio.

## How a human body actually stands and bends — MANDATORY reading before posing anything

Written 2026-08-14 from the owner's ruling, then **measured on our own assets rather than asserted**. Every
number below with a `°` or a `%` came out of `tools/foundry/pose_anatomy.mjs`, whose forward axis is
cross-checked against the rig's own `headfront` marker and whose skeleton figures are read from the
skin's **inverse bind matrices** — the authority for a rig's rest — rather than from node TRS, which
in an animated GLB can hold frame 0 of some clip instead. A correct measurement on the wrong axis, or
off the wrong source, is the failure mode both checks exist to stop.

```bash
node tools/foundry/pose_anatomy.mjs <file.glb> [clip ...]   # SKELETON check, then POSE check
```

### 0. Why this is the one thing we cannot cheap out on

the owner's ruling, 2026-08-14: *"All agents must remember that humans notice when something doesn't look
human, with an EXTREMELY KEEN eye. It's just the cost of our asset pipeline, because we get it
right."* That is not a motivational line, it is a measurable fact about the audience:

- **The brain runs dedicated hardware for human body FORM.** Downing et al.'s extrastriate body area
  is a body-selective visual region — it responds to images and forms of human bodies far more than
  to other objects. Our players are not "looking at a character"; they are running a specialised
  human-detector.
- **Separately, joint MOTION alone is enough.** [Johansson's point-light walkers](https://en.wikipedia.org/wiki/Biological_motion_perception)
  attach lights to the joints and film in darkness. With no body, no face and no silhouette, viewers
  read the action, and in many cases the walker's gender, age, emotional state and identity. A rig
  with a welded lumbar and a frozen pelvis is discarding the exact signal humans read best.
  *(These are two complementary findings from two literatures — body-form selectivity and
  biological-motion perception. Do not merge them into one claim; an earlier draft of this section
  did, and it was wrong.)*
- **Motion makes it worse, not better.** Mori's original point about the uncanny valley is that
  movement makes the curve *steeper* — animated near-human figures are rated more disturbing than
  static ones. So **a good model with a bad clip is worse than a good model standing still.** This is
  why "the mesh looks fine in a render" is never the finish line here.
- **Children are not a softer audience for this.** They are fluent in bodies long before they are
  fluent in anything else. Stylisation buys us nothing on this axis.

The practical consequence: we will spend more on posing and rigging than the asset budget suggests,
and that is the deal. Cheap geometry with honest articulation reads better than the reverse.

### 0b. Stylisation: what you may exaggerate, and what you may not

Our characters are deliberately chunky. **That is the art direction and it is not a defect.** Do not
"fix" it, and do not cite `pose_anatomy.mjs`'s head-span number as evidence that it needs fixing —
that figure is a skeletal proxy (`Head` joint to `head_end`, over `Head` joint to foot), comparable
between our own rigs and to nothing else. **It is not the artist's crown-to-chin heads-tall and must
not be set against the ~7.5 drawing canon.** Visual proportion is the art director's call, measured
on the rendered character, not on the skeleton.

The line is: **silhouette proportion is free; kinematic anatomy is constrained.**

| Free to exaggerate (silhouette) | Constrained (kinematics) |
|---|---|
| heads-tall, limb thickness, hand and head size | where the joint pivot sits inside the limb |
| costume shape, outline, colour | segment ratios (femur≈tibia, forearm≈0.79×upper arm) |
| timing, snap, the size of a gesture | which part of the spine bends and which twists |
| face features, hair volume | that the limb's motion is driven from the joint that really drives it |

The distinction is *what the shape looks like* versus *how the mechanism moves*. Segment ratios sit on
the constrained side even though they sound like proportion, because they govern how a limb folds —
a forearm longer than its upper arm folds wrongly at every frame, at any level of stylisation.
Knowing the rules is what lets us break them on purpose: a character can be four heads tall and still
stand like a person; a photoreal one on a level pelvis will not.

### 1. The trunk is two rigid masses, and nothing bends at "the waist"

The ribcage is rigid. The pelvis is rigid. All trunk motion happens in the short soft span between
them, **shared out along the spine**, never hinged at one ring. And the two halves do different jobs:

| | flexion / extension | lateral bend | axial twist |
|---|---|---|---|
| lumbar (lower back) | ~65° / ~31° | ~30° | only ~15° |
| thoracic (chest) | ~48° combined | ~30° | **~47°** |

So **bend comes from the lower back; twist comes from the chest.** A character who turns to face
someone rotates the thorax. One who leans to shift weight bends the lumbar.

**What ours do instead.** Measured trunk rotation, averaged per frame over whole clips:

| clip | `Spine` (lumbar) | `Spine01` | `Spine02` | `Hips` share of all trunk rotation |
|---|---|---|---|---|
| hero `idle` | **0.5°** | 7.5° | 9.5° | 35.6% |
| keeper v1 `idle` | **1.2°** | 7.6° | 10.1° | 36.1% |
| `Stand_and_Chat` | **3.1°** | 13.0° | 8.2° | 38.7% |

The lumbar joint has 30° of lateral bend available and uses **half a degree**. It is welded. The
torso is therefore rigid from pelvis to chest, and the whole lump pivots at the hip joint instead —
which is why the robe creases in a ring exactly at the belt, and why the top half reads as a doll
spinning on a peg. `pose_anatomy.mjs` prints this share per joint and flags any single joint carrying
over half of it as a HINGE.

### 2. Humans never stand symmetrically — and stillness is the tell, not limb angle

Weight rests on one leg; that hip rides **high**, the opposite shoulder drops, the spine takes an
S-curve, the free knee softens and its heel lifts. Feet sit about hip-width apart (~0.17 m between
heel centres) and turn out ~14° between their long axes. Nothing is mirrored.

**The measured discriminator, from a controlled before/after** — same body, same camera, same
bearing, only the clip swapped (`keeper-v1-shipped` vs `keeper-v1-standchat`):

| | Idle_02 (reads as a mannequin) | Stand_and_Chat (reads as a person) |
|---|---|---|
| stance / hip width | 2.30 | **1.40** |
| shoulder tilt range over clip | 0.5° | **17.7°** |
| pelvis tilt range over clip | 1.7° | **7.9°** |
| arm abduction | 33–64° | 45–49° |

**Arm abduction is NOT a gate, and this is a correction of a claim made earlier in this same
session.** The first diagnosis was "the arms are parked 35–39° out where a relaxed human is ~0–5°, so
the character reads as a coat on a hanger." The controlled swap falsified it: abduction went *up* and
the character looked *better*. What actually tracks the improvement is **stance width and how much
the torso moves**. A pose that never changes, on a level pelvis, over parallel feet, is the costume.

### 3. The skeleton is checked before the pose — every biped, every time

the owner's ruling, 2026-08-14: *"rigging and skeletons must always be checked and in alignment with human
anatomy for bipeds."* A pose can only ever be as good as the rig under it, and an auto-rigger fits
joints to a mesh without knowing what a joint is for. What to require:

- **Pivots sit at anatomical joint centres** — the centre of the kneecap, not the front or the back
  of the leg. Off-centre joints deform badly the moment a limb twists, which is where roll/twist
  bones get blamed for a placement problem.
- **The clavicle starts near the body centre and slightly forward**, where a real one rotates from —
  not out at the shoulder cap. A clavicle parked at the deltoid is why shoulders shrug when an arm
  lifts.
- **Segment ratios hold even under stylisation.** Forearm ≈ 0.79 × upper arm; tibia ≈ femur (~1.00).
  These are near-constant across real body sizes, which is exactly why they survive exaggeration.
- **A lumbar joint exists and is animated.** A `Spine` that never moves is a rig with no lower back.
- **Left/right difference is REPORTED, not graded — and this is a correction.** An earlier version of
  this rule required limbs to match "within a human's ~2%". **That 2% was invented; no source was
  ever cited for it, and the literature does not support a clean line.** Human bilateral asymmetry is
  normal and systematically right-biased, and a radiographic study of living adults reports a mean
  absolute humerus length difference of **27 mm**. The often-quoted 5–14% asymmetry figures are
  diaphyseal *cross-sectional* measures, not lengths. So a few percent of limb-length asymmetry is
  **not** automatically a defect, and no character may be rejected on that number alone.
  What the number is genuinely good for is **mechanical** consequence, which needs no perceptual
  threshold: a mirrored clip lands differently on each side, and gear anchored to each hand sits at a
  different distance from its shoulder. Judge it on that, plus the artist's review pass.

**What ours measure today (2026-08-14), from the inverse bind matrices:**

| | hero | keeper v1 | keeper v2 |
|---|---|---|---|
| forearm : upper arm (human ~0.79) | 0.923 | **0.625** | 0.855 |
| shin : thigh (human ~1.00) | **0.843** | 1.126 | 0.881 |
| worst left/right bone difference | 11.93% (upper arm) | 6.39% (forearm) | 3.85% (upper arm) |

Keeper v1's forearms are stubby at 0.625 — outside the range and part of why it is being replaced.
**Keeper v2 is the best-built rig we own on every one of these measures.**

The hero's 11.93% is the one with a real cost, and it is a *mechanical* one rather than a claim about
what anyone can see: his two hands sit at measurably different distances from their shoulders, so a
mirrored clip is not mirrored on him and the sword and shield mounts are not equivalent. Confirmed
identically in node TRS and inverse bind matrices, so it is the rig and not a baked frame. **the owner's
ruling of 2026-08-14: grandfathered for this slice — deliberate post-slice rig debt.** Changing the
skeleton now would invalidate existing animation, the sword/shield fits and possibly the skin
weights. C2 works with the arm as it actually is; it does not try to "correct" the asymmetry through
animation.

None of this is fixed here. It is recorded so the next character is checked **before** it is
accepted, and so nobody re-derives it from scratch.

### 4. What this means when you pick a clip

- **Measure a candidate before you accept it, and again before it ships.** A Meshy action costs 3
  credits and its name tells you nothing about its anatomy — `Idle_02` is the library's calm default
  and it is the worst-scoring clip we own.
- **A green budget score is not a pose.** `glb_budget.mjs` says nothing about any of this.
- **Do not fix a bad pose with a transform.** Rotating or scaling the model to hide a welded lumbar
  is the same error as hiding a bad asset with a mount offset.
- **Ground contact is load-bearing.** A foot that floats or sinks reads as wrong instantly, because
  contact is the one cue the biological-motion system has an absolute reference for. Check the heel
  height difference the tool reports, and check it in the running game, not in a viewer.
- **A clip is not judged by its name.** `Idle_02` sounds like the safe default and is the worst clip
  we own. 3 credits buys a clip; the measurement that tells you whether it was worth buying is free.

## The artist's review pass — MANDATORY for main characters and important NPCs

**the owner's ruling, 2026-08-15, binding on every agent.** It applies whenever you edit, regenerate,
re-rig, re-pose, re-fit, re-texture or re-animate:

- the **hero**, and each player's playable character (younger players, older players);
- any **important NPC** — a quest-giver, a shopkeeper, the Lantern Keeper, anyone a child
  approaches and interacts with.

It does **not** gate background dressing, props, scenery or crowd filler. Those keep rule 4.

**Think like a human artist reviewing their own subject, not like a test suite reading a gate.** An
artist does not ship the first version that technically renders. They put the piece next to the
reference, find what is wrong with it, fix that one thing, and look again — and they keep going
round until it reads right. That loop is the requirement. A single pass that finds nothing is
evidence you did not look hard enough, not evidence the asset is good.

**The pass, every time:**

1. **Search references first, before forming an opinion.** Rule 4's procedure, applied to the
   specific thing you changed: several images, genre-appropriate (this hero is Toon-Link-class;
   armour language is WoW-class; NPC silhouettes are Animal-Crossing/WoW-townsfolk-class). Never
   derive from geometry or symmetry what you can go and observe. If you cannot name three games
   that already ship the thing you are building, you have not searched enough.
2. **Capture the RUNNING GAME, whole frame, at gameplay scale AND at inspection scale.** A render
   proves a file; only the running game proves the game. Gameplay scale answers "does it read?";
   inspection scale answers "is it actually right?". You need both, because a defect invisible at
   90 px is still a defect, and a detail that only works at 400 px is not doing its job.
3. **Multiple angles. Minimum front, back, and three-quarter.** Most character defects are
   angle-dependent — a shield that reads as a disc from the front becomes an edge-on wheel from
   the side, and a Keeper who clears a tree from one heading fuses with it from another.
4. **Anatomy check, explicitly.** Do the proportions hold? Are shoulders, elbows, wrists, hips,
   knees where a body puts them? Does the pose carry weight, or is it a scarecrow? Do limbs bend
   the way limbs bend? Compare against the reference images, not against the previous version of
   our own asset — our own asset is how the error got in.
   **Run `node tools/foundry/pose_anatomy.mjs` and read it alongside the captures** (iron rule 9).
   This step used to end with "is the head level and the spine upright?" — that was wrong, and it
   was wrong in the direction that caused the defect. A level head over an upright spine on a level
   pelvis is a shop mannequin. Ask instead: does the weight sit on one leg, does the lower back bend
   at all, and does the torso twist from the chest rather than swing from the hips?
5. **Overlap and anomaly sweep, explicitly.** Hunt for what should not be touching: garment
   clipping through limbs, a beard sunk into a chest, a blade passing through an open palm, gear
   floating off its mount, a hand inside a shield, hair through a shoulder, feet under the ground
   plane, a waist collapsing, a coat stretching into long triangles. Say what you checked and what
   you found. "No anomalies" with no list is not a check.
6. **Iterate.** Fix the single worst thing, re-capture, look again. Repeat until the remaining
   defects are ones you can name and consciously accept. Then write down the ones you accepted and
   why — an accepted defect that nobody wrote down comes back as a bug report.
7. **Report what you looked at.** Name the references you searched, the angles you captured, the
   anatomy and overlap findings, what you changed between iterations, and what you knowingly left.
   Evidence, not adjectives — "looks good" is not a review.

**Hard stop.** If the asset cannot be made to read correctly by fitting, posing or mounting — if
the defect is in the mesh or the rig itself — stop and report the asset deficiency. Do not spend a
session searching for a transform that hides it. A numerically seated result that still looks wrong
is a wrong result; this rule exists because a self-consistent wrong answer is the most expensive
kind, since nothing in the maths ever complains.

**What this cost to learn** is written across `AGENTS.md`'s "Look before you derive" and "Playtests
are mandatory": three wrong shield fits that each satisfied every stated constraint, a hero shipped
as a featureless white silhouette while five analysis tools reported success, a sword whose hilt
hung 0.172 m from the hand it was supposedly held in, and a keeper whose waist read as broken in
half. Every one of them passed its numbers. None of them survived a look.

## Session ledger discipline

Every session that spends credits keeps a running ledger in its dossier or progress notes:
starting balance (API-read), one line per spend with the task id and consumed_credits, ending
balance. The 2026-08-13 night session's ledger lives in
`the private engineering archive` and the Phase V asset run below it:
lantern 15 + tree 15 + keeper (15 gen + 5 rig + 3+3+3 motions) = **59 credits**, 3,043 → 2,984.

## Where the deeper knowledge lives

- `the private engineering archive` — the armor/segmentation findings.
- `the private engineering archive` — Auto Split and part exports.
- `the private engineering archive` — the armour ladder and budget research.
- The `meshy` skill (user-level, the owner's machine) mirrors the API/browser measurements; these
  runbooks are the repo-resident, operator-facing distillation and take precedence for HOW-TO.
