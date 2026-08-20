// The three cold seals at the Beacon's base: the Beacon arc's first attackable clause.
//
// What is worth pinning here is not "the maths works" but the decisions that make the seals fight
// well on two iPads at once and stay inside the zone's light grammar:
//
//   1. The shapes are FIXED and index-driven -- both players must draw the same three seals.
//   2. The three are siblings, not copies, and every prism is chunky enough to survive at 90 px.
//   3. The wound is VISIBLE: cracked geometry really differs, the accent really brightens.
//   4. The glow never competes with a lit lamp -- these are wrongness, not light.
//   5. The collapse borrows the bramble's own tempo instead of inventing a second one.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import * as THREE from '../public/vendor/three.module.min.js';
import {
  BEACON_EMBER_COLD_COLOR,
  BEACON_GLOW_COLOR,
  BEACON_GLOW_REST,
  BEACON_GLOW_STIR_PEAK,
  BEACON_STONE_COLOR,
} from '../public/src/world/oldBeacon.js';
import { BRAMBLE_FALL_SECONDS } from '../public/src/world/bramble.js';
import {
  SEAL_ACCENT_CRACKED_COLOR,
  SEAL_BURST_SECONDS,
  SEAL_BURST_SPARKS,
  SEAL_CRACK_SPLAY_RADIANS,
  SEAL_FALL_SECONDS,
  SEAL_GLOW_CRACKED,
  SEAL_GLOW_REST,
  SEAL_HEIGHTS_METERS,
  SEAL_RING_RADIUS_METERS,
  SEAL_SHARD_COUNTS,
  SEAL_SHARD_MIN_DIAMETER_METERS,
  sealBurstFrame,
  sealCollapseFrame,
  sealParts,
  sealShimmerStrength,
} from '../public/src/world/coldSeals.js';

// The gate lamp's lit strength, restated the way test/old-beacon.test.mjs restates it: the constant
// is private to wildwoodGate.js (LAMP_GLOW_STRENGTH), and this check is what stops the restatement
// drifting unnoticed -- if the lamp ever dims below the seals, the fixture is wrong out loud.
const GATE_LAMP_LIT_STRENGTH = 0.9;

const shardsOf = (parts) => parts.filter((part) => part.name.endsWith('shard'));
const topOf = (part) => part.at[1] + (part.kind === 'box' ? part.size[1] : part.height) / 2;

// ── fixed, index-driven, never random ─────────────────────────────────────────────────────────────

test('the same index always yields the same seal -- both iPads must draw the same thing', () => {
  for (let index = 0; index < 3; index += 1) {
    assert.equal(JSON.stringify(sealParts(index)), JSON.stringify(sealParts(index)));
    assert.equal(JSON.stringify(sealParts(index, 1)), JSON.stringify(sealParts(index, 1)));
  }
});

test('the three seals are siblings, not copies', () => {
  const [a, b, c] = [0, 1, 2].map((index) => JSON.stringify(sealParts(index)));
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.notEqual(a, c);
  // And the variation is structural, not cosmetic: shard counts genuinely differ.
  assert.equal(new Set(SEAL_SHARD_COUNTS).size, 3, 'three seals with the same shard count are one seal');
});

// ── the shape ─────────────────────────────────────────────────────────────────────────────────────

test('each seal is 4-6 shards on a frost ring, standing 1.0-1.2 m', () => {
  for (let index = 0; index < 3; index += 1) {
    const parts = sealParts(index);
    const shards = shardsOf(parts);
    assert.ok(shards.length >= 4 && shards.length <= 6, `seal ${index} has ${shards.length} shards`);
    assert.equal(parts.filter((part) => part.name === 'ring').length, 1);
    const tallest = Math.max(...shards.map(topOf));
    assert.ok(tallest >= 1.0 && tallest <= 1.2, `seal ${index} stands ${tallest.toFixed(2)} m`);
    // Cross-checked through the parts' own extents rather than by re-reading the constant
    // (docs/MISTAKES.md: expected and actual from the same expression proves nothing).
    assert.ok(Math.abs(tallest - SEAL_HEIGHTS_METERS[index]) < 1e-9,
      `seal ${index} parts reach ${tallest}, constant says ${SEAL_HEIGHTS_METERS[index]}`);
  }
});

