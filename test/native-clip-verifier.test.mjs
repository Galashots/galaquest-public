// Iron rule 9 / phase C1-R: an animation GLB that arrives for a character must be proven native to
// that character's rest skeleton before it is merged, and "it came back from Meshy for this model"
// is a claim rather than a fact.
//
// The defect these guard against is the one C1 measured: Keeper v1 and v2 share all 24 joint names,
// the same parent hierarchy AND the same joint order, and are still different skeletons. Every
// name-based check in the repo passed them as compatible right up to the point where the character
// was rendered with 45% longer forearms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { existsSync } from 'node:fs';
import { rigOf, rigDifferences, rigComparison, verdict, ORDER } from '../tools/foundry/verify_native_clip.mjs';

function readGlbJson(path) {
  const bytes = readFileSync(path);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    if (bytes.readUInt32LE(offset + 4) === 0x4e4f534a) {
      return JSON.parse(bytes.subarray(offset + 8, offset + 8 + length).toString('utf8'));
    }
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  throw new Error(`${path}: no JSON chunk`);
}

const KEEPER = 'public/assets/world/keeper.glb';
const HERO = 'public/assets/hero/hero_lod1_ironwood_atlas.glb';

test('a character is native to itself -- zero differences', () => {
  const rig = rigOf(readGlbJson(KEEPER));
  assert.deepEqual(rigDifferences(rig, rig), []);
});

test('two different characters are not native to each other, even sharing every joint name', () => {
  const keeper = rigOf(readGlbJson(KEEPER));
  const hero = rigOf(readGlbJson(HERO));
  // The premise worth pinning: the names really are identical, so a name-based check cannot help.
  assert.deepEqual(
    keeper.map((j) => j.name).sort(),
    hero.map((j) => j.name).sort(),
    'these two rigs are expected to share a joint name set -- that is the whole trap',
  );
  const problems = rigDifferences(keeper, hero);
  assert.ok(problems.length > 0, 'expected the rest poses to differ');
  assert.ok(
    problems.some((p) => p.includes('rest bone')),
    `expected a bone-length difference among: ${problems.slice(0, 3).join(' | ')}`,
  );
});

test('a single joint moved by more than the tolerance is caught', () => {
  const rig = rigOf(readGlbJson(KEEPER));
  const tampered = rig.map((j) => ({ ...j, translation: [...j.translation] }));
  const victim = tampered.find((j) => j.name === 'LeftForeArm');
  victim.translation = victim.translation.map((v) => v * 1.05); // 5% longer forearm
  const problems = rigDifferences(rig, tampered);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^LeftForeArm: rest bone/);
});

test('a reordered joint list is caught even when every name and rest pose matches', () => {
  const rig = rigOf(readGlbJson(KEEPER));
  const swapped = [...rig];
  [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
  const problems = rigDifferences(rig, swapped);
  assert.ok(
    problems.some((p) => p.includes('joint order differs')),
    `expected an order complaint among: ${problems.join(' | ')}`,
  );
});

test('a missing joint is reported as missing rather than as a rest-pose difference', () => {
  const rig = rigOf(readGlbJson(KEEPER));
  const short = rig.filter((j) => j.name !== 'RightHand');
  const problems = rigDifferences(rig, short);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /joints missing from the clip: RightHand/);
});

test('sabotage: rigDifferences does not simply always return a complaint', () => {
  // Without this, every assertion above passes just as well against a function that returns a
  // non-empty array unconditionally.
  const rig = rigOf(readGlbJson(HERO));
  const copy = rig.map((j) => ({ ...j, translation: [...j.translation], rotation: [...j.rotation] }));
  assert.deepEqual(rigDifferences(rig, copy), []);
});

// ---------------------------------------------------------------------------------------------
// Donor mode (the owner's ruling, AP1 visual closeout)
// ---------------------------------------------------------------------------------------------
//
// Two different questions, and conflating them cost AP1 a blocked phase:
//
//   strict -- did this file come off the very same rig?      A reorder is evidence of a re-rig.
//   donor  -- can its animation be lifted onto that body?    A reorder is noise.
//
// Donor mode forgives joint ORDER and nothing else, because three.js binds tracks by node NAME and
// merge_clips.mjs remaps channels by node name into the pristine target, so a donor's own skin
// ordering never reaches the shipped asset. Blender's glTF exporter permutes that array on a no-op
// round trip while leaving the rest skeleton intact to 0.003% -- measured on Keeper v2.
//
// The load-bearing claim these tests exist to defend is the NEGATIVE one: donor mode must not let
// through a single thing that re-proportions a character. The four below are the ruling's four.

