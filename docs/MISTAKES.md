# MISTAKES.md — the lessons ratchet

the owner's instruction, 2026-08-13: *"All lessons learned must be tracked where appropriate to avoid
repeated gotchas."* This file is where they live now. `AGENTS.md` used to carry them as prose (see
its former "Gotchas that have already repeated" section); that section drifted stale inside the very
paragraph warning about staleness (see GQ-003 below), which is the reason this file exists as a
ratchet instead of a list.

**Ratchet, not archive.** Promotion is mechanical, not a judgment call.

| Rung | Trigger | What happens |
|---|---|---|
| `OBSERVED` | 1st hit | Logged with its incident. No ID, no citation duty. |
| `RULE` | 2nd hit | Gets a stable ID (`GQ-NNN`, never reused). Briefs must cite applicable IDs. |
| `ENFORCED` | 2nd hit **and** expressible as a check | A test named for the ID lands in `test/`. If genuinely untestable, the entry **stays at `RULE` and must state why in one sentence** — an unexplained `RULE` at 3+ hits is itself a finding. |

`Foreknowledge helped:` is u/LividCan4323's contribution and the only field that says whether an
entry earns its context budget. An agent that dodged a mistake because of an entry appends a dated
line. Entries with many hits and no help get rewritten or deleted, not promoted.

`test/mistakes-ledger.test.mjs` enforces the mechanical parts of this table: every `ENFORCED` entry
names a test file that actually exists, every `GQ-NNN` ID is unique and never reused, and every
`RULE` entry at 3+ hits carries a stated reason it isn't enforced.

---

### GQ-007 — Never restate a constant. Import it.
**Status:** ENFORCED · **Hits:** 7 · **First:** 2026-08-11 · **Last:** 2026-08-22
**Enforced by:** `test/shared-constants.test.mjs`
**Rule:** A value used by two modules lives in one importable module. If a module cannot import it,
that is the thing to fix. **Hit 6's addition: a constant DERIVED from other modules' numbers is the
same defect wearing a hat.** A literal that only happens to satisfy a relationship is not satisfying
it -- it is a snapshot of a relationship that held on the day it was typed, and nothing tells you
when it stops holding. Derive it, or pin the relationship in a test. Prose in a comment is neither.
**Incidents:** play-fight's `wolf.hp < 3`; the fixed 500 ms hit poll; three fixed swing offsets;
three tests restating their own formula; `WOLF_SPAWN` duplicated across `net/gameServer.mjs:35` and
`public/src/main.js:54` plus three test files (2026-08-14 audit P0.2); (6) 2026-08-20, G1 -- the
ground skirt's `GROUND_SKIRT_METERS = 140` was a hand-typed number that had to stay wider than
`FOG_FAR` from the walkable clamp, with the clamp in `bounds.js`, the fog in `render/sky.js`, and the
literal in `world/ground.js`. Growing the world north for the Beacon road (`ZONE.northMeters` 22 ->
44) broke it at BOTH ends -- the skirt is centred on the ground, so extending one end drags the other
end's edge inward by half the growth, and the SOUTH horizon regressed from an edit that never went
near it. The world ended on a hard line of 29.8% grass against open sky, in the shipped capture the
visual gate had already passed. Three separate comments asserted the invariant; nothing checked it.
**Hit 7, 2026-08-22:** the same defect in its purest form -- not a restated NUMBER but a restated
LAW. "Which weapon is equipped" was implemented twice: once in SQL as `ORDER BY rowid DESC` and once
in JS as highest `rev` with an eventId tiebreak. Both were defensible in isolation and they answered
differently the moment a newer choice reached the table first. A rule with two implementations is a
constant with two copies; the fix was to export the comparator from `progression/facts.js` and have
the store import it, so there is one law and the database is just where the rows live.
**Foreknowledge helped:** not yet recorded.

### GQ-008 — A harness that navigates to the game must start from a known guest.
**Status:** ENFORCED · **Hits:** 3 · **First:** 2026-08-14 · **Last:** 2026-08-20
**Enforced by:** `test/harness-fresh-guest.test.mjs`
**Rule:** The automation Chrome on 9224 uses a persistent profile, so `gq-guest-id` survives between
runs. Any harness that navigates to the game clears `localStorage` for the origin **before its first
navigation** — not after, by which point the guest has already been minted. The rule is deliberately
"every navigating harness", not "every harness that can award a mark": that judgement goes stale the
moment somebody adds an attack tap, and it is fragile in exactly the way that caused hit 2's
misdiagnosis. **Hit 3's addition: clearing is half of it. A harness that PINS a specific guest must
CONFIRM the identity it is playing as**, from the running game's own accessor, before it trusts a
single assertion — and confirm the state it seeded arrived with it.
**Incidents:** (1) Phase Y, 2026-08-14 — `play-fight.mjs` landed three reward rows on
`drive-relight.mjs`'s RESERVED fixture identity `relight-probe-guest-0001`; Phase Z1's R1-A fixed
that one file. (2) Phase R3a, 2026-08-15 — `drive-two-clients.mjs` was still doing it and nobody had
noticed: `mark:relight-probe-guest-0001:3/4/5/6` in `data/rewards.db`, in **pairs 87–220 ms apart**
because it runs two tabs and both inherited the same stale id, which then failed `drive-relight`'s own
"exactly 3 marks" assertion at marks 5 — a red harness for a reason with nothing to do with
relighting. Phase H1 turned this from occasional to reproducible: every harness now draws a server
port from one shared pool, so they all share one origin and therefore one `localStorage`, and the
isolation that used to come by accident from different ports is now something each harness must do
for itself. Six files violated the rule at `b9238e0`. (3) 2026-08-20, G1's `drive-old-beacon.mjs`.
`public/src/net/guestId.js` caps a guest id at 64 characters and, past that, `sanitizeGuestId`
returns **null silently** — so the page mints itself a fresh UUID and plays as somebody else. This
harness built its ids as `g1-old-beacon-${label}-${randomUUID()}`, which is 59 characters for
`portrait` and 60 for `landscape` and **65 for `reduced-motion`**. Exactly one phase was therefore
unseeded, every time, on two different machines: it walked the whole game with zero marks, a dark
Lantern Tree, a Chapter 2 that never opens (`campFound` is gated on the tree) and an objective chip
still reading "Talk to Keeper Aldric" forty metres up the trail. Four checks went red for a reason
none of them was about, and the harness's own error named the camp trigger. The first theory was a
timing race on the `localStorage` write, which was WRONG — the write succeeded; the client rejected
the value. Fixed by minting ids through the game's own `sanitizeGuestId` (GQ-007: import the rule,
do not hope to satisfy it), and by confirming after navigation that
`__galaQuestRuntime.guestId()` is the seeded id and that its marks actually arrived. That second
check is what turned a four-red-checks mystery into a one-line diagnosis. **Measured while fixing it,
and worth acting on before it bites again: the other harnesses that mint ids this way are correct
today but close to the cap** — `drive-cart-loot`'s longest is 61 characters and
`drive-village-board`'s is 59, against a limit of 64. A one-word longer phase label breaks either of
them the same silent way. Not enforced by a scan here because the length depends on a substituted
label a text scan cannot know; the durable fix is for each of them to mint through `sanitizeGuestId`
as `drive-old-beacon.mjs` now does.
**Foreknowledge helped:** 2026-08-20 — the entry is why the first move was "which guest is this page
playing as" rather than "why is the camp trigger broken", which is where the error message pointed.

### GQ-009 — A diagnostic that partitions events by harness timestamp measures the harness, not the system.
**Status:** ENFORCED · **Hits:** 1 · **First:** 2026-08-19 · **Last:** 2026-08-19
**Enforced by:** `test/release-classification.test.mjs`
**Rule:** When the system under test decides something from its OWN state, the instrument must
reconstruct that state, not approximate it with a wall-clock window. Anchor on the structural event
(a sampled non-zero → zero transition) and, where a second seam exists, cross-check against it — for
transport, what the socket actually carried. An instrument that can only ever report "no defect" is
not evidence; it needs a red-capable reproduction of the defect it claims to rule out.
**Incidents:** `tools/diagnostics/diagnose-movement.mjs` classified a movement release by whether the
zero-magnitude call landed before or after the harness's `upT`, and asserted in a comment that
in-window zeros "are not the release". Production decides it instead from
`magnitude === 0 && lastSentMagnitude > 0`. On a hosted runner at ~2.3 fps the release was sampled
**~500 ms before `upT` was even recorded** (`upT` is a CDP round-trip taken after the key-up
dispatch), so the real release fell inside the window the instrument dismissed. It then read the 46
later zeros — which `setIntent` refuses correctly, because exactly one release is sent per
transition — as 46 failed releases, and a release-transmission defect was reported that did not
exist. The independent `Network.webSocketFrameSent` seam showed a clean alternating
`1,0,1,0…` of 16 frames: every release had transmitted. Two replacement classifiers were also wrong
(one used the individual send as its unit, one still anchored on `upT`) and both were caught only by
that wire cross-check.
**Foreknowledge helped:** not yet recorded.

### GQ-001 — A harness tuned against a local fight embeds the absence of latency everywhere.
**Status:** RULE · **Hits:** 3 · **First:** 2026-08-13 · **Last:** 2026-08-13
**Not enforced because:** this is a harness-authoring discipline (re-sample live state, poll for a
condition instead of sleeping, pace re-taps on the real gate) rather than a static property a scanner
can verify — enforcing it mechanically would mean re-deriving intent, which is a judgment call, not a
check.
**Rule:** When a harness fails after authority moves across a wire, list every place it assumes an
answer arrives instantly — position freshness, state transitions, and input acceptance, not only
timeouts. Fix by re-sampling live state and polling for the condition, never by lengthening a wait.
**Incidents:** Phase B (2026-08-13) proved this three times in one day against the *correct* game once
the fight gained a real ~66 ms round trip: `play-fight.mjs` steered at a wolf position sampled once
and held for up to 2.5 s while the server's wolf kept moving; it waited a fixed 50 ms for a swing that
now takes ~66 ms to round-trip; and its retry loop re-tapped while the hero was still mid-swing, got
refused, and burned the iteration while the wolf's own timer ran on. Suite fell from 16/16 to 11/16.
**Foreknowledge helped:** not yet recorded.

### GQ-002 — A stale file header is a lie the file tells about itself.
**Status:** RULE · **Hits:** 7 · **First:** 2026-08-14 · **Last:** 2026-08-23
**Not enforced because:** a stale comment is prose about intent; verifying it is current requires
re-deriving what's still true, which no regex can do safely without also re-deriving the design.
**Rule:** This repo deliberately puts its reasoning in the code; an agent reading a file top-to-bottom
is supposed to trust its header. When a header's claim stops being true, rewrite it in the same commit
that makes it stop being true — don't leave the next reader to discover the gap.
**Incidents (2026-08-14 audit P2.5):** `combat/encounter.js:1-6` still described a protocol-v2 branch
reconciliation that never happened — the wire is v3 and the server already owns the state it said
would move there "when reconciled". `combat/encounter.js:68-72` argued splitting
`WOLF_BITE_COOLDOWN_SECONDS` "was not worth doing" thirteen lines above the split that had already
shipped. `net/protocol.js:1` said "GalaQuest wire protocol v1" three lines above
`PROTOCOL_VERSION = 3`, and its `EMPTY_ENCOUNTER` comment named a "Task B3" as not-yet-landed after B3
had landed. **Hit 4, 2026-08-21:** `progression/facts.js`'s `unionFacts` doc still explained how the union treats `seq` after the field had been renamed to `rev` and given a tiebreak, in the same file whose header had just been rewritten to explain why the ordering works -- so the file argued for the new design at the top and described the old one in the middle. Caught by Director audit, not by the rename. The rule earns its keep on rename commits specifically: grep the file for the old identifier before calling the rename done. **Hit 5, 2026-08-22:** `rewardStore.mjs` still
asserted "Latest INSERT wins... event ids are no longer overloaded as an ordering mechanism" nine
lines below a schema header introducing the column that had just replaced that rule. The comment was
not merely stale, it was the clearest statement of the bug, sitting directly above it. **Hit 6,
2026-08-22:** `progression/facts.js` again -- its header still argued the equip revision "has to come
from ... the device's own journal, which is the only participant present on both sides of a server
wipe", after `rev` had become action-time epoch millis minted at the choice. The prose did not merely
lag the code; it preserved the SUPERSEDED rationale, and that rationale is the one the fix disproved
-- two devices that have not spoken both start from an empty journal, so journal-derived numbering
ties exactly where it must not. A reader trusting the header would have rebuilt the defect. Second
hit in this file, and the second found by Director audit rather than by the commit that caused it.
The sharper form of the rule: when a fix REPLACES a reason, the old reason is more dangerous than an
old fact, because it still reads as an argument. Grep the file for the abandoned rationale, not just
the abandoned identifier.
**Incident (2026-08-23), and it is the costliest form of this rule:** `profileGateViewModel`'s
own JSDoc listed its heroes as `[{ id, displayName, marks, lanternUnlocked }]`. It also reads
`hero.avatar`. main.js built its hero objects to match the documented list exactly -- three named
fields plus the folded state, which has no avatar key -- so every chooser card fell through to the
id-derived fallback and the stored animal was written and never read. The caller was not careless;
it satisfied the contract as written. **A parameter a function READS and does not DOCUMENT is a
defect waiting for its first caller**, and it is worse than an out-of-date sentence because there is
nothing visibly wrong to notice.
**Partially ENFORCED as of 2026-08-23**, which is new for this entry and worth explaining given
the 'not enforced because' above. That reason still holds for the rule as a whole -- "is this prose
still true" needs a reader. But the sub-case is decidable, because both halves are in the source:
the keys a function destructures, and the names its own `@param` block mentions.
`test/documented-parameters.test.mjs` compares them. Deliberately narrow -- only exported functions
that destructure an object AND already carry an `@param` block; a function with no doc at all is a
different argument and the check takes no view on it. On the sweep that produced it: three
omissions across `public/src`, zero false positives, and all three now declared
(`villageBoardViewModel`'s `beaconLit`, `profileGateViewModel`'s `maxProfiles`, `predictionStep`'s
two bounds). None of the other three was a live defect -- every caller happened to pass them -- so
the avatar case remains the only one that actually cost anything.
**Foreknowledge helped:** not yet recorded.

