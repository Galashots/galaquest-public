# Reference images — where every asset starts, and where most failures are decided

The reference image decides the mesh. Meshy reconstructs what is PAINTED, faithfully including
your mistakes: painted seams become geometry channels, thin straps become breaks, backdrop
gradients become segmentation noise. Ten minutes here beats a 15-credit re-roll.

## Producing the image (ChatGPT, the owner's account, GalaQuest project)

Use ChatGPT image generation in the **GalaQuest project** (chatgpt.com, model GPT-5.6 Sol,
effort High — the owner's standing setting), so the project context carries the art direction. Anchor
EVERY request on an existing style image (upload it): the chest plate anchored the lantern, the
lantern anchored the tree, older players' source anchored the keeper. The composer submits on Enter —
write prompts as ONE line, no newlines.

The prompt must always say, in some phrasing:
- lone subject, centered, plain solid pale-grey backdrop, generous empty margins
- no cast shadow beyond a small contact patch, no text, no scene, no ground plane
- every engraving/panel line as a FLAT PAINTED VALUE CHANGE, never a dark groove
- one solid connected volume; no thin wires/chains/floating parts (thick straps, merged rings)
- the destination ("Meshy image-to-3D at ~N triangles, judged at 90 px in a browser game")

Plus the shape rules for the asset class: props state widest-point and taper explicitly;
characters are strict T-pose (see the character runbook); trees are cloud-mass canopies with no
see-through gaps.

## Vetting (mandatory, free)

```bash
python tools/meshy/flatten_bg.py tmp/<name>.png tmp/<name>-flat.png [--grey N]
```
Read every line it prints:
- **Margins + fill %**: subject comfortably inside frame.
- **Silhouette runs**: for PROPS, a split that rejoins is a hole and Meshy will build it —
  fix the image. For CHARACTERS, TREES, and anything multi-limbed, splits that rejoin are
  anatomy — the tool over-fires there by design (calibration recorded 2026-08-13); judge by eye.
- **Collision note**: if subject pixels sit near the backdrop value, re-run with the suggested
  `--grey N` so segmentation cannot eat the subject. Always use the suggested value; it costs
  nothing.

## Retrieving images from ChatGPT (browser automation)

The generated `<img>` src is fetchable in-page: fetch → blob → object-URL → `<a download>` click
lands it in `Downloads/`, then copy into `tmp/`. Verify you are driving the LOCAL Chrome before
downloading anything (two Chromes are paired to this account; the local one is the one whose
tabs you already hold — check `tabs_context` for your own known tab ids).

## When visual confirmation is needed

Image-search comparable games (the hero is Toon-Link-class; search that class) and put the
reference next to the capture BEFORE adjusting anything. For approval calls while the owner is busy,
ask Sol in the GalaQuest project with the actual captures/renders attached — the owner delegated
tactical visual approval to Sol on 2026-08-13 ("easier to correct things done later than stall");
record Sol's ruling in the relevant doc, and the owner corrects later if needed.
