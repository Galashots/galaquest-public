import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as THREE from '../public/vendor/three.module.min.js';

import { createRemotePlayers } from '../public/src/net/remotes.js';
import { RESPAWN_SECONDS, SWING_SECONDS } from '../public/src/combat/encounter.js';
import { DEATH_FALL_FRACTION } from '../public/src/character/reactClips.js';

// WHAT A CHILD SEES OF THEIR SIBLING.
//
// The wire has carried encounter.heroes[id].{swingSeconds, downSeconds} for EVERY hero since the
// party fight was written -- net/protocol.js decodeHeroes validates them per id, and
// net/gameServer.mjs publishes them from whichever engine holds that body. Only the local hero ever
// read them. So on a screen where two children fight one wolf, the sibling glided around in idle
// while the wolf lost hp from nowhere, and stood up straight through the two seconds they were dead.
//
// These tests measure the POSE, not a flag -- the lesson play-fight.mjs's body-height check taught
// on the local hero, applied one body over: a check that reads a flag proves the state arrived, only
// a check that reads the body proves a child would see it.
//
// Every clip here drives a CHILD object ('hips'), never the root: remotes.update writes the root's
// position from the snapshot every frame, so a root-track clip would be fighting the network for it.
// The real hero's clips drive bones for the same reason.

// Each clip writes the SAME track to a DIFFERENT value, so the pose identifies which animator wrote
// it. The first draft of this file gave idle and death the same 0->1 ramp, and three checks passed
// against code that had no reaction animator at all: "fallen" and "idle, two seconds into a looping
// clip" were the same number. That is the contaminated baseline the sword-arm check in
// play-fight.mjs got wrong three times, rebuilt one file over -- a check can only tell two things
// apart if the two things are apart.
function poseClip(name, seconds, from, to, node = 'hips') {
  return new THREE.AnimationClip(name, seconds, [
    new THREE.VectorKeyframeTrack(`${node}.position`, [0, seconds], [0, 0, from, 0, 0, to]),
  ]);
}

// A hero-shaped template: a root with one posable child, and the six clips the three animators look
// for by their real lowercase-substring names (locomotion: idle/walking/running, reactions:
// hit/death, swing: sword_slash). Standing is 0, the fall runs to +1, the swing to -1, so no two
// animators can be mistaken for each other.
function heroTemplate({ deathSeconds = 2.97 } = {}) {
  const root = new THREE.Object3D();
  root.name = 'hero-template';
  const hips = new THREE.Object3D();
  hips.name = 'hips';
  root.add(hips);
  return {
    root,
    animations: [
      poseClip('idle', 1, 0, 0),
      poseClip('walking', 1, 0.1, 0.1),
      poseClip('running', 1, 0.2, 0.2),
      poseClip('hit', 1.63, 0, 0.3),
      poseClip('death', deathSeconds, 0, 1),
      poseClip('sword_slash', SWING_SECONDS, 0, -1),
    ],
  };
}

function sampleOf(overrides = {}) {
  return new Map([['sib', { x: 0, z: 0, heading: 0, speed: 0, ...overrides }]]);
}

function hipsOf(scene) {
  return scene.getObjectByName('remote-sib').getObjectByName('hips');
}

test('a sibling who is swinging their sword is drawn swinging it', () => {
  const scene = new THREE.Scene();
  const remotes = createRemotePlayers(scene, heroTemplate());

  // Standing still, not swinging: whatever pose this is, it is the one to beat.
  remotes.update(sampleOf(), {
    deltaSeconds: 0.016,
    reactionDeltaSeconds: 0.016,
    heroes: { sib: { hp: 3, swingSeconds: -1, downSeconds: -1 } },
  });
  const resting = hipsOf(scene).position.z;

  // Mid-swing, as the server published it.
  remotes.update(sampleOf(), {
    deltaSeconds: 0.016,
    reactionDeltaSeconds: 0.016,
    heroes: { sib: { hp: 3, swingSeconds: SWING_SECONDS / 2, downSeconds: -1 } },
  });

  const swung = hipsOf(scene).position.z;
  assert.ok(swung < -0.1,
    `a sibling mid-swing must be posed by the swing clip (which drives z negative), not left in `
    + `idle at ${resting.toFixed(3)} -- got ${swung.toFixed(3)}`);
});

