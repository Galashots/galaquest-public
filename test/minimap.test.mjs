// A thing to the child's right must be drawn to the right of the dot. That is the whole contract.
//
// It is worth testing rather than eyeballing because there are three independent ways to get it
// backwards and each one is silent: the camera rotation (which way is up), the pixel Y flip (screen
// +y is forward, pixel +y is down), and the sign of the camera's right vector -- which
// camera/rotation.js's own header records getting wrong once already, with the strafe axis coming
// out exactly inverted at every heading.
//
// The assertions below are written in terms a person can check against a picture -- "to the right
// of the dot", "above the dot" -- rather than against the formula, so a test cannot agree with a
// wrong implementation by restating it.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { DEFAULT_RANGE_METERS, minimapPlacement, minimapPolyline } from '../public/src/ui/minimap.js';
import { screenToWorld } from '../public/src/camera/rotation.js';

const R = 60;
const dial = (over) => minimapPlacement({
  heroX: 0, heroZ: 0, heading: 0, rangeMeters: 20, radiusPx: R, ...over,
});

/** Where the camera is looking, in world terms, at a given heading. Taken from rotation.js rather
 *  than restated: `screenToWorld({x:0,y:1})` IS the definition of forward (GQ-007). */
const forwardAt = (heading) => screenToWorld({ x: 0, y: 1 }, heading);
const rightAt = (heading) => screenToWorld({ x: 1, y: 0 }, heading);

test('the hero sits at the centre of the dial', () => {
  const it = dial({ worldX: 0, worldZ: 0 });
  assert.equal(it.x, R);
  assert.equal(it.y, R);
  assert.equal(it.distanceMeters, 0);
  assert.equal(it.angle, null, 'a marker under the hero has no meaningful bearing');
});

test('whatever the camera is looking AT is drawn ABOVE the dot, at every heading', () => {
  // The camera-up property, stated as the thing a child sees rather than as a rotation. If this
  // holds at four unrelated headings it is not an accident of one of them.
  for (const heading of [0, 1.1, -2.4, 3.0]) {
    const f = forwardAt(heading);
    const it = dial({ worldX: f.x * 10, worldZ: f.z * 10, heading });
    assert.ok(Math.abs(it.x - R) < 1e-9, `heading ${heading}: forward drifted sideways to x=${it.x}`);
    assert.ok(it.y < R, `heading ${heading}: forward should be ABOVE centre, got y=${it.y}`);
  }
});

test('whatever is to the camera\'s RIGHT is drawn to the right of the dot, at every heading', () => {
  // rotation.js's header records the first version of that basis being exactly inverted -- every
  // heading, dot product -1. This is the assertion that would have caught it on the dial.
  for (const heading of [0, 1.1, -2.4, 3.0]) {
    const r = rightAt(heading);
    const it = dial({ worldX: r.x * 10, worldZ: r.z * 10, heading });
    assert.ok(it.x > R, `heading ${heading}: right should be RIGHT of centre, got x=${it.x}`);
    assert.ok(Math.abs(it.y - R) < 1e-9, `heading ${heading}: right drifted vertically to y=${it.y}`);
  }
});

test('behind the child is drawn BELOW the dot', () => {
  const f = forwardAt(0.6);
  const it = dial({ worldX: -f.x * 8, worldZ: -f.z * 8, heading: 0.6 });
  assert.ok(it.y > R, `behind should be below centre, got y=${it.y}`);
});

test('distance scales linearly out to the rim', () => {
  const f = forwardAt(0);
  const half = dial({ worldX: f.x * 10, worldZ: f.z * 10 });   // 10 m of a 20 m range
  const full = dial({ worldX: f.x * 20, worldZ: f.z * 20 });   // exactly the rim

  assert.ok(Math.abs((R - half.y) - R / 2) < 1e-9, 'half the range is half the radius');
  assert.ok(Math.abs((R - full.y) - R) < 1e-9, 'the full range is the rim');
  assert.equal(half.withinRange, true);
  assert.equal(full.withinRange, true, 'exactly at the range is still in range, not out of it');
});

test('something beyond the range is pinned to the rim, not dropped', () => {
  // The point of the whole thing: a child who cannot see what they are looking for still needs to
  // know which way it is. A marker that vanishes at the boundary blanks the map exactly when it
  // matters most.
  const f = forwardAt(0);
  const it = dial({ worldX: f.x * 500, worldZ: f.z * 500 });

  assert.equal(it.withinRange, false);
  assert.ok(Math.abs(Math.hypot(it.x - R, it.y - R) - R) < 1e-9, 'sits exactly on the rim');
  assert.equal(it.distanceMeters, 500, 'and still reports the REAL distance, unclamped');
});

test('a pinned marker keeps its true bearing', () => {
  const heading = -1.2;
  const r = rightAt(heading);
  const near = dial({ worldX: r.x * 5, worldZ: r.z * 5, heading });
  const far = dial({ worldX: r.x * 900, worldZ: r.z * 900, heading });

  assert.equal(far.withinRange, false);
  assert.ok(Math.abs(far.angle - near.angle) < 1e-9,
    'clamping to the rim must move the marker, not turn it');
});

test('no marker is ever drawn outside the dial', () => {
  for (const heading of [0, 2.2, -0.4]) {
    for (const [x, z] of [[1, 0], [0, 1], [-30, 40], [200, -200], [0.01, 0.01], [-7, -7]]) {
      const it = dial({ worldX: x, worldZ: z, heading });
      const fromCentre = Math.hypot(it.x - R, it.y - R);
      assert.ok(fromCentre <= R + 1e-9,
        `(${x},${z}) at heading ${heading} landed ${fromCentre}px out on a ${R}px dial`);
    }
  }
});

test('the default range is the brief\'s provisional 22 m', () => {
  // Pinned so a change is deliberate. Provisional tuning, explicitly not an Owner decision: it has
  // to cover the 9.19 m Keeper-to-Lantern-Tree leg with room to see the next thing before arriving.
  assert.equal(DEFAULT_RANGE_METERS, 22);
  assert.ok(DEFAULT_RANGE_METERS > 9.19, 'the opening leg has to fit on the dial');
});

test('nothing produces NaN, including a zero-length dial', () => {
  for (const radiusPx of [0, 1, 60]) {
    for (const [x, z] of [[0, 0], [5, 5], [-1000, 1000]]) {
      const it = minimapPlacement({ heroX: 0, heroZ: 0, worldX: x, worldZ: z, heading: 0.5, radiusPx });
      assert.ok(Number.isFinite(it.x) && Number.isFinite(it.y),
        `radius ${radiusPx} at (${x},${z}) produced ${it.x},${it.y}`);
    }
  }
});

// ── polylines: a road is not a set of markers ──────────────────────────────────────────────────

test('a road keeps its shape instead of collapsing onto the rim', () => {
  // Rim-clamping every far vertex would turn a road into a starburst radiating from the hero. The
  // out-of-range points keep their true positions and are flagged, so a caller can clip the line
  // properly rather than bend it.
  const road = [[0, 5], [0, 15], [0, 40], [0, 80]];
  const placed = minimapPolyline(road, { heroX: 0, heroZ: 0, heading: 0, rangeMeters: 20, radiusPx: R });

  assert.deepEqual(placed.map((p) => p.withinRange), [true, true, false, false]);
  // Still a straight line up the dial, evenly spaced -- the shape survives.
  const ys = placed.map((p) => Math.round(p.y));
  assert.deepEqual(ys, [45, 15, -60, -180]);
  assert.ok(placed.every((p) => Math.abs(p.x - R) < 1e-9), 'a straight road stays straight');
});
