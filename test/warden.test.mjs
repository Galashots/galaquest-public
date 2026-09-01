// The Beacon Warden: the arc's boss, behind the stable identity 'beacon_warden'.
//
// The body used to be a procedural stack of boxes, and most of this file used to pin that stack's
// palette and silhouette. BW1 replaced it with the owner's real rigged GLB, so those assertions went
// with the geometry they described -- a test that pins the dimensions of deleted boxes is a fossil,
// not a safety net, and keeping it would have meant either lying about what ships or blocking the
// asset the owner actually made.
//
// What is pinned NOW is what can still be got wrong:
//
//   1. Every pose the rules can ask for, as a pure function a browserless test can drive. This
//      survived the swap intact and matters MORE than before: it is what poses the seven modes the
//      asset owns no clip for.
//   2. The mode -> clip map names only clips the shipped GLB actually contains, checked against the
//      file's own bytes. A renamed clip or a swapped asset goes red here rather than in a child's
//      hands, and a hero/keeper clip cannot be quietly grafted on.
//   3. The body separation stays under the Warden's own melee reach -- the one relationship that,
//      if broken, silently makes the boss unable to ever hit anybody.
//   4. The arc's constants stay coherent across the seal/lamp/brazier scale.

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SEAL_GLOW_CRACKED,
  SEAL_HEIGHTS_METERS,
} from '../public/src/world/coldSeals.js';
import {
  WARDEN_BODY_SEPARATION_METERS,
  WARDEN_MELEE_RANGE,
  separateFromWarden,
} from '../public/src/world/beaconSiege.js';
import {
  WARDEN_BRAZIER_BY_PHASE,
  WARDEN_BRAZIER_REST,
  WARDEN_CLIPS,
  WARDEN_DYING_SECONDS,
  WARDEN_GAIT_HZ,
  WARDEN_HEIGHT_METERS,
  WARDEN_MODE_CLIPS,
  WARDEN_OVERHEAD_SLAM_SECONDS,
  WARDEN_OVERHEAD_WINDUP_SECONDS,
  WARDEN_PULSE_CROUCH_SECONDS,
  WARDEN_PULSE_RING_RADIUS_METERS,
  WARDEN_PULSE_RING_SECONDS,
  WARDEN_SWEEP_SWING_SECONDS,
  WARDEN_SWEEP_WIND_SECONDS,
  WARDEN_URL,
  WARDEN_WAKE_SECONDS,
  wardenPose,
} from '../public/src/enemies/warden.js';

const HERO_HEIGHT_METERS = 1.48; // the shipped hero (see enemies/wolf.js's own sizing note)
const GATE_LAMP_LIT_STRENGTH = 0.9; // wildwoodGate.js's private LAMP_GLOW_STRENGTH, restated as in
// test/old-beacon.test.mjs

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The animation names the shipped GLB actually carries, read out of the file's own JSON chunk.
 *
 * Parsed rather than imported through a loader on purpose: GLTFLoader needs a browser to decode the
 * atlas, and the atlas has nothing to do with what a clip is called. Twenty lines of parsing is
 * authoritative where an importer is an interpretation.
 */
function shippedClipNames(url) {
  const data = readFileSync(join(repoRoot, 'public', url));
  const jsonLength = data.readUInt32LE(12);
  const gltf = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'));
  return (gltf.animations ?? []).map((animation) => animation.name);
}

// ── the real asset, and the clips it actually owns ────────────────────────────────────────────────

test('every clip the presenter names exists in the shipped GLB', () => {
  const shipped = new Set(shippedClipNames(WARDEN_URL));
  for (const [key, name] of Object.entries(WARDEN_CLIPS)) {
    assert.ok(shipped.has(name),
      `WARDEN_CLIPS.${key} names '${name}', which is not in ${WARDEN_URL}: [${[...shipped].join(', ')}]`);
  }
});

test('every mode -> clip mapping resolves to a clip the asset really has', () => {
  const shipped = new Set(shippedClipNames(WARDEN_URL));
  for (const [mode, name] of Object.entries(WARDEN_MODE_CLIPS)) {
    assert.ok(shipped.has(name), `mode '${mode}' plays '${name}', which the asset does not contain`);
  }
});