test('a sibling who has been knocked down is drawn on the ground', () => {
  const scene = new THREE.Scene();
  const remotes = createRemotePlayers(scene, heroTemplate());

  // The whole time they are down, at a frame rate a cheap tablet actually renders.
  let elapsed = 0;
  while (elapsed < RESPAWN_SECONDS) {
    remotes.update(sampleOf(), {
      deltaSeconds: 0.05,
      reactionDeltaSeconds: 0.05,
      heroes: { sib: { hp: 0, swingSeconds: -1, downSeconds: elapsed } },
    });
    elapsed += 0.05;
  }

  // The death clip is retimed to land the fall inside the window (reactClips.js DEATH_FALL_FRACTION),
  // so by the time they get up the clip is at its clamped last frame: fully fallen, z === 1.
  assert.ok(hipsOf(scene).position.z > 0.9,
    `a downed sibling must be lying down by the end of the ${RESPAWN_SECONDS}s they are dead, `
    + `not standing (fell to ${hipsOf(scene).position.z.toFixed(3)} of 1)`);
});

test('locomotion does not keep running a sibling who has been knocked down', () => {
  // The mechanical half, and the exact bug main.js fixed for the LOCAL hero: while down, nothing but
  // the death clip may write the pose, so locomotion is not called at all.
  //
  // AT A RUNNING SPEED, and that is the whole test. The first version of this check stood the
  // sibling still, deleted the down-skip as a sabotage, and stayed green -- at speed 0 locomotion
  // settles onto idle at a weight that never beats the death clip, so the one parameter value the
  // check happened to pick was the one where the mechanism it names is invisible. At 2.4 m/s the run
  // clip writes at full weight and wins outright: measured, the corpse was posed at the run clip's
  // 0.200 instead of the death clip's 1.000. Which is how a child actually gets bitten -- mid-charge,
  // not standing politely still.
  const scene = new THREE.Scene();
  const remotes = createRemotePlayers(scene, heroTemplate());

  let elapsed = 0;
  while (elapsed < RESPAWN_SECONDS) {
    remotes.update(sampleOf({ speed: 2.4 }), {
      deltaSeconds: 0.05,
      reactionDeltaSeconds: 0.05,
      heroes: { sib: { hp: 0, swingSeconds: -1, downSeconds: elapsed } },
    });
    elapsed += 0.05;
  }
  const fallen = hipsOf(scene).position.z;
  assert.ok(fallen > 0.9, `precondition: they fell (got ${fallen.toFixed(3)})`);

  // One more frame, still down, AFTER the clip has finished -- the frame where a finished action
  // stops advancing and anything else still writing would take the pose.
  remotes.update(sampleOf({ speed: 2.4 }), {
    deltaSeconds: 0.05,
    reactionDeltaSeconds: 0.05,
    heroes: { sib: { hp: 0, swingSeconds: -1, downSeconds: elapsed } },
  });
  const after = hipsOf(scene).position.z;
  assert.ok(after > 0.9 && Math.abs(after - fallen) < 0.05,
    `a sibling knocked down mid-run must be lying on the ground, not running -- was `
    + `${fallen.toFixed(3)}, now ${after.toFixed(3)} (the run clip poses 0.200)`);
});

test('a sibling who dies mid-swing collapses rather than snapping back to where the swing began', () => {
  // The other half of the order swap. swingClip's action.stop() restores the pose the skeleton held
  // when the swing STARTED -- which is stale the instant a hero dies mid-swing, and while down there
  // is no locomotion running to paper over it a frame later. So while down the swing updates FIRST
  // and the reaction second, and death is the write that survives the frame.
  //
  // The sequence is the real one: swinging, then bitten to death mid-arc, then the server drops the
  // swing (swingSeconds back to the -1 sentinel) while the hero is still down. That last transition
  // is the frame stop() fires on.
  const scene = new THREE.Scene();
  const remotes = createRemotePlayers(scene, heroTemplate());

  remotes.update(sampleOf(), {
    deltaSeconds: 0.05,
    reactionDeltaSeconds: 0.05,
    heroes: { sib: { hp: 1, swingSeconds: 0.4, downSeconds: -1 } },
  });
  // Down, still mid-swing.
  remotes.update(sampleOf(), {
    deltaSeconds: 0.05,
    reactionDeltaSeconds: 0.05,
    heroes: { sib: { hp: 0, swingSeconds: 0.6, downSeconds: 0 } },
  });
  // The server drops the swing. Everything after this is a corpse.
  let elapsed = 0.05;
  while (elapsed < RESPAWN_SECONDS) {
    remotes.update(sampleOf(), {
      deltaSeconds: 0.05,
      reactionDeltaSeconds: 0.05,
      heroes: { sib: { hp: 0, swingSeconds: -1, downSeconds: elapsed } },
    });
    elapsed += 0.05;
  }

  const z = hipsOf(scene).position.z;
  assert.ok(z > 0.9,
    `a sibling killed mid-swing must finish on the ground, not in the pose their swing started from `
    + `(got ${z.toFixed(3)}; the swing clip poses negative and its start pose is 0)`);
});

