import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGroundGeometry,
  distanceToPolyline,
  distanceToSegment,
  groundBounds,
  meadowBlend,
  roadBlend,
} from '../public/src/world/ground.js';
import { ROAD, ZONE } from '../public/src/world/zones/village.js';

// Phase Y/Task C: "one integrated ground mesh... no coplanar second road plane... no z-fighting by
// construction" -- these tests prove the pure geometry math independent of three.js/DOM (same split
// zoneLoader.js's own header explains: the three.js-dependent half is proven at runtime by
// drive-village.mjs instead), then prove the ONE mesh's own vertex colours actually reflect it.

test('distanceToSegment is zero for a point on the segment', () => {
  assert.equal(distanceToSegment(2, 0, 0, 0, 4, 0), 0);
});

test('distanceToSegment measures perpendicular distance to the middle of a segment', () => {
  assert.equal(distanceToSegment(2, 3, 0, 0, 4, 0), 3);
});

test('distanceToSegment clamps to the nearest endpoint past the segment\'s ends', () => {
  assert.equal(distanceToSegment(10, 0, 0, 0, 4, 0), 6);
  assert.equal(distanceToSegment(-10, 0, 0, 0, 4, 0), 10);
});

test('distanceToSegment degrades to point-to-point for a zero-length segment', () => {
  assert.equal(distanceToSegment(3, 4, 0, 0, 0, 0), 5);
});

test('distanceToPolyline picks the nearest of several segments, not the first', () => {
  const points = [[0, 0], [10, 0], [10, 10]];
  // Closer to the SECOND segment (10,0)-(10,10) than the first.
  assert.equal(distanceToPolyline(9, 5, points), 1);
});

// Sabotage-verify: a function that always measured against only the first segment would pass every
// on-segment case above but fail this one -- prove the minimum really is taken across all segments.
test('sabotage: distanceToPolyline is not just the first segment\'s distance', () => {
  const points = [[0, 0], [10, 0], [10, 10]];
  const toFirstSegmentOnly = distanceToSegment(9, 5, 0, 0, 10, 0);
  assert.notEqual(distanceToPolyline(9, 5, points), toFirstSegmentOnly);
});

test('roadBlend is 1 (fully road) at the centreline regardless of soften width', () => {
  assert.equal(roadBlend(0, 2, 0.6), 1);
  assert.equal(roadBlend(0, 2, 0), 1);
});

test('roadBlend is 0 (fully grass) well outside the half-width', () => {
  assert.equal(roadBlend(10, 2, 0.6), 0);
});

test('roadBlend is a smooth partial value inside the soften band, not a hard 0/1 step', () => {
  const mid = roadBlend(2, 2, 0.6); // exactly at the half-width, the centre of the soften band
  assert.ok(mid > 0 && mid < 1, `expected a blended value strictly between 0 and 1, got ${mid}`);
  assert.ok(Math.abs(mid - 0.5) < 1e-9, `expected ~0.5 at the band centre, got ${mid}`);
});

// Sabotage-verify: a function that always returned 1 for "close enough" would pass the centreline
// case above too -- prove distance actually changes the result.
test('sabotage: roadBlend is not a constant -- centreline and far-away give different values', () => {
  assert.notEqual(roadBlend(0, 2, 0.6), roadBlend(10, 2, 0.6));
});

// ── the ONE mesh's own geometry ─────────────────────────────────────────────────────────────────

test('buildGroundGeometry produces exactly one position/normal/color per vertex, no second surface', () => {
  const geometry = buildGroundGeometry(groundBounds(ZONE), ROAD);
  const vertexCount = geometry.attributes.position.count;
  assert.ok(vertexCount > 0);
  assert.equal(geometry.attributes.color.count, vertexCount);
  assert.equal(geometry.attributes.normal.count, vertexCount);
  // Every normal points straight up -- a flat, single, unrotated surface (no second plane offset
  // in Y, which is what a coplanar road hack would need to avoid z-fighting by tolerance instead
  // of by construction).
  const ny = geometry.attributes.normal.array;
  for (let i = 1; i < ny.length; i += 3) assert.equal(ny[i], 1);
});

test('a vertex on the road centreline is coloured differently from one far from any road', () => {
  const geometry = buildGroundGeometry(groundBounds(ZONE), ROAD, 1);
  const pos = geometry.attributes.position.array;
  const col = geometry.attributes.color.array;
  const findVertexNear = (x, z) => {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const d = Math.hypot(pos[i] - x, pos[i + 2] - z);
      if (d < bestDist) { bestDist = d; best = i / 3; }
    }
    return best;
  };
  const onRoad = findVertexNear(ROAD.points[0][0], ROAD.points[0][1]);
  const farCorner = findVertexNear(groundBounds(ZONE).maxX - 0.5, groundBounds(ZONE).minZ + 0.5);
  const colorAt = (i) => [col[i * 3], col[i * 3 + 1], col[i * 3 + 2]];
  assert.notDeepEqual(colorAt(onRoad), colorAt(farCorner));
});

