# Progression G1 — First Visible Armor Vertical

**Task-ID:** `PROG-G1-FIRST-VISIBLE-ARMOR`  
**Package size:** **L — Vertical**  
**Write topology:** **one semantic write-worker** under the Owner's current progression-push routing; Production Director remains independent auditor  
**Director:** ChatGPT / GalaQuest Production Director  
**Repository:** `Galashots/galaquest-public`  
**Starting public fixed point:** `main@2a9521a3fd2a43684aeb9fa3a170b9a660926bd8`  
**Branch:** `feat/progression-g1-first-visible-armor`  
**Owning product record:** #44 Meaningful armor and non-weapon gear progression  
**Program plan:** `docs/briefs/PROGRESSION_PROGRAM_DECOMPOSITION_V0.md`  
**Governing design:** `docs/product/PROGRESSION_CONTRACT_V0.md`

## Objective

Ship GalaQuest's first honest non-weapon equipment upgrade from reward to mechanics to pixels:

`open the existing Blackthorn Hollow chest -> durably own a Silverguard Helmet -> see a clear nonblocking upgrade choice -> explicitly EQUIP NOW (never auto-equip) -> the helmet visibly appears on the Hero -> incoming damage is actually reduced -> POWER rises from the same resolved real-strength state -> equipment survives reload/reconnect/recovery -> a sibling's equipment remains their own`

G1 is one **L vertical** because the player outcome is singular: the first armor reward must be something a child can **find, choose, wear, see, and feel**. A helmet that only appears in inventory is not G1. A helmet that only changes a number is not G1. A helmet that changes the fight but is invisible is not G1.

This package also reconciles an existing truth the current game/UI disagree about: the shipping Hero already visibly carries `shield_ironwood`, while progression still renders Shield as a locked empty slot. G1 makes the Ironwood Shield truthful as default baseline equipment without retroactively turning that already-shipped visual into a new reward.

## Locked package contract

`first real non-weapon upgrade -> L -> truthful default Ironwood Shield + one earned Silverguard Helmet + one simple defensive stat + per-slot durable equip + POWER integration + Blackthorn Hollow reward + explicit equip choice + local/remote visual presentation -> no broader armor library/loot economy/new provider work -> three exact-SHA checkpoints -> targeted + protected unit + running-game acceptance -> side quests routed to #44/program plan`

Any discovery that requires a new asset generation/rebuild, Hero rig/skeleton/body change, broad inventory taxonomy, generalized random loot economy, enemy redesign, or another product outcome triggers reforecast rather than silent expansion.

## Authority and why these two pieces

### A1 evidence

Issue #44's accepted A1 inventory established:

- **Silverguard Helmet** and **Ironwood Shield** are the strongest bounded first-vertical candidates;
- both have public-repo bytes, provenance basis, and prior fit/readability evidence;
- the broader locally available armor bank is too thin to promise the full opening 4–6 visual-upgrade target yet;
- Silverguard Shoulders are promising but remain an experiment, not proof of a permanent slot;
- Dawnwarden Helmet remains a separately scoped optimization/rebuild/qualification candidate;
- provider-side batch completion remains UNKNOWN and is not production authority.

Therefore G1 uses only the already-present public assets it needs:

- `public/assets/gear/shield_ironwood.glb` / the already-shipping `shield_ironwood` Hero node as **baseline equipment**;
- `public/assets/gear/helmet_silverguard.glb` as the **first earned armor upgrade**.

No new provider work is needed or authorized.

### Visual authority

`docs/GALAQUEST_VISUAL_AUTHORITY.md` records the Tier-3 Silverguard helmet as a high-value play-size marker: helmet is one of the slots that reads strongly at gameplay scale, and the Silverguard tier was preferred in child comparison. `docs/foundry/gear/tier3_fit.json` records the prior Head fit as reference evidence, not as automatic current-runtime acceptance.

The worker must start from those references and validate the current shipping Hero in Character Studio/available inspection tooling **and in the running game**. Historical fit numbers are a lead. Running-game pixels on the exact G1 head are final visual authority.

