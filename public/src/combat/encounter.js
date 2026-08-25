// Pure ordinary-enemy combat authority. No three.js, DOM, progression, or world imports.
//
import { resolveIncomingDamage } from './damage.js';

// E1 replaces the old mutable `wolf` slot with one canonical `enemies` collection. Every ordinary
// enemy carries a stable enemyId plus a kind discriminator, its own patrol cursor, and its own
// combat/lifecycle clocks. The temporary `.wolf` / wolfSpawn* properties exposed below are derived
// compatibility views only; no state transition ever mutates or publishes a second wolf authority.

export const WOLF_MAX_HP = 30;
export const HERO_MAX_HP = 30;
export const BASE_HERO_DAMAGE = 10;
export const WOLF_BITE_DAMAGE = 10;
export const VICTORY_HEAL_HP = WOLF_BITE_DAMAGE;

export const ATTACK_REACH = 1.7;
export const ATTACK_HALF_ARC_RADIANS = Math.PI * 0.42;
export const SWING_SECONDS = 1.5;
export const SWING_CONTACT_SECONDS = 0.5167;
export const ATTACK_COOLDOWN_SECONDS = 0;

export const WOLF_AGGRO_RANGE = 6;
export const WOLF_BITE_RANGE = 1.6;
export const WOLF_SPEED = 1.15;
export const WOLF_BITE_SECONDS = 1.2;
export const WOLF_BITE_COOLDOWN_SECONDS = 2.6;
export const WOLF_ARRIVAL_GRACE_SECONDS = 0.6;
export const WOLF_BITE_CONTACT_SECONDS = 0.45;
export const STAGGER_SECONDS = 0.667;
export const DEATH_SECONDS = 1.75;
export const RESPAWN_SECONDS = 2;
export const WOLF_RESPAWN_SECONDS = 10;
export const MIN_BODY_SEPARATION = 1;

const DEFAULT_ENEMY_ID = 'wolf-1';
const SOLO_HERO_ID = 'hero';

function clonePoint(point = { x: 0, z: -4 }) {
  return { x: point.x, z: point.z };
}

function compareStableIds(a, b) {
  return String(a).localeCompare(String(b));
}

function freezeEnemy(enemy) {
  for (const point of enemy.patrol) Object.freeze(point);
  Object.freeze(enemy.patrol);
  return Object.freeze(enemy);
}

function legacyWolfView(enemy) {
  if (!enemy) return null;
  return Object.freeze({
    x: enemy.x,
    z: enemy.z,
    heading: enemy.heading,
    hp: enemy.hp,
    mode: enemy.mode,
    modeSeconds: enemy.modeSeconds,
    biteCooldown: enemy.biteCooldown,
    biteLanded: enemy.biteLanded,
    ...(enemy.targetId !== undefined ? { targetId: enemy.targetId } : {}),
  });
}

function firstWolf(state) {
  return state.enemies?.find((enemy) => enemy.kind === 'wolf') ?? state.enemies?.[0] ?? null;
}

function addLegacyEnemyViews(state, { includeTargetId = true } = {}) {
  // Compatibility is a SNAPSHOT of the canonical collection, not another live state owner. These
  // are immutable values rather than getters so repeated reads of `state.wolf` return the same
  // object, preserving the old seam's object-identity guarantee while still deriving once from
  // `enemies`. A caller cannot mutate either side after publication because the whole state is
  // frozen immediately below.
  const enemy = firstWolf(state);
  const fullView = legacyWolfView(enemy);
  let wolf = fullView;
  if (fullView && !includeTargetId) {
    const { targetId, ...soloView } = fullView;
    wolf = Object.freeze(soloView);
  }
  Object.defineProperties(state, {
    wolf: { enumerable: true, value: wolf },
    wolfSpawn: { enumerable: true, value: enemy ? enemy.patrol[enemy.spawnIndex] : null },
    wolfSpawns: { enumerable: true, value: enemy?.patrol ?? [] },
    wolfSpawnIndex: { enumerable: true, value: enemy?.spawnIndex ?? 0 },
  });
  return state;
}

