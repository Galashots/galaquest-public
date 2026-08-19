# GalaQuest public agent authority

This file is intentionally short. It defines where work happens and the hard boundaries agents must not drift across. For detailed rules, read only the public files that actually exist in this repository.

## Repository topology

- **PUBLIC — `Galashots/galaquest-public`** is the primary active development authority. Normal gameplay, code, tests, CI, browser/playtesting work, public assets, and new development belong here.
- **PRIVATE** is archive/provenance authority, private production evidence, provider/account history, and a source for work that has not yet been safely ported. It is not the default development repository and its private files are not public startup prerequisites.
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

For normal development, confirm that the working repository is the public repository and record the exact HEAD SHA. Refresh live GitHub state before relying on remembered branch, PR, CI, or merge status.

If the current directory is not a Git checkout, **do not recursively search the machine** for repositories, old worktrees, Downloads, Desktop folders, or historical clones. Use a known path supplied by the owner, or use live GitHub authority until the intended checkout is known.

## Branch, PR, and evidence policy

- Normal agent work starts from current public `main` on a task branch and goes through a pull request.
- **Do not push directly to `main`.** Do not force-push, rewrite shared history, squash/amend shared commits, merge, or close PRs unless the owner explicitly authorizes that action.
- Keep one bounded task per branch/PR. Do not maintain duplicate active implementations in public and private.
- Every material test, browser observation, review conclusion, and acceptance claim names the **exact public SHA** it proves.
- Behaviour fixes should have a red-capable reproduction/test before the fix when practical. Do not tune gameplay or prediction constants merely to make hosted CI pass.
- Run the relevant tests from the actual checkout. Do not trust stale test counts copied into docs.

## Visual and product acceptance

- **Running-game pixels are final appearance authority.** A render, GLB inspection, screenshot of an asset, or machine metric can reject a bad result; none of them can visually accept the running game.
- Player-visible changes require human inspection in the running game at gameplay framing and, where useful, inspection scale. Automated harnesses are necessary evidence for behaviour but do not substitute for human visual judgment.
- **Reference first.** Before deciding how something should look, sit, hang, pose, or be held, inspect real reference images. The owner's GalaQuest reference art outranks external examples. Record the visual convention before tuning numbers.
- Do not silently change a hero or important character's rig, skeleton, fingers, body, topology, or anatomy to make gear or placement pass. If the defect is in the body/rig rather than the attachment, stop and report it.
- No paid Meshy or other provider spend without explicit owner authorization for that specific work. Never expose credentials or account material.
- Read `ASSET-LICENSES.md` before adding, replacing, or reclassifying shipped assets. Do not call paid-plan Meshy gear CC0 unless the recorded licence actually says CC0.

## Private PR #11 safe-port boundary

Private PR #11 is a **source**, not a merge candidate. Do not merge or bulk-copy it into public.

Current public-safe port order:

1. Character Studio improvements
2. Owner Fit
3. `gq.sword.v2`
4. the owner's locked sword-family `GQ_Bottom` / exact Ironwood seating
5. minimal public-safe regression tests/provenance that prevent placement drift

Third-party or franchise-inspired owner gear remains private and must not enter the public repository.

Safe-port efficiently: inspect the relevant private source once -> define the exact file/behaviour surface -> implement or port into public -> test public -> bind acceptance to the resulting public SHA.

**Locked sword rule:** approved proximal/hand seating stays fixed. Future sword-length changes extend toward `GQ_Tip`. Do not recenter through mesh center, bounding-box center, world-min, or length compensation.

## Public authorities

Read these when relevant; do not invent missing private prerequisites:

- `docs/MISTAKES.md` — lessons ratchet
- `docs/WORKFLOW.md` — public branch/PR and verification flow
- `docs/GALAQUEST_VISUAL_AUTHORITY.md` — visual direction and acceptance
- `docs/pipeline/` — public asset/character pipeline rules
- `docs/teardown/hero_contract.json` — character/gear geometry authority where applicable
- `ASSET-LICENSES.md` — shipped asset provenance and redistribution basis
- `.github/workflows/` — live hosted test definitions

If a public instruction references a path that does not exist, treat that reference as stale and repair or report it; do not go looking for a private substitute by default.