/** The detail floor as a predicate: no shard face may be thinner than the exported minimum. */
function isChunky(shard) {
  return Math.min(shard.radiusTop, shard.radiusBottom) * 2 >= SEAL_SHARD_MIN_DIAMETER_METERS;
}

test('every prism is chunky -- silhouette first, no thin geometry', () => {
  for (let index = 0; index < 3; index += 1) {
    for (const shard of shardsOf(sealParts(index))) {
      assert.ok(isChunky(shard),
        `seal ${index} grows a sliver: top diameter ${(shard.radiusTop * 2).toFixed(2)} m`);
      assert.equal(shard.radialSegments, 6, 'six flat facets are what make it read as CUT crystal');
    }
  }
});

test('sabotage: the chunkiness check DOES fail against a 5 cm sliver', () => {
  assert.equal(isChunky({ radiusTop: 0.025, radiusBottom: 0.05 }), false);
});

test('the frost ring gives each cluster a foot wider than the shards it roots', () => {
  for (let index = 0; index < 3; index += 1) {
    const parts = sealParts(index);
    const ring = parts.find((part) => part.name === 'ring');
    assert.equal(ring.radiusBottom, SEAL_RING_RADIUS_METERS);
    assert.ok(ring.height <= 0.15, 'the ring is a plate, not a kerb the hero appears to stand in');
    const shardReach = Math.max(...shardsOf(parts).map((shard) => Math.hypot(shard.at[0], shard.at[2])));
    assert.ok(ring.radiusBottom > shardReach, `shards root at ${shardReach.toFixed(2)} m, past the ring`);
  }
});

// ── the palette obeys GQ-007: imported, not restated ──────────────────────────────────────────────

test('a seal is built from the Beacon\'s own colds, with exactly one pale-cyan accent', () => {
  for (let index = 0; index < 3; index += 1) {
    const parts = sealParts(index);
    const accents = parts.filter((part) => part.color === BEACON_GLOW_COLOR);
    assert.equal(accents.length, 1, `seal ${index} carries ${accents.length} accents -- the floor allows one`);
    assert.equal(accents[0].name, 'accent-shard');
    for (const part of parts) {
      assert.ok(
        [BEACON_GLOW_COLOR, BEACON_EMBER_COLD_COLOR, BEACON_STONE_COLOR].includes(part.color),
        `seal ${index} invents a colour: ${part.color.toString(16)}`,
      );
    }
  }
});

// ── the wound reads ───────────────────────────────────────────────────────────────────────────────

test('one blow changes the silhouette: shards splay by a fixed amount and root further out', () => {
  for (let index = 0; index < 3; index += 1) {
    const intact = shardsOf(sealParts(index, 0));
    const cracked = shardsOf(sealParts(index, 1));
    assert.notEqual(JSON.stringify(intact), JSON.stringify(cracked));
    for (let i = 0; i < intact.length; i += 1) {
      assert.ok(Math.abs(cracked[i].roll - intact[i].roll - SEAL_CRACK_SPLAY_RADIANS) < 1e-9,
        `shard ${i} of seal ${index} did not splay by the stated amount`);
      const before = Math.hypot(intact[i].at[0], intact[i].at[2]);
      const after = Math.hypot(cracked[i].at[0], cracked[i].at[2]);
      assert.ok(after > before, `shard ${i} of seal ${index} did not spread`);
    }
  }
  // Big enough to SEE at gameplay distance -- the bramble's measured-but-not-seen lesson.
  assert.ok(SEAL_CRACK_SPLAY_RADIANS >= 0.15, 'a splay under ~9 degrees is measurable, not visible');
});

test('the cracked accent brightens toward white instead of swapping hue', () => {
  const rest = new THREE.Color(BEACON_GLOW_COLOR);
  const cracked = new THREE.Color(SEAL_ACCENT_CRACKED_COLOR);
  assert.ok(cracked.r > rest.r && cracked.g > rest.g && cracked.b > rest.b, 'brighter on every channel');
  assert.ok(cracked.b >= cracked.r, 'and still cold -- a warm accent would read as the seal winning');
  const shards = shardsOf(sealParts(0, 1));
  assert.equal(shards.filter((shard) => shard.color === SEAL_ACCENT_CRACKED_COLOR).length, 1);
});

