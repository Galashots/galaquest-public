// The Keeper turns to watch whoever walks up to him. The pure functions behind that are here; the
// presenter that calls them, and the AP2-A native-clip turn controller it delegates to, live in
// zoneLoader.js with three.js -- the controller's own state-machine behaviour is pinned in
// test/keeper-turn-controller.test.mjs, and what it looks like is judged in captures.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEEPER_GREET_REARM_RADIUS_METERS,
  KEEPER_NOTICE_RADIUS_METERS,
  KEEPER_TURN_CLIP_MIN_RADIANS,
  KEEPER_WAVE_RADIUS_METERS,
  clipNetYaw,
  greetingLatch,
  quaternionYaw,
  shortestTurn,
  stripPositionTrack,
  turnClipDirection,
  turnToward,
} from '../public/src/world/zoneLoader.js';

const TAU = Math.PI * 2;

test('shortestTurn takes the short way round, including across the +/-PI seam', () => {
  assert.ok(Math.abs(shortestTurn(0, 0.5) - 0.5) < 1e-12);
  assert.ok(Math.abs(shortestTurn(0.5, 0) + 0.5) < 1e-12);
  // The case that makes this function exist: 170 degrees to -170 degrees is a 20-degree turn, not
  // a 340-degree one. Naive subtraction spins a character almost all the way round to greet
  // someone who walked up on the other side.
  const from = (170 * Math.PI) / 180;
  const to = (-170 * Math.PI) / 180;
  assert.ok(Math.abs(shortestTurn(from, to) - (20 * Math.PI) / 180) < 1e-9,
    `turned ${((shortestTurn(from, to) * 180) / Math.PI).toFixed(1)} degrees`);
});

test('shortestTurn always answers within half a turn, for any input', () => {
  for (let a = -8; a <= 8; a += 0.37) {
    for (let b = -8; b <= 8; b += 0.53) {
      const delta = shortestTurn(a, b);
      assert.ok(delta > -Math.PI - 1e-9 && delta <= Math.PI + 1e-9, `${a}->${b} gave ${delta}`);
      // And it really is a way of getting from a to b, not just a small number.
      const arrived = ((a + delta - b) % TAU + TAU) % TAU;
      assert.ok(arrived < 1e-9 || Math.abs(arrived - TAU) < 1e-9, `${a}->${b} does not arrive`);
    }
  }
});

test('turnToward moves at most one step, and settles exactly rather than hunting', () => {
  const step = 0.1;
  assert.ok(Math.abs(turnToward(0, 1, step) - 0.1) < 1e-12);
  assert.ok(Math.abs(turnToward(0, -1, step) + 0.1) < 1e-12);
  // Within one step it snaps to the target -- no overshoot, no permanent jitter.
  assert.equal(turnToward(0, 0.05, step), 0.05);
  assert.equal(turnToward(0.05, 0.05, step), 0.05);
});

test('turnToward always converges, and never the long way round', () => {
  for (const target of [3.0, -3.0, 0.2, -2.9]) {
    let heading = 2.9;
    let steps = 0;
    while (Math.abs(shortestTurn(heading, target)) > 1e-9 && steps < 1000) {
      heading = turnToward(heading, target, 0.05);
      steps += 1;
    }
    assert.ok(steps < 1000, `never reached ${target}`);
    // Half a turn at 0.05 rad/step is 63 steps; anything much past that went the long way.
    assert.ok(steps <= 64, `reached ${target} in ${steps} steps, which is the long way round`);
  }
});

test('he notices you before he waves at you, or the wave is the whole of noticing', () => {
  assert.ok(KEEPER_NOTICE_RADIUS_METERS > KEEPER_WAVE_RADIUS_METERS,
    'the notice radius must be larger than the wave radius');
});

// ── AP2-A: native-clip turning, root-motion policy ──────────────────────────────────────────────

/** [x, y, z, w] for a pure yaw (rotation about world/bone Y) of `degrees`. */
function yawQuaternion(degrees) {
  const halfRadians = (degrees * Math.PI) / 360;
  return [0, Math.sin(halfRadians), 0, Math.cos(halfRadians)];
}

