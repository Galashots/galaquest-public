# Unity browser playtests

These drivers run the built Unity client at `/unity/`. They require a local Unity build and its
exact-source manifest. The legacy `tools/runtime-test` review suites instead run the Three.js client
and do not provision or select Unity builds.

For the remote equivalent of the existing U2 candidate build, use the bounded [Unity Build Automation
bridge](../../docs/unity-cloud-build-bridge.md). It provisions the ignored custody inputs, lets
`U2CombatPreview` generate and select its temporary review scene, and emits the same manifest shape;
it does not make the candidate public or replace browser/device acceptance.

Resolve and record the actual Editor executable before a Unity checkpoint. A bare `Unity.exe` in an
evidence command is only an abbreviation: on Windows, `Get-Command Unity.exe` or `where.exe Unity.exe`
may resolve a WindowsApps `unity` CLI/MCP shim rather than the Editor. The current project machine's
verified 6000.3.23f1 Editor is:

```powershell
$unityEditor = 'C:\Program Files\Unity 6000.3.23f1\Editor\Unity.exe'
Get-Item -LiteralPath $unityEditor | Select-Object FullName, VersionInfo
```

Use that absolute path for batch work and retain its product version in the checkpoint. When launching
with `Start-Process`, use `-PassThru` and wait for that returned process ID; starting the GUI executable
successfully is not evidence that compilation, tests, or a build finished.

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
