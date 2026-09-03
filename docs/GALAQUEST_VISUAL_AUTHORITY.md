# GalaQuest visual authority

**Status: living public authority, incomplete by design.** This file defines the roles visual
references are supposed to play, records the current accepted evidence, and makes missing authorities
visible. A missing role is a gap, not an invitation to improvise a substitute from private history or
an old chat.

Running-game pixels remain the highest visual authority. The point of the rest of this document is to
make every lower-level reference answer one narrow question well instead of asking one attractive image
to decide palette, proportions, topology, pose, material, and progression at once.

## Authority chain

When two visual references disagree, the higher role wins for the thing it actually controls:

1. **NS-06 Runtime Truth Board** — what survives in the running game at play size.
2. **NS-03 Character Construction Master** — dimensions and silhouette.
3. **NS-04 Tier Progression Master** — what visibly changes from tier to tier.
4. **NS-02 Hero Identity Master** — face, hair identity, palette, emotional tone.
5. **NS-05 Materials and Colour Grammar** — surface treatment.
6. **NS-01 World Promise Frame** — overall environmental tone and hierarchy.

**Runtime evidence wins whenever concept art and actual play disagree.** An isolated render can reject
a bad asset; it cannot overrule what a child actually sees in the game.

## Current public inventory

| # | Artefact role | Controls | Does not control | Public status |
| --- | --- | --- | --- | --- |
| NS-01 | World Promise Frame | world tone, colour hierarchy, character/environment contrast, prop density, lighting softness | character dimensions | **MISSING IN PUBLIC** |
| NS-02 | Hero Identity Master | face/hair identity, palette, painterly treatment, emotional age | dimensions, topology, pose, perspective | **MISSING IN PUBLIC** — historical work referred to one, but the file is not in this public checkout |
| NS-03 | Character Construction Master | proportions, silhouette, hand/foot scale, limb thickness, attachment scale | palette/personality | [`docs/foundry/construction/hero_construction_master.png`](foundry/construction/hero_construction_master.png) |
| NS-04 | Four-Tier Progression Master | what each tier changes and whether tiers are distinguishable | exact geometry | **MISSING IN PUBLIC** as a single canonical sheet; tiers 1–3 nevertheless have runtime/child evidence below |
| NS-05 | Materials and Colour Grammar | approved surface/value treatment and wear/noise ceiling | shape | **MISSING IN PUBLIC** |
| NS-06 | Runtime Truth Board | what actually survives at play size | direction by itself — it is evidence | **ACTIVE EVIDENCE**: accepted shield/sword/helmet/shoulders, rejected helmet v1, and the 2026-08-12 child/iPad tier test |

**Do not cite an artefact marked MISSING IN PUBLIC as though it settles anything.** If a missing
canonical role matters to current work, either build that public authority deliberately or proceed from
a higher existing authority and record the limitation.

## Genre convention sits underneath the chain

The six roles answer *what GalaQuest looks like*. They do not answer every convention for how an item is
carried, worn, posed, or framed. Those conventions are observed, not derived.

Before fixing a presentation detail — shield carriage, weapon angle, pack placement, idle stance,
creature pose, UI framing — inspect at least three relevant examples. Start with GalaQuest's own
accepted runtime where it has solved the same convention, then use comparable third-person games for
independent examples. External games are convention evidence, not GalaQuest art direction.

The procedural version of this rule is the `visual-reference-first` skill.

## Comparative visual review is mandatory, not optional polish

Reference-first applies **after production as well as before it**. Every new or materially changed player-visible asset must receive a producer self-review under [`docs/review-guides/asset-visual-review.md`](review-guides/asset-visual-review.md) before handoff.

The producer must compare the result against the relevant GalaQuest authority and deliberately look for a reason to reject or revise it. A review that says only “looks good” is not evidence of critical judgment.

When web/image-search capability is available, use multiple attributable external comparisons to test convention and quality. Prefer official studio/publisher/game screenshots, credited production work, or real-world reference photography. Anonymous reposts, uncredited AI imagery, and one beloved franchise screenshot are weak comparison evidence and must not become GalaQuest art direction by accident.

For a Unity-bound asset, Unity is the required post-production comparison surface once import is possible. Inspect both a neutral diagnostic view and intended gameplay framing; motion must be observed in Play Mode when animation, cloth, VFX, deformation, or moving parts matter. Meshy/DCC beauty renders are useful diagnostics, not acceptance evidence.

Every producer self-review should identify the **strongest mismatch, weakness, or disconfirming reference** found. If that mismatch is material, fix/reject/reforecast before requesting independent review.

### Generated target references

Sometimes the intended visual is clear in words but no canonical image exists. In that case, the Production Director may generate a **non-canonical target reference** from the approved brief for direct comparison before expensive modelling or rework.

The generated image must be labelled `generated target reference — non-canonical` and assigned a narrow control role such as silhouette, palette/material treatment, proportion, gameplay readability, or environment massing. It does not become canon simply because it is attractive, and it cannot overrule accepted runtime evidence or Owner-supplied direction.

