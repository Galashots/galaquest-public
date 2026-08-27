# GalaQuest public agent authority

This file is intentionally short. It defines where work happens and the hard boundaries agents must not drift across. For detailed rules, follow the public guidance system in `docs/GUIDANCE.md` and read only the task-relevant authorities that actually exist in this repository.

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
- Behaviour fixes should have a red-capable reproduction/test before the fix when practical. Do not tune
  gameplay or prediction constants merely to make hosted CI pass.
- Run relevant tests from the actual checkout. Do not trust stale test counts copied into docs or chat.

## Guidance is part of the product

- `AGENTS.md` holds hard repository boundaries; `docs/WORKFLOW.md` holds the development/evidence lifecycle; domain runbooks and skills hold task-specific procedure; `docs/MISTAKES.md` is the historical lessons ledger.
- Active guidance must be executable from the public repository. Do not make a private file, remembered chat, machine-local path, old PR number, browser tab, or historical provider authorization a current prerequisite.
- When a tool, path, workflow, or evidence surface changes, update the guidance that points to it in the same PR when practical.
- `test/guidance-integrity.test.mjs` continuously checks objective guidance integrity inside the required unit suite. Do not weaken it to preserve stale prose; repair the guidance or make an intentional exception explicit in `docs/GUIDANCE.md`.

## Product authority

- `docs/product/PRODUCT_VISION.md` records settled Owner-level product direction. Do not promote an agent suggestion or isolated observation into it without an Owner decision.
- `docs/product/PROGRESSION_CONTRACT_V0.md` is the current shared design contract for the selected progression push. When working on Hero XP/levels, gear, POWER, enemy scaling/population, progression-linked learning, or pet contribution, read it after Product Vision and before fixing implementation package shape.
- `docs/product/PRODUCT_SYSTEM.md` defines how product ideas, signals, provenance, initiatives, lifecycle stages, and implementation links are captured.
- GitHub Issues governed by that system are the canonical live product-memory/backlog records. Search them before claiming an idea is new, selected, rejected, or currently prioritized.
- GitHub Projects may present those Issues visually, but Project-only fields are not independent authority. If the Project view drifts from an Issue, repair the view from the Issue.
- Product chats are temporary thinking surfaces. Ratchet durable ideas, meaningful signals, Owner decisions, and selected initiatives into the product system rather than requiring a future agent to recover an old conversation.
- A bounded implementation worker must not silently expand a PR because it discovers another good product idea. Capture/report the candidate separately under the authorization rules in `docs/product/PRODUCT_SYSTEM.md`.

## Visual and product acceptance

- **Running-game pixels are final appearance authority.** A render, GLB inspection, screenshot of an asset, or machine metric can reject a bad result; none of them can visually accept the running game.
- Player-visible changes require human inspection in the running game at gameplay framing and, where useful, inspection scale. Automated harnesses are necessary evidence for behaviour but do not substitute for human visual judgment.
- **Reference first.** Before deciding how something should look, sit, hang, pose, or be held, inspect real reference images. The owner's GalaQuest reference art outranks external examples. Record the visual convention before tuning numbers.
- Do not silently change a hero or important character's rig, skeleton, fingers, body, topology, or anatomy to make gear or placement pass. If the defect is in the body/rig rather than the attachment, stop and report it.
- Asset promotion into shipped production remains Owner-controlled; qualification and evidence are not approval.
- No paid Meshy or other provider spend without explicit owner authorization for that **specific current work**. A budget, historical spend, old delegation, credit ceiling, or presence of a guarded `--go` tool is never authorization by itself.
- Read `ASSET-LICENSES.md` before adding, replacing, or reclassifying shipped assets. Do not call paid-plan Meshy gear CC0 unless the recorded licence actually says CC0.

## Private-source boundary

Private GalaQuest material may be inspected when a bounded public-safe port genuinely requires it, but it remains source/provenance rather than the active development authority.

Use this sequence:

`inspect the needed private source once -> define the exact public-safe surface -> implement/port in public -> test public -> bind acceptance to the resulting public SHA`

Do not bulk-copy private branches or preserve duplicate active implementations. Third-party or franchise-inspired private gear remains private unless its redistribution and project use are explicitly cleared.

## Public authorities

Read these when relevant; do not invent missing private prerequisites:

- `docs/GUIDANCE.md` — guidance hierarchy, maintenance, and linting policy
- `docs/product/PRODUCT_VISION.md` — settled product direction
- `docs/product/PROGRESSION_CONTRACT_V0.md` — shared Hero/gear/POWER/enemy/learning progression design contract for the current push
- `docs/product/PRODUCT_SYSTEM.md` — product-memory, provenance, board, and issue lifecycle
- `docs/MISTAKES.md` — durable lessons ledger
- `docs/WORKFLOW.md` — public branch/PR and verification flow
- `docs/GALAQUEST_VISUAL_AUTHORITY.md` — visual direction and acceptance
- `docs/pipeline/` — public asset/character pipeline rules
- `docs/public-playtest.md` — hosted playtest and deployment provenance
- `docs/teardown/hero_contract.json` — character/gear numeric authority where applicable
- `ASSET-LICENSES.md` — shipped asset provenance and redistribution basis
- `.github/workflows/` — live hosted test definitions

If a public instruction references a path that does not exist, treat that as a guidance defect: repair or report it. Do not go looking for a private substitute by default.
