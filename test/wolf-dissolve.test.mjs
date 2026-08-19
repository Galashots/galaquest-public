// The corpse problem. A beaten wolf used to lie on the ground for the whole ten-second respawn wait
// and then stand up and teleport to its spawn point, because the corpse and the fresh wolf are the
// same object. This is the pure half of the fix: what the presenter should be showing, from the
// wolf's published state alone. The fade itself is three.js opacity and is judged in captures.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  WOLF_APPEAR_RATE_PER_SECOND,
  WOLF_DISSOLVE_DELAY_SECONDS,
  WOLF_DISSOLVE_RATE_PER_SECOND,
  WOLF_SCALE,
  WOLF_SPARK_FADE_PER_SECOND,
  WOLF_SPARK_HEIGHT_METERS,
  WOLF_SPARK_LAST_HIT_STRENGTH,
  WOLF_SPARK_MIN_SIZE_FRACTION,
  WOLF_SPARK_PULSE_DEPTH,
  WOLF_SPARK_PULSE_HZ,
  WOLF_SPARK_STRENGTH,
  wolfPresenceTarget,
  wolfSparkTarget,
} from '../public/src/enemies/wolf.js';
import { DEATH_SECONDS, WOLF_MAX_HP, WOLF_RESPAWN_SECONDS } from '../public/src/combat/encounter.js';

test('a living wolf is solid in every living mode', () => {
  for (const mode of ['idle', 'walk', 'bite', 'hit']) {
    assert.equal(wolfPresenceTarget(mode, 0), 1, mode);
    assert.equal(wolfPresenceTarget(mode, 99), 1, `${mode} after a long time`);
  }
});

// The whole point of the delay: the child has to SEE the wolf go down. Dissolving during the death
// animation would turn the payoff for a won fight into a wolf that vanishes mid-stumble.
test('a wolf that is dying stays solid however long the death animation runs', () => {
  assert.equal(wolfPresenceTarget('dying', 0), 1);
  assert.equal(wolfPresenceTarget('dying', DEATH_SECONDS), 1);
});

test('a fallen wolf lies there for a beat, then goes', () => {
  assert.equal(wolfPresenceTarget('dead', 0), 1, 'it must not blink out the instant it lands');
  assert.equal(wolfPresenceTarget('dead', WOLF_DISSOLVE_DELAY_SECONDS - 0.01), 1);
  assert.equal(wolfPresenceTarget('dead', WOLF_DISSOLVE_DELAY_SECONDS), 0);
  assert.equal(wolfPresenceTarget('dead', 5), 0);
});

// This is the actual bug being closed, stated in the units a player experiences: by the time the
// server puts the wolf back at its spawn, the corpse must already be gone -- otherwise the thing the
// child sees is a body sliding across the ground.
test('the corpse is fully gone well before the respawn moves it', () => {
  const goneAt = WOLF_DISSOLVE_DELAY_SECONDS + 1 / WOLF_DISSOLVE_RATE_PER_SECOND;
  assert.ok(
    goneAt < WOLF_RESPAWN_SECONDS - 1,
    `the wolf is still visible ${goneAt.toFixed(2)}s into a ${WOLF_RESPAWN_SECONDS}s wait`,
  );
});

test('a respawned wolf is wanted back on screen immediately, and arrives quickly', () => {
  assert.equal(wolfPresenceTarget('idle', 0), 1, 'the respawn must not wait out another delay');
  assert.ok(
    1 / WOLF_APPEAR_RATE_PER_SECOND < 0.5,
    'a wolf stepping out of the trees should not take half a second to become solid',
  );
  assert.ok(
    WOLF_APPEAR_RATE_PER_SECOND > WOLF_DISSOLVE_RATE_PER_SECOND,
    'arriving should be quicker than leaving',
  );
});

// The stolen light: the reason a wolf is worth hunting, and the only thing telling a child which way
// to walk after one dies and the next appears somewhere else.
test('a living wolf carries the tree\'s light and lets go of it on the killing blow', () => {
  for (const mode of ['idle', 'walk', 'bite', 'hit']) {
    assert.equal(wolfSparkTarget(mode), 1, mode);
  }
  assert.equal(wolfSparkTarget('dying'), 0, 'the light has to leave BEFORE the body does');
  assert.equal(wolfSparkTarget('dead'), 0);
});