test('quaternionYaw reads back exactly what yawQuaternion put in, for a spread of angles', () => {
  for (const degrees of [0, 1, 45, 90, 104.42, 119.32, -104.42, -90, -45, 179, -179]) {
    const measured = (quaternionYaw(yawQuaternion(degrees)) * 180) / Math.PI;
    assert.ok(Math.abs(measured - degrees) < 1e-6, `${degrees} deg measured as ${measured.toFixed(4)} deg`);
  }
});

test('quaternionYaw matches measure_root_motion.mjs on a non-trivial rotation, not only pure-Y cases', () => {
  // A real Meshy Hips track carries a little roll/pitch alongside the yaw a turn clip is authored
  // for. Composing a small X rotation with a 90 degree Y rotation and reading the result back proves
  // the matrix-element formula, not merely that yawQuaternion's own construction round-trips.
  const yaw90 = yawQuaternion(90);
  const smallX = [Math.sin((5 * Math.PI) / 360), 0, 0, Math.cos((5 * Math.PI) / 360)];
  // Hamilton product yaw90 * smallX (apply smallX first, then yaw90 -- same convention a rig's own
  // rest-then-animated composition would use).
  const [x1, y1, z1, w1] = yaw90;
  const [x2, y2, z2, w2] = smallX;
  const composed = [
    w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
    w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
    w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
    w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
  ];
  const measured = (quaternionYaw(composed) * 180) / Math.PI;
  // The X component perturbs the yaw reading only at second order -- close to 90, not exact.
  assert.ok(Math.abs(measured - 90) < 1, `expected close to 90 deg with a small X tilt, got ${measured.toFixed(3)}`);
});

test('clipNetYaw reads the SAME Idle_Turn_Left/Right magnitudes measure_root_motion.mjs measured', () => {
  // The exact shape a stripped GLTFLoader-built clip has: one QuaternionKeyframeTrack named
  // 'Hips.quaternion', values packed [x0,y0,z0,w0, ..., xN,yN,zN,wN]. Pinned to the LIVE-measured
  // figures (tools/foundry/measure_root_motion.mjs against tmp/ap2/keeper/.../Idle_Turn_Left and
  // _Right) rather than round numbers, so a re-export that changes the throw is caught here too.
  const left = { tracks: [{ name: 'Hips.quaternion', values: [...yawQuaternion(-14.03), ...yawQuaternion(-14.03 + 119.32)] }] };
  const right = { tracks: [{ name: 'Hips.quaternion', values: [...yawQuaternion(-0.41), ...yawQuaternion(-0.41 - 104.42)] }] };

  assert.ok(Math.abs((clipNetYaw(left, 'Hips') * 180) / Math.PI - 119.32) < 1e-6);
  assert.ok(Math.abs((clipNetYaw(right, 'Hips') * 180) / Math.PI - (-104.42)) < 1e-6);
});

test('clipNetYaw degrades to 0 for a clip with no rotation track on that node, rather than throwing', () => {
  assert.equal(clipNetYaw({ tracks: [] }, 'Hips'), 0);
  assert.equal(clipNetYaw({ tracks: [{ name: 'Hips.position', values: [0, 0, 0, 1, 1, 1] }] }, 'Hips'), 0);
});

test('stripPositionTrack removes exactly the named node\'s position track and nothing else', () => {
  const tracks = [
    { name: 'Hips.position', values: [] },
    { name: 'Hips.quaternion', values: [] },
    { name: 'Hips.scale', values: [] },
    { name: 'LeftArm.position', values: [] },
  ];
  const stripped = stripPositionTrack(tracks, 'Hips');
  assert.deepEqual(stripped.map((t) => t.name), ['Hips.quaternion', 'Hips.scale', 'LeftArm.position']);
});

test('sabotage: stripPositionTrack is not a no-op -- a clip that never carried the track proves nothing', () => {
  const tracks = [{ name: 'Hips.quaternion', values: [] }];
  const withPosition = [{ name: 'Hips.position', values: [] }, ...tracks];
  assert.equal(stripPositionTrack(withPosition, 'Hips').length, tracks.length);
  assert.equal(stripPositionTrack(tracks, 'Hips').length, tracks.length, 'nothing to remove here -- both must be checked');
});