function freezePartyState(state) {
  for (const enemy of state.enemies) freezeEnemy(enemy);
  Object.freeze(state.enemies);
  for (const hero of Object.values(state.heroes)) Object.freeze(hero);
  Object.freeze(state.heroes);
  addLegacyEnemyViews(state, { includeTargetId: true });
  return Object.freeze(state);
}

function freezeSoloState(state) {
  for (const enemy of state.enemies) freezeEnemy(enemy);
  Object.freeze(state.enemies);
  Object.freeze(state.hero);
  Object.freeze(state.heroSpawn);
  addLegacyEnemyViews(state, { includeTargetId: false });
  return Object.freeze(state);
}

function normalizeEnemyDefinition(definition, fallbackId = DEFAULT_ENEMY_ID) {
  const enemyId = String(definition?.enemyId ?? fallbackId);
  const kind = String(definition?.kind ?? 'wolf');
  const sourcePatrol = definition?.patrol?.length
    ? definition.patrol
    : definition?.spawns?.length
      ? definition.spawns
      : [definition?.spawn ?? { x: 0, z: -4 }];
  const patrol = sourcePatrol.map(clonePoint);
  const spawnIndex = Math.max(0, Math.min(
    Number.isInteger(definition?.spawnIndex) ? definition.spawnIndex : 0,
    patrol.length - 1,
  ));
  return { enemyId, kind, patrol, spawnIndex };
}

function freshEnemy(definition) {
  const normalized = normalizeEnemyDefinition(definition, definition?.enemyId);
  const spawn = normalized.patrol[normalized.spawnIndex];
  return {
    enemyId: normalized.enemyId,
    kind: normalized.kind,
    patrol: normalized.patrol,
    spawnIndex: normalized.spawnIndex,
    x: spawn.x,
    z: spawn.z,
    heading: 0,
    hp: WOLF_MAX_HP,
    mode: 'idle',
    modeSeconds: 0,
    biteCooldown: WOLF_ARRIVAL_GRACE_SECONDS,
    biteLanded: false,
    targetId: null,
  };
}

function enemyDefinitionsFromOptions({ enemies, wolfSpawn = { x: 0, z: -4 }, wolfSpawns } = {}) {
  if (Array.isArray(enemies) && enemies.length > 0) {
    const seen = new Set();
    return enemies.map((definition, index) => {
      const normalized = normalizeEnemyDefinition(definition, `enemy-${index + 1}`);
      if (seen.has(normalized.enemyId)) throw new Error(`duplicate enemyId: ${normalized.enemyId}`);
      seen.add(normalized.enemyId);
      return normalized;
    });
  }
  return [normalizeEnemyDefinition({
    enemyId: DEFAULT_ENEMY_ID,
    kind: 'wolf',
    spawn: wolfSpawn,
    patrol: wolfSpawns?.length ? wolfSpawns : [wolfSpawn],
  })];
}

function enemiesFromLegacyState(state) {
  if (Array.isArray(state.enemies)) return state.enemies.map((enemy) => ({
    ...enemy,
    patrol: (enemy.patrol?.length ? enemy.patrol : [enemy]).map(clonePoint),
  }));

  if (!state.wolf) return [];
  // Legacy-only hand-built states still have to carry the legacy spawn seam they always required.
  // Do not silently infer it from the wolf's CURRENT position: that would turn a malformed online
  // mirror into a plausible state and would also confuse "where it is now" with "where it respawns".
  // Deliberately reading x/z here preserves the old fail-loud behavior when wolfSpawn is absent.
  const legacySpawn = { x: state.wolfSpawn.x, z: state.wolfSpawn.z };
  const patrol = (state.wolfSpawns?.length ? state.wolfSpawns : [legacySpawn]).map(clonePoint);
  return [{
    enemyId: DEFAULT_ENEMY_ID,
    kind: 'wolf',
    patrol,
    spawnIndex: state.wolfSpawnIndex ?? 0,
    ...state.wolf,
    targetId: state.wolf.targetId ?? null,
  }];
}

