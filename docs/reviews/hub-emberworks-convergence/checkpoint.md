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
