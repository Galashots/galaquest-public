// public/src/world/enemyDrops.js
//
// R1: kill drops -- coins, hearts, and gear scattered where an ordinary enemy fell. Isomorphic the
// same way world/cartLoot.js's own physical loot is (a pure rules module the server enforces and the
// client renders from), but DYNAMIC where cartLoot.js is FIXED: a cart drops the same five authored
// objects every game, a kill drops from an id nobody could pre-author -- an enemy's own enemyId plus
// which life of it this is. `rewards/` is not the right home for this either, for the identical
// reason cartLoot.js is not: this is PHYSICAL WORLD STATE (where an object is sitting, whether it
// has been collected yet), not a durable reward-store fact. The fact a collected coin/gear/heal
// eventually becomes IS a rewards/ concern (net/gameServerCore.mjs routes a collected drop through
// the existing coin-earned/gear-owned paths and combat/encounter.js's own requestHeroHeal) -- this
// module only owns "what is on the ground and can it be picked up".
//
// DELIBERATELY NOT PERSISTED ACROSS A RESTART, unlike cartLoot's GP3-0 restart-coherence machinery.
// A drop's own id embeds no durable identity worth recovering (see DROP_EXPIRE_SECONDS below): it is
// short-lived set dressing for a kill that already paid out through the durable paths the moment it
// was collected, and a server restart losing an un-collected coin sitting in the grass is the honest
// answer for a game with no save-on-every-tick world snapshot, not a bug this module needs to solve.
//
// Pure: no I/O, no clock, no wall-clock randomness. `rng` is a caller-supplied `() => number in
// [0, 1)` (the server passes Math.random; a test passes a scripted sequence) -- combat/'s own purity
// rule does not reach this file (world/ is a deliberate sibling, the same split cartLoot.js's own
// header explains), but keeping randomness at the SEAM rather than inside this module is what makes
// a drop roll reproducible in a test at all.

import { SHIELD_IRONWOOD_ID, SHOULDER_SILVERGUARD_ID } from '../progression/items.js';

export const COIN_DROP_KIND = 'coin';
export const HEART_DROP_KIND = 'heart';
export const GEAR_DROP_KIND = 'gear';

// Matches world/cartLoot.js's own PICKUP_COLLECT_RADIUS_METERS exactly -- a walk-up-and-grab pickup
// is a walk-up-and-grab pickup, generous for the identical "a thumb, not a keyhole" reason that
// module's own comment gives, and there is no reason a kill drop should ask for finer aim than a
// cart's own coin does.
export const DROP_COLLECT_RADIUS_METERS = 1.3;

// A drop that nobody walks over eventually stops being set dressing and starts being clutter. 45s is
// long enough that a child mid-fight with a SECOND enemy is never punished for not stopping to grab
// the first one's coins, short enough that a village floor is not eventually paved in old gold.
export const DROP_EXPIRE_SECONDS = 45;

// How long a COLLECTED drop keeps riding the wire before this module finally forgets it, so a
// presenter's own attraction-flight animation (world/lootPickups.js's own ATTRACT_FLIGHT_SECONDS is
// 0.4s) has more than one snapshot to read `collectedBy` from before the object vanishes outright.
export const COLLECTED_LINGER_SECONDS = 1;

// Server-side cap on concurrently live drops (spec: "~24"), independent of the wire's own slightly
// larger MAX_WIRE_DROPS headroom (net/protocol.js) -- a busy fight with several kills in quick
// succession must never grow an unbounded pile of pickups. Oldest UNCOLLECTED-or-collected drop
// expires first when a new roll would push the count over this ceiling; see enforceDropCap below.
export const MAX_CONCURRENT_DROPS = 24;

// A heart heals a real, felt chunk of a Level-1 body (HERO_MAX_HP is 30) without being a full
// victory-heal-sized event on its own (combat/encounter.js's VICTORY_HEAL_HP is the Wolf's own bite
// damage, 10) -- twice that, because a heart is rarer than a kill and should read as a bigger, more
// deliberate recovery moment than "every kill gives some back" already provides.
export const HEART_HEAL_HP = 20;

// The gear a kill can hand over -- SHIELD_IRONWOOD_ID's own damageReductionPercent stays the G1
// "truthful baseline" of 0 (test/progression-g1-c1.test.mjs pins it; see items.js's own comment on
// SHOULDER_SILVERGUARD_ID for why this package does not re-tune it), so today the shoulders drop is
// the one that actually changes a hero's own defence. Both stay in the same pool anyway: owning
// EITHER one is real progress even before a future pass gives the Shield teeth, and a gear drop that
// only ever named one item would not read as a pool at all.
//
// Exported for the identical reason dropTableForKind is now exported just above: world/corpseLoot.js
// rolls its own independent per-eligible-hero pick from this SAME pool rather than inventing a
// second one.
export const GEAR_DROP_POOL = Object.freeze([SHIELD_IRONWOOD_ID, SHOULDER_SILVERGUARD_ID]);

