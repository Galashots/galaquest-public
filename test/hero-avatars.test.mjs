// The picture a child navigates by, and the one property that matters: it does not move.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  HERO_AVATARS,
  avatarById,
  avatarForProfile,
  chooseAvatarId,
  fallbackAvatarIdFor,
} from '../public/src/progression/heroAvatars.js';
import { MAX_PROFILES } from '../public/src/progression/profiles.js';

test('there are more animals than a device has slots', () => {
  // So a full tablet still gives every child a different one. If MAX_PROFILES ever grows past the
  // list, two siblings get the same animal and the whole point is lost -- which is why this asserts
  // against the real constant rather than against the number four.
  assert.ok(HERO_AVATARS.length > MAX_PROFILES,
    `${HERO_AVATARS.length} animals for ${MAX_PROFILES} slots leaves siblings sharing`);
});

test('every animal is distinct in id, glyph and colour', () => {
  for (const field of ['id', 'emoji', 'colour']) {
    const values = HERO_AVATARS.map((a) => a[field]);
    assert.equal(new Set(values).size, values.length, `two animals share a ${field}`);
  }
});

test('a new hero gets an animal nobody on this device has', () => {
  assert.equal(chooseAvatarId([]), HERO_AVATARS[0].id);
  assert.equal(chooseAvatarId([HERO_AVATARS[0].id]), HERO_AVATARS[1].id);
  assert.equal(chooseAvatarId([HERO_AVATARS[1].id]), HERO_AVATARS[0].id);
});

test('filling every slot still answers, rather than handing back undefined', () => {
  // Cannot happen at MAX_PROFILES 4 with six animals, but a caller writing `undefined` into a
  // profile is exactly how a card ends up blank, so it must not be possible to get one.
  const all = HERO_AVATARS.map((a) => a.id);
  assert.equal(typeof chooseAvatarId(all), 'string');
  assert.ok(avatarById(chooseAvatarId(all)));
});

test('THE PROPERTY: a stored animal never moves, whatever happens to the siblings', () => {
  // The reason this is stored rather than computed from what is free. If it were derived from the
  // set, deleting a brother's save would turn a child's fox into an owl -- and to that child, that
  // is their save being replaced by somebody else's.
  const robin = { id: 'p-robin', avatar: 'owl' };
  assert.equal(avatarForProfile(robin).id, 'owl');
  // ...and it is still an owl when they are the only hero left.
  assert.equal(avatarForProfile({ ...robin }).id, 'owl');
});

test('a profile written before animals existed still gets a stable one', () => {
  const legacy = { id: 'guest-abc-123' };
  const first = avatarForProfile(legacy).id;
  assert.ok(first, 'a card with no animal at all is the thing this must never do');
  for (let i = 0; i < 5; i += 1) {
    assert.equal(avatarForProfile({ id: 'guest-abc-123' }).id, first, 'the derived animal moved');
  }
});

test('an unknown stored animal falls back rather than leaving the card blank', () => {
  // A keyring written by a newer version, or edited by hand. The device should still open.
  const odd = avatarForProfile({ id: 'p-1', avatar: 'dinosaur' });
  assert.ok(odd && odd.emoji, JSON.stringify(odd));
});

test('the derived animal spreads across the set rather than piling on one', () => {
  // A hash that returned the same animal for everything would technically be stable and would make
  // every legacy card identical, which is the failure this is meant to prevent.
  const seen = new Set();
  for (let i = 0; i < 60; i += 1) seen.add(fallbackAvatarIdFor(`p-${i}-${i * 7}`));
  assert.ok(seen.size >= 4, `only ${seen.size} distinct animals across 60 ids`);
});

// ── the one that matters: a legacy child and a new sibling ─────────────────────────────────────

test('a migrated child and a new sibling never end up with the SAME animal', () => {
  // The defect this is written for, found by the Director by reading rather than running.
  //
  // A migrated legacy profile has `avatar: null` -- it predates the field -- and is DRAWN using the
  // id-derived fallback. createProfile chose against stored avatars only, `.filter(Boolean)`, so it
  // never saw the legacy child's effective Fox and handed Fox straight to the new sibling.
  //
  // Two children, one animal. For the non-reader this whole file exists for, that is not a cosmetic
  // clash: it is the only cue they have for telling their save from their brother's, and both cards
  // now say the same thing.
  //
  // `guest-00000004` is chosen because its derived animal IS the first one the allocator hands out,
  // so the collision is certain rather than probabilistic -- a test that reproduces a bug only
  // sometimes is not a test. It is also long enough to survive sanitizeGuestId, which rejected my
  // first, shorter pick and failed the test on its own premise rather than on the defect.
  const legacy = { id: 'guest-00000004', avatar: null };
  assert.equal(avatarForProfile(legacy).id, HERO_AVATARS[0].id,
    'premise: this legacy id must derive the animal the allocator would otherwise hand out first');

  // What the allocator must be given: EFFECTIVE animals, through the one shared law.
  const chosen = chooseAvatarId([avatarForProfile(legacy).id]);
  assert.notEqual(chosen, avatarForProfile(legacy).id,
    'the new sibling was handed the animal the migrated child is already showing');
});

test('and the whole tablet stays distinct as siblings are added onto a migrated child', () => {
  // Walked forward the way a family actually fills a device, each new hero choosing against what is
  // ALREADY ON SCREEN rather than against what happens to be written down.
  const profiles = [{ id: 'guest-00000004', avatar: null }];
  for (let i = 0; i < MAX_PROFILES - 1; i += 1) {
    profiles.push({ id: `p-new-${i}`, avatar: chooseAvatarId(profiles.map((p) => avatarForProfile(p).id)) });
  }
  const shown = profiles.map((p) => avatarForProfile(p).id);
  assert.equal(new Set(shown).size, shown.length, `two children share an animal: ${shown.join(', ')}`);
});
