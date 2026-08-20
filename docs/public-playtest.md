# Public playtest instance (Render)

`render.yaml` at the repo root deploys the real game -- `server.mjs` serving `public/` plus the
authoritative WebSocket server -- as a single Render web service on the free plan. This exists so
browser-driving agents (ChatGPT agent mode, or any tester without LAN access) can play the actual
game at a public URL. It complements, not replaces, the CI harnesses: those remain the scripted
evidence channel bound to exact SHAs.

## One-time setup (owner, ~2 minutes)

1. Sign in at https://dashboard.render.com (log in with GitHub).
2. New → **Blueprint** → connect `Galashots/galaquest-public` → Render reads `render.yaml` → Apply.
3. The service deploys from `main` and gets a stable URL like `https://galaquest-playtest.onrender.com`.

Optional, for per-PR playtests: open the service's **Settings → Pull Request Previews** and enable
them. Render then boots a throwaway copy of the service at the PR head for each PR and comments its
URL on the PR. (Single-service PR previews; the separate "Preview Environments" feature is a paid
full-stack variant this repo does not need.)

## Handing it to a playtester

Give the agent/tester the service URL. The client connects its WebSocket to its own origin, so one
URL is the whole game -- desktop and tablet, co-op included.

Known free-plan behaviour: the instance spins down after ~15 minutes idle and cold-starts in under a
minute on the next request. Tell a playtesting agent to wait for the first load.

## State and safety boundaries

- The reward store is pointed at a disposable path on ephemeral disk via
  `GALAQUEST_REWARD_STORE_PATH` (see `render.yaml`). The tracked `data/rewards.db` is never written
  by the hosted instance, and all hosted progress resets on deploy/restart.
- The URL is public: anyone who has it can join, and extra connected clients draw extra heroes.
  Coordinate playtest sessions, or suspend the service in the dashboard when not in use.
- Deploys track `main` automatically. A playtest claim should still name the exact SHA it was made
  against (the deploy's commit is shown in the Render dashboard), per the evidence policy in
  `AGENTS.md`.
