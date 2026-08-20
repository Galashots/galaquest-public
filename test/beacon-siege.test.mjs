// The Old Beacon siege: three seals, the Warden, the fire.
//
// The interesting assertions in here are not "the maths works". They are the rulings that make the
// siege a fight a child can read -- each easy to break by accident while refactoring, none of which
// a screenshot re-checks on every commit:
//
//   1. Escalation, not repetition: a seal answers the first blow and falls on the second, and one
//      swing never damages two things.
//   2. The Warden is a thing that can be fought only between the wake and the death -- dormant and
//      waking it cannot be scratched, dead it never comes back.
//   3. Every attack is escapable BY ITS OWN ANSWER: step out of the overhead, get behind the sweep,
//      leave the pulse's ring. The contact checks are what make those answers true.
//   4. A wipe restarts the fight and never the puzzle.
//   5. Two simulations fed the same commands agree byte for byte -- the property the whole
//      server-and-offline split stands on (combat/encounter.js's header).
//
// Scripted fights drive the real seam (createSiegeState / requestSiegeAttack / stepSiege); the
// precision cases are driven from hand-built state literals instead, the same way
// test/encounter-party.test.mjs drives its wipe cases -- the documented state shape IS the wire
// shape, so constructing it directly tests the rule precisely instead of incidentally.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  ATTACK_HALF_ARC_RADIANS,
  ATTACK_REACH,
  HERO_MAX_HP,
  RESPAWN_SECONDS,
  SWING_SECONDS,
  WOLF_BITE_CONTACT_SECONDS,
  WOLF_SPEED,
} from '../public/src/combat/encounter.js';
import {
  SEAL_BLOWS_TO_BREAK,
  SEAL_EXTRA_REACH_METERS,
  WARDEN_ATTACK_COOLDOWN_PHASE2_SECONDS,
  WARDEN_ATTACK_COOLDOWN_SECONDS,
  WARDEN_DEATH_SECONDS,
  WARDEN_MAX_HP,
  WARDEN_MELEE_RANGE,
  WARDEN_OVERHEAD_CONTACT_SECONDS,
  WARDEN_PULSE_CONTACT_SECONDS,
  WARDEN_PULSE_RANGE,
  WARDEN_SPEED,
  WARDEN_STAGGER_EVERY_BLOWS,
  WARDEN_SWEEP_CONTACT_SECONDS,
  WARDEN_SWEEP_HALF_ARC_RADIANS,
  WARDEN_WAKE_SECONDS,
  addSiegeHero,
  canSiegeHeroAttack,
  createSiegeState,
  removeSiegeHero,
  requestSiegeAttack,
  stepSiege,
  wardenPhaseFor,
} from '../public/src/world/beaconSiege.js';

const STEP = 1 / 60;

let commandSerial = 0;
/** Ask for a swing and insist it was accepted -- a silently refused swing makes every assertion
 *  after it meaningless, so it fails HERE with a name rather than three lines later with a shrug. */
function swing(state, heroId = 'A') {
  const result = requestSiegeAttack(state, heroId, `t-${commandSerial += 1}`);
  assert.equal(result.accepted, true, `swing for ${heroId} was refused`);
  return result.state;
}

/** Advance `seconds` in fixed ticks. `command` is either the heroes block or a (tick) => block, so
 *  a hero can move mid-windup -- which is exactly what the escape tests need to prove. */
function run(state, seconds, command = {}) {
  const events = [];
  const ticks = Math.round(seconds / STEP);
  for (let tick = 0; tick < ticks; tick += 1) {
    const heroes = typeof command === 'function' ? command(tick) : command;
    const stepped = stepSiege(state, { deltaSeconds: STEP, heroes });
    events.push(...stepped.events);
    state = stepped.state;
  }
  return { state, events };
}

/** A siege already past the puzzle: seals burst, Warden awake and idle at the origin -- the shape
 *  stepSiege documents, built by hand so each fight test starts exactly where it means to. */
function fightState({ wardenHp = WARDEN_MAX_HP, warden = {}, heroes = { A: {} } } = {}) {
  // Seals parked far off-field so no fight-test swing can ever reach one by accident.
  const sealsAt = [[-30, 0], [-30, 4], [-30, 8]];
  const heroEntries = {};
  for (const [id, over] of Object.entries(heroes)) {
    heroEntries[id] = {
      hp: HERO_MAX_HP, swingSeconds: -1, cooldown: 0, swingLanded: false,
      downSeconds: -1, lastCommandId: null, ...over,
    };
  }
  return {
    revision: 0,
    arena: { at: [0, 0], radiusMeters: 15 },
    sealsAt,
    wardenAt: [0, 0],
    seals: sealsAt.map(() => ({ blows: SEAL_BLOWS_TO_BREAK, burst: true })),
    warden: {
      x: 0, z: 0, heading: 0, hp: wardenHp, mode: 'idle', modeSeconds: 0,
      phase: wardenPhaseFor(wardenHp), targetId: null,
      attackCooldown: 0, attackLanded: false,
      attackCount: 0, meleeCount: 0, pulseQueued: false, blowsTaken: 0,
      ...warden,
    },
    heroes: heroEntries,
    beaconLit: false,
  };
}

