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

When current GalaQuest authority does not settle the convention or quality bar, use multiple independent, attributable external examples when that comparison is useful. Image search is discovery, not authority. Do not use anonymous reposts, Pinterest boards, or uncredited AI imagery as the sole benchmark.

## Generated target reference

If the visual goal exists mainly as a verbal brief and no current GalaQuest image settles it, the Production Director may generate a **non-canonical target image** from the approved description before expensive production/rework.

Use that image narrowly. Record what it controls, such as:

- silhouette;
- proportions;
- palette/material value;
- environment massing;
- gameplay readability.

Label it `generated target reference — non-canonical`. It does not become canon by default and cannot overrule accepted runtime evidence or Owner-supplied art direction.

## The loop: BUILD -> LOOK -> REPRODUCE -> FIX -> LOOK AGAIN

### BUILD

1. **Name the visual in player language.** "Character holding a shield" finds useful convention evidence; "left-hand rigid attachment orientation" usually does not.
2. **Read GalaQuest authority first.** Identify which accepted runtime/reference controls the question: identity, construction, progression, material, world tone, UI framing, or another explicit role.
3. **Use external reference only where internal authority does not settle the convention or quality bar.** When external comparison is useful, use multiple independent attributable examples rather than one screenshot or franchise.
4. **Write the intended convention in one sentence** before tuning numbers or spending on production.
5. **If the target remains materially ambiguous**, use/request a Director-generated non-canonical target reference instead of silently inventing a new style answer.

### LOOK

Open the actual output yourself. Do not hand off from logs, metrics, thumbnails, importer success, or provider preview. For Unity-bound work, inspect the actual Unity import at neutral inspection scale and intended gameplay framing; inspect motion when animation, VFX, cloth, deformation, or moving parts matter.

Compare against the controlling GalaQuest references and any supporting external evidence. State the strongest reason the result may still be wrong. "Looks good" is not critical review.

### REPRODUCE

Turn the strongest visible mismatch into an observable condition before changing it again. Reproduce the defect in the destination surface and, when before/after comparison matters, keep camera, gameplay state, pose/frame, lighting, and viewport/device conditions materially comparable.

Diagnose the actual cause rather than the easiest number to move. A floating or misaligned subject may come from geometry, root transform, animation pose, floor/contact data, projection/camera, shadowing, or attachment logic; do not hide an uncertain cause behind a blind offset.

### FIX

Make the smallest causal correction that stays inside the owned surface. A small, local, low-risk visual defect should normally be fixed instead of ticketed. Reforecast a materially cross-system/risky correction, and use governing product/visual authority for a genuine art/product choice rather than manufacturing an Owner gate.

### LOOK AGAIN

Recapture the corrected result under the comparable condition and inspect it again. Once integrated, running-game pixels are final appearance authority. Measurements and automated checks may diagnose or reject a result; they do not artistically accept appearance.

Bind useful evidence to the exact SHA/state and follow `docs/review-guides/asset-visual-review.md` for the acceptance/evidence package and fresh independent-review seam. If a required visual surface is inaccessible, report the gate **UNKNOWN** rather than claiming readiness.

## Red flags — derive less, look more

| Thought | Reality |
|---|---|
| "It should be perpendicular to the forearm" | You are inventing a convention. Look at accepted/runtime or external convention evidence. |
| "Mirror the other hand's axis" | Symmetry is not a carry convention. Look. |
| "I've adjusted this three times and it still looks off" | Stop tuning and reproduce the visible defect before moving another number. |
| "Meshy/Blender looks fine" | For Unity-bound work, you have not reviewed the destination render. |
| "The importer/tests pass" | Mechanical validity is not visual quality. Open the result. |
| "Looks good" | Name the strongest flaw or disconfirming evidence. |
| "The reviewer can tell me if it's bad" | Producer self-review comes first; independent review is a separate seam. |
