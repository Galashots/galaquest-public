---
name: visual-reference-first
description: Use when deciding how anything in GalaQuest should look, sit, hang, be held, be posed, or be presented on screen — gear attachment, weapon carry, armour placement, idle and combat poses, creature behaviour, UI and feedback framing — and before writing any orientation, offset, or transform value.
---

# Look before you derive

**If you are about to decide how something LOOKS, look at reference images first. Not after. Not
only when stuck. First, before any number is written.**

Presentation in games is **convention**, not physics. Conventions are observed. They cannot be
derived from geometry, symmetry, anatomy or first principles, and an attempt to derive one produces
a self-consistent wrong answer that no test will ever complain about.

## When to use

Any question of the form "how should X look / sit / hang / be held / be posed / read on screen":

- Gear attachment: weapons, shields, quivers, packs, lanterns, tools
- Armour placement: pauldrons, bracers, belts, capes
- Poses: idle, run, attack wind-up, hit reaction, death, victory
- Creatures: stance, head carriage, how a bite or pounce reads
- World and UI: how a zone is massed, how damage registers, what a pickup looks like

Not for: file-format questions, budgets, topology, or anything with a measurable right answer.

## Where to look

**World of Warcraft first, by default.** Not because GalaQuest should look like WoW — it is a
stylised kid-MMO and should not — but because WoW has twenty years of screenshots of every item on
every body type, and it solved third-person presentation decades ago. The image supply is
effectively unlimited, which is the whole point: the answer is always two minutes away.

Search in plain player words:

```
wow character holding a shield
wow warrior sword and board idle
wow bow on back
```

Secondary: Runescape, Zelda, Fortnite, Genshin. **the owner's own reference art outranks all of them**
when it exists — check `docs/foundry/identity/` and `docs/GALAQUEST_VISUAL_AUTHORITY.md` first.

## The procedure

1. **Name it as a player would.** "Character holding a shield", not "left-hand rigid attachment
   orientation". The plain phrasing is what finds images; the technical phrasing finds nothing.
2. **Look at three or more examples**, from different angles where possible.
3. **Write the convention down in one sentence** before touching any numbers.
4. **Build to that convention.**
5. **Verify in the running game**, never from a render — see "Playtests are mandatory" in
   `AGENTS.md`.
6. **Comment the convention next to the values**, so the next agent inherits the reasoning rather
   than a block of magic numbers.

## Red flags — you are deriving when you should be looking

| Thought | Reality |
|---|---|
| "It should be perpendicular to the forearm" | You are inventing a convention. Go and look at one. |
| "Mirror the other hand's axis" | Symmetry is not a carry convention. Look. |
| "The natural axis of the disc is…" | Objects do not have natural axes. Cultures have conventions. |
| "I've adjusted this three times and it still looks off" | You are missing the convention entirely. Stop and look. |
| "Which did the owner mean by 'tip'?" | The image answers it faster than the clarifying question. |
| "I can't name three games that ship this" | Then you do not know what it should look like yet. |

## What it cost to learn

On 2026-08-12 the shield was fitted to the hero's **hand**. The work was careful: hand-bone axes
measured on the live rig, the blade axis mirrored across the sagittal plane, orthonormal bases
constructed, a degenerate basis diagnosed and fixed, quaternions carried to twelve places, and the
bind-pose bake verified to 0.00002 rig units against the known-good sword.

The geometry was correct throughout. The answer was wrong: **a shield is strapped to the outside of
the forearm, not gripped in the fist.** Six World of Warcraft screenshots settled in seconds what an
hour of basis vectors could not.

Three internally consistent wrong fits went past review first. Each satisfied every constraint that
had been stated in words. That is the failure mode: nothing in the maths ever complains.

The fit that finally worked is in `public/src/character/gear.js`, solved with
`tools/runtime-test/fit-shield.mjs`.