// A gear roll that lands on an item the credited hero already owns converts to this many coins
// instead -- never a wasted roll, and never a second copy of an item this game has no use for owning
// twice (progression/items.js has no stacking/salvage concept). Priced above the common coin count's
// own ceiling (2-4) so "I already have that" still reads as a good moment, not a downgrade.
const OWNED_GEAR_COIN_CONVERSION = 5;

// How far a drop scatters from the exact death spot -- close enough to read as "this enemy dropped
// it", far enough that two drops from the same kill are not stacked in the same square decimetre.
const SCATTER_MIN_METERS = 0.5;
const SCATTER_MAX_METERS = 1.0;

/**
 * The roll table for one enemy kind. Exported (R1 kept it private; #87's world/corpseLoot.js is a
 * second, later caller that needs the SAME "does this kind drop gear, how often" answer for its own
 * independent per-eligible-hero roll) so there is exactly one authority for that question rather
 * than a second table free to drift from this one -- see corpseLoot.js's own header for why gear
 * moved out of the ground pickup below into a personal corpse claim.
 *
 *   coinCount             [min, max] BASE coin pickups (before the streak multiplier), each worth 1.
 *   heartChance           independent roll, 0..1.
 *   gearChance            independent roll, 0..1; 0 for a kind that never drops gear on its own.
 *   guaranteedGearOrHeart true only for the Alpha: skips the independent heart/gear rolls above and
 *                          guarantees exactly one of the two, on top of its own bigger coin haul.
 */
export function dropTableForKind(kind) {
  if (kind === 'alpha-wolf') {
    return { coinCount: [4, 7], heartChance: 0, gearChance: 0, guaranteedGearOrHeart: true };
  }
  if (kind === 'frost-wolf') {
    return { coinCount: [2, 4], heartChance: 0.25, gearChance: 0.2, guaranteedGearOrHeart: false };
  }
  // Commons: wolf, ember-wolf, and any future kind this table has not been taught about yet -- the
  // same "an unrecognised kind gets the ordinary answer, never a silent zero" posture
  // combat/enemyStats.js's own respawnSecondsForKind takes.
  return { coinCount: [2, 4], heartChance: 0.25, gearChance: 0, guaranteedGearOrHeart: false };
}

function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function scatterPoint(rng, x, z) {
  const angle = rng() * Math.PI * 2;
  const distance = SCATTER_MIN_METERS + rng() * (SCATTER_MAX_METERS - SCATTER_MIN_METERS);
  return { x: x + Math.cos(angle) * distance, z: z + Math.sin(angle) * distance };
}

function freezeDrop(drop) {
  return Object.freeze({ ...drop });
}

function freezeDropsState(next) {
  return Object.freeze({ drops: Object.freeze(next.drops.map(freezeDrop)) });
}

/** A fresh, empty ground: nothing has died yet. */
export function createEnemyDropsState() {
  return freezeDropsState({ drops: [] });
}

/** Oldest-first eviction once a roll would push the live count over MAX_CONCURRENT_DROPS -- "oldest"
 *  meaning the highest ageSeconds, regardless of collected state, so a fight that keeps producing
 *  kills never grows an unbounded pile. Keeps the YOUNGEST `MAX_CONCURRENT_DROPS` (lowest ageSeconds
 *  first, then truncated to the cap), which is what makes the oldest ones the ones that fall off. */
function enforceDropCap(drops) {
  if (drops.length <= MAX_CONCURRENT_DROPS) return drops;
  return [...drops].sort((a, b) => a.ageSeconds - b.ageSeconds).slice(0, MAX_CONCURRENT_DROPS);
}

/**
 * Roll and spawn the drops one enemy's defeat earns, scattered around where it fell.
 *
 * @param state    the current drops state.
 * @param kill     what died and who gets credit for the roll:
 *   enemyId               the defeated enemy's own stable id.
 *   lifeId                a caller-minted identity unique to THIS life of that enemy (the server
 *                          passes randomUUID(), the identical "never the fold's own restart-fragile
 *                          counter" discipline rewards/marks.js and rewards/killXp.js already take)
 *                          -- used only to keep this kill's drop ids distinct from the next time this
 *                          same enemyId dies, never persisted or checked for durable idempotency.
 *   kind                   the enemy's own kind, read against dropTableForKind above.
 *   x, z                   where it died.
 *   streakMultiplier       world/progression/streaks.js's own coinMultiplierForStreak(streak) for
 *                          the crediting hero, applied to the coin COUNT (never to a coin's own
 *                          value, which is always 1) -- defaults to 1, an unmultiplied kill.
 *   killerOwnedItemIds     the crediting hero's own current ownership (net/gameServerCore.mjs asks
 *                          its reward coordinator), read only to decide the owned-gear-to-coins
 *                          conversion below -- defaults to owning nothing, so a caller that has not
 *                          wired ownership yet degrades to "always drop the gear" rather than
 *                          crashing.
 * @param rng      `() => number in [0, 1)` -- the server passes Math.random; a test passes a scripted
 *                 sequence so a roll is reproducible.
 * @returns { state, spawned } -- `spawned` is the drop objects this call actually added (already
 *   present in `state.drops` too), handed back so a caller/test does not have to diff the arrays.
 */