// The spark is the wolf's health bar. Before it was, how close a wolf was to going down could only be
// read off "wolf 3hp" in the debug pill -- jargon, at the bottom of the screen, while the child is
// looking at the wolf.
test('the stolen light dims as the wolf is beaten, one step per hit', () => {
  const steps = [];
  for (let hp = WOLF_MAX_HP; hp >= 1; hp -= 1) steps.push(wolfSparkTarget('idle', hp));
  assert.equal(steps[0], 1, 'an untouched wolf carries the whole light');
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(steps[i] < steps[i - 1], `hit ${i} did not dim it: ${steps[i - 1]} -> ${steps[i]}`);
  }
  assert.equal(steps.at(-1), WOLF_SPARK_LAST_HIT_STRENGTH, 'one hit left should read as one hit left');
});

test('a wolf on its last hit point is still findable from across the map', () => {
  assert.ok(WOLF_SPARK_LAST_HIT_STRENGTH > 0.25,
    'the spark is the only thing pointing at the next wolf -- it cannot go out while the wolf lives');
  assert.ok(WOLF_SPARK_LAST_HIT_STRENGTH < 0.75, 'and it has to visibly mean something');
  assert.ok(WOLF_SPARK_MIN_SIZE_FRACTION > 0.3 && WOLF_SPARK_MIN_SIZE_FRACTION < 1);
});

test('damage never brightens the spark, and a dying wolf is dark whatever its hp says', () => {
  // hp can arrive as 0 while the mode is still 'dying' -- mode has to win.
  assert.equal(wolfSparkTarget('dying', 0), 0);
  assert.equal(wolfSparkTarget('dead', WOLF_MAX_HP), 0);
  // Out-of-range hp clamps rather than over-brightening or going negative.
  assert.equal(wolfSparkTarget('idle', WOLF_MAX_HP * 5), 1);
  assert.equal(wolfSparkTarget('idle', -3), WOLF_SPARK_LAST_HIT_STRENGTH);
  assert.equal(wolfSparkTarget('idle', Number.NaN), 1, 'a missing hp reads as a whole wolf, not a dark one');
});

test('the light goes out faster than the body fades, so the two beats read as separate', () => {
  const lightGone = 1 / WOLF_SPARK_FADE_PER_SECOND;
  const bodyGone = WOLF_DISSOLVE_DELAY_SECONDS + 1 / WOLF_DISSOLVE_RATE_PER_SECOND;
  assert.ok(lightGone < bodyGone,
    `the light takes ${lightGone.toFixed(2)}s and the body ${bodyGone.toFixed(2)}s`);
});

test('the light rides above the wolf rather than inside it', () => {
  // The wolf stands 1.022m tall as authored, times WOLF_SCALE.
  assert.ok(WOLF_SPARK_HEIGHT_METERS > 1.022 * WOLF_SCALE * 0.9,
    'a spark buried in the fur is not a beacon');
  assert.ok(WOLF_SPARK_HEIGHT_METERS < 2, 'nor is one floating in the sky above it');
});

test('the pulse brightens and dims without ever going out or blowing out', () => {
  const peak = WOLF_SPARK_STRENGTH * (1 + WOLF_SPARK_PULSE_DEPTH);
  const trough = WOLF_SPARK_STRENGTH * (1 - WOLF_SPARK_PULSE_DEPTH);
  assert.ok(peak <= 1.05, `peak ${peak.toFixed(2)} clips`);
  assert.ok(trough > 0.4, `trough ${trough.toFixed(2)} loses the beacon between beats`);
  assert.ok(WOLF_SPARK_PULSE_HZ < 2, 'a fast blink reads as a warning light, not a carried flame');
});

test('a missing or nonsense modeSeconds does not make a wolf flicker', () => {
  assert.equal(wolfPresenceTarget('dead', undefined), 1);
  assert.equal(wolfPresenceTarget('dead', NaN), 1);
  assert.equal(wolfPresenceTarget(undefined, 99), 1, 'an unknown mode is a wolf you can still see');
});