// A Warden that never fights back, for tests about hitting it: the cooldown is a clock, so an
// absurd value simply never elapses. Not a mode the rules could drift out of by accident.
const PASSIVE = { attackCooldown: 1e9 };

// Facing +Z from just south of the origin -- in reach of a Warden standing on it.
const FACING_WARDEN = { A: { position: { x: 0, z: -1.2 }, heading: 0 } };

/** One full landed blow on a passive Warden: request, then run the whole swing out. */
function landBlow(state) {
  state = swing(state);
  return run(state, SWING_SECONDS + 2 * STEP, FACING_WARDEN);
}

// ── the seals ───────────────────────────────────────────────────────────────────────────────────

test('a seal cracks on the first blow and bursts on exactly the second', () => {
  let state = createSiegeState({
    sealsAt: [[0, 2], [6, 2], [12, 2]],
    wardenAt: [0, 30],
    heroIds: ['A'],
  });
  const atSealZero = { A: { position: { x: 0, z: 0 }, heading: 0 } };

  state = swing(state);
  const first = run(state, SWING_SECONDS + 2 * STEP, atSealZero);
  assert.deepEqual(
    first.events.filter((e) => e.type.startsWith('seal-')),
    [{ type: 'seal-cracked', index: 0, heroId: 'A' }],
  );
  assert.deepEqual({ ...first.state.seals[0] }, { blows: 1, burst: false });

  const second = run(swing(first.state), SWING_SECONDS + 2 * STEP, atSealZero);
  assert.deepEqual(
    second.events.filter((e) => e.type.startsWith('seal-')),
    [{ type: 'seal-burst', index: 0, remaining: 2, heroId: 'A' }],
  );
  assert.equal(second.state.seals[0].burst, true);
  assert.equal(second.state.seals[1].blows, 0, 'the neighbours must be untouched');
  assert.equal(second.state.seals[2].blows, 0);
  // Two seals down of three is not the wake.
  assert.equal(second.state.warden.mode, 'dormant');
});

test('one swing resolves against at most one thing, even with two seals in reach', () => {
  let state = createSiegeState({
    // Both within reach of a hero at the origin; index 0 is nearer.
    sealsAt: [[0, 2], [0.6, 2], [12, 2]],
    wardenAt: [0, 30],
    heroIds: ['A'],
  });
  state = swing(state);
  const { state: after, events } = run(state, SWING_SECONDS + 2 * STEP, {
    A: { position: { x: 0, z: 0 }, heading: 0 },
  });
  assert.deepEqual(
    events.filter((e) => e.type.startsWith('seal-')),
    [{ type: 'seal-cracked', index: 0, heroId: 'A' }],
    'exactly one seal takes the blow, and it is the nearest',
  );
  assert.equal(after.seals[1].blows, 0, 'a blow that cuts two things reads as a bug, not a bonus');
});

test('sabotage: the seal reach check DOES fail -- a swing from beyond it finds nothing', () => {
  const beyond = ATTACK_REACH + SEAL_EXTRA_REACH_METERS + 0.1;
  let state = createSiegeState({
    sealsAt: [[0, beyond], [30, 4], [30, 8]],
    wardenAt: [0, 30],
    heroIds: ['A'],
  });
  state = swing(state);
  const { state: after, events } = run(state, SWING_SECONDS + 2 * STEP, {
    A: { position: { x: 0, z: 0 }, heading: 0 },
  });
  assert.deepEqual(events.filter((e) => e.type === 'siege-swing-missed'), [
    { type: 'siege-swing-missed', heroId: 'A' },
  ]);
  assert.equal(after.seals[0].blows, 0);
});

// ── dormancy and the wake ───────────────────────────────────────────────────────────────────────

test('the dormant Warden cannot be hurt: a swing straight into it misses', () => {
  let state = createSiegeState({
    sealsAt: [[30, 0], [30, 4], [30, 8]],
    wardenAt: [0, 1.5], // squarely inside ATTACK_REACH, dead ahead
    heroIds: ['A'],
  });
  state = swing(state);
  const { state: after, events } = run(state, SWING_SECONDS + 2 * STEP, {
    A: { position: { x: 0, z: 0 }, heading: 0 },
  });
  assert.ok(events.some((e) => e.type === 'siege-swing-missed'),
    'it is not yet a thing that can be fought, so the swing finds nothing');
  assert.equal(after.warden.hp, WARDEN_MAX_HP);
  assert.equal(after.warden.mode, 'dormant');
});