export function requestEnemyDrop(state, kill, rng) {
  const {
    enemyId, lifeId, kind, x, z, streakMultiplier = 1, killerOwnedItemIds = [],
  } = kill;
  const table = dropTableForKind(kind);
  const rolled = [];

  const [coinMin, coinMax] = table.coinCount;
  let coinCount = randomInt(rng, coinMin, coinMax) * Math.max(1, Math.round(streakMultiplier));
  let wantsHeart = table.heartChance > 0 && rng() < table.heartChance;
  let wantsGear = table.gearChance > 0 && rng() < table.gearChance;

  if (table.guaranteedGearOrHeart) {
    // Exactly one of the two, never both and never neither -- the Alpha's own promise. The instant
    // any of it is worth stating twice is the day this stops being one bare boolean roll.
    if (rng() < 0.5) { wantsGear = true; wantsHeart = false; } else { wantsHeart = true; wantsGear = false; }
  }

  if (wantsGear) {
    const itemId = GEAR_DROP_POOL[randomInt(rng, 0, GEAR_DROP_POOL.length - 1)];
    if (killerOwnedItemIds.includes(itemId)) {
      // Already owned: the roll still happened (so a streak's own coin count still reflects THIS
      // kill's own randomness, not a re-roll), it just pays out differently.
      coinCount += OWNED_GEAR_COIN_CONVERSION;
    } else {
      rolled.push({ kind: GEAR_DROP_KIND, itemId });
    }
  }

  if (wantsHeart) rolled.push({ kind: HEART_DROP_KIND });

  for (let i = 0; i < coinCount; i += 1) rolled.push({ kind: COIN_DROP_KIND });

  const spawned = rolled.map((payload, index) => {
    const point = scatterPoint(rng, x, z);
    return freezeDrop({
      id: `drop:${enemyId}:${lifeId}:${index}`,
      kind: payload.kind,
      ...(payload.itemId ? { itemId: payload.itemId } : {}),
      x: point.x,
      z: point.z,
      ageSeconds: 0,
      collectedBy: null,
      collectedAtSeconds: null,
    });
  });

  return {
    state: freezeDropsState({ drops: enforceDropCap([...state.drops, ...spawned]) }),
    spawned,
  };
}

/**
 * Advance every drop's own clock by `deltaSeconds`. An uncollected drop vanishes once it has sat
 * for DROP_EXPIRE_SECONDS; a collected one lingers COLLECTED_LINGER_SECONDS past the moment it was
 * collected (for the presenter's own attraction flight) and then vanishes regardless.
 */
export function stepEnemyDrops(state, deltaSeconds) {
  const step = Math.max(0, deltaSeconds ?? 0);
  const drops = [];
  for (const drop of state.drops) {
    const ageSeconds = drop.ageSeconds + step;
    if (drop.collectedBy != null) {
      if (ageSeconds - drop.collectedAtSeconds < COLLECTED_LINGER_SECONDS) {
        drops.push({ ...drop, ageSeconds });
      }
      continue;
    }
    if (ageSeconds < DROP_EXPIRE_SECONDS) drops.push({ ...drop, ageSeconds });
  }
  return freezeDropsState({ drops });
}

/**
 * Ask to collect one drop. Rejected (state unchanged, accepted: false, drop: null) when: no drop
 * with this id is currently on the ground, it is already collected by someone (first request to
 * arrive wins -- the actual "cannot be awarded twice" enforcement, the identical shape
 * world/cartLoot.js's own requestCollectLoot already takes), or heroPosition is not actually close
 * enough -- the same "server owns physical truth" posture combat/encounter.js's isWithinStrike and
 * cartLoot's own reach check both already take.
 *
 * On success, the accepted drop's OWN payload rides back (`drop`) so the caller (net/gameServerCore.
 * mjs) knows what to actually award without re-reading state -- a coin, a heal, or a named item id.
 */
export function requestCollectEnemyDrop(state, heroId, dropId, heroPosition) {
  const index = state.drops.findIndex((drop) => drop.id === dropId);
  if (index === -1) return { state, accepted: false, drop: null };
  const existing = state.drops[index];
  if (existing.collectedBy != null) return { state, accepted: false, drop: null };

  const distance = Math.hypot(heroPosition.x - existing.x, heroPosition.z - existing.z);
  if (distance > DROP_COLLECT_RADIUS_METERS) return { state, accepted: false, drop: null };

  const collected = freezeDrop({
    ...existing, collectedBy: heroId, collectedAtSeconds: existing.ageSeconds,
  });
  const drops = [...state.drops];
  drops[index] = collected;
  return { state: freezeDropsState({ drops }), accepted: true, drop: collected };
}
