# Unity browser playtests

These drivers run the built Unity client at `/unity/`. They require a local Unity build and its
exact-source manifest. The legacy `tools/runtime-test` review suites instead run the Three.js client
and do not provision or select Unity builds.

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