### Existing shipping shield is baseline, not a fake reward

`public/src/character/hero.js` currently calls `attachRigidTier2Gear()` on every successful Hero load, and `public/src/character/gear.js` mounts `shield_ironwood` to `LeftHand`. The Shield slot on `heroScreen.js` is nevertheless locked/empty because GP1 only defined weapons.

G1 resolves that contradiction by defining the Ironwood Shield as default-owned/default-equipped Shield-slot equipment. It provides **no incremental G1 progression bonus**: P2's existing Level-1 Starter benchmark must remain exactly the same merely because the UI has become truthful about a prop the child was already wearing.

The G1 upgrade itself is the Silverguard Helmet.

## Owner/product facts to preserve

- Hero progression remains the primary source of strength; gear is meaningful but secondary.
- POWER is derived from real resolved stats and is never an input to combat, rewards, persistence, or adjudication.
- Early gear should carry no more than one or two simple stats.
- A clear upgrade is **never auto-equipped**. The child receives an explicit `EQUIP NOW?` choice with stat and POWER delta.
- Routine equipment rewards should be readable and satisfying without blocking play.
- Level-up remains the strongest routine progression ceremony.
- Item ownership and equipped state are different durable facts.
- The Hero/equipment surface must stay truthful about what is actually worn and what the fight actually uses.
- Current local-first profile recovery remains intact; server authority still adjudicates connected reward claims/equips.
- Existing first-15-minute gear-event counts are tuning targets, not a quota G1 should manufacture.
- Current Hero-screen slots are provisional. G1 may make Shield and Helmet real; it must not use this package to bless Shoulders/Chest or invent new permanent slots.

## G1 V0 item/stat contract

### Item identities and slots

Extend the existing pure item authority rather than creating an armor catalogue beside it.

At minimum G1 defines:

- `shield_ironwood`
  - slot: `shield`
  - default owned: **yes**
  - default equipped: **yes**
  - incremental defensive bonus: **0** in G1; this is baseline equipment already present in the shipped Hero
- `helmet_silverguard`
  - slot: `helmet`
  - default owned: **no**
  - default equipped: **no**
  - first earned non-weapon upgrade
  - one G1 defensive stat: **10% incoming-damage reduction**

Use one slot vocabulary in `progression/items.js` (or an equivalent single pure authority). Do not keep a second slot list in Hero-screen logic if the item authority can answer the same question.

The existing Starter/Wildwood weapon values and Level-1/P2 preservation invariants do not move in G1.

### Canonical defensive stat

G1 introduces one simple real stat: **damage reduction percent**.

For the Silverguard Helmet V0:

- `damageReductionPercent = 10`;
- the Ironwood Shield contributes `0` incremental percent in G1;
- unarmored/default behavior remains `0` reduction;
- reduction is derived from the currently equipped non-weapon items, never from ownership alone.

Use a pure shared resolver under progression authority. Do not let item definitions, server combat, offline combat, Hero screen, and POWER each invent their own summation/formula.

For incoming integer damage, use one combat-side pure application law shared by the Wolf and Beacon/Warden engines:

`resolvedIncomingDamage = max(1, round(rawIncomingDamage * (100 - damageReductionPercent) / 100))`

Therefore the current 10-damage Wolf bite and 10-damage Warden hit each resolve to **9** with the Silverguard Helmet equipped and remain **10** without it.

Do not retune Wolf/Warden damage, attack timing, reach, AI, max HP, Hero damage, or level scaling to make this stat look better.

### POWER integration

POWER must reflect the defensive stat because the stat is real strength.

Extend the existing real-strength calculation using effective survivability:

`effectiveSurvivability = maxHp / (1 - damageReductionPercent / 100)`

`realStrength = (effectiveSurvivability / LEVEL_1_BASE_MAX_HP) * (resolvedHeroDamage / LEVEL_1_STARTER_DAMAGE)`

`POWER = round(1000 * realStrength)`

Rules:

