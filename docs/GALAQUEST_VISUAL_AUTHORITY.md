# GalaQuest visual authority

**Status: proposed scheme, half built.** Of the six canonical references below, two exist (NS-02,
NS-03) and one has started collecting evidence (NS-06, two entries). Three are gaps. This
document is written now so that the gaps are visible and so that generation requests can start
citing roles rather than vibes — not because the set is complete. **Do not cite an artefact marked
MISSING as though it settles anything.**

Proposed on 2026-08-12 by ChatGPT 5.6 Sol (High) in the GalaQuest project, as the art-direction leg
of a three-way armour research round. Reconciled against measured repo facts by Claude and against
`the private engineering archive` by Codex/Luna.

## Why this exists

`docs/foundry/identity/hero_identity_master.png` has been quietly doing the work of six different
authorities. It is a painting: it legitimately fixes palette, face and tone, and it is stamped
NON-DIMENSIONAL DESIGN REFERENCE — DO NOT TRACE precisely because it must not fix dimensions. Every
time something is generated "to match the hero", it is worth being explicit about *which* of those
things is being matched.

## The authority chain

When two references disagree, the higher one wins:

1. **Runtime Truth Board** — actual game renders
2. **Character Construction Master** — dimensions and silhouette
3. **Tier Progression Master** — what each tier changes
4. **Hero Identity Master** — palette, face, tone
5. **Materials and Colour Grammar** — surface treatment
6. **World Promise Frame** — overall tone

**Runtime evidence wins whenever concept art and actual play disagree.** That ordering is the whole
point: a beautiful inspection render has already lost an argument with a 90px screenshot.

## Genre convention sits underneath all six

The chain above answers *what GalaQuest looks like*. It does not answer *how a thing is carried,
worn, or posed* — that is genre convention, it is shared with every third-person game ever shipped,
and none of these six artefacts encode it.

**Convention is observed, never derived.** Before fixing any presentation detail — how a weapon is
held, where a shield sits, how a pack rides, what an idle stance does with the arms — search
reference images and look at three or more. **World of Warcraft first**, because its image supply is
effectively unlimited and it settled third-person presentation twenty years ago. This is a source of
*conventions*, not of style: GalaQuest's own look still comes from the chain above, and any of the
six outranks a WoW screenshot on palette, proportion, silhouette or tone.

The rule and what it cost are in `AGENTS.md` under "Look before you derive"; the procedure is the
`visual-reference-first` skill.

## The six