// This used to assert every vertex was byte-identical, which was a proxy for "no road was painted"
// and stopped being one the moment the grass itself varied (the meadow tones). The property is what
// is checked now: with no road data, nothing anywhere on the ground is road-coloured.
test('buildGroundGeometry paints no road at all when no road is given', () => {
  const withoutRoad = buildGroundGeometry(groundBounds(ZONE), undefined).attributes.color.array;
  const withRoad = buildGroundGeometry(groundBounds(ZONE), ROAD).attributes.color.array;

  // Every grass vertex is greener than it is red; a road vertex is the other way round. Read off the
  // two colours ground.js actually uses rather than restated: the road-painted mesh must contain
  // vertices of both kinds, and the unpainted one only the first.
  const isRoadish = (a, i) => a[i * 3] > a[i * 3 + 1];
  const roadVertices = (a) => {
    let n = 0;
    for (let i = 0; i < a.length / 3; i += 1) if (isRoadish(a, i)) n += 1;
    return n;
  };
  assert.ok(roadVertices(withRoad) > 0, 'the control is broken: the road-painted mesh has no road on it');
  assert.equal(roadVertices(withoutRoad), 0, 'a zone with no road data still got a road painted on it');
});

test('the grass varies across the field instead of being one flat colour', () => {
  const col = buildGroundGeometry(groundBounds(ZONE), undefined).attributes.color.array;
  const greens = [];
  for (let i = 1; i < col.length; i += 3) greens.push(col[i]);
  const min = Math.min(...greens);
  const max = Math.max(...greens);
  assert.ok(max - min > 0.02, `the whole field spans only ${(max - min).toFixed(4)} of green -- flat`);
  assert.ok(max - min < 0.15, `${(max - min).toFixed(4)} of green is a patchwork, not a meadow`);
});

// The seam this could open: the 140m distance skirt is one flat GRASS_COLOR quad, and the playable
// ground's own edge now varies. If the two tones do not average to GRASS_COLOR, that join shows.
test('the meadow averages out to the flat colour the distance skirt is painted', async () => {
  const { createGround } = await import('../public/src/world/ground.js');
  const world = createGround();
  // Read the skirt's OWN material colour rather than restating a hex here -- the whole point is that
  // these two must agree, so the test must not be able to agree with itself while they diverge.
  let skirt = null;
  world.traverse((object) => { if (object.isMesh && object.name === 'ground-skirt') skirt = object; });
  assert.ok(skirt, 'no ground-skirt mesh -- this test is checking a join that no longer exists');

  const col = buildGroundGeometry(groundBounds(ZONE), undefined).attributes.color.array;
  const n = col.length / 3;
  let r = 0; let g = 0; let b = 0;
  for (let i = 0; i < n; i += 1) { r += col[i * 3]; g += col[i * 3 + 1]; b += col[i * 3 + 2]; }
  for (const [name, mean, want] of [
    ['r', r / n, skirt.material.color.r],
    ['g', g / n, skirt.material.color.g],
    ['b', b / n, skirt.material.color.b],
  ]) {
    assert.ok(Math.abs(mean - want) < 0.02,
      `mean ${name} is ${mean.toFixed(4)} against the skirt's ${want.toFixed(4)} -- the join will show`);
  }
});

test('the meadow field is deterministic, bounded, and actually moves', () => {
  assert.equal(meadowBlend(3.5, -7.25), meadowBlend(3.5, -7.25), 'two loads must draw the same ground');
  const seen = new Set();
  for (let x = -14; x <= 14; x += 0.5) {
    for (let z = -14; z <= 14; z += 0.5) {
      const value = meadowBlend(x, z);
      assert.ok(value >= 0 && value <= 1, `meadowBlend(${x}, ${z}) is ${value}`);
      seen.add(Math.round(value * 20));
    }
  }
  assert.ok(seen.size > 8, `the field only ever takes ${seen.size} distinct values -- not a meadow`);
});

// Phase V/V3's own precedent: ground.js's placeholder decorations were removed rather than kept
// alongside real content once real content existed. This is that same "no second competing
// surface" property, now for the road specifically -- exactly one mesh in the world group, proven
// by counting rather than by not having written a second one.
test('the road lives on exactly ONE surface, and no two ground surfaces are coplanar', async () => {
  const { createGround } = await import('../public/src/world/ground.js');
  const world = createGround();
  const meshes = [];
  world.traverse((object) => { if (object.isMesh) meshes.push(object); });

  // This used to assert `meshes.length === 1`, which was a proxy for the property and stopped being
  // one when the distance skirt landed (a 140 m flat quad that hides the playable ground's own
  // visible edge; see createGround). The property itself is unchanged and is what is checked now:
  // the road is painted into ONE mesh's vertex colours rather than laid on as a second surface, and
  // nothing shares a plane with anything else, so there is no z-fighting to tune.
  const roadSurfaces = meshes.filter((mesh) => mesh.material.vertexColors === true);
  assert.equal(roadSurfaces.length, 1,
    `the road must be vertex colours on one mesh, found ${roadSurfaces.length} vertex-coloured meshes`);

  const heights = meshes.map((mesh) => mesh.position.y);
  assert.equal(new Set(heights).size, heights.length,
    `two ground surfaces share a plane (${heights.join(', ')}); that is a z-fight waiting to happen`);
});
