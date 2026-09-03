---
name: visual-reference-first
description: Use when deciding or reviewing how anything in GalaQuest should look, sit, hang, be held, be posed, or be presented on screen — including new assets, gear attachment, armour placement, character/creature pose and motion, environment massing, UI/feedback framing — and before handoff of any materially changed player-visible asset.
---

# Look before you derive — and look again before you hand off

**If you are about to decide how something LOOKS, look at references first. If you just produced something visual, look at the actual result again before handoff.**

Presentation in games is **convention**, not physics. Conventions are observed. They cannot be derived from geometry, symmetry, anatomy or first principles, and an attempt to derive one produces a self-consistent wrong answer that no test will ever complain about.

The second failure mode is just as dangerous: an agent finishes an asset, proves that the files/import/tests are valid, and hands it off without critically inspecting whether it actually looks good. GalaQuest forbids that. Producer self-review is mandatory and is not the same thing as independent acceptance.

## When to use

Any question of the form "how should X look / sit / hang / be held / be posed / read on screen", plus any handoff of a new or materially changed player-visible asset:

- Gear attachment: weapons, shields, quivers, packs, lanterns, tools
- Armour placement: pauldrons, bracers, belts, capes
- Poses: idle, run, attack wind-up, hit reaction, death, victory
- Creatures: stance, head carriage, silhouette, how a bite or pounce reads
- Assets: characters, enemies, pets, gear, props, environment pieces, VFX-bearing content
- World and UI: how a zone is massed, how damage registers, what a pickup looks like

Not for: file-format questions, budgets, topology, or anything with a purely measurable right answer **unless the measurable work feeds a player-visible asset that is now being handed off**.

## Where to look

Start with current public GalaQuest visual authority and accepted runtime. Read `docs/GALAQUEST_VISUAL_AUTHORITY.md` and `docs/review-guides/asset-visual-review.md`.

When external examples are needed, search several comparable third-person games or real-world references rather than copying one screenshot. Prefer attributable sources such as official publisher/studio screenshots, credited production portfolios, or real-world photography. World of Warcraft, Zelda, RuneScape, Fortnite, Genshin and other stylised third-person games can provide independent convention checks when relevant, but no outside game defines GalaQuest's art direction.

**GalaQuest's own accepted public direction outranks external examples.** Do not invent a missing concept-art prerequisite or go hunting through a private archive by default.

Search in plain player words:

```text
wow character holding a shield
stylized adventure game sword idle pose
third person game bow on back
stylized lava armor game character
child friendly fantasy enemy silhouette
```

When web/image-search capability exists, use **at least three useful attributable examples** before declaring a new visual asset ready. Image search is discovery, not authority. Do not use anonymous reposts, Pinterest boards, or uncredited AI imagery as the sole benchmark.

## Generated target reference

If the visual goal exists mainly as a verbal brief and no current GalaQuest image settles it, the Production Director may generate a **non-canonical target image** from the approved description before expensive production/rework.

Use that image narrowly. Record what it controls, such as:

- silhouette;
- proportions;
- palette/material value;
- environment massing;
- gameplay readability.

Label it `generated target reference — non-canonical`. It does not become canon by default and cannot overrule accepted runtime evidence or Owner-supplied art direction.

## The procedure

### Before making/tuning the visual

1. **Name it as a player would.** "Character holding a shield", not "left-hand rigid attachment orientation". The plain phrasing is what finds images; the technical phrasing often finds nothing.
2. **Read GalaQuest authority first.** Identify which accepted runtime/reference actually controls identity, construction, progression, material, or world tone.
3. **Look at three or more external examples** when search capability exists, from different angles/sources where possible.
4. **Write the convention down in one sentence** before touching any numbers or expensive production.
5. **If the target is still ambiguous**, use/request a Director-generated non-canonical target reference rather than silently guessing.

### After making/tuning the visual

6. **Open the actual output yourself.** Do not hand off from logs, metrics, thumbnails, or provider preview alone.
7. **For Unity-bound assets, inspect in Unity.** Use a neutral diagnostic view and intended gameplay framing. For motion/VFX/cloth/deformation, inspect Play Mode motion.
8. **Compare side by side against the chosen references.** Check silhouette, proportion/fit, pose/motion, material/value, colour hierarchy, gameplay readability, cohesion with GalaQuest, originality, and visible artifacts.
9. **State the strongest reason the result may still be wrong.** Name the mismatch or disconfirming reference. "Looks good" is not enough.
10. **Fix/reject/reforecast material defects before handoff.** Do not outsource obvious producer defects to the independent reviewer.
11. **Bind evidence to the exact SHA/state.** Capture useful stills; use `.local/unity/review-pack/` for Unity review evidence. Put phone-readable stills on the PR/review surface when practical. Large recordings/raw masters may use the Owner-controlled Google Drive custody/review tier, linked from an exact-SHA manifest.
12. **Verify in the running game for final appearance acceptance.** Unity proof/inspection scenes qualify assets but do not overrule running-game pixels.
13. **Comment the observed convention next to durable transform/presentation values** where useful, so the next agent inherits reasoning rather than magic numbers.

If Unity, web/image search, or visual evidence is inaccessible, report that gate **UNKNOWN** and route it to a capable runtime/reviewer. Lack of capability is not permission to claim readiness.

## Red flags — you are deriving or self-approving when you should be looking

| Thought | Reality |
|---|---|
| "It should be perpendicular to the forearm" | You are inventing a convention. Go and look at one. |
| "Mirror the other hand's axis" | Symmetry is not a carry convention. Look. |
| "The natural axis of the disc is…" | Objects do not have natural axes. Cultures have conventions. |
| "I've adjusted this three times and it still looks off" | You are missing the convention entirely. Stop and look. |
| "Which did the owner mean by 'tip'?" | The image answers it faster than the clarifying question. |
| "I can't name three games/references that ship this" | Then you do not know what it should look like yet. |
| "Meshy/Blender looks fine" | For Unity-bound work, you have not yet reviewed the actual destination render. |
| "The importer/tests pass" | Mechanical validity is not visual quality. Open it. |
| "Looks good" | Name the strongest flaw/counterexample or you have not reviewed critically. |
| "The reviewer can tell me if it's bad" | Producer self-review comes first; independent review is a separate seam. |

## What it cost to learn

On 2026-08-12 the shield was fitted to the hero's **hand**. The work was careful: hand-bone axes
measured on the live rig, the blade axis mirrored across the sagittal plane, orthonormal bases
constructed, a degenerate basis diagnosed and fixed, quaternions carried to twelve places, and the
bind-pose bake verified to 0.00002 rig units against the known-good sword.

The geometry was correct throughout. The answer was wrong: **a shield is strapped to the outside of
the forearm, not gripped in the fist.** A handful of reference screenshots settled in seconds what an
hour of basis vectors could not.

Three internally consistent wrong fits went past review first. Each satisfied every constraint that
had been stated in words. That is the failure mode: nothing in the maths ever complains.

The fit that finally worked is in `public/src/character/gear.js`, solved with
`tools/runtime-test/fit-shield.mjs`.
