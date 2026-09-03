# Mandatory asset visual self-review

This guide applies to every new or materially changed **player-visible asset** before it is handed off for independent review, integrated as accepted content, or proposed for promotion. It covers characters, enemies, pets, gear, props, environment pieces, VFX-bearing assets, and other visuals whose quality matters to the player.

The producer's self-review is mandatory. It is **necessary but never sufficient** for independent acceptance or Owner-controlled promotion.

## Hard rule: do not hand off an asset you have not actually looked at

A provider preview, Blender viewport, file-validity check, triangle count, importer success, or green test can reject a broken asset, but none of them proves that the asset looks right for GalaQuest.

Before handoff, the agent that produced or modified the asset must personally inspect the result and record what it sees. The review must include a deliberate attempt to find reasons the asset is wrong, not only reasons it is acceptable.

For an asset intended for the Unity client, **Unity is a required review surface** once the asset can be imported there. Review at minimum:

- a neutral inspection view that exposes proportions, materials, deformation, and obvious artifacts; and
- an intended gameplay-framing view at approximately the scale/camera where a player will actually see it.

For animation, movement, cloth, VFX, or other time-dependent appearance, inspect motion in Play Mode and capture a short recording or multiple meaningful frames. A Meshy, Blender, DCC, or isolated render is not a substitute for the Unity review.

A deterministic Unity proof scene is acceptable for **asset qualification before gameplay integration**. It is not final running-game visual acceptance; `AGENTS.md` and `docs/GALAQUEST_VISUAL_AUTHORITY.md` still make running-game pixels the highest appearance authority.

## Build the comparison set before judging

Do not review from taste or memory alone. Use the narrowest visual authority that answers the question, in this order:

1. current accepted GalaQuest runtime/reference evidence;
2. Owner-supplied concept/reference art and recorded review guides;
3. relevant GalaQuest construction/material/progression authority;
4. external comparison references for the convention or quality bar being tested;
5. a generated target reference when the intended result exists mainly as a verbal description.

### External comparison references

When web/image-search capability is available, search for **at least three useful examples** before declaring a new asset visually ready. Prefer recognizable, attributable sources:

- official game/studio/publisher screenshots or media pages;
- credited developer or artist portfolio material tied to the shipped work;
- real-world reference photography when the question is physical construction, material, anatomy, clothing, tools, architecture, or motion.

Image search is a discovery tool, not authority by itself. Avoid using anonymous reposts, Pinterest collections, uncredited AI images, or one franchise screenshot as the sole benchmark. External games show conventions and quality bars; they do not define GalaQuest's art direction.

Do not copy third-party reference images into the repository or Google Drive merely to prove that they were reviewed. Preserve source links/query labels in the review note unless the image is Owner-supplied or otherwise cleared for project custody.

### Director-generated target reference

When the visual brief is materially ambiguous and no canonical GalaQuest target exists, the Production Director may generate a **non-canonical target image** from the approved description before expensive modelling or rework.

Label it explicitly as `generated target reference — non-canonical` and record which attributes it is meant to control, for example:

- silhouette only;
- palette/material treatment;
- proportions;
- gameplay readability;
- mood/environment massing.

A generated target does not become canon merely because it is attractive. It cannot overrule accepted runtime evidence, Owner art direction, construction authority, or a later running-game result.

## Review critically, not ceremonially

Compare the produced asset against the relevant reference set and answer the applicable questions:

- **Identity:** Is it unmistakably the intended thing, or merely technically valid?
- **Silhouette:** Does the outline read at play size and differ from nearby content in a useful way?
- **Proportion/fit:** Are body, gear, attachment, and object proportions believable at the actual use scale?
- **Pose/motion:** Does the stance or animation follow recognizable conventions and communicate the intended action?
- **Material/value:** Do metal, cloth, skin, wood, stone, glow, and other surfaces read correctly under Unity lighting rather than only in the source tool?
- **Colour hierarchy:** Does the important feature get the contrast, or is detail/noise stealing attention?
- **Gameplay readability:** Can the player identify the asset and important state at the expected camera distance/device size?
- **Cohesion:** Does it belong beside current accepted GalaQuest assets without looking imported from a different game?
- **Originality:** Is it safely inspired by broad genre convention rather than accidentally too close to a recognizable protected character or franchise design?
- **Technical artifacts:** Are there clipping, flipped normals, broken skinning, texture seams, floating pieces, bad pivots, animation pops, lighting defects, or helper geometry?

Every self-review must state the **strongest mismatch, weakness, or disconfirming reference** found. "Looks good" is not a review.

If the strongest mismatch is material, fix/reject/reforecast the asset before requesting independent acceptance. Do not make the reviewer rediscover an obvious defect the producer already saw.

## Evidence package

Bind the review to the exact state that was inspected. Record, as applicable:

- repository and exact Git SHA;
- semantic asset identity;
- source and derivative hashes/provenance where relevant;
- Unity version;
- Unity scene/review state and camera framing;
- inspection and gameplay-scale screenshots;
- animation/video evidence when motion matters;
- reference search terms and source links;
- any Owner/generated target reference and the attributes it controls;
- the producer's strongest criticism;
- unresolved items as **UNKNOWN** rather than implied PASS.

Prefer attaching the most useful still images directly to the PR/review surface so a phone reviewer can inspect them quickly.

For large raw/source assets and large recordings, use the Owner-controlled **Google Drive custody/review tier** when available rather than bloating Git. `docs/pipeline/google-drive-asset-custody.md` owns the one allowed active root, naming, stage routing, and anti-drift rules. Do not create a new GalaQuest asset root or arbitrary review folder.

When the Owner needs a visual decision, publish a self-contained, phone-readable packet under the canonical `30_OWNER_REVIEW/00_NEEDS_OWNER_REVIEW` queue using the runbook's packet naming and manifest convention. Include the strongest known defect/uncertainty rather than only flattering images. After the decision is ratcheted to the owning GitHub/asset authority, move the packet out of the active queue into `90_REVIEWED_ARCHIVE`.

Link Drive evidence from the PR or handoff and include an exact-SHA review manifest so the evidence cannot become detached from the state it proves. Google Drive is custody/transfer and a fast Owner review surface; it does not replace GitHub as repository authority or promote an asset by itself.

## Capability gaps are UNKNOWN, not exemptions

If an agent cannot access Unity, cannot perform web/image search, or cannot open the produced visual evidence, it must say so. It may continue mechanical work that does not depend on that judgment, but it may not claim visual readiness.

Route the missing visual step to a capable agent/runtime before consequential acceptance.

## Minimum handoff statement

A visual-asset handoff should make these facts easy to find:

- what exact asset/state was reviewed;
- which GalaQuest references controlled the result;
- what external comparisons were used;
- what Unity views/motion were actually inspected;
- the strongest defect or counterargument found;
- where the screenshots/video live;
- what remains UNKNOWN;
- whether this is producer self-review, independent review, or Owner acceptance.