/** Is the target inside the attacker's reach and facing arc? */
export function isWithinStrike(from, heading, target, reach = ATTACK_REACH, halfArc = ATTACK_HALF_ARC_RADIANS) {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance > reach) return false;
  if (distance === 0) return true;
  const facing = (dx * Math.sin(heading) + dz * Math.cos(heading)) / distance;
  return facing >= Math.cos(halfArc);
}

function separateFromEnemy(heroPosition, enemy, minimum) {
  if (enemy.mode === 'dead' || enemy.mode === 'dying') return heroPosition;
  const dx = heroPosition.x - enemy.x;
  const dz = heroPosition.z - enemy.z;
  const distance = Math.hypot(dx, dz);
  if (distance >= minimum) return heroPosition;
  if (distance === 0) return { x: enemy.x, z: enemy.z + minimum };
  return {
    x: enemy.x + (dx / distance) * minimum,
    z: enemy.z + (dz / distance) * minimum,
  };
}

/** Deterministically separates a hero from every living ordinary enemy, stable-ID order. */
export function separateFromEnemies(heroPosition, enemies, minimum = MIN_BODY_SEPARATION) {
  let position = { x: heroPosition.x, z: heroPosition.z };
  const ordered = [...(enemies ?? [])].sort((a, b) => compareStableIds(a.enemyId, b.enemyId));
  for (const enemy of ordered) position = separateFromEnemy(position, enemy, minimum);
  return position;
}

/** Temporary compatibility helper for callers that still hold one Wolf presenter. */
export function separateFromWolf(heroPosition, wolf, minimum = MIN_BODY_SEPARATION) {
  return separateFromEnemy({ x: heroPosition.x, z: heroPosition.z }, wolf, minimum);
}

function stepTowards(mover, target, speed, deltaSeconds) {
  const dx = target.x - mover.x;
  const dz = target.z - mover.z;
  const distance = Math.hypot(dx, dz);
  if (distance === 0) return { x: mover.x, z: mover.z, heading: mover.heading };
  const travel = Math.min(speed * deltaSeconds, distance);
  return {
    x: mover.x + (dx / distance) * travel,
    z: mover.z + (dz / distance) * travel,
    heading: Math.atan2(dx, dz),
  };
}

function heroCanAttack(hero) {
  return hero.downSeconds < 0 && hero.swingSeconds < 0 && hero.cooldown <= 0;
}

function isReplayId(commandId, lastCommandId) {
  return commandId !== null && commandId !== undefined && commandId === lastCommandId;
}

function freshHero() {
  return {
    hp: HERO_MAX_HP,
    maxHp: HERO_MAX_HP,
    swingSeconds: -1,
    cooldown: 0,
    swingLanded: false,
    downSeconds: -1,
    lastCommandId: null,
  };
}

function reconcileMaxHp(hero, wanted) {
  const maxHp = Number.isFinite(wanted) ? Math.max(1, Math.round(wanted)) : HERO_MAX_HP;
  const had = Number.isFinite(hero.maxHp) ? hero.maxHp : HERO_MAX_HP;
  if (maxHp === had) {
    hero.maxHp = had;
    return;
  }
  hero.maxHp = maxHp;
  if (maxHp > had) {
    if (hero.downSeconds < 0) hero.hp += maxHp - had;
    return;
  }
  hero.hp = Math.min(hero.hp, maxHp);
}

function withHeroId(event, heroId) {
  return heroId === undefined || heroId === null ? event : { ...event, heroId };
}

function enemyEvent(event, enemy, heroId) {
  return withHeroId({ ...event, enemyId: enemy.enemyId, kind: enemy.kind }, heroId);
}

function nextSpawnIndex(enemy) {
  if (enemy.patrol.length <= 1) return enemy.spawnIndex;
  return (enemy.spawnIndex + 1) % enemy.patrol.length;
}

function resetEnemy(enemy, { moveOn = false } = {}) {
  const spawnIndex = moveOn ? nextSpawnIndex(enemy) : enemy.spawnIndex;
  const reset = freshEnemy({
    enemyId: enemy.enemyId,
    kind: enemy.kind,
    patrol: enemy.patrol,
    spawnIndex,
  });
  Object.assign(enemy, reset);
}

