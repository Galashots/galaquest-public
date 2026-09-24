# GalaQuest

A browser game for tablets and desktops, built in three.js with plain ES modules and no build step.
The active game is **Hatch & Harvest**, a creature-collector farm in `prototypes/farm-slice/`
(direction: `docs/product/PRODUCT_VISION.md`). Under active development.

The Unity project at `unity/GalaQuest/` is parked by the 2026-09-24 engine decision: kept as
reference, not the production client. The older three.js action-adventure client in `public/` is
retained as reference and legacy review tooling.

## What's here

| Area | What it is |
| --- | --- |
| `prototypes/farm-slice/` | The active three.js farm game: rules, diorama renderer, touch UI, content pack, and its own `node --test` suite. `CONTRACT.md` is its experience contract. |
| `unity/GalaQuest/` | The parked Unity project. If you do touch it, [`unity/AGENTS.md`](unity/AGENTS.md) owns its authoring, build, and validation boundaries. |
| `public/` | The retained three.js reference client — rendering, input, combat, world zones, progression, and shipped assets used by the legacy review surface. |
| `net/` | The authoritative game server: WebSocket framing, server loop, reward store. |
| `server.mjs` | The local static + WebSocket host: the farm game at `/farm/`, the retained client at `/`, sockets at `/ws`, and an existing local Unity build at `/unity/`. |
| `test/` | The unit suite. Plain `node --test`, no framework. |
| `tools/runtime-test/` | Chrome DevTools Protocol harnesses that drive the real game in a real browser. |
| `tools/unity-playtest/` | Manifest-bound Unity browser evidence. Read its [`README.md`](tools/unity-playtest/README.md) rather than using the legacy harnesses for Unity. |
| `docs/` | Workflow, guidance, pipeline, visual-authority, and asset documentation. |
| `AGENTS.md` | Hard conventions and guardrails for anyone — human or agent — working in this repo. |

## Running it

The repo has **no npm dependencies and no install step**. Use Node 24+; the hosted required unit gate
also runs on Node 24, including persistence code that relies on the built-in `node:sqlite` surface.
Chrome is required for the browser harnesses.

```bash
node server.mjs
```

Serves the farm game at `http://localhost:5201/farm/` (the retained client stays at `/`) and prints
the LAN URL for testing on a tablet. The hosted playtest instance serves the same route at
`<service-url>/farm/` (`docs/public-playtest.md`).

```bash
node --test test/*.test.mjs
node --test prototypes/farm-slice/test/*.test.mjs prototypes/farm-slice/test/depth/*.test.mjs
```

The first runs the repo unit suite, including guidance-integrity checks; the second runs the farm
game's own suite. The required hosted `unit` job runs both.

## Browser harnesses

The harnesses drive a real Chrome over the DevTools Protocol on port 9224. Start it, in its own
shell, and leave it running:

```bash
node tools/runtime-test/automation-chrome.mjs           # headless; --headed to watch it play
node tools/runtime-test/play-fight.mjs
```

`automation-chrome.mjs` finds a browser (an explicit `GALAQUEST_CHROME`, then a
`PLAYWRIGHT_BROWSERS_PATH` pool, then the ordinary names on PATH), gives it a dedicated profile, and
resolves only once it is really answering CDP. If something is already on 9224 it **attaches rather
than replacing** -- the owner's signed-in browser sits one port away on 9223, and a harness does not
get to guess who owns a port (`tools/runtime-test/owned-server.mjs` makes the same argument for the
server half).

**A cloud agent container can run these.** It has no desktop and usually no `chrome` on PATH, but a
Chromium in the Playwright pool drives CDP identically, and the launch carries a software rasteriser
so the WebGL captures are real frames rather than an empty canvas. Measured in a Claude Code cloud
container on 2026-09-19 at `32ba3cd`: `drive-village.mjs` 17/17, `drive-marks.mjs` 21/21, with
captures written. Running-game pixels therefore do not require the desktop appliance for the
retained Three.js surface; Unity builds remain `unity/AGENTS.md`'s.

**The harnesses do not use the 5201 server.** Every file in `tools/runtime-test/` spawns and owns its
own runtime server on an isolated port and kills only that child when it finishes
(`tools/runtime-test/owned-server.mjs`). Do not start a server before running one.

That is not tidiness. Against a shared server, `play-fight.mjs` failed 4 runs of 4 — three of them
inheriting a wolf still dead from the previous run, because the wolf is server-authoritative and takes
10 s to respawn. Worse, the shared port turned out to be owned by a *different checkout* whose client
bundle hashed identically, so nothing in the served bytes would have told you which tree a green run
had actually tested.

`play-fight.mjs` writes captures to gitignored `.local/runtime-test/` and **refuses to run with more
than one client connected** — every extra client draws its own hero, so one stale tab silently puts a
second hero in the frame. Open the captures and look at them; that is the entire point of it.

Those harnesses are all scripted, and a scripted harness can only fail in ways someone already
imagined. For the unscripted counterpart — one agent playing the real game through a deliberately
player-fair view, producing a transcript rather than a verdict — read `docs/agent-playtest.md`.

```bash
node tools/runtime-test/playtest-session.mjs --minutes 20 --persona "a seven-year-old playing for the first time"
```

For a map of the code itself and how to run it, read `docs/CODEBASE.md`. For the full public
development and evidence flow, read `docs/WORKFLOW.md`. For how the Markdown guidance itself is
maintained and linted, read `docs/GUIDANCE.md`.

## Design notes

Tablets first: touch stick, portrait and landscape, and a HUD readable at arm's length. Designed for
young players without looking juvenile — difficulty and reading load are tuned across a range of ages
rather than a single one.

Rendering is deliberately conservative — modest triangle budgets, one texture atlas per character, few
draw calls — so it holds a steady frame rate on tablet hardware.

## Assets and licensing

Shipped binary assets have mixed provenance and are **not** covered by a blanket source licence. See
[`ASSET-LICENSES.md`](ASSET-LICENSES.md) for the per-family breakdown and [`NOTICE`](NOTICE) for the
overall licensing posture.

## Provenance

Initial public release derived from the private GalaQuest engineering tree at source SHA
`54c4e1eadca3a11f9f3318a1a70580483a52d481`. This repository starts a fresh history; the private
engineering archive is not part of it.
