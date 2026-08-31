# Agent playtesting

An unscripted playtest session: the real game on one end, an agent on the other, and nothing in
between that knows what is supposed to happen.

```bash
node tools/runtime-test/playtest-session.mjs --minutes 20 --persona "a seven-year-old playing for the first time"
```

Needs the automation Chrome on port 9224 (README, "Browser harnesses"). The session spawns and owns
its own runtime server, like every other file in `tools/runtime-test/`.

## What this is for, and what it cannot do

The forty `drive-*.mjs` harnesses are scripted. They know the route and assert that it happened,
which is the right shape for regression evidence and the wrong shape for a playtest: **a scripted
harness can only fail in ways someone already imagined.** It cannot get lost, misread a prompt, or
try the wrong thing twice and give up. Those are the findings a playtest exists to produce.

What the published research supports, and what it does not:

- Agents are **bad players and useful instruments**. TITAN ([arXiv:2509.22170]) measured an LLM agent
  against professional human testers on the same seeded-bug suite: humans completed 100% of tasks and
  found 18% of the bugs; the agent completed 95% and found 82%. Do not tune this tool toward playing
  well.
- **Below-human skill still yields a human-valid difficulty signal.** ([arXiv:2410.02829], ACM CHI.)
  Agent performance correlated strongly with human-perceived difficulty even where the agent played
  worse than an average human. What that requires is a *fixed harness and relative comparison* —
  build A against build B — not a good player.
- **Contaminated context destroys the signal.** Give the session the game and nothing else: no brief,
  no design intent, no `docs/`. Its confusion is the data.
- Expect **false alarms**. TITAN reports 30%, mostly from imperfect state abstraction. Budget triage
  time; a transcript is a lead, not a finding.

**This tool accepts nothing.** Per `AGENTS.md`, running-game pixels are the final appearance
authority and an agent may reject a result but never visually accept one. The output is a transcript
for a person to read.

## The two halves

### `player-view.mjs` — what a player could know

The load-bearing piece. Every other harness reads `window.__galaQuestRuntime` for privileged truth,
which is correct for an assertion and **disqualifying for a playtest**: `encounterState()` carries
every enemy's exact hp, leash radius and patrol route. An agent given that is not playtesting, it is
running an optimizer with the answer key open — it will kite a wolf by a leash radius no child can
see, break off at 3 hp it cannot read, and report the fight as too easy. That report is worse than
none, because it is confident, specific, and wrong in the direction that matters for a game tuned for
a seven-year-old.

So the view is a projection, governed by one question: *could a child sitting in front of this iPad
know this, right now, by looking and listening?*

| Channel | What the agent gets |
|---|---|
| `health` | `healthy` / `hurt` / `critical` / `down` — never a number |
| `read` | text actually on screen: visible, opaque, inside the viewport, ancestors included |
| `see` | entities the camera is pointing at: a kind, a screen position, a distance bucket |
| `heard` | anonymous sound events since the last look — never internal recipe/event names |
| `spoken` | read-aloud lines |

Enemy hp, drop contents, server state and scene-node names never appear at any spelling.
`test/playtest-player-view.test.mjs` pins that structurally.

Two defects were found by *running* it, both now regression-tested:

1. Checking only the leaf element reported `LEVEL UP!`, `Who is playing?` and the whole closed hero
   panel as readable at village spawn — each is a leaf with its own text inside a hidden ancestor.
2. The first spawn view reported an empty screen while the capture showed the Keeper, three
   villagers and the pet. Characters are now found by scene-node name and labelled as a child sees
   them: a villager and the Keeper are both `a person` until the marker above his head distinguishes
   him, because that is the information a player has.

**Known gap, stated rather than papered over:** non-enemy scene characters and ground drops still use
frustum projection rather than an occlusion test. A villager, pet, or ground drop behind solid
geometry can therefore be reported as visible when its projected point is inside the camera frustum.
Enemy observations are stricter: they require a visibly rendered nameplate and fail closed when that
label is absent. A finding that depends on a non-enemy scene entity or drop having been seen through
an occluder is not evidence.