test('the Warden wakes on the third burst only, and is invulnerable while it rises', () => {
  let state = createSiegeState({
    sealsAt: [[0, 2], [6, 2], [12, 2]],
    wardenAt: [0, 30],
    heroIds: ['A'],
  });
  const events = [];
  // Two blows into each seal in turn, standing under it.
  for (let seal = 0; seal < 3; seal += 1) {
    for (let blow = 0; blow < SEAL_BLOWS_TO_BREAK; blow += 1) {
      state = swing(state);
      const result = run(state, SWING_SECONDS + 2 * STEP, {
        A: { position: { x: seal * 6, z: 0 }, heading: 0 },
      });
      events.push(...result.events);
      state = result.state;
      if (seal < 2) assert.ok(!events.some((e) => e.type === 'warden-woke'), 'two bursts must not wake it');
    }
  }
  assert.equal(events.filter((e) => e.type === 'seal-burst').length, 3);
  assert.equal(events.filter((e) => e.type === 'warden-woke').length, 1);
  assert.equal(state.warden.mode, 'waking');

  // A swing during the rise passes through it.
  state = swing(state);
  const duringWake = run(state, SWING_SECONDS + 2 * STEP, {
    A: { position: { x: 0, z: 28.8 }, heading: 0 },
  });
  assert.ok(duringWake.events.some((e) => e.type === 'siege-swing-missed'),
    'invulnerable-but-visible: free hits into the wake teach button-mashing at cutscenes');
  assert.equal(duringWake.state.warden.hp, WARDEN_MAX_HP);

  // And the rise ends on its own clock.
  const risen = run(duringWake.state, WARDEN_WAKE_SECONDS, {
    A: { position: { x: 0, z: 28.8 }, heading: 0 },
  });
  assert.notEqual(risen.state.warden.mode, 'waking');
  assert.notEqual(risen.state.warden.mode, 'dormant');
});

// ── the overhead ────────────────────────────────────────────────────────────────────────────────

test('the overhead lands on a target still in front and in range at contact time', () => {
  const state = fightState();
  const { state: after, events } = run(state, WARDEN_OVERHEAD_CONTACT_SECONDS + 0.2, {
    A: { position: { x: 0, z: 1.5 }, heading: Math.PI },
  });
  assert.equal(after.warden.mode, 'overhead');
  assert.deepEqual(events.filter((e) => e.type === 'warden-hurt-hero'), [
    { type: 'warden-hurt-hero', remaining: HERO_MAX_HP - 1, heroId: 'A' },
  ]);
});

test('the overhead misses a hero who steps OUT OF RANGE during the windup', () => {
  const state = fightState();
  // In melee long enough to bait the attack, then gone before the 1.1s contact.
  const dodging = (tick) => ({
    A: { position: tick < 30 ? { x: 0, z: 1.5 } : { x: 0, z: 8 }, heading: 0 },
  });
  const { state: after, events } = run(state, 2.0, dodging);
  assert.equal(events.filter((e) => e.type === 'warden-hurt-hero').length, 0,
    'a child who learned to step out must actually escape');
  assert.equal(after.warden.attackLanded, true, 'the contact was spent on empty air, not deferred');
});

test('the overhead misses a hero who circles BEHIND it during the windup', () => {
  const state = fightState();
  const circling = (tick) => ({
    A: { position: tick < 18 ? { x: 0, z: 1.5 } : { x: 0, z: -1.5 }, heading: 0 },
  });
  const { events } = run(state, 2.0, circling);
  assert.equal(events.filter((e) => e.type === 'warden-hurt-hero').length, 0,
    'still in melee range, but out of the front arc -- the arc check must be live at contact');
});

// ── the sweep ───────────────────────────────────────────────────────────────────────────────────

test('two heroes point-blank draw a sweep, and it hits both -- but not the one behind it', () => {
  const state = fightState({ heroes: { A: {}, B: {}, C: {} } });
  const { state: after, events } = run(state, WARDEN_SWEEP_CONTACT_SECONDS + 0.1, {
    A: { position: { x: 0, z: 1.2 }, heading: 0 },
    B: { position: { x: 0.6, z: 1.2 }, heading: 0 },
    C: { position: { x: 0, z: -1.5 }, heading: 0 }, // in melee range, squarely behind
  });
  assert.equal(after.warden.mode, 'sweep', 'two or more in its face must ALWAYS be a sweep');
  const hurt = events.filter((e) => e.type === 'warden-hurt-hero').map((e) => e.heroId).sort();
  assert.deepEqual(hurt, ['A', 'B'], 'everyone in the front arc, at once');
  assert.equal(after.heroes.C.hp, HERO_MAX_HP, 'the back arc is the escape, so it must be safe');
});

