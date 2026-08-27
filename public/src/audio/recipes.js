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

// G2/G3/G5: the Beacon arc's own sixteen live in audio/siegeRecipes.js and are SPREAD IN below
// rather than written out here. They are a coherent family authored against each other (the ignition
// is written note-for-note as the answer to `beacon-cold`'s refusal to resolve), and keeping them in
// one file keeps that argument readable -- while this table stays the single place the engine and
// every test look a recipe up by name. Their own event route is SIEGE_EVENT_RECIPE_MAP, for the
// reason that table's comment gives.
import { SIEGE_RECIPES } from './siegeRecipes.js';

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

  // ── P2: THE FIRST HERO LEVEL ───────────────────────────────────────────────────────────────────
  //
  // The strongest ROUTINE progression celebration (docs/product/PROGRESSION_CONTRACT_V0.md §11), and
  // the word doing the work there is "routine": relight-bloom is the sound of the whole first quest
  // landing and happens once, ever, so this must be clearly big without trying to outdo it -- a child
  // will hear this one many times.
  //
  // A RISING MAJOR TRIAD, which is the one musical gesture that means "up" without needing to be
  // taught: C-E-G climbing, each note entering before the last has gone, over a short bright noise
  // transient that gives it an attack. Deliberately shorter than the relight (0.9s against 2.7s) and
  // built from three clean tones rather than a sweep -- the Lantern's own unlock-flourish sweeps, and
  // the two now fire seconds apart, so they have to be distinguishable from each other by shape and
  // not only by pitch.
  //
  // First-draft placeholder on exactly the same footing as every other recipe in this table: what it
  // is MADE of is here, how it SOUNDS is the owner's call on a real iPad.
  'level-up': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.1, gainPeak: 0.16 }),
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.55, frequencyStart: 261.63, frequencyEnd: 261.63, gainPeak: 0.3,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.12, durationSeconds: 0.5, frequencyStart: 329.63, frequencyEnd: 329.63, gainPeak: 0.3,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.24, durationSeconds: 0.66, frequencyStart: 392, frequencyEnd: 392, gainPeak: 0.34,
    }),
    // The octave on top, entering last and held longest: the part that reads as arrival rather than
    // as another note in the run.
    Object.freeze({
      type: 'tone', startSeconds: 0.36, durationSeconds: 0.72, frequencyStart: 523.25, frequencyEnd: 523.25, gainPeak: 0.32,
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

  // G1: arriving at the Old Beacon. Also not an encounter event -- main.js plays it the frame the
  // hero crosses OLD_BEACON's own radius, the same "diff the state, do not chase an event" discipline
  // cart-jolt documents.
  //
  // WRITTEN AGAINST `victory-sting` AS ITS OPPOSITE, deliberately, because those are the two sounds
  // this moment could be confused between and it must never be the first. The sting is three notes
  // RISING to a major triad and resolving; this is a hollow low tone that swells and a bare open
  // fifth above it that simply STOPS without ever landing on a third -- the interval a listener
  // cannot tell major from minor by, which is exactly the "I found the place and something is wrong
  // here" this arrival is allowed to say and no more. The breath of noise under it is wind through
  // stone, the same tone-plus-noise layering shard-resonance uses to give a pure tone a body.
  //
  // Long, at about 1.4 s, for the same reason relight-bloom is: this is the end of a walk, not a
  // pickup. Quieter than either currency chime, because it is not a reward.
  'beacon-cold': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.55, gainPeak: 0.14 }),
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 1.1, frequencyStart: 98, frequencyEnd: 87.31, gainPeak: 0.3,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.35, durationSeconds: 0.95, frequencyStart: 293.66, frequencyEnd: 293.66, gainPeak: 0.24,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.55, durationSeconds: 0.85, frequencyStart: 587.33, frequencyEnd: 587.33, gainPeak: 0.2,
    }),
  ]),

  // ── R1: kill drops ────────────────────────────────────────────────────────────────────────────
  //
  // Coins reuse coin-chime outright (a coin off a kill is still a coin -- world/enemyDrops.js's own
  // header is explicit that it is worth exactly the same 1 a cart's coin is). Hearts and gear are new:
  // main.js plays these directly off world/enemyDropsPresenter.js's own arrival result, the same
  // "diff the state, do not chase a wire event" discipline coin-chime/shard-resonance already follow
  // (there is no encounter event behind a drop landing).

  // A heart heals; the recipe has to feel like RECEIVING rather than FINDING. Two warm, SLOW tones a
  // fourth apart with a soft attack -- deliberately the gentlest thing in this table (gainPeak tops
  // out at 0.3), opposite in shape from both currency chimes' bright percussive snap.
  'heart-mend': Object.freeze([
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.3, frequencyStart: 587.33, frequencyEnd: 587.33, gainPeak: 0.24,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.12, durationSeconds: 0.45, frequencyStart: 783.99, frequencyEnd: 783.99, gainPeak: 0.3,
    }),
  ]),

  // Gear: a small metallic clink (a short upward tone sweep) plus a noise transient for the sparkle --
  // distinct from workshop-build's own metal-and-noise pair by being much shorter and having no low
  // tone underneath it at all (this is a small pickup, not a whole structure resettling).
  'gear-find': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.05, gainPeak: 0.22 }),
    Object.freeze({
      type: 'tone', startSeconds: 0.02, durationSeconds: 0.2, frequencyStart: 698.46, frequencyEnd: 1046.5, gainPeak: 0.3,
    }),
  ]),

  // ── the hidden learning layer: rune chests ───────────────────────────────────────────────────
  //
  // Both directly played -- main.js fires one the instant a tapped answer is judged, the same
  // "diff the state, do not chase a wire event" reason coin-chime/gear-find already give: there is no
  // encounter event behind a chest's own judgement at all. NEVER SHAMING is the design brief's own
  // phrase for the wrong-answer path, so the two are written to be COUSINS rather than a reward and a
  // penalty -- both warm, both major, the correct one simply bigger.

  // A wrong answer still opens the chest (the brief's own "no wrong door, only a bigger one"): a
  // gentle two-note rise, the same shape family as heart-mend's own soft receiving chime but pitched
  // for a chest rather than a heal, so it reads as "here is your loot" rather than as a buzzer.
  'rune-chest-open': Object.freeze([
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.22, frequencyStart: 466.16, frequencyEnd: 466.16, gainPeak: 0.26,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.16, durationSeconds: 0.32, frequencyStart: 587.33, frequencyEnd: 587.33, gainPeak: 0.3,
    }),
  ]),

  // A correct answer: a bright four-note rise, written against level-up's own rising-triad shape as
  // its family member rather than its twin -- one note higher at the top (A5, past level-up's own G4
  // ceiling) and a bell-like noise transient under the first note, so "BRILLIANT!" sounds like its own
  // small fanfare and not a re-pitched copy of the level ceremony it may fire alongside.
  'rune-chest-brilliant': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.08, gainPeak: 0.18 }),
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.18, frequencyStart: 523.25, frequencyEnd: 523.25, gainPeak: 0.34,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.14, durationSeconds: 0.18, frequencyStart: 659.25, frequencyEnd: 659.25, gainPeak: 0.36,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.28, durationSeconds: 0.2, frequencyStart: 783.99, frequencyEnd: 783.99, gainPeak: 0.38,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.42, durationSeconds: 0.5, frequencyStart: 880, frequencyEnd: 880, gainPeak: 0.4,
    }),
  ]),

  ...SIEGE_RECIPES,
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
// G1: reaching the Old Beacon -- proximity, not an event, same group as everything above it here.
export const BEACON_ARRIVAL_RECIPE_NAME = 'beacon-cold';
// P2: the level-up. Directly played rather than mapped to an event for the reason the level-up
// ceremony itself is fired off a DIFF rather than off the xp-earned announcement -- see main.js's
// celebrateLevelUp. A sound hung off the announcement would replay on every reconnect where the
// device teaches its own facts back and the server announces them straight to it.
export const LEVEL_UP_RECIPE_NAME = 'level-up';
// R1: a kill drop's own two new pickups -- same DIRECTLY_PLAYED group as the two GP2 currencies just
// above, and for the identical reason (no wire event behind either one).
export const HEART_PICKUP_RECIPE_NAME = 'heart-mend';
export const GEAR_PICKUP_RECIPE_NAME = 'gear-find';
// The hidden learning layer's own two ceremony sounds -- judged client-side with no wire event
// behind either one, the same DIRECTLY_PLAYED reason every entry above it is in this group.
export const RUNE_CHEST_OPEN_RECIPE_NAME = 'rune-chest-open';
export const RUNE_CHEST_BRILLIANT_RECIPE_NAME = 'rune-chest-brilliant';
export const DIRECTLY_PLAYED_RECIPES = Object.freeze([
  RELIGHT_RECIPE_NAME,
  KEEPER_GREETING_RECIPE_NAME,
  CART_JOLT_RECIPE_NAME,
  COIN_PICKUP_RECIPE_NAME,
  SHARD_PICKUP_RECIPE_NAME,
  WORKSHOP_BUILD_RECIPE_NAME,
  BEACON_ARRIVAL_RECIPE_NAME,
  LEVEL_UP_RECIPE_NAME,
  HEART_PICKUP_RECIPE_NAME,
  GEAR_PICKUP_RECIPE_NAME,
  RUNE_CHEST_OPEN_RECIPE_NAME,
  RUNE_CHEST_BRILLIANT_RECIPE_NAME,
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