Generated targets are especially useful when an agent would otherwise be guessing from adjectives like “chunky,” “bad-ass,” “kid-readable,” “molten,” or “friendly but capable.” They should reduce ambiguity, not manufacture a new style authority.

## NS-03 — construction evidence and the heads-tall convention

The public Character Construction Master was built from the shipped mesh with shared camera scale,
orthographic views, gameplay-size renders, and measurements. The corresponding measured facts live in
[`docs/foundry/construction/hero_measured.json`](foundry/construction/hero_measured.json).

Heads-tall numbers are meaningless without saying where the head begins and ends. The same hero gives
two different values under two defensible conventions:

| Convention | Measured | Relation to 3.84 lock |
| --- | ---: | ---: |
| head-weighted vertices, top of hair through lower chin/neck boundary | 3.5024 | -0.34 |
| skeletal `Head` to `head_end` span | 3.8596 | +0.02 |

The skeletal span is almost exactly the 3.84 locked target, while the vertex convention reads shorter.
That is evidence about measurement conventions, not permission to rewrite the contract.

Several morphology directives in the public contract still carry their own open value status. Keep an
open directive open until the owner actually resolves it. The construction master itself has **not**
received a direct child/iPad proportion judgement; the child test below judged the gear-tier read, which
is a different question.

## NS-04 — four-tier progression direction

The intended across-the-room read is:

**hair / simple cloth -> shield -> helmet / stronger upper body -> cloak / largest weapon**

| Tier | Silhouette change | Palette direction | Intended one-second marker |
| --- | --- | --- | --- |
| 1 — Wayfarer | narrow cloth, exposed hair, no shoulder projection | cream dominant, slate-blue trim, warm leather | hair / blue collar |
| 2 — Ironwood Adventurer | rounded shoulder caps, large round shield | more wood/leather/slate blue | blue-rimmed shield |
| 3 — Silverguard | open-faced helmet, broader shoulders, longer weapon | muted steel dominant, deep slate blue secondary | helmet |
| 4 — Dawnwarden | higher outward shoulders, split cloak, largest weapon, stronger inverted triangle | pale steel/slate blue with restrained gold | cloak + large sword |

Tier 4 must not become "Tier 3 with more engraving". Spend visible change on silhouette and broad colour
masses. Keep the face open: the face/hair are a major identity signal and should not disappear behind a
closed helmet merely because the armour number increased.

### What the children actually tested

On 2026-08-12, the owner showed both child testers **tiers 1–3** at true 90 CSS px on the iPad, one
second each, shuffled, using [`docs/foundry/test/tier_test.html`](foundry/test/tier_test.html).

| Tester | Strongest set | What read as different |
| --- | --- | --- |
| older child | **Tier 3 Silverguard** | **the helmet** |
| younger child | **Tier 3 Silverguard** | **a shield, a sword, and a helmet** |

Both answered in **shape**, not just colour. That closes the gear-tier play-size/device question for
what was shown: tiers 1–3 read in the intended order, and the helmet is confirmed as the Tier 3 marker.
It does **not** prove Tier 4, because Tier 4 was not built or shown, and it does not substitute for a
child judgement of the proportion/construction master itself.

The instrument had one weakness: its "what was different" response allowed only one tap, while one
child naturally named three things. Before a Tier 4 test, make that response multi-select or otherwise
capture multiple observations without prompting.

## Slot value and runtime cost

A visible equipment slot is valuable when it changes silhouette at play size. The current practical
ranking is:

1. **Weapon** — extends beyond the body and reads while moving.
2. **Helmet** — high-value from Tier 3 onward, now child-confirmed as a tier marker.
3. **Shoulders** — strong theoretical silhouette value, but the 2026-08-12 children did not name them;
   do not assume a bigger Tier 4 shoulder automatically earns its cost.
4. **Cloak** — one major Tier 4 rear/side silhouette change.
5. **Boots** — modest late silhouette value.
6. **Chest** — prefer texture/value change unless geometry makes a genuinely new outline.
7. **Gloves** — too little play-size silhouette value to justify a dedicated geometry slot by default.

The old triangle-only framing was incomplete. Tier 3 measured 8,125 equipped triangles against an
8,000 LOD1 target and 10,000 hard cap, but the larger practical issue was separate primitives/materials
and their draw calls. **Slots/material organization can be a tighter budget than triangles.** Use the
current contract and tests for numeric gates rather than copying dated counts out of this paragraph.

## Lessons from the Tier 3 asset iterations

### Flat pieces and volumes need different briefs

The shield and sword were comparatively easy because one front reference constrains a mostly planar
shape. Helmet and shoulder generations were underdetermined by a single attractive view.

For a volumetric piece, state:

- width-to-height proportion;
- **where the widest point sits**;
- what the silhouette does at the top/bottom/attachment edge;
- fitted dimensions relative to the body, not just isolated beauty-shot proportions.

**A reference for a volumetric piece must depict fitted proportions, not merely attractive isolated
proportions.**

### Size against the body profile, not one bounding box

The rejected helmet demonstrated that a piece can clear the head's overall bounding box yet be far too
wide exactly where it sits. Use profile/slice measurement at the attachment height when the fit is
sensitive. `tools/blender/slice_profile.py` exists for that kind of measurement.

