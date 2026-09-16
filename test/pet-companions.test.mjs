import test from 'node:test';
import assert from 'node:assert/strict';

import { WORM_PETS, PET_CAMP_DESTINATION, PET_INTERACTION_RADIUS, petDef } from '../public/src/progression/pets.js';
import {
  foldFacts,
  foldPetFacts,
  isProfileFact,
  isClientRestorableProfileFact,
} from '../public/src/progression/facts.js';
import { evaluatePetAction } from '../net/petCompanions.mjs';

const OWNER = 'guest-aaaaaaaa'; // passes sanitizeGuestId (8..64, [A-Za-z0-9-])
const OTHER = 'guest-bbbbbbbb';
const GREEN = 'worm_green';
const RED = 'worm_red';

const at = (pet) => ({ x: pet.campX, z: pet.campZ });

function ownedFact(petId, owner = OWNER) {
  return { eventId: `pet-owned:${owner}:${petId}`, type: 'pet-owned', value: petId };
}
function equipFact(petId, rev, tag, owner = OWNER, value = petId) {
  return { eventId: `pet-equip:${owner}:${tag}`, type: 'pet-equipped', value, rev };
}

function followArgs(petId, rev, tag, extra = {}) {
  const pet = petDef(petId);
  return {
    profileId: OWNER,
    action: 'follow',
    petId,
    destinationId: PET_CAMP_DESTINATION,
    ...at(pet),
    eventId: tag,
    rev,
    ...extra,
  };
}

test('catalogue exposes exactly the two worm pets', () => {
  assert.equal(WORM_PETS.length, 2);
  assert.deepEqual([...WORM_PETS].map((p) => p.id).sort(), [GREEN, RED].sort());
  assert.deepEqual([...WORM_PETS].map((p) => p.id), [GREEN, RED]);
});

test('catalogue entries are frozen and carry no combat stats', () => {
  for (const pet of WORM_PETS) {
    assert.ok(Object.isFrozen(pet), `${pet.id} must be frozen`);
    assert.deepEqual(Object.keys(pet).sort(), ['campX', 'campZ', 'displayName', 'id']);
    for (const forbidden of ['power', 'hp', 'damage', 'attack', 'defense', 'stats']) {
      assert.equal(pet[forbidden], undefined, `${pet.id} must not expose ${forbidden}`);
    }
  }
  assert.ok(Object.isFrozen(WORM_PETS));
});

test('petDef resolves catalogue ids and rejects unknown ones', () => {
  assert.equal(petDef(GREEN).id, GREEN);
  assert.equal(petDef('worm_purple'), undefined);
  assert.equal(petDef(undefined), undefined);
});

test('camp destination and radius are the authored constants', () => {
  assert.equal(PET_CAMP_DESTINATION, 'home-hub');
  assert.equal(PET_INTERACTION_RADIUS, 3);
});

