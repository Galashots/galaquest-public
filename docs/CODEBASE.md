# GalaQuest code map

A fresh contributor's map of the program itself. This file says where things live and how to run
them; it carries no process rules. Lifecycle and evidence rules live in `docs/WORKFLOW.md`; hard
boundaries live in `AGENTS.md`. If this map drifts from the code, the code is right — repair the map
in the same PR.

## Quickstart

```bash
node server.mjs            # serve the game locally (default port 5201)
node --test test/*.test.mjs  # the required unit gate, including guidance/ledger integrity
```

`tools/runtime-test/` harnesses own their isolated runtime server — do not pre-start `server.mjs`
for them (see `docs/WORKFLOW.md`, verification surfaces).

## Server

- `server.mjs` — static file server for `public/`, attaches the game server and forge API.
- `net/gameServerCore.mjs` — the authoritative simulation. Server state is the truth the clients
  reconcile toward.
- `net/gameServer.mjs` — binds the core to the transport and the reward store.
- `net/wsServer.mjs`, `net/wsFrame.mjs` — WebSocket transport and framing.
- `net/rewardStore.mjs` — durable progression persistence (SQLite files are created at runtime
  under the gitignored data directory; `data/README.md` describes it).
- `net/forgeApi.mjs` — HTTP API for the forge surface.

## Client

`public/index.html` boots `public/src/main.js`, which wires the subsystem directories under
`public/src/`:

- `net/` — client-side connection, prediction, and reconciliation against server snapshots;
- `render/`, `world/`, `camera/` — three.js scene, terrain/props, camera;
- `character/` — hero rig, gear, locomotion, swing; `public/src/character/gear.js` is the one
  home for gear transforms (see GQ-007 in `docs/MISTAKES.md`);
- `combat/`, `enemies/`, `companions/` — encounters and creatures;
- `progression/`, `rewards/`, `village/`, `forge/` — player progression and its presenters;
- `input/`, `ui/`, `audio/` — touch/keyboard input, HUD, sound;
- `studio/`, `review/`, `debug/` — inspection surfaces (`public/studio.html`,
  `public/forge.html`), not gameplay.

Vendored libraries live in `public/vendor/`. Numeric character/gear authority, where applicable, is
`docs/teardown/hero_contract.json`.

## Tools, tests, CI

- `tools/runtime-test/` — CDP browser harnesses (the local running-game evidence surface);
  `tools/diagnostics/` — instruments; `tools/ci-diff.py` — hosted-run comparison with flap history.
- `tools/foundry/`, `tools/meshy/`, `tools/assets/`, `tools/blender/`, `tools/atlas/` — asset
  pipeline; provider spend is Owner-authorized per `AGENTS.md`.
- `tools/sol-review/`, `tools/forge-review/` — review/capture workers.
- `test/` — the unit gate. It is also where guidance stays honest:
  `test/guidance-integrity.test.mjs` and `test/mistakes-ledger.test.mjs`.
- `.github/workflows/test.yml` is the required hosted gate; the other workflows are on-demand or
  diagnostic (`docs/WORKFLOW.md` lists them).

## Surfaces with elevated acceptance burden

These surfaces carry coupling or risk beyond their diff size. When a package touches one, classify
and gate accordingly under `docs/WORKFLOW.md` (package classes, escalation of verification
surfaces) — a small diff here is not a small package:

- `net/` and `public/src/net/` — netcode, prediction, reconciliation; wall-clock/frame-rate lessons
  cluster here (`docs/MISTAKES.md` tags `net`, `harness`).
- `net/rewardStore.mjs` and progression persistence — durable player state; restart/hydration
  lessons apply (tags `persistence`).
- Shared constants and contracts — `public/src/character/gear.js`,
  `docs/teardown/hero_contract.json`; never restate, import (GQ-007).
- Player-visible appearance — human running-game inspection required (`AGENTS.md`, visual
  acceptance).
- Shipped assets and licensing — `ASSET-LICENSES.md` before adding or reclassifying.
- `.github/workflows/director-playtest.yml` — read-only/write-capable job split is a security
  boundary; do not collapse it.
