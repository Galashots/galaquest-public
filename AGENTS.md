# GalaQuest public agent authority

Keep these hard boundaries. Before choosing an implementation or review surface, use the task router in `docs/GUIDANCE.md`; load only the relevant domain guidance and mechanical proof. `docs/WORKFLOW.md` owns package framing and production continuation.

## Repository topology

- **PUBLIC — `Galashots/galaquest-public`** is the primary active development authority. Normal gameplay, code, tests, CI, browser/playtesting work, public assets, and new development belong here.
- **PRIVATE** is archive/provenance authority, private production evidence, provider/account history, and a source for bounded safe ports. It is not the default development repository and its private files are not public startup prerequisites.
- **LOCAL** clones and worktrees are execution surfaces only. A local checkout is not a separate project authority. Bind review and acceptance evidence to the exact public commit SHA being tested.

## Startup: orient, do not hunt

Work only from the known current checkout. Confirm the public repository and exact head before relying
on branch, PR, CI, deployment, or prior-chat state; `docs/WORKFLOW.md` owns the orientation sequence.

If the current directory is not a Git checkout, **do not recursively search the machine** for repositories, old worktrees, Downloads, Desktop folders, or historical clones. Use a known path supplied by the owner, or use live GitHub authority until the intended checkout is known.

## Branch, PR, and evidence policy

- Work from public `main` on a task branch and through a pull request. **Do not push directly to `main`.**
- Do not force-push, rewrite shared history, squash/amend shared commits, merge, or close PRs unless the
  Owner explicitly authorizes that action.
- Keep one coherent objective per branch/PR; `docs/WORKFLOW.md` owns package sizing, checkpoints,
  scope reforecast, writer topology, context health, and handoff detail.
- Every material test, browser observation, review conclusion, and acceptance claim names the **exact
  public SHA** it proves.
- Run relevant tests from the actual checkout; do not trust stale counts or weaken behavior to make CI pass.

## Guidance is part of the product

- Active guidance must be executable from public authority, not private files, remembered chats, machine state, or historical provider authorization. Repair task-relevant guidance in the same PR when practical.
- Keep `test/guidance-integrity.test.mjs` effective; repair stale guidance rather than weakening its objective checks. `docs/GUIDANCE.md` owns deliberate exceptions.

## Product authority

- `docs/product/PRODUCT_VISION.md` records settled Owner direction; agent suggestions and isolated observations do not become decisions by repetition.
- `docs/product/PRODUCT_SYSTEM.md` governs live Issues and decision provenance. Search existing records before claiming work is new, selected, rejected, or prioritized; Project views and chats are not independent authority.
- Follow applicable design contracts through the task router. Preserve new product signals in the owning record without silently expanding a writer's package or manufacturing a new Owner gate for already-settled direction.

## Visual and product acceptance

- **Running-game pixels are final appearance authority; human visual judgment accepts.** Measurements, isolated renders, and automated checks can diagnose or reject, not replace that judgment.
- **The producer must visually self-review every new or materially changed player-visible asset before handoff.** For Unity-bound assets, that review includes the actual Unity import at gameplay framing and motion when relevant. `docs/review-guides/asset-visual-review.md` owns the evidence/acceptance contract; `.agents/skills/visual-reference-first/SKILL.md` owns the make-look-fix iteration loop.
- Producer self-review is **not independent acceptance**. Consequential player-visible work requires the fresh review seam defined by `docs/WORKFLOW.md`; asset promotion into shipped production remains Owner-controlled.
- If Google Drive is used for source custody or Owner review, use only the controlled lifecycle in `docs/pipeline/google-drive-asset-custody.md`. A Drive decision does not itself promote an asset; ratchet the decision into the GitHub/registry authority that owns that lifecycle.
- Do not silently change a hero or important character's rig, skeleton, fingers, body, topology, or anatomy to make gear or placement pass. If the defect is in the body/rig rather than the attachment, stop and report it.
- Asset promotion into shipped production remains Owner-controlled; qualification and evidence are not approval.
- No paid Meshy or other provider spend without explicit owner authorization for that **specific current work**. A budget, historical spend, old delegation, credit ceiling, or presence of a guarded `--go` tool is never authorization by itself.
- Read `ASSET-LICENSES.md` before adding, replacing, or reclassifying shipped assets. Do not call paid-plan Meshy gear CC0 unless the recorded licence actually says CC0.

## Private-source boundary

Private GalaQuest material may be inspected when a bounded public-safe port genuinely requires it, but it remains source/provenance rather than the active development authority.

Use this sequence:

`inspect the needed private source once -> define the exact public-safe surface -> implement/port in public -> test public -> bind acceptance to the resulting public SHA`

Do not bulk-copy private branches or preserve duplicate active implementations. Third-party or franchise-inspired private gear remains private unless its redistribution and project use are explicitly cleared.

If a routed public instruction names a missing path, repair or report the guidance defect; do not hunt for a private substitute.