/** Same rig, joints shuffled, everything else identical -- what a Blender round trip produces. */
function reorderedCopy(rig) {
  const copy = rig.map((j) => ({ ...j, translation: [...j.translation], rotation: [...j.rotation] }));
  // Move the neck/head run ahead of the right arm, which is the exact permutation Blender emitted
  // on Keeper v2 (body: ...LeftHand, RightShoulder... / export: ...LeftHand, neck, Head...).
  const headRun = copy.filter((j) => ['neck', 'Head', 'head_end', 'headfront'].includes(j.name));
  const rest = copy.filter((j) => !headRun.includes(j));
  const cut = rest.findIndex((j) => j.name === 'RightShoulder');
  return cut === -1 ? [...headRun, ...rest] : [...rest.slice(0, cut), ...headRun, ...rest.slice(cut)];
}

test('donor: an order-only permutation PASSES donor compatibility but FAILS strict identity', () => {
  const rig = rigOf(readGlbJson(KEEPER));
  const shuffled = reorderedCopy(rig);

  // Guard the premise: this really is order-only, or the test proves nothing about order.
  assert.deepEqual(
    shuffled.map((j) => j.name).sort(), rig.map((j) => j.name).sort(),
    'the permutation must not add or drop a joint',
  );
  assert.notDeepEqual(
    shuffled.map((j) => j.name), rig.map((j) => j.name),
    'the permutation must actually reorder something',
  );

  const problems = rigComparison(rig, shuffled);
  assert.deepEqual(
    problems.map((p) => p.kind), [ORDER],
    `expected exactly one order difference, got: ${problems.map((p) => p.message).join(' | ')}`,
  );

  const strict = verdict(problems, 'strict');
  const donor = verdict(problems, 'donor');
  assert.equal(strict.ok, false, 'strict identity must still reject a reordered joint array');
  assert.equal(donor.ok, true, 'donor compatibility must accept an order-only difference');
  assert.equal(donor.warnings.length, 1, 'and must say so rather than staying silent about it');
});

test('donor: two different skeletons sharing every joint name still FAIL donor compatibility', () => {
  // The Keeper v1 -> v2 graft is the defect this whole tool exists to stop, and v2 lives only in
  // gitignored tmp/. The hero and Keeper v1 are the same trap with both files in the repo: identical
  // 24 joint names, genuinely different rest skeletons. Donor mode must not rescue it.
  const keeper = rigOf(readGlbJson(KEEPER));
  const hero = rigOf(readGlbJson(HERO));
  assert.deepEqual(
    keeper.map((j) => j.name).sort(), hero.map((j) => j.name).sort(),
    'these two rigs are expected to share a joint name set -- that is the whole trap',
  );

  const problems = rigComparison(keeper, hero);
  const donor = verdict(problems, 'donor');
  assert.equal(donor.ok, false, 'donor mode must still reject two genuinely different skeletons');
  assert.ok(
    donor.failures.some((p) => p.message.includes('rest bone')),
    `the failure must be a rest-pose one, not merely an ordering one: `
    + `${donor.failures.slice(0, 3).map((p) => p.message).join(' | ')}`,
  );
});

test('donor: the shipped Keeper is native to the v2 body, not the old v1 trap', { skip: !existsSync('tmp/ap1/keeper-v2-body.glb') && 'tmp/ap1/keeper-v2-body.glb not present (gitignored; rebuild it from the Meshy zip to run this)' }, () => {
  // AP2-A shipped the v2-bodied Keeper (Idle_11 + talk + corrected material) at KEEPER's own path,
  // so this flips from pinning the v1 defect to pinning the fix -- same convention
  // test/swing-arbitration.test.mjs already established for a fix landing under a prior pin. The
  // synthetic stand-in test above still proves the v1<->v2 trap is real and caught in general; this
  // one proves the specific file the game now ships is on the right side of it.
  const shipped = rigOf(readGlbJson(KEEPER));
  const v2 = rigOf(readGlbJson('tmp/ap1/keeper-v2-body.glb'));
  const donor = verdict(rigComparison(shipped, v2), 'donor');
  assert.equal(donor.ok, true, 'the shipped Keeper must be donor-compatible with the v2 body it now is');
});