### GQ-003 — A test-count or CI-shape claim written in a document goes stale immediately.
**Status:** RULE · **Hits:** 2 · **First:** 2026-08-13 · **Last:** 2026-08-14
**Not enforced because:** no test scans docs for a bare numeric test-count claim yet. The audit that
found the second hit recommends exactly that scanner as future work; it is not built in this pass.
**Rule:** Record the invariant, not the number. "CI passes one fewer than a local run, and skips one"
survives; "the true figure is 190" does not. If a number must appear, it needs to be read off a live
run at the moment of writing, not carried forward from memory.
**Incidents:** `AGENTS.md`'s own anti-stale-count paragraph said "the true figure on 2026-08-13 is
190" inside the paragraph whose entire subject was staleness; the 2026-08-14 audit measured 257 —
off by 67 (audit P2.1). Separately, `the private engineering archive:297` labelled a figure as the output of
`node --test test/*.test.mjs` (the local command) but reported CI's shape — 256 passed / 1 skipped —
instead of the local 257/257/0 the audit actually measured that day (audit P2.4).
**Foreknowledge helped:** not yet recorded.

### OBSERVED — Watch for one constant doing two jobs.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** unspecified in source (AGENTS.md gotchas
section, authored 2026-08-13)
**Rule:** Split a constant the moment it starts meaning two different things, even if both currently
want the same number. Don't wait until retuning one meaning breaks the other.
**Incidents:** `WOLF_BITE_COOLDOWN_SECONDS` meant both "how long the wolf stays in its bite" and "how
long until it can bite again." Fine while both wanted the same number; raising it to make the wolf
less relentless would have frozen the wolf in a clamped bite pose for over a second, because its bite
clip is only 1.167 s.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — Assert the property, not the mechanism.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** unspecified in source (AGENTS.md gotchas
section, authored 2026-08-13)
**Rule:** Ask what a test is really for before encoding how it currently happens to work. A test
should survive any future retuning of the mechanism it's protecting.
**Incidents:** A test named "mashing is not a win button" checked that a *cooldown* blocked the next
swing. When the cooldown went to 0 — the 1.5 s swing having become its own rate limiter — the test
failed while the property it was named for still held perfectly. Rewritten to hammer the button for
ten seconds and assert the swing count cannot exceed what the duration allows, it now survives any
future retuning.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — A name-fragment lookup needs a uniqueness test.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** unspecified in source (AGENTS.md gotchas
section, authored 2026-08-13)
**Rule:** A lookup that takes the first substring match is safe by inspection at a handful of items
and unsafe the moment a new item's name could contain another's fragment. Require an exact match, or
require the fragment to match exactly one item.
**Incidents:** `locomotion.js` and `swingClip.js` found clips with
`name.toLowerCase().includes(fragment)` and took the first match — safe at two clips, not at six. A
future clip called `idle_combat` or `sword_slash_heavy` would silently become the hero's idle or
attack depending on export order, and nothing would throw. Already enforced in practice by
`test/clip-inventory.test.mjs`, which requires every fragment the runtime looks up to match exactly
one clip; formal ledger promotion to `RULE`/`ENFORCED` awaits a second hit per the ratchet.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — Green checks are not a look at the game.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** unspecified in source (AGENTS.md gotchas
section, authored 2026-08-13)
**Rule:** A passing assertion and a photograph can describe different moments of the same run.
Captures must record the state they were taken in and fail rather than write a misleading file — and
a human should still open them.
**Incidents:** Three swing captures showed a defeated hero under a "You went down…" banner for two
consecutive runs at 13/13. The assertion and the photograph were of different moments and nothing
connected them.
**Foreknowledge helped:** 2026-08-16 — the SR3 `studioCapture` worker exited cleanly (process exit 0)
and synced a `result.json` to Drive, but `result.status` was `error` with zero captures rather than a
fabricated success; the existing discipline of separating process success from evidence truth is what
made that the correct, legible outcome instead of a silent lie. See the new runtime-identity entry
below for the incident this came from.

