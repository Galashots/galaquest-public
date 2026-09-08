# Personal progression in the Unity miniature loop

## Package frame

This L package makes rewards earned in the Unity adventure durable and visible for the selected
child. It follows the verified independent-travel head
`71753881e70da77781ba9ac6c2ae934a6dc47123` on a separate branch. Public main was refreshed at
`d7c37e000e8ae3ea93c03f2cbc499edfa14bf9e4`; the approved follow-on stack preserves the unmerged Unity
foundation. The existing owned checkout/cache is reused to avoid repeated Unity imports.

Checkpoint 1 connects accepted Unity server frames to the existing browser profile journal and
refreshes reconnect restoration. Checkpoint 2 presents canonical level, XP, POWER and earned/level-up
feedback, then proves earning and reload recovery in the real browser build. Existing progression
modules remain the only XP/stat/POWER authority; the server remains live combat authority.

Acceptance requires sibling isolation, replay idempotence, restored post-start earnings, rejected
stale-world messages, hydration without duplicate reward ceremonies, canonical HUD numbers, and
running-game inspection. Physical iPad Safari acceptance remains an Owner gate.

Learning encounters, gear asset admission/equipment presentation, companion admission and full Emberworks
content remain separately scoped first-adventure follow-ups. Sunroot is outside the current goal.
The latest personalized curriculum
direction is recorded in Issue #148; this package does not invent learning content or change it.
No provider spend, asset promotion or merge is implied. The Owner's pause after all hub/Emberworks
pushes and before any Sunroot implementation remains in force.

### Amended implementation goal: Hub/Camp + Emberworks only

The Owner explicitly amended the earlier two-adventure goal during checkpoint 2. The current
implementation goal is **Hub/Camp + Emberworks only**, including the current HUD and selected
first-adventure systems/content. Older persistent goal text does not authorize Sunroot work.
Continue only work required for a useful, coherent, reviewable Hub + Emberworks experience.
Do not begin or scaffold Sunroot scenes, enemies,
encounters, quests, assets, learning content, gameplay systems, or generalization justified only by
that future adventure. Reuse is appropriate when current Hub/Emberworks work actually requires it.

At a useful integrated checkpoint, stop and provide the exact branch/PR/SHA stack, actual playable
flow, running Unity/WebGL evidence, remaining physical-iPad/Owner gates, unresolved visual/content/
product weaknesses, convergence/debt, lessons from Emberworks, and 2–3 materially different next
options. Wait for Owner direction; Sunroot is not the automatic next package. Merge, PR closure,
provider spend and asset promotion still require their separate current authority.

## Initial evidence

The required adapter test failed before the runtime module existed. The initial adapter tests cover
selected-profile reads without creating identity, own-player XP and canonical stats, duplicate events,
fresh-page/empty-server recovery, sibling selection changes and arrival hydration. A separate causal
counterexample removes the own-player event filter and incorrectly gives the first child 800 XP
instead of 100; the isolation assertion rejects it.

Checkpoint 1 also covers the synchronous browser callback and Unity session journal refresh before
restore-profile, rejection of stale-world messages, zero journal work for ordinary movement snapshots,
and explicit save-failure reporting. Its tests and resulting source SHA are recorded below when pushed.

The Owner requested concise reusable guidance updates during execution. This checkpoint adds the
Unity Web playtest skill and a short root authority pointer: preserve the WebGL target/cache, finish
cheap checks before a build, use the separate Unity manifest-based harness surface, and distinguish
client/server SHAs. The earlier harness placement failure remains documented in the travel checkpoint.

HUD and built-browser acceptance are checkpoint 2 work. JavaScript VM and Unity EditMode results do
not yet prove dynamic import or persistence in the shipped WebAssembly client.

## Checkpoint 1 evidence

Runtime source: **`e662580838d42e88b16b9671b249ff0f3f4012e9`**.

- JavaScript adapter/browser bridge: **14 PASS**; guidance: **7 PASS**. Save failures are visible,
  replay and sibling facts do not award twice, and ordinary frames do no journal work.
- A short-lived profile-store listener regression was reproduced (three retained listeners after
  three operations) and fixed by disabling watchers on the fresh per-operation store.
- Unity EditMode: **189 PASS / 0 FAIL / 1 optional skip**, on the C# files committed at this SHA.
  The actual full result file contains 190 cases; its top-level `Skipped:Ignored` label includes the
  optional skipped case and must not be interpreted as the whole suite having been skipped.
- Full local Node suite at this SHA: **2301 PASS / 1 FAIL / 3 SKIP**. The remaining failure is the
  existing Windows Lantern XP temporary-directory cleanup `EPERM` (`syscall: rm`), after the test
  reaches cleanup. The matching earlier travel checkpoint recorded the same failure and a green
  hosted run. Hosted validation for this checkpoint must be read independently.
- The new skill passes the skill validator. Generated scaffold line endings were normalized in the
  evidence follow-up. No WebGL build or running-game reward/HUD acceptance is claimed at checkpoint 1.

Hosted required unit run **34185185260 PASS** at evidence head
`6738142c1d4677adb460767ffd03959c6c4de920` (same runtime source as checkpoint 1).

## Checkpoint 2 presentation convention

Keep GalaQuest's existing top-left hero identity, group health with level progress, use a prominent
amber POWER number, and reserve the centre/bottom for play and touch controls. Reward and level-up
notices are brief, non-blocking, personal, and absent during history hydration.