function publishParty(state, enemies, heroes) {
  return freezePartyState({
    revision: (state.revision ?? 0) + 1,
    enemies,
    heroes,
  });
}

/** Fresh canonical party encounter. `enemies` is the E1 authority; wolfSpawn* remain input adapters. */
export function createPartyEncounterState(options = {}) {
  const heroes = {};
  for (const heroId of options.heroIds ?? []) heroes[heroId] = freshHero();
  const enemies = enemyDefinitionsFromOptions(options).map(freshEnemy);
  return freezePartyState({ revision: 0, enemies, heroes });
}

/** Fresh solo encounter over the same ordinary-enemy collection engine. */
export function createEncounterState(options = {}) {
  const enemies = enemyDefinitionsFromOptions(options).map(freshEnemy).map((enemy) => {
    const { targetId, ...soloEnemy } = enemy;
    return soloEnemy;
  });
  return freezeSoloState({
    revision: 0,
    lastCommandId: null,
    enemies,
    heroSpawn: clonePoint(options.heroSpawn ?? { x: 0, z: 0 }),
    hero: {
      hp: HERO_MAX_HP,
      maxHp: HERO_MAX_HP,
      swingSeconds: -1,
      cooldown: 0,
      swingLanded: false,
      downSeconds: -1,
    },
  });
}

export function canAttack(state) {
  return heroCanAttack(state.hero);
}

export function canHeroAttack(state, heroId) {
  const hero = state.heroes[heroId];
  return hero ? heroCanAttack(hero) : false;
}

export function addHero(state, heroId) {
  if (Object.prototype.hasOwnProperty.call(state.heroes, heroId)) return state;
  return publishParty(
    state,
    enemiesFromLegacyState(state),
    { ...state.heroes, [heroId]: freshHero() },
  );
}

export function removeHero(state, heroId) {
  if (!Object.prototype.hasOwnProperty.call(state.heroes, heroId)) return state;
  const heroes = { ...state.heroes };
  delete heroes[heroId];
  const enemies = enemiesFromLegacyState(state);
  for (const enemy of enemies) if (enemy.targetId === heroId) enemy.targetId = null;
  return publishParty(state, enemies, heroes);
}

export function requestPartyAttack(state, heroId, commandId = null) {
  const existing = state.heroes[heroId];
  if (!existing) return { state, events: [], accepted: false };
  if (isReplayId(commandId, existing.lastCommandId)) return { state, events: [], accepted: false };

  const hero = { ...existing, lastCommandId: commandId ?? null };
  const events = [];
  let accepted = false;
  if (heroCanAttack(hero)) {
    hero.swingSeconds = 0;
    hero.swingLanded = false;
    events.push(withHeroId({ type: 'swing' }, heroId));
    accepted = true;
  }

  return {
    state: publishParty(
      state,
      enemiesFromLegacyState(state),
      { ...state.heroes, [heroId]: hero },
    ),
    events,
    accepted,
  };
}

function healTheStanding(heroes, heroIds, events) {
  for (const heroId of heroIds) {
    const hero = heroes[heroId];
    if (hero.downSeconds >= 0 || hero.hp >= (hero.maxHp ?? HERO_MAX_HP)) continue;
    hero.hp = Math.min(hero.maxHp ?? HERO_MAX_HP, hero.hp + VICTORY_HEAL_HP);
    events.push(withHeroId({ type: 'hero-healed', remaining: hero.hp }, heroId));
  }
}

function findSwingTarget(enemies, position, heading) {
  let best = null;
  let bestDistance = Infinity;
  for (const enemy of enemies) {
    if (enemy.mode === 'dead' || enemy.mode === 'dying') continue;
    if (!isWithinStrike(position, heading, enemy)) continue;
    const distance = Math.hypot(enemy.x - position.x, enemy.z - position.z);
    const betterDistance = distance < bestDistance - 1e-9;
    const tiedDistance = Math.abs(distance - bestDistance) <= 1e-9;
    if (betterDistance || (tiedDistance && (!best || compareStableIds(enemy.enemyId, best.enemyId) < 0))) {
      best = enemy;
      bestDistance = distance;
    }
  }
  return best;
}