test('a lone hero standing in reads two overheads, then the third melee attack is the sweep', () => {
  const state = fightState();
  const standingIn = { A: { position: { x: 0, z: 1.5 }, heading: 0 } };
  const attacks = [];
  let previousMode = state.warden.mode;
  let current = state;
  for (let tick = 0; tick < Math.round(9 / STEP); tick += 1) {
    const stepped = stepSiege(current, { deltaSeconds: STEP, heroes: standingIn });
    current = stepped.state;
    const mode = current.warden.mode;
    if (mode !== previousMode && (mode === 'overhead' || mode === 'sweep' || mode === 'pulse')) {
      attacks.push(mode);
    }
    previousMode = mode;
  }
  assert.deepEqual(attacks, ['overhead', 'overhead', 'sweep'],
    'the sweep cadence is a counter, so a solo child still meets the move');
});

// ── the pulse ───────────────────────────────────────────────────────────────────────────────────

test('the pulse never fires in phase 1, even when its counter and queue both say go', () => {
  // Full hearts -- phase 1 -- but a queued pulse and a cadence-ripe counter. The gate must hold.
  const state = fightState({ warden: { pulseQueued: true, attackCount: 3 } });
  const { state: after } = run(state, 0.1, { A: { position: { x: 0, z: 1.5 }, heading: 0 } });
  assert.equal(after.warden.mode, 'overhead', 'the ring is phase 2\'s move, not phase 1\'s');
});

test('the pulse ignores facing but respects its range', () => {
  const state = fightState({ wardenHp: 7, warden: { pulseQueued: true }, heroes: { A: {}, B: {} } });
  const positions = {
    A: { position: { x: 0, z: -2 }, heading: 0 },  // behind the Warden, inside the ring
    B: { position: { x: 0, z: 5 }, heading: 0 },   // in front of it, outside the ring
  };
  const { state: after, events } = run(state, WARDEN_PULSE_CONTACT_SECONDS + 0.1, positions);
  assert.equal(after.warden.mode, 'pulse');
  assert.deepEqual(events.filter((e) => e.type === 'warden-hurt-hero'), [
    { type: 'warden-hurt-hero', remaining: HERO_MAX_HP - 1, heroId: 'A' },
  ], 'behind-and-near is hit, ahead-and-far is spared: distance is the ONLY answer to the ring');
  assert.equal(after.heroes.B.hp, HERO_MAX_HP);
  assert.equal(after.warden.pulseQueued, false, 'the phase-entry pulse is spent, not repeated');
});

// ── phases ──────────────────────────────────────────────────────────────────────────────────────

test('the phase ladder sits exactly on its fractions, inclusive at the lines', () => {
  assert.equal(wardenPhaseFor(WARDEN_MAX_HP), 1);
  assert.equal(wardenPhaseFor(8), 1);
  assert.equal(wardenPhaseFor(WARDEN_MAX_HP * 0.6 + 0.001), 1);
  assert.equal(wardenPhaseFor(WARDEN_MAX_HP * 0.6), 2, 'AT 60% is already phase 2');
  assert.equal(wardenPhaseFor(7), 2);
  assert.equal(wardenPhaseFor(4), 2);
  assert.equal(wardenPhaseFor(WARDEN_MAX_HP * 0.25), 3, 'AT 25% is already phase 3');
  assert.equal(wardenPhaseFor(3), 3);
  assert.equal(wardenPhaseFor(1), 3);
});

test('crossing a phase line raises warden-phase and queues the announcing pulse', () => {
  const into2 = landBlow(fightState({ wardenHp: 8, warden: PASSIVE }));
  assert.deepEqual(into2.events.filter((e) => e.type === 'warden-phase'), [{ type: 'warden-phase', phase: 2 }]);
  assert.deepEqual(into2.events.filter((e) => e.type === 'warden-hit'), [
    { type: 'warden-hit', remaining: 7, heroId: 'A' },
  ]);
  assert.equal(into2.state.warden.pulseQueued, true);

  const into3 = landBlow(fightState({ wardenHp: 4, warden: PASSIVE }));
  assert.deepEqual(into3.events.filter((e) => e.type === 'warden-phase'), [{ type: 'warden-phase', phase: 3 }]);
  assert.equal(into3.state.warden.phase, 3);
});

// ── the stagger ─────────────────────────────────────────────────────────────────────────────────