test('a sibling gets back up when the server says they did', () => {
  const scene = new THREE.Scene();
  const remotes = createRemotePlayers(scene, heroTemplate());

  let elapsed = 0;
  while (elapsed < RESPAWN_SECONDS) {
    remotes.update(sampleOf(), {
      deltaSeconds: 0.05,
      reactionDeltaSeconds: 0.05,
      heroes: { sib: { hp: 0, swingSeconds: -1, downSeconds: elapsed } },
    });
    elapsed += 0.05;
  }
  assert.ok(hipsOf(scene).position.z > 0.9, 'precondition: they went down');

  // downSeconds back to the -1 sentinel: respawned.
  for (let i = 0; i < 4; i += 1) {
    remotes.update(sampleOf(), {
      deltaSeconds: 0.05,
      reactionDeltaSeconds: 0.05,
      heroes: { sib: { hp: 3, swingSeconds: -1, downSeconds: -1 } },
    });
  }
  assert.ok(hipsOf(scene).position.z < 0.2,
    'a respawned sibling must be back on their feet (idle poses z at 0), not left lying on the '
    + `clamped last frame -- got ${hipsOf(scene).position.z.toFixed(3)}`);
});

test("a sibling's death clip is driven by the raw delta, not the movement clamp", () => {
  // THE SAME DEFECT ONE BODY OVER. main.js clamps its frame delta to 0.1s so a hitch cannot teleport
  // the hero; an animation mixer has no such hazard, and under that cap every reaction clip plays in
  // slow motion by the ratio. The local hero's death was measured reaching 9% of standing height
  // instead of 65% on a 3.1fps machine. remotes.update takes both numbers separately so the call
  // site has to say which is which -- passing the clamped one here is the bug, and this is the test
  // that would catch it.
  const scene = new THREE.Scene();
  const remotes = createRemotePlayers(scene, heroTemplate());

  // Three 300ms frames: the whole two seconds of being down at a hosted 3.3fps, clamped to 0.1.
  let elapsed = 0;
  while (elapsed < RESPAWN_SECONDS) {
    remotes.update(sampleOf(), {
      deltaSeconds: Math.min(0.3, 0.1),
      reactionDeltaSeconds: 0.3,
      heroes: { sib: { hp: 0, swingSeconds: -1, downSeconds: elapsed } },
    });
    elapsed += 0.3;
  }

  // At the raw delta the retimed clip finishes the fall in RESPAWN_SECONDS * DEATH_FALL_FRACTION and
  // clamps; at the clamped delta it gets a third of the way. The bar sits between the two.
  const fell = hipsOf(scene).position.z;
  assert.ok(fell > 0.9,
    `a sibling on a slow tablet must still fall over (reached ${fell.toFixed(3)} of 1; `
    + `the clamped delta would stop near ${(0.1 / 0.3).toFixed(2)} of the fall, and the fall is `
    + `${DEATH_FALL_FRACTION} of the window)`);
});

test('a sibling with no encounter entry is still drawn, walking', () => {
  // A hero can be in the players list before the fight knows about them, and offline there is no
  // encounter block at all. Neither may throw, and neither may leave a remote frozen.
  const scene = new THREE.Scene();
  const remotes = createRemotePlayers(scene, heroTemplate());

  remotes.update(sampleOf({ speed: 2 }), { deltaSeconds: 0.05, reactionDeltaSeconds: 0.05, heroes: {} });
  remotes.update(sampleOf({ speed: 2 }), { deltaSeconds: 0.05, reactionDeltaSeconds: 0.05 });
  assert.equal(remotes.count, 1);
  assert.equal(remotes.describe()[0].down, false);
});

