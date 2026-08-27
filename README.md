# GalaQuest

A browser-based, MMO-inspired action-adventure built for tablets and desktops. Tab-target combat, a
persistent village, co-op play over WebSockets, and learning content built into the world rather than
bolted onto it. Under active development.

No game engine, no native app, no build step: three.js r170, plain ES modules, and vendored
dependencies. Players join by URL.

## What's here

| Area | What it is |
| --- | --- |
| `public/` | The game client — rendering, input, combat, world zones, progression, shipped assets. |
| `net/` | The authoritative game server: WebSocket framing, server loop, reward store. |
| `server.mjs` | The static + WebSocket host. |
| `test/` | The unit suite. Plain `node --test`, no framework. |
| `tools/runtime-test/` | Chrome DevTools Protocol harnesses that drive the real game in a real browser. |
| `docs/` | Workflow, guidance, pipeline, visual-authority, and asset documentation. |
| `AGENTS.md` | Hard conventions and guardrails for anyone — human or agent — working in this repo. |

## Running it

The repo has **no npm dependencies and no install step**. Use Node 24+; the hosted required unit gate
also runs on Node 24, including persistence code that relies on the built-in `node:sqlite` surface.
Chrome is required for the browser harnesses.

```bash
node server.mjs
```

Serves the game at `http://localhost:5201/` and prints the LAN URL for testing on a tablet.

```bash
node --test test/*.test.mjs
```

Runs the full unit suite, including guidance-integrity checks.

## Browser harnesses

The harnesses drive a real Chrome over the DevTools Protocol. Start Chrome with a dedicated profile
and remote debugging on port 9224, then:

```bash
node tools/runtime-test/play-fight.mjs
```

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
