import { strict as assert } from 'node:assert';
import test from 'node:test';

import * as THREE from '../public/vendor/three.module.min.js';
import { createFollowCamera } from '../public/src/camera/follow.js';
import { headingToward } from '../public/src/world/zoneLoader.js';
import {
  CEREMONY_AUDIENCE_METERS,
  CEREMONY_ON_SCREEN_NDC_X,
  CEREMONY_ON_SCREEN_NDC_Y,
  WORKSHOP_BUILD_SECONDS,
  audienceCanSee,
  buildStageProgress,
  workshopTransition,
} from '../public/src/world/workshop.js';

// Same discipline zone-loader.test.mjs's own treeLitTransition tests use -- workshopTransition is
// deliberately built to the identical shape, so its tests are the identical shape too.

test('workshopTransition flips OFF -> ON as a real, changed transition', () => {
  assert.deepEqual(workshopTransition(false, true), { changed: true, built: true });
});

test('workshopTransition flips ON -> OFF as a real, changed transition', () => {
  assert.deepEqual(workshopTransition(true, false), { changed: true, built: false });
});

// Workshop I can never be un-bought (net/rewardStore.mjs's own durable idempotency), so this
// direction never fires in production -- proven anyway, the same way treeLitTransition proves its
// own OFF branch even though the relight only ever goes one way in practice today.
test('workshopTransition is idempotent: calling with the same value twice reports no change the second time', () => {
  assert.deepEqual(workshopTransition(true, true), { changed: false, built: true });
  assert.deepEqual(workshopTransition(false, false), { changed: false, built: false });
});

test('workshopTransition treats a non-boolean nextBuilt the same way Boolean-ish truthiness would', () => {
  assert.deepEqual(workshopTransition(false, undefined), { changed: false, built: false });
  assert.deepEqual(workshopTransition(false, 1), { changed: false, built: false });
});

// Sabotage-verify: a transition function that always reported changed:true would pass the two
// "flips" tests above too -- prove the idempotent branch really is reachable and distinct.
test('sabotage: workshopTransition\'s changed flag is not always true -- the idempotent case really differs', () => {
  const flip = workshopTransition(false, true);
  const repeat = workshopTransition(true, true);
  assert.notEqual(flip.changed, repeat.changed);
});

// ── the ceremony's shape ─────────────────────────────────────────────────────────────────────────
//
// What is NOT tested here, and cannot be: whether the finished Workshop reads as "that building is
// mine now" to a ten-year-old standing sixteen metres away. That is accepted by opening the captures
// the runtime probe takes from four approach bearings, per this repo's standing rule for anything
// you have to look at. What IS testable is the claim the whole staging rests on -- that the building
// finishes CHANGING SHAPE before it starts GLOWING -- which is a fact about five numbers.

// This began as two tests: one on the window the beat is budgeted, and one asserting the ceremony
// fitted inside drive-village-board.mjs's flat 4000 ms poll. The second passed, and the gate went
// red on hosted CI anyway -- main.js clamps deltaSeconds to 0.1 s, so below 10 fps the ceremony
// advances slower than wall clock and a 2.05 s build can take over 4 s of it on a loaded runner.
// A ceremony length cannot be checked against a number some other file happens to hold, so that
// harness now derives its budget from WORKSHOP_BUILD_SECONDS and this asserts only the property
// that is genuinely local: a ceremony a child sits through before regaining control stays short.
test('the ceremony fits the window the transformation is supposed to occupy', () => {
  assert.ok(WORKSHOP_BUILD_SECONDS >= 1 && WORKSHOP_BUILD_SECONDS <= 2.5,
    `${WORKSHOP_BUILD_SECONDS}s is outside the 1-2s of concentrated feedback this beat is budgeted`);
});

test('every stage is finished by the time the ceremony is over', () => {
  for (const [name, value] of Object.entries(buildStageProgress(WORKSHOP_BUILD_SECONDS))) {
    assert.equal(value, 1, `${name} was still at ${value} when the ceremony ended`);
  }
});

test('nothing has started before the ceremony starts', () => {
  for (const [name, value] of Object.entries(buildStageProgress(0))) {
    assert.equal(value, 0, `${name} was already at ${value} at t=0`);
  }
});

