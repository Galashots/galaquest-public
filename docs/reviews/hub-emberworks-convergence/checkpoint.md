# Hub / Emberworks convergence and session integrity

Issue #46; M coupled package; sole semantic writer. Scope: converge accepted first-fight/grip,
independent travel and personal progression, then repair same-profile ownership/contribution and
bounded travel recovery. CP0 integration -> CP1 profile ownership -> CP2 recovery -> CP3 exact-head
Node/Unity/WebGL/hosted evidence. Separable findings belong in this review handoff. No new content,
learning, gear, provider work, asset promotion, shared-history rewrite, PR merge or closure.

## CP0 baseline

Refreshed public main: `d7c37e000e8ae3ea93c03f2cbc499edfa14bf9e4`.
Ordinary merges on a new branch from main integrate #150
`8bdffd5ffeddb1156cf2cc56ebb46ea5fe248148` then #146
`7a9f2445bb4627a91e9fca83bad46454d8a104a0`.
#149 `71753881e70da77781ba9ac6c2ae934a6dc47123` is an ancestor of #150.
Common #146/#150 ancestor: `be9d88f95d98b40440029ba1dcc2ebe8b9fc2840`.
#146 has two later grip/admission commits. Conflicts: retain #146's playtestAdmission receipt;
retain #150's fast build and optimization/compression provenance in U2CombatPreview.
The scene merged automatically; Unity grip/scene regression remains a required gate.

Integrated baseline: `e86d74d471601c8528c30d9c94830f82d6aa1443`.
`node --test test/u3-independent-travel.test.mjs test/unity-profile-progression.test.mjs test/unity-web-cp1.test.mjs test/reward-wiring.test.mjs test/destinations.test.mjs`
PASS: 61 tests, zero failures. Local log: `.local/convergence/cp0-targeted.log`.
This finds no integration regression on these seams; it does not establish Unity/browser acceptance.
The original owner checkout and its existing gear/registry/settings changes were preserved.
Git's first merge reported permission errors pruning unrelated old worktree metadata; the merge
completed successfully. No cleanup was attempted.

## CP1 reproduction and correction

Baseline plus new real-socket tests:
`node --test --test-name-pattern="same profile takeover|unpublished contribution" test/u3-independent-travel.test.mjs`
FAIL on both required counterexamples (`.local/convergence/cp1-red.log`): two live avatars;
active connection lacks the earned reward event despite durable XP appearing in its snapshot.
An initial test setup used too little swing time; corrected to actual contact before treating F2 as red.
The first test suppresses socket closure to test synchronous authority revocation independently of TCP.

Correction: flag the old connection superseded before processing more frames, settle queued combat,
remove its avatar and reward identity, then reuse contributor/corpse-claim reassignment. Close 4001
identifies takeover. Unity's treatment of this closure belongs to CP2 so it cannot automatically fight
for ownership. No second reward/session system was added.

Focused post-fix command:
`node --test test/u3-independent-travel.test.mjs test/reward-wiring.test.mjs test/unity-profile-progression.test.mjs`
PASS: 43 tests, zero failures (`.local/convergence/cp1-green.log`). Tests include contribution ->
live takeover -> combat resolution, one durable XP fact/event for the active identity, and no XP for
an uninvolved sibling. Required full Node, Unity, browser and hosted gates are pending.

## CP1 full gate and CP2 travel recovery

CP1 commit: `0b640217507f66f68ccc5d4bf39875381b936ed3`. Required local Node suite:
2303 PASS / 1 FAIL / 3 SKIP. Failure: Windows Lantern-XP temporary-directory cleanup EPERM.
A Git archive of unmodified CP0 reproduced that same failure (21 PASS / 1 FAIL in
`.local/convergence/cp0-lantern-repro.log`), separating it from this repair.
Hosted required unit runs 34234745527 and 34234724099 PASS; Director bundle 34234745503 PASS.

Unity red probe on unchanged baseline session source:
`Unity.exe -batchmode -nographics -projectPath unity/GalaQuest -buildTarget WebGL -runTests -testPlatform EditMode -testFilter GalaQuest.Tests.U3TravelConnectionTests -testResults .local/convergence/cp2-red.xml -logFile .local/convergence/cp2-red-unity.log`
Actual result: existing 3 PASS, new 7 FAIL. Six missing/wrong/malformed arrival cases lack bounded
recovery; the superseded-session case opens a second connection instead of remaining retired.
Initial cold import/package resolution was slow; tests only became evidence once XML existed.

