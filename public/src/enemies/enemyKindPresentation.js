// public/src/enemies/enemyKindPresentation.js
//
// R1's client presentation pass: how each ordinary-enemy KIND reads at gameplay distance. Pure data,
// deliberately outside combat/enemyStats.js -- that file is the guarded rules layer
// (test/combat-purity.test.mjs forbids anything but combat's own ./ imports there), and "what colour
// is this animal" is a presentation fact with no business inside it. This is the sibling home
// enemyStats.js's own header points to ("a sibling pure map, one home") -- wolf.js, nameplate.js and
// main.js all read the SAME table rather than three separate guesses at what an Ember Wolf looks
// like (GQ-007).
//
// combat/enemyStats.js's own ENEMY_KINDS is the canonical kind list; this module is keyed against it
// (enemy-kind-presentation.test.mjs pins that every kind that table names has an entry here), but does
// not import three.js or touch the DOM -- colours are plain numeric hex, exactly the shape
// progression/heroScreen.js's own ITEM_SWATCH_HEX already uses, so a caller decides what to DO with a
// number rather than being handed a THREE.Color it did not ask for.
//
// Tuned relative to the WOLF baseline (tint 0xffffff, i.e. "no tint": the shipped wolf.glb's own
// fur colour, unchanged) rather than invented per kind, the same escalating-family reasoning
// enemyStats.js's own stat rows already state:
//   - Ember Wolf: a warm ember-orange tint and a touch bigger, so it reads as "hot" before a child is
//     close enough to see the bite. Deliberately NOT world/oldBeacon.js's BEACON_EMBER_WARM_COLOR/
//     workshop.js's own ember tones -- those are this game's established "a good fire, a friendly
//     hearth" gold, and reusing it here would put a predator in the same light as the Lantern Tree.
//     This is a hotter, more saturated orange-red -- the "coals, not a hearth" read.
//   - Frost Wolf: world/oldBeacon.js's own BEACON_GLOW_COLOR, imported rather than restated (GQ-007)
//     -- the exact rime-blue the Beacon's cold seals and the Warden already established as this
//     game's ONE "something cold and dangerous" colour. A second blue would just be a second guess.
//   - Alpha Wolf: a near-black coat (bigger, rarer, meaner) plus glowing eyes -- the warden presenter
//     (enemies/warden.js) already proved the "two small glow sprites near the head" technique reads
//     as menace at gameplay distance, so this reuses it rather than inventing a second one. The eyes'
//     own colour is a predator red, distinct from BOTH the tint above and from WOLF_SPARK_COLOR (the
//     stolen light every wolf kind still carries) -- the spark says "this is the thing you are
//     hunting"; the eyes say "and it is looking at you", and the two must never share a colour or a
//     child cannot tell a health cue from a threat cue.

const WOLF_TINT_COLOR = 0xffffff; // identity: no tint at all, the shipped fur as authored.
const EMBER_WOLF_TINT_COLOR = 0xff6a35;
// world/oldBeacon.js's BEACON_GLOW_COLOR, restated as a literal because oldBeacon.js is a large
// three.js-touching module and this file must stay importable with zero runtime dependencies (the
// same "combat.js stays pure" posture, one step looser) -- pinned equal to it by
// enemy-kind-presentation.test.mjs so the two can never quietly drift apart.
const FROST_WOLF_TINT_COLOR = 0x9fd0e8;
const ALPHA_WOLF_TINT_COLOR = 0x1c1c22;
const ALPHA_WOLF_EYE_COLOR = 0xff3b30;

const PRESENTATION_BY_KIND = Object.freeze({
  wolf: Object.freeze({
    displayName: 'Wolf',
    tintColor: WOLF_TINT_COLOR,
    scaleMultiplier: 1,
    glowEyes: false,
    eyeColor: null,
    menacing: false,
  }),
  'ember-wolf': Object.freeze({
    displayName: 'Ember Wolf',
    tintColor: EMBER_WOLF_TINT_COLOR,
    scaleMultiplier: 1.08,
    glowEyes: false,
    eyeColor: null,
    menacing: false,
  }),
  'frost-wolf': Object.freeze({
    displayName: 'Frost Wolf',
    tintColor: FROST_WOLF_TINT_COLOR,
    scaleMultiplier: 1.12,
    glowEyes: false,
    eyeColor: null,
    menacing: false,
  }),
  'alpha-wolf': Object.freeze({
    displayName: 'Alpha Wolf',
    tintColor: ALPHA_WOLF_TINT_COLOR,
    scaleMultiplier: 1.3,
    glowEyes: true,
    eyeColor: ALPHA_WOLF_EYE_COLOR,
    // The one kind whose nameplate carries a danger accent regardless of the level-vs-hero threshold
    // enemyNameplateModel already computes -- an Alpha is meant to read as a rarer, meaner threat on
    // sight, the same "boss-shaped step up" enemyStats.js's own header names it.
    menacing: true,
  }),
});

const FALLBACK_PRESENTATION = PRESENTATION_BY_KIND.wolf;

/** Every kind this table presents, in table order -- kept for the pin test rather than re-deriving
 *  combat/enemyStats.js's own ENEMY_KINDS a second way. */
export const PRESENTED_ENEMY_KINDS = Object.freeze(Object.keys(PRESENTATION_BY_KIND));

/** The full appearance record for a kind, or the Wolf's own (identity) presentation for a kind this
 *  table does not recognise -- never a thrown error over a cosmetic, the same "an unrecognised kind
 *  gets the ordinary answer" posture combat/enemyStats.js's respawnSecondsForKind already takes. */
export function presentationForKind(kind) {
  return PRESENTATION_BY_KIND[kind] ?? FALLBACK_PRESENTATION;
}

export function displayNameForKind(kind) {
  return presentationForKind(kind).displayName;
}