test('describe() reports what each sibling is actually doing, for the harnesses', () => {
  const scene = new THREE.Scene();
  const remotes = createRemotePlayers(scene, heroTemplate());

  remotes.update(sampleOf(), {
    deltaSeconds: 0.016,
    reactionDeltaSeconds: 0.016,
    heroes: { sib: { hp: 3, swingSeconds: SWING_SECONDS / 2, downSeconds: -1 } },
  });
  assert.equal(remotes.describe()[0].swinging, true);
  assert.equal(remotes.describe()[0].down, false);

  remotes.update(sampleOf(), {
    deltaSeconds: 0.016,
    reactionDeltaSeconds: 0.016,
    heroes: { sib: { hp: 0, swingSeconds: -1, downSeconds: 0.1 } },
  });
  assert.equal(remotes.describe()[0].down, true);
  assert.equal(remotes.describe()[0].swinging, false);
});

test('a rig with no reaction or swing clips still drives remotes, it just cannot show them', () => {
  // Same degrade-per-clip contract createReactionAnimator and createClipSwingAnimator already have:
  // the absence is visible to the caller rather than crashing it.
  const scene = new THREE.Scene();
  const bare = heroTemplate();
  bare.animations = bare.animations.filter((clip) => /idle|walking|running/.test(clip.name));
  const remotes = createRemotePlayers(scene, bare);

  remotes.update(sampleOf(), {
    deltaSeconds: 0.016,
    reactionDeltaSeconds: 0.016,
    heroes: { sib: { hp: 0, swingSeconds: -1, downSeconds: 0.1 } },
  });
  assert.equal(remotes.count, 1);
  assert.equal(remotes.describe()[0].down, true);
});

test('a sibling who leaves and rejoins is animated again, not left behind by a stale mixer', () => {
  // Three mixers per remote now, and a mixer keeps its bindings keyed by root until told to let go
  // -- taking the root out of the scene does not do it. Only locomotion had a dispose(), because
  // only locomotion had ever been per-remote; the other two were written for the local hero, who
  // never leaves. This is the behaviour that would break if a rejoin picked up a stale binding.
  const scene = new THREE.Scene();
  const remotes = createRemotePlayers(scene, heroTemplate());
  const down = {
    deltaSeconds: 0.05,
    reactionDeltaSeconds: 0.05,
    heroes: { sib: { hp: 0, swingSeconds: -1, downSeconds: 0.1 } },
  };

  remotes.update(sampleOf(), down);
  assert.equal(remotes.count, 1);
  assert.equal(remotes.remove('sib'), true);
  assert.equal(remotes.count, 0);
  assert.equal(scene.getObjectByName('remote-sib'), undefined);

  // Same id back again -- a reconnect, which is the ordinary case, not an exotic one.
  let elapsed = 0;
  while (elapsed < RESPAWN_SECONDS) {
    remotes.update(sampleOf(), {
      deltaSeconds: 0.05,
      reactionDeltaSeconds: 0.05,
      heroes: { sib: { hp: 0, swingSeconds: -1, downSeconds: elapsed } },
    });
    elapsed += 0.05;
  }
  assert.equal(remotes.count, 1);
  assert.ok(hipsOf(scene).position.z > 0.9,
    `a rejoined sibling must animate like any other (fell to ${hipsOf(scene).position.z.toFixed(3)})`);
});

test('dispose() takes every remote and its mixers with it', () => {
  const scene = new THREE.Scene();
  const remotes = createRemotePlayers(scene, heroTemplate());
  remotes.update(new Map([
    ['a', { x: 0, z: 0, heading: 0, speed: 0 }],
    ['b', { x: 3, z: 0, heading: 0, speed: 0 }],
  ]), { deltaSeconds: 0.05, reactionDeltaSeconds: 0.05, heroes: {} });
  assert.equal(remotes.count, 2);
  remotes.dispose();
  assert.equal(remotes.count, 0);
  assert.equal(scene.children.length, 0);
});
