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

Exit success proves the asserted browser behavior. Inspect the generated screenshots separately;
the driver does not provide visual acceptance or physical iPad Safari performance evidence.
