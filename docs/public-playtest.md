# Public playtest instance (Render)

`render.yaml` at the repo root deploys the real game -- `server.mjs` serving `public/` plus the
authoritative WebSocket server -- as a single Render web service on the free plan. This exists so
browser-driving agents (ChatGPT agent mode, or any tester without LAN access) can play the actual
game at a public URL.

## What this does and does not solve

It complements the CI harnesses and the `/director-playtest` relay; it does not replace them. Those
remain the scripted evidence channel bound to exact SHAs, and they are the only channel that works
at all for an environment that cannot browse.

It helps exactly one class of tester: one with a *working* browser but no route to a local machine.
It does **not** rescue an execution environment whose browser is policy-blocked from every URL --
a managed Chromium with an all-URL blocklist refuses a public `https://` origin for the same reason
it refuses `127.0.0.1`. For that environment the Actions relay remains the only path to pixels.

## One-time setup (owner, ~2 minutes)

1. Sign in at https://dashboard.render.com (log in with GitHub).
2. New → **Blueprint** → connect `Galashots/galaquest-public` → Render reads `render.yaml` → Apply.
3. The service deploys from `main` and gets a stable URL like `https://galaquest-playtest.onrender.com`.

## Binding a playtest to an exact commit

Every playtest claim must name the SHA it proves (`AGENTS.md`). The deployed site carries its own
provenance so a remote agent can establish this without dashboard access:

    GET <service-url>/source-sha.json   ->   {"sourceSha":"<the deployed commit>"}

**Fetch this first, before playing, and quote it in the report.** The service writes it at start
from Render's `RENDER_GIT_COMMIT`. If it reads `"unknown"`, the instance did not receive that
variable and the run is *not* evidence for any particular commit -- say so rather than guessing
from timing. If the path 404s entirely, the running service predates this mechanism; redeploy.

It is stamped by `startCommand`, deliberately not by `buildCommand`. This repo has no `package.json`
and no compile step, so Render's Node runtime has nothing to build and does not run a build command
here -- the first deployment stamped at build time came up healthy with no `/source-sha.json` on it
at all.

Note the file is generated at deploy time and is deliberately not in the repository, so a local
`node server.mjs 5201` has no `/source-sha.json`. Locally, the checkout itself is the provenance.

## Per-PR preview instances

Preview generation is declared in `render.yaml` as `previews.generation: manual`, so previews are
opt-in per PR rather than booted for every push. That is deliberate: previews draw on the same free
instance hours as the main service, and most PRs here touch CI or docs and have nothing to play.

To request one, include `[render preview]` in the pull request's title. Render then boots a preview
instance for that PR's head.

On GitHub the preview is surfaced as a **deployment** attached to the pull request -- open it with
**View deployment**. Render posts the preview URL as a PR *comment* only on GitLab and Bitbucket, so
do not sit waiting for a comment on a GitHub PR that is never coming.

A preview stamps its own `/source-sha.json` from the PR head, so the provenance rule above applies
to previews unchanged: fetch it first, and quote what it returns.

## Handing it to a playtester

Give the agent/tester the service URL. The client connects its WebSocket to its own origin, so one
URL is the whole game -- desktop and tablet, co-op included.

Known free-plan behaviour: the instance spins down after ~15 minutes idle and cold-starts in under a
minute on the next request. Tell a playtesting agent to wait for the first load, and not to read a
cold-start delay as a game defect.

## State and safety boundaries

- The reward store is pointed at a disposable path on ephemeral disk via
  `GALAQUEST_REWARD_STORE_PATH` (see `render.yaml`). The children's real save never reaches the
  host anyway (`data/*.db*` is gitignored, so it is not in a deploy), but the default store path
  would still create a save under `data/` on the instance; the override keeps hosted play on a
  throwaway file that resets on every deploy/restart.
- Because that store resets on redeploy, hosted progress is not durable. Anything a playtest needs
  to prove about persistence across restarts belongs in the harnesses, not here.
- The URL is public: anyone who has it can join, and extra connected clients draw extra heroes.
  Coordinate playtest sessions, or suspend the service in the dashboard when not in use.
- Deploys track `main` automatically, so the URL is a moving target between sessions. This is
  exactly why a claim cites `/source-sha.json` rather than "the current deploy".
