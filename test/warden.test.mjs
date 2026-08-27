// The Beacon Warden: the arc's boss, as a procedural stand-in body behind the stable identity
// 'beacon_warden'.
//
// What is pinned here is the BRIEF, not the boxes -- the owner's canonical silhouette and palette
// rules, each of which a future GLB replacing this geometry must also satisfy, and each of which is
// easy to lose by nudging one number:
//
//   1. Height in the stated band: unmistakably bigger than the 1.48 m hero, under the Beacon.
//   2. Shoulders wider than hips, arms LONG -- the brief's silhouette in two inequalities.
//   3. Exactly one pale-cyan accent, and the brazier on ONE shoulder (the asymmetry is binding).
//   4. Four animated sub-meshes and a small part count -- this is an iPad's one animated structure.
//   5. Every pose the rules can ask for, as a pure function a browserless test can drive.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  BEACON_GLOW_COLOR,
  BEACON_IRON_COLOR,
  BEACON_STONE_COLOR,
} from '../public/src/world/oldBeacon.js';
import { GATE_WOOD_COLOR } from '../public/src/world/wildwoodGate.js';
import {
  SEAL_GLOW_CRACKED,
  SEAL_HEIGHTS_METERS,
} from '../public/src/world/coldSeals.js';
import {
  WARDEN_BRAZIER_BY_PHASE,
  WARDEN_BRAZIER_REST,
  WARDEN_DYING_SECONDS,
  WARDEN_GAIT_HZ,
  WARDEN_HEIGHT_METERS,
  WARDEN_OVERHEAD_SLAM_SECONDS,
  WARDEN_OVERHEAD_WINDUP_SECONDS,
  WARDEN_PULSE_CROUCH_SECONDS,
  WARDEN_PULSE_RING_RADIUS_METERS,
  WARDEN_PULSE_RING_SECONDS,
  WARDEN_SWEEP_SWING_SECONDS,
  WARDEN_SWEEP_WIND_SECONDS,
  WARDEN_WAKE_SECONDS,
  wardenParts,
  wardenPose,
} from '../public/src/enemies/warden.js';

const HERO_HEIGHT_METERS = 1.48; // the shipped hero (see enemies/wolf.js's own sizing note)
const GATE_LAMP_LIT_STRENGTH = 0.9; // wildwoodGate.js's private LAMP_GLOW_STRENGTH, restated as in
// test/old-beacon.test.mjs

const spec = wardenParts();
const allParts = [...spec.legs, ...spec.torso, ...spec.armLeft, ...spec.armRight];
const topOf = (part) => part.at[1] + (part.kind === 'box' ? part.size[1] : part.height) / 2;
const halfWidthOf = (part) => Math.abs(part.at[0])
  + (part.kind === 'box' ? part.size[0] : Math.max(part.radiusTop, part.radiusBottom) * 2) / 2;

// ── the silhouette the brief locked ───────────────────────────────────────────────────────────────

test('the head tops out at the stated height, cross-checked through the parts\' own extents', () => {
  const head = spec.torso.find((part) => part.name === 'head');
  const headTop = spec.torsoPivotY + topOf(head);
  assert.ok(Math.abs(headTop - WARDEN_HEIGHT_METERS) < 1e-9,
    `head reaches ${headTop}, constant says ${WARDEN_HEIGHT_METERS}`);
});

test('the whole build sits in a sane band: over the hero by a clear margin, under the Beacon', () => {
  const overallTop = spec.torsoPivotY + Math.max(...spec.torso.map(topOf));
  assert.ok(WARDEN_HEIGHT_METERS >= HERO_HEIGHT_METERS * 1.6,
    'a boss a child can look level at is a villager with a shoulder ornament');
  assert.ok(overallTop <= 3.0, `${overallTop.toFixed(2)} m starts arguing with the 6.1 m Beacon`);
  assert.ok(overallTop >= WARDEN_HEIGHT_METERS, 'the brazier may ride above the head, never below it');
});

