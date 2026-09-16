import { WORM_PETS, petDef, PET_CAMP_DESTINATION, PET_INTERACTION_RADIUS } from '../public/src/progression/pets.js';
import { foldPetFacts, unionFacts, isClientRestorableProfileFact } from '../public/src/progression/facts.js';
import { sanitizeGuestId } from '../public/src/net/guestId.js';

export function campPetOffers(facts) {
  const state = foldPetFacts(facts);
  return WORM_PETS.map(pet => ({ ...pet, owned: state.ownedPetIds.includes(pet.id),
    equipped: state.equippedPetId === pet.id }));
}

// Validate first; the reward coordinator alone persists returned facts.
export function evaluatePetAction({ profileId, action, petId, destinationId, x, z,
  facts = [], eventId, rev } = {}) {
  const prior = Array.isArray(facts) ? unionFacts(facts).filter(f =>
    ['pet-owned', 'pet-equipped'].includes(f.type) && isClientRestorableProfileFact(f, profileId)) : [];
  const state = foldPetFacts(prior);
  const fail = error => ({ ok: false, error, facts: [], state });
  const done = (added = []) => ({ ok: true, error: null, facts: added, state: foldPetFacts([...prior, ...added]) });
  if (!profileId || sanitizeGuestId(profileId) !== profileId) return fail('bad-profile');
  if (!Array.isArray(facts)) return fail('bad-facts');
  if (!['befriend', 'follow', 'rest'].includes(action)) return fail('bad-action');
  const pet = petDef(petId);
  if (!pet) return fail('unknown-pet');
  if (destinationId !== PET_CAMP_DESTINATION) return fail('wrong-destination');
  if (!Number.isFinite(x) || !Number.isFinite(z)
    || Math.hypot(x - pet.campX, z - pet.campZ) > PET_INTERACTION_RADIUS) return fail('out-of-range');
  if (typeof eventId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(eventId)) return fail('bad-event-id');
  if (!Number.isSafeInteger(rev) || rev < 0) return fail('bad-revision');
  const choice = { eventId: `pet-equip:${profileId}:${eventId}`, type: 'pet-equipped',
    value: action === 'rest' ? 'none' : petId, rev };
  const existing = prior.find(f => f.eventId === choice.eventId);
  // A duplicated transport message is harmless; the same id with another payload is not a replay.
  if (existing) return existing.type === choice.type && existing.value === choice.value && existing.rev === rev
    ? done() : fail('event-conflict');
  const owned = state.ownedPetIds.includes(petId);
  if (action === 'befriend' && owned) return done();
  if (action !== 'befriend' && !owned) return fail('not-owned');
  if (action === 'rest' && state.equippedPetId !== petId) return fail('not-following');
  const needsChoice = action !== 'befriend' || state.equippedPetId === null;
  if (needsChoice && rev <= state.equipRev) return fail('stale-revision');
  const added = action === 'befriend'
    ? [{ eventId: `pet-owned:${profileId}:${petId}`, type: 'pet-owned', value: petId }] : [];
  if (needsChoice) added.push(choice);
  return done(added);
}
