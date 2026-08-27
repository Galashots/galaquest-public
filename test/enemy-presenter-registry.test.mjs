import test from 'node:test';
import assert from 'node:assert/strict';

import { createEnemyPresenterRegistry } from '../public/src/enemies/presenterRegistry.js';

function enemy(enemyId, kind = 'wolf', x = 0) {
  return { enemyId, kind, x, z: 0, heading: 0, hp: 30, mode: 'idle', modeSeconds: 0 };
}

function harness() {
  const created = [];
  const disposed = [];
  const updates = [];
  const registry = createEnemyPresenterRegistry({
    createPresenter(value) {
      if (value.kind !== 'wolf') return null;
      const presenter = {
        token: Symbol(value.enemyId),
        update(_deltaSeconds, next) { updates.push([value.enemyId, next.x]); },
        getState() { return { id: value.enemyId }; },
        dispose() { disposed.push(value.enemyId); },
      };
      created.push([value.enemyId, presenter]);
      return presenter;
    },
  });
  return { registry, created, disposed, updates };
}

test('stable enemyId keeps the same presenter when serialization order changes', () => {
  const h = harness();
  h.registry.update(0.016, [enemy('wolf-a', 'wolf', 1), enemy('wolf-b', 'wolf', 2)]);
  const a = h.registry.get('wolf-a');
  const b = h.registry.get('wolf-b');

  h.registry.update(0.016, [enemy('wolf-b', 'wolf', 20), enemy('wolf-a', 'wolf', 10)]);

  assert.equal(h.registry.get('wolf-a'), a);
  assert.equal(h.registry.get('wolf-b'), b);
  assert.equal(h.created.length, 2, 'reordering must not recreate either visual');
  assert.deepEqual(h.updates.slice(-2), [['wolf-b', 20], ['wolf-a', 10]]);
});

test('add creates exactly one presenter and remove disposes exactly that stable id', () => {
  const h = harness();
  h.registry.update(0.016, [enemy('wolf-a')]);
  h.registry.update(0.016, [enemy('wolf-a'), enemy('wolf-b')]);
  assert.equal(h.created.length, 2);
  assert.equal(h.registry.count, 2);

  h.registry.update(0.016, [enemy('wolf-b')]);
  assert.deepEqual(h.disposed, ['wolf-a']);
  assert.equal(h.registry.get('wolf-a'), null);
  assert.ok(h.registry.get('wolf-b'));
});

test('an unsupported enemy kind has no visual and does not steal a Wolf presenter', () => {
  const h = harness();
  h.registry.update(0.016, [enemy('wolf-a'), enemy('spriggan-a', 'spriggan')]);
  assert.equal(h.registry.count, 1);
  assert.ok(h.registry.get('wolf-a'));
  assert.equal(h.registry.get('spriggan-a'), null);
});

test('resources that are not ready may be retried without allocating duplicate identity', () => {
  let ready = false;
  let creates = 0;
  const registry = createEnemyPresenterRegistry({
    createPresenter(value) {
      creates += 1;
      if (!ready) return undefined;
      return { update() {}, getState: () => ({ id: value.enemyId }), dispose() {} };
    },
  });

  registry.update(0.016, [enemy('wolf-a')]);
  assert.equal(registry.count, 0);
  ready = true;
  registry.update(0.016, [enemy('wolf-a')]);
  assert.equal(registry.count, 1);
  registry.update(0.016, [enemy('wolf-a')]);
  assert.equal(registry.count, 1);
  assert.equal(creates, 2, 'once created, the same id is never recreated just because frames continue');
});

test('duplicate ids fail loudly before two visuals can claim one authority id', () => {
  const h = harness();
  assert.throws(
    () => h.registry.update(0.016, [enemy('wolf-a'), enemy('wolf-a')]),
    /duplicate enemyId/,
  );
});