test('the Warden staggers on the third landed blow, and only the third', () => {
  let state = fightState({ warden: PASSIVE });
  for (let blow = 1; blow <= WARDEN_STAGGER_EVERY_BLOWS; blow += 1) {
    state = swing(state);
    // Stop just past contact, where a stagger would be visible before it wears off.
    const atContact = run(state, 0.55, FACING_WARDEN);
    if (blow < WARDEN_STAGGER_EVERY_BLOWS) {
      assert.notEqual(atContact.state.warden.mode, 'hit',
        `blow ${blow} must not flinch it -- two children must never own its clock`);
    } else {
      assert.equal(atContact.state.warden.mode, 'hit', 'the third blow is the visible reward');
    }
    // Let the swing (and any stagger) run out before the next.
    state = run(atContact.state, SWING_SECONDS, FACING_WARDEN).state;
  }
});

// ── defeat, and what it latches ─────────────────────────────────────────────────────────────────

test('defeat: warden-defeated, the Beacon lights, the standing are healed to full, the dead stay down', () => {
  let state = fightState({
    wardenHp: 1,
    warden: PASSIVE,
    heroes: {
      A: { hp: 1 },                       // lands the blow on his last heart
      B: { hp: 2 },                       // standing, hurt, elsewhere
      C: { hp: 0, downSeconds: 0.5 },     // down when it falls
    },
  });
  state = swing(state);
  const { state: after, events } = run(state, 0.6, {
    A: { position: { x: 0, z: -1.2 }, heading: 0 },
    B: { position: { x: 20, z: 20 }, heading: 0 },
    C: { position: { x: 20, z: 22 }, heading: 0 },
  });

  const types = events.map((e) => e.type);
  assert.ok(types.indexOf('warden-defeated') !== -1);
  assert.deepEqual(events.find((e) => e.type === 'warden-defeated'), { type: 'warden-defeated', heroId: 'A' });
  assert.ok(types.indexOf('warden-defeated') < types.indexOf('beacon-ignited'),
    'the fall is the cause, the fire is the effect -- same step, that order');
  assert.equal(after.beaconLit, true);
  assert.equal(after.warden.mode, 'dying');

  const healed = events.filter((e) => e.type === 'hero-healed').map((e) => e.heroId).sort();
  assert.deepEqual(healed, ['A', 'B'], 'everyone standing, wherever they stand -- and nobody down');
  assert.equal(after.heroes.A.hp, HERO_MAX_HP, 'to FULL: the moment after a boss is for cheering');
  assert.equal(after.heroes.B.hp, HERO_MAX_HP);
});

test('the dead Warden never comes back, and beaconLit never goes out', () => {
  let state = fightState({ wardenHp: 1, warden: PASSIVE, heroes: { A: {} } });
  state = swing(state);
  let result = run(state, 0.6, FACING_WARDEN);
  result = run(result.state, WARDEN_DEATH_SECONDS + 0.1, FACING_WARDEN);
  assert.equal(result.state.warden.mode, 'dead');

  const later = run(result.state, 30, FACING_WARDEN);
  assert.equal(later.state.warden.mode, 'dead', 'a beaten boss coming back would un-tell the story');
  assert.equal(later.state.beaconLit, true, 'the latch holds');
});

// ── the wipe ────────────────────────────────────────────────────────────────────────────────────

test('a wipe restarts the fight but THE WARDEN KEEPS ITS WOUNDS -- and the seals stay broken', () => {
  // Warden mid-fight and away from home; the last hero has one heart under its overhead.
  const state = fightState({
    wardenHp: 5,
    warden: { x: 4 },
    heroes: { A: { hp: 1 } },
  });
  const underIt = { A: { position: { x: 4, z: 1.5 }, heading: 0 } };
  const { state: after, events } = run(state, 1.6, underIt);

  assert.equal(events.filter((e) => e.type === 'siege-reset').length, 1, 'once per wipe, not per tick');
  assert.ok(events.some((e) => e.type === 'hero-down' && e.heroId === 'A'));
  // THE RULE THIS TEST EXISTS FOR. It pinned `hp === WARDEN_MAX_HP` until the fight was actually
  // simulated: solo against a hero who never retreats, a full heal per death produced 33 deaths, 33
  // heals and a Warden that never fell below half -- an unwinnable treadmill in which a child who
  // goes down once loses every blow they landed. See resetWardenAfterWipe's own comment.
  assert.equal(after.warden.hp, 5, 'I hurt it and it STAYS hurt');
  assert.equal(after.warden.phase, wardenPhaseFor(5), 'phase stays derived from the damage done');
  assert.notEqual(after.warden.mode, 'dormant', 'a wipe restarts the fight, not the puzzle');
  assert.ok(after.seals.every((seal) => seal.burst), 'and never the puzzle: the seals stay broken');
  assert.equal(after.beaconLit, false);
  assert.ok(after.warden.x < 4, `it walks home rather than teleporting (x ${after.warden.x.toFixed(2)})`);
  // Its composure DOES reset, so it resumes its post cleanly rather than finishing a swing at
  // somebody who is no longer standing.
  assert.equal(after.warden.targetId, null);
  assert.equal(after.warden.blowsTaken, 0);

  // Still homeward while the party is down.
  const later = run(after, 0.3, underIt);
  assert.ok(later.state.warden.x < after.warden.x);
});