Correction: ten seconds of unscaled travel wait retires the uncertain socket and signals the
existing two-second reconnect seam. The requested world never replaces the last confirmed
DestinationId without a matching player/destination/next-epoch acknowledgement. Recovery rejoins
that confirmed world and requires neutral input. Supersession close code 4001 clears gameplay
but suppresses automatic reconnect. Deliberate socket closure detaches old callbacks; late frames
cannot hydrate recovery. The existing nonblocking status panel carries the messages.

Bridge red probe observed an unwanted close callback; its post-fix bridge/progression run passes
15 tests. Full Unity EditMode (same command without testFilter, outputs cp2-green.xml and
cp2-green-unity.log): 196 PASS / 0 FAIL / 1 optional SKIP. This includes the approved grip/scene
checks and the travel cases. NUnit's top-level Skipped:Ignored includes the optional case; it is
not a skipped suite. Focused Node/server/bridge/guidance/corpse command:
`node --test test/u3-independent-travel.test.mjs test/unity-web-cp1.test.mjs test/unity-profile-progression.test.mjs test/reward-wiring.test.mjs test/corpse-loot.test.mjs test/guidance-integrity.test.mjs`
86 PASS / 0 FAIL (`.local/convergence/cp2-node.log`). A further real-combat test verifies an existing
corpse claim is transferred intact on live takeover. An invalid destination join cannot evict its
valid same-profile session. Superseded connections also receive no final settlement broadcast.

CP3 will bind committed inputs to final-head Node/Unity, strict non-development WebGL candidate
build, real browser integrity flow and hosted evidence. The existing browser driver now supports
`--integrity`, including a harness-only withheld acknowledgement on an otherwise open socket.
Physical iPad and independent/Owner acceptance remain separate and are not claimed here.

## CP3 residual F1 counterexample

The same-room observer probe on `6ce52e1cac04b0d66fdf13a62caa6146c59673b5` found one settlement
snapshot containing both the retired avatar and its replacement. This is a residual ownership
presentation defect, not an integration/content regression. The committed regression now requires
zero such snapshots. The correction removes the old body before publishing pending combat, retaining
its reward identity until settlement. Focused Node/server/bridge/guidance/corpse suite: 87 PASS,
zero failures (`.local/convergence/cp3-final-focused.log`).

The strict WebGL build succeeded at client source `6ce52e1cac04b0d66fdf13a62caa6146c59673b5`.
Build entry: `GalaQuest.Editor.U2CombatPreview.BuildWebGL`, `-batchmode -quit -buildTarget WebGL`,
`GQ_FAST_REVIEW_BUILD=1`; BuildOptions.StrictMode, no Development flag. Manifest:
`.local/m2/preview-build-6ce52e1-fast.json`; log: `.local/convergence/cp3-build.log`.
Flavor is LOCAL_CANDIDATE_REVIEW, BuildTimes optimization, disabled compression, productionPromotion
false. Full committed-head EditMode: 196 PASS / 0 FAIL / 1 opt-in preview SKIP; then the opt-in test
was separately run with GQ_U2_GRIP_REVIEW=1 and passed (1/1). The original hash-verified hand JSON was
read from the producer's existing local custody; no candidate was created or promoted.

The residual correction changes only the server, its regression, and the browser driver/checkpoint.
Unity/client source remains identical, so browser evidence will record its client and server SHAs
separately. The integrity driver also exercises touch movement after ACK-loss recovery.


## CP3 final integrated runtime evidence

