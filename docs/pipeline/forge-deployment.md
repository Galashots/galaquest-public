# Forge deployment boundary — the paid Meshy lane fails closed

The Asset Forge page (`public/forge.html`) has two halves with very different risk:

- **Fit authoring** — loads the Hero and candidate gear, edits transforms, exports fit packets.
  Free, read-only against the repo, safe on any host.
- **The paid Meshy lane** — `/api/forge/meshy/*` in `net/forgeApi.mjs`, which can spend real
  provider credits. This lane must exist only on a dedicated Forge workstation.

## Enablement is explicit, not inferred

Every `/api/forge` route except the minimal status probe refuses to operate unless the server
process has:

```
GALAQUEST_FORGE_ENABLED=1
```

This is checked independently of credentials. A host that has a Meshy key or unlock token but not
this flag still answers `503 forge_disabled`. The status probe on a disabled host reports only
`{ "enabled": false }` and never reveals whether a key or token happens to be configured.

## The public game host must never become a Forge

The ordinary public Render/game deployment (see `docs/public-playtest.md`) must **not** receive any
of:

- `GALAQUEST_FORGE_ENABLED`
- `MESHY_API_KEY`
- `GALAQUEST_FORGE_TOKEN`
- any equivalent paid-provider Forge credential

unless a future owner decision explicitly changes this architecture. `server.mjs` serves the same
routes everywhere; the environment is the boundary, and the enablement flag makes that boundary
fail-closed instead of relying on nobody ever pasting a credential into the wrong dashboard.

CI is a permanently disabled host: `.github/workflows/forge-review.yml` deliberately provides no
Forge environment, and the browser proof asserts the page reports the lane locked.

## Spend protection and its honest durability limits

Two layers keep one human generation attempt equal to at most one paid provider task:

1. **Server spend ledger** (`net/forgeApi.mjs`): every generation-start must carry an
   `idempotencyKey`; a repeated submission with the same key returns the original provider task
   instead of creating another, a same-key submission with a *different* payload is rejected, and a
   rolling rate limit bounds how fast paid tasks can be created at all. This ledger is
   **process-memory only** — a server restart forgets it. It is not restart-durable idempotency and
   is not claimed to be.
2. **Browser pending-task record** (`public/src/forge/pendingTask.js`): the taskId of an in-flight
   paid task is persisted in the workstation browser's localStorage. After a reload/tab close the
   Forge offers **Resume paid task**, which re-polls the same provider taskId; new generations are
   blocked until the pending task is resumed or explicitly abandoned. This survives a browser
   restart on that machine/profile, not a cleared profile or a different machine — the provider
   remains the source of truth for task state.

The one edge neither layer can resolve: if the provider accepted a task but the response was lost
before the server saw it, no record exists anywhere on our side. Check the provider dashboard
before re-approving spend after such a failure.

The Forge unlock token itself is never persisted in the browser (no localStorage/sessionStorage);
it must be re-entered after every reload, including to resume a pending task.