- absent/zero mitigation preserves every existing P2 POWER benchmark exactly;
- POWER remains downstream only;
- reject nonsensical mitigation (`< 0`, `>= 100`, non-finite) rather than normalizing corruption into a plausible Hero;
- future multiple armor pieces may sum through the one resolver, but G1 does **not** invent a broad armor-cap/budget system. If later content would reach an unsafe range, that later package owns the reforecast.

Representative G1 checks:

- L1 + Starter + baseline Shield, no Helmet -> **POWER 1,000** (unchanged);
- L2 + Starter, no Helmet -> **POWER 1,400** (unchanged);
- L2 + Starter + Silverguard Helmet -> **POWER 1,556**;
- L2 + Wildwood Blade, no Helmet -> **POWER 2,567**;
- L2 + Wildwood Blade + Silverguard Helmet -> **POWER 2,852** (delta **+285**).

These are V0 regression benchmarks, not permission to hard-code display values into UI.

## Durable equipment model

G1 must not create a second equip law beside GP1's hard-won ordering law.

Today:

- `weapon-equipped` is latest-wins using durable `rev` plus event-id tiebreak;
- the device journal stamps/retains that order;
- the reward store delegates reading to the same shared law;
- ownership is already generic through `gear-owned`.

G1 extends that architecture to **per-slot equipment** while preserving existing weapon history.

Preferred compatible shape:

- keep historical `weapon-equipped` facts valid and authoritative for the Weapon slot;
- add one generic/non-weapon equip fact shape (for example `gear-equipped`) carrying `value: itemId` plus the same durable `rev`/event identity discipline;
- centralize the comparison/order logic so weapon and non-weapon facts do not implement two versions of “latest choice wins”;
- fold equipment by `itemDef(itemId).slot`, producing one current item per real slot;
- expose a generic resolved equipment collection/map while preserving `equippedWeaponId` as a derived compatibility/readability seam for existing weapon/combat callers where useful;
- extend the existing additive v4 rewards/welcome shape minimally; do not bump protocol version merely because an additive equipment field is added.

The exact fact type/name may follow live code conventions if the worker can prove a simpler compatible design. The invariant is fixed: **one ordering law, one current item per slot, existing weapon history remains valid, no auto-equip from ownership.**

### Required persistence/recovery behavior

Prove at minimum:

- default fresh state: Starter Sword + Ironwood Shield equipped, no Helmet;
- earning `helmet_silverguard` adds ownership only;
- ownership by itself does not change mitigation, POWER, or pixels;
- explicit equip writes one durable ordered choice for Helmet;
- reload/reconnect restores the Helmet equipped without replaying the acquisition/equip ceremony;
- local journal + server store union reaches the same per-slot equipment regardless of arrival order;
- a later same-slot choice would outrank an older one by the shared revision law (fixture/test is sufficient; G1 does not need a second helmet content item);
- two players/profile identities do not share owned/equipped armor state;
- malformed/unknown/non-owned equip requests are refused;
- existing weapon equip/recovery semantics remain green.

Do not add an unequip/loadout-preset system in G1. The Helmet slot begins empty and, once the child chooses Silverguard, remains filled until a future same-slot item supersedes it.

## Reward source — Blackthorn Hollow cache

Use the existing **Blackthorn Hollow chest** as the reliable authored G1 reward source.

Why:

- `blackthornHollow.openChest()` already has an idempotent physical `hollow-chest-opened` edge;
- the connected game already sends `claim-hollow` only while the authoritative Hero is at the chest;
- `createRewardCoordinator.applyHollowCache()` already grants the per-guest cache durably/idempotently;
- the moment is treasure-shaped and does not require inventing a new quest beat;
- it occurs after the child has earned/used the Wildwood Blade, so the first armor reward follows an established progression win rather than appearing on spawn.

Extend the existing Hollow cache claim; do **not** replace it:

- preserve the existing three Wildwood Shards exactly;
- on a guest's first accepted Hollow cache claim, durably grant `helmet_silverguard` through the existing generic `gear-owned` path/event-id discipline;
- replay/resend/reconnect must not grant a second Helmet or replay its first-acquisition ceremony;
- no client message may say “grant me helmet”; it asks for the Hollow claim and the server decides the contents.