| # | Artefact | Controls | Explicitly does NOT control | Status |
|---|---|---|---|---|
| NS-01 | World Promise Frame | Tone, world colour hierarchy, character-to-environment contrast, prop density, lighting softness | Any character dimension | **MISSING** |
| NS-02 | Hero Identity Master | Face, hair identity, palette (cream / slate blue / warm leather / muted steel), painterly faceted treatment, emotional age | **Dimensions, topology, pose, perspective** | `docs/foundry/identity/hero_identity_master.png` |
| NS-03 | Character Construction Master | Head-to-body proportion, shoulder width, hand and foot scale, limb thickness, hair silhouette, gear attachment scale | Palette and personality | `docs/foundry/construction/hero_construction_master.png` |
| NS-04 | Four-Tier Progression Master | What each tier changes, and that the tiers are distinguishable | Exact geometry | **MISSING** |
| NS-05 | Materials and Colour Grammar | Approved material treatments and the wear/noise ceiling | Shape | **MISSING** |
| NS-06 | Runtime Truth Board | What actually survives at play size | Nothing — it is evidence, not direction | **6 entries** (shield, sword, helmet, shoulders accepted; helmet v1 rejected; **the children's one-second test, passed 2026-08-12**) |

NS-03 was the gap that bit hardest, and it now exists — built on 2026-08-12 from the shipped mesh
rather than from a painting, which is the whole point of it. Four orthographic views sharing one
camera scale, a head-division grid computed from that scale rather than eyeballed, true 90px and
150px renders, and the measurements beside them.

**What building it revealed, and read this carefully because the two figures disagree.** Heads-tall
depends entirely on where you decide the head starts and stops, and this mesh gives two answers:

| Convention | Measured | vs the 3.84 lock |
|---|---:|---:|
| Head-**weighted vertices** — 0H at the top of the hair, extending below the chin | 3.5024 | **−0.34** |
| **Skeletal** — the `Head` joint to the `head_end` joint | 3.8596 | **+0.02** |

**By the rig's own head span the hero is 3.86 heads, which is the locked target almost exactly.**
The vertex figure reads 8.8% short, and quoting it alone — as the first version of this document
did — is misleading.

The 0.0396 difference in head height breaks down as **0.0067 of hair above the `head_end` joint and
0.0329 of jaw and neck below the `Head` joint**. So the top-of-hair boundary is real but small here;
most of the discrepancy is at the chin end. the owner flagged the hair boundary, which prompted the check;
the measurement then showed the hair is the smaller half of the effect.

This matters beyond one number. The contract records the same split on the source illustration —
3.84 hair-included against a 4.31 skull-to-chin heuristic — so **any heads-tall figure is
meaningless without its convention attached**, and a spiky hairstyle alone can move it by a third of
a head.

It also settles one of the four open directives in the right direction. Note-4 requires forearm
thickness to only ever increase from candidate C, whose `forearmTaper` of 0.78 made the forearm
strictly thinner than the upper arm. **The interim hero measures 0.9130**, so it already satisfies
note-4's direction.

The other three — shoulder width +8–12%, hands +10–15%, chunky feet — remain `valueStatus: open`.
They are gated on "judge at gameplay scale", and this sheet is where that judging can finally
happen. It has not happened yet: no child has seen it, and nothing has been judged on the iPad.

`hero_contract.json` must not be edited to record any of this. The measurements live in
`docs/foundry/construction/hero_measured.json` as evidence; adopting any of them as a target is a
separate decision that is the owner's to make.

### NS-04 — the locked four-tier ladder

Proposed, not yet built or judged by the children:

| Tier | Silhouette change | Palette shift | What a child points at |
|---|---|---|---|
| 1 — Wayfarer | Existing narrow cloth; exposed hair; no shoulder projection | Cream dominant, slate-blue trim, warm leather | The blue collar |
| 2 — Ironwood Adventurer | Small rounded shoulder caps; round shield adds a large side disc | Cream reduced; wood, leather and slate blue stronger | **The blue-rimmed shield** — built and accepted 2026-08-12, with its sword |
| 3 — Silverguard | Open-faced helmet; broad squared shoulders; weapon extends farther | Muted steel dominant, deep slate blue secondary | The helmet — **helmet and shoulders built and accepted 2026-08-12**; the longer weapon is not built |
| 4 — Dawnwarden | High outward shoulders, calf-length split cloak, largest weapon; strong inverted triangle | Pale steel and slate blue dominant; gold 5–8% only | The big gold-edged sword |

Across-the-room read: **hair → shield → helmet → cloak and large sword.**

Tier 2's defining item is the shield already built and accepted on 2026-08-12, which is a
convenient accident rather than a plan.

Two rules that come with the ladder. Tier 4 must not be "Tier 3 with more engravings" — the
shoulders must be visibly higher and wider, the cloak must create a new rear outline, the weapon
must be unmistakably longer. And **keep the face open**: the boy's face and hair are the strongest
sources of identity, so a closed helmet early makes an upgrade feel more generic, not more
aspirational.

## Which slots are worth building

**The ranking basis below is out of date, and the correction makes it stricter.** It ranks by
silhouette change *per triangle spent*, but triangles are not what this hero is short of. Measured
on 2026-08-12, Tier 3 equipped costs 8,125 triangles against a 10,000 hard cap — comfortable — and
**6 draw calls against a budget of 4**, which is a breach. Every geometry slot costs one draw call
whether it is 183 triangles or 3,000, because three.js issues one draw per visible primitive and
does not batch across meshes even when they share a material. So the real currency is *slots*, not
triangles, and adding the cloak at Tier 4 makes an existing breach worse rather than starting a new
one. See `the private engineering archive` §7 for the three ways out; the
recommendation is merging gear into one shared-atlas mesh at equip time, which would return the
whole character to 2 draws and make this ranking's original basis valid again.

Ranked by visible silhouette change per triangle spent, at 90 CSS px:

| Rank | Slot | Verdict |
|---|---|---|
| 1 | **Weapon** | Build one per tier. A large shape extending beyond the body, readable while moving. |
| 2 | **Helmet** | Build from Tier 3. Face stays open. |
| 3 | **Shoulders** | The primary armour-progression slot. |
| 4 | Cloak | One only, Tier 4. Strong from rear/side, weak from front, can overwhelm a small hero. |
| 5 | Boots | One base pair, at most one late heavier shape. |
| 6 | **Chest** | **Texture and value only — no separate geometry.** Large colour area, almost no silhouette change unless exaggerated into a barrel. |
| 7 | **Gloves** | **Do not build.** Three or four pixels, usually hidden by weapon and shield. |

The chest verdict is the one worth trusting most, because **it was reached twice independently**:
ChatGPT ruled it out on legibility grounds, and Luna's dossier ruled it out on cost grounds — a
chestplate on a deforming torso is the expensive Class B/C case needing canonical-body fitting,
weight transfer and stress-pose validation. Two unrelated arguments, same answer.

## What the first rejection taught, and it was not an art problem

The Tier 3 helmet was generated, mounted on the hero and rejected on 2026-08-12. It is the first
NS-06 entry that is a rejection, and it is worth more than the two acceptances because the failure
was in the *brief*, not the artwork.

**Flat objects survive a single reference view. Volumes do not.** The shield and the sword passed
first time. They are essentially planar, and one orthographic front view fully determines them. The
helmet and the shoulder cap are volumes; one view underdetermines them, and both came back as
shapeless lumps — the first shoulder read as a stone, not armour. For a volume the brief must state
the form explicitly: proportion as a width-to-height ratio, **where the widest point sits**, and
what the silhouette does at each end. That is now the standing rule for every remaining piece.

**Size gear against the body's profile, never against a bounding box.** The head's bounding box is
0.4489 wide, so a 0.49-wide helmet looks like it clears it by 9%. It does not. The head is 0.444
wide at *ear level* (z 1.259) and 0.159 near the crown (z 1.473), while the generated helmet was
widest at its *bottom rim*. Sized by boxes the two numbers look compatible; on the character the
helmet's widest ring sat where the head is 0.345 wide and it read as a mushroom cap.
`tools/blender/slice_profile.py` measures width at the height a piece actually sits.

**The constraints we write become the defects we get.** The brief told the generator that any
scanline crossing the helmet more than once would be rejected. It complied, and said so: it used
"a near-flat open lower edge so every intersecting scanline" would pass. That is a helmet with no
face opening. A beanie scored a perfect 1 run per row; the correct open-faced helm scored 26.8%.
**When an asset comes back subtly wrong, re-read the constraint before blaming the generator.**

**Muted steel means mid-grey, and it has to be asked for — but the generator is the culprit.**
Three of the first four assets came back near-white: the sword blade, the first helmet, the first
shoulder. It would be easy to blame the concept art, and that was wrong. Measured on the corrected
helmet, the reference steel has a median value of **109** and the mesh generator returned **154** —
Meshy brightens albedo by roughly 45 levels, systematically. So the correction belongs on our side:
**ask for steel darker than you actually want it.** The test that decides the matter is the one this
document already states — contrast against the cream tunic at play size — and the shipped helmet
passes it, reading luma 146 against the tunic's 187.

### Tier 3 as built, and the arithmetic that constrained it

Accepted 2026-08-12 by the visual judge: *"In one second, a young player will read this as a
different and stronger tier. He points first to the large blue-framed steel helmet, then to the wide
square shoulders."* That is the one-second test this document demands, though it remains **the
judge's answer and not a child's** — no child has seen it, which is still the outstanding waiver.

| Piece | Bone | World size | Triangles |
|---|---|---:|---:|
| Helmet | `Head` | 0.50 wide, squashed to 0.857 in height | 330 |
| Shoulder ×2 | `LeftArm` / `RightArm` | 0.21 wide, 0.14 of hero height | 183 each |
| Sword | `RightHand` | 0.60 long — **0.400 of his height**, against Ironwood's 0.313 | 318 |
| Shield | `LeftHand` | unchanged Ironwood; the ladder asks for no new shield at Tier 3 | 311 |

**Budget, stated rather than absorbed:** the equipped Tier 3 character is **8,125 triangles**
against an LOD1 *target* of 8,000 and a *hard cap* of 10,000. The pieces are correctly sized —
the judge said explicitly not to shrink the shoulders — so this is reported as a 125-triangle
miss rather than closed by quietly decimating gear. Summed as separate GLBs the payload is
1,046,916 bytes against a 1,048,576 cap, i.e. **1,660 bytes of headroom**, which is not real
headroom. Tier 4 must go through the atlas merge, where the pieces share one texture instead of
each carrying their own.

The helmet **did not fit at its natural proportions** and this is the number Tier 4 should inherit:
with a face opening at 47% of the piece's height, the brow lands at z 1.360 — above his eyes at
1.330 — and the crown at 1.540, just over his head at 1.500. Getting there needed a 14% squash in
height. Any future helm should be drawn shorter rather than squashed after the fact.

The right shoulder is **the same mesh mirrored by a negative X scale**, not a second generation.
That made the pair symmetric by construction and saved 15 credits. It is only safe because the
material is `doubleSided` — a negative scale inverts winding order — which was checked in the GLB
rather than assumed.

**The Ironwood shield stays through Tier 3, and that was checked rather than assumed.** Three steel
pieces beside a wooden shield looked like a risk. The judge's answer: it does not read as a leftover,
because the shield's slate-blue rim ties directly to the helmet brow, the shoulders and the sword
fittings, and the warm wood is what stops Silverguard becoming a monochrome steel suit. Keep it.

### Tier 4 Dawnwarden — direction on the record, before anything is drawn

From the judge, after seeing what actually survived at 90px:

- **Build the shoulders first.** Cheapest major silhouette upgrade that does not hide the face.
- **One cap: width 1.0 to height 0.72–0.78, with the widest point at the raised OUTER CORNER in the
  upper third — not at the bottom.** Stronger outward flare, and a clean arm-contact edge.
- **Do not enlarge the Tier 3 shoulders to get there.** They are correctly sized; Tier 4 needs the
  growth room.
- **Future helmets start from the corrected 1.0 : 0.69 aspect**, a 47–50% face opening, and maximum
  width around mid-height.
- **Draw steel at median value 105–110** to land near 150 in the mesh, and keep even the lightest
  plane below ~125.
- Spend every visible change on the outer silhouette or one broad colour mass. Anything smaller
  disappears at 90px.

The generalisation Tier 3 earned, and the sentence to keep: **a reference for a volumetric piece must
depict FITTED proportions, not attractive isolated proportions.** A helmet that looks handsome alone
is not a helmet that fits a head, and the difference costs 15 credits each time.

## The children have now seen it, and the ladder survived

**Run 2026-08-12 by the owner, both testers, one at a time.** Tiers 1–3 at a true 90 CSS pixels, one second
each, shuffled order, on the iPad. Instrument: `docs/foundry/test/tier_test.html`. This is the test
this document and `hero_contract.json` have both demanded since the proportion lock was written, and
it had never been run.

| | Strongest set | What was different about it |
|---|---|---|
| older players | **Tier 3 Silverguard** | **"The helmet"** |
| younger players | **Tier 3 Silverguard** | **"A shield, a sword, and a helmet"** |

**Both answered with SHAPE, neither with colour.** That is the pass condition stated below, and it
is the evidence that the silhouette investment is right rather than merely expensive.

Three things worth keeping:

1. **The ordering works.** Both children independently ranked the newest set strongest, in a
   shuffled order, with no labels and no prompting.
2. **The helmet is confirmed as the tier marker**, exactly as predicted — the judge's words were
   "he points first to the large blue-framed steel helmet", and the young player said "the helmet".
3. **a young player resolved three separate items in one second at 90 pixels.** That is a stronger
   result than the test asked for, and it says the 2px detail floor below is not too conservative.

**The one negative, and it is weak evidence rather than proof: neither boy named the shoulders.**
They are the only built piece nobody mentioned. That is not the same as "invisible" — the question
asked what was *different*, so naming the loudest feature says nothing certain about the others, and
the chest paint may have absorbed the caps into one upper-body mass. But the shoulders are ranked
third in the slot table on informed opinion, and they are now the only slot with **no** child-derived
evidence of value. Do not spend more on them at Tier 4 until something says they earn it.

**Instrument limitation, recorded so the next run is better:** the test forced a single tap for
"what was different", and the young player's honest answer was three things. It under-captured.
Make that question multi-select before running it for Tier 4.

### What this closes, and what it does not

`hero_contract.json` records as its most significant waived condition that "no child has seen the
locked master, and nothing has been judged on the real iPad". **The second half is now closed** —
gear has been judged by both children at play size on the actual device. The first half is not: what
they saw was three tiers of gear, not the locked proportion master, and nothing here licenses
changing a locked proportion. That remains the owner's decision and needs its own evidence.

## Detail floor

- A progression cue must either **change the silhouette** or occupy **at least 4–6 screen pixels**
  at 90px play size.
- Any surface detail that cannot stay **at least 2 screen pixels wide** in the real render should be
  removed. No stitching, rivet rows, engraved borders, small crests, chainmail or thin gold piping.
- A major armour piece gets one base colour, two or three broad value planes, and at most one large
  accent shape. A minor piece gets a base colour and maybe one darker edge.
- Reserve the strongest light/dark contrast for the face, the weapon edge, and the one
  tier-defining feature. Do not spread contrast evenly.

## Atlas allocation

Proposed division of the single 1024² atlas, which by contract carries the whole character
*including all gear*:

| Region | Area |
|---|---:|
| Face, ears, neck, visible skin | 22% |
| Hair and eyebrows | 10% |
| Base tunic, trousers, wraps | 18% |
| Helmet, shoulders, chest armour | 20% |
| Weapon and shield | 10% |
| Cloak | 8% |
| Boots, gloves, belt | 7% |
| Island padding and contingency | 5% |

This deliberately breaks uniform texel density in favour of the face, which is inspected repeatedly
and carries identity, over a glove that occupies three screen pixels.

**Assumption that must be checked before anyone relies on this:** it assumes the atlas holds *one
equipped appearance at a time*, not unique painted regions for all four tiers at once. If all four
tiers must coexist, the allocation above is wrong and the armour needs far more colour-patch reuse.

**What actually ships does not match this, measured 2026-08-12.** The allocation above describes one
atlas carrying the whole character including gear. The shipped Tier 3 state is **five** atlases —
hero 1024², helmet 512², shoulder 512², sword 512², shield 1024² — because each gear GLB was
generated with its own texture and never merged. That breaches `uniqueFullBodyTextures: 1`, and it is
also why the gear cannot batch into fewer draw calls: separate materials never merge.
`tools/blender/merge_gear_atlas.py` already performs this merge and is how the Tier 2 arrangement
reached one material. The allocation table above is therefore a target that the pipeline is capable
of hitting and currently does not.

The honest framing: at this viewing size the atlas is **not the limiting factor**. Perceptual
bandwidth is. Only a handful of large colour relationships survive minification, and more painted
detail mostly becomes noise.

## Using this when generating

Label every supplied reference by role, e.g. "Image 1 controls identity and palette only. Image 2
controls dimensions and silhouette. Do not infer geometry from Image 1."

Review every generated asset against:

1. Is it unmistakably the intended object at target size?
2. Does its silhouette add information?
3. Does it preserve the approved large colour masses?
4. Does it introduce detail that disappears at runtime?
5. Does it still belong beside the accepted hero and shield?
6. Can the children identify its tier in about a second, without being told?

**Only accepted outputs become future references.** Rejected explorations must never be fed back in
as prompt inputs — reference drift compounds fast.

## How this gets settled

The scheme is art-direction judgement, not measurement, and it says so. The ordering of helmet
versus shoulders, the atlas percentages, and the 2px / 4–6px thresholds are informed opinion about a
measured 90px hero — not established GalaQuest facts.

The decisive test is the one the spec already names and that has never been run: **show the children
all four tiers at actual size for one second, hide them, and ask which looked strongest and what
changed.** If they answer with the shield, helmet, cloak or sword — rather than "the colours were
different" — the ladder works. If they answer with colour, the silhouette investment is wrong and
this document needs rewriting before any tier is modelled.

That test is also the outstanding waiver on the proportion lock: `hero_contract.json` records "no
child has seen the locked master, and nothing has been judged on the real iPad" as the most
significant of three waived conditions. The same session with the children could close both.