// THE claim. A child who has just spent two coins and a shard is being shown one thing at a time:
// first a building appears, and only then does it light up. If ignition overlaps the silhouette
// work, the two events land on the same frames and neither is legible.
test('the Workshop finishes changing SHAPE before it starts glowing', () => {
  const stage = buildStageProgress(1.45);
  assert.equal(stage.frame, 1, 'the frame was still going up when the forge lit');
  assert.equal(stage.roof, 1, 'the roof was still coming down when the forge lit');
  assert.ok(stage.stack > 0.9, `the chimney was only ${stage.stack} of the way up when the forge lit`);
  assert.equal(stage.ignite, 0, 'the forge had already begun lighting');
});

// The order the parts arrive in, each one asserted at the moment the next has not begun. A frame
// that arrived after its own roof would still pass a test that only checked the finished building.
test('the parts arrive in build order: frame, then roof, then stack, then tools', () => {
  const started = (t) => Object.entries(buildStageProgress(t))
    .filter(([, value]) => value > 0).map(([name]) => name);
  assert.deepEqual(started(0.2), ['frame']);
  assert.deepEqual(started(0.5), ['frame', 'roof']);
  assert.deepEqual(started(0.9), ['frame', 'roof', 'stack']);
  assert.deepEqual(started(1.4), ['frame', 'roof', 'stack', 'tools']);
});

test('the stages overlap rather than running end to end', () => {
  // Cut end to end, four stages read as four separate pops. At least one moment must exist where two
  // are genuinely mid-flight together.
  const midflight = Object.values(buildStageProgress(0.5)).filter((v) => v > 0 && v < 1);
  assert.ok(midflight.length >= 2, `only ${midflight.length} stage in flight at t=0.5`);
});

test('every stage is monotonic and clamped, however absurd the clock', () => {
  const previous = { frame: -1, roof: -1, stack: -1, tools: -1, ignite: -1 };
  for (let t = -1; t <= 4; t += 0.05) {
    for (const [name, value] of Object.entries(buildStageProgress(t))) {
      assert.ok(value >= 0 && value <= 1, `${name} left 0..1 at t=${t.toFixed(2)}: ${value}`);
      assert.ok(value >= previous[name], `${name} went backwards at t=${t.toFixed(2)}`);
      previous[name] = value;
    }
  }
});

test('the ceremony answers safely for a clock nobody should be passing', () => {
  for (const bad of [Number.NaN, -Infinity]) {
    assert.deepEqual(buildStageProgress(bad), { frame: 0, roof: 0, stack: 0, tools: 0, ignite: 0 });
  }
  for (const value of Object.values(buildStageProgress(Infinity))) assert.equal(value, 1);
});

// Sabotage-verify: five stages that were secretly the same clock would pass "finished by the end"
// and "nothing before the start" without ever staging anything.
test('sabotage: the five stages are five different clocks, not one under five names', () => {
  // Asserted across the whole ceremony rather than at one instant: at any single moment several
  // stages legitimately read the same 0 or the same 1, so a snapshot proves nothing. What has to be
  // true is that no PAIR of stages agrees the whole way through.
  const names = Object.keys(buildStageProgress(0));
  const samples = [];
  for (let t = 0; t <= WORKSHOP_BUILD_SECONDS; t += 0.05) samples.push(buildStageProgress(t));
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      assert.ok(samples.some((s) => s[names[i]] !== s[names[j]]),
        `${names[i]} and ${names[j]} are the same clock under two names`);
    }
  }
});

// Sabotage-verify: WORKSHOP_BUILD_SECONDS is derived from the stage table rather than typed beside
// it. Prove the derivation is load-bearing -- that it is the LATEST stage's end and not a constant
// that happens to agree today.
test('sabotage: the ceremony length really is the last stage\'s end, not a number typed beside it', () => {
  const justBefore = buildStageProgress(WORKSHOP_BUILD_SECONDS - 0.01);
  assert.ok(Object.values(justBefore).some((v) => v < 1),
    'every stage was already finished a hundredth of a second before the ceremony ended');
});

// ── the ceremony waits for its audience ──────────────────────────────────────────────────────────
//
// Driven through the game's OWN follow camera (camera/follow.js, three's math runs in node), not
// hand-typed NDC: the claim is about what a player can see, so the camera is placed exactly where
// the game would place it for a hero standing here facing there, and the test only says where the
// hero and the Workshop are.