Current Hollow cache rewards are intentionally connected/server-authoritative. G1 does not need to redesign all existing Hollow currency behavior for offline-first acquisition. What it **must** preserve is local journal recovery once the server has announced the durable Helmet fact, and safe restore/reconciliation if the server store later loses that fact under the repo's current V0 recovery posture.

## Player choice and ceremony

### Acquisition beat

When `helmet_silverguard` transitions from not-owned to owned in a live session:

- show one concise, premium nonblocking gear reward card;
- name **SILVERGUARD HELMET** clearly;
- show the defensive stat (`DAMAGE TAKEN -10%` or an equally clear one-line kid-readable equivalent);
- show the **actual current-Hero POWER delta** computed from resolved pre/post states;
- ask **`EQUIP NOW?`** with an explicit Equip action and a dismiss/Later path;
- movement/attack remain usable behind the card unless the existing UI architecture proves a safer equivalent;
- do not auto-equip on timeout/dismiss;
- if the child chooses Later, the Helmet remains durably owned and selectable in Gear.

Reuse/generalize the existing `ui/unlockCard.js` pattern if that is the smallest coherent route, but remove sword-specific assumptions rather than cloning a second nearly identical reward-card system. A helmet-specific icon can be simple inline/UI geometry; no new image/provider asset is required.

The existing generic Hollow banner/shard feedback must not compete with the Helmet as a second major reveal. Preserve story/currency information, but make the Helmet card the clear primary payoff on the first Helmet grant.

### Equip beat

On a **live explicit** equip transition, show a short equipment-strength beat with:

- item name;
- defensive stat change;
- `POWER before -> delta -> after` from the same resolved stats combat now consumes;
- visible Helmet appearing on the Hero as part of the same understood action.

Hydration/reconnect adopts already-equipped state silently. It must not replay `UNLOCKED`, `EQUIPPED`, or POWER-change ceremony merely because durable facts arrived.

Level-up remains the stronger routine ceremony. The actual Hollow reward does not award XP, so G1 should not build a general cinematic queue merely for a collision the authored path cannot currently produce. If another live level-up is genuinely reachable during this card through existing behavior, defer the gear beat rather than stack two major moments.

## Hero/equipment screen

Generalize the current GP1 weapon-only Hero screen just enough to tell the truth about G1:

- Weapon slot continues to work exactly as today;
- Shield slot becomes real and displays **Ironwood Shield** as the default equipped baseline;
- Helmet slot becomes a real slot, empty before ownership/equip and filled by Silverguard after explicit equip;
- Shoulders and Chest remain provisional/locked in G1;
- owned-item selection may include the Helmet, not only weapons;
- the selected item card labels its slot and its relevant simple stat rather than pretending every item has `WEAPON DAMAGE`;
- the comparison shows actual current-Hero POWER delta for an unequipped owned Helmet;
- equipped status is per slot;
- do not build dense RPG stat tables, sorting/filtering, loadout presets, rarity-drop systems, salvage, sockets, or inventory grids.

The screen's Level/HP/Damage/POWER identity remains derived from the same resolved Hero stats as combat.

## Visual integration — Silverguard Helmet

The Helmet must be real running-game equipment, not only a swatch/card.

### Existing inputs

- GLB: `public/assets/gear/helmet_silverguard.glb` (already in the public repository and covered by `ASSET-LICENSES.md`);
- prior fit reference: `docs/foundry/gear/tier3_fit.json` (`Head`, ~0.50 world width, shortened vertical proportion, recorded offset/stretch);
- semantic Hero anatomy already exposes `hair` and `ears` coverage regions through `hero.setAnatomyCoverage(...)`.

### Required implementation posture