test('donor: a parent mismatch still FAILS in both modes', () => {
  const rig = rigOf(readGlbJson(KEEPER));
  const tampered = rig.map((j) => ({ ...j, translation: [...j.translation], rotation: [...j.rotation] }));
  // Re-parent the left hand onto the spine: a hierarchy change, not a reordering.
  tampered.find((j) => j.name === 'LeftHand').parent = 'Spine02';

  for (const mode of ['strict', 'donor']) {
    const result = verdict(rigComparison(rig, tampered), mode);
    assert.equal(result.ok, false, `${mode} mode must reject a changed parent`);
    assert.ok(
      result.failures.some((p) => /LeftHand: parent is/.test(p.message)),
      `${mode} mode must name the re-parented joint`,
    );
  }
});

test('donor: a rest-pose mismatch still FAILS in both modes', () => {
  const rig = rigOf(readGlbJson(KEEPER));

  const longer = rig.map((j) => ({ ...j, translation: [...j.translation], rotation: [...j.rotation] }));
  const bone = longer.find((j) => j.name === 'LeftForeArm');
  bone.translation = bone.translation.map((v) => v * 1.05); // 5% longer forearm

  const rotated = rig.map((j) => ({ ...j, translation: [...j.translation], rotation: [...j.rotation] }));
  rotated.find((j) => j.name === 'RightArm').rotation = [0.2588, 0, 0, 0.9659]; // 30 degrees

  for (const mode of ['strict', 'donor']) {
    const lengthResult = verdict(rigComparison(rig, longer), mode);
    assert.equal(lengthResult.ok, false, `${mode} mode must reject a longer rest bone`);
    assert.ok(lengthResult.failures.some((p) => /LeftForeArm: rest bone/.test(p.message)));

    const rotationResult = verdict(rigComparison(rig, rotated), mode);
    assert.equal(rotationResult.ok, false, `${mode} mode must reject a changed rest rotation`);
    assert.ok(rotationResult.failures.some((p) => /RightArm: rest rotation differs/.test(p.message)));
  }
});

test('donor: missing and extra joints still FAIL in both modes', () => {
  // Not in the ruling's list, but it is the cheapest way for a future edit to widen donor mode too
  // far -- "the names nearly match" is exactly the reasoning this tool exists to refuse.
  const rig = rigOf(readGlbJson(KEEPER));
  const short = rig.filter((j) => j.name !== 'RightHand');
  for (const mode of ['strict', 'donor']) {
    assert.equal(verdict(rigComparison(rig, short), mode).ok, false, `${mode} must reject a missing joint`);
    assert.equal(verdict(rigComparison(short, rig), mode).ok, false, `${mode} must reject an extra joint`);
  }
});

test('sabotage: donor mode is not simply "always ok", and strict is not simply "always ok" either', () => {
  // The control for the whole block above. Without it, a verdict() that returned {ok:true} for donor
  // would satisfy every positive assertion, and one that ignored mode entirely would satisfy several.
  const rig = rigOf(readGlbJson(KEEPER));
  const identical = rig.map((j) => ({ ...j, translation: [...j.translation], rotation: [...j.rotation] }));

  assert.equal(verdict(rigComparison(rig, identical), 'donor').ok, true, 'an identical rig must pass donor');
  assert.equal(verdict(rigComparison(rig, identical), 'strict').ok, true, 'and must pass strict too');
  assert.equal(verdict(rigComparison(rig, rigOf(readGlbJson(HERO))), 'donor').ok, false,
    'but a different skeleton must not pass donor');
  assert.throws(() => verdict([], 'lenient'), /unknown mode/, 'an unknown mode must throw, not default to permissive');
});
