// The golden trace: a fixed, deterministic command script driven through the party API
// (createPartyEncounterState, addHero, requestPartyAttack, stepParty) at the server's exact 0.05s
// tick cadence -- two heroes join, walk into range via scripted positions, one hero tanks alone
// until it goes down and respawns, then both heroes finish the wolf off. Every step's
// { state, events } is recorded.
//
// E1 deliberately changes the ordinary-enemy STATE SHAPE from one mutable `wolf` to canonical
// `enemies[]`. This test therefore checks the E1 collection facts first (one default enemy, stable
// `wolf-1` identity, `kind: 'wolf'`, derived `.wolf` agreement, identity on enemy events), then
// projects that one-Wolf state back to the historical behavioral shape before comparing it with the
// committed trace. That keeps this fixture answering the question it was created for -- did the
// shipped Wolf fight change? -- without duplicating the same enemy twice in every frame. The actual
// multi-enemy collection shape and order-independence are pinned by test/enemy-collection.test.mjs.
//
// TRACE_REGENERATE=1 writes test/fixtures/encounter-golden-trace.json from a fresh projected run.
// Without it, this test replays the same script and asserts every behavioral step is byte-identical
// to the committed fixture. A future behavior change is expected to change that fixture --
// deliberately, in its own commit -- not to make this test flaky.
//
// Nothing in the script below reads the wall clock or Math.random. The only state fed back into
// the script's own decisions (heroes.A.downSeconds, to know when A has gone down) is itself the
// pure output of ticks already applied, so re-running this file always produces the same trace for
// the same code -- which is exactly the claim under test.

import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  addHero,
  createPartyEncounterState,
  requestPartyAttack,
  stepParty,
} from '../public/src/combat/encounter.js';
// IMPORTED, not restated (Phase R2, docs/MISTAKES.md GQ-007). This was a third hand-written copy of
// `{ x: 2.5, z: 8 }`, and the drift guard that existed only watched the other two -- so this one
// could have gone stale silently and re-pinned the golden trace against a spawn the game no longer
// used. The value is byte-identical to the literal it replaces, so the fixture does NOT regenerate.
import { WOLF_SPAWN } from '../public/src/world/zones/village.js';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/encounter-golden-trace.json', import.meta.url));

