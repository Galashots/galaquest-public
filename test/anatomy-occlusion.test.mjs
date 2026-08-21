import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BODY_REGION_ATTRIBUTE,
  anatomyCoverageKey,
  buildAnatomyOccludedGeometry,
  geometryForAnatomyCoverage,
  normalizeHiddenRegions,
} from '../public/src/character/anatomyOcclusion.js';

class FakeAttribute {
  constructor(values) {
    this.array = values;
    this.itemSize = 1;
    this.count = values.length;
  }
  getX(index) { return this.array[index]; }
}

class FakeGeometry {
  constructor() {
    this.attributes = {};
    this.groups = [];
    this.userData = {};
    this.morphAttributes = {};
    this.morphTargetsRelative = false;
    this.boundingBox = null;
    this.boundingSphere = null;
  }
  setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
  getAttribute(name) { return this.attributes[name]; }
  setIndex(values) { this.index = { array: Uint16Array.from(values) }; return this; }
  getIndex() { return this.index ?? null; }
  addGroup(start, count, materialIndex) { this.groups.push({ start, count, materialIndex }); }
  setDrawRange(start, count) { this.drawRange = { start, count }; }
}

function regionGeometry() {
  const geometry = new FakeGeometry();
  geometry.name = 'Hero';
  geometry.setAttribute('position', { count: 12 });
  geometry.setAttribute(BODY_REGION_ATTRIBUTE, new FakeAttribute([
    0, 0, 0,
    1, 1, 1,
    2, 2, 2,
    3, 3, 3,
  ]));
  geometry.setIndex([
    0, 1, 2,
    3, 4, 5,
    6, 7, 8,
    9, 10, 11,
  ]);
  return geometry;
}

test('coverage vocabulary is canonical, deduplicated, and refuses core', () => {
  assert.deepEqual(normalizeHiddenRegions(['ears', 'hair', 'ears']), ['hair', 'ears']);
  assert.equal(anatomyCoverageKey(['ears', 'hair']), 'hair+ears');
  assert.equal(anatomyCoverageKey([]), 'none');
  assert.throws(() => normalizeHiddenRegions(['cape']), /unknown anatomy region/);
  assert.throws(() => normalizeHiddenRegions(['core']), /core anatomy cannot be hidden/);
});

test('semantic anatomy occlusion removes only covered triangles and remains one geometry', () => {
  const source = regionGeometry();
  const variant = buildAnatomyOccludedGeometry(source, ['hair', 'ears']);

  assert.deepEqual(Array.from(variant.index.array), [0, 1, 2, 9, 10, 11]);
  assert.equal(variant.attributes.position, source.attributes.position, 'vertex payload must be shared');
  assert.equal(variant.attributes[BODY_REGION_ATTRIBUTE], source.attributes[BODY_REGION_ATTRIBUTE]);
  assert.equal(variant.groups.length, 0, 'occlusion must not manufacture extra draw groups');
  assert.equal(variant.userData.gqAnatomyCoverage.sourceTriangleCount, 4);
  assert.equal(variant.userData.gqAnatomyCoverage.visibleTriangleCount, 2);
  assert.deepEqual(variant.userData.gqAnatomyCoverage.hiddenTriangleCounts, { hair: 1, ears: 1 });
});

test('coverage variants are cached by semantic set, not request ordering', () => {
  const source = regionGeometry();
  const first = geometryForAnatomyCoverage(source, ['ears', 'hair']);
  const second = geometryForAnatomyCoverage(source, ['hair', 'ears', 'hair']);
  assert.equal(first, second);
  assert.equal(geometryForAnatomyCoverage(source, []), source);
});

test('mixed-region triangles fail closed instead of tearing anatomy unpredictably', () => {
  const source = new FakeGeometry();
  source.setAttribute('position', { count: 3 });
  source.setAttribute(BODY_REGION_ATTRIBUTE, new FakeAttribute([0, 1, 1]));
  source.setIndex([0, 1, 2]);

  assert.throws(
    () => buildAnatomyOccludedGeometry(source, ['hair']),
    /mixes anatomy regions core, hair, hair/,
  );
});

test('coverage refuses an untagged hero rather than guessing from spatial bounds', () => {
  const source = new FakeGeometry();
  source.setAttribute('position', { count: 3 });
  source.setIndex([0, 1, 2]);
  assert.throws(
    () => buildAnatomyOccludedGeometry(source, ['hair']),
    new RegExp(BODY_REGION_ATTRIBUTE),
  );
});