// THE QUESTION EVERY OTHER TEST IN THIS FILE DANCES AROUND: can a child actually win this?
//
// Simulated rather than reasoned about, because the reasoning is what got the wipe rule wrong. A
// deliberately UNSKILLED solo hero -- walks in, swings whenever the rules allow, never retreats,
// never dodges a telegraph, dies repeatedly -- must still get there in the end. That is the floor
// this fight is designed to clear: persistence alone beats it, skill just makes it faster.
test('a stubborn solo child with no dodging skill still beats the Warden eventually', () => {
  let state = fightState({});
  let ticks = 0;
  let downs = 0;
  // 0.05 s steps, capped well past any plausible fight so a regression fails rather than hangs.
  while (!state.beaconLit && ticks < 12000) {
    const warden = state.warden;
    // Stand right next to it, always facing it. No retreat, no positioning, no patience.
    const position = { x: warden.x, z: warden.z - 1.4 };
    const heading = Math.atan2(warden.x - position.x, warden.z - position.z);
    if (canSiegeHeroAttack(state, 'A')) {
      state = requestSiegeAttack(state, 'A', `swing-${ticks}`).state;
    }
    const stepped = stepSiege(state, { deltaSeconds: 0.05, heroes: { A: { position, heading } } });
    state = stepped.state;
    downs += stepped.events.filter((event) => event.type === 'hero-down').length;
    ticks += 1;
  }
  assert.equal(state.beaconLit, true, `the Beacon must light in the end (gave up after ${ticks} ticks)`);
  assert.equal(state.warden.hp, 0);
  // It is not supposed to be a walkover either -- an unskilled hero really does get knocked down.
  assert.ok(downs > 0, 'a hero who never dodges should still be punished for it');
});

test('a downed hero stands back up on the wolf engine\'s own respawn clock, at full hearts', () => {
  const state = fightState({ heroes: { A: { hp: 1 } } });
  const underIt = { A: { position: { x: 0, z: 1.5 }, heading: 0 } };
  const downed = run(state, 1.3, underIt);
  assert.ok(downed.events.some((e) => e.type === 'hero-down' && e.heroId === 'A'));

  const up = run(downed.state, RESPAWN_SECONDS + 0.1, underIt);
  assert.ok(up.events.some((e) => e.type === 'hero-respawned' && e.heroId === 'A'));
  assert.equal(up.state.heroes.A.hp, HERO_MAX_HP);
  assert.equal(up.state.heroes.A.downSeconds, -1);
});

// ── the seam: joins, replay, freezing ───────────────────────────────────────────────────────────

test('addSiegeHero and removeSiegeHero are idempotent, and leaving clears the Warden\'s target', () => {
  const state = createSiegeState({ heroIds: ['A'] });
  const withB = addSiegeHero(state, 'B');
  assert.equal(addSiegeHero(withB, 'B'), withB, 'a duplicate join must not reset the hero');
  assert.equal(removeSiegeHero(withB, 'ghost'), withB, 'removing a stranger changes nothing');

  const targeting = fightState({ warden: { targetId: 'A' } });
  const gone = removeSiegeHero(targeting, 'A');
  assert.equal(gone.warden.targetId, null, 'a stale id must never be looked up in stepSiege');
  assert.ok(!('A' in gone.heroes));
});

test('replaying the same commandId is a no-op, and the gate matches canSiegeHeroAttack', () => {
  const state = createSiegeState({ heroIds: ['A'] });
  assert.equal(canSiegeHeroAttack(state, 'A'), true);
  assert.equal(canSiegeHeroAttack(state, 'ghost'), false);

  const first = requestSiegeAttack(state, 'A', 'cmd-1');
  assert.equal(first.accepted, true);
  assert.equal(first.state.heroes.A.swingSeconds, 0);
  assert.equal(canSiegeHeroAttack(first.state, 'A'), false, 'mid-swing, the button must grey out');

  const replay = requestSiegeAttack(first.state, 'A', 'cmd-1');
  assert.equal(replay.accepted, false);
  assert.equal(replay.state, first.state, 'a retried command after a dropped ack must not swing twice');
  assert.deepEqual(replay.events, []);

  const stranger = requestSiegeAttack(state, 'ghost', 'cmd-2');
  assert.equal(stranger.accepted, false);
  assert.equal(stranger.state, state);
});