test('sabotage: the clip check DOES fail against a plausible-looking wrong name', () => {
  // The exact failure this guards: a name that reads perfectly in review ('idle', 'attack') but was
  // never in the file. Meshy exports carry armature-prefixed names, so the pretty guess is the wrong
  // one -- which is why the map is checked against bytes rather than against taste.
  const shipped = new Set(shippedClipNames(WARDEN_URL));
  assert.equal(shipped.has('idle'), false);
  assert.equal(shipped.has('attack'), false);
});

test('the asset owns no idle clip, so most modes must fall through to the pure pose', () => {
  // Not a wish -- a recorded measurement. If a future asset DOES ship an idle, this goes red and the
  // mode map should gain it rather than leaving a real clip unused.
  const shipped = shippedClipNames(WARDEN_URL);
  assert.equal(shipped.length, 3, `asset now has ${shipped.length} clips: ${shipped.join(', ')}`);
  const covered = Object.keys(WARDEN_MODE_CLIPS);
  for (const mode of ['dormant', 'waking', 'idle', 'pulse', 'hit', 'dying', 'dead']) {
    assert.ok(!covered.includes(mode), `'${mode}' claims a clip; the asset has none for it`);
  }
});

// ── the body you cannot walk through (#79) ────────────────────────────────────────────────────────

test('a hero standing inside the Warden is pushed out to its body radius', () => {
  const warden = { x: 0, z: 0, mode: 'idle' };
  const pushed = separateFromWarden({ x: 0.2, z: 0 }, warden);
  assert.ok(Math.hypot(pushed.x, pushed.z) >= WARDEN_BODY_SEPARATION_METERS - 1e-9,
    'a child inside the boss must end up on its surface, not inside it');
});

test('a hero already clear of the Warden is not dragged anywhere', () => {
  const warden = { x: 0, z: 0, mode: 'idle' };
  const away = { x: 5, z: 5 };
  assert.deepEqual(separateFromWarden(away, warden), away);
});

test('a DEAD Warden stops blocking -- the arena is the payoff, not a fenced-off circle', () => {
  const inside = { x: 0.2, z: 0 };
  assert.deepEqual(separateFromWarden(inside, { x: 0, z: 0, mode: 'dead' }), inside);
  // ...but the dormant kneel still blocks: #79's complaint was children walking through it before
  // the fight ever started.
  const dormant = separateFromWarden(inside, { x: 0, z: 0, mode: 'dormant' });
  assert.ok(Math.hypot(dormant.x, dormant.z) >= WARDEN_BODY_SEPARATION_METERS - 1e-9);
});

test('separation stays INSIDE melee reach, or the boss could never land a blow again', () => {
  // The one relationship whose breakage is silent: push the hero further out than the Warden can
  // reach and every attack whiffs forever, with no error and no failing state check anywhere.
  assert.ok(WARDEN_BODY_SEPARATION_METERS < WARDEN_MELEE_RANGE,
    `separation ${WARDEN_BODY_SEPARATION_METERS} m must stay under melee reach ${WARDEN_MELEE_RANGE} m`);
});

// ── the poses, driven browserlessly ───────────────────────────────────────────────────────────────

test('dormant kneels: compressed legs, bowed head, faint brazier -- a statue to wonder about', () => {
  const pose = wardenPose('dormant', 5);
  assert.ok(pose.legs01 < 0.75, 'legs barely bent is standing, not kneeling');
  assert.ok(pose.torsoPitch > 0.4, 'the bow is what reads as dormant at distance');
  assert.ok(pose.brazier < 0.5, 'a bright brazier on a dormant Warden promises a fight too early');
  assert.notEqual(pose.armPitchL, pose.armPitchR, 'one fist rests forward -- even the kneel is asymmetric');
});

