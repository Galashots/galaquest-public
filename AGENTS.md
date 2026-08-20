# GalaQuest public agent authority

This file is intentionally short. It defines where work happens and the hard boundaries agents must not drift across. For detailed rules, follow the public guidance system in `docs/GUIDANCE.md` and read only the task-relevant authorities that actually exist in this repository.

## Repository topology

- **PUBLIC — `Galashots/galaquest-public`** is the primary active development authority. Normal gameplay, code, tests, CI, browser/playtesting work, public assets, and new development belong here.
- **PRIVATE** is archive/provenance authority, private production evidence, provider/account history, and a source for bounded safe ports. It is not the default development repository and its private files are not public startup prerequisites.
- **LOCAL** clones and worktrees are execution surfaces only. A local checkout is not a separate project authority. Bind review and acceptance evidence to the exact public commit SHA being tested.

## Startup: orient, do not hunt

Start from the current checkout only:

```bash
git rev-parse --show-toplevel
git status -sb
git remote -v
git rev-parse HEAD
git worktree list
```

For normal development, confirm that the working repository is the public repository and record the exact HEAD SHA. Refresh live GitHub state before relying on remembered branch, PR, CI, deployment, or merge status.

If the current directory is not a Git checkout, **do not recursively search the machine** for repositories, old worktrees, Downloads, Desktop folders, or historical clones. Use a known path supplied by the owner, or use live GitHub authority until the intended checkout is known.

## Branch, PR, and evidence policy

- Normal agent work starts from current public `main` on a task branch and goes through a pull request.
- **Do not push directly to `main`.** Do not force-push, rewrite shared history, squash/amend shared commits, merge, or close PRs unless the owner explicitly authorizes that action.
- Keep one coherent product objective per branch/PR. Small tasks should stay small. An owner-authorized large PR may be reviewed at multiple exact-SHA checkpoints; `docs/WORKFLOW.md` defines that model.
- Every material test, browser observation, review conclusion, and acceptance claim names the **exact public SHA** it proves.
- Behaviour fixes should have a red-capable reproduction/test before the fix when practical. Do not tune gameplay or prediction constants merely to make hosted CI pass.
- Run the relevant tests from the actual checkout. Do not trust stale test counts copied into docs or chat.

## Guidance is part of the product

- `AGENTS.md` holds hard repository boundaries; `docs/WORKFLOW.md` holds the development/evidence lifecycle; domain runbooks and skills hold task-specific procedure; `docs/MISTAKES.md` is the historical lessons ledger.
- Active guidance must be executable from the public repository. Do not make a private file, remembered chat, machine-local path, old PR number, browser tab, or historical provider authorization a current prerequisite.
- When a tool, path, workflow, or evidence surface changes, update the guidance that points to it in the same PR when practical.
- `test/guidance-integrity.test.mjs` continuously checks objective guidance integrity inside the required unit suite. Do not weaken it to preserve stale prose; repair the guidance or make an intentional exception explicit in `docs/GUIDANCE.md`.

## Visual and product acceptance

- **Running-game pixels are final appearance authority.** A render, GLB inspection, screenshot of an asset, or machine metric can reject a bad result; none of them can visually accept the running game.
- Player-visible changes require human inspection in the running game at gameplay framing and, where useful, inspection scale. Automated harnesses are necessary evidence for behaviour but do not substitute for human visual judgment.
- **Reference first.** Before deciding how something should look, sit, hang, pose, or be held, inspect real reference images. The owner's GalaQuest reference art outranks external examples. Record the visual convention before tuning numbers.
- Do not silently change a hero or important character's rig, skeleton, fingers, body, topology, or anatomy to make gear or placement pass. If the defect is in the body/rig rather than the attachment, stop and report it.
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
- `docs/MISTAKES.md` — durable lessons ledger
- `docs/WORKFLOW.md` — public branch/PR and verification flow
- `docs/GALAQUEST_VISUAL_AUTHORITY.md` — visual direction and acceptance
- `docs/pipeline/` — public asset/character pipeline rules
- `docs/public-playtest.md` — hosted playtest and deployment provenance
- `docs/teardown/hero_contract.json` — character/gear numeric authority where applicable
- `ASSET-LICENSES.md` — shipped asset provenance and redistribution basis
- `.github/workflows/` — live hosted test definitions

If a public instruction references a path that does not exist, treat that as a guidance defect: repair or report it. Do not go looking for a private substitute by default.
