# U1 mobile movement milestone

## Package

**Objective:** make the connected Emberworks foundation comfortable and trustworthy to traverse on two iPads: responsive floating movement, Roblox-style orbit/zoom, animated locomotion, and visible geometry that agrees with the traversable route.

**Class L:** one traversal outcome spanning Unity input/camera/animation/presentation, the matching movement-world boundary where needed, and physical-device acceptance.

Owner approved the two-level release on 2026-09-07 and explicitly authorized this isolated follow-on branch from unmerged PR #141 at `a863f3017af441832df8dedf8db244720b07a579`. This is the approved exception to the normal main-base rule. PR #141's branch and locally modified authoring checkouts remain separate. Issue #46 owns the release; PR #142 records the approved release contract.

## Checkpoints

1. **Camera/input:** drag orbit, pinch zoom, camera-relative movement, independent touch ownership, bounded framing, and safe release/cancel/focus behaviour. Preserve server-authoritative movement and the existing movement speed/prediction law.
2. **Locomotion:** reproduce the reported static mid-run pose in a source-bound running build; correct the animation cause while retaining the canonical hero anatomy, rig, and attachment contracts. Escalate any actual body/rig defect under AGENTS.md.
3. **Traversal honesty:** reproduce walk-through blocks and blocked-looking-open routes; align presentation/collision for the active bounded route. The complete Emberworks level is a later release milestone.
4. **Combined acceptance:** fresh exact-head unit and relevant Unity tests, running-game producer review, two-client traversal/reconnect, and physical-iPad Owner inspection.

## Scope and dependencies

Includes the runtime camera/input seam, local movement presentation, relevant authoring automation and focused regression evidence. Combat, rewards, learning, pet production, and concurrent destinations stay in their approved later packages. Camera-touch ownership must leave space for those future controls without building them now.

Keep each checkpoint reviewable. Baseline failures may be classified and recorded; unrelated CI cleanup stays outside this package. Record discoveries on their existing owning product/engineering issue rather than creating another backlog.

## Acceptance counterexamples

- Rotating the camera must not silently change server coordinates or prediction constants; pushing up should move toward the top of the current view.
- The movement thumb must not become a pinch finger. A camera drag keeps its ownership when crossing the movement region.
- Adding/removing a pinch finger must not jump the camera or leave phantom rotation. Releasing, cancelling, or losing focus stops the corresponding gesture.
- Camera distance/pitch and obstruction handling must keep the hero and near threats readable.
- A walking/running hero must animate in the actual connected build. Editor preview motion alone is insufficient.
- Collision must be tested from running-game paths; source bounds or a static overhead render cannot accept traversal.

Primary touch convention sources: [Roblox mobile bindings](https://github.com/Roblox/creator-docs/blob/main/content/en-us/includes/default-bindings.md) and [camera behaviour](https://create.roblox.com/docs/workspace/camera). GalaQuest's hero/visual authorities still determine appearance.
