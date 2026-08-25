// P2 RESCALED THE WHOLE FIGHT BY TEN. THIS IS THE FILE THAT PROVES NOTHING CHANGED.
//
// Every combat number in the game moved in the same commit: the wolf 3 -> 30, the hero 3 -> 30, the
// starter sword 1 -> 10, the Wildwood Blade 2 -> 20, the Warden 12 -> 120, its blow 1 -> 10, Wren's
// charm one heart -> 10 HP. The reason is in combat/encounter.js's own header -- a scale of three
// cannot express a Hero level being worth +5 max HP -- but the RISK is the point of this file: a
// rescale is the change most likely to move a promise by accident, because every individual number
// looks obviously right on its own and only the ratios between them are the game.
//
// So the promises are pinned as promises, in the units a child actually experiences: HOW MANY BLOWS.
// Not hit points, not fractions, not percentages -- blows to kill and bites to fall, which are the
// only numbers anyone at the table ever noticed. docs/briefs/PROGRESSION_P2_FIRST_HERO_LEVEL_UP.md
// lists these six as required invariants; this is where they are enforced.
//
// AND THEY ARE MEASURED BY FIGHTING, not by arithmetic. docs/MISTAKES.md GQ-013 is explicit that a
// test which checks a value was stored proves the value exists and only a test of the EFFECT proves
// it does anything -- so every count below comes out of stepParty or stepSiege actually running,
// with the damage arriving over the real command seam. `Math.ceil(WOLF_MAX_HP / damage)` would be
// the same arithmetic the rules perform, checked against itself, which is the defect the ledger
// calls "a cross-check whose expected and actual values come from the same expression".
//
// If one of these fails, the question is not "which constant is wrong" but "which promise did we
// just break, and did we mean to".

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  ATTACK_COOLDOWN_SECONDS,
  HERO_MAX_HP,
  SWING_SECONDS,
  WOLF_BITE_COOLDOWN_SECONDS,
  createPartyEncounterState,
  requestPartyAttack,
  stepParty,
} from '../public/src/combat/encounter.js';
import {
  SEAL_BLOWS_TO_BREAK,
  WARDEN_MAX_HP,
  canSiegeHeroAttack,
  requestSiegeAttack,
  stepSiege,
  wardenPhaseFor,
} from '../public/src/world/beaconSiege.js';
import { STARTER_SWORD_ID, WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';
import { LEVEL_ONE } from '../public/src/progression/levels.js';
import {
  WREN_CHARM_MAX_HP_BONUS,
  resolvedHeroDamage,
  resolvedMaxHp,
} from '../public/src/progression/heroStats.js';

const STEP = 1 / 60;

// THE THREE PROMISES, as the pre-P2 game made them, named once so a reader can check the intent
// without hunting through the assertions. Each was true at the old scale and has to stay true.
const STARTER_BLOWS_TO_KILL_WOLF = 3;
const WILDWOOD_BLOWS_TO_KILL_WOLF = 2;
const BITES_TO_DOWN_A_FRESH_HERO = 3;
const STARTER_BLOWS_TO_KILL_WARDEN = 12;
const WILDWOOD_BLOWS_TO_KILL_WARDEN = 6;
const WARDEN_BLOWS_TO_DOWN_A_FRESH_HERO = 3;

// A Level-1 hero holding each weapon, resolved through the authority rather than typed. This is also
// the only place in the file that mentions a weapon id: everything below fights with a NUMBER,
// exactly as the rules layer does.
const LEVEL_1_STARTER = resolvedHeroDamage(LEVEL_ONE, STARTER_SWORD_ID);
const LEVEL_1_WILDWOOD = resolvedHeroDamage(LEVEL_ONE, WILDWOOD_BLADE_ID);

// ── the wolf ────────────────────────────────────────────────────────────────────────────────────

/**
 * Fight one fresh wolf to death with a hero who deals `heroDamage`, and count the blows that landed.
 *
 * The wolf is held off its own bite with an absurd cooldown -- a clock, so it simply never elapses --
 * because this measures blows to kill and a hero who goes down mid-count would be measuring the
 * respawn rule instead. That fight has its own tests in encounter.test.mjs.
 */
function blowsToKillTheWolf(heroDamage) {
  let state = createPartyEncounterState({ wolfSpawn: { x: 0, z: 0 }, heroIds: ['A'] });
  state = { ...state, wolf: { ...state.wolf, biteCooldown: 1e9 } };
  const heroes = { A: { position: { x: 0, z: -1 }, heading: 0, heroDamage } };

  let landed = 0;
  let serial = 0;
  for (let attempt = 0; attempt < 400 && state.wolf.mode !== 'dying' && state.wolf.mode !== 'dead'; attempt += 1) {
    const asked = requestPartyAttack(state, 'A', `blow-${serial += 1}`);
    state = asked.state;
    if (!asked.accepted) {
      state = stepParty(state, { deltaSeconds: STEP, heroes }).state;
      continue;
    }
    const before = state.wolf.hp;
    for (let elapsed = 0; elapsed < SWING_SECONDS + ATTACK_COOLDOWN_SECONDS + STEP; elapsed += STEP) {
      state = stepParty(state, { deltaSeconds: STEP, heroes }).state;
    }
    if (state.wolf.hp < before) landed += 1;
  }
  assert.equal(state.wolf.mode, 'dying', `the wolf survived a whole fight at ${heroDamage} damage`);
  return landed;
}

test('a fresh wolf still takes three Starter Sword blows from a Level-1 hero', () => {
  assert.equal(blowsToKillTheWolf(LEVEL_1_STARTER), STARTER_BLOWS_TO_KILL_WOLF);
});

test('a fresh wolf still takes two Wildwood Blade blows from a Level-1 hero', () => {
  assert.equal(blowsToKillTheWolf(LEVEL_1_WILDWOOD), WILDWOOD_BLOWS_TO_KILL_WOLF);
  assert.ok(WILDWOOD_BLOWS_TO_KILL_WOLF < STARTER_BLOWS_TO_KILL_WOLF,
    'the reward at the end of the longest promise in the game has to shorten the fight');
});

test('a Level-1 hero still falls to three wolf bites', () => {
  let state = createPartyEncounterState({ wolfSpawn: { x: 0, z: 0 }, heroIds: ['A'] });
  // Standing inside the wolf's reach and never swinging: this measures the BITE, so a hero who
  // fights back would be measuring the fight.
  const heroes = { A: { position: { x: 0, z: 1 }, heading: Math.PI } };

  const bites = [];
  let down = false;
  const budgetSeconds = WOLF_BITE_COOLDOWN_SECONDS * (BITES_TO_DOWN_A_FRESH_HERO + 3) + 5;
  for (let elapsed = 0; elapsed < budgetSeconds && !down; elapsed += STEP) {
    const result = stepParty(state, { deltaSeconds: STEP, heroes });
    state = result.state;
    for (const event of result.events) {
      if (event.type === 'hero-hurt') bites.push(event);
      if (event.type === 'hero-down') down = true;
    }
  }

  assert.equal(down, true, 'the wolf never managed to knock the hero down inside the time budget');
  assert.equal(bites.length, BITES_TO_DOWN_A_FRESH_HERO,
    'three mistakes, not one and not five -- the promise the old three-heart body made');
  assert.equal(state.heroes.A.hp, 0, 'and the last bite takes them exactly to nothing, not past it');
});

test('Wren\'s charm still buys exactly one more wolf bite', () => {
  // What the charm MEANT on the old scale: one more heart on a three-heart body, so a fourth bite.
  // Preserving "10 HP" without preserving that would be preserving a number rather than a reward.
  const charmed = resolvedMaxHp(LEVEL_ONE, { charmOwned: true });
  let state = createPartyEncounterState({ wolfSpawn: { x: 0, z: 0 }, heroIds: ['A'] });
  const heroes = { A: { position: { x: 0, z: 1 }, heading: Math.PI, maxHp: charmed } };

  let bites = 0;
  let down = false;
  const budgetSeconds = WOLF_BITE_COOLDOWN_SECONDS * (BITES_TO_DOWN_A_FRESH_HERO + 4) + 5;
  for (let elapsed = 0; elapsed < budgetSeconds && !down; elapsed += STEP) {
    const result = stepParty(state, { deltaSeconds: STEP, heroes });
    state = result.state;
    for (const event of result.events) {
      if (event.type === 'hero-hurt') bites += 1;
      if (event.type === 'hero-down') down = true;
    }
  }

  assert.equal(down, true, 'the charmed hero never went down inside the time budget');
  assert.equal(bites, BITES_TO_DOWN_A_FRESH_HERO + 1,
    `the charm is worth exactly one more mistake (${WREN_CHARM_MAX_HP_BONUS} HP on a ${HERO_MAX_HP} HP body)`);
});

// ── the Warden ──────────────────────────────────────────────────────────────────────────────────

/** A siege past the puzzle: seals burst, Warden awake at the origin. Same shape
 *  test/beacon-siege.test.mjs builds, kept local because these two files pin different properties
 *  and a shared fixture would couple them. */
function wardenFight({ wardenPassive = false, heroMaxHp = HERO_MAX_HP } = {}) {
  const sealsAt = [[-30, 0], [-30, 4], [-30, 8]];
  return {
    revision: 0,
    arena: { at: [0, 0], radiusMeters: 15 },
    sealsAt,
    wardenAt: [0, 0],
    seals: sealsAt.map(() => ({ blows: SEAL_BLOWS_TO_BREAK, burst: true })),
    warden: {
      x: 0, z: 0, heading: 0, hp: WARDEN_MAX_HP, mode: 'idle', modeSeconds: 0,
      phase: wardenPhaseFor(WARDEN_MAX_HP), targetId: null,
      // A clock, so an absurd value simply never elapses -- not a mode the rules could drift out of.
      attackCooldown: wardenPassive ? 1e9 : 0,
      attackLanded: false,
      attackCount: 0, meleeCount: 0, pulseQueued: false, blowsTaken: 0,
    },
    heroes: {
      A: {
        hp: heroMaxHp, swingSeconds: -1, cooldown: 0, swingLanded: false,
        downSeconds: -1, lastCommandId: null,
      },
    },
    beaconLit: false,
  };
}

function blowsToKillTheWarden(heroDamage) {
  let state = wardenFight({ wardenPassive: true });
  const heroes = { A: { position: { x: 0, z: -1.2 }, heading: 0, heroDamage } };
  let landed = 0;
  let serial = 0;
  for (let attempt = 0; attempt < 900 && state.warden.mode !== 'dying'; attempt += 1) {
    if (!canSiegeHeroAttack(state, 'A')) {
      state = stepSiege(state, { deltaSeconds: STEP, heroes }).state;
      continue;
    }
    const asked = requestSiegeAttack(state, 'A', `blow-${serial += 1}`);
    assert.equal(asked.accepted, true, 'a swing the rules said was legal was then refused');
    state = asked.state;
    const before = state.warden.hp;
    for (let elapsed = 0; elapsed < SWING_SECONDS + STEP; elapsed += STEP) {
      state = stepSiege(state, { deltaSeconds: STEP, heroes }).state;
    }
    if (state.warden.hp < before) landed += 1;
  }
  assert.equal(state.warden.mode, 'dying', `the Warden survived a whole fight at ${heroDamage} damage`);
  return landed;
}

test('a fresh Warden still takes twelve Starter Sword blows from a Level-1 hero', () => {
  assert.equal(blowsToKillTheWarden(LEVEL_1_STARTER), STARTER_BLOWS_TO_KILL_WARDEN);
});

test('a fresh Warden still takes six Wildwood Blade blows from a Level-1 hero', () => {
  assert.equal(blowsToKillTheWarden(LEVEL_1_WILDWOOD), WILDWOOD_BLOWS_TO_KILL_WARDEN);
});

test('a Level-1 hero still falls to three landed Warden attacks', () => {
  // The Warden's own comment prices itself at "three mistakes, not one -- a boss that two-shots a
  // young player teaches fear of trying". That sentence is the thing under test.
  let state = wardenFight();
  // Standing in melee and never swinging, so the count is of blows TAKEN.
  const heroes = { A: { position: { x: 0, z: 1.4 }, heading: Math.PI } };

  let struck = 0;
  let down = false;
  for (let elapsed = 0; elapsed < 60 && !down; elapsed += STEP) {
    const result = stepSiege(state, { deltaSeconds: STEP, heroes });
    state = result.state;
    for (const event of result.events) {
      if (event.type === 'warden-hurt-hero') struck += 1;
      if (event.type === 'hero-down') down = true;
    }
  }

  assert.equal(down, true, 'the Warden never knocked the hero down inside the time budget');
  assert.equal(struck, WARDEN_BLOWS_TO_DOWN_A_FRESH_HERO, 'three mistakes, not one');
});

// ── and the scale itself ────────────────────────────────────────────────────────────────────────

test('the rescale left room for a level to matter, which is the reason it happened', () => {
  // The whole justification for touching any of the numbers above: at the old resolution the
  // smallest meaningful stat change was a third of a hero's body. If a future re-tune ever shrinks
  // the scale back, these promises would start rounding into each other again, and this is the
  // assertion that says so out loud rather than leaving it to be rediscovered.
  const level2Gain = resolvedMaxHp(LEVEL_ONE + 1) - resolvedMaxHp(LEVEL_ONE);
  assert.ok(level2Gain >= 1, 'a level must be worth at least one whole hit point');
  assert.ok(level2Gain * BITES_TO_DOWN_A_FRESH_HERO < HERO_MAX_HP,
    'one level must not be worth so much that a single level-up rewrites the bite count');
  const damageGain = resolvedHeroDamage(LEVEL_ONE + 1, STARTER_SWORD_ID) - LEVEL_1_STARTER;
  assert.ok(damageGain >= 1, 'a level must be worth at least one whole point of damage');
  assert.ok(damageGain < LEVEL_1_STARTER,
    'one level must not be worth more than the starter sword itself, or levels would erase gear');
});