test('turnClipDirection floors out small requests and picks direction by sign above the floor', () => {
  const justBelow = KEEPER_TURN_CLIP_MIN_RADIANS - 0.001;
  const justAbove = KEEPER_TURN_CLIP_MIN_RADIANS + 0.001;
  assert.equal(turnClipDirection(justBelow), null, 'a 30-ish degree ask must not trigger a full clip flourish');
  assert.equal(turnClipDirection(-justBelow), null);
  assert.equal(turnClipDirection(justAbove), 'left');
  assert.equal(turnClipDirection(-justAbove), 'right');
  assert.equal(turnClipDirection((175 * Math.PI) / 180), 'left', 'a near-reversal still resolves to a direction');
});

test('sabotage: turnClipDirection is not a constant -- both directions and the floor are real', () => {
  assert.notEqual(turnClipDirection(1), turnClipDirection(-1));
  assert.equal(turnClipDirection(0), null);
});

// ── the greeting latch (AP2-A follow-up, 2026-08-15) ────────────────────────────────────────────
// These pin a defect that shipped and was caught by the mandatory artist's review, not by a test:
// update() re-fired the wave on the very frame the 'finished' handler cleared `waving`, so the
// Keeper waved in a continuous loop for as long as anyone stood near him -- measured at 200/200
// samples over 10 s against a 1.967 s clip. Because startWave() clears `talking`, and keeperSpeech.js
// reads the SAME 2.0 m radius, that also starved the `talk` clip forever: Talk_Passionately shipped
// inside keeper.glb and could never play at all. The old drive-village gate passed throughout,
// because it only asserted `waving` was true -- which the bug guaranteed.

test('the greeting fires once on approach, not every frame the hero stands there', () => {
  let greeted = false;
  let fires = 0;
  // A child walks up and stays put for two seconds of frames, reading the quest line.
  for (let i = 0; i < 120; i += 1) {
    const r = greetingLatch(1.4, greeted);
    greeted = r.greeted;
    if (r.fire) fires += 1;
  }
  assert.equal(fires, 1, 'standing inside the radius must greet exactly once, not on a loop');
});

test('the greeting re-arms only after the hero leaves, and greets again on a fresh approach', () => {
  let greeted = false;
  const step = (d) => { const r = greetingLatch(d, greeted); greeted = r.greeted; return r.fire; };

  assert.equal(step(1.4), true, 'first approach greets');
  assert.equal(step(1.4), false, 'still standing there -- no second greeting');
  assert.equal(step(2.3), false, 'inside the hysteresis band: left the wave radius but not re-armed');
  assert.equal(step(1.4), false, 'stepping back in from the band must NOT re-greet');
  assert.equal(step(4.0), false, 'walked away: re-arms, but leaving is not itself a greeting');
  assert.equal(step(1.4), true, 'a genuinely fresh approach greets again');
});

test('the re-arm radius is wider than the trigger radius, so boundary jitter cannot re-greet', () => {
  assert.ok(
    KEEPER_GREET_REARM_RADIUS_METERS > KEEPER_WAVE_RADIUS_METERS,
    'without a gap, a hero hovering on the boundary re-arms and re-greets every few frames',
  );
  // A hero jittering across the trigger radius by a few centimetres, the way joystick drift and
  // network correction actually move him.
  let greeted = false;
  let fires = 0;
  for (const d of [1.98, 2.02, 1.97, 2.03, 1.99, 2.01, 1.96, 2.04]) {
    const r = greetingLatch(d, greeted);
    greeted = r.greeted;
    if (r.fire) fires += 1;
  }
  assert.equal(fires, 1, 'jitter across the trigger radius must not produce a burst of greetings');
});

test('sabotage: the latch really is what stops the loop -- without it every frame in range fires', () => {
  // The pre-fix behaviour, reproduced exactly: no latch state carried between frames.
  let fires = 0;
  for (let i = 0; i < 120; i += 1) if (greetingLatch(1.4, false).fire) fires += 1;
  assert.equal(fires, 120, 'this is the bug: proximity alone fires on every single frame');
});