test('befriending the first pet owns it and auto-follows it', () => {
  const res = evaluatePetAction({
    profileId: OWNER, action: 'befriend', petId: GREEN,
    destinationId: PET_CAMP_DESTINATION, ...at(petDef(GREEN)), eventId: 'evt-1', rev: 1,
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.state.ownedPetIds, [GREEN]);
  assert.equal(res.state.equippedPetId, GREEN);
  assert.equal(res.state.equipRev, 1);
});

test('befriending a second pet does not replace the current follower', () => {
  const first = evaluatePetAction({
    profileId: OWNER, action: 'befriend', petId: GREEN,
    destinationId: PET_CAMP_DESTINATION, ...at(petDef(GREEN)), eventId: 'evt-1', rev: 1,
  });
  const second = evaluatePetAction({
    profileId: OWNER, action: 'befriend', petId: RED,
    destinationId: PET_CAMP_DESTINATION, ...at(petDef(RED)), eventId: 'evt-2', rev: 2,
    facts: first.facts,
  });
  assert.equal(second.ok, true);
  assert.deepEqual(second.state.ownedPetIds, [GREEN, RED].sort());
  assert.equal(second.state.equippedPetId, GREEN);
  assert.equal(second.state.equipRev, 1);
});

test('rest stops following, then an explicit follow switches pets', () => {
  const green = ownedFact(GREEN);
  const rest = evaluatePetAction({
    profileId: OWNER, action: 'rest', petId: GREEN,
    destinationId: PET_CAMP_DESTINATION, ...at(petDef(GREEN)), eventId: 'evt-rest', rev: 2,
    facts: [green, equipFact(GREEN, 1, 'start')],
  });
  assert.equal(rest.ok, true);
  assert.equal(rest.state.equippedPetId, null);

  const red = ownedFact(RED);
  const follow = evaluatePetAction({
    profileId: OWNER, action: 'follow', petId: RED,
    destinationId: PET_CAMP_DESTINATION, ...at(petDef(RED)), eventId: 'evt-follow', rev: 3,
    facts: [green, red, equipFact(GREEN, 1, 'start'), ...rest.facts],
  });
  assert.equal(follow.ok, true);
  assert.equal(follow.state.equippedPetId, RED);
  assert.equal(follow.state.equipRev, 3);
});

test('rest refuses when the pet is not the current follower', () => {
  const res = evaluatePetAction({
    profileId: OWNER, action: 'rest', petId: GREEN,
    destinationId: PET_CAMP_DESTINATION, ...at(petDef(GREEN)), eventId: 'evt-rest', rev: 5,
    facts: [ownedFact(GREEN), ownedFact(RED), equipFact(RED, 4, 'r')],
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'not-following');
});

test('re-befriending an already-owned pet does not mint a second gift', () => {
  const first = evaluatePetAction({
    profileId: OWNER, action: 'befriend', petId: GREEN,
    destinationId: PET_CAMP_DESTINATION, ...at(petDef(GREEN)), eventId: 'evt-1', rev: 1,
  });
  const again = evaluatePetAction({
    profileId: OWNER, action: 'befriend', petId: GREEN,
    destinationId: PET_CAMP_DESTINATION, ...at(petDef(GREEN)), eventId: 'evt-2', rev: 2,
    facts: first.facts,
  });
  assert.equal(again.ok, true);
  assert.deepEqual(again.facts, []);
  assert.equal(again.state.equippedPetId, GREEN);
});

test('pet-owned and pet-equipped facts validate only with a real pet and legal shape', () => {
  assert.equal(isProfileFact(ownedFact(GREEN)), true);
  assert.equal(isProfileFact(equipFact(GREEN, 1, 'a')), true);
  assert.equal(isProfileFact(equipFact(GREEN, 1, 'a', OWNER, 'none')), true);

  assert.equal(isProfileFact({ ...ownedFact(GREEN), value: 'worm_purple' }), false);
  assert.equal(isProfileFact({ ...ownedFact(GREEN), eventId: `pet-owned:${OWNER}:` }), false);
  assert.equal(isProfileFact({ ...ownedFact(GREEN), eventId: `pet-owned:${OWNER}:${GREEN}:x` }), false);
  assert.equal(isProfileFact({ ...ownedFact(GREEN), eventId: `pet-owned:not an id:${GREEN}` }), false);
  assert.equal(isProfileFact({ ...equipFact(GREEN, 1, 'a'), value: 'worm_purple' }), false);
  assert.equal(isProfileFact({ ...equipFact(GREEN, 1, 'a'), rev: 1.5 }), false);
  assert.equal(isProfileFact({ ...equipFact(GREEN, 1, 'a'), rev: -1 }), false);
  assert.equal(isProfileFact({ ...equipFact(GREEN, 1, 'a'), rev: undefined }), false);
  assert.equal(isProfileFact({ ...equipFact(GREEN, 1, 'a:'), }), false);
});

test('only pet-equip admits the literal "none" and requires an integer non-negative rev', () => {
  const noneEquip = equipFact(GREEN, 0, 'rest', OWNER, 'none');
  assert.equal(isProfileFact(noneEquip), true);
  assert.equal(isProfileFact({ ...noneEquip, rev: '0' }), false);
  assert.equal(isProfileFact({ ...ownedFact('none') }), false);
});

test('deterministic equip tie breaks on eventId, independent of input order', () => {
  const a = equipFact(RED, 7, 'aaa');
  const b = equipFact(GREEN, 7, 'zzz');
  const owned = [ownedFact(GREEN), ownedFact(RED)];
  const forward = foldPetFacts([...owned, a, b]);
  const reversed = foldPetFacts([...owned, b, a]);
  assert.equal(forward.equipRev, 7);
  assert.equal(forward.equippedPetId, GREEN);
  assert.deepEqual(forward, reversed);
});

test('a later rev wins regardless of the sequence the facts arrive in', () => {
  const older = equipFact(GREEN, 4, 'old');
  const newer = equipFact(RED, 9, 'new');
  const owned = [ownedFact(GREEN), ownedFact(RED)];
  assert.equal(foldPetFacts([...owned, older, newer]).equippedPetId, RED);
  assert.equal(foldPetFacts([...owned, newer, older]).equippedPetId, RED);
});

test('equipping a pet the profile does not own folds to no follower', () => {
  const res = foldPetFacts([equipFact(RED, 3, 'only')]);
  assert.deepEqual(res.ownedPetIds, []);
  assert.equal(res.equippedPetId, null);
  assert.equal(res.equipRev, 3);
});

test('a sibling may not reserve a pet row minted under another profile id', () => {
  assert.equal(isClientRestorableProfileFact(ownedFact(GREEN, OTHER), OWNER), false);
  assert.equal(isClientRestorableProfileFact(equipFact(GREEN, 1, 'a', OTHER), OWNER), false);
});

test('the rightful profile may restore its own pet rows', () => {
  assert.equal(isClientRestorableProfileFact(ownedFact(GREEN, OWNER), OWNER), true);
  assert.equal(isClientRestorableProfileFact(equipFact(GREEN, 1, 'a', OWNER), OWNER), true);
});

test('a befriend whose stale-revision check fails persists no partial ownership', () => {
  const res = evaluatePetAction({
    profileId: OWNER, action: 'befriend', petId: GREEN,
    destinationId: PET_CAMP_DESTINATION, ...at(petDef(GREEN)), eventId: 'evt-1', rev: 1,
    facts: [ownedFact(RED), equipFact(RED, 5, 'r', OWNER, 'none')],
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'stale-revision');
  assert.deepEqual(res.facts, []);
  assert.equal(res.state.ownedPetIds.includes(GREEN), false);
});

test('the same event id with a different payload is rejected as a conflict', () => {
  const res = evaluatePetAction({
    profileId: OWNER, action: 'follow', petId: GREEN,
    destinationId: PET_CAMP_DESTINATION, ...at(petDef(GREEN)), eventId: 'evt-1', rev: 2,
    facts: [ownedFact(GREEN), equipFact(GREEN, 1, 'evt-1', OWNER, RED)],
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'event-conflict');
});

test('an exact duplicate message is idempotent and adds nothing', () => {
  const res = evaluatePetAction({
    profileId: OWNER, action: 'follow', petId: GREEN,
    destinationId: PET_CAMP_DESTINATION, ...at(petDef(GREEN)), eventId: 'evt-1', rev: 2,
    facts: [ownedFact(GREEN), equipFact(GREEN, 2, 'evt-1')],
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.facts, []);
});

test('a replayed older choice cannot undo a newer follow', () => {
  const res = evaluatePetAction({
    profileId: OWNER, action: 'follow', petId: GREEN,
    destinationId: PET_CAMP_DESTINATION, ...at(petDef(GREEN)), eventId: 'evt-old', rev: 2,
    facts: [ownedFact(GREEN), equipFact(GREEN, 8, 'evt-new')],
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'stale-revision');
  assert.equal(res.state.equippedPetId, GREEN);
  assert.equal(res.state.equipRev, 8);
});

test('unknown pets, malformed profiles, invalid actions and non-array facts are refused', () => {
  const base = {
    profileId: OWNER, action: 'follow', petId: GREEN,
    destinationId: PET_CAMP_DESTINATION, ...at(petDef(GREEN)), eventId: 'evt-1', rev: 1,
  };
  const unknown = evaluatePetAction({ ...base, petId: 'worm_purple' });
  assert.equal(unknown.error, 'unknown-pet');
  const badProfile = evaluatePetAction({ ...base, profileId: 'no' });
  assert.equal(badProfile.error, 'bad-profile');
  const badAction = evaluatePetAction({ ...base, action: 'fly' });
  assert.equal(badAction.error, 'bad-action');
  const badFacts = evaluatePetAction({ ...base, facts: {} });
  assert.equal(badFacts.error, 'bad-facts');
  const badEvent = evaluatePetAction({ ...base, eventId: 'has space' });
  assert.equal(badEvent.error, 'bad-event-id');
});

test('out-of-range coordinates and the wrong camp destination are refused', () => {
  const pet = petDef(GREEN);
  const beyond = PET_INTERACTION_RADIUS + 0.5;
  const outOfRange = evaluatePetAction({
    profileId: OWNER, action: 'follow', petId: GREEN,
    destinationId: PET_CAMP_DESTINATION, x: pet.campX + beyond, z: pet.campZ,
    eventId: 'evt-1', rev: 1, facts: [ownedFact(GREEN)],
  });
  assert.equal(outOfRange.error, 'out-of-range');
  const nan = evaluatePetAction({
    profileId: OWNER, action: 'follow', petId: GREEN,
    destinationId: PET_CAMP_DESTINATION, x: Number.NaN, z: pet.campZ,
    eventId: 'evt-1', rev: 1, facts: [ownedFact(GREEN)],
  });
  assert.equal(nan.error, 'out-of-range');
  const wrongDestination = evaluatePetAction({
    profileId: OWNER, action: 'follow', petId: GREEN,
    destinationId: 'the-woods', ...at(pet), eventId: 'evt-1', rev: 1, facts: [ownedFact(GREEN)],
  });
  assert.equal(wrongDestination.error, 'wrong-destination');
});

test('a non-owned follow returns not-owned and mints nothing', () => {
  const res = evaluatePetAction(followArgs(GREEN, 1, 'evt-1'));
  assert.equal(res.ok, false);
  assert.equal(res.error, 'not-owned');
  assert.deepEqual(res.facts, []);
});

test('the input fact array is never mutated by evaluation or folding', () => {
  const facts = [ownedFact(GREEN), equipFact(GREEN, 1, 'a')];
  const snapshot = JSON.parse(JSON.stringify(facts));
  evaluatePetAction({
    profileId: OWNER, action: 'follow', petId: GREEN,
    destinationId: PET_CAMP_DESTINATION, ...at(petDef(GREEN)), eventId: 'evt-1', rev: 2, facts,
  });
  foldPetFacts(facts);
  foldFacts(facts);
  assert.deepEqual(facts, snapshot);
});

test('folding pet facts leaves the gear and XP projection untouched', () => {
  const gearOwned = { eventId: 'own:x:sword', type: 'gear-owned', value: 'sword' };
  const xp = { eventId: 'xp-earned:1', type: 'xp-earned', value: '30' };
  const without = foldFacts([gearOwned, xp]);
  const withPets = foldFacts([gearOwned, xp, ownedFact(GREEN), equipFact(GREEN, 1, 'a')]);
  assert.deepEqual(withPets.ownedItemIds, without.ownedItemIds);
  assert.deepEqual(withPets.equippedItemIds, without.equippedItemIds);
  assert.equal(withPets.xp, without.xp);
});
