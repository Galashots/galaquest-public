// The drawn wolf's easing (enemies/wolf.js's DRAWN_EASE_TAU_SECONDS header): the authoritative
// wolf steps at snapshot rate; the DRAWN wolf approaches it continuously, snaps across genuine
// discontinuities, and exposes its drawn position so the nameplate can sit on the body it labels.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as THREE from '../public/vendor/three.module.min.js';

import {
  DRAWN_EASE_TAU_SECONDS,
  DRAWN_SNAP_METERS,
  approachHeading,
  createWolfPresenter,
  drawnApproachFactor,
} from '../public/src/enemies/wolf.js';

// Same module-load shim wolf.test.mjs carries, for the same reason: render/glow.js draws into a
// canvas at first use, and this file runs with no browser. Nothing here is asserted on.
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          createRadialGradient: () => ({ addColorStop() {} }),
          fillRect() {},
          set fillStyle(_value) {},
        }),
      };
    },
  };
}

const DT = 1 / 60;
const wolfAt = (x, z, heading = 0) => ({ x, z, heading, mode: 'walk', modeSeconds: 1 });

test('drawnApproachFactor: zero dt holds, a snapshot interval is mostly absorbed, degenerate tau lands', () => {
  assert.equal(drawnApproachFactor(0), 0, 'a zero-dt frame must hold the drawn pose');
  assert.equal(drawnApproachFactor(-1), 0);
  assert.equal(drawnApproachFactor(DT, 0), 1, 'easing off means landing exactly');
  // One 10 Hz snapshot interval closes >90% of the gap: continuous, but never visibly behind.
  const oneInterval = 1 - Math.exp(-0.1 / DRAWN_EASE_TAU_SECONDS);
  assert.ok(oneInterval > 0.9, `a snapshot interval must absorb >90% of a step (got ${oneInterval.toFixed(3)})`);
});

test('approachHeading turns the short way across the wrap', () => {
  // From just below +pi to just above -pi is a small forward turn, not a lap of the circle.
  const next = approachHeading(3.0, -3.0, 1);
  assert.ok(Math.abs(Math.sin(next) - Math.sin(-3.0)) < 1e-9 && Math.cos(next) > Math.cos(3.0) - 1e-9,
    'full-factor approach lands on the target heading');
  const part = approachHeading(3.0, -3.0, 0.5);
  assert.ok(part > 3.0 && part < 3.3, `half the short arc continues PAST +pi (got ${part.toFixed(3)})`);
});

test('the drawn wolf approaches a snapshot step instead of teleporting onto it', () => {
  const root = new THREE.Object3D();
  const presenter = createWolfPresenter(root, []);

  presenter.update(DT, wolfAt(0, 0));
  assert.equal(root.position.x, 0, 'the first frame lands exactly');

  // Authority steps 0.2m sideways -- one 10 Hz snapshot at wolf speed. The drawn body must move
  // strictly between the old and new points, and close most of the gap within one interval.
  presenter.update(DT, wolfAt(0.2, 0));
  assert.ok(root.position.x > 0 && root.position.x < 0.2,
    `one frame draws part-way (got ${root.position.x.toFixed(4)})`);
  for (let i = 0; i < 5; i += 1) presenter.update(DT, wolfAt(0.2, 0));
  assert.ok(Math.abs(root.position.x - 0.2) < 0.02,
    `a snapshot interval later the body has arrived within 2cm (off by ${(0.2 - root.position.x).toFixed(4)})`);

  // And the heading eases the same way rather than jerking.
  presenter.update(DT, wolfAt(0.2, 0, Math.PI / 2));
  assert.ok(root.rotation.y > 0 && root.rotation.y < Math.PI / 2, 'heading turns part-way per frame');
});

test('a genuine discontinuity snaps: no body slides across the map to its respawn', () => {
  const root = new THREE.Object3D();
  const presenter = createWolfPresenter(root, []);
  presenter.update(DT, wolfAt(0, 0));
  presenter.update(DT, wolfAt(DRAWN_SNAP_METERS + 3, 0, 1.1));
  assert.equal(root.position.x, DRAWN_SNAP_METERS + 3, 'past the snap threshold the drawn body lands exactly');
  assert.equal(root.rotation.y, 1.1, 'and so does its heading');
});

test('drawnPosition() reports the drawn body, for the nameplate to sit on', () => {
  const root = new THREE.Object3D();
  const presenter = createWolfPresenter(root, []);
  assert.equal(presenter.drawnPosition(), null, 'nothing drawn yet, honestly reported');
  presenter.update(DT, wolfAt(0, 0));
  presenter.update(DT, wolfAt(0.2, 0));
  const drawn = presenter.drawnPosition();
  assert.equal(drawn.x, root.position.x, 'the reported anchor IS the drawn body');
  assert.ok(drawn.x < 0.2, 'and not the authoritative point it is approaching');
});