function nearestTargetableHero(enemy, heroes, heroIds, commandHeroes) {
  let best = null;
  let bestDistance = Infinity;
  let dx = 0;
  let dz = 0;
  for (const heroId of heroIds) {
    if (heroes[heroId].downSeconds >= 0 || commandHeroes[heroId]?.targetable === false) continue;
    const position = commandHeroes[heroId]?.position ?? { x: 0, z: 0 };
    const candidateDx = position.x - enemy.x;
    const candidateDz = position.z - enemy.z;
    const distance = Math.hypot(candidateDx, candidateDz);
    const betterDistance = distance < bestDistance - 1e-9;
    const tiedDistance = Math.abs(distance - bestDistance) <= 1e-9;
    if (betterDistance || (tiedDistance && (best === null || compareStableIds(heroId, best) < 0))) {
      best = heroId;
      bestDistance = distance;
      dx = candidateDx;
      dz = candidateDz;
    }
  }
  return { heroId: best, distance: bestDistance, dx, dz };
}

function enemyIsHostile(enemy, command) {
  if (enemy.kind === 'wolf') return command.wolfHostile !== false;
  return false;
}

function advanceEnemy(enemy, heroes, heroIds, commandHeroes, events, deltaSeconds, command) {
  enemy.modeSeconds += deltaSeconds;
  enemy.biteCooldown = Math.max(0, enemy.biteCooldown - deltaSeconds);

  if (enemy.mode === 'dying') {
    if (enemy.modeSeconds >= DEATH_SECONDS) {
      enemy.mode = 'dead';
      enemy.modeSeconds = 0;
    }
    return;
  }

  if (enemy.mode === 'dead') {
    if (enemy.modeSeconds >= WOLF_RESPAWN_SECONDS) {
      resetEnemy(enemy, { moveOn: true });
      events.push(enemyEvent({ type: 'wolf-respawned' }, enemy));
    }
    return;
  }

  if (enemy.mode === 'hit') {
    if (enemy.modeSeconds >= STAGGER_SECONDS) {
      enemy.mode = 'idle';
      enemy.modeSeconds = 0;
    }
    return;
  }

  if (enemy.mode === 'bite') {
    const contact = enemy.modeSeconds >= WOLF_BITE_CONTACT_SECONDS;
    if (contact && !enemy.biteLanded) {
      enemy.biteLanded = true;
      const targetId = enemy.targetId;
      const target = targetId == null ? null : heroes[targetId];
      const targetPosition = targetId == null ? null : (commandHeroes[targetId]?.position ?? { x: 0, z: 0 });
      const stillTargetable = targetId == null || commandHeroes[targetId]?.targetable !== false;
      if (target && target.downSeconds < 0 && stillTargetable
        && isWithinStrike(enemy, enemy.heading, targetPosition, WOLF_BITE_RANGE)) {
        target.hp -= resolveIncomingDamage(
          WOLF_BITE_DAMAGE,
          commandHeroes[targetId]?.damageReductionPercent,
        );
        events.push(enemyEvent({ type: 'hero-hurt', remaining: Math.max(0, target.hp) }, enemy, targetId));
        if (target.hp <= 0) {
          target.downSeconds = 0;
          events.push(enemyEvent({ type: 'hero-down' }, enemy, targetId));
        }
      } else {
        events.push(enemyEvent({ type: 'bite-missed' }, enemy));
      }
    }
    if (enemy.modeSeconds >= WOLF_BITE_SECONDS) {
      enemy.mode = 'idle';
      enemy.modeSeconds = 0;
    }
    return;
  }

  const nearest = nearestTargetableHero(enemy, heroes, heroIds, commandHeroes);
  if (nearest.heroId === null) {
    enemy.mode = 'idle';
    return;
  }

  const hostile = enemyIsHostile(enemy, command);
  if (hostile && nearest.distance <= WOLF_BITE_RANGE && enemy.biteCooldown === 0) {
    enemy.mode = 'bite';
    enemy.modeSeconds = 0;
    enemy.biteLanded = false;
    enemy.biteCooldown = WOLF_BITE_COOLDOWN_SECONDS;
    enemy.heading = Math.atan2(nearest.dx, nearest.dz);
    enemy.targetId = nearest.heroId;
    return;
  }

  if (hostile && nearest.distance <= WOLF_AGGRO_RANGE && nearest.distance > WOLF_BITE_RANGE * 0.9) {
    const moved = stepTowards(
      enemy,
      commandHeroes[nearest.heroId]?.position ?? { x: 0, z: 0 },
      WOLF_SPEED,
      deltaSeconds,
    );
    enemy.x = moved.x;
    enemy.z = moved.z;
    enemy.heading = moved.heading;
    enemy.mode = 'walk';
    return;
  }

  enemy.mode = 'idle';
}