### OBSERVED — Source, vendor, and review names are not runtime identifiers.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-16
**Rule:** Before programmatically controlling a shipping asset, discover/read the identifiers from
the actual loaded runtime asset or Studio state and use those canonical runtime identifiers. Do not
copy Meshy action names, donor filenames, old review labels, historical commit prose, or source
filenames into automation and assume they survived import/merge/rename unchanged. If a
source-to-runtime alias is useful for provenance, record it explicitly as metadata — do not add
silent alias magic to a control protocol.
**Incidents:** 2026-08-16, SR3 external Character Studio acceptance (`the private engineering archive`).
Sol requested animation `Idle_11`, the approved/source animation name. The shipping Hero intentionally
exposes that same approved native animation under runtime name `idle`, because it was merged under the
existing locomotion lookup name (`public/src/character/locomotion.js`). `tools/sol-review/worker.mjs`'s
`studioCapture` correctly rejected the unknown runtime name before capture and returned the live clip
inventory (`availableClips`) in `result.json` instead of silently substituting a clip or guessing.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — A discovery endpoint must only advertise capabilities it can actually execute.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-16
**Rule:** When a discovery/state operation lists supported values (view scales, presets, modes, and
similar), that list is a claim about what the system can currently DO, not a plan for what it will
eventually do. Adding a value to a `supported*` vocabulary and adding the code path that actually
executes it are two different changes; landing the first without the second produces a caller-facing
lie that looks like a green check. Verify by actually exercising the advertised value end to end, not
by reading the enum.
**Incidents:** 2026-08-16, SR4 (`the private engineering archive`). Sol's own
audit of the SR4 comparison primitive found that `tools/sol-review/worker.mjs`'s `studioState`
discovery response advertised `supportedViewportPresets: ['portrait', 'landscape']` while
`bootStudioPage()` unconditionally applied `PORTRAIT_VIEWPORT` regardless of any request field --
`studioCapture` could never actually produce a landscape capture, so SR4's own explicit "gameplay
portrait AND landscape" requirement (armour-progression-doctrine.md section 5.1) was unmet despite the
discovery endpoint claiming otherwise. Fixed by threading an allow-listed `viewportPreset` field
through to the real `Emulation.setDeviceMetricsOverride` call, then proving both presets are reachable
with four real captures (shipping/candidate x portrait/landscape) that were opened and looked at.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — A cross-check whose expected and actual values come from the same expression proves nothing.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-16
**Rule:** A test that claims to verify two independently-derived values agree must actually compute
them two different ways. `assert.equal(x.field, x.field)` — or any variant where the "expected" side
is read from the same object/call as the "actual" side — is syntactically a comparison and
semantically a no-op: it passes whether the code under test is correct, broken, or entirely deleted.
When writing a "matches the same authority" test, name the two independent code paths in the test
itself and confirm the assertion can fail — sabotage it once by hand (change one input) before trusting
it.
**Incidents:** 2026-08-16, SR4 (`test/pose-anatomy.test.mjs`). A test named "jsonReport time mode
measurement matches measure() called directly at the same pose" asserted
`report.clips.idle.measurement.pelvisTilt === report.clips.idle.measurement.pelvisTilt` — both sides
read from the exact same object, so the assertion could not fail regardless of whether `jsonReport`'s
time-mode path was correct. The suite was green throughout; Sol's audit caught it by reading the test
body, not by a failing run. Fixed by deriving the expected value through a genuinely separate call
chain (`poseAt` -> `forward` -> `measure`, called directly, not through `jsonReport`) and comparing the
full measurement object, plus a new sabotage test confirming the cross-check can actually distinguish
two different poses.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — A selftest must tear down every Chrome target/server/process it creates, unconditionally.
**Status:** OBSERVED · **Hits:** 3 · **First/Last:** 2026-08-16
**Rule:** A local-only selftest that boots an owned server and opens a Chrome target must guarantee
teardown of both, even on an exception or an early return — `try`/`finally`, not a happy-path
`close()` call at the bottom of the function. A leftover target/server from one selftest run silently
becomes a false "chrome busy" positive on the next one, and the fix is never to kill/restart resources
that might belong to another session — verify a leftover is genuinely this session's own artifact
(e.g. by checking which process is actually bound to the port) before closing anything. This does not
authorize killing or restarting resources belonging to another session; the "do not kill/restart
shared Chrome" rule (owner-plan.md section 10) still applies to everything except a selftest's own
already-identified leftovers. Second incident's refinement: calling an unconditional cleanup function
is not the same as the cleanup having actually succeeded — `owned-server.mjs`'s `kill()` gives up
silently after a bounded timeout without escalating, and `worker.mjs`'s `closeStudioPage()` awaits it
without checking the result, so code that already satisfies the "always call cleanup" half of this
rule can still leak. Confirm teardown by an independent check (a fresh port probe / CDP target list),
not by having awaited the cleanup call.
**Incidents:** 2026-08-16, SR4 closeout (`tools/sol-review/worker.mjs`'s selftest discipline,
`the private engineering archive`). Between two selftest rounds in the same
session, an owned `server.mjs 5202` process and its Chrome tab from an earlier round had not fully torn
down (the `server.kill?.()` call in `closeStudioPage()` did not guarantee the underlying process had
actually exited), and the stale tab's URL matched the chrome-busy regex on the next run, producing a
`blocked-chrome-busy` result on a request that should have succeeded. Diagnosed by checking
`netstat`/`tasklist` for the actual PID bound to the port (confirming it was this session's own
leftover, not another session), then closed via the same `Target.closeTarget` CDP call and process kill
the harness itself already uses for its own cleanup — not a bypass of the "don't touch shared Chrome"
rule.
2026-08-16, SR5 selftest (`tools/sol-review/worker-selftest.mjs`'s local-only verification round, same
CSB phase). Despite `closeStudioPage()` already being called unconditionally (the fix the first
incident above produced), the owned `server.mjs` process outlived multiple selftest rounds at least
twice more — confirmed live via an actual `HTTP 200` response on its port minutes after the run that
started it had already printed a successful result and exited. Root cause identified as
`owned-server.mjs`'s `kill()`: it races `child.kill()` against a 5-second timeout and resolves `false`
on timeout without ever escalating (e.g. a force-kill), and `closeStudioPage()` discards that boolean.
Initially routed around locally rather than fixed, since `owned-server.mjs` is shared infrastructure
outside SR5's own narrow scope (CLAUDE.md rule 3) — flagged as a standalone follow-up task instead.
2026-08-16, SR5 closeout pass (Sol's own direct instruction, same session: "fix the owned-server
teardown leak now as the separate follow-up already identified"). `kill()` rewritten to escalate with a
stronger kill signal against ONLY its own child PID if the graceful attempt times out, and to never
resolve `true` until independently re-verified. That verification exposed a SECOND, deeper, unrelated
bug in the same file: `portFree()` probed `'127.0.0.1'`, while `server.mjs` itself binds `'0.0.0.0'`
(`server.listen(port, '0.0.0.0', ...)`). On Windows, binding a specific address does not conflict at
bind time with an EXISTING wildcard listener on the same port, so the probe fired `'listening'` (port
reported "free") even while a real `server.mjs` was up and answering real HTTP 200s on it — confirmed
directly and reproducibly: the exact same probe code returned `true` against `'127.0.0.1'` and correctly
`EADDRINUSE`/`false` against `'0.0.0.0'` for the identical busy port. This means the ORIGINAL
`startOwnedServer()` candidate-port scan itself could have silently double-allocated a port under the
right timing, not just the new `kill()` verification — a wider-reaching defect than the one being fixed.
Both fixed together (`portFree()` now probes `'0.0.0.0'`); proven with 3 new tests in
`test/owned-server.test.mjs` against REAL spawned server processes (mocking `child_process` would not
have caught either bug, since both were genuine OS-level binding/timing behavior).
**Foreknowledge helped:** not yet recorded.

### OBSERVED — A reported per-pose measurement that never changes across genuinely different poses is measuring the wrong state.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-16
**Rule:** three.js's `Box3.expandByObject()` on a `SkinnedMesh` reads the geometry's BIND-POSE vertex
positions transformed by the mesh's own `matrixWorld` — skinning is applied on the GPU in the vertex
shader, not through `matrixWorld`, so the resulting box is the same regardless of which animation
frame is actually posed. Any measurement meant to vary with pose (a bounding envelope, a silhouette,
anything sampled across a clip sweep) must be sanity-checked the same way a cross-check test is:
compute it at two genuinely different poses and confirm the numbers actually differ before trusting
the code, not just before trusting a test of the code. A flat, unchanging report across obviously
different inputs is itself the finding, even when nothing throws and the status says "ok".
**Incidents:** 2026-08-16, SR5 (`public/src/character/gearInspectors.js`'s `computeBodyOccupancyBox`,
`the private engineering archive`). The Fit Envelope's Body Occupancy
Envelope reported byte-identical `min`/`max` boxes across every sampled frame of `idle`, a walk clip,
a run clip, and an attack clip in a live `studioFitEnvelope` selftest — an impossible result for a
walking/running/attacking pose sweep. Caught by manually eyeballing the returned numbers rather than
trusting the request's `"status": "ok"`. Fixed by building the box from the skeleton's own bone WORLD
positions (which genuinely update from the `AnimationMixer` every frame) instead of
`Box3.expandByObject()` on the body mesh; re-verified with a live re-run showing height/width now
varying per clip and per frame, plus a new regression test
(`test/gear-inspectors.test.mjs`'s "sabotage: computeBodyOccupancyBox is not a constant") pinning the
fix against the exact same failure mode reappearing silently.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — A hand-rolled schema interpreter only enforces the keywords it has actually been exercised against.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-16
**Rule:** `tools/sol-review/protocol.mjs`'s `validate()` is a small, deliberately-partial JSON Schema
interpreter (its own header names exactly which keywords it implements). Adding a NEW keyword to the
schema JSON (`request.schema.json`) does nothing on its own — if `validate()` has no matching branch,
the field is silently unconstrained, and a request the schema author intended to reject sails through.
This is invisible in code review of the schema file alone: the JSON reads correctly; only exercising
the interpreter against a request that should fail catches it. Any new schema keyword introduced by a
future phase (`maximum`, `type: boolean` were the first two to ever appear in this schema) needs both
the schema JSON updated AND a corresponding `validate()` branch, proven by a test that constructs an
invalid value and asserts it is actually rejected — not just a test that a valid value passes.
**Incidents:** 2026-08-16, SR5 (`tools/sol-review/protocol.mjs`, `test/sol-review-protocol.test.mjs`).
Adding `studioFitEnvelope`'s optional `samples` field (`"type": "integer", "maximum": 60`) and
`studioCapture`'s optional `includeMeasurements` field (`"type": "boolean"`) to
`sol-review/request.schema.json` exposed that `validate()` never checked `schema.maximum` for
`integer`/`number` types (only `minimum`), and had no branch at all for `schema.type === 'boolean'`
(a boolean-typed field fell through every `else if` as a silent no-op). `samples: 61` and
`includeMeasurements: "yes"` both validated cleanly before the fix. Caught by a new test asserting the
over-limit/wrong-type values are rejected, which failed against the THEN-current interpreter rather
than the schema. Fixed by adding `maximum` checks alongside the existing `minimum` ones and a
`type === 'boolean'` branch, plus two interpreter-level regression tests
(`test/sol-review-protocol.test.mjs`'s two "regression:" tests) pinning both keywords independently of
any one schema's use of them.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — A documented claim about a commit is not evidence until it's run.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-14
**Rule:** A plan step that cancels itself by citing another commit's contents must show the command
that checked those contents. An assertion about a commit is a claim, not a fact, until `git show` or
`git log -S` backs it.
**Incidents (2026-08-14 audit P2.2):** `the private engineering archive`
Task A1 Step 3 read "VOID — superseded. Opus's `6eeb3bd` already removed the stale AGENTS.md count."
`git show 6eeb3bd -- AGENTS.md` has no matching hunk; that commit added the gotchas section, not
removed a count. The count was still there. A task was cancelled on a claim about another commit that
nobody checked — and the cancelled task was the one that would have fixed it. Named in the audit as
its sharpest single item.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — A proof that was not committed did not happen.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-14
**Rule:** A phase does not close until a committed harness drives the whole path end to end in the
running game and passes. A throwaway probe run once from a scratch script is a memory, not evidence,
and cannot be re-run to check it still holds.
**Incidents (2026-08-14 audit P0.3):** combat sounds, the 10 s wolf respawn, and the online→offline
handover fix all shipped 2026-08-13 with unit tests but no committed browser proof. The audio proof
specifically existed only as "probed live (CDP…, throwaway harness, not committed)" per
`the private engineering archive` — a proof that cannot be re-run.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — A durable event id must outlive the process that minted it.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-17
**Rule:** A process-local counter is not a durable idempotency key. Any event that can be written after
restart needs an identifier whose uniqueness survives restart; and any ignored durable write must be
checked rather than treated as success. State ordering belongs in the store (`rowid`/an explicit
sequence), not in the lexical shape of an idempotency key.
**Incidents:** GP1 equipment used `equip:<guest>:<process-local counter>`. After every server restart
the counter returned to one, `INSERT OR IGNORE` discarded the new choice as a duplicate, and the
server ignored `applied: false`, so the previous weapon remained equipped while the client was told
the new request succeeded. Fixed by UUID-backed event ids, checking the durable write result, reading
the latest equip by insertion order, and restart → equip again → restart coverage in
`test/game-server.test.mjs` and `test/reward-store.test.mjs`.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — Hydration restores state; it must not replay the ceremony that created it.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-17
**Rule:** A presenter constructed from a persisted snapshot starts in the visual state represented by
that snapshot. Transitional animation states are for live edges only. If a persisted object is
already consumed, collected, built, opened, or completed, hydration must begin at its terminal state
without replaying particles, rewards, sounds, or other one-shot ceremony.
**Incidents:** Every cart-loot presenter began in `bursting` even when the initial server snapshot
already named `collectedBy`. A restart or late join therefore replayed all consumed reward objects for
about a second before hiding them. Fixed by passing the initial collection state into construction and
starting collected pickups at `gone`; pinned by `test/loot-pickups.test.mjs`.
**Foreknowledge helped:** not yet recorded.

### GQ-019 — Automation timeouts are wall-clock budgets, not sample counts — and the fix for that has its own floor.
**Status:** RULE · **Hits:** 2 · **First:** 2026-08-17 · **Last:** 2026-08-23
**Not enforced because:** the defect is a budget being too small for a machine nobody has measured,
and no test can know what machine the next one is. `test/automation-timing.test.mjs` pins the helper;
what it cannot pin is a caller's choice of number. The countermeasure is the successor entry below --
stop spending the budget on reads at all.
**Rule:** A browser driver that promises "try for N milliseconds" must compare against a monotonic
wall-clock deadline. Never convert milliseconds into a fixed number of CDP reads: each read can take
hundreds of milliseconds under hosted 3D load.
**Hit 2's correction, and it is a correction to this entry's own remedy.** The original said "release
movement input before every slow observation, so instrumentation latency cannot become unobserved
travel." That is right about the hazard and, below roughly 5 fps, wrong about the cure: releasing per
read makes the duty cycle the read rate, and the walk then never arrives at all. Measured 2026-08-23,
`drive-relight`: the pulse/release/read walk spent **7217 ms of a 10000 ms budget** locally to cross
6.44 m -- 3120 ms of it the per-iteration settle sleep, only 129 ms actual CDP -- finishing with 28%
to spare on a machine where round trips are effectively free. Hosted, at a measured mean frame of
**367 ms**, the same loop covered 3.1 m and stopped 3.3 m short. Release-per-read is correct only
while a read is cheap relative to a frame. When it is not, the stop condition has to move into the
page instead, which is what the successor entry is about.
**Incidents:** (1) 2026-08-17 -- several full-matrix harnesses used names such as `maxSamples`/
`maxSteps` as if one CDP state read cost one millisecond, while keeping movement held during each
read; nominal ten-second walks expanded into multi-minute overshoots. Fixed by
`tools/runtime-test/automation-timing.mjs`, wall-clock deadlines, pulse/release/read movement, and
structural coverage in `test/automation-timing.test.mjs` and `test/review-suite.test.mjs`.
(2) 2026-08-23 -- eight harnesses red hosted and green locally, every one of them a budget sized on
a machine where a `Runtime.evaluate` costs 5 ms against one where it costs a frame.
**Foreknowledge helped:** not yet recorded.

### RULE (GQ-022) — An instrument is not evidence until it has been shown to fail.
**Status:** RULE · **Hits:** 4 · **First/Last:** 2026-08-23
**Rule:** A probe that has only ever been seen passing, or only ever seen returning *something*, has
not been tested -- it has been run. Before believing a reading, make it produce the wrong answer on
purpose: point it at the broken state, or remove the fix and watch the test go red. A field that
comes back `null` is the loudest version of this and the easiest to read past, because `null` looks
like an answer.
**Not enforced because:** no test can tell a real measurement from a vacuous one; the check is
whether somebody made it fail. What IS mechanisable is already in place -- red-capability exercises
next to the new tests, and `test/harness-verdict-semantics.test.mjs` for the verdict shapes.

**Four hits in one day, which is why this is a RULE at first writing rather than an OBSERVED.**

1. **A probe read the wrong object.** A per-frame pip trace in `drive-marks` recorded
   `marks=null rewardKeys=` on every frame -- it read `encounterState().rewards`, which is not where
   the pips are painted from. The `pips=1` half was real; the `marks` half never existed. Caught only
   because the raw key list was printed beside the value.
2. **A scripted edit whose anchor never matched.** A `str.replace` with no assertion silently did not
   apply, and the probe then reported `lantern undefined` FAIL for something it had never measured.
3. **A helper that never reached the branch it existed to test.**
   `createProfileStore({ randomUUID: null })` does not disable crypto -- `options.randomUUID ?? …`
   falls through on null -- so the no-crypto test took the UUID path and **passed against the unfixed
   code**. Found by the red-capability check, which is the only thing that could have found it.
4. **A test baseline where two subjects were identical.** Two tabs both minted `p-local-1-1`, because
   a short injected UUID fails the id sanitizer and the fallback derives from `profiles.length`. One
   assertion passed vacuously comparing an id to itself. Earlier the same day: two animation clips
   written to the same value, so three of eight new tests passed without exercising anything.

**What they have in common** is not carelessness about the subject -- each of these was written
carefully, about a real question. It is that the INSTRUMENT was assumed to work because it ran. The
subject gets scepticism and the tool gets trust, and it is the wrong way round: the subject is the
thing you already suspect, and the tool is the thing you are about to believe.

### OBSERVED — A NEW FAILURE against a base is not evidence that this commit caused it.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-23
**Rule:** `ci-diff.py` answers "what is red here that was green there". That is not the same question
as "what did I break", and the gap between them is every harness that flips on its own. Before
reverting or chasing a NEW FAILURE, look at how that check has concluded over the last dozen heads.
A check that flaps is not evidence about a commit, however clean the diff looks.

**The hit.** I shipped a fix for a proven data-loss bug -- two tabs of the game on one device
silently delete each other's child, demonstrated by unit test -- and `drive-marks` and `drive-touch`
went red on it, both green on the commit before. "The only difference is mine", so I reverted it.
`drive-marks` then went red **on the revert as well**:

    $ git diff --quiet 2d0f6b1 07c9905 && echo IDENTICAL
    IDENTICAL

Byte-identical trees, green at one head and red at the other. Both failures were flakes. The fix was
innocent and I had thrown it away.

**What makes this worse than bad luck.** I had built a table of exactly which harnesses flap and
posted it to the PR forty minutes earlier, to make the rotating cast visible. `drive-touch` is in it,
flapping at `6235d80`. I did not look at the table I had just written. The instrument existed, in my
own hand, and the failure was not consulting it.

**Enforced as far as it can be.** `ci-diff.py --sha` now prints each new failure's record over the
last twelve heads (`.X.........X  (3 flips)`), so the diff carries the history instead of asking the
reader to remember it. Measured honestly: run against the diff that fooled me it flags `drive-touch`
at three flips, and does **not** flag `drive-marks`, whose previous flap is outside any window --
that one was only provable by the identical-tree contradiction after the fact. The tool moves this
from "remember the table" to "read the line", and catches one of the two. It is not a cure.

**The corollary that cost the most.** Reverting is cheap and safe *as an action*, which is exactly
why the bar for it drifts. It is not cheap as a decision: it threw away a proven fix for a real
defect on evidence that took four minutes to falsify afterwards. "Revert first, diagnose later" is
right when the head is red and the cause is plausible; it needs the same "is this check trustworthy"
question as any other claim.

### RULE (GQ-021) — A harness written in wall-clock time is driving something that advances in rendered frames.
**Status:** RULE · **Hits:** 5 · **First/Last:** 2026-08-23
**Not enforced because:** no test can look at a number and tell whether it was reasoned about in
milliseconds or in frames -- the mistake lives in the reasoning, not in the syntax. The one half that
IS mechanisable is enforced: `test/net-client.test.mjs` asserts the same snapshots put the hero in
the same place whatever the frame rate, which is the product-side statement of this rule.
**Rule:** On a browser with no GPU the page paints at 2-4 fps and a `Runtime.evaluate` waits on the
main thread, so a CDP read costs a FRAME, not a millisecond. Three consequences follow, and they are
one mistake wearing three hats: a loop budgeted in milliseconds gets a fraction of its iterations; a
short-lived state can live and die between two reads; and a read taken after an act can land before
the frame that applies it, or after the state has moved on again. **Enlarging the timeout re-decides
the same number against the next machine.** Move the frame-rate-sensitive half into the page instead:
record the value once per rendered frame and read the log, so observation costs nothing and cannot
be too slow, and decide arrival in-page so input can be held rather than pulsed. Polling a RECORDER
is safe at any rate; polling LIVE STATE is not.
**Fourth hit, and the one that shows the rule reaches past harnesses into DERIVATIONS.**
`play-fight`'s settle check gives the rendered hero 6s to converge onto the authoritative one, and
its comment derives that number properly rather than picking it: `reconcile()` closes 10% of the
error per snapshot, snapshots are 10Hz, the worst legal start is `SNAP_DRIFT_UNITS` (0.6m), so 29
snapshots is about 2.8s and 6s is that with room. Every step of that is right except the clock.
`reconcile()` is applied in the FRAME LOOP, so the achieved rate is min(snapshot rate, frame rate),
and the frame rate is the term that varies twenty-fold.

Measured on a starved run: `0.623m -> 0.051m over 6257ms` -- 24 corrections at 3.8 per second, not
10. It needed 29, had room for 24, and reported NEVER CONVERGED at 5.1cm against a 3cm bar, on a run
where the hero converged perfectly well. Two of four consecutive hosted heads went red on it while
the game code was byte-identical across all four.

**What is new here:** the previous three hits were harness loops written in milliseconds by habit.
This one was a budget DERIVED from real constants, in a comment that shows its working, and it was
still wrong -- because the derivation named the snapshot rate as the limiting term when the limiting
term is whichever of two rates is slower. A derivation is only as good as its slowest assumption, and
"how often does this actually get applied" is the question to ask of any rate, not "how often is it
offered". Fixed by budgeting in corrections -- `min(rendered frames, elapsed / snapshot interval)` --
which is what the derivation was always about. 3 of 3 local runs green afterwards, where it had been
2 of 3.

**Fifth hit, and the first one in the GAME rather than in an instrument -- found by reading my own
fourth entry back.** The paragraph above contains the sentence "`reconcile()` is applied in the FRAME
LOOP, so the achieved rate is min(snapshot rate, frame rate)". I wrote that as a fact about the
machine and used it to calibrate an instrument around. It is a bug report about the game, and I did
not read it as one.

`net/client.js` gates reconciliation on a BOOLEAN `hasNewSnapshot`. The flag was added for a real
reason and fixed a real bug -- at 60 fps, six frame-rate calls would otherwise take six bites out of
one snapshot's drift. But a boolean can only ever say "at least one snapshot arrived", so it fixed
the fast half and left the slow half wrong: below 10 fps the snapshots keep coming and all but one
per frame are discarded. `NUDGE_FRACTION`'s own comment promises "under a centimetre in about three
seconds" at 10 Hz. Measured in a real browser at 40x CPU throttle (~3 fps), the drawn hero closed
0.26m in **10.5 seconds and had not arrived**:

    t=73744 d=1.26 sd=1.26      rendered and authoritative agree
    t=74151 d=1.28 sd=1.54      authority jumps; the correction begins
    t=84250 d=1.49 sd=1.54      ten seconds later, still 5cm out

What that is, to the child this game is for, is their own hero sliding sideways on his own for ten
seconds after they let go of the stick -- on the cheap tablet that is the target device, not on some
pathological runner. And every proximity trigger in the world (the Keeper's greeting wave, his speech
bubble, the quest marker) is decided from the DRAWN hero, so the village reacts ten seconds late too.
It is the direct cause of `drive-village`'s keeper-talk failure hosted: the hero the harness parked
1.34m from the Keeper kept creeping outward past the 2.0m speech radius while the check waited.

Fixed by consuming the whole backlog and compounding the same fraction over it: `1-(1-f)^n` IS n
separate f-sized bites, exactly, so nothing is retuned and at any frame rate at or above the snapshot
rate every number is unchanged.

**What is new here:** the previous four hits were all instruments. This one was the SUBJECT, and it
was visible in my own notes for hours before I looked at it. Diagnosing a measurement problem
correctly and then budgeting around it is a way of writing the bug down and walking past it. When the
explanation for a flaky instrument is a property of the product, that property is the finding.

**Corollaries, each of which cost a round on 2026-08-23:**
- **A log is a history.** "Wait until the hero is back up" was satisfied by a frame from before he
  ever went down. A recorder needs a `since` index or it answers with the past.
- **A live read can INVENT a failure, not just miss one.** The rule above says polling live state is
  unsafe because a short-lived state can slip between two reads. The sharper form, measured in
  `drive-two-clients` on 2026-08-23: a read that lands BETWEEN two rendered frames sees a state no
  player is ever shown, and it can be arbitrarily worse than any drawn one. Snapshots arrive on the
  socket and move `serverSelf` at once; the drawn hero is pulled toward it by `reconcile()`, which
  runs in the frame loop. So between frames the two are a whole snapshot of travel apart *by
  construction*. One walk, both numbers from the same run: worst drawn-to-authority gap over 12
  rendered frames **0.200m**, and the single between-frames sample the check actually judged
  **1.414m** -- seven times worse, and red, against a 0.3m bar. The check had been failing for a
  dozen heads and was on the Director's open list as an unexplained product concern. It was an
  instrument reading a state that does not exist for the player.
- **A backgrounded tab has not painted, whatever the clock says.** rAF only advances for the
  foregrounded tab, so `bringToFront` plus a sleep is not enough to make one readable; two rendered
  frames is. Half a second there bought one frame or none.
- **Two things read sequentially cannot be compared.** Two tabs' wolf health "disagreed" — and the
  direction of the disagreement FLIPPED between environments (A=2 B=1 locally, A=1 B=2 hosted), which
  is the tell: a real desync has a direction. Bracket the second read between two of the first.
- **A slack constant between two phases is a number picked against one machine.** A walk that holds
  for distance then pulses to place itself needs no such number if it simply loops until it arrives.
- **CONSEQUENCE 2 IS NOT A HYPOTHESIS ANY MORE.** Hit 3. `in-page-driver.mjs`'s header listed "an
  input pulse can span no rendered frame at all" as the thing
  `tools/diagnostics/diagnose-movement.mjs` was written to discriminate. It is now a measured cause:
  `movementPulseMillis` is floored at 70ms and capped at **300ms**, one hosted frame is 300-400ms,
  and the pulse shrinks as the hero nears his target — so the closer he got the less he moved, and
  below one frame he stopped entirely. drive-village-board's Workshop approach ended **2.43m from a
  2.4m radius**: not slow, INERT, and inert in a way that looks exactly like slow. The remedy needs
  no constant — wait on the pulse OR one rendered frame, whichever is longer
  (`Promise.all([sleep(pulse), afterAFrame()])`), so the fast machine keeps its measured pulse and
  the slow one gets a press that spans a frame.
- **The observation can be SLOWER THAN THE STATE, and then no aim taken during it can work.** Hit 2.
  A `Runtime.evaluate` costs one frame; a `Page.captureScreenshot` on a software rasterizer costs
  eight — measured 1628–2627 ms, against a knockdown that lasts `RESPAWN_SECONDS`, which is 2. Two
  things follow and both were got wrong first. **You cannot bracket it:** a read either side of the
  shutter always straddles the end of the window, so the check can only ever go red, and a one-sided
  version that stays silent reads as green. Caption the artifact with the interval it was taken
  across and let the RECORDING carry the assertion. **And you must lead the target:** the pixels come
  from the END of the shutter, not the beginning — established by firing at `downSeconds` 1.1 with the
  shutter open 2200 ms and getting a hero already back on his feet. Fire early by the measured
  latency, `max(0, wanted − shutter)`, and measure it on a capture the run was taking anyway.
**Incidents (2026-08-23, one session):** `play-fight` swung every 7.5 s against a rule allowing one
every 1.5 s, so with Design ruling 5 healing the wolf on each knockdown it reported a fight
unwinnable that is won in three swings; `drive-marks` 10/21 with 13 knockdowns; `drive-lifecycle`
timed a 10 s respawn at 0.26 s because the stopwatch started when a poll NOTICED the corpse;
`play-fight` read `wolf on 3hp of 3` after a fight the recorder proves it lost, because the wolf had
respawned before the read; `tapping ATTACK starts a swing` failed while the very next check passed
against the SAME tap. Matrix went 12 red to 7, with the remaining chaseable two being genuine
environment limits rather than bugs. Shared primitives in
`tools/runtime-test/in-page-driver.mjs`; the hosted frame rate and the refutation of the competing
"input never reaches authority" hypothesis are in that file's header, measured by
`.github/workflows/movement-diagnostic-probe.yml`.
**The general form, worth stating separately because the three hats hide it:** when an instrument and
the thing it measures keep different clocks, every number the instrument carries is a claim about
the ratio between them. Write the number in the units the SUBJECT advances in, or move the decision
to where those units are counted.
**Foreknowledge helped:** not yet recorded.

### GQ-020 — A presentational class is an identity. Reusing it for the look makes every reader that queries it wrong.
**Status:** RULE · **Hits:** 2 · **First:** earlier · **Last:** 2026-08-23
**Not enforced because:** the offence is a class on the wrong element, and only the reader's INTENT
says which elements belong. `.profile-card-face` on a row that is not a card is indistinguishable,
to any scanner, from `.profile-card-face` on a card -- the wrongness is entirely in what the queries
elsewhere mean by it. A rule about naming, checkable only by whether the queries still answer right,
which is what those queries' own tests are for.
**Rule:** When something must LOOK like a member of a set without BEING one, give it its own class
and repeat the CSS. The shared class is not styling, it is the answer to "how many of these are
there" for every `querySelectorAll` in the codebase and every harness reading the DOM. Copying six
lines of CSS is the cost of that separation and it is always cheaper than the alternative, which is
a count that is quietly wrong in a place nobody is looking at.
**Incidents:** (1) The chooser's "New hero" row was first built as a `.profile-card`, because it
looks like one. The browser harness immediately read three heroes on a two-hero device. Fixed by
giving it `.profile-card-add`, with a comment in `progression/profileGate.js` saying exactly why --
"shared look, separate identity". (2) 2026-08-23, and this is the interesting one: giving that same
row an animal face, I reached for `.profile-card-face`. **Three lines below a comment explaining why
the row does not share `.profile-card`, for the identical reason.** One run later, `every card shows
the animal that profile actually has stored` read three faces on a two-hero device and reported
"New hero, the Owl" as a stored animal. The lesson was written down, in the right file, at the right
place, by someone who had just been bitten -- and it was scoped to the class it had been bitten on
rather than to the kind of class it was.
**The general form:** a warning about one identifier teaches the identifier. Write it about the
KIND, or the next member of that kind walks straight into it.
**Foreknowledge helped:** no -- worse than no. The comment was three lines away and was read.

### OBSERVED — The maximum of a set is biased toward the set with more samples in it.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-23
**Rule:** A peak is an extreme value, and how extreme a value you find depends on how many draws you
took. Comparing `max(A)` against `max(B)` when A has four samples and B has fifty-six is not
comparing A against B -- it is comparing four draws against fifty-six draws, and the larger set wins
part of the margin for free. **Before comparing extremes of two sets, compare their sizes.** Either
sample them comparably, use a statistic that is not an extreme (a median, an integral), or say the
comparison cannot be made and report why.
**Incident (2026-08-23):** the third formulation of `the sword arm actually moves` compared the peak
hand speed while swinging against the peak while at rest. Locally 18 swinging frames against 66 at
rest gave 4.5x and passed. Hosted at `3f2d45a`, where the frame period is 189ms, the same check drew
**4 swinging frames against 56 at rest** and read **3.0x against a 3x bar** -- failing on the
rounding. The swing's real peak falls between frames at that spacing while rest gets fourteen times
as many chances at its own, so the number that went red was mostly the sample-count ratio.
**What it became, and the more useful half:** not a fourth formulation. The previous commit had
already written down that a fourth hosted failure would make this `diagnostic()` rather than another
revision, so it did -- gated on a MEASURED property of the run, that the swing was sampled at least
four times per swing. Where it is not, the honest verdict is that this runner cannot separate a
swing from breathing. **Deciding what a future red will mean, before seeing it, is what stops the
third revision becoming a fourth**; without that written down first, the pull toward one more tweak
until the bar is cleared is very strong, and every tweak is a threshold fitted to one machine.
**Sibling entries:** this is the same CHECK as the frame-of-reference entry below, failing a third
time for a third unrelated reason -- contaminated baseline, wrong frame, biased estimator. A check
worth having can be wrong in more ways than one, and each of them only showed on a machine other
than the one it was written on.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — A measurement has to be taken in a frame where only the thing under test can move it.
**Status:** OBSERVED · **Hits:** 2 · **First/Last:** 2026-08-23
**Rule:** A comparison against a baseline needs the baseline to be a state the subject was actually
IN, not the complement of the state under test. Those two are the same set only when the sampling is
fine enough that transitions cost nothing. At 5 samples per event they are not: every boundary frame
carries part of the event into the baseline it is being measured against, and the contamination
scales with the frame period -- so the test is tightest exactly where the machine is fastest and
worthless where it is slowest. Take the baseline from a stretch where the subject is unambiguously
at rest, before the first event, and say in the code why that stretch and not the complement.
**Incident (2026-08-23):** a new check comparing how far the hero's sword hand travels while
swinging against how far it travels while not, to prove the swing animation is not a frozen pose.
Locally: 1.32m against 0.18m, 7.2x, comfortable. Hosted at a 317ms frame: **0.38m against 0.54m,
0.7x** -- it reported that a moving arm moves less than a still one, and went red. Three swings
sampled five times each leave a handful of return-to-rest frames in "not swinging", and those few
frames carried most of an arc. Fixed by taking rest from the frames before the first tap.
**Hit 2 (2026-08-23, the SAME CHECK, a different contamination, and this is what promotes the
entry).** With the baseline fixed the check failed hosted again at **0.8x**, and the reason was the
other half of the same mistake: the hand was read in WORLD coordinates. A hand in world space moves
when the arm moves, when the hero walks, and when the hero TURNS — and only the first is a swing.
The guard I had written caught the walk (root travel 0.000m) and was blind to the turn, which is the
one that happened: `photographTheSwing` calls `orbitToFront`, the hero comes round to face the
camera, and his hand sweeps half a metre through the world with his arm doing nothing. 0.54m of that
went into the baseline the swing's own 0.45m was measured against.
**The general form, which covers both hits:** pick the frame of reference before picking the
threshold. Expressed in the hero's LOCAL frame — the world offset projected onto his root's own
basis vectors — the number cannot be moved by his position or his facing, so there is nothing left
in it but the arm, and the guard against walking becomes unnecessary rather than insufficient. Rest
fell to 0.19m of breathing against 1.25m of swing. **Every guard you have to add is a hint that the
quantity is measured in the wrong frame**; the right frame needs no guards.
**Why it is worth an entry rather than a shrug:** this check was written the same morning, expressly
to catch a defect that only appears on slow devices, and was sabotage-tested and confirmed
red-capable. It still went in twice with a measurement that dissolves on a slow device. **Proving an
instrument can see its failure case does not prove it is measuring the right two things.** The
sabotage answered "would this notice a frozen arm" and never asked "is `!swinging` the same as
`still`", nor "does anything but the arm move this number".
**Foreknowledge helped:** not yet recorded.

### OBSERVED — Making one beat of a harness work can break the next one, because they share a world.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-23
**Rule:** A scripted playthrough is a sequence of beats against ONE living world, so every beat
inherits whatever the last one left behind — an alive or dead enemy, a hero's position, a spent
cooldown. Fix a beat that was failing and you have changed that inheritance, and the next beat can
fail for a reason that did not exist before and has nothing to do with your change. **A beat should
ARRANGE its own preconditions rather than inherit them, and say so in a check**, so the failure
names the missing precondition instead of blaming the thing being tested.
**Incident (2026-08-23):** `play-fight`'s landscape hit beat could not reach the wolf, so all thirty
of its taps missed. Fixed by re-closing on the wolf whenever the recorder said the hero was out of
reach — and the beat immediately became effective enough to KILL the wolf, because it read the
recorder only every fourth tap and four taps of overshoot is three more swings into a three-hit-point
animal. The knockdown beat after it then stood waiting to be bitten by a corpse. Same red, different
number: `0 down frame(s) of 126` became `0 down frame(s) of 185`. Both were the knockdown beat
reporting that the hero could not be knocked out, and on neither run was that the question.
**The tell:** a check whose evidence is a large count of frames in which NOTHING happened is almost
never about the thing it is named after. 126 frames at full health is not a hero who resists being
knocked down, it is a hero nothing is attacking.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — A sentinel that means "no value" will happily do arithmetic, and can carry a check over its own bar.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-23
**Rule:** `-1` for "not swinging", `null` for "not measured", `0` for "never arrived" — every codebase
has them, and they are fine until one reaches a comparison. Then the check does not merely tolerate
the missing reading, **the missing reading is what makes it pass**, and the check is now most
reliable exactly when its evidence is worst. Two questions catch it: does my sentinel survive into
the arithmetic, and if a reading were MISSING would that push this number toward the bar or away
from it? Filter to the readings that exist, require the count you meant, and bound the result on
both sides — a spread wider than the thing it spans is as wrong as one narrower.
**Incident (2026-08-23):** `play-fight`'s `the three frames are spread across the swing rather than
three copies of one instant` measured `max - min` of three `swingSeconds` against a bar of
`SWING_SECONDS * 0.3`. A frame that caught no swing carries `-1`, and `0.911 - (-1.000)` is `1.911`
— so hosted it reported `spread 1.911s of 1.5s`, **a spread wider than the swing it was measuring**,
on the very run where a third of its evidence was missing. It sat one line below the check that had
just gone red for that same missing frame, and passed. Fixed by computing over the frames that
caught a swing, requiring all three, and adding the upper bound that would have made the impossible
number impossible to report.
**The tell, worth naming:** the number was NOT PHYSICALLY POSSIBLE and nobody read it. A spread
cannot exceed the interval it lies in, a fraction cannot exceed one, a distance cannot be negative.
An evidence string is not decoration — it is where an unfalsifiable check announces itself, and this
one had been announcing itself in every hosted log it appeared in.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — A clamp that protects one subsystem silently degrades every other one sharing the clock.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-23
**Rule:** `main.js` computes `deltaSeconds = Math.min(gap / 1000, 0.1)` so a hitch cannot teleport
the hero — a movement guard, correct, and commented as such. It is then passed to everything the
frame updates, including three animation mixers, for which it is not a guard but a **speed limit**:
below 10 fps every clip plays in slow motion by the ratio, silently, with no error and no failing
test. A clip that merely loops survives that. A ONE-SHOT CLIP INSIDE A FIXED WINDOW does not, and
the death clip is one: `character/reactClips.js` retimes it to only just fit `RESPAWN_SECONDS`, so it
survives the cap only above `0.1 / DEATH_FALL_FRACTION` — about 5.5 fps. **Ask of any clamp: whose
hazard is this, and who else is downstream of it?** A value narrowed for one consumer's safety is
being handed to consumers whose correctness depends on it being wide.
**Incident (2026-08-23):** measured at 3.1 fps, the hero's death clip reached 55% of its length in
the two seconds he is down and his hips never got below 65% of standing height. What a child on a
cheap tablet saw was a hero drop to one knee and pop straight back up — no knockdown at all. That is
the *identical* defect `reactClips.js`'s own header describes at length and records as fixed on
2026-08-13, resurrected from the other side by a clamp written for movement, on precisely the slow
device this game is for. **Nothing in 1533 node tests and 33 browser checks could see it**, because
every check about the knockdown asked a flag or a DOM veil and none of them looked at the body.
Fixed by passing the raw `frameDeltaMs` to `reactions.update` — the distinction main.js already draws
two hundred lines away for the rescue watch, with its own "THE RAW DELTA, not the clamped one" comment.
**Caught, and now guarded, by** `tools/runtime-test/play-fight.mjs` — a per-frame recording of how
far the highest bone in the hero's skeleton stands above his own origin, asserted to fall under half
of standing height while he is down. Not an `ENFORCED` rung: that rung wants a test in `test/` named
for an ID, and this entry is at its first hit with a guard that only exists in a browser. It went 65% → 9% on the fix. Cost nothing: the recorder was already running,
and observation from inside the page is free. **The generalisable half, and it is not a slogan -- it was
run:** a check that reads a flag proves the rules ran. Only a check that reads the BODY proves a
child would see it. With `swing?.update(...)` sabotaged into a no-op -- rules intact, pose never
written -- `tapping ATTACK starts a swing`, `tapping ATTACK damages the wolf`, `the swing frames
actually caught a swing` and `the three frames are spread across the swing` **all four passed**,
while the hero stood frozen holding his sword out. Four checks named for an animation, none of which
could see one. The only red was a new measurement of how far the sword hand actually travelled.
**THE SWEEP, so nobody has to redo it.** 23 things in `main.js`'s frame take the clamped
`deltaSeconds`. The hazard needs BOTH halves: the consumer accumulates that delta into a one-shot,
AND the moment it ends is decided by a clock that is not that delta. An effect that counts its own
elapsed time and ends on its own count is merely slowed, self-consistently, and completes. Sorted:
- **Truncated** — `reactions` (the death clip; fixed here). Ended by `downSeconds`, which is rules
  time, while the clip advanced in clamped time.
- **Immune, and both by the same trick** — `swing` places `action.time` from progress and calls
  `mixer.update(0)`; `zoneWarden` is re-handed the rules' own `modeSeconds` every frame by `setMode`
  and poses as a pure function of it. **The codebase already contained the correct pattern twice.**
  The fix is not really "unclamp the delta" — it is "place the pose from the rules clock" — and the
  one module that accumulated instead is the one that broke.
- **Measured and clear** — `wolfPresenter`. Same accumulate-a-one-shot shape as the hero's death, and
  it survives only because it has `WOLF_RESPAWN_SECONDS` to finish in rather than `RESPAWN_SECONDS`.
  Slack, not safety; now measured every run (corpse at 19% of standing height).
- **Degraded, not broken, unfixed** — `locomotion` accumulates the clamped delta into a LOOP, so
  below 10 fps the walk cycle plays at a fraction of speed while the hero travels at full speed. He
  moonwalks. Not measured, not touched: a loop self-corrects rather than failing inside a window,
  and that module's restore-then-reapply path carries its own warnings.
- **Self-clocked, no rules window** — the remaining effects (sparks, bursts, flashes, seals,
  brambles, presence and stir ticks). Slowed together with everything else and consistent with it.
**A separate gap the sweep turned up:** `net/remotes.js` has locomotion and no reaction animator at
all, so a sibling watching another child's hero go down never sees it fall, at any frame rate.
**Foreknowledge helped:** no — the ledger had `A render change whose whole purpose is how something
LOOKS cannot be judged from a container with no GPU`, and the true reading here is nearly its
inverse: the container's slowness was not an obstacle to the review, it was the only reason the
defect was visible at all. A GPU would have hidden it.

### OBSERVED — Evidence may name a commit only after executing from that exact clean commit.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-17
**Rule:** Resolving and printing a requested ref is not enough. A review worker must create an isolated,
detached, clean checkout of the resolved SHA; every server path, dynamic import, and asset path used by
the review must come from that checkout; and the result must record both requested and actual reviewed
SHAs. The authoritative request schema belongs beside the trusted worker, not on the requester-controlled
branch where it can drift from what the worker enforces.
**Incidents:** The Sol worker resolved a requested ref but booted Character Studio from its existing
`REPO_ROOT`, so a dirty or different checkout could produce evidence labelled with another SHA. The
live control-branch schema also rejected the Wave 1A loadout accepted by the worker's duplicated test
schema. Fixed with `tools/sol-review/reviewCheckout.mjs`, a trusted adjacent schema, worktree-rooted
server/import paths, explicit SHA attribution, and `test/sol-review-checkout.test.mjs` plus the shared
protocol tests.
**Foreknowledge helped:** not yet recorded.

### GQ-010 — A capture is only evidence if the subject is actually in the frame. So is a measurement.
**Status:** RULE · **Hits:** 2 · **First:** 2026-08-19 · **Last:** 2026-08-20
**Not enforced because:** the check would have to know what each capture is FOR — the defect is a
correct camera pointed at the wrong subject, and no scanner can re-derive a shot's intended subject
from the code that takes it without re-deriving the review it was taken for.
**Rule:** Before a capture is filed as the acceptance seam for how something LOOKS, point the camera
at it deliberately and open the file. A follow camera lands wherever the last leg of a walk left the
hero facing; that bearing is chosen by pathfinding, not by what the shot is for. Sibling of "Green
checks are not a look at the game" above, and a distinct failure from it: there the assertion and the
photograph were of different moments, here the photograph was of the right moment pointed at the
wrong thing. **Hit 2's generalisation: this is not only about photographs.** Any measurement read off
the live camera — a projection, an on-screen test, a visibility check — inherits the same accidental
bearing, and then reports a fact about where the harness happened to be looking while sounding like a
fact about the game.
**Incidents:** (1) 2026-08-19. `village-board-workshop-before-3d-portrait.png`, committed as the
evidence of how the Workshop reads before a purchase, contained no Workshop — it was a photograph of
the Lantern Tree, which stands 3.4 m due north of the building with a canopy wider than that gap,
directly on the one bearing the follow camera always lands on after the walk down from the camp.
Every Workshop capture in `drive-village-board.mjs` had been taken from that bearing since the harness
was written. Fixed by `aimAtWorkshop()`, which points the camera down the plaza-side approach before
each Workshop capture. (2) 2026-08-20, G1's `drive-old-beacon.mjs` first run. Three of nine captures
were useless in the same way — the "way out of the camp" shot faced east because the last leg of the
walk came from the cart, and the arrival shot photographed the Old Beacon from BEHIND with the hero
hidden by its own tower. Worse, the run's headline CHECK ("the Beacon is on screen from the camp
before the walk") read `beaconSight` off that same accidental bearing and reported `ndcX -9.82`: a
loud red result that said nothing whatsoever about whether a child can see where to go, because
nobody was facing that way. Fixed the same way, with the same tool — an `aimAt()` built on
`follow.setHeading`, called before every capture AND before every sight measurement.
**Foreknowledge helped:** 2026-08-20 — the entry did not stop hit 2 happening, but it named it within
a minute of the captures being opened, and its recorded fix (`aimAtWorkshop`) was copied directly
instead of being re-invented.

### OBSERVED — A wall-clock budget waiting on simulated time must account for the frame clamp.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-19
**Rule:** `main.js` clamps `deltaSeconds` to 0.1 s so a hitch cannot teleport the hero. The
consequence is that below 10 fps every timed animation advances SLOWER THAN WALL CLOCK, by the ratio
of frame time to the clamp. A harness waiting N milliseconds for an M-second animation is really
asserting a frame rate. Derive such a budget from the animation's own exported length with headroom
for that ratio; never type a round number beside it. Sibling of "Automation timeouts are wall-clock
budgets, not sample counts" above, and the mirror of it: there a budget was converted into samples,
here a budget in real time was measuring work counted in simulated time.
**Incidents:** The Workshop build ceremony grew from 1.4 s to 2.05 s. `drive-village-board.mjs`'s
flat 4000 ms ceremony poll had been comfortable for the old length and went red on hosted CI at the
new one, at roughly 5 fps, while passing 53/53 locally — nothing was broken, the budget simply did
not know what it was waiting for. A unit test asserting the ceremony fitted inside that same 4000 ms
passed throughout, because it shared the false premise. Fixed by deriving `CEREMONY_BUDGET_MS` from
the exported `WORKSHOP_BUILD_SECONDS`, and by deleting the unit test's claim about another file's
number rather than adjusting it. The first headroom multiplier (4x) was itself a guess and was also
too small — hosted CI measured the ceremony completing at ~4.8x wall clock, roughly 2 fps — so the
multiplier is now 10x and the comment records the measurement it came from. A liveness check earns
nothing from a tight budget.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — A one-time ceremony fired off a server edge plays to whoever happens to be looking.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-19
**Rule:** A one-shot world payoff (a build, a relight, a burst) that is triggered the instant a
shared flag flips is correct about WHEN it happened and says nothing about WHO SAW IT. If the control
that causes the flag lives in the HUD, or the flag can flip while the player is anywhere, the ceremony
must be ARMED on the edge and STARTED on the first frame its subject is actually in front of the
local player -- on screen and within reading range -- or it spends itself on an empty room. Hydration
("already done, show the finished state") is the other path and must stay immediate; the audience
test is only for the ceremony that was paid for. Sibling of "Hydration restores state; it must not
replay the ceremony" above: that one keeps a ceremony from playing twice, this one keeps it from
playing zero times.
**Incidents:** The Village Board is a HUD button, and the moment a child can first afford Workshop I
is at the cart, 42 m up the trail. Bought there, the 2.05 s build ceremony ran to completion with the
camera looking at a fence (`.local/workshop-play/p2cart-05-buy-*`), and the child walked home to a
building that had simply always been there. Every harness and probe had bought it standing at the
door, so nothing red ever said so; it was found by PLAYING the purchase from where the money is
actually earned. Fixed by arming the ceremony on the edge in `main.js` and firing it from
`workshop.js`'s `hasAudience(camera, heroPosition)` (range plus a projected on-screen band); pinned
by the follow-camera-driven tests in `test/workshop.test.mjs` and a `drive-village-board.mjs` check
that a cart-clearing buyer's Workshop is still armed, not built, a beat after the purchase.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — Two one-shot payoffs whose triggers overlap in space fire on the same frame, and cancel each other.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-20
**Rule:** A one-time beat is paid for in attention, and attention does not stack. When a new
collectable, lamp, pickup or trigger is placed near an existing "you got here" radius, check the
DISTANCE BETWEEN THEIR TRIGGERS, not just that each one works. Two payoffs on one frame is not two
payoffs; it is one confused frame with two sounds in it, and the second one is the one that gets
spent. The layout fix (move one out of the other's radius) is almost always better than the
presentation fix (queue them), because the gap between them is itself readable — a chain of lights
that deliberately stops short of the thing it leads to says something a chain that reaches it cannot.
Sibling of "a one-time ceremony fired off a server edge plays to whoever happens to be looking" above:
that one is about a beat with no audience, this one is about two beats with one audience between them.
**Incidents:** G1's Old Beacon road was authored with three approach lanterns on the Dark Trail's own
6-to-7-metre spacing. On an 18 m road that puts the third at about z 49 — inside the Beacon's own
4.6 m arrival radius — so waking it and arriving fired on the same frame: the relight chime, the
arrival sound and the arrival banner all at once, with nothing at all between the last thing a child
collects and the thing they walked there for. Every unit check passed (the spacing was right, the
lamp lit, the arrival latched); it was found by walking the road in the running game and reading the
harness's own log, where "still not arrived at the road's end" was already `beaconFound true`. Fixed
by dropping to two lamps and ending the warm chain 6.1 m short, and pinned by a check in
`test/old-beacon.test.mjs` that no road lamp may stand inside the arrival radius.
**Foreknowledge helped:** not yet recorded.

### GQ-011 — Two simulations of the same thing are not one thing, however carefully you pick between them.
**Status:** RULE · **Hits:** 1 · **First:** 2026-08-20 · **Last:** 2026-08-20
**Not enforced because:** the defect is a missing CONCEPT (which simulation currently owns this
entity), not a missing line. A scanner that could spot it would have to already know the answer.
**Rule:** When two engines each keep state for the same real thing -- a hero's hearts, an item's
ownership, a door's open/shut -- exactly one of them is authoritative at any moment, and moving
between them is an explicit HANDOFF that carries the state across. Publishing whichever copy looks
right for the current position is SELECTION, not continuity: it silently resurrects whatever the
idle copy was last left holding. If a handoff feels like too much machinery, that is the signal the
second copy should not exist -- but if both engines genuinely need their own clocks to resolve their
own actions, then transfer on the boundary, cancel anything mid-flight that belonged to the fight
being left, and let only the owning engine speak for that entity's own events.
**Incidents:** 2026-08-20, the Beacon arc. `createSimulation()` put every player in BOTH the wolf
party engine and the Beacon siege engine, each owning its own `hp`/`downSeconds`/`cooldown`, and the
snapshot chose which copy to publish by testing whether the player stood inside the Beacon arena.
Take wolf damage, walk twenty metres north, and the siege's untouched copy published full hearts;
walk back and the wolf's copy resurrected the old state. Down and cooldown jumped the same way, and
each engine's hero events leaked out of the fight the child was not in. Every unit test passed,
because every unit test drove ONE engine. Found by an independent review reading the seam rather than
the behaviour. Fixed with an explicit arena handoff -- an owning-engine map, a body transfer on
crossing, the in-flight swing cancelled at the seam (a swing belongs to the fight it was thrown in),
and hero-body events published only from the owning engine. Pinned by a regression that injures a
hero in one fight, walks them across the boundary and back, and asserts the hearts never reset.
**Foreknowledge helped:** not yet recorded.

### GQ-012 — A presenter that ticks inside someone else's gate is invisible for reasons its own file cannot explain.
**Status:** RULE · **Hits:** 1 · **First:** 2026-08-20 · **Last:** 2026-08-20
**Not enforced because:** the wiring is correct JavaScript that reads correctly in isolation; only
the frame loop's own nesting makes it wrong, and only for states a fresh session can reach.
**Rule:** A presenter's update must be reachable on every frame its object can be ON SCREEN, not
only on the frames some earlier chapter's condition happens to hold. Objects are visible as soon as
they are built; if their pose, glow or animation is driven from inside an unrelated gate, they are
drawn in whatever state they were constructed in -- which is not a state anybody designed, and which
no test that drives the presenter directly will ever see.
**Incidents:** 2026-08-20, the Beacon arc. The cold seals, the Warden, the blackthorn and the hollow
were all ticked from inside the Dark Trail's `treeLitNow && zoneTrailLights.length > 0` gate, because
that is where the trail's own beats already lived. Their MESHES were built by the zone loader
regardless, so on a fresh session a child could walk to the Beacon and find a Warden that had never
been posed -- kneeling never applied, and its shoulder brazier, the single cold accent that makes it
read as a creature rather than as scaffolding, hidden outright. Invisible to the unit suite (which
drives the presenter directly and therefore always ticks it) and invisible to the seeded harness
(whose fixture lights the tree before it walks). Found by querying the live scene graph in a real
browser -- `warden-brazier-glow visible=false` -- rather than by reading pixels. Fixed by ticking the
arc's presenters unconditionally.
**Foreknowledge helped:** not yet recorded.

### GQ-013 — A reward the rules never read is a lie with a ceremony attached.
**Status:** RULE · **Hits:** 2 · **First:** 2026-08-20 · **Last:** 2026-08-20
**Not enforced because:** every layer is individually correct and individually tested. The catalogue
holds the right number, the screen prints the right number, the ceremony fires at the right moment,
and nothing in any of their tests asks the one question that spans them: does the number reach the
thing it is a number ABOUT.
**Rule:** When a reward names a quantity a child is supposed to feel -- damage, speed, range, light
-- the test that matters is the one that measures the FEELING, not the plumbing. Assert the fight is
shorter, the flame is taller, the room is brighter. A test that a value was stored, published or
rendered proves the value exists; only a test of the effect proves it does anything. Write that test
in the same change that ships the reward, or the reward ships as a rumour.
**Incidents:** 2026-08-20, twice in the same arc, found by playing it rather than by reading it.
(1) `progression/items.js` had said the Wildwood Blade does 2 damage since GP1; `WOLF_DAMAGE_PER_HIT`
was a flat 1 read by both fights, and nothing anywhere called `damageFor`. G4 shipped the longest
promise in the game -- Rowan's blade, an unlock card, a Hero screen printing "2 DAMAGE" -- and the
sword swung exactly like the one the child started with. (2) the Old Beacon's ignition repainted the
EMBERS, which sit inside an openEnded cresset 0.17 m below a 1.14 m rim; `isLit()` was true, the
banner said "The Old Beacon is burning!", and the capture of the winning moment is a black basket
against a blue sky. Both fixed in the same change, and both gates rewritten to measure the effect:
blows-to-kill for the Blade, metres of visible flame for the Beacon.
**Foreknowledge helped:** not yet recorded.

### GQ-014 — An identity derived from mutable state is not an identity.
**Status:** ENFORCED · **Hits:** 6 · **First:** 2026-08-21 · **Last:** 2026-08-22
**Enforced by:** `test/equip-recovery-order.test.mjs` (and `test/profile-identity.test.mjs` for the
first incident, which is the same defect in the idempotency-key half of this rule)
**Rule:** A durable fact needs a name, and an ordering needs a number. Neither may be derived from
something that the act of recording changes, or that resets when a process, a page or a database
does. The test is one question: **if I compute this twice, at two different moments, from two
different survivors, do I get the same answer?** A count you re-read while paying it out, an
in-memory counter, and an index over whichever store is readable right now all fail that question,
and all three look durable in the diff. The give-away is that the number is computed at the moment
of USE rather than carried from the moment of the FACT -- so write it down when the thing happens,
and never let a later read re-derive it.
**Incidents:** all four on 2026-08-21, in one branch, three of them in code written to fix the one
before it. (1) `applyMarkAward` keyed a durable mark on `store.marksFor(guestId)`, read fresh per
call; one guest with two connections got two marks for one wolf, because the count moved between the
two awards for the same kill -- an idempotency key derived from a total that paying it out increments.
Reachable by a child opening a second tab, and it unlocked the lantern in two kills instead of three.
(2) the repair gave `weapon-equipped` an explicit order, then sourced it from a counter initialised
to 0 in `createProfileStore`, so every page load began numbering beneath the history already on
record and a NEW equip lost to an OLD one. (3) the same field was also synthesised server-side from
each row's array index for the current read, which restarts when the database is replaced -- the
exact event local-first exists to survive. (4) with both fixed, `stateFor()` still stamped revisions
onto unseen server facts *for the duration of one read* without persisting them, so an unchanged
remote equip aged forward every time the journal grew around it and could overtake a newer local one.
(5) the repair for (4) made observation durable but still derived the order at observation, so an
older equip DELIVERED late outranked a newer offline one -- arrival is not chronology, and a device
that has not heard about an equip yet numbers its own first offline choice 0 exactly as the unheard
one was. Two writers who have not spoken cannot be ordered by independent counters at all; the fix
was to stop counting and record WHEN the child chose, carried with the fact through both copies
(rewardStore schema v3's `rev` column, minted on the device at the equip action).
(6) with the order finally created at the equip action and persisted, the SERVER'S READ SIDE was
still `ORDER BY rowid DESC LIMIT 1` -- so the device resolved the equipped weapon by the order the
child chose in and the store resolved it by the order the rows arrived in, from the same rows. The
rewards block and live combat damage could name a weapon the recovered profile did not. Fixing the
WRITE side is only half of a chronology change; every reader has to consume the new authority, and
the one that was not converted was the one nobody had a test for.
**The shape of the whole entry is the lesson:** five of the six incidents were introduced by the
repair for the one before it, each time by moving WHERE the number came from instead of moving WHEN
it was decided. If a fix relocates a derivation rather than eliminating it, it is the same bug in a
new place. (2), (4), (5) and (6) were caught by independent Director audit, not by the tests written
alongside them -- see GQ-015 for why those tests did not catch it.
**Foreknowledge helped:** not yet recorded.

### GQ-015 — A test that hand-feeds a pure function proves the function, not where its inputs come from.
**Status:** RULE · **Hits:** 4 · **First:** 2026-08-21 · **Last:** 2026-08-23
**Not enforced because:** the defect is a missing test, and the shape of the missing one depends on
which input the function is being lied to about. No scanner can tell a legitimately isolated unit
test from one that isolated away the actual bug; only asking "who really supplies this argument in
production, and is that path covered?" can.
**Rule:** When a pure function takes a value that something else computes, a test that supplies that
value by hand has tested half the system, and the half it skipped is where the interesting failures
live. Cover the SOURCE at least once end-to-end -- construct the real producer, let it produce, and
assert on the result -- or state in the test's own header that the producer is covered elsewhere and
where. Corollary, which is how this gets discovered late: **a test that keeps passing after the field
it is named for stops existing is not a passing test, it is an unread one.** When a rename or a
redesign moves a field, grep the tests for the old name in the same change.
**Incidents:** 2026-08-21, both in Checkpoint 1b. (1) `foldFacts`'s equip-ordering test passed
throughout, because it fed hand-written `seq` values; the two places that actually produced that
number in production were both broken (GQ-014, incidents 2 and 3), and an independent audit found it
rather than the suite. (2) after the fold moved from `seq` to `rev`, the same test kept passing while
asserting nothing about ordering at all -- both facts now tied at "no revision", and the eventId
tiebreak happened to return the item the assertion expected. Its name still said "latest-wins by
sequence". Rewritten to name `rev` and to choose ids under which the tiebreak would return the WRONG
weapon, so it now fails if the revision is ignored. (3) the regression suite written FOR the
ordering bug still built its equip facts by hand, so it covered the fold and the journal but never
the producer -- and the producer was where the remaining defect lived (GQ-014 incident 5). The
give-away was visible and ignored: two of those tests broke the moment the real producer was
introduced, because the hand-built facts had never been shaped like the real ones. All six now mint
through `mintEquipFact`.
(4) 2026-08-23, and the first one outside the equip path, which is what makes it a pattern rather
than a habit of one file. `test/hero-avatars.test.mjs` proved `chooseAvatarId` thoroughly by handing
it a list of taken animals. The defect was in what `createProfile` PUT IN that list: it read stored
`avatar` fields and filtered the nulls away, so a migrated child -- who has no stored avatar and is
drawn with an id-derived one -- looked as though they had taken nothing, and the next sibling was
handed the animal already on their brother's card. Every test passed for the whole life of the
defect. Found by Director audit. The repair drives the real producers: `migrateLegacyGuest()` then
`createProfile()` over a device holding a legacy guest id.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — A status a document holds on someone else's behalf goes stale with no commit to catch it.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-22
**Rule:** GQ-002 and GQ-003 both go stale because YOU changed something -- the rename, the test count,
the schema -- so the causing commit is also the natural place to catch them. A field recording an
EXTERNAL authority's verdict has no such moment. Nothing in the tree changes when a reviewer rules,
so no diff, no test, and no file-header pass will ever look at it. Two consequences worth acting on:
a provisional word (`awaiting`, `pending`, `in review`, `TBD`) is the one value guaranteed to become
false, and it becomes false somewhere you are not looking; and a document that declares itself
*canonical* about such a status has promised to be re-read on an event, not on an edit. So treat
receiving the verdict as the trigger -- ratchet the record in the same turn you read the ruling, not
in the next commit that happens to touch the file, because there may not be one.
**Incidents (2026-08-22, Checkpoint 1b):** PR #31's body declares itself the canonical checkpoint
ledger. The Director recorded `1b-core.3` as **PASS** at `7abbed1`, and the ledger row still read
"COMPLETE — awaiting Director re-audit" against the superseded SHA `60f466b` -- the very SHA the
Director had ruled **NOT PASS** on. Two commits landed in between (`7abbed1`, `a212957`) and neither
touched the row, because neither had any reason to: the row was wrong about an event that happened on
GitHub. Found by the Director, not by the branch. The failure is mild here -- a stale word in a brief
-- but the surface is the project's own gate history, which is the one record that is supposed to be
harder to drift than the code.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — Nothing under `test/` loads `main.js`, so a bootstrap-fatal edit passes the whole gate.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-22
**Rule:** `public/src/main.js` is the only module the unit suite structurally cannot import — it
touches `document` at load, so no `node --test` file has ever required it, and none can without a
DOM. Every other rule in this ledger assumes a test COULD have caught the defect and asks why it did
not. This one is the class where no test can: the wiring file is the largest module in the repo, it
is where every subsystem is joined, and the required gate cannot see a single line of it. A green
`node --test test/*.test.mjs` therefore says nothing whatever about whether the game boots.

The practical rule is not "unit test main.js" — that is what the harnesses are for. It is: **any
change that moves code IN `main.js` is unproven until something loads the page**, and the cheapest
such proof is a bare CDP navigation that asserts the runtime object exists and the console is clean.
That takes seconds and is worth running before the commit, not after the push. The lesson generalises
past this repo: the gate you trust most is the one with the largest blind spot, because its
greenness is what stops you looking.
**Incident (2026-08-22, Checkpoint 1b-wire):** the durable-offline-marks change constructed
`createOfflineProgress({ profiles, ... })` at `main.js:962` while `const profiles` is initialised at
`main.js:1083`. A textbook temporal dead zone: `bootstrap failed ReferenceError: Cannot access
'profiles' before initialization`, thrown on the first line of the first frame. **The page did not
render at all.** The full unit suite passed — 1369 tests, 1366 pass, 0 fail — and the commit was
pushed on the strength of it. It was found on the next action, the first browser load, and only
because that load happened; nothing else in the workflow would have said a word until hosted CI ran
the runtime bundle. The fix was to construct it after the store it reads from, which is where the
ordering constraint always was.

A second, quieter half worth recording: the placement was first patched in by matching a nearby line
of source text, and that string occurred twice, so the construction landed inside the equip handler
— still bootable, but rebuilding the reward ledger on every EQUIP tap. Anchoring an edit on a string
that is not unique is a silent way to write working code in the wrong place; the second edit matched
on the enclosing function instead and asserted the anchor occurred exactly once.
**Foreknowledge helped:** not yet recorded.

### GQ-016 — Booting the app mints an identity, so a harness that seeds one must do it before the first boot.
**Status:** ENFORCED · **Hits:** 2 · **First/Last:** 2026-08-22
**Enforced by:** `test/harness-seeded-identity.test.mjs`
**Rule:** Several harnesses reach the state they exist to test by writing a known `gq-guest-id` and
letting the server hand back rewards seeded under it. That worked for as long as the guest id WAS
the durable identity. It is not any more: `progression/profiles.js` folds a legacy guest id into a
profile whose id is that same string, but only while the device holds no profiles yet —
`migrateLegacyGuest()` returns null the moment one exists. Booting the app creates one. So a guest
id written after the first boot is not an identity at all, it is a dead string sitting beside a
profile the boot already minted, and the seeded rows stay on the server under a name nothing on the
device points at. The repair is one line and it is the CLEAR, not the write: put the device back to
"no profiles" before pinning, which is the only state the migration is defined for.

What makes this worth a rule rather than a comment is **how it reports**. Nothing says "identity".
The harness fails wherever the seeded state was supposed to show up, so the message names whichever
subsystem happened to be downstream: `drive-ranger` reported an empty speech bubble and a ranger who
would not talk; `fit-lantern` reported `lantern mesh never appeared under its anchor -- is this
profile unlocked (3 marks) and the GLB shipped?`, which is a question about the asset pipeline. Both
were one defect wearing the costume of whatever the seed unlocked. **A failure that names the wrong
subsystem is more expensive than one that names nothing, because it is followed.**

The generalisation past this repo: when a system starts minting identity at startup, every fixture
that used to inject identity is now racing the startup, and none of them will say so.
**Incident 1 (2026-08-22, `aa633c2`):** adding `?hero=` to the harness URL to get past the new
profile gate created a second profile beside the seeded guest in `drive-ranger` and
`drive-beacon-siege`; the seeded guest's owned Wildwood Blade vanished. Repaired by making
`adoptNamedHero()` migrate before it creates — correct, and it fixed only the harnesses that pin
before the first boot.
**Incident 2 (2026-08-22, found at `4e792b3`):** `fit-lantern` pins after its first navigate, so
the migration had already been skipped; it went SUCCESS at base `82478ea` to FAILURE, and was found
by diffing the CI job list against the base run rather than by reading the failure, which pointed at
the GLB. This is the second consecutive regression of mine that only a job-list diff caught, which
is itself the lesson in GQ-003's neighbourhood: a remembered failing set is not a diffed one.
**Foreknowledge helped:** no — the class was known and written down in `adoptNamedHero()`'s own
comment ("the seeded guest's owned Blade vanished because ?hero= had created a second profile beside
it") one commit before it recurred in a different file. A lesson recorded at the site of the first
fix is invisible from the site of the second; that is what the mechanical guard is for.

### GQ-017 — Changing a type is not done when the tests pass. The readers are not all in one directory.
**Status:** ENFORCED · **Hits:** 1 · **First/Last:** 2026-08-22
**Enforced by:** `test/objective-comparisons.test.mjs`
**Rule:** The CP2 keystone turned an objective from a string into `{ id, text }`. Every consumer
under `test/` was found and updated, the full gate went green, and the change was pushed. The
harnesses in `tools/runtime-test/` were never looked at, because one directory had been swept and
that felt like the sweep. **A gate that cannot see a caller cannot tell you the caller is broken**,
and this repo has two suites for exactly that reason -- which is precisely why finishing one of them
is not finishing.

**One direction of the breakage is silent, and that is the part worth the rule.** Against a value
object:

    domString === OBJECTIVE_FIND_THE_BEACON     always FALSE -> the check fails, loudly
    domString !== OBJECTIVE_BEACON_IS_COLD      always TRUE  -> the check PASSES, forever, checking nothing

Two of `drive-old-beacon`'s guards were the second kind. They did not go red; they went vacuous, and
would have reported PASS for the rest of the project's life while asserting a tautology. That is
GQ-015's corollary in a new costume: a test that keeps passing after the thing it names stops
existing is not a passing test, it is an unread one. **When a type changes, the failures you can see
are not the problem. The assertions that quietly became tautologies are.**

**Incident (2026-08-22, `73ce88b`):** `drive-old-beacon` went from success to three failing checks
and two vacuous ones. Found five commits later, and only because a job-list diff was run.
**Corollary, and its own small lesson: the diff tool hid it for two of those runs.** `ci-diff.py`
counted `conclusion == "failure"`, and the job had been CANCELLED -- superseded by the next push --
so the run read as clean. Worse, because the tool computed "fixed" as `base_failures - head_failures`,
two harnesses that were merely cancelled were REPORTED TO THE DIRECTOR AS FIXED. A cancelled job has
said nothing about the code: it is not a failure and it is not a pass, and collapsing it into either
is how a tool built to prevent confident wrong answers produces one. It now reports FAILED and
UNPROVEN as separate buckets.
**Foreknowledge helped:** partly. The sweep-every-caller instinct was there and was applied
thoroughly to `test/`; what was missing was the knowledge that `tools/runtime-test/` imports the same
module. The fix for that is mechanical rather than remembered, which is what the guard is.

### OBSERVED — A change detector must key on the thing it measures, not on the thing it is named after.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-23
**Rule:** When something accumulates history about a target and resets when the target changes, the
reset key has to identify the target at the same granularity the history is measured at. A stable,
correct, immutable identity for the wrong LEVEL is still the wrong key, and it fails silently: the
detector keeps a history that no longer describes anything, and every honest reading is judged
against it. This is not GQ-014 -- nothing here was derived from mutable state, and computing it twice
gives the same answer both times. The question that catches it is different: **what exactly is the
quantity I am accumulating measured against, and does my key change whenever THAT does?**
**Incident (2026-08-23, `guidanceRescue.js`):** the rescue watch accumulated "seconds since this
child last got nearer" and reset on a change of `objectiveId`. It measured distance to a PLACE. Two
objectives -- "wake the dark lights" and "N cold seals left" -- keep one id across six lights and
three seals, so finishing one moved the place without moving the key. A child who walked right up to
a light and lit it kept a best distance of about a metre, and then the whole correct walk to the next
light thirty metres away read as never getting nearer. Twelve seconds in, a child going exactly where
they were sent is offered help finding it -- the game contradicting itself at the moment they had just
succeeded. Reachable by any child who lights a light, which is the chapter's main verb. Caught by
Director audit, not by the fifteen unit tests written alongside the module, every one of which used a
single target.
**The fix is two keys, and the asymmetry between them is the actual lesson:** a new objective resets
everything, a new place inside one objective resets only the distance history. Zeroing the clock on
every target change looks tidier and reintroduces the bug in the mirror: a child standing between two
unlit lights has a nearest that flips as they drift, and a clock that restarts on every flip never
reaches the patience. A rescue that can never fire looks exactly like restraint. Both wrong answers
are now pinned by a test each, because the correct behaviour sits between them.
**Foreknowledge helped:** not yet recorded.

### GQ-018 — A test that derives its probe input from the constant under test cannot fail on that constant.
**Status:** RULE · **Hits:** 2 · **First:** 2026-08-23 · **Last:** 2026-08-23
**Not enforced because:** deciding which constant a given case is "under test" for is a judgement no
static check can make -- the same import is correct as an expected value and wrong as a probe input,
and nothing in the source distinguishes them. What IS mechanical is the countermeasure, and it is
cheap: sabotage the constant and watch the case go red before committing it. Both incidents below
were caught that way and neither would have been caught any other way.
**Rule:** Importing a constant is right for an **expected value** and wrong for the **input you probe
its boundary with**. If the input scales with the thing under test, the boundary moves with the probe
and the case is green forever. The probe input has to come from the PRODUCT CLAIM instead -- a
statement about the player, the device or the world, which the constant then has to satisfy. That is
not a second copy of the constant; it is the requirement the constant exists to meet, and the two
being separate is the entire point.
**Incident 1 (2026-08-23, `test/opening-fight.test.mjs`):** the case proving a child facing off to one
side still hits the wolf aimed at `ATTACK_HALF_ARC_RADIANS * 0.5`. A sabotage run narrowed the arc
from 152 degrees to 29 and the case stayed green, because the probe narrowed with it. Rewritten to
aim at a flat 45 degrees -- what "roughly facing the wolf" means for a four-year-old with a thumb on
a stick -- plus an assertion that the constant is at least that wide. Now: 29 degrees fails, and 108
degrees passes, which is the right answer for a legitimate tuning change.
**Incident 2 (2026-08-23, the same file, hours later, by the agent writing incident 1):** a new case
asking whether a slow child can still win the first fight set its cadence to
`HERO_MAX_HP * WOLF_BITE_COOLDOWN_SECONDS / WOLF_MAX_HP` -- the cadence the rules themselves imply.
That reads like the opposite of restating a constant and is this defect exactly: dropping
`HERO_MAX_HP` from 3 to 2 broke four other cases in the file and left the new one green, because its
bar had dropped with it. Rewritten to a flat 2.5 s, declared as a statement about a four-year-old's
thumb. Now the same sabotage fails it.

That the second hit came from inside the entry's own first write-up is the finding. Knowing the rule
in the abstract did not help; the shape is seductive precisely because deriving-from-the-rules looks
like rigour, and it wears GQ-007's clothes while doing the opposite of what GQ-007 asks. **The tell
is not the import. It is asking whether the number would move if the constant moved -- and if it
would, the case cannot see that constant at all.**
**Note the tension with GQ-007, because it is easy to read this as its opposite.** GQ-007 says never
restate a constant. This says the probe input is not a restatement of the constant -- it is a
different fact, about people rather than about the rules, and collapsing the two is what makes the
test vacuous. When they happen to be equal today, that is a property worth asserting, not a
duplication worth removing.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — Prove the instrument can see a known-good case before believing what it says about the product.
**Status:** OBSERVED · **Hits:** 5 · **First/Last:** 2026-08-23
**Rule:** A probe built to measure the product will happily measure itself, and the reading looks
exactly the same. Before reporting anything surprising, drive the probe at an outcome already known
to be true; if it cannot see that, it cannot see anything. The give-away, every time, was that the
numbers were internally inconsistent -- and the inconsistency was visible in the same output as the
claim, which is the part worth learning.
**Incidents:** four in one night, all in browser probes of the opening wolf fight, and **all four were
reported to the Director as facts about the game before being caught**:
(1) the attack button's coordinates were invented as `(w-92, h-128)` when `play-fight.mjs` had been
using the real `(w-68, h-68)` all along -- **0 of 36 taps landed**, which read as a brutally hard
fight and was a probe tapping empty screen.
(2) one server reused across fights, so the second fight walked up to the corpse the first had left
and reported a **1.6-second rout with zero taps**. The wolf is server-authoritative; a fresh server
per fight is not optional.
(3) the button was sampled 250 ms after each press when contact is at **0.5167 s** -- it saw no miss
rings and reported that whiffs are silent. That is the absence of a thing that had not happened yet,
which reads identically to the thing not existing.
(4) a fixed 45-second mash window against a fight that takes a fraction of that: the wolf died,
respawned ten seconds later (`WOLF_RESPAWN_SECONDS`) and was fought again, and the run reported
**"wolf 3hp -> 3hp" alongside five hp transitions**. A window longer than the thing inside it
measures the window.
**What it cost:** a reported hurt-loop P0 that does not exist. Corrected measurement, same browser:
**four taps, all four connect, the wolf is down in about seventeen seconds** -- and the seventeen is
the tap cadence, not the game. The deterministic engine gives the same fight in 5.1 s.
**The through-line:** every one of the four made the probe report on itself, and every one was
detectable from its own output without knowing anything about the game. `0 of 36`, `1.6 s and zero
taps`, and `3hp -> 3hp with five transitions` are not surprising findings, they are broken
instruments announcing themselves.
**Foreknowledge helped:** 2026-08-23 — directly. A new browser check claimed the hero's sword arm
moves when he swings; rather than believe a green, this entry sent me to sabotage main.js's
`swing?.update(...)` into a no-op, leaving the rules running and nothing writing the pose. The check
went red at 0.9x against its 3x bar, so it can see the case it is for. It also turned up the finding
below, which was not what the sabotage was for.

**Fifth incident (2026-08-23, `drive-two-clients`, the sibling's weapon), and it went further than the
other four.** The harness read a tab's identity back through `runtime.net.guestId`, got `undefined`,
and concluded the seeded guest had not taken. The published accessor is `runtime.guestId()`. So the
reading was a fact about the probe -- the same shape as (1) through (4).

What was new is what I did with it: I generalised from that one bad reading to **four other harnesses
I never ran**, and told the Director I would not trust the identity half of what they assert. They
were fine. Pinning `gq-guest-id` still controls the joined identity by two independent paths --
`profiles.migrateLegacyGuest()` reuses the id verbatim as the profile id, and `client.js` falls back
to `getOrCreateGuestId()` whenever there is no durable profile.

**And the disconfirming evidence was already green.** `drive-hero-screen` seeds a Blade-owning fixture
guest and then asserts that guest can compare and equip the Blade. Those checks pass, in CI, and they
could not if the pin were being ignored. A passing test whose assertions depend on the thing you are
about to declare broken is not a coincidence to be stepped over -- it is the known-good case this
rule says to drive the probe at, sitting there already run.

The operative addition: **the blast radius of a bad instrument is not the file it is in.** A reading
you have not confirmed justifies a claim about the thing you measured and nothing else; the moment a
conclusion reaches files you did not run, it needs evidence from those files. Retracted on the PR
within the hour, which is the only part of this that went right.

### OBSERVED — A trigger radius a child's approach ends AT is decided by drift, not by the child.
**Status:** OBSERVED · **Hits:** 3 · **First/Last:** 2026-08-23
**Rule:** When an interaction is gated on "is the player within R metres", the deciding question is
not what R is -- it is where an approach actually STOPS. A walk that aims at the thing itself ends
wherever momentum, reconciliation and the poll cadence leave it, and if that resting place sits
within a few centimetres of R then whether the interaction happens is decided by sub-metre drift
rather than by anything the player did. It fails intermittently, which is the worst way to fail: the
same approach works and then does not, and there is nothing on screen to explain the difference.
**Incidents,** all measured on the same day, in three unrelated places, which is what makes it a
shape rather than three bugs:
(1) `drive-ranger`, Wren's arrival bubble: `hero 1.99m from Wren, radius 2m`. It PASSED -- by one
centimetre. On the runs where the same walk lands at 2.01 m the NPC silently stops talking to a child
standing right in front of her, and the harness reports an empty speech bubble as a content defect.
(2) `drive-village-board`, the Workshop after a server restart: `metresFromInteractPoint 2.65,
interactRadius 2.4`. A rotating red that predates the branch.
(3) the opening wolf, before it was understood: bodies are held `MIN_BODY_SEPARATION` = 1 m apart and
the reach is 1.7 m, so the whole band a child can press from is 0.70 m wide. That one turned out NOT
to bite -- the wolf always closes -- but the arithmetic was the same and it was believed for an hour.
**What it is not:** a call to widen radii. Two of the three are Owner/Director product numbers, and
widening `KEEPER_WAVE_RADIUS_METERS` moves the Keeper and Rowan too. The reusable part is the
DIAGNOSIS: when an interaction check flaps, measure the resting distance against the radius before
reaching for the poll budget, because a timing fix applied to a geometry problem hides a defect a
child would meet with a thumb on a virtual stick.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — A render change whose whole purpose is how something LOOKS cannot be judged from a container with no GPU.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-23
**Rule:** Geometry, coverage and draw counts are all measurable here. "Does this read as the tree
getting out of the way, or as the tree glitching" is not, and no amount of arithmetic converts one
into the other. Measure and specify the change, then hand the appearance judgement to someone who
can see it -- and say plainly which half you did.
**Incident (2026-08-23, the Lantern Tree):** the canopy is 3.14 m in radius and 5.5 m tall, and the
camera sits 15.29 m behind the child. Sweeping all 360 degrees of camera heading: at **2 m from the
tree -- which is where the opening quest sends a child -- 50% of headings put the canopy between the
camera and the hero.** The whole frame is leaves: no hero, no village, no ground. `occlusionOpacity()`
in `world/zoneLoader.js` is a real, tested per-object fade, and an exhaustive grep for callers returns
exactly ONE: the Keeper's own update, at a 1.1 m radius that its comment describes as "about a body's
width". The one occlusion system in the game fades the one object that is a body's width. The fix is
well-precedented -- the function already takes a radius parameter and the fade machinery already
exists -- but the change is entirely about appearance, so it was specified and handed over rather
than made. Recorded here with the numbers so it is a known defect rather than a lost note.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — A sabotage that does not go red is a finding about the test, not a pass.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-23
**Rule:** Sabotage is run to confirm a check can fail. When it comes back green the instinct is to
shrug and move on, because nothing is broken and the suite is still green -- but a check that stays
green while the thing it names is deleted has just told you it does not test that thing. Read the
green as the result it is. Then find out WHY: either the check is aimed wrong, or the mechanism it
names is not the mechanism doing the work, and both are worth more than the sabotage was.
**Incident (2026-08-23, `net/remotes.js`, remote hero animation):** four sabotages were run against a
new nine-check suite. Two went red as intended. Two did not, and each was a different defect:
(1) *`locomotion does not stand a downed sibling back up` stayed green with the down-skip deleted.*
The check stood the sibling still. At speed 0 locomotion settles onto idle at a weight that never
beats the clamped death clip, so the one parameter value the check happened to pick was the one where
the mechanism is invisible. Re-run at 2.4 m/s the corpse was posed at the run clip's 0.200 instead of
the death clip's 1.000 -- a dead child drawn sprinting. Which is how a child actually gets bitten:
mid-charge, not standing politely still. **A check chose the value at which its own subject cannot
be seen, and passing at that value said nothing.**
(2) *`a sibling who dies mid-swing collapses` stayed green with the order swap removed.* Here the
check was fine and the CLAIM was wrong: on this path the stale swing restore never won a frame, so
the swap is not doing the work its comment says it is. The swap was kept -- it matches main.js, where
that hazard was measured -- but the comment now says outright that nothing in the file proves it.
**The general form:** the useful question after a green sabotage is not "is the code still right"
but "what did I just learn about what this check can see". One of these two was a real gap in
coverage of a real bug; the other was an unproven claim sitting in a comment as if settled. Neither
would have surfaced from a green suite.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — Before adding a field to a protocol, read what the producer already publishes.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-23
**Rule:** A new wire field is a new source of truth, and a second source for a fact that already
travels is worse than no field at all -- the two can disagree, and nothing says which is right. The
cost of checking is one read of the producer; the cost of not checking is a duplicate that has to be
found later by somebody who no longer remembers which was added when.
**Incident (2026-08-23, `players[].weaponId`):** to draw a sibling's sword I added a per-player
weapon field to the snapshot, validated it in `protocol.js`, and carried it through all three of
`interpolation.js`'s sample paths. Two hours later, while looking for the next thing a sibling cannot
see, I read `rewardsFor` and found `equippedWeaponId` -- per hero, on every snapshot, decoded and
validated since long before the branch. The whole addition was withdrawn, three files and eight tests
with it, and the client reads `serverEncounter.rewards[id].equippedWeaponId` instead.
**What made it findable and what made it avoidable are the same thing:** the fact I needed was one
function away in a file I had already opened for something else. I designed the transport before
reading the producer, and the design was fine -- it was just second.
**The one thing the duplicate had:** the weapon travelled WITH the interpolated body, so a swap
landed on the frame the hand arrived rather than an interpolation delay ahead of it. About a hundred
milliseconds, on a once-a-session event. That is what a duplicate wire field buys, and it is not
enough. `heroes`, which drives the far more timing-sensitive knockdown, is already read the same
newest-snapshot way one line above.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — A scripted edit that is not asserted is a change you have not made.
**Status:** OBSERVED · **Hits:** 2 · **First/Last:** 2026-08-23
**Rule:** `str.replace` on a pattern that does not match returns the string unchanged and reports
nothing. Every scripted edit therefore needs an assertion that its anchor was found -- before the
write, so a miss is a crash rather than a silent no-op. Without one, the next green run reads as
confirmation of a change that was never applied.
**Incidents, both 2026-08-23:**
(1) a python heredoc whose assertion threw BEFORE `open(p, 'w')`, so nothing was written at all -- and
the harness run that followed was briefly read as validating a patch that did not exist.
(2) a browser probe gained two new fields and a check that reads them. The `check` call applied; the
FIELDS did not, because that replacement had no assert and its anchor text had shifted under an
earlier edit. The run then reported `lantern undefined` and a FAIL for a lantern that had never been
asked about -- an instrument reporting on a measurement it was not taking, which is the family
"prove the instrument can see a known-good case" is about, arriving this time through the editor
rather than through the probe.
**The tell in (2):** the check printed `body undefined, lantern undefined, blade undefined` while the
JSON beside it simply had no such keys. Undefined everywhere, including for a field that could not be
undefined if the code had run, is not a measurement -- it is the absence of one.
**Foreknowledge helped:** not yet recorded.

### OBSERVED — An instrument that covers a subset reports on the subset, and reads as covering the whole.
**Status:** OBSERVED · **Hits:** 1 · **First/Last:** 2026-08-23
**Rule:** A checker built against one source answers about that source. Nothing in its output says
so, and the answer looks identical to an answer about everything -- so the moment a second source
exists, every clean report it prints is silently narrower than it reads. Either widen the instrument
to the whole, or make it name its own scope in the output. Preferably both.
**Incident (2026-08-23, `browser-proof`):** `tools/ci-diff.py` diffs a full-playtest-matrix job list,
because that is the workflow it was written for. `forge-review` is a different workflow, so its
`browser-proof` check was not passing or failing in the diff -- it was ABSENT. It sat red from 01:40
to 15:30 while I published several reports saying the head was clean with no new failures. The head
had nine failing checks; the tool said eight, and I read eight as all.
**What it was hiding was not cosmetic.** The forge review's job is to prove the asset-review page
cannot spend Meshy credits in CI. It timed out before reaching that check, so for fourteen hours the
guard that exists to prevent unauthorised provider spend ran and proved nothing. **A safety gate that
is red is a safety gate that is not gating.** That is worth more than the fourteen hours: a red check
whose failure is not diagnosed has been silently downgraded to no check.
**And the failure itself was one line.** `${server.url}forge.html` -- where `url` is the GAME's
address and ends in `?hero=Harness` -- resolves to a request for the site root. The tool waited for a
badge that only exists on forge.html, on a page that was index.html, and reported "Forge never
reached FORGE READY". The symptom named the Forge; the cause was the address.
**Repairs, all three levels:** the address (`server.origin`); the tool now checks WHICH PAGE it
landed on before checking the badge, so a wrong address costs one line rather than a day; and
`ci-diff.py --sha` reads `/commits/{sha}/check-runs`, which returns every check on a commit whatever
workflow raised it. The file mode still exists and now prints "one workflow only" beside its answer.
**Foreknowledge helped:** not yet recorded.