test('waking rises from the kneel to the stand over the stated seconds, brazier flaring', () => {
  const start = wardenPose('waking', 0);
  const dormant = wardenPose('dormant', 0);
  assert.ok(Math.abs(start.legs01 - dormant.legs01) < 1e-9, 'the rise starts exactly where the kneel was');
  const mid = wardenPose('waking', WARDEN_WAKE_SECONDS / 2);
  const done = wardenPose('waking', WARDEN_WAKE_SECONDS);
  assert.ok(dormant.legs01 < mid.legs01 && mid.legs01 < done.legs01, 'it rises monotonically -- no pop');
  assert.ok(Math.abs(done.legs01 - 1) < 1e-9);
  assert.ok(mid.brazier > done.brazier, 'the flare peaks during the rise and settles');
  // Reduced motion: the state change lands, the movement is skipped -- the Beacon stir's contract.
  assert.equal(wardenPose('waking', 0, true).legs01, 1);
});

test('idle breathes, and holds still under reduced motion', () => {
  const a = wardenPose('idle', 0.7);
  const b = wardenPose('idle', 2.1);
  assert.notEqual(a.breath, b.breath, 'a boss with no breath is a prop');
  assert.ok(Math.abs(a.breath - 1) < 0.03, 'and the breath is subtle, not a bellows');
  assert.equal(wardenPose('idle', 0.7, true).breath, wardenPose('idle', 2.1, true).breath);
});

test('the walk counter-swings the arms and keeps the bob low and slow', () => {
  const quarter = wardenPose('walk', 0.25 / WARDEN_GAIT_HZ);
  assert.ok((quarter.armPitchL - 0.08) * (quarter.armPitchR - 0.08) < 0,
    'the arms must swing AGAINST each other');
  assert.ok(WARDEN_GAIT_HZ <= 0.8, 'a fast stride is a jog, and this thing must never jog');
  let maxBob = 0;
  for (let t = 0; t < 4; t += 0.05) maxBob = Math.max(maxBob, wardenPose('walk', t).bobY);
  assert.ok(maxBob > 0 && maxBob < 0.08, `a ${maxBob.toFixed(3)} m bob: feet need weight, not bounce`);
  assert.equal(wardenPose('walk', 0.7, true).bobY, 0, 'reduced motion keeps the gait, drops the bob');
});

test('overhead: arms rise high over the windup, then SLAM down an order of magnitude faster', () => {
  const raised = wardenPose('overhead', WARDEN_OVERHEAD_WINDUP_SECONDS - 1e-6);
  assert.ok(raised.armPitchL > 2.4, `arms only reach ${raised.armPitchL.toFixed(2)} rad -- not overhead`);
  const slammed = wardenPose('overhead', WARDEN_OVERHEAD_WINDUP_SECONDS + WARDEN_OVERHEAD_SLAM_SECONDS);
  assert.ok(slammed.armPitchL < 0.7, 'the slam has to land, not hover');
  assert.ok(slammed.torsoPitch > 0.3, 'the whole torso commits to the blow');
  assert.ok(WARDEN_OVERHEAD_SLAM_SECONDS * 5 < WARDEN_OVERHEAD_WINDUP_SECONDS,
    'slow up, fast down is what weight means');
});

test('sweep winds right and swings left -- rotation, a different silhouette from the overhead', () => {
  const wound = wardenPose('sweep', WARDEN_SWEEP_WIND_SECONDS - 1e-6);
  assert.ok(wound.torsoYaw < -0.5, 'it has to visibly wind up on the other side first');
  const swung = wardenPose('sweep', WARDEN_SWEEP_WIND_SECONDS + WARDEN_SWEEP_SWING_SECONDS);
  assert.ok(swung.torsoYaw > 0.5, 'and cross the whole front arc');
  assert.ok(wound.armPitchL < 2.0, 'arms carried forward, not overhead -- that is the other attack');
});

test('pulse compresses while the brazier surges, then sends the cold ring out and gone', () => {
  const crouched = wardenPose('pulse', WARDEN_PULSE_CROUCH_SECONDS - 1e-6);
  assert.ok(crouched.legs01 < 0.85 && crouched.brazier > 2, 'the surge IS the tell');
  assert.equal(crouched.ring, null, 'no ring before the release');
  const early = wardenPose('pulse', WARDEN_PULSE_CROUCH_SECONDS + WARDEN_PULSE_RING_SECONDS * 0.1);
  const late = wardenPose('pulse', WARDEN_PULSE_CROUCH_SECONDS + WARDEN_PULSE_RING_SECONDS * 0.9);
  assert.ok(early.ring.radius01 < late.ring.radius01, 'the ring expands');
  assert.ok(early.ring.opacity > late.ring.opacity, 'and fades as it goes');
  assert.equal(wardenPose('pulse', WARDEN_PULSE_CROUCH_SECONDS + WARDEN_PULSE_RING_SECONDS + 0.1).ring, null);
  assert.ok(WARDEN_PULSE_RING_RADIUS_METERS > 3 && WARDEN_PULSE_RING_RADIUS_METERS < 4);
});