Draft review surface: [PR #152](https://github.com/Galashots/galaquest-public/pull/152), against main.
Runtime/server and browser-driver head: `3939c64f38475290cde3a3a28f5176d35b98006a`.
Unity client/build head: `6ce52e1cac04b0d66fdf13a62caa6146c59673b5`.
The final evidence-only commit is named by the PR's READY FOR INDEPENDENT REVIEW comment;
it does not change either tested runtime. Do not relabel the client or server evidence as that commit.
`git diff --name-only 6ce52e1 3939c64` contains only the server, server test, browser driver,
checkpoint, README and skill. There is no Unity or public client runtime difference.

| Surface | Exact tested source | Result / evidence |
| --- | --- | --- |
| CP0 focused baseline | e86d74d | 61 PASS; no integration regression found on tested seams |
| F1/F2 red sockets | CP0 plus regression probes | Both FAIL; [actual output](profile-red.txt) |
| F3 Unity red | unchanged CP0 session plus regression probes | 3 PASS, 7 FAIL; [XML result excerpts](evidence.json) |
| Focused final Node/session/travel/reward/corpse/bridge | 9f6cf56 server source, identical at 3939c64 | 87 PASS, zero FAIL |
| Guidance after checklist update | 3939c64 | 7 PASS |
| Full required local Node | 3939c64 | 2307 PASS, 1 known cleanup FAIL, 3 SKIP; 2311 total |
| Full Unity EditMode, WebGL target | 6ce52e1 | 196 PASS, zero FAIL, 1 opt-in preview SKIP |
| Opt-in approved grip/scene preview | 6ce52e1 | 1 PASS, zero FAIL, zero SKIP |
| Strict non-development WebGL | 6ce52e1 | PASS; [manifest and byte hashes](build-manifest-6ce52e1.json) |
| Real Unity browser integrity | client 6ce52e1 / server 3939c64 | 16 checks PASS, zero errors; [full report](browser-proof-3939c64.json) |
| Hosted required unit | 3939c64 | [34241592834 PASS](https://github.com/Galashots/galaquest-public/actions/runs/34241592834) |
| Director runtime bundle | 3939c64 | [34241592813 PASS](https://github.com/Galashots/galaquest-public/actions/runs/34241592813) |

Exact input/merge heads remain recorded in CP0. First merge commit:
`5c8fc4c834631b2562c304f7ef0b250537321a3c`; second merge is the CP0 head above.
Latest live refresh still matches main, #146 and #150. #149's independent travel history is retained
through #150; no conflicting old PR was rewritten. The final PR comment records another live refresh.

The local Node failure is `test/lantern-xp-award.test.mjs`, restart-test temporary directory removal
at line 219 through close at line 78: Windows EPERM after the assertions. The same unmodified CP0
archive reproduces it. Local required unit is therefore FAIL, not an all-green claim; hosted required
unit is PASS. The broad diagnostic matrix is not a required gate: client-head run
[34237286910](https://github.com/Galashots/galaquest-public/actions/runs/34237286910) failed multiple
legacy fit/keeper/loot drivers. Their causes remain unclassified in this bounded package; no claim
that all are pre-existing. Server-head run 34241592746 was still running when this record was written.
The final PR comment supplies final-head hosted gate results without chasing unrelated fit/content work.

Commands executed from this worktree (Unity project/results/log arguments were resolved to absolute
paths; executable was Unity 6000.3.23f1):

```powershell
node --test test/*.test.mjs
node --test test/u3-independent-travel.test.mjs test/unity-web-cp1.test.mjs test/unity-profile-progression.test.mjs test/reward-wiring.test.mjs test/corpse-loot.test.mjs test/guidance-integrity.test.mjs
Unity.exe -batchmode -nographics -projectPath unity/GalaQuest -buildTarget WebGL -runTests -testPlatform EditMode -testResults .local/convergence/cp3-editmode.xml -logFile .local/convergence/cp3-editmode.log
$env:GQ_U2_GRIP_REVIEW='1'
Unity.exe -batchmode -nographics -projectPath unity/GalaQuest -buildTarget WebGL -runTests -testPlatform EditMode -testFilter GalaQuest.Tests.U2GripPreviewSceneTests -testResults .local/convergence/cp3-preview.xml -logFile .local/convergence/cp3-preview.log
Remove-Item Env:GQ_U2_GRIP_REVIEW
$env:GQ_FAST_REVIEW_BUILD='1'
Unity.exe -batchmode -quit -projectPath unity/GalaQuest -buildTarget WebGL -executeMethod GalaQuest.Editor.U2CombatPreview.BuildWebGL -logFile .local/convergence/cp3-build.log
$env:GQ_REVIEW_SERVER_SHA='3939c64f38475290cde3a3a28f5176d35b98006a'
node tools/unity-playtest/travel.mjs .local/m2/preview-build-6ce52e1-fast.json -integrity --integrity
```

[Evidence index](evidence.json) records local log paths and SHA-256 hashes, XML counts and travel
case results. Browser output: `.local/unity-playtest/browser-6ce52e1-integrity/`.
The strict build is an uncompressed BuildTimes review candidate, not a production/performance build.
Existing candidate FBX, texture and approved hand-grip inputs were hash verified and reused;
no provider request, newly qualified asset or promotion occurred.

### Defect disposition and disconfirming evidence

- **F1 CLOSED on tested surfaces.** Real sockets reproduce two live cross-destination avatars before
  correction and one after. An intentionally open superseded socket cannot move, attack or rejoin.
  Invalid joins cannot evict a valid session. The residual same-room duplicate settlement snapshot
  failed at 6ce52e1 and now has a passing regression. Real WebGL takeover removes the old avatar,
  leaves the old page retired beyond its reconnect interval and lets the replacement travel/play.
- **F2 CLOSED on tested surfaces.** Meaningful contribution -> live takeover -> resolution earns one
  durable XP fact and one active-connection event, with zero retired presentations and no reward for
  an uninvolved sibling. Actual corpse claims transfer intact. Existing contributor ledger and reward
  store are reused. Real touch combat also proves XP 95 -> 115, level 1 -> 2, POWER 1000 -> 1400,
  sibling XP 0, reconnect persistence and device-journal restoration against an empty replacement store.
- **F3 CLOSED on tested surfaces.** Six red-capable Unity cases cover absent, malformed, wrong player,
  wrong destination, stale epoch and unexpected epoch acknowledgements. A ten-second unscaled timeout
  uses the existing reconnect seam and last confirmed destination. Correct acknowledgements cancel
  it; retired callbacks cannot replace state. The built browser harness drops an actual arrival ACK
  while leaving the socket open, then observes a fresh confirmed Camp session within its 25-second
  bound and proves keyboard plus touch movement. No destination truth is guessed client-side.

### Running-game inspection and remaining weakness

The producer inspected the actual Camp, level-up, edge-orbit, withheld-ACK, recovered-control,
retired-session and replacement screenshots. [Camp](01-camp-together.png) and
[level-up](11-level-up.png) retain the accepted hero/grip and progression presentation.
[Withheld ACK](14-ack-withheld.png) shows the existing upper-left status and neutral controls;
[recovered touch movement](15-ack-recovery-controls.png) shows it cleared with normal touch regions
unobstructed. [Retired page](16-superseded-session.png) explicitly directs play to the newer session;
[replacement](17-active-replacement.png) is usable in Emberworks. A retired page retains a frozen
local scene, not a live authoritative avatar.

Strongest remaining product weakness: [the Camp edge orbit](10-camp-edge-orbit.png) can become an
almost top-down view of mostly empty ground, losing destination readability. The convergence remains
a small greybox slice, not a completed Hub experience. No camera/content tuning was added here.
The recovery delay (ten seconds plus reconnect) is noticeable and rejoins at the normal destination
spawn rather than preserving an unconfirmed transient pose. Its purpose is integrity and eventual
usability when the server is reachable, not seamless/offline travel.

**UNKNOWN / not accepted:** physical iPad Safari touch/re-grab and interruption behavior; optimized
build performance; browser-level malformed ACK variants (covered by Unity tests); the exact browser
sequence of contribution followed by takeover before reward (covered by real socket tests, while
browser combat/reward and takeover are exercised separately); independent and Owner visual/product
acceptance; causes of broad diagnostic matrix failures. No all-browser-matrix PASS is claimed.

Existing shared branch/PR history is unchanged; only ordinary merges were made on the new branch.
No existing PR was merged or closed, no provider spend or asset promotion occurred, and the original
Owner checkout's dirty files remain untouched. No Sunroot, Rune Forge, learning pack, worms, gear,
MagmaLord helmet or new Emberworks content work occurred. #151 was not a runtime dependency.

Next lane: fresh reviewers perform independent review of PR #152. This producer stops after posting
READY FOR INDEPENDENT REVIEW; no further implementation package or self-independent acceptance.