export function stepParty(state, command = {}) {
  const { deltaSeconds = 0, heroes: commandHeroes = {} } = command;
  const heroIds = Object.keys(state.heroes).sort(compareStableIds);
  const heroes = {};
  for (const heroId of heroIds) heroes[heroId] = { ...state.heroes[heroId] };
  const enemies = enemiesFromLegacyState(state);
  const events = [];

  const respawnedIds = [];
  for (const heroId of heroIds) {
    const hero = heroes[heroId];
    const cmd = commandHeroes[heroId];
    const position = cmd?.position ?? { x: 0, z: 0 };
    const heading = cmd?.heading ?? 0;

    reconcileMaxHp(hero, cmd?.maxHp);
    hero.cooldown = Math.max(0, hero.cooldown - deltaSeconds);

    if (hero.downSeconds >= 0) {
      hero.downSeconds += deltaSeconds;
      if (hero.downSeconds >= RESPAWN_SECONDS) {
        hero.downSeconds = -1;
        hero.hp = hero.maxHp;
        events.push(withHeroId({ type: 'hero-respawned' }, heroId));
        respawnedIds.push(heroId);
      }
    }

    if (hero.swingSeconds >= 0) {
      hero.swingSeconds += deltaSeconds;
      const droppedIt = hero.downSeconds >= 0;
      if (droppedIt) {
        hero.swingSeconds = -1;
        hero.swingLanded = false;
        hero.cooldown = ATTACK_COOLDOWN_SECONDS;
        events.push(withHeroId({ type: 'swing-dropped' }, heroId));
      }

      const contactReached = !droppedIt && hero.swingSeconds >= SWING_CONTACT_SECONDS;
      if (contactReached && !hero.swingLanded) {
        hero.swingLanded = true;
        const target = findSwingTarget(enemies, position, heading);
        if (target) {
          const damage = Number.isFinite(cmd?.heroDamage) ? cmd.heroDamage : BASE_HERO_DAMAGE;
          target.hp -= damage;
          target.modeSeconds = 0;
          if (target.hp <= 0) {
            target.mode = 'dying';
            events.push(enemyEvent({ type: 'wolf-defeated' }, target, heroId));
            healTheStanding(heroes, heroIds, events);
          } else {
            target.mode = 'hit';
            events.push(enemyEvent({ type: 'wolf-hit', remaining: target.hp, damage }, target, heroId));
          }
        } else {
          events.push(withHeroId({ type: 'swing-missed' }, heroId));
        }
      }

      if (hero.swingSeconds >= SWING_SECONDS) {
        hero.swingSeconds = -1;
        hero.cooldown = ATTACK_COOLDOWN_SECONDS;
      }
    }
  }

  // Preserve the old wipe rule, now over every ordinary enemy independently: if a hero respawns
  // and no other hero was alive at the start of the tick, the encounter resets in-place rather
  // than advancing any patrol cursor.
  for (const heroId of respawnedIds) {
    const otherAlive = heroIds.some(
      (otherId) => otherId !== heroId && state.heroes[otherId].downSeconds < 0,
    );
    if (!otherAlive) for (const enemy of enemies) resetEnemy(enemy);
  }

  // Enemy iteration order is canonicalized by stable identity so serialization/insertion order can
  // never change which lifecycle transition is evaluated first.
  enemies.sort((a, b) => compareStableIds(a.enemyId, b.enemyId));
  for (const enemy of enemies) {
    advanceEnemy(enemy, heroes, heroIds, commandHeroes, events, deltaSeconds, command);
  }

  return { state: publishParty(state, enemies, heroes), events };
}

