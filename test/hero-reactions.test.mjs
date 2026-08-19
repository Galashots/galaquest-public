import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as THREE from '../public/vendor/three.module.min.js';

import { createReactionAnimator, findReactionClips } from '../public/src/character/reactClips.js';

// Programmatic clips, same pattern as the other animator tests: a real THREE clip driving the
// root's own .position, so the mixer genuinely writes a pose and the tests measure that writing,
// not a stub's bookkeeping. Durations are arbitrary; the hero's real hit/death clips do not exist
// yet (the 2026-08-13 Meshy download died at 197MB unconfirmed), which is exactly why this module
// must behave when they are absent as well as when they arrive.
function makeClip(name, seconds = 0.5) {
  return new THREE.AnimationClip(name, seconds, [
    new THREE.VectorKeyframeTrack('.position', [0, seconds], [0, 0, 0, 0, 0, 1]),
  ]);
}

test('a hero with neither reaction clip gets no animator at all, so the caller can see the absence', () => {
  assert.equal(createReactionAnimator(new THREE.Object3D(), []), null);
  assert.equal(createReactionAnimator(new THREE.Object3D(), [makeClip('sword_slash')]), null);
});

test('findReactionClips finds by the same lowercase-substring rule the rest of the runtime uses', () => {
  const hit = makeClip('Hit_Reaction');
  const death = makeClip('death');
  const found = findReactionClips([makeClip('idle'), hit, death]);
  assert.equal(found.hit, hit);
  assert.equal(found.death, death);
});

test('a hit while not swinging plays the hit reaction and actually drives the pose', () => {
  const root = new THREE.Object3D();
  const animator = createReactionAnimator(root, [makeClip('hit'), makeClip('death')]);

  assert.equal(animator.triggerHit({ swinging: false }), true);
  assert.equal(animator.getState().hit, true);
  animator.update(0.25, { downSeconds: -1 });
  assert.ok(root.position.z > 0, 'the mixer must write the hit pose, not merely record that it would');
});

test("the owner's precedence rule: a hit during a swing is refused, not hidden", () => {
  // "attack takes precedence, and hit only shows if the testers are not attacking and only getting
  // hit" -- the owner, 2026-08-13. The frame ordering (reactions before swing, swing overwrites) would
  // hide a mid-swing hit anyway, but only while the swing runs; a 0.6s hit reaction triggered by a
  // bite landing 1.4s into a 1.5s swing would pop in for its tail end. Refusing at the trigger is
  // the rule, not the paint-over.
  const root = new THREE.Object3D();
  const animator = createReactionAnimator(root, [makeClip('hit'), makeClip('death')]);

  assert.equal(animator.triggerHit({ swinging: true }), false);
  assert.equal(animator.getState().hit, false);
  animator.update(0.25, { downSeconds: -1 });
  assert.equal(root.position.z, 0, 'a refused hit must not move the hero');
});

test('a downed hero plays death, holds the corpse, and releases it on respawn', () => {
  const root = new THREE.Object3D();
  const animator = createReactionAnimator(root, [makeClip('hit'), makeClip('death', 0.4)]);

  animator.update(0.016, { downSeconds: 0 });
  assert.equal(animator.getState().death, true);
  // Run well past the clip's 0.4s: clampWhenFinished must hold the last frame, because a corpse
  // that springs back to idle is the wolf-death bug wearing the hero's clothes.
  for (let i = 0; i < 60; i += 1) animator.update(0.05, { downSeconds: i * 0.05 });
  assert.equal(animator.getState().death, true);
  assert.ok(root.position.z > 0.99, 'the death pose must hold its final frame while down');

  animator.update(0.016, { downSeconds: -1 });
  assert.equal(animator.getState().death, false);
});

test('a hit is refused while the hero is down -- a corpse does not flinch', () => {
  const root = new THREE.Object3D();
  const animator = createReactionAnimator(root, [makeClip('hit'), makeClip('death')]);

  animator.update(0.016, { downSeconds: 0.5 });
  assert.equal(animator.triggerHit({ swinging: false }), false);
  assert.equal(animator.getState().hit, false);
});

test('death overrides an in-flight hit reaction rather than blending with it', () => {
  const root = new THREE.Object3D();
  const animator = createReactionAnimator(root, [makeClip('hit'), makeClip('death')]);

  animator.triggerHit({ swinging: false });
  animator.update(0.05, { downSeconds: -1 });
  animator.update(0.05, { downSeconds: 0 });
  assert.equal(animator.getState().death, true);
  assert.equal(animator.getState().hit, false, 'going down cancels the flinch');
});

test('one clip without the other degrades per-clip, not per-module', () => {
  const root = new THREE.Object3D();
  const hitOnly = createReactionAnimator(root, [makeClip('hit')]);
  assert.equal(hitOnly.triggerHit({ swinging: false }), true);
  // No death clip: going down is simply not animated, and must not throw.
  hitOnly.update(0.016, { downSeconds: 0 });
  assert.equal(hitOnly.getState().death, false);

  const deathOnly = createReactionAnimator(new THREE.Object3D(), [makeClip('death')]);
  assert.equal(deathOnly.triggerHit({ swinging: false }), false, 'no hit clip, no hit reaction');
  deathOnly.update(0.016, { downSeconds: 0 });
  assert.equal(deathOnly.getState().death, true);
});
