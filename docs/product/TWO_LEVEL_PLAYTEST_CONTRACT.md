# Two-level playtest contract

Owner-approved on 2026-09-07 after repository orientation, review of the Director handoff and U2 work-session findings, and a product interview. The Owner approved this content plan and execution in Goal mode. Earlier handoff proposals remain evidence, not independent instructions.

Read this contract when implementing the first two-level Unity playtest. Read [Product Vision](PRODUCT_VISION.md) and [Progression Contract](PROGRESSION_CONTRACT_V0.md) for the underlying product and progression rules. [Issue #46](https://github.com/Galashots/galaquest-public/issues/46) owns live release progress and implementation links; this document defines the agreed experience, not a second backlog.

## Release outcome

- A simple hub plus **two distinct, complete adventure levels**, each targeting 10–15 minutes on a first playthrough. The hub does not count as a level.
- Unity browser client, with the existing Node server retaining gameplay authority. Primary acceptance is **two physical iPads running Safari**, using bookmarks over home Wi-Fi with a Windows PC hosting. Desktop is secondary.
- Two-player co-op in the hub and both adventures. Players may travel independently and automatically meet in the same ongoing world when they occupy the same destination.
- Individual profiles, progression, learning credit, inventory, rewards, and completion. Earned progress survives ordinary reconnects and browser/server restarts without duplication or cross-profile leakage.
- Floating touch movement plus Roblox-style drag camera rotation and pinch zoom; movement follows camera orientation. Camera gestures, movement, combat, and UI touches must coexist without trapping the player.
- Green worm and red worm companions, available from the opening experience. Use a substitutable pet system so other pets can replace them later. Existing own-many/equip-one and modest pet-contribution direction still applies.
- Math first: Alberta Grade 2 and Grade 5 profiles, minimal required reading, a few short required adventure tasks plus optional math rewards.
- Cohesive, finished-looking characters, enemies, rewards, and key locations. Supporting scenery may remain simpler. Responsive sound, motion, and feedback are part of playability.
- No fixed deadline: deliver playable milestones, then finish the full agreed experience.

## Adventure plans

### Hub

Provide profile selection, the equipped companion, a safe practice spot, readable equipment/reward inspection, portals into either adventure, and an obvious return route. Keep entry and travel short enough that the hub supports play rather than consuming the session.

### Emberworks — Relight the Forge

Build on the existing Emberworks foundation: Cinder Gate arrival, a small lava-creature fight, a forge-mechanism learning task, the Lava Express crossing, an optional exploration/reward branch, a heavier forge guardian, and a final repair that relights the forge. Completion grants a distinctive wearable reward and a visible environmental payoff.

Use enclosed stone, machinery, and warm lava light, while keeping the walkable route and threats readable. The historical greybox establishes useful beats; it is not proof that the full route, collision, combat, or finale already works.

### Sunroot Glade — Restore the Spring

Create a contrasting woodland adventure with open clearings, streams, old garden ruins, and daylight. Introduce different creature movement/attack patterns; repair a water mechanism through a personal learning task; explore a secret grove; face a root guardian; restore the spring and earn a contrasting wearable reward.

Sunroot Glade is a working title. Exact enemy models, guardian patterns, rewards, and set-piece construction remain production choices inside this approved experience. Select them after checking asset suitability and motion rather than treating filenames as proof of a usable creature.

### Shared pacing

Each adventure has exploration, several fights, **two short required math tasks**, optional challenges, a climax, and a completion payoff. Treat 10–15 minutes as a target to measure in first-playthrough evidence, not a reason to add empty traversal or grind.

## Individual progress in a shared world

The counterexample the implementation must survive is: **one player finishes a destination before the other arrives**.

- Keep a personal completion checklist and learning credit. Another player's answer or finish does not complete that checklist.
- Keep mechanisms available for personal tasks after a shared world change. A wrong answer must not trap both players; provide hints and retries.
- Provide a safe replay path for completed encounters without resetting a sibling's active fight or forcing either player to travel.
- Separate destination encounter state while sharing the profile/reward authority. Moving or reconnecting one player must not move, disconnect, or duplicate the other.
- Present personal rewards and equipment choices clearly. Preserve the progression contract's Hero growth, derived POWER, meaningful visible gear, fixed-world enemy progression, and single special slot.

## Learning scope

Use profile-specific content: green-worm profile targets Grade 2; red-worm profile targets Grade 5. The same adventure mechanism may present different learning work to each player. Short prompts, pictures, hints, and retry feedback support play without requiring long passages of reading.

Examples to author against the current official curriculum:

- Grade 2: addition/subtraction within 100 and missing quantities; unit fractions/equal parts; shape classification; length in centimetres.
- Grade 5: addition/subtraction of fractions with like denominators; reflection/rotation symmetry; ordered pairs; rectangle area and perimeter.

Map each shipped task to a specific current outcome and check both mathematical correctness and kid-readable presentation. A small reviewed content set is sufficient; these two levels do not claim complete curriculum coverage.

Official sources: [Alberta mathematics](https://www.alberta.ca/curriculum-mathematics), [Grade 2](https://curriculum.learnalberta.ca/curriculum/en/gfc/MAT/MAT2), [Grade 5](https://curriculum.learnalberta.ca/curriculum/en/gfc/MAT/MAT5). Recheck the implemented curriculum when authoring; historical draft PDFs are not the content authority.

## Delivery checkpoints

This is an **XL program**, delivered as coherent S/M/L packages under [WORKFLOW](../WORKFLOW.md), rather than one implementation PR.

| Milestone | Playable outcome | Principal acceptance |
| --- | --- | --- |
| 1. Comfortable movement | Reliable touch traversal, animated locomotion, orbit/zoom, camera-relative movement, and honest collision | Reproduce reported defects; verify move/rotate/zoom/release/cancel/focus/reconnect on the exact build and physical iPads |
| 2. First fight | One satisfying authoritative encounter with real hero/enemy motion, readable attacks, forgiving targeting, impact/audio feedback, and quick defeat recovery | Running-game solo and co-op fight; distinguish presentation responsiveness from server combat results |
| 3. Complete miniature loop | Small hub, independent travel/reunion, individual durable rewards, visible gear, one personalized math interaction, both worms | Separate/reunite/reconnect/earn/equip/save loop; asset and profile isolation checks |
| 4. Complete Emberworks | Full route, encounter variety, learning, exploration, reward, forge finale | First-playthrough timing and completion, together and separately |
| 5. Complete Sunroot Glade | Distinct geography, enemy behaviour, learning, water set piece, reward and finale | Same completion gates plus a clear experiential contrast |
| 6. Release finish | Cohesive visuals/audio/UI, measured device performance, reliable hosting and full playthroughs | Both physical iPads complete both adventures; Owner running-game acceptance |

Investigate asset readiness and concurrent-destination/persistence seams early while delivering these playable checkpoints. Source recovery, optimization, rigging, and animation are actual work; a registry label or static clip is not readiness. Use controlled Drive custody for large sources and evidence, with GitHub/registry authority for lifecycle decisions.

Start with bounded asset reuse. Confirm specific paid provider batches with the Owner, follow the privately agreed spending ceiling, and keep asset promotion and PR merges Owner-controlled. Use one principal implementation worker and only bounded, justified specialist work under the applicable collaboration rules.

## Release acceptance

Bind each check to its exact public commit and build. Automated tests support behaviour; they do not prove physical-device or Owner acceptance.

1. Both iPads join from bookmarks, choose their profiles, move, orbit/zoom, fight, interact, and use menus without stuck input.
2. Players can occupy different destinations, reunite, and continue after one reconnects; no ghost players, cross-destination events, or sibling disruption.
3. Each player can complete both levels even when arriving after the other has finished, including their own required math and rewards.
4. Rewards, equipped items, progression, and completion survive ordinary reconnect/browser/server restarts and remain assigned to the correct profile.
5. Green and red worms are visible to their owners and fellow players, animate appropriately, and function through travel/reconnect.
6. Full first-playthrough recordings/timings support the intended pacing. Device performance measurements and a sustained session show responsive play without crashes or progressive degradation; numerical budgets are set from the actual iPads during implementation.
7. Required automated gates pass, producer visual self-review records its strongest defect/counterexample, and the Owner accepts running-game visuals and the physical-iPad experience.

## Reference boundaries

[Roblox's official touch bindings](https://github.com/Roblox/creator-docs/blob/main/content/en-us/includes/default-bindings.md) ground drag rotation and pinch zoom. [Official Minecraft Dungeons reference scenes](https://www.minecraft.net/en-us/article/minecraft-dungeons-news) illustrate readable paths, landmarks, and highlighted interactables. These are convention references, not GalaQuest art direction or authorization to copy assets.

Broader pet economies, trading/hatching, a generalized procedural-world system, public hosting, and a wholesale revival of old destination PRs are outside this release. Worthwhile separate discoveries go to their existing product/engineering records.
