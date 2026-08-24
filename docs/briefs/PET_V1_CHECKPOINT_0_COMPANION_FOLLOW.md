# Pet Companions v1 — Checkpoint 0: prove the companion fantasy

**Task-ID:** PET-V1-C0-FOLLOW  
**Worker:** Luna / Codex — single write-worker  
**Repository:** `Galashots/galaquest-public`  
**Starting authority:** `main@75f2a205241870b2067854bd00b93d7e877c90ac`  
**Intended branch:** `feat/pet-companions-v1`  
**Intended PR:** draft, titled `[render preview] feat: pet companions v1`

## Owner intent

GalaQuest's next engagement push is pets. The target is not a restrained RPG pet system; it is an obsession hook that can later support visible power growth, rarity, collection, multiplayer flex/trading, and exaggerated kid-readable progression while the game hides deeper exploration/combat/cooperation underneath.

Settled product decisions for the eventual v1:

- starter pet is available essentially immediately;
- player chooses **1 of 3** starters;
- **Fox** = fast/aggressive archetype;
- **Bear** = tank/protector archetype;
- **Frog** = magic/ranged archetype, signature tongue poke;
- pets should be meaningful companions, not merely stat cards;
- player can **own many, equip one**;
- rarity/power economy, trading, and long-term pet progression are deliberately NOT solved yet.

This checkpoint does **not** implement that full system. It proves the most important prerequisite first: does having a creature visibly travel with the hero feel good in the actual game?

## Goal

On the real running GalaQuest client, after the local hero is present, show one clearly separate **temporary prototype companion** that:

1. starts beside/behind the local hero;
2. follows as the hero moves, with obvious animal-like locomotion rather than being glued to the hero transform;
3. settles into idle near the hero instead of jittering;
4. recovers cleanly after a large discontinuity such as respawn/teleport without running across the whole map;
5. remains cosmetic/non-interactive in this checkpoint and cannot alter combat, collision, rewards, quests, persistence, or multiplayer authority.

The checkpoint succeeds when the Owner can open the PR preview and judge the basic feeling: **“having a pet with me is fun/cool enough to keep building.”**

## Temporary visual source

Do **not** create or buy a new asset in this checkpoint.

You may reuse the existing shipped `assets/enemies/wolf.glb` as a **temporary motion/scale stand-in only** because it already has usable idle/walk animation and known runtime material handling. It is NOT the future Fox and must not be described or accepted as final pet art.

If reusing wolf code/bytes, keep the semantics clean:

- companion must not inherit wolf combat state, HP, aggro, targetability, lantern spark, defeat/dissolve, rewards, collision, or respawn logic;
- do not turn enemy code into a generic pet framework merely to save lines;
- reusing a generic loader/material-normalisation seam is fine when it is genuinely generic;
- a deliberate small amount of prototype-specific code is preferable to coupling companions to enemy rules.

## Required architecture

Keep the follow decision mechanically testable outside Three.js. Prefer a small `public/src/companions/` surface with:

- pure follow/formation math that takes hero + companion state and returns the next companion movement intent/state;
- a thin presenter/loading layer for the temporary animated model;
- minimal wiring in `main.js`.

Do not build a generalized pet framework, ECS, behavior tree, navmesh, pathfinder, pet inventory, or data-driven economy in advance of a second real use.

The companion follows the **local hero only** in this checkpoint. Do not add it to authoritative server state or remote-player replication.

## Follow feel

Use the game's real metre scale and inspect existing movement constants rather than inventing a second coordinate convention.

The intended feel is:

- companion occupies a trailing/offset formation slot rather than the hero's exact position;
- there is a small comfortable idle band so tiny reconciliation changes do not create foot shuffling;
- when the hero moves away, the companion catches up decisively enough that it feels loyal rather than sluggish;
- it should visibly walk/run toward the slot rather than teleport during ordinary movement;
- if separation becomes clearly unreasonable because the hero respawned/teleported or state snapped, reposition the companion deterministically near the hero, preferably outside the current camera focus where practical, rather than making it cross the map;
- turning and direction changes should look intentional, not like an object sliding sideways.

Do not tune by arbitrary constants alone. Run the game and inspect the result at normal gameplay framing.

## Explicitly out of scope

Do **not** implement in Checkpoint 0:

- Fox/Bear/Frog final assets;
- starter choice UI;
- pet ownership or collection;
- persistence/profile schema changes;
- pet stats, power numbers, rarity, levels, XP, upgrades, fusion, hatching, eggs, drops, economy, trading, gifting;
- pet combat, damage, buffs, tanking, targeting, aggro, health, death;
- multiplayer pet replication;
- sound/music/VFX polish specifically for pets;
- new paid/provider assets or any Meshy call;
- unrelated cleanup.

## File ownership

Expected write surface is intentionally narrow:

- new files under `public/src/companions/`;
- targeted companion tests under `test/`;
- minimal necessary wiring in `public/src/main.js`;
- only if genuinely necessary for the real running-game prototype, a small companion-specific diagnostic/runtime-test surface under `tools/runtime-test/`.

Stop before modifying progression/profile/network/server/combat/enemy semantics, existing asset bytes, hero rig/anatomy, or unrelated UI. If the clean implementation requires broader ownership, report why instead of silently expanding.

## Verification and closing evidence

Minimum evidence on the resulting exact SHA:

1. `node --test test/*.test.mjs` passes with the new companion logic covered by red-capable unit tests.
2. Run the actual game in real Chrome at the task head and visually inspect at normal gameplay framing.
3. Capture evidence showing at least:
   - initial companion position beside/behind the hero;
   - hero moving with companion following;
   - companion settled idle after catch-up;
   - recovery after a deliberately forced large separation/discontinuity.
4. Confirm from the diff/runtime that the prototype companion has no combat/reward/persistence/server authority.
5. Open/update the draft PR and report the exact resulting head SHA plus tests/evidence paths.

Automated geometry/state can reject a bad result but cannot visually accept the companion. Final visual/product acceptance remains Owner-controlled.

## Stop conditions

Stop and report rather than improvising if:

- `main` has moved from the expected starting SHA before the task branch is created and the new head materially changes the relevant surfaces;
- the task requires files outside the stated ownership envelope;
- the existing wolf asset cannot be reused cleanly without importing enemy semantics;
- the running-game evidence cannot be produced or bound to the exact result head;
- any provider/Meshy spend appears necessary;
- a new product decision is required beyond the owner intent recorded above.

## Authorization envelope

Authorized for this task:

- read/audit the current public repository;
- create `feat/pet-companions-v1` from the refreshed current public `main` if the fixed-point check is satisfied;
- implement Checkpoint 0 within the file ownership above;
- commit/push the task branch;
- open/update the draft `[render preview] feat: pet companions v1` PR;
- run tests and produce local/CI/browser evidence;
- comment/report on the PR.

Not authorized:

- merge or close the PR;
- push directly to `main`;
- force-push/rewrite shared history;
- paid provider/Meshy calls or credit spend;
- production promotion;
- broad scope expansion.

## Worker report

Return a `GQ-WORKER-REPORT v1` containing:

- `Task-ID: PET-V1-C0-FOLLOW`
- start head;
- result head;
- DONE/BLOCKED/FAILED;
- changed-file summary;
- exact test commands/results;
- runtime evidence/capture paths;
- explicit not-verified gaps;
- confirmation that owner-only actions were not performed.