test('published state is frozen: a write through it throws instead of desyncing', () => {
  const state = createSiegeState({ heroIds: ['A'] });
  assert.throws(() => { state.warden.hp = 1; }, TypeError);
  assert.throws(() => { state.seals[0].blows = 9; }, TypeError);
  assert.throws(() => { state.heroes.A.hp = 0; }, TypeError);
  assert.throws(() => { state.beaconLit = true; }, TypeError);
  const { state: stepped } = stepSiege(state, { deltaSeconds: STEP });
  assert.throws(() => { stepped.warden.x = 99; }, TypeError, 'stepped states are as frozen as fresh ones');
});

// ── determinism ─────────────────────────────────────────────────────────────────────────────────
//
// The property the whole server-and-offline split stands on: two simulations fed the same commands
// agree byte for byte. Driven through the WHOLE arc -- seals, wake, fight -- rather than a corner
// of it, because the cadence counters (sweep, pulse) are exactly where hidden randomness or
// iteration-order dependence would creep in.

function scriptedSiege(nudged = false) {
  let state = createSiegeState({
    arena: { at: [5, 5], radiusMeters: 14 },
    sealsAt: [[0, 2], [5, 2], [10, 2]],
    wardenAt: [5, 8],
    heroIds: ['A', 'B'],
  });
  const events = [];
  for (let tick = 0; tick < 1800; tick += 1) { // 30 simulated seconds
    const seal = Math.min(2, Math.floor(tick / 360));
    const aPos = tick < 1080 ? { x: seal * 5, z: 0 } : { x: 4.6, z: 6.8 };
    const bPos = nudged && tick >= 900 ? { x: 6.5, z: 6.6 } : { x: 5, z: 6.6 };
    if (tick % 100 === 0) {
      for (const heroId of ['A', 'B']) {
        const asked = requestSiegeAttack(state, heroId, `${heroId}-${tick}`);
        events.push(...asked.events);
        state = asked.state;
      }
    }
    const stepped = stepSiege(state, {
      deltaSeconds: STEP,
      heroes: { A: { position: aPos, heading: 0 }, B: { position: bPos, heading: 0 } },
    });
    events.push(...stepped.events);
    state = stepped.state;
  }
  return { state, events };
}

test('two identical runs agree byte for byte, and the script really reaches the fight', () => {
  const one = scriptedSiege();
  const two = scriptedSiege();
  assert.equal(JSON.stringify(one.state), JSON.stringify(two.state));
  assert.deepEqual(one.events, two.events);
  // The agreement is only worth something if the run exercised the machine.
  assert.ok(one.events.some((e) => e.type === 'warden-woke'), 'the script never woke the Warden');
  assert.ok(one.events.some((e) => e.type === 'warden-hurt-hero'), 'the Warden never landed a blow');
});

test('sabotage: the determinism check DOES fail when the inputs differ', () => {
  const straight = scriptedSiege();
  const nudged = scriptedSiege(true);
  assert.notEqual(JSON.stringify(straight.state), JSON.stringify(nudged.state),
    'if a moved hero cannot change the outcome, the byte-for-byte check above proves nothing');
});

// ── the constants keep their promises to each other ─────────────────────────────────────────────

test('the Warden is slower than the wolf, and the scariest move has the longest telegraph', () => {
  assert.ok(WARDEN_SPEED < WOLF_SPEED, 'its menace is inevitability, not speed');
  assert.ok(WARDEN_PULSE_CONTACT_SECONDS > WARDEN_SWEEP_CONTACT_SECONDS);
  assert.ok(WARDEN_SWEEP_CONTACT_SECONDS > WARDEN_OVERHEAD_CONTACT_SECONDS,
    'the more people an attack punishes, the more warning it owes');
  assert.ok(WARDEN_OVERHEAD_CONTACT_SECONDS > WOLF_BITE_CONTACT_SECONDS * 2,
    'a boss telegraphs in a way a wolf does not have to');
  assert.ok(WARDEN_ATTACK_COOLDOWN_PHASE2_SECONDS < WARDEN_ATTACK_COOLDOWN_SECONDS,
    'the late fight quickens its cadence -- and ONLY its cadence');
  assert.ok(WARDEN_MELEE_RANGE > ATTACK_REACH,
    'out-reach the hero or the step-out-step-in rhythm cannot exist');
  assert.ok(WARDEN_PULSE_RANGE > WARDEN_MELEE_RANGE, 'the ring must reach past its arms');
  assert.ok(WARDEN_SWEEP_HALF_ARC_RADIANS > ATTACK_HALF_ARC_RADIANS,
    'the sweep is wider than a sword swing, or standing beside it would be safe');
  assert.ok(WARDEN_SWEEP_HALF_ARC_RADIANS < Math.PI * 0.75,
    'and it must leave a real back arc to escape into');
});