### Constraints can manufacture the defect

An early helmet brief over-constrained scanline continuity and encouraged a near-flat lower edge rather
than a believable open face. When a generation comes back subtly wrong, inspect the brief/constraint
before blaming the model or adding another geometric workaround.

### Material requests must compensate for observed provider bias, but only as dated evidence

A 2026-08-12 comparison found generated steel substantially brighter than its reference. The corrected
Tier 3 assets therefore asked for darker steel than the intended runtime appearance. Treat that as an
empirical historical calibration, not a permanent provider law: provider models change, so compare the
current result against the running hero at play size before copying an old value target.

## Tier 3 as accepted

The visual review before the child test predicted that Tier 3 would read first through its large
open-faced helmet and then its broader shoulders. The later child test confirmed the helmet prediction.

Recorded build evidence:

| Piece | Attachment | Approximate world size / note | Historical triangles |
| --- | --- | --- | ---: |
| Helmet | `Head` | 0.50 wide; final fitted height shorter than the natural generation | 330 |
| Shoulder x2 | `LeftArm` / `RightArm` | about 0.21 wide each | 183 each |
| Sword | `RightHand` | about 0.60 long | 318 |
| Shield | `LeftHand` | Ironwood shield retained through Tier 3 | 311 |

The right shoulder mirrors the same mesh rather than paying for an independent generation. The retained
wooden Ironwood shield was reviewed with the steel kit and kept because its blue rim ties into the
helmet/shoulder/sword accents while the warm wood prevents the set becoming monochrome.

## Tier 4 direction still open to proof

Before generating Tier 4, preserve these current directional constraints:

- build **new silhouette**, not scaled-up Tier 3 ornament;
- shoulders, if pursued, should flare higher/outward and earn their cost at 90 px;
- a future helmet should start shorter/fitted rather than relying on a large post-generation squash;
- one cloak should create a clearly new rear/side outline without hiding the whole child-sized hero;
- the weapon must be unmistakably larger/longer while preserving the approved proximal hand seating;
- use broad value masses; detail that vanishes at play size is not progression.

Because the Tier 3 child test did not name shoulders, **Tier 4 shoulder value remains a hypothesis**.
Build/test the cheapest readable silhouette experiment before spending heavily on a production pair.

## Detail floor

At the current gameplay scale:

- a progression cue should change silhouette or occupy a clearly readable several-pixel mass;
- details that collapse below roughly two screen pixels in the real render should usually be removed;
- a major armour piece gets a base colour, a few broad value planes, and at most one strong accent;
- reserve the strongest contrast for the face, weapon edge, and tier-defining feature rather than
  spreading contrast evenly across micro-detail.

The historical 2 px / 4–6 px figures are art-direction heuristics derived from the measured ~90 px hero,
not immutable engine constants. Running-game evidence can move them.

## Atlas/material direction

The target surface model is one coherent equipped appearance rather than one independent texture/material
per tiny gear piece. The earlier Tier 3 arrangement carried separate atlases for hero, helmet, shoulder,
sword, and shield, which increased material/draw pressure and conflicted with the one-atlas direction.

`tools/blender/merge_gear_atlas.py` is the existing public merge mechanism that proved a shared-atlas
approach for earlier gear. Re-read the live contract and budget tests before using any old atlas percentage
or payload number as a current gate.

The important design fact is perceptual: at this viewing size **perceptual bandwidth is usually tighter
than texture resolution**. Put texture area and contrast into face/identity and large value masses before
spending it on invisible stitching or rivets.

## Using this authority during generation/review

Label every supplied reference by role. A useful brief shape is:

- "Image A controls identity/palette only."
- "Image B controls dimensions/silhouette."
- "Runtime capture C is acceptance evidence at play size."
- "Generated target D is non-canonical and controls only silhouette + broad material value."

Review every visible asset against:

1. Is it unmistakably the intended object at target gameplay size?
2. Does its silhouette add information?
3. Does it preserve accepted large colour/value relationships?
4. Does it introduce detail that disappears in the runtime?
5. Does it belong beside the current accepted hero/loadout?
6. For progression gear, can a child identify the stronger tier quickly without being told the answer?
7. What is the strongest external comparison or runtime observation arguing that this result is still wrong?

**Only accepted outputs become future references.** Rejected explorations should not be fed back as
style authority; reference drift compounds quickly.

## What is still unresolved

The visual-authority system is intentionally not "complete" just because this document exists.
Current open proof includes:

- NS-01 world promise frame;
- NS-02 public hero identity master (or an explicit decision that runtime + construction evidence now
  replaces that role);
- NS-04 canonical Tier 4 progression evidence and the **four-tier** child test once Tier 4 exists;
- NS-05 materials/colour grammar;
- direct child/iPad judgement of the locked proportion/construction master if that waiver still matters
  to a future body decision.

The tiers 1–3 child test has **already been run**. Do not describe it as outstanding. The next meaningful
progression test is Tier 4 against the three proven earlier tiers, while the proportion-master test is a
separate question.
