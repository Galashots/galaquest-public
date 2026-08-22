// How a child who cannot read tells their hero from their brother's.
//
// The chooser has shown a name and a words-only badge. For the reader this file exists for, both are
// shapes they cannot decode -- a five-year-old picking a save is looking for "the fox one", not for
// the letters R-O-B-I-N. So every hero gets an animal and a colour, and those are the thing on the
// card that a child actually navigates by.
//
// STORED, NOT DERIVED, and that is the ledger's own rule rather than a preference. GQ-014: an
// identity derived from mutable state is not an identity. Deriving the animal from "which animals
// are free on this device" would mean a child's fox turned into an owl the day their sibling's save
// was deleted -- the set is mutable, so an identity computed from it is not stable. It is chosen
// once, when the hero is made, and written into the profile.
//
// The fallback below IS derived, and only from the profileId, which never changes. It exists for
// profiles created before this file did: they have no stored animal and must still get a stable one
// rather than a blank. Derivation from an immutable id is the one form GQ-014 permits.
//
// SIX FOR FOUR SLOTS, so a device that fills every slot still gives each child a different animal
// with two to spare. Chosen to be distinguishable by silhouette and by colour rather than only by
// hue, because "the green one" and "the blue one" is a harder ask of a small child than "the frog"
// and "the whale".

/** The set, in the order a device hands them out. */
export const HERO_AVATARS = Object.freeze([
  Object.freeze({ id: 'fox', emoji: '🦊', colour: '#e07a3c', name: 'Fox' }),
  Object.freeze({ id: 'frog', emoji: '🐸', colour: '#5fae55', name: 'Frog' }),
  Object.freeze({ id: 'owl', emoji: '🦉', colour: '#8a6ea8', name: 'Owl' }),
  Object.freeze({ id: 'whale', emoji: '🐳', colour: '#4a8fc7', name: 'Whale' }),
  Object.freeze({ id: 'bee', emoji: '🐝', colour: '#d7a930', name: 'Bee' }),
  Object.freeze({ id: 'turtle', emoji: '🐢', colour: '#3f9c8a', name: 'Turtle' }),
]);

const BY_ID = new Map(HERO_AVATARS.map((avatar) => [avatar.id, avatar]));

/** The avatar record for a stored id, or null when the id is unknown -- a profile written by a newer
 *  version, or a hand-edited keyring. Null rather than a throw: a device should still open. */
export function avatarById(id) {
  return BY_ID.get(id) ?? null;
}

/**
 * A stable animal for a profile that never had one written down.
 *
 * Derived from the profileId ONLY, which is immutable for the life of the profile, so this answer
 * never changes for a given child. Two profiles can land on the same animal -- with six animals and
 * four slots that is unlikely and it is survivable, whereas an animal that moves is not.
 */
export function fallbackAvatarIdFor(profileId) {
  const text = typeof profileId === 'string' ? profileId : '';
  // Small, deterministic, and not trying to be a hash function -- it only has to spread six ways.
  let sum = 0;
  for (let i = 0; i < text.length; i += 1) sum = (sum * 31 + text.charCodeAt(i)) % 100003;
  return HERO_AVATARS[sum % HERO_AVATARS.length].id;
}

/**
 * The animal to give a hero being created now: the first one nobody on this device has.
 *
 * @param takenIds  the avatar ids already in use on this device.
 * @returns an avatar id. Falls back to the first in the list when every animal is taken, which
 *   cannot happen at MAX_PROFILES 4 with six animals but must still answer rather than return
 *   undefined -- a caller writing `undefined` into a profile is how a card ends up blank.
 */
export function chooseAvatarId(takenIds = []) {
  const taken = new Set(takenIds);
  const free = HERO_AVATARS.find((avatar) => !taken.has(avatar.id));
  return (free ?? HERO_AVATARS[0]).id;
}

/**
 * What to draw for this profile: its stored animal, or a stable derived one if it predates them.
 *
 * @param profile  { id, avatar } -- the stored record.
 * @returns an avatar record, never null, so a card always has something to paint.
 */
export function avatarForProfile(profile) {
  return avatarById(profile?.avatar) ?? avatarById(fallbackAvatarIdFor(profile?.id)) ?? HERO_AVATARS[0];
}