- use the current shipping Hero and existing rigid-gear/fit tooling conventions;
- derive/record one runtime-authoritative Helmet mount, not repeated magic numbers across UI/main/tests;
- load/mount the existing GLB without modifying Hero rig, skeleton, fingers, body proportions, or asset bytes merely to make it pass;
- when the Helmet is equipped, hide only the anatomy regions actually occupied by the accepted open-faced fit (expected candidates: `hair` and, only if current pixels prove necessary, `ears`);
- when no Helmet is equipped, the normal Hero anatomy is restored;
- local Hero and remote/sibling Hero presentation both follow their own equipped state;
- current Ironwood Shield remains in its accepted baseline carry; do not re-fit it as a G1 side quest;
- no Silverguard Shoulders/Sword integration in G1.

A prior fit is not a free acceptance. The exact G1 head must be inspected in normal portrait and landscape gameplay framing, plus the Hero/equipment preview. If the current Silverguard bytes cannot pass through transform/material/occlusion work alone and require mesh/retexture/rebuild/provider work, **STOP AND REFORECAST** rather than editing assets inside this runtime package.

## Mechanical acceptance — GQ-013 is load-bearing

`docs/MISTAKES.md` GQ-013 already owns the lesson: a reward the rules never read is a lie with a ceremony attached.

G1 must therefore prove the Helmet reaches the **effect**, not merely plumbing:

- without Helmet, a landed current Wolf bite removes 10 HP;
- with Helmet equipped, the same landed bite removes 9 HP;
- without Helmet, a landed current Warden attack removes 10 HP;
- with Helmet equipped, the same landed attack removes 9 HP;
- ownership-but-not-equipped remains 10 HP;
- POWER increases only when the Helmet is equipped, not merely owned;
- the actual fight body/HUD reflect the resulting HP after the mitigated hit.

Use red-capable tests. Sabotage or otherwise demonstrate the seam can fail before trusting a green test (GQ-022).

Do not satisfy this gate by asserting the Helmet definition says `10` or that `resolveHeroStats()` returned a field. Drive the real fight engines through the resolved numeric command seam.

## Expected write surface

Expected production surfaces, only as required by the implementation:

- `public/src/progression/items.js` — slot/item definitions, default Shield truth, Silverguard Helmet stat;
- `public/src/progression/facts.js` — one shared per-slot equip reading/order extension;
- `public/src/progression/profiles.js` — durable equip identity/revision handling for non-weapon choice;
- `public/src/progression/state.js` — generic/current per-slot equipment readers/can-equip seam;
- `public/src/progression/heroStats.js` — resolved mitigation from equipped items;
- `public/src/progression/power.js` — mitigation-aware effective survivability downstream of real stats;
- `net/rewardStore.mjs` — generic equipment read/write support without parallel ordering law;
- `net/gameServerCore.mjs` — Hollow Helmet grant, equipped-state/stat resolution, incoming-damage command seam;
- `public/src/net/protocolCore.js` / client networking only for the minimum additive equipment snapshot/equip semantics required;
- `public/src/combat/encounter.js` plus one shared combat-side mitigation helper if needed;
- `public/src/world/beaconSiege.js` — consume the same resolved incoming-damage law, no retuning;
- `public/src/character/gear.js` / `public/src/character/hero.js` or the smallest equivalent presenter seam for the Helmet mount;
- `public/src/main.js` — local/online wiring, reward/equip edges, local/remote presentation;
- `public/src/progression/heroScreen.js` — truthful Shield/Helmet slots and item-neutral comparison/equip UI;
- `public/src/ui/unlockCard.js` or one equivalent existing UI component generalized for the Helmet reward/equip choice;
- `public/index.html`/existing CSS only if the current UI cannot support the G1 card/screen truth through its existing component-owned styling;
- targeted tests under `test/`;
- a bounded runtime harness under `tools/runtime-test/` that proves the authored Hollow -> own -> choose -> equip -> visual/mechanical/reload path if no existing harness can prove it honestly.

This is an expected surface, not permission for unrelated cleanup in those files.

## Explicitly out of scope

Do **not** implement in G1:

- Silverguard Shoulders or Silverguard Sword gameplay integration;
- Dawnwarden Helmet optimization/rebuild/integration;
- belt-lantern provenance work;
- new torso/chest/boots/gloves/cloak gear;
- permanent new slot taxonomy beyond making Shield/Helmet real;
- unequip/loadout presets/transmog/dye;
- broad rarity-color/drop-rate framework;
- random equipment drops, combat loot tables, ownership-aware drop suppression (R1/G2);
- duplicate conversion/salvage/crafting/affixes/sockets;
- level requirements or Recommended Power gates;
- enemy levels/population/archetypes (E2/E3);
- combat XP (R1), learning (L1), pets, Level-5 special, geography expansion;
- Wolf/Warden AI/timing/damage retuning;
- final first-15-minute balance;
- fresh Meshy/provider calls, paid generation, bulk candidate recovery;
- Hero rig/skeleton/finger/body modification;
- unrelated refactors or browser-matrix hardening.

## Checkpoint plan

G1 is one L PR with **three exact-SHA checkpoints**. The worker may proceed checkpoint-to-checkpoint after locally proving the current checkpoint unless a stop/reforecast condition is hit. Each checkpoint must be a pushed identifiable commit with evidence so the Director can audit history independently.

### G1-C1 — Equipment + defensive-stat authority

Establish the architecture before the reward/UI depends on it:

- item slots/definitions generalized enough for `shield_ironwood` and `helmet_silverguard`;
- default-owned/default-equipped Ironwood Shield makes current shipping presentation truthful without changing P2 strength benchmarks;
- shared per-slot equip fold/order law extends existing `rev`/event-id discipline while preserving historical `weapon-equipped` facts;
- Silverguard Helmet ownership and equip are separate states;
- one pure resolved mitigation stat exists in Hero stats;
- one combat-side incoming-damage application law exists and both Wolf/Warden can consume the resolved number without importing progression/item authority;
- POWER derives effective survivability from mitigation while all zero-mitigation P2 benchmarks remain unchanged;
- no Hollow grant or player-facing Helmet visual required yet.

C1 evidence:

- targeted progression/facts/profile/store/protocol/combat seam tests PASS;
- explicit Level-1/P2 POWER and hit-count preservation tests PASS;
- GQ-013 red-capable tests prove a supplied Helmet mitigation changes actual Wolf and Warden landed damage 10 -> 9 and ownership alone does not;
- existing weapon equip/recovery tests PASS;
- full `node --test test/*.test.mjs` PASS;
- `git diff --check` PASS;
- protected hosted `unit` PASS on exact C1 SHA.

### G1-C2 — Durable Hollow reward + explicit equip vertical

Wire the real product path through existing authority:

- first valid `claim-hollow` continues to grant its three shards and also grants `helmet_silverguard` once per guest;
- grant announcement reaches the local journal under the same durable fact identity;
- reward replays/reconnect/recovery do not duplicate ownership;
- new ownership does **not** auto-equip;
- explicit Equip action uses the shared durable equip identity/order path;
- online combat resolves reduced incoming damage only after equip;
- POWER changes from actual before/after resolved stats;
- two-player/profile isolation is proven;
- hydration/reload restores ownership/equip silently;
- minimal item-neutral reward/equip-card state may exist, but final visual polish/mount acceptance is C3.

C2 evidence:

- targeted server/store/protocol/profile/equip/Hollow tests PASS;
- authored path test proves shards remain exactly three and Helmet ownership is exactly once;
- reconnect/store-loss/local-journal recovery seam for the new gear facts PASS under existing V0 trust rules;
- two-client or deterministic server fixture proves sibling isolation;
- targeted fight evidence proves equipped Helmet affects both current combat engines;
- full unit PASS;
- `git diff --check` PASS;
- protected hosted `unit` + Director runtime bundle PASS on exact C2 SHA.

### G1-C3 — Pixels, Gear screen, ceremony, and final regression evidence

Finish the child-visible vertical:

- Silverguard Helmet mounted on current Hero from existing bytes using current fit/attachment conventions;
- accepted anatomy occlusion applied only while equipped;
- local and remote/sibling visual equipment follows each Hero's own state;
- Hero screen truthfully shows default Ironwood Shield, Helmet slot, owned Helmet, equipped status, defensive stat and current POWER comparison;
- acquisition card asks `EQUIP NOW?`, never auto-equips, supports Later;
- explicit live equip produces the before/delta/after POWER beat and visible Helmet transition;
- reload/reconnect shows the equipped Helmet without replaying ceremony;
- portrait + landscape running-game evidence proves gameplay-scale readability, no face/eye clipping, no floating helmet, no shield regression, and no playfield-blocking UI;
- exact-head normal fight proves 10 -> 9 incoming damage visibly in the real health state;
- no console errors from the G1 path.

Final evidence/gates:

- targeted G1 unit suites PASS;
- full `node --test test/*.test.mjs` PASS;
- `git diff --check` PASS;
- protected hosted `unit` PASS on exact final head;
- Director runtime bundle PASS on exact final head;
- targeted authored G1 runtime harness PASS: Hollow chest -> Helmet owned -> not auto-equipped -> Equip -> POWER/mechanics/pixels change -> reload silent persistence;
- existing `drive-hero-screen`/combat/Beacon/first-level-up seams PASS or are causally reconciled;
- two-client equipment presentation/identity seam PASS or is causally reconciled;
- running-game portrait + landscape captures opened and visually inspected by the Director on the exact final SHA;
- one broad matrix diagnostic at most if warranted by the final diff, with `docs/WORKFLOW.md` final-checkpoint stop boundary applied;
- exact final SHA recorded in the PR handoff.

## Stop / reforecast conditions

Stop and return to the Director if any of these becomes true:

1. current `main`, this branch base, or another writer changes materially before semantic work begins;
2. Silverguard Helmet requires mesh/texture/material rebuild or new provider generation rather than bounded runtime fit/occlusion;
3. making non-weapon equip durable requires a schema/protocol break rather than an additive compatible extension;
4. the 10% mitigation law cannot be made to affect both Wolf and Warden through one shared combat-side law without retuning those encounters;
5. current Hero anatomy cannot support the accepted Helmet without rig/body/topology changes;
6. the reward source needs a new quest/system rather than the existing Hollow claim;
7. the package grows beyond one earned Helmet + truthful baseline Shield + the minimum equipment architecture needed for them;
8. a new Owner idea arrives that materially changes the locked objective — classify/reforecast it, do not absorb it automatically.

## Side-quest destinations

Route useful discoveries rather than absorbing them:

- more armor assets / shoulders / variants / aspiration -> #44 / G2;
- random combat drops / loot rate / duplicate suppression -> R1;
- candidate recovery/provider ledger -> #44 asset lane, separately authorized;
- enemy difficulty/population needed to showcase armor -> E2;
- new archetypes -> A3/E3;
- new world reward location -> product backlog / applicable world initiative;
- broad Hero-screen inventory UX -> #44 follow-up unless strictly necessary for G1;
- combat/UI/browser debt unrelated to G1 -> owning engineering issue per `docs/WORKFLOW.md`.

## Worker handoff requirements

Before semantic work, refresh live state and confirm:

- repo `Galashots/galaquest-public`;
- `main@2a9521a3fd2a43684aeb9fa3a170b9a660926bd8` is still the intended base or report the new fixed point for Director reforecast;
- branch `feat/progression-g1-first-visible-armor` exact planning head;
- draft G1 PR and Issue #44 state;
- no other semantic writer is active on this branch.

Then read and obey current:

- `AGENTS.md`;
- `docs/GUIDANCE.md`;
- `docs/WORKFLOW.md`;
- `docs/product/PRODUCT_VISION.md`;
- `docs/product/PROGRESSION_CONTRACT_V0.md`;
- `docs/GALAQUEST_VISUAL_AUTHORITY.md`;
- `ASSET-LICENSES.md`;
- applicable `docs/MISTAKES.md`, especially **GQ-002, GQ-007, GQ-013, GQ-014, GQ-022**;
- this committed G1 brief.

Do not self-grade final acceptance. Push exact checkpoints/evidence and hand off to the Production Director for independent audit. No merge/close, provider spend, production promotion, or scope expansion without Owner/Director gating.