// ── THE BLADE HAS TO CUT DEEPER ────────────────────────────────────────────────────────────────
//
// G4 hands a child the Wildwood Blade at the end of the longest promise in the game, an unlock card
// turns over, and the Hero screen prints "2 DAMAGE" off progression/items.js. For two chapters
// nothing read that number: every blow anywhere took off a flat WOLF_DAMAGE_PER_HIT, so the reward
// swung exactly like the sword they started with. These pin the fix at the rules layer, where it is
// the only place it can be checked without a browser.

test('a sharper sword takes the Warden down in fewer blows', () => {
  const blows = (weaponDamage) => {
    // The hero is given more hearts than the fight can take off, so this measures ONE thing --
    // blows to kill -- rather than incidentally measuring going down, respawning and the
    // wipe-reset rule, all of which have their own tests above.
    let state = fightState({ heroes: { A: { hp: 99 } } });
    const heroes = { A: { position: { x: 0, z: 1.2 }, heading: Math.PI, weaponDamage } };
    let landed = 0;
    for (let attempt = 0; attempt < 400 && state.warden.mode !== 'dying'; attempt += 1) {
      if (!canSiegeHeroAttack(state, 'A')) { state = run(state, STEP, heroes).state; continue; }
      state = swing(state);
      const before = state.warden.hp;
      state = run(state, SWING_SECONDS, heroes).state;
      if (state.warden.hp < before) landed += 1;
    }
    assert.equal(state.warden.mode, 'dying', `the Warden survived the fight at ${weaponDamage} damage`);
    return landed;
  };
  const withStarter = blows(1);
  const withBlade = blows(2);
  assert.equal(withStarter, WARDEN_MAX_HP, 'the starter sword is one heart a blow, as it always was');
  assert.equal(withBlade, Math.ceil(WARDEN_MAX_HP / 2), 'the Blade is worth two');
  assert.ok(withBlade < withStarter, 'and a child can FEEL the difference, which is the whole point');
});

test('a swing that names no weapon still lands, for exactly what it always did', () => {
  // The regression that matters most: every caller written before equipment was wired up -- and
  // every test in this repo that drives the seam directly -- passes no weaponDamage at all. If that
  // ever resolved to zero, swords would silently stop working for all of them.
  const heroes = { A: { position: { x: 0, z: 1.2 }, heading: Math.PI } };
  let state = fightState();
  state = swing(state);
  state = run(state, SWING_SECONDS, heroes).state;
  assert.equal(state.warden.hp, WARDEN_MAX_HP - 1, 'an unnamed weapon is the starter sword, not nothing');
});

test('but a sharper sword does NOT crack a cold seal any faster', () => {
  // Deliberate asymmetry, and it is a design statement rather than an oversight: a seal is not a
  // health bar, it is two blows and then it bursts. Keeping the arc's opening beat identical for
  // every child regardless of what they walked in carrying is worth more than the consistency, and
  // it puts the Blade's reward where a fight is rather than where a lock is.
  const sealsAt = [[0, 2]];
  const base = {
    revision: 0,
    arena: { at: [0, 0], radiusMeters: 15 },
    sealsAt,
    wardenAt: [40, 40],
    seals: [{ blows: 0, burst: false }],
    warden: {
      x: 40, z: 40, heading: 0, hp: WARDEN_MAX_HP, mode: 'dormant', modeSeconds: 0,
      phase: wardenPhaseFor(WARDEN_MAX_HP), targetId: null,
      attackCooldown: 0, attackLanded: false,
      attackCount: 0, meleeCount: 0, pulseQueued: false, blowsTaken: 0,
    },
    heroes: {
      A: {
        hp: HERO_MAX_HP, swingSeconds: -1, cooldown: 0, swingLanded: false,
        downSeconds: -1, lastCommandId: null,
      },
    },
    beaconLit: false,
  };
  const heroes = { A: { position: { x: 0, z: 0.9 }, heading: 0, weaponDamage: 99 } };
  let state = swing(base);
  state = run(state, SWING_SECONDS, heroes).state;
  assert.equal(state.seals[0].blows, 1, 'one blow is one blow, however sharp');
  assert.equal(state.seals[0].burst, false, 'and a seal takes SEAL_BLOWS_TO_BREAK of them, always');
});
