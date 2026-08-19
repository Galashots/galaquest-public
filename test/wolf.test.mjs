import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as THREE from '../public/vendor/three.module.min.js';

import {
  REDUCED_MOTION_FLASH_SECONDS,
  WOLF_DEFEAT_FLASH_SECONDS,
  WOLF_HIT_FLASH_SECONDS,
} from '../public/src/combat/feedback.js';
import { createWolfPresenter } from '../public/src/enemies/wolf.js';

const STEP = 1 / 60;

// The wolf carries a glow sprite now (the tree's stolen light), and render/glow.js draws its texture
// into a real <canvas> at first use. This file drives the presenter with no browser at all, so a
// canvas has to exist for createWolfPresenter to get as far as the flash behaviour under test.
//
// Deliberately a TEST shim and not a headless fallback inside glow.js: the game only ever runs in a
// browser, and a production branch that exists solely so a test can import a module is the kind of
// code that later gets mistaken for a supported mode. Nothing here is asserted on -- it exists to let
// the module load. It records nothing, so a test cannot accidentally start proving things about it.
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

// A minimal stand-in for the loaded wolf.glb: one mesh, one material, no animation clips. Good
// enough for createWolfPresenter -- with an empty animations array, play() finds nothing in its
// action map and returns before touching anything clip-related, so update() is safe to drive exactly
// as main.js drives it every frame.
function rigWithAMesh(baseEmissiveHex) {
  const material = new THREE.MeshStandardMaterial({ color: 0x887766 });
  material.emissive.setHex(baseEmissiveHex);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  const root = new THREE.Object3D();
  root.add(mesh);
  return { material, root };
}

const idleWolf = { biteCooldown: 0, heading: 0, hp: 3, mode: 'idle', modeSeconds: 0, x: 0, z: 0 };

test('a hit flashes the wolf white at the instant it lands', () => {
  const { material, root } = rigWithAMesh(0x000000);
  const presenter = createWolfPresenter(root, []);

  presenter.flashHit();
  presenter.update(0, idleWolf); // sampled at elapsed 0 -- full strength, nothing has faded yet

  assert.equal(material.emissive.getHex(), 0xffffff);
});

test('the flash fades back to the material\'s OWN base colour, not an assumed black', () => {
  // Stands in for a hypothetical authored glow (eyes, a rune) surviving normaliseCharacterMaterial.
  // This proves capture-and-restore rather than a hardcoded reset to black -- see the comment next to
  // flashTargets in wolf.js for why "assumed instead of measured" is the mistake to avoid here.
  const { material, root } = rigWithAMesh(0x224466);
  const presenter = createWolfPresenter(root, []);

  presenter.flashHit();
  for (let t = 0; t < WOLF_HIT_FLASH_SECONDS + STEP; t += STEP) presenter.update(STEP, idleWolf);

  assert.equal(material.emissive.getHex(), 0x224466, 'restored to its own base, not zeroed');
});

test('the flash is brightest right after impact and fades rather than snapping off', () => {
  const { material, root } = rigWithAMesh(0x000000);
  const presenter = createWolfPresenter(root, []);

  presenter.flashHit();
  presenter.update(0, idleWolf);
  const atStart = material.emissive.r;
  presenter.update(WOLF_HIT_FLASH_SECONDS / 2, idleWolf);
  const atMidpoint = material.emissive.r;

  assert.ok(atStart > atMidpoint, `expected a fade, saw ${atStart} then ${atMidpoint}`);
  assert.ok(atMidpoint > 0, 'still visibly flashing at the midpoint, not already off');
});

test('the defeat flash outlasts the hit flash on the actual wolf, not just in the constants', () => {
  const { material, root } = rigWithAMesh(0x000000);
  const presenter = createWolfPresenter(root, []);

  presenter.flashDefeated();
  for (let t = 0; t < WOLF_HIT_FLASH_SECONDS + STEP; t += STEP) presenter.update(STEP, idleWolf);

  assert.notEqual(
    material.emissive.getHex(), 0x000000,
    `a defeat flash must still show after ${WOLF_HIT_FLASH_SECONDS}s, the hit flash's own duration`,
  );
});

test('a second hit restarts the flash rather than adding to it', () => {
  const { material, root } = rigWithAMesh(0x000000);
  const presenter = createWolfPresenter(root, []);

  presenter.flashHit();
  for (let t = 0; t < WOLF_HIT_FLASH_SECONDS * 0.8; t += STEP) presenter.update(STEP, idleWolf);
  presenter.flashHit(); // struck again before the first flash finished fading
  presenter.update(0, idleWolf);

  assert.equal(material.emissive.getHex(), 0xffffff, 'the second hit is back to full strength');
});

test('a wolf presenter with no emissive-capable materials does not throw when flashed', () => {
  // MeshBasicMaterial has no .emissive at all -- the defensive branch in wolf.js's flashTargets scan.
  const root = new THREE.Object3D();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  const presenter = createWolfPresenter(root, []);

  assert.doesNotThrow(() => {
    presenter.flashHit();
    presenter.update(STEP, idleWolf);
  });
});

test('mode-driven animation still runs while a flash is in progress', () => {
  // The flash must be additive, not a takeover -- position, heading and clip selection are the
  // fight's own state and must keep updating even mid-flash.
  const { root } = rigWithAMesh(0x000000);
  const presenter = createWolfPresenter(root, []);

  presenter.flashHit();
  presenter.update(STEP, { ...idleWolf, x: 1.5, z: -2, heading: 0.4 });

  assert.equal(root.position.x, 1.5);
  assert.equal(root.position.z, -2);
  assert.equal(root.rotation.y, 0.4);
});

// prefersReducedMotion() in wolf.js reads `typeof window !== 'undefined'`, which is exactly what lets
// every other test in this file call flashHit()/flashDefeated() under plain `node --test` with no
// window at all -- proven by every test above this one passing. This test instead stands a fake
// window up to reach the OTHER branch, the one an OS-level "reduce motion" setting actually takes in
// a browser, and confirms it changes the flash's duration rather than being dead code.
test('prefers-reduced-motion shortens the flash instead of the duration this file measures elsewhere', () => {
  const originalWindow = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  try {
    const { material, root } = rigWithAMesh(0x000000);
    const presenter = createWolfPresenter(root, []);

    presenter.flashHit();
    presenter.update(0, idleWolf);
    assert.equal(material.emissive.getHex(), 0xffffff, 'still flashes at full strength at the instant of impact');

    // Past REDUCED_MOTION_FLASH_SECONDS but comfortably short of WOLF_HIT_FLASH_SECONDS -- only
    // reachable this fast if beginFlash actually picked the reduced duration.
    presenter.update(REDUCED_MOTION_FLASH_SECONDS + STEP, idleWolf);
    assert.ok(
      REDUCED_MOTION_FLASH_SECONDS + STEP < WOLF_HIT_FLASH_SECONDS,
      'test setup: the reduced duration must be well under the normal one for this to prove anything',
    );
    assert.equal(material.emissive.getHex(), 0x000000, 'already spent, far sooner than a normal hit flash');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
