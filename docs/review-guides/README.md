# GalaQuest owner review guides

This directory contains durable review procedures and Owner-authored review packets.

For any new or materially changed player-visible asset, the producing agent must first follow [`asset-visual-review.md`](asset-visual-review.md). Producer self-review is mandatory before handoff and includes critical reference comparison plus Unity inspection for Unity-bound assets. Self-review does not replace independent acceptance or Owner-controlled promotion.

Character Studio Review Mode turns the owner's visual comments into reproducible, repo-linked guidance without an OpenAI API integration.

## Zero-extra-cost workflow

1. Open Character Studio and choose the loadout, animation time, camera scale/bearing, lighting, and overlay that matter.
2. Open **review / annotate**. Review Mode pauses the current animation frame so the visual target stays stable.
3. Choose `important view`, `fit rule`, `good / reference`, or `problem area`; draw a pen mark, circle, or arrow; and write the owner note.
4. Press **download annotated PNG**, then **export review packet**. The packet export may also copy a short handoff message.
5. Provide the PNG and `.gqreview.json` packet together to an authorized GalaQuest Production Director or
   review-ingestion session that can read the packet and repository, along with the intended review request.
6. The authorized receiver normalizes the packet into this directory: the manifest at the packet's
   `suggestedRepoPaths.manifest` and the decoded PNG at `suggestedRepoPaths.image`.

No OpenAI API key is used by Character Studio. The only network lookup Review Mode attempts is the public GitHub API to bind the packet to the exact commit behind the selected ref. A `?sourceSha=<40-hex-sha>` query parameter can bind the Studio explicitly and avoids that lookup.

## What a packet preserves

`galaquest-review-packet/1` records:

- repository, ref, exact SHA when available, and Studio URL;
- semantic review target and loadout provenance;
- animation clip and exact time;
- camera scale and bearing;
- viewport, lighting, overlay, and the rest of the Studio state;
- normalized vector annotations, so circles/arrows remain tied to the same view even at a different pixel density;
- the owner's review type, title, and note;
- an annotated PNG capture when the browser can capture the current WebGL frame.

The packet intentionally distinguishes **owner review guidance** from production promotion or final visual acceptance. A `good-reference` packet means “use this as owner guidance,” not “this asset is now shipped.” Running-game pixels and the normal GalaQuest promotion/acceptance gates still govern production state.

## Agent use

When an agent is asked to check an asset against a saved review guide, it should reproduce the packet's exact Studio state first, then inspect the saved annotation and note. Do not replace the recorded camera with an agent-preferred angle unless the task explicitly calls for an additional diagnostic view.

For fit rules, preserve the named owner intent rather than solving a visible mismatch by changing hero anatomy, the rig, skeleton, fingers, bind pose, or other protected character geometry.