// ── the glow stays wrongness, never light ─────────────────────────────────────────────────────────

test('seal glow strengths sit inside the zone\'s light grammar', () => {
  assert.ok(SEAL_GLOW_REST < SEAL_GLOW_CRACKED, 'the blow has to register as a JUMP');
  assert.ok(SEAL_GLOW_CRACKED < GATE_LAMP_LIT_STRENGTH, 'a seal must never outshine a lit lamp');
  assert.ok(SEAL_GLOW_CRACKED < BEACON_GLOW_STIR_PEAK,
    'nor the Beacon\'s own stir -- the tower stays the brightest cold thing in its own arc');
  assert.ok(SEAL_GLOW_REST <= BEACON_GLOW_REST,
    'at rest a seal defers to the cresset above it: the wrongness POINTS somewhere');
});

test('the intact shimmer moves, stays positive, and never reaches the cracked strength', () => {
  let min = Infinity;
  let max = -Infinity;
  for (let t = 0; t < 12; t += 0.05) {
    const strength = sealShimmerStrength(t);
    min = Math.min(min, strength);
    max = Math.max(max, strength);
  }
  assert.ok(min > 0, 'a shimmer that blinks OFF reads as broken, not wrong');
  assert.ok(max < SEAL_GLOW_CRACKED, `the shimmer peaks at ${max.toFixed(2)}, stealing the wound's jump`);
  assert.notEqual(min, max, 'and it has to actually move');
});

// ── the collapse ──────────────────────────────────────────────────────────────────────────────────

test('the collapse borrows the bramble\'s tempo rather than inventing a second one', () => {
  assert.equal(SEAL_FALL_SECONDS, BRAMBLE_FALL_SECONDS);
});

test('the collapse sinks and shrinks to nothing, opacity trailing behind the fall', () => {
  const start = sealCollapseFrame(0);
  assert.equal(start.scaleY, 1);
  assert.equal(start.opacity, 1);
  assert.equal(start.done, false);
  const mid = sealCollapseFrame(SEAL_FALL_SECONDS / 2);
  assert.ok(mid.scaleY < 1 && mid.scaleY > 0);
  assert.ok(mid.scaleXZ > 1, 'down AND out -- straight down reads as a ghost sinking');
  assert.ok(mid.opacity > 1 - mid.scaleY, 'opacity lags the fall (t*t), the bramble\'s own shape');
  const end = sealCollapseFrame(SEAL_FALL_SECONDS);
  assert.ok(end.scaleY <= 0.001 + 1e-9);
  assert.equal(end.done, true);
});

test('the burst finishes before the collapse does, so the last visible frame is the ground', () => {
  assert.ok(SEAL_BURST_SECONDS < SEAL_FALL_SECONDS);
  assert.ok(SEAL_BURST_SPARKS >= 4, 'fewer than four sparks reads as debris, not a shatter');
});

test('a burst spark flies out bright, fades over the back half, and ends gone', () => {
  const early = sealBurstFrame(SEAL_BURST_SECONDS * 0.1);
  assert.equal(early.strength01, 1, 'bright IMMEDIATELY -- the blow just landed, a fade-in arrives late');
  let lastOut = -1;
  for (let t = 0; t <= SEAL_BURST_SECONDS; t += 0.02) {
    const beat = sealBurstFrame(t);
    assert.ok(beat.out01 >= lastOut - 1e-9, 'the shatter never travels backwards');
    lastOut = beat.out01;
  }
  const end = sealBurstFrame(SEAL_BURST_SECONDS);
  assert.equal(end.strength01, 0);
  assert.equal(end.done, true);
});

// Sabotage-verify: a burst whose brightness never fell would pass "starts bright" -- prove the
// fade assertion can actually reject one.
test('sabotage: the burst really fades -- the back half is dimmer than the front', () => {
  assert.ok(
    sealBurstFrame(SEAL_BURST_SECONDS * 0.9).strength01 < sealBurstFrame(SEAL_BURST_SECONDS * 0.3).strength01,
  );
});