### `playtest-session.mjs` — the protocol

Not a harness: it blocks on stdin and produces a transcript rather than a verdict, which is why
`test/review-suite.test.mjs` exempts it from the CI matrix (it would hang the job). It prints one
JSON view to stdout and reads one JSON action line back.

```
walk{ms} | turn{degrees} | attack | tap{xPct,yPct} | wait{ms} | screenshot{label} | note | done
```

`walk`, `attack`, and `tap` go through ordinary input events. `turn` is intentionally narrower: it
calls the existing camera control directly as a controlled playtest action. It is not a gesture-
fidelity or camera-control-discoverability test, so a transcript must not make findings in either of
those categories. This keeps the first tool bounded without pretending that a privileged method call
is a player gesture.

**Who is the agent is deliberately left open.** No model client is wired in: this repository installs
nothing from npm and holds no API credential, and hard-wiring one model would date the tool. A
session driven by hand, by a Claude Code session over Bash, or by a persona fleet script written
later are the same session.

Three constraints worth knowing about:

- **`MIN_ACTION_GAP_MS = 250`.** Human simple reaction time; a child's is slower. An agent over CDP
  can act again in single-digit milliseconds, which is a player with a fifty-fold reflex advantage —
  and such a player never gets bitten, then reports the wolf as harmless. Enforced, not requested;
  the transcript records how long each action was held back.
- **Frame counting on `walk`.** `main.js` samples input only from the frame loop, so on a starved
  page a short press between two frames transmits nothing (see `in-page-driver.mjs`). The session
  tells the agent "that input spanned 1 rendered frame" rather than letting it file a bug about a
  hero who would not move.
- **Stall detection.** Six actions with no change to the readable text or the visible entities sets
  `stalled` on the view. Position is deliberately excluded from that comparison: walking three metres
  down an empty road changes the coordinates and changes nothing a player would call progress.
- **Session boundary and cleanup.** The requested `--minutes` deadline races every stdin read, so a
  silent agent cannot outlive its session. Completion, stream closure, timeout, exception, and a
  handled interrupt each produce one authoritative session end and run the same idempotent tab/server
  cleanup path.
- **Enemy visibility.** An enemy is reported only from its visibly rendered nameplate card, never by
  projecting the underlying encounter snapshot. A missing label therefore fails closed as absent;
  its on-screen name and position can be reported, but its world position, health, and id stay
  private. Literal on-screen card text remains in `read`, not structured enemy state.
- **Sound identity.** The runtime's `audioDebug()` recipe keys are internal harness truth, so the
  player view uses them only to detect that one or more sounds actually scheduled, then emits
  anonymous `a sound` events. It never tells the agent semantic labels such as `level-up` or
  `victory-sting` that a child would not literally hear as words.

## Oracles

Written to the transcript as `kind: "oracle"`:

| Oracle | Fires on |
|---|---|
| `console-error` / `exception` | any page error — cheapest and highest-signal |
| `stall` | six actions with no visible change |
| `slow-action` | an action that overran its own asked-for duration by more than 1.5s |

## The transcript is the deliverable

`.local/runtime-test/playtest-<stamp>.jsonl`, gitignored, one JSON object per line: the persona,
every view, every action with the agent's stated `expect`, and every oracle event. Read it.

The `expect` field is what makes a **confusion event** recoverable afterwards — an agent that said
what it thought would happen, next to what did, is the difference between a transcript and a log.

## Running one session against one build

Bind the run to the exact public SHA under test (`AGENTS.md`), the same as any other evidence. A
single session proves very little on its own: agents are non-deterministic, so compare distributions
across builds rather than reading one run as a verdict.

[arXiv:2509.22170]: https://arxiv.org/abs/2509.22170
[arXiv:2410.02829]: https://arxiv.org/abs/2410.02829
