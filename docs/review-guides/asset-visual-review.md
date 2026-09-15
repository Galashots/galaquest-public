# Mandatory asset visual self-review

This guide applies to new or materially changed **player-visible work**, including assets, HUD/UI, scene/camera presentation and feedback, before handoff for independent review or proposed promotion. Neutral asset inspection is required for asset work; HUD/UI and scene work use the relevant running-game framing and interaction instead of an irrelevant asset checklist.

The producer's self-review is mandatory. It is **necessary but never sufficient** for independent acceptance or Owner-controlled promotion. `.agents/skills/visual-reference-first/SKILL.md` owns the build/look/fix execution loop; this guide owns the comparison hierarchy, review evidence, and acceptance handoff.

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

1. accepted running-game evidence and canonical public GalaQuest references;
2. current GalaQuest product/visual authority and Owner-approved references for the question being judged;
3. attributable external comparison references **only when** internal authority does not settle the convention or quality bar;
4. a generated target reference only when the intended result remains materially verbal/ambiguous.

### External comparison references

When external comparison is actually needed, use multiple independent, recognizable, attributable sources rather than one screenshot or franchise. Prefer:

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

## Reproduction identity

Reproduce the **original reported condition** as closely as practical before diagnosing and correcting it. Not seeing the defect in another renderer, scene, camera or pose does not prove it fixed. If the original condition cannot be reproduced, the correction claim remains UNKNOWN; a different setup is supporting diagnosis, not a substitute PASS.

At the corrected exact SHA, recreate the same useful camera/framing, gameplay state, pose/frame, lighting and viewport/device conditions, then rerun the same useful measurement/comparison before human visual judgment. Preserve client/server and source/derivative hashes when needed to prove identity. State unavoidable differences rather than presenting an uncontrolled pair as causal proof.

For Unity-bound work, use Unity and the relevant running-game condition; an isolated render can diagnose but cannot override that evidence. Reuse a capture for multiple claims only when it actually exposes each risk; a hidden underside, motion defect or different device may need distinct evidence.

## Independent review hygiene

For consequential player-visible acceptance, give the fresh reviewer the actual pixels, the governing target/authority, and enough gameplay context to understand what the player is seeing. Do **not** prime the reviewer's first judgment with what the producer changed, the defect it hoped to fix, or the verdict it wants. Record that context after the reviewer has formed the initial assessment when it is useful for diagnosis.

Measurements and automated checks may diagnose or reject a visual result. They do not artistically accept appearance; that requires appropriate human judgment of the running game.

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

## Capability gaps and handoff

An inaccessible **required** destination/render, original reproduction or visual artifact makes that claim UNKNOWN. Continue only work that does not depend on the missing judgment and route the missing check before consequential acceptance. Unavailable web/image search is a blocker only when external evidence is actually needed under the reference hierarchy; do not invent a research gate when canonical GalaQuest evidence settles the question.

Use the evidence package above once. Identify whether the record is producer self-review, fresh independent critique or Owner acceptance, and name any unresolved gate; do not duplicate it into another checklist.