References actually viewed before layout: the current camp screenshot at `931919b`, plus three
official examples: Square Enix's [parameter bar](https://lds-img.finalfantasyxiv.com/game_manual/eu/24/fd90d3f83bfef48a6723179e0ca88b6f99a402.jpg)
groups labeled HP and XP; its [full HUD view](https://lds-img.finalfantasyxiv.com/game_manual/eu/d0/54a883f6a4e09446438335793f502e6526a493.jpg)
keeps identity and supporting information at the perimeter; Nintendo's
[Age of Calamity fire-rod gameplay](https://www.nintendo.com/au/news-and-articles/a-beginners-guide-to-hyrule-warriors-age-of-calamity/)
keeps the level/EXP read compact while combat occupies the centre. These establish conventions,
not GalaQuest art direction. Current generated screenshots remain producer-review work, not accepted
visuals. Avoid inheriting the reference MMO's dense text or the action game's tiny XP labels.

### Owner reference recovery and running-browser correction

The Owner requested the earlier Product Design HUD reference during this checkpoint. The original
mockup image was not recovered from the accessible recent Work conversations or Drive search.
The settled direction was recovered from the Owner visual-direction note in
[Issue #89](https://github.com/Galashots/galaquest-public/issues/89): dark metal/leather, restrained
gold, teal progress, red/orange health, prominent POWER, large ATTACK, and a clear playfield.
The Owner explicitly permits design judgment when the image cannot be found. This increment applies
the hierarchy and palette to the progression panel; textured material art, the target treatment and
parchment objectives are not claimed complete by this checkpoint.

At client/server **`2f7d72385be9f00757eb5f4620d231d4fc580e93`**, the real WebGL driver completed
all 14 recorded travel/progression checks with **zero browser errors**. A real gremlin kill moves the
fixture child from 95 to 115 XP, level 2 and POWER 1,400; the non-contributing sibling remains at 0 XP.
After both pages unload and the owned server is replaced with an empty temporary reward store, the
device journal restores level 2 and combat max HP 35 without a new reward notice. This is desktop
Chrome behavior proof, not physical iPad acceptance.

Producer review of the running images rejected clipped POWER punctuation, a missing arrow glyph,
and a washed-out panel palette. The follow-up gives numerals full line height, uses readable `to`
text, labels HP, and corrects solid-panel colours for the linear Unity project. Those changed pixels
require a new built-client review before acceptance.

The progression driver shares the existing travel harness instead of introducing a second framework.
Initial harness failures were classified before changing runtime: journal fixtures must use the
canonical store; a new gesture must follow a fresh neutral Unity frame after travel; Chrome's endpoint
file must be readable as well as present; fixture scripts must skip opaque `about:blank` pages during
restart. The successful run retains the independent held-input arrival check and does not filter out
browser errors.

## Checkpoint 2 built-client evidence

Runtime, client and server: **`0eb4d75d33291c756f5a5de152859f4b554abf98`**.
The revised build and committed `--progression` driver passed all **14 recorded checks**, with
**zero browser errors**. The [compact proof manifest](browser-proof-0eb4d75.json) records the
build hashes, progression observations and screenshot hashes.

- Real touch combat earns 20 XP, crossing the fixture from 95 to 115 XP: level 2, POWER 1,400,
  max HP 35 and damage 12. The nearby non-contributing sibling remains level 1 with zero XP.
- Travel, reunion and reconnect preserve the shared destination and separate personal progress.
  The held-input arrival check remains part of the same run.
- Both Unity pages reload against a replacement server with a new empty reward store. The first
  child's device journal restores the earned stats; the sibling retains their own level-1 state.
  Neither hydration produces a fresh reward or level-up notice.
- JavaScript bridge/adapter **14 PASS**, guidance **7 PASS**, Unity EditMode **189 PASS / 0 FAIL /
  1 optional skip**. Full local Node: **2301 PASS / 1 FAIL / 3 SKIP**; the sole failure is the existing
  Lantern XP Windows cleanup `EPERM` (`syscall: rm`). Required hosted run
  [34188353437](https://github.com/Galashots/galaquest-public/actions/runs/34188353437) **PASS** at this SHA.

Producer inspection of the actual WebGL level-up, restored-camp and sibling screens confirms readable
POWER punctuation and comparison text, labeled health, clear XP, darker panels, and room around the
Hero and touch controls. The strongest remaining visual weakness is the plain panel treatment against
unfinished greybox scenery; it does not yet deliver the full forged-material target from Issue #89.
The camp edge's steep camera fallback, full first-adventure content, wearable reward payoff and learning
remain separate work. This checkpoint does not assert a finished Emberworks adventure.

**Owner/independent visual acceptance and physical iPad Safari acceptance remain UNKNOWN.**
This is a local candidate review build using the candidate gremlin and Owner-admitted grip; it does not
promote assets, establish final optimized-build performance, or authorize a merge. The implementation
and producer-review checkpoint is ready for review without expanding this PR into those follow-ups.

![Actual Unity WebGL level-up](level-up-0eb4d75.png)

![Level and health restored from the device journal](restored-camp-0eb4d75.png)

The [sibling's unchanged level-1 screen](sibling-0eb4d75.png) is a separate capture from the second context.

The closing console audit extends the driver to include `console.error` events as well as uncaught
exceptions and browser log errors. All **14 checks PASS with zero errors across those three channels**
using the same client `0eb4d75d33291c756f5a5de152859f4b554abf98` against server/driver
`12cda93c28fb26e8eeeb1e7d601fe184ead73bbf`. The diff of `public`, `net`, `unity` and the owned-server
helper between those SHAs is empty; the build hashes are unchanged. The proof manifest records this
second run separately. Hosted required run
[34190256240](https://github.com/Galashots/galaquest-public/actions/runs/34190256240) **PASS** at the
server/driver head. No further runtime correction or build was needed.
