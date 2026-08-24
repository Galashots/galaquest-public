import assert from 'node:assert/strict';
import test from 'node:test';

import { RIGID_TIER2_GEAR } from '../public/src/character/gear.js';

/**
 * THE ACCEPTANCE RECORD. This file exists to make an Owner decision expensive to undo by accident.
 *
 * Every other test that touches gear transforms DERIVES its expectation from the constant under
 * test -- gear-attachment builds its expected matrix out of `item.restRelativeToHeroRoot`,
 * forge-runtime-bake round-trips the shipped value against itself. All of them are correct and none
 * of them can fail if the transform changes, because they would simply use the new number. That is
 * GQ-018 in as many words: a test that derives its probe input from the constant under test cannot
 * fail on that constant.
 *
 * So before this file, the Starter Sword carry the Owner rejected on a real iPhone, and the re-fit he
 * accepted, were mechanically indistinguishable. A revert, a bad merge, or a well-meaning re-solve
 * would have shipped silently past a fully green suite.
 *
 * These literals are therefore NOT a duplicated constant in the GQ-007 sense. They are the record of
 * a human decision, and their whole job is to disagree with gear.js when someone changes it.
 * test/shared-constants.test.mjs's fingerprint scan excludes this one file for exactly that reason.
 *
 * WHEN THIS TEST FAILS, the question is never "how do I make it pass". It is "did the Owner accept a
 * new fit?" If yes, update the record here in the same commit as gear.js and say whose decision it
 * was. If no, the change is the defect.
 */

/**
 * Starter Sword (Ironwood), RightHand.
 *
 * Rejected by the Owner 2026-08-24 on a real iPhone and in the Forge: the blade pointed straight out
 * along the arm, so the sword lay flat across the back of the hand with the guard behind the
 * knuckles. Not held -- balanced.
 *
 * Re-fitted in the Forge against the Owner-approved Dawnwarden carry as the visual reference, and
 * baked through forge/runtimeBake.js. Corroborated by two unrelated bake methods agreeing to
 * 0.00002 rig units, and by the blade tip finishing at y=0.3344 against this rig's knee at y=0.348.
 */
const ACCEPTED = Object.freeze({
  sword_ironwood: {
    boneName: 'RightHand',
    position: [-64.85592, 97.14747, 2.5895],
    quaternion: [-0.560465386086, 0.623437925195, 0.475258689008, -0.267082165168],
    scale: [47, 47, 47],
  },
});

for (const [id, accepted] of Object.entries(ACCEPTED)) {
  test(`${id} still carries the transform the Owner accepted`, () => {
    const item = RIGID_TIER2_GEAR.find((entry) => entry.id === id);
    assert.ok(item, `${id} is no longer in RIGID_TIER2_GEAR at all`);
    assert.equal(item.boneName, accepted.boneName, `${id} moved to a different bone`);

    const rest = item.restRelativeToHeroRoot;
    assert.deepEqual([...rest.position], accepted.position,
      `${id}'s POSITION is not the accepted fit. If the Owner accepted a new one, update this record`
      + ' in the same commit and name the decision. If not, this is the defect.');
    assert.deepEqual([...rest.quaternion], accepted.quaternion,
      `${id}'s ORIENTATION is not the accepted fit. The rejected carry differed here first --`
      + ' the blade lay across the back of the hand rather than being held.');
    assert.deepEqual([...rest.scale], accepted.scale,
      `${id}'s SCALE is not the accepted fit. The accepted change moved and turned the sword; it did`
      + ' not resize it.');
  });
}

test('the record covers something that actually ships', () => {
  // A record naming an item the game no longer mounts would pass forever while protecting nothing.
  for (const id of Object.keys(ACCEPTED)) {
    assert.ok(RIGID_TIER2_GEAR.some((entry) => entry.id === id),
      `${id} is recorded as an accepted fit but is not shipped gear`);
  }
});