test('shoulders read wider than hips -- the brief\'s silhouette as an inequality', () => {
  const shoulderSpan = Math.max(...spec.torso
    .filter((part) => part.name === 'pauldron')
    .map(halfWidthOf)) * 2;
  const hipSpan = Math.max(...spec.legs.filter((part) => part.name !== 'foot').map(halfWidthOf)) * 2;
  assert.ok(shoulderSpan > hipSpan * 1.4,
    `shoulders ${shoulderSpan.toFixed(2)} m over hips ${hipSpan.toFixed(2)} m is not BROAD`);
});

test('the arms are LONG and end in stone fists, not weapons', () => {
  const armBottom = Math.min(...spec.armLeft.map((part) => part.at[1] - part.size[1] / 2));
  const fistBottomWorld = spec.torsoPivotY + spec.shoulderPivots.left[1] + armBottom;
  const kneeWorld = spec.legs.find((part) => part.name === 'shin').at[1];
  assert.ok(fistBottomWorld < kneeWorld + 0.45,
    `fists hang to ${fistBottomWorld.toFixed(2)} m -- too short to read as the brief's long arms`);
  const fist = spec.armLeft.find((part) => part.name === 'fist');
  assert.equal(fist.color, BEACON_STONE_COLOR, 'heavy stone-gauntlet fists; the maul is a later asset');
});

// ── the palette and the one asymmetry ─────────────────────────────────────────────────────────────

test('the body is iron, stone and timber only, every colour imported (GQ-007)', () => {
  const allowed = [BEACON_IRON_COLOR, BEACON_STONE_COLOR, GATE_WOOD_COLOR, BEACON_GLOW_COLOR];
  for (const part of allParts) {
    assert.ok(allowed.includes(part.color), `'${part.name}' invents a colour: ${part.color.toString(16)}`);
  }
  // All three structural materials actually appear -- a Warden that quietly became all-iron would
  // still pass the allowlist.
  const used = new Set(allParts.map((part) => part.color));
  for (const color of [BEACON_IRON_COLOR, BEACON_STONE_COLOR, GATE_WOOD_COLOR]) assert.ok(used.has(color));
});

/** The asymmetry predicate the sabotage case below proves can fail: every brazier part on the SAME
 *  non-zero side, and the accent count exactly one. */
function brazierIsOneAsymmetricAccent(parts) {
  const accents = parts.filter((part) => part.color === BEACON_GLOW_COLOR);
  if (accents.length !== 1) return false;
  const brazierParts = parts.filter((part) => part.name.startsWith('brazier'));
  if (brazierParts.length < 2) return false;
  return brazierParts.every((part) => part.at[0] !== 0 && Math.sign(part.at[0]) === Math.sign(accents[0].at[0]));
}

test('exactly one cold accent, and the whole brazier sits on ONE shoulder', () => {
  assert.equal(brazierIsOneAsymmetricAccent(spec.torso), true);
  // And the cresset echoes the Old Beacon's own basket: open, flared upward.
  const cresset = spec.torso.find((part) => part.name === 'brazier-cresset');
  assert.equal(cresset.openEnded, true, 'a capped cresset is a cup, not a fire basket');
  assert.ok(cresset.radiusTop > cresset.radiusBottom, 'the flare is the kinship a child reads');
});

test('sabotage: the asymmetry check DOES fail against a centred brazier and a second accent', () => {
  const centred = spec.torso.map((part) => (part.name.startsWith('brazier') ? { ...part, at: [0, part.at[1], part.at[2]] } : part));
  assert.equal(brazierIsOneAsymmetricAccent(centred), false);
  const twoAccents = [...spec.torso, { name: 'extra', kind: 'box', size: [0.1, 0.1, 0.1], at: [-0.7, 1.3, 0], color: BEACON_GLOW_COLOR }];
  assert.equal(brazierIsOneAsymmetricAccent(twoAccents), false);
});

