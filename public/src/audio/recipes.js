// Pure data: what each combat sound is made of, and which encounter event triggers which sound.
// PURE per Phase C ruling 2 -- no Web Audio, no DOM, no imports at all (the event list this table is
// checked against lives in the caller's test, not here, so this file never reaches into combat/ and
// the audio layer stays decoupled from the combat layer it reacts to). engine.js is the thin adapter
// that turns a recipe into actual sound; this file only describes the sound as data, so a plain node
// test can validate it without a browser or an AudioContext.
//
// Every step in a recipe has the shape:
//   { type: 'tone' | 'noise', startSeconds, durationSeconds, gainPeak, frequencyStart?, frequencyEnd? }
// startSeconds/durationSeconds are offsets within the recipe's own timeline (the first step of every
// recipe here starts at 0). gainPeak is the step's peak amplitude, in (0, 1]. Tone steps carry a
// frequency sweep (frequencyStart -> frequencyEnd, flat if a step does not sweep); noise steps do not
// -- there is nothing to filter here yet, that is engine.js's business if it ever wants one.
//
// All six are first-draft placeholders (ruling 1) -- what they're MADE of, not how they SOUND, which
// is the owner's call on a real iPad. Kept short per the brief: 0.05-0.6s, except the victory sting, which
// is allowed to run to about a second because it is the one moment worth lingering on.

