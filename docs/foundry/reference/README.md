# Comparison references — evidence, not authority

**Nothing in this folder is a north star.** These are outside references and honest looks at what we
actually shipped. They do not control palette, dimensions or geometry — NS-02 and NS-03 do. Do not
feed them into a generator as a style input.

## `tier3_illustration_of_shipped_model.png`

An illustration of **our actual shipped GLB**, drawn 2026-08-12 by ChatGPT from three Blender
renders of `hero.glb` plus the Tier 3 gear. The direction was deliberately restrictive: same boy,
same face, same clothes, same gear, redesign nothing.

Its value is as a mirror rather than as art. Asked where the model looked weakest — what it had to
flatter — the answer was specific and matches what the comparison below shows:

> "The model is weakest at the shoulder caps: they read as flat, floating slabs with little
> curvature or attachment to the body… the shipped helmet still looks somewhat oversized."

The sword needed no flattery, which is the one piece of good news: **the corrected palm anchoring
holds up.**

## `silhouette_comparison_vs_claudecraft.png`

Our Tier 3 hero beside three World of ClaudeCraft classes, every character scaled to the **same
height** so proportion is directly comparable. World of ClaudeCraft is the fairest comparison
available: a browser MMO, low-poly, stylised, built with Claude. `worldofclaudecraft.com`

What it shows, and none of it is flattering:

| | World of ClaudeCraft | GalaQuest Tier 3 |
|---|---|---|
| Proportion | ~2.5 heads — big head, stubby body | 3.86 heads |
| Armour coverage | Torso, belt, bracers, boots — mostly **painted, not modelled** | Cream tunic. Bare. |
| Shoulders | Rounded shells seated **on** the deltoid | Flat slabs floating beside the arm |
| Helmet | Crests, ridges, wings, cheek guards | A smooth faceted dome |
| Value range | Deep shadows, near-black accents | Pale throughout |

**The most useful single observation:** their characters read as armoured almost entirely through
*texture on the existing body mesh*, not through added geometry. Our own slot ranking reached the
same conclusion — chest is "texture and value only, no separate geometry" — and then we built the
geometry (helmet, shoulders) and **never did the texture half**. That is why the character reads as
a boy in a tunic wearing a hat, rather than as a boy in armour.

The A-pose in our render overstates the difference: theirs are posed idles, ours is the rest pose
the tracer renders on purpose. Judge silhouette from it, not attitude.