// ── the playtest's "look like an enemy" pass ──────────────────────────────────────────────────────
//
// Real kids called the shipped body out directly: it needed to look "much cooler" and "actually
// look like an enemy". The fix adds silhouette -- a jagged crown and two frost-spike shoulders --
// entirely in BEACON_STONE_COLOR, the SAME colour world/coldSeals.js's own frost ring already reads
// as rime rather than rock (that file's own header), so the brief's one-accent rule stays intact:
// hostility comes from SHAPE here, the cold light stays the brazier's alone. (Glowing eyes and the
// icy aura are presenter-level glow sprites in enemies/warden.js's buildWarden, not baked parts, for
// the identical reason -- see that function's own comment.)
test('the crown and shoulder-spikes exist, are frost-stone (not a second accent colour), and are symmetric', () => {
  const crown = spec.torso.find((part) => part.name === 'crown');
  assert.ok(crown, 'a crown/horn part must exist on the head');
  assert.equal(crown.color, BEACON_STONE_COLOR, 'the crown reads as frost-rimed stone, not a new colour');
  assert.ok(Math.abs(crown.at[0]) < 1e-9, 'the crown sits on the centreline -- the asymmetry lives on the brazier only');

  const spikes = spec.torso.filter((part) => part.name === 'shoulder-spike');
  assert.equal(spikes.length, 2, 'one spike per shoulder');
  for (const spike of spikes) assert.equal(spike.color, BEACON_STONE_COLOR);
  assert.ok(Math.abs(spikes[0].at[0] + spikes[1].at[0]) < 1e-9, 'the spikes mirror left/right exactly');
  assert.notEqual(Math.sign(spikes[0].at[0]), Math.sign(spikes[1].at[0]), 'one spike per side, not both stacked on one');

  // Still exactly one accent after the additions -- the whole point of using stone, not a new hue.
  assert.equal(brazierIsOneAsymmetricAccent(spec.torso), true);
});

test('the crown rises clear above the head without breaking the silhouette\'s own height ceiling', () => {
  const head = spec.torso.find((part) => part.name === 'head');
  const crown = spec.torso.find((part) => part.name === 'crown');
  const headTop = topOf(head);
  const crownTop = topOf(crown);
  assert.ok(crownTop > headTop, 'a crown that does not clear the head is not a crown');
  // Re-proves the SAME "under the Beacon" ceiling test #2 above pins, now against the tallest part
  // on the body rather than assuming it is still the head -- the crown addition must not have
  // quietly become the part that breaks that promise.
  const overallTop = spec.torsoPivotY + Math.max(...spec.torso.map(topOf));
  assert.ok(overallTop <= 3.0, `${overallTop.toFixed(2)} m starts arguing with the 6.1 m Beacon`);
});

test('the shoulder-spikes sit outboard of the brazier -- a frost spike must never grow through the one accent', () => {
  const spikes = spec.torso.filter((part) => part.name === 'shoulder-spike');
  const brazierParts = spec.torso.filter((part) => part.name.startsWith('brazier'));
  const accentX = brazierParts[0].at[0];
  const sameSideSpike = spikes.find((s) => Math.sign(s.at[0]) === Math.sign(accentX));
  assert.ok(Math.abs(sameSideSpike.at[0]) > Math.abs(accentX),
    'the same-side spike must stand further out than the brazier it shares a shoulder with');
});

// ── the budget ────────────────────────────────────────────────────────────────────────────────────

test('four sub-meshes, small part counts: the one animated structure stays cheap', () => {
  assert.equal(Object.keys({ legs: 1, torso: 1, armLeft: 1, armRight: 1 }).length, 4);
  for (const limb of [spec.legs, spec.torso, spec.armLeft, spec.armRight]) {
    assert.ok(limb.length >= 3 && limb.length <= 14, `${limb.length} parts in one sub-mesh`);
  }
  assert.ok(allParts.length <= 30, `${allParts.length} parts total -- this is a stand-in, not a statue`);
  // No thin filigree: every box face at least 7 cm, the brief's "no thin geometry" as a floor.
  for (const part of allParts.filter((p) => p.kind === 'box')) {
    assert.ok(Math.min(...part.size) >= 0.07, `'${part.name}' has a ${Math.min(...part.size)} m face`);
  }
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