test('reduced motion shows the pulse ring at full size briefly instead of animating it', () => {
  const shown = wardenPose('pulse', WARDEN_PULSE_CROUCH_SECONDS + 0.1, true);
  assert.equal(shown.ring.radius01, 1, 'the area the ring claims is gameplay information');
  const gone = wardenPose('pulse', WARDEN_PULSE_CROUCH_SECONDS + WARDEN_PULSE_RING_SECONDS * 0.6, true);
  assert.equal(gone.ring, null);
});

test('hit flinches and returns to neutral, so repeated hits cannot drift the pose', () => {
  const mid = wardenPose('hit', 0.12);
  assert.ok(mid.torsoPitch < wardenPose('idle', 0, true).torsoPitch, 'it recoils BACK');
  const after = wardenPose('hit', 1);
  assert.ok(Math.abs(after.torsoPitch - 0.06) < 1e-9);
});

test('dying folds forward, sinks into the ground, and the brazier collapses to nothing', () => {
  const early = wardenPose('dying', WARDEN_DYING_SECONDS * 0.3);
  const late = wardenPose('dying', WARDEN_DYING_SECONDS);
  assert.ok(early.torsoPitch > 0.3 && late.torsoPitch > 1.0, 'it folds, it does not tip like a plank');
  assert.ok(late.rootY < -1.8, `sunk only ${late.rootY.toFixed(2)} m -- the body must leave the field`);
  assert.ok(early.rootY > late.rootY, 'the sink is monotonic');
  assert.equal(late.brazier, 0, 'the glow goes out BEFORE the body is gone -- the light is the death');
  assert.equal(late.visible, true, 'dying stays watchable; only dead hides');
});

test('dead is gone', () => {
  const pose = wardenPose('dead', 0);
  assert.equal(pose.visible, false);
  assert.equal(pose.brazier, 0);
});

test('an unknown mode is a standing Warden, not an exception -- the wolf\'s own fallback rule', () => {
  const pose = wardenPose('somersault', 3);
  assert.equal(pose.visible, true);
  assert.equal(pose.legs01, 1);
});

// Sabotage-verify: the pose checks are proven able to fail -- a Warden that never actually raises
// its arms would break the overhead assertion, shown here by asking mid-windup.
test('sabotage: the overhead check DOES fail against the half-raised mid-windup frame', () => {
  assert.ok(wardenPose('overhead', WARDEN_OVERHEAD_WINDUP_SECONDS * 0.4).armPitchL <= 2.4);
});

// ── the arc's constants stay coherent across both new files ───────────────────────────────────────

test('the Warden and the seals agree about scale and light', () => {
  assert.ok(WARDEN_HEIGHT_METERS > Math.max(...SEAL_HEIGHTS_METERS) * 2,
    'the guardian has to tower over the seals it guards');
  // Phase gains escalate and top out at exactly full strength.
  assert.deepEqual([...WARDEN_BRAZIER_BY_PHASE], [...WARDEN_BRAZIER_BY_PHASE].sort((a, b) => a - b));
  assert.equal(WARDEN_BRAZIER_BY_PHASE[WARDEN_BRAZIER_BY_PHASE.length - 1], 1);
  // Even the phase-3 brazier at rest stays under a lit lamp: cold never outshines won warmth.
  assert.ok(WARDEN_BRAZIER_REST * WARDEN_BRAZIER_BY_PHASE[2] < GATE_LAMP_LIT_STRENGTH);
  // And the brazier at rest outshines a cracked seal only at full phase -- the centre of the
  // wrongness is the boss, but only once the fight says so.
  assert.ok(WARDEN_BRAZIER_REST * WARDEN_BRAZIER_BY_PHASE[2] >= SEAL_GLOW_CRACKED);
});
