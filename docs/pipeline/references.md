# Reference images — where every generated asset starts

The reference image strongly shapes the mesh. Image-to-3D will reconstruct painted mistakes too:
painted seams can become geometry channels, thin straps can break, busy backgrounds can become
segmentation noise. Time spent making a clean reference is cheaper than paying to regenerate a bad one.

## Produce the reference by capability, not by UI ritual

Use an image-generation or art-authoring surface that can produce the required reference and lets you
compare it against GalaQuest's current public visual direction. Do not make a particular model name,
effort setting, browser tab, local Chrome instance, or download trick a project prerequisite.

When an accepted public GalaQuest reference exists for the relevant role, use it as an anchor. When it
does not, use `docs/GALAQUEST_VISUAL_AUTHORITY.md`, current running-game captures, and multiple external
convention references rather than inventing a missing private prerequisite.

The brief should state, in some phrasing:

- lone subject, centered, plain solid pale-grey background, generous empty margins;
- no cast shadow beyond a small contact patch, no text, no scene, no ground plane;
- engravings/panel lines as flat painted value changes, not dark grooves;
- one robust connected form where the asset class permits it; avoid thin wires/chains/floating parts;
- the destination: low-poly browser-game asset, judged at actual GalaQuest gameplay scale.

Add the shape rules for the asset class: props describe widest point and taper; humanoid characters use
a strict rig-friendly T-pose; trees use readable canopy masses rather than fine see-through detail.

## Vet the image before any paid generation

The public repository currently has **no dedicated background-flattening/vetting script**, so do not
cite one. Inspect the actual image before sending it to Meshy:

- subject comfortably inside frame with generous margins;
- background visually uniform and clearly separated from the subject;
- intended holes/openings are real and accidental gaps are absent;
- no hair-thin wires, straps, chains, or floating fragments that will reconstruct unreliably;
- broad value/color masses still read when the image is viewed small;
- volumetric pieces show the fitted proportions and silhouette the mesh must actually have.

If image preparation becomes repetitive enough to deserve automation, add and test a public tool first,
then update this runbook in the same PR. Do not document a command before it exists.

Store working references under `tmp/` or another gitignored scratch surface. How the image is transferred
from the authoring UI into that scratch area is execution-environment detail, not durable project guidance.

## Visual confirmation

Before adjusting a visible asset, search several comparable game references for the convention being
solved and compare them beside the current GalaQuest runtime/capture. GalaQuest's own accepted public
visual direction wins on identity, palette, silhouette and tone; external images are convention evidence.

A tactical reviewer may make a call when the owner has explicitly delegated that review for the current
work. Historical delegations recorded in old sessions are evidence, not standing approval authority.