export const RECIPES = Object.freeze({
  // swing: a quick, breathy pass of noise -- the sound of the blade cutting air, not hitting anything.
  whoosh: Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.12, gainPeak: 0.35 }),
  ]),

  // wolf-hit: a noise crack for the initial contact, layered with a short low tone drop for weight --
  // the WoW/Unity "hit flash" research in feedback.js is about the visual; this is its audio twin.
  impact: Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.05, gainPeak: 0.6 }),
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.12, frequencyStart: 180, frequencyEnd: 70, gainPeak: 0.7,
    }),
  ]),

  // hero-hurt: duller and longer than impact -- a low tone sagging further, plus a soft noise body, so
  // it reads as "the hero took that" rather than as another wolf-hit.
  thud: Object.freeze([
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.22, frequencyStart: 150, frequencyEnd: 60, gainPeak: 0.55,
    }),
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.08, gainPeak: 0.25 }),
  ]),

  // wolf-defeated: a short rising three-note arpeggio (C5-E5-G5-ish), the one sound in this table
  // allowed to linger, because it is the fight's payoff moment.
  'victory-sting': Object.freeze([
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.22, frequencyStart: 523.25, frequencyEnd: 523.25, gainPeak: 0.5,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.18, durationSeconds: 0.22, frequencyStart: 659.25, frequencyEnd: 659.25, gainPeak: 0.5,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.36, durationSeconds: 0.6, frequencyStart: 783.99, frequencyEnd: 987.77, gainPeak: 0.6,
    }),
  ]),

  // hero-down: two overlapping tones sliding downward -- the inverse shape of the victory sting, so
  // the two never get confused even heard without looking.
  'low-sting': Object.freeze([
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.35, frequencyStart: 220, frequencyEnd: 164.81, gainPeak: 0.55,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.3, durationSeconds: 0.45, frequencyStart: 164.81, frequencyEnd: 110, gainPeak: 0.5,
    }),
  ]),

  // hero-respawned: two soft high tones a third apart, gentle rather than triumphant -- a "you're
  // back" chime, not a second victory sting.
  'soft-chime': Object.freeze([
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.35, frequencyStart: 1046.5, frequencyEnd: 1046.5, gainPeak: 0.35,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.05, durationSeconds: 0.4, frequencyStart: 1318.51, frequencyEnd: 1318.51, gainPeak: 0.25,
    }),
  ]),

  // wolf-respawned: a short low growl -- pre-brief-discussion.md decision 4. Functional, not
  // decorative: the wolf respawns at its spawn point, likely off-screen, and this is what tells a
  // child it is back. A sagging low tone (55-90 Hz, BELOW every other recipe's range -- low-sting's
  // lowest note is 110 Hz) carries the growl's pitch, with a noise layer starting a beat later for
  // the breathy, throaty texture a pure tone cannot give alone. Distinct from all six Phase C shapes:
  // the only one built this low, and the only one pairing a sustained low tone with a DELAYED noise
  // layer rather than a simultaneous or leading one.
  growl: Object.freeze([
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.4, frequencyStart: 90, frequencyEnd: 55, gainPeak: 0.6,
    }),
    Object.freeze({ type: 'noise', startSeconds: 0.05, durationSeconds: 0.35, gainPeak: 0.3 }),
  ]),

  // ── the quest's own three moments, which were silent ─────────────────────────────────────────
  //
  // Same status as the other eight: first-draft placeholders, made of the same two step types, and
  // how they SOUND is still the owner's call on a real iPad. What they are here for is that the Lantern
  // Tree quest -- the whole reason the village exists -- made no sound at any of its three beats,
  // while every swing and every bite did. A child heard more from missing a wolf than from finishing
  // the game's only story.

  // mark-earned: a two-note sparkle, and deliberately the QUIETEST thing in this table. It fires in
  // the same instant as victory-sting (encounter.js raises wolf-defeated and the reward fold awards
  // the mark off that same event), so it has to layer on top of a sound already playing rather than
  // compete with it. Higher than anything else here -- G6 then C7, above victory-sting's own B5
  // ceiling -- and short, so it reads as a coin landing on a fanfare rather than as a second fanfare.
  sparkle: Object.freeze([
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.09, frequencyStart: 1567.98, frequencyEnd: 1567.98, gainPeak: 0.22,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.07, durationSeconds: 0.16, frequencyStart: 2093, frequencyEnd: 2093, gainPeak: 0.26,
    }),
  ]),

  // lantern-unlocked: the third mark, out at the wolf. A four-note rise (C6-E6-G6-C7) -- the same
  // major shape as victory-sting an octave up and one note longer, because this is the bigger
  // version of the same news: not "you won a fight" but "you have all three".
  'unlock-flourish': Object.freeze([
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.16, frequencyStart: 1046.5, frequencyEnd: 1046.5, gainPeak: 0.4,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.13, durationSeconds: 0.16, frequencyStart: 1318.51, frequencyEnd: 1318.51, gainPeak: 0.4,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.26, durationSeconds: 0.16, frequencyStart: 1567.98, frequencyEnd: 1567.98, gainPeak: 0.42,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.39, durationSeconds: 0.5, frequencyStart: 2093, frequencyEnd: 2093, gainPeak: 0.45,
    }),
  ]),

  // The relight itself. Not an encounter event and not in EVENT_RECIPE_MAP -- main.js plays it
  // directly when the ceremony starts, because the ceremony is a CLIENT presentation beat with no
  // event behind it (see world/relight.js). Written against that timeline rather than by ear: the
  // breath of noise is the light climbing the trunk (0-0.9 s), the swelling low tone carries the
  // canopy's own bloom, and the two high notes land at CANOPY_PEAK (1.35 s) and inside the settle,
  // so what is heard and what is seen are the same shape. Longest recipe in the table by design --
  // this is the moment the whole quest builds to.
  'relight-bloom': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.85, gainPeak: 0.13 }),
    Object.freeze({
      type: 'tone', startSeconds: 0.1, durationSeconds: 1.3, frequencyStart: 130.81, frequencyEnd: 261.63, gainPeak: 0.34,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.7, durationSeconds: 1.0, frequencyStart: 392, frequencyEnd: 392, gainPeak: 0.3,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 1.35, durationSeconds: 1.1, frequencyStart: 523.25, frequencyEnd: 523.25, gainPeak: 0.38,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 1.5, durationSeconds: 1.2, frequencyStart: 783.99, frequencyEnd: 783.99, gainPeak: 0.34,
    }),
  ]),

  // ── GP2: Rowan's cart ──────────────────────────────────────────────────────────────────────────
  //
  // Same status as everything else in this table: first-draft placeholders, how they SOUND is the owner's
  // call on a real iPad. Not encounter events (there is no wire event behind any of these three -- see
  // this file's own DIRECTLY_PLAYED_RECIPES comment) -- main.js plays them directly at the exact
  // frame it detects the relevant state transition (cart searched, a specific pickup now collected by
  // this client's own hero), the same "diff the published state, do not chase a transient event"
  // discipline world/cartLoot.js's own header explains.

  // The cart's own small physical acknowledgement, played the instant it is searched, before any
  // loot appears -- a dry wooden creak (noise) plus a short low thud, distinct from combat's `impact`
  // (which pairs noise with a tone SWEEPING down through 70-180 Hz): this stays flat and low, reading
  // as "something heavy just settled" rather than "something got hit".
  'cart-jolt': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.14, gainPeak: 0.4 }),
    Object.freeze({
      type: 'tone', startSeconds: 0.02, durationSeconds: 0.16, frequencyStart: 110, frequencyEnd: 98, gainPeak: 0.35,
    }),
  ]),

  // A coin landing in a hand: two bright, near-instant high tones, deliberately SHORTER and more
  // percussive than `sparkle` (mark-earned) so the two are never confused even heard blind -- sparkle
  // eases in over 0.09s+0.16s, this snaps on at 0.04s+0.08s, the difference between a chime and a
  // click. Pitched a fifth below sparkle's own G6/C7 (C6/G6) so the pair reads as siblings, not twins.
  'coin-chime': Object.freeze([
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.04, frequencyStart: 1046.5, frequencyEnd: 1046.5, gainPeak: 0.3,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.03, durationSeconds: 0.08, frequencyStart: 1567.98, frequencyEnd: 1567.98, gainPeak: 0.32,
    }),
  ]),

  // A Wildwood Shard, deliberately the OPPOSITE shape from coin-chime rather than a re-pitched copy of
  // it -- the two currencies have to be tellable apart with eyes shut. One long tone that SWEEPS
  // upward (glassy, resonant) instead of two short flat notes, plus a breath of noise under it for
  // texture a pure tone cannot give -- the same "tone plus noise layer" trick growl uses for a low
  // sound, applied here to a high one.
  'shard-resonance': Object.freeze([
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.4, frequencyStart: 900, frequencyEnd: 1800, gainPeak: 0.28,
    }),
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.12, gainPeak: 0.12 }),
  ]),

  // Keeper Aldric starting to speak. Also not an encounter event -- his line appears from proximity
  // (world/keeperSpeech.js), and walking up to somebody who then talks at you in complete silence is
  // the difference between a character and a sign. Two soft low notes, F4 then A4: a warm rising
  // third, the shape of "hello", and deliberately the LOWEST thing in this table so it reads as a
  // person rather than as another reward chime. Quiet, because it fires every time a child walks
  // back to him and it must never become the sound of being nagged.
  'keeper-greeting': Object.freeze([
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.2, frequencyStart: 349.23, frequencyEnd: 349.23, gainPeak: 0.16,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.15, durationSeconds: 0.3, frequencyStart: 440, frequencyEnd: 440, gainPeak: 0.18,
    }),
  ]),

  // GP3: the Workshop's own transformation. Also not an encounter event -- main.js plays this the
  // instant it diffs village.workshopOwned false->true, the same "diff the published state" discipline
  // cart-jolt's own header explains. A bright metallic ding (the anvil catching its first strike,
  // descending E6->C#6 like a struck bell settling) layered over a warm low tone (the structure itself
  // resettling) plus a breath of noise for the strike's own texture -- deliberately distinct from
  // cart-jolt's dry wooden creak+thud and from both currency chimes: this is the sound of BUILDING
  // something, not finding or spending it.
  'workshop-build': Object.freeze([
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.22, frequencyStart: 1318.51, frequencyEnd: 1108.73, gainPeak: 0.34,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.05, durationSeconds: 0.5, frequencyStart: 174.61, frequencyEnd: 164.81, gainPeak: 0.3,
    }),
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.08, gainPeak: 0.22 }),
  ]),
});