function toPartyState(state) {
  const enemies = enemiesFromLegacyState(state).map((enemy) => ({
    ...enemy,
    targetId: enemy.mode === 'bite' ? SOLO_HERO_ID : null,
  }));
  return {
    revision: 0,
    enemies,
    heroes: { [SOLO_HERO_ID]: { ...state.hero, lastCommandId: null } },
  };
}

function soloEnemiesFromParty(enemies) {
  return enemies.map((enemy) => {
    const { targetId, ...soloEnemy } = enemy;
    return { ...soloEnemy, patrol: enemy.patrol.map(clonePoint) };
  });
}

function heroFromParty(hero) {
  return {
    hp: hero.hp,
    maxHp: hero.maxHp,
    swingSeconds: hero.swingSeconds,
    cooldown: hero.cooldown,
    swingLanded: hero.swingLanded,
    downSeconds: hero.downSeconds,
  };
}

function stripHeroId(event) {
  if (!('heroId' in event)) return event;
  const { heroId, ...rest } = event;
  return rest;
}

function publishSolo(state, commandId, partyState) {
  return freezeSoloState({
    revision: state.revision + 1,
    lastCommandId: commandId ?? null,
    enemies: soloEnemiesFromParty(partyState.enemies),
    heroSpawn: clonePoint(state.heroSpawn),
    hero: heroFromParty(partyState.heroes[SOLO_HERO_ID]),
  });
}

export function requestAttack(state, commandId = null) {
  if (isReplayId(commandId, state.lastCommandId)) return { state, events: [], accepted: false };
  const result = requestPartyAttack(toPartyState(state), SOLO_HERO_ID, null);
  return {
    state: publishSolo(state, commandId, result.state),
    events: result.events.map(stripHeroId),
    accepted: result.accepted,
  };
}

export function stepEncounter(state, command = {}) {
  const {
    commandId = null,
    deltaSeconds = 0,
    heroPosition = { x: 0, z: 0 },
    heroHeading = 0,
    heroDamage = null,
    maxHp = null,
    heroTargetable = true,
    wolfHostile = true,
    attack = false,
  } = command;

  if (isReplayId(commandId, state.lastCommandId)) return { state, events: [] };

  let partyState = toPartyState(state);
  const events = [];
  if (attack) {
    const attacked = requestPartyAttack(partyState, SOLO_HERO_ID, null);
    partyState = attacked.state;
    events.push(...attacked.events.map(stripHeroId));
  }

  const stepped = stepParty(partyState, {
    deltaSeconds,
    wolfHostile,
    heroes: {
      [SOLO_HERO_ID]: {
        position: heroPosition,
        heading: heroHeading,
        heroDamage,
        maxHp,
        targetable: heroTargetable !== false,
      },
    },
  });
  events.push(...stepped.events.map(stripHeroId));

  return { state: publishSolo(state, commandId, stepped.state), events };
}

/** Legacy stateful adapter over the canonical collection seam. */
export function createEncounter(options = {}) {
  let state = createEncounterState(options);
  const pending = [];
  let nextCommandId = 1;

  return {
    get wolf() { return state.wolf; },
    get enemies() { return state.enemies; },
    get hero() { return state.hero; },
    get state() { return state; },
    canAttack() { return canAttack(state); },
    requestAttack() {
      const result = requestAttack(state, nextCommandId++);
      state = result.state;
      pending.push(...result.events);
      return result.accepted;
    },
    drainEvents() { return pending.splice(0, pending.length); },
    update(deltaSeconds, heroPosition, heroHeading) {
      const result = stepEncounter(state, {
        commandId: nextCommandId++,
        deltaSeconds,
        heroPosition,
        heroHeading,
      });
      state = result.state;
      pending.push(...result.events);
    },
  };
}
