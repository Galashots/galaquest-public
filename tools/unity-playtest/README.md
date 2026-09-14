# Unity browser playtests

## Connected local Editor

Use the pinned, already-owned Editor and explicitly target `unity/GalaQuest` with Unity CLI.
Run `pwsh -NoProfile -File tools/unity/preflight.ps1` first. With Play Mode stopped, start
`node tools/unity/editor-play.mjs` in a terminal and retain that terminal for Ctrl+C teardown.
The helper prints its synthetic identity boundary, owned backend PID, loopback endpoint and fresh
OS-temp reward store before enabling the Editor override. It never selects inherited real-save paths.
Editor-local SessionState survives Play Mode/domain reload but does not enable another checkout or
persist after Editor exit. Only the acquiring token may stop/release that Editor session.
Ctrl+C requests owned Play Mode stop, boundedly verifies the stopped state and destruction of the
runtime transport, then restores the endpoint, disables the override and verifies backend exit/port
release. If stop cannot be verified, the helper retains ownership/backend for inspection and a later
Ctrl+C retry. A cleanup warning is NOT a verified stop. After an abrupt helper termination,
inspect ownership before manually releasing the recorded token; do not kill unrelated processes.

Use the existing combat preview preparation described below for fighting evidence; the canonical
greybox scene alone does not contain the combat presentation. Candidate preparation is not promotion.
Editor identity/transport do not provide browser progression/journal parity: XP, POWER and rewards
must be accepted in the built browser until a faithful projection exists.

Run the native `EditorPlayTransportTests` and `EditorTransportSocketTests` plus the existing
connection/travel tests through Pipeline `run_tests`. The socket fixture uses the repository's
WebSocket server, an ephemeral loopback port and no saves. Read the fresh executed result names/counts;
discovery or an async command's initial zero summary is not acceptance. Verify compilation first.

For composited evidence in Play Mode use `capture_game_view --source screen` through the CLI.
The installed Pipeline can confine `save_path` to Assets even when the schema describes it as
project-relative. A supported alternative is to omit `save_path`, redirect the JSON response into
ignored `.local` evidence, and decode `data.result.base64` into the original PNG without printing
the payload. Inspect the image, retain its SHA-256 and exact source identity, then upload the original
to the controlled Drive working packet. Avoid AssetDatabase refresh during an active evidence run.

## Built browser

These drivers run the built Unity client at `/unity/`. They require a local Unity build and its
exact-source manifest. The legacy `tools/runtime-test` review suites instead run the Three.js client
and do not provision or select Unity builds.

Discover and record the pinned Editor through the official Unity CLI, following
[`unity/AGENTS.md`](../../unity/AGENTS.md). From the intended repository root:

```powershell
pwsh -NoProfile -File tools/unity/preflight.ps1
unity editors -i
```

For batch fallback, use the actual pinned Editor executable reported by CLI discovery and verify
its product version; do not copy a workstation-specific path or resolve a bare `Unity.exe`, which
may select a WindowsApps CLI shim. Prefer the owned warm Editor for ordinary iteration. When launching
batch work with `Start-Process`, use `-PassThru` and wait for that returned process ID; starting the GUI
executable successfully is not evidence that compilation, tests, or a build finished.

For persistent local candidate inputs and the custody-dependent native regression, see
[stable preview preparation](../../docs/unity-preview-reuse.md). Reuse the owned warm Editor and
verify external edits have imported before treating test discovery or a ready status as evidence.

From the repository root:

```powershell
node tools/unity-playtest/travel.mjs path/to/candidate-build-manifest.json
```

The travel driver uses real keyboard/touch input in two isolated Chrome contexts, a fresh owned
server and fixture profiles. It checks the manifest's file hashes, requires a clean checkout, records
both source SHAs, and closes only its own processes. Set `GQ_CHROME_PATH` when Chrome is elsewhere.
An optional second argument distinguishes output folders for repeat runs.

For the personal progression checkpoint, add a suffix and `--progression`:

```powershell
node tools/unity-playtest/travel.mjs path/to/candidate-build-manifest.json -progression --progression
```

This mode seeds a near-level-up journal through the canonical profile store, earns the remaining XP
through real combat, checks the nearby sibling earns no contribution reward, then reloads both Unity
pages against a new empty server store on the same origin. It checks that the device journal restores
the earned stats without replaying a reward ceremony. Fixture scripts apply only on the owned origin;
the temporary blank pages used while restarting the server must not access browser storage.
Without `--progression`, the driver retains the travel-only checks for older travel builds.

Evidence is written beneath `.local/unity-playtest/`. If the server commit intentionally differs from
the client manifest, set `GQ_REVIEW_SERVER_SHA` to that exact checked-out SHA, verify the relevant
client/server source diff, and retain both SHAs in the report.

Exit success proves the asserted browser behavior. Inspect the generated screenshots separately;
the driver does not provide visual acceptance or physical iPad Safari performance evidence.

For convergence integrity, use `--integrity` in place of `--progression`. It includes progression,
then withholds one destination acknowledgement on an open browser socket and proves the Unity
session reconnects to its last confirmed camp with working movement. It also opens a replacement
same-profile client in another destination and verifies the superseded page stays retired beyond
the automatic reconnect interval. ACK interception exists only in this driver; runtime traffic
has no fault-injection toggle.

## Session and travel regression checks

When changing profile ownership or travel, run the real-socket server regressions and browser bridge
checks before rebuilding:

```powershell
node --test test/u3-independent-travel.test.mjs test/unity-web-cp1.test.mjs test/unity-profile-progression.test.mjs
```

Run the Unity EditMode connection/travel tests on the WebGL target too. Keep these counterexamples:

- Leave the old same-profile socket open. Prove immediate gameplay revocation independently of TCP
  closure, then check both different-destination ownership and a same-destination sibling observer.
  A settlement snapshot must not briefly publish the retired avatar beside its replacement.
- Contribute before takeover and resolve the fight afterward. Check the active identity's durable
  fact and presentation, an uninvolved sibling, and existing corpse claims. Settle queued combat
  before remapping its ledger, while keeping retired bodies out of published state.
- Withhold or corrupt arrival acknowledgements while the socket remains open. Use an unscaled timer
  independent of movement/control readiness; recover through the last confirmed destination and
  existing reconnect seam. Successful acknowledgements must cancel recovery.
- Retire callbacks on an intentionally closed browser socket. Late messages/close callbacks must
  not hydrate or clear its replacement. A superseded page must not automatically reclaim the profile.

`--integrity` exercises the built-client loss/takeover paths; it complements these focused tests.
Do not infer failure recovery from a happy-path travel run or a convenient network disconnect.

## Rune Forge package

The bounded Forge driver exercises the authored world controls with canvas touch input, two isolated
anonymous profiles, its own server, and an exact-source build manifest:

```powershell
node tools/unity-playtest/forge.mjs path/to/candidate-build-manifest.json -forge
```

It covers wrong-answer retry, hint and gesture-started spoken prompt, assisted and independent
success, one durable claim, explicit equip and POWER consumption, a late sibling, same-profile
replacement, and reconnect. It records the Unity client SHA and checked-out server SHA separately.
The driver can use projected control diagnostics when the player exposes them; its fixed fallback is
specific to the checked-in Forge pocket and still requires each physical tap to produce the expected
authoritative server transition.