/** Recipes played directly by a presenter rather than by an encounter or reward EVENT. There is one:
 *  the Lantern Tree's relight is a client-side ceremony (world/relight.js) with no event behind it.
 *  Named here so audio-recipes.test.mjs's "no unused recipes" check stays a real check -- it would
 *  otherwise have to be weakened to ignore anything it did not recognise. */
export const RELIGHT_RECIPE_NAME = 'relight-bloom';
/** The Keeper's line appearing. Proximity, not an event -- see keeperSpeechState. */
export const KEEPER_GREETING_RECIPE_NAME = 'keeper-greeting';
// GP2: the cart's own physical reaction, and a coin's/a shard's own pickup sound -- all three driven
// by main.js diffing world/cartLoot.js's published state (see that file's header), not by a wire
// event, so none of them belong in EVENT_RECIPE_MAP below.
export const CART_JOLT_RECIPE_NAME = 'cart-jolt';
export const COIN_PICKUP_RECIPE_NAME = 'coin-chime';
export const SHARD_PICKUP_RECIPE_NAME = 'shard-resonance';
// GP3: the Workshop's own transformation ceremony -- driven by main.js diffing
// village.workshopOwned, same as the three GP2 entries just above, so it belongs in this group too.
export const WORKSHOP_BUILD_RECIPE_NAME = 'workshop-build';
export const DIRECTLY_PLAYED_RECIPES = Object.freeze([
  RELIGHT_RECIPE_NAME,
  KEEPER_GREETING_RECIPE_NAME,
  CART_JOLT_RECIPE_NAME,
  COIN_PICKUP_RECIPE_NAME,
  SHARD_PICKUP_RECIPE_NAME,
  WORKSHOP_BUILD_RECIPE_NAME,
]);