function seenFrom({ heroAt, heading, workshopAt, distance }) {
  const camera = new THREE.PerspectiveCamera(42, 768 / 1024, 0.1, 100);
  const follow = createFollowCamera(camera, { heading, distance });
  follow.update(new THREE.Vector3(heroAt[0], 0, heroAt[1]));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const probe = new THREE.Vector3(workshopAt[0], 1.4, workshopAt[1]).project(camera);
  return audienceCanSee({
    metersFromHero: Math.hypot(workshopAt[0] - heroAt[0], workshopAt[1] - heroAt[1]),
    ndcX: probe.x, ndcY: probe.y, ndcZ: probe.z,
  });
}

test('audience: a Workshop a few metres ahead of a player who is facing it has an audience', () => {
  assert.equal(seenFrom({ heroAt: [0, 0], heading: headingToward(0, 0, -4, -4), workshopAt: [-4, -4] }), true);
  assert.equal(seenFrom({ heroAt: [0, 0], heading: headingToward(0, 0, -6, -6), workshopAt: [-6, -6] }), true);
});

test('audience: a Workshop straight ahead but beyond reading range is not an audience yet -- walk closer', () => {
  const far = [-9, -9];   // 12.7 m
  assert.equal(seenFrom({ heroAt: [0, 0], heading: headingToward(0, 0, ...far), workshopAt: far }), false);
  const near = [-6.5, -6.5];   // 9.2 m
  assert.equal(seenFrom({ heroAt: [0, 0], heading: headingToward(0, 0, ...near), workshopAt: near }), true);
});

test('audience: a Workshop off to the side of the frame is not an audience -- the player is not facing it', () => {
  // Facing north (+z), the Workshop 6 m due east: 21 degrees off the camera axis, outside a portrait
  // frame's 16-degree half-width.
  assert.equal(seenFrom({ heroAt: [0, 0], heading: headingToward(0, 0, 0, 10), workshopAt: [6, 0] }), false);
});

test('audience: a Workshop BEHIND the camera has no audience, however near the hero is to it', () => {
  // Zoomed right in, facing away: the camera sits between the hero and the building.
  assert.equal(seenFrom({ heroAt: [0, 0], heading: headingToward(0, 0, 0, 10), workshopAt: [0, -5], distance: 3 }), false);
});

test('audience: the vertical band is the wide one -- a building beyond the hero sits high in a follow-camera frame and still counts', () => {
  assert.equal(audienceCanSee({ metersFromHero: 8, ndcX: 0, ndcY: 0.85, ndcZ: 0.5 }), true);
  assert.equal(audienceCanSee({ metersFromHero: 8, ndcX: 0, ndcY: CEREMONY_ON_SCREEN_NDC_Y + 0.01, ndcZ: 0.5 }), false);
  assert.equal(audienceCanSee({ metersFromHero: 8, ndcX: CEREMONY_ON_SCREEN_NDC_X + 0.01, ndcY: 0, ndcZ: 0.5 }), false);
  assert.ok(CEREMONY_ON_SCREEN_NDC_X < CEREMONY_ON_SCREEN_NDC_Y);
});

test('audience: NaN range or NaN coordinates never count as an audience (a lost camera must not fire the one-time ceremony)', () => {
  assert.equal(audienceCanSee({ metersFromHero: NaN, ndcX: 0, ndcY: 0, ndcZ: 0.5 }), false);
  assert.equal(audienceCanSee({ metersFromHero: 3, ndcX: NaN, ndcY: 0, ndcZ: 0.5 }), false);
  assert.equal(audienceCanSee({ metersFromHero: 3, ndcX: 0, ndcY: 0, ndcZ: NaN }), false);
});

test('sabotage: audienceCanSee is not "always true when near" -- nearness with the building behind the camera is refused', () => {
  const near = { metersFromHero: 2 };
  assert.equal(audienceCanSee({ ...near, ndcX: 0, ndcY: 0, ndcZ: 0.5 }), true);
  assert.equal(audienceCanSee({ ...near, ndcX: 0, ndcY: 0, ndcZ: 1.2 }), false);
  assert.ok(CEREMONY_AUDIENCE_METERS > 2);
});
