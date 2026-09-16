# The GalaQuest asset pipeline — operator runbooks

This directory is the public, executable operator layer for asset work. It is built from measured
production runs, but it is **not** a session transcript: historical costs and failures are evidence,
while current commands, acceptance rules, and authority boundaries are what an operator should act on.

## Pick the narrow lane

| You are making | Runbook | Spend shape |
| --- | --- | --- |
| A Meshy prop or scenery asset | [props.md](props.md) | paid image-to-3D after dry-run + explicit authorization |
| A humanoid character/NPC | [characters-npcs.md](characters-npcs.md) | body + rig + motions, each separately authorized |
| Wearable/held gear | [gear.md](gear.md) | prop pipeline + measured runtime fit |
| Background village/world dressing | [cc0-background.md](cc0-background.md) | zero-credit licensed-source lane |
| A reference image | [references.md](references.md) | prepare/vet before any paid generation |

Historical credit totals in these runbooks are planning evidence only. Provider pricing can change, and
**no number in this directory authorizes spend**.

## Asset candidate flow

Start from a selected player/product need, then use the canonical asset registry/inventory to find candidates that serve it. Inventory is evidence and supply; it does not choose product direction.

`selected need -> canonical asset registry/inventory -> candidate -> QUALIFY / REPAIR / INTEGRATE / PARK-or-REJECT`

Prefer an existing qualified or realistically qualifiable asset when it serves the selected need. Do not integrate an asset merely because it is available, old, expensive, or waiting in custody.

Use the [qualification entrypoint](../asset-production/ASSET_REGISTRY_V1.md#qualification-entrypoint-and-receipt)
to join a declared identity/class, exact source/candidate bytes and existing diagnostics before the
specialist lane. Its receipt names outstanding work; it neither accepts art nor promotes inventory.

## Iron rules — every lane

1. **Credentials stay local.** Guarded Meshy clients read `.local/meshy/api-key.txt` from the current
   public checkout. Never print, log, commit, screenshot, or place credentials in a URL. Never create
   or rotate account credentials on the owner's behalf.

2. **Paid generation requires explicit authorization for the specific current work.** Use the public
   guarded clients under `tools/meshy/`; their dry-run mode is the default and is the right first step.
   A budget, old delegation, balance, task estimate, or `--go` flag is a stop/transport mechanism, not
   permission.

3. **Reference first.** Before changing how an asset looks, hangs, is held, is posed, or is framed, follow
   `.agents/skills/visual-reference-first/SKILL.md`. GalaQuest's accepted runtime/public authority comes
   first; use external convention/quality references only where that authority does not settle the question.

4. **Raw provider output never ships.** Recompress/qualify the actual GLB the game will load and run the
   applicable budget/material/clip checks. Provider viewers and DCC imports are not shipping truth.

5. **Running-game pixels are final appearance authority.** A render or isolated asset inspection can
   reject a bad file; it cannot visually accept the game. Integrate, capture, and inspect the running
   experience at gameplay framing and, where useful, inspection scale.

6. **Keep source/scratch and shipping custody distinct.** Multi-megabyte inputs and generation evidence
   belong under gitignored scratch such as `tmp/` or `.local/`. Accepted runtime assets belong under the
   existing `public/assets/` family their consumer uses. Do not mix generated assets with unrelated
   gameplay changes merely because they were produced in the same session.

7. **Measure GLBs as GLBs.** Importers may synthesize helpers, bone tails, or material state. Use the
   repository's GLB readers/budget tools for file facts, and use Blender only for the DCC-layer questions
   it actually answers.

8. **Player-visible asset edits use the shared visual loop and review contract.** Follow
   `.agents/skills/visual-reference-first/SKILL.md` while making/fixing the result, then
   `docs/review-guides/asset-visual-review.md` for handoff evidence and acceptance.

9. **Humanoid anatomy, rig, and clip qualification stay in the character lane.** Use
   [characters-npcs.md](characters-npcs.md) and `.agents/skills/galaquest-character-foundry/SKILL.md`;
   measurements such as `pose_anatomy.mjs` diagnose the candidate rather than replacing visual judgment.

10. **New lessons become durable once, in the right layer.** A reusable failure mode goes in
    `docs/MISTAKES.md`; the stable prevention rule goes into the runbook contributors will read next
    time; an objective repeat failure gets the smallest useful test ratchet. Do not copy the same warning
    into five documents.

## Character anatomy and visual-review ownership

Humanoid anatomy, rest-skeleton compatibility, rigging, and clip qualification belong in [characters-npcs.md](characters-npcs.md) and `.agents/skills/galaquest-character-foundry/SKILL.md`; keep those character-specific checks out of this lane router.

Visual production iteration belongs in `.agents/skills/visual-reference-first/SKILL.md`, while `docs/review-guides/asset-visual-review.md` owns the review evidence and acceptance handoff. Do not duplicate either procedure here.

## Paid-task ledger discipline

For every authorized paid task, retain enough evidence to answer what was spent and on what:

- task id and operation;
- exact input/brief identity;
- balance before/after when the client reports it;
- provider `consumed_credits` when available;
- accepted/rejected outcome and why.

Keep the ledger with the task/PR evidence, not as a permanent blanket authorization in this README.

## Maintaining this Markdown system

`docs/GUIDANCE.md` defines continual guidance linting. When a public tool/path changes, update the
runbook in the same PR. New Markdown under this directory is automatically included in
`test/guidance-integrity.test.mjs`, so a dead relative link or dead repo-local command should fail the
required unit suite instead of surviving until the next operator tries it.