// The server's own tick cadence (net/gameServer.mjs's loop), not a round number chosen for the test.
const STEP_SECONDS = 0.05;
// A ticks-since-A-went-down safety margin the script runs past a confirmed wolf-dead reading, so the
// fixture also pins a few steps of "stays dead" rather than stopping the instant death is reached.
const TICKS_PAST_DEATH = 5;
const MAX_TICKS = 600;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// main.js derives heading as atan2(x, z) -- see encounter.js's isWithinStrike comment.
function headingToward(from, to) {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

// Hero A tanks alone: walks in over 2s (40 ticks at 0.05s) to stand a metre off the wolf's spawn
// and holds there, never swinging until it has gone down and come back -- giving the wolf a clean,
// scripted run at landing bites without a second hero's approach disturbing its targeting.
function positionA(tick) {
  const start = { x: 1.5, z: 20 };
  const end = { x: 1.5, z: 8 };
  const t = Math.min(1, tick / 40);
  return { x: lerp(start.x, end.x, t), z: lerp(start.z, end.z, t) };
}

// Hero B waits far outside the wolf's aggro range (WOLF_AGGRO_RANGE is 6) until A has gone down,
// then walks in over 3s (60 ticks) to help finish the fight. B is never hurt in this script, so
// Design ruling 5's wipe-and-reset never fires here -- that rule has its own dedicated coverage in
// test/encounter-party.test.mjs; this trace is about determinism, not re-proving that rule.
function positionB(tick, aDownTick) {
  if (aDownTick === null) return { x: 3.5, z: -100 };
  const start = { x: 3.5, z: -100 };
  const end = { x: 3.5, z: 8 };
  const t = Math.min(1, (tick - aDownTick) / 60);
  return { x: lerp(start.x, end.x, t), z: lerp(start.z, end.z, t) };
}

/**
 * Assert the E1 collection contract for the default-world trace, then remove only the NEW identity
 * wrapper before comparing behavior with the pre-E1 fixture. This projection is intentionally
 * one-way: the simulation never consumes the derived `.wolf` view as authority.
 */
function oneWolfBehaviorStep(state, events) {
  assert.equal(state.enemies.length, 1, 'default trace must still contain exactly one ordinary enemy');
  const enemy = state.enemies.find((candidate) => candidate.enemyId === 'wolf-1');
  assert.ok(enemy, 'default trace must preserve stable Wolf identity');
  assert.equal(enemy.kind, 'wolf');
  assert.deepEqual(state.wolf, {
    x: enemy.x,
    z: enemy.z,
    heading: enemy.heading,
    hp: enemy.hp,
    mode: enemy.mode,
    modeSeconds: enemy.modeSeconds,
    biteCooldown: enemy.biteCooldown,
    biteLanded: enemy.biteLanded,
    targetId: enemy.targetId,
  });

  const projectedEvents = events.map((event) => {
    if (!('enemyId' in event) && !('kind' in event)) {
      const { protectionSeconds, ...legacyEvent } = event;
      return legacyEvent;
    }
    assert.equal(event.enemyId, enemy.enemyId, 'enemy event must carry the stable default Wolf id');
    assert.equal(event.kind, enemy.kind, 'enemy event must carry the default Wolf kind');
    const { enemyId, kind, level, protectionSeconds, ...legacyEvent } = event;
    return legacyEvent;
  });

  return {
    state: {
      revision: state.revision,
      wolfSpawn: state.wolfSpawn,
      wolfSpawns: state.wolfSpawns,
      wolfSpawnIndex: state.wolfSpawnIndex,
      wolf: state.wolf,
      heroes: state.heroes,
    },
    events: projectedEvents,
  };
}

/**
 * Run the fixed script through the party API and return every behavioral step's { state, events },
 * already JSON-safe. E1 identity is asserted by oneWolfBehaviorStep before the projection happens.
 */
function runTrace() {
  let state = createPartyEncounterState({ wolfSpawn: WOLF_SPAWN, heroIds: [] });
  state = addHero(state, 'A');
  state = addHero(state, 'B');

  const steps = [];
  let aDownTick = null;
  let deathSeenAtTick = null;
  let commandSeq = 0;

  for (let tick = 0; tick < MAX_TICKS; tick += 1) {
    const posA = positionA(tick);
    const posB = positionB(tick, aDownTick);
    const headingA = headingToward(posA, WOLF_SPAWN);
    const headingB = headingToward(posB, WOLF_SPAWN);

    if (aDownTick === null && state.heroes.A.downSeconds >= 0) aDownTick = tick;

    const events = [];
    // A attacks on a fixed cadence, but only once its post-respawn cooldown has had time to settle
    // (RESPAWN_SECONDS is 2s = 40 ticks; +10 more ticks of margin) and only while it is up.
    if (aDownTick !== null && tick > aDownTick + 50 && state.heroes.A.downSeconds < 0 && tick % 32 === 5) {
      const attacked = requestPartyAttack(state, 'A', `A:${commandSeq}`);
      commandSeq += 1;
      state = attacked.state;
      events.push(...attacked.events);
    }
    // B attacks on its own fixed cadence once it has had time to close in.
    if (aDownTick !== null && tick > aDownTick + 45 && state.heroes.B.downSeconds < 0
      && (tick - aDownTick) % 32 === 0) {
      const attacked = requestPartyAttack(state, 'B', `B:${commandSeq}`);
      commandSeq += 1;
      state = attacked.state;
      events.push(...attacked.events);
    }

    const stepped = stepParty(state, {
      deltaSeconds: STEP_SECONDS,
      heroes: {
        A: { position: posA, heading: headingA },
        B: { position: posB, heading: headingB },
      },
    });
    state = stepped.state;
    events.push(...stepped.events);

    steps.push(oneWolfBehaviorStep(state, events));

    if (state.wolf.mode === 'dead') {
      if (deathSeenAtTick === null) deathSeenAtTick = tick;
      if (tick >= deathSeenAtTick + TICKS_PAST_DEATH) break;
    }
  }

  assert.ok(deathSeenAtTick !== null, 'the scripted fight never killed the wolf -- script is broken');
  return JSON.parse(JSON.stringify(steps));
}

test('the golden trace replays byte-identical to the committed one-Wolf behavioral fixture', () => {
  const steps = runTrace();

  if (process.env.TRACE_REGENERATE === '1') {
    writeFileSync(FIXTURE_PATH, `${JSON.stringify(steps, null, 2)}\n`);
    return; // writing the fixture is not itself a claim of correctness -- see Task B5's steps
  }

  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  assert.equal(steps.length, fixture.length,
    'trace length changed against the committed fixture -- if this is an intended rules change, '
    + 'regenerate the fixture deliberately in its own commit rather than editing this assertion');
  for (let i = 0; i < steps.length; i += 1) {
    assert.deepEqual(steps[i], fixture[i], `step ${i} diverged from the golden trace`);
  }
});

test('the golden trace actually exercises a hero death, a respawn, and a wolf kill', () => {
  const steps = runTrace();
  const allEvents = steps.flatMap((step) => step.events);
  assert.ok(allEvents.some((e) => e.type === 'hero-down' && e.heroId === 'A'),
    'the script never downed A -- the fixture would not be exercising a respawn at all');
  assert.ok(allEvents.some((e) => e.type === 'hero-respawned' && e.heroId === 'A'),
    'A went down but never came back');
  assert.ok(allEvents.some((e) => e.type === 'wolf-defeated'),
    'the wolf was never actually killed by a landed swing');
  assert.equal(steps[steps.length - 1].state.wolf.mode, 'dead',
    'the trace must end with the wolf confirmed dead, not merely dying');
});