/**
 * Ruling 3's complete table: every event type feedback.js can raise, mapped to a recipe name, or
 * explicitly `null` where the design calls for silence. A key missing entirely (as opposed to a key
 * present with value `null`) means this table has not decided that event -- audio-recipes.test.mjs
 * checks this against feedback.js's own ENCOUNTER_EVENT_TYPES so a new event cannot go unhandled.
 */
export const EVENT_RECIPE_MAP = Object.freeze({
  swing: 'whoosh',
  'swing-missed': null,
  'swing-dropped': null,
  'wolf-hit': 'impact',
  'wolf-defeated': 'victory-sting',
  'hero-hurt': 'thud',
  'bite-missed': null,
  'hero-down': 'low-sting',
  'hero-respawned': 'soft-chime',
  // Silent ON PURPOSE, and this is the interesting entry in the table. hero-healed is raised in the
  // SAME FRAME as wolf-defeated (see healTheStanding in encounter.js), so anything here plays on top
  // of victory-sting -- two chimes a few milliseconds apart read as one muddy noise, not as two
  // pieces of news. The victory sting already is the sound of this; the heart getting its colour
  // back, and the hearts row popping, are the part that says what the reward was.
  'hero-healed': null,
  // Phase D, pre-brief-discussion.md decision 4: a low growl warning. Functional, not decorative --
  // the wolf respawns at its spawn point, likely off-screen, and the growl is what tells a child it
  // is back. No longer explicit null (Phase C ruling 1's placeholder); how it actually SOUNDS is
  // still the owner's call on a real iPad, same as the other six.
  'wolf-respawned': 'growl',
});

/**
 * Look up the recipe name for an encounter event type, or `null` if that event is explicitly silent.
 * Pure table lookup -- no Web Audio, no side effects; engine.js is what turns the returned name into
 * sound via RECIPES.
 */
export function soundForEvent(eventType) {
  return EVENT_RECIPE_MAP[eventType] ?? null;
}
