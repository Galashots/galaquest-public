// public/src/audio/siegeRecipes.js
//
// Every new procedural sound the Beacon arc needs, in EXACTLY recipes.js's segment format -- the
// integrator spreads this table into RECIPES (`...SIEGE_RECIPES`) and engine.js plays them with no
// new features: only the two step types it already schedules ({ type: 'tone' | 'noise',
// startSeconds, durationSeconds, gainPeak, frequencyStart?, frequencyEnd? }). PURE, same as
// recipes.js: no Web Audio, no DOM, no imports, so a plain node test can validate it whole.
//
// Constraints hit while writing, worth knowing before retuning anything here:
//   - engine.js's noise is a plain white-noise buffer (createNoiseBuffer has no filter), so noise
//     cannot be pitched, darkened or swept. Everywhere the design wanted "lower noise" or "a noise
//     sweep", the movement lives on a tone layer UNDER the noise instead -- the same trick growl
//     already uses in the other direction.
//   - audio-recipes.test.mjs pins every tone to 40-8000 Hz, so nothing here reaches below 41.2 Hz
//     (E1) however much a stone giant might deserve it.
//   - gainPeak stays inside the existing table's own range: 0.7 is the loudest anything there gets
//     (impact), 0.12 the quietest (shard-resonance's noise breath). Nothing here exceeds either.
//
// All of them are first-draft placeholders in exactly recipes.js's sense: what each sound is MADE
// of, not how it SOUNDS, which is the owner's call on a real iPad.

export const SIEGE_RECIPES = Object.freeze({
  // ── the seal: three strikes to wake a Warden ─────────────────────────────────────────────────

  // The sword meeting something CRYSTALLINE. Written against `impact` (wolf-hit) as its reference:
  // impact is noise plus a tone falling 180->70 -- flesh giving way. This keeps the noise crack and
  // the low knock but adds the one thing flesh never does: a short HIGH ring (B6 sagging slightly,
  // a struck glass edge). The knock underneath stays nearly flat -- the seal did not give.
  'seal-crack': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.04, gainPeak: 0.5 }),
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.14, frequencyStart: 1975.53, frequencyEnd: 1864.66, gainPeak: 0.26,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.01, durationSeconds: 0.12, frequencyStart: 196, frequencyEnd: 174.61, gainPeak: 0.45,
    }),
  ]),

  // The three bursts are ONE FAMILY RISING: identical shape (noise pop, an upward sweep into a held
  // ring), with the ring stepping A5 -> C#6 -> E6 -- the three bursts together spell a rising
  // A-major triad, so a child who lands all three strikes has HEARD the seal opening as one chord
  // even if the strikes were a minute apart. Each step also rings a touch longer and a touch
  // louder: the seal resonating deeper the closer it is to giving.
  'seal-burst-1': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.06, gainPeak: 0.45 }),
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.18, frequencyStart: 440, frequencyEnd: 880, gainPeak: 0.32,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.12, durationSeconds: 0.35, frequencyStart: 880, frequencyEnd: 880, gainPeak: 0.4,
    }),
  ]),

  'seal-burst-2': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.06, gainPeak: 0.45 }),
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.18, frequencyStart: 554.37, frequencyEnd: 1108.73, gainPeak: 0.32,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.12, durationSeconds: 0.42, frequencyStart: 1108.73, frequencyEnd: 1108.73, gainPeak: 0.42,
    }),
  ]),

  // The third burst completes the triad -- and something answers. A low tone sags away underneath
  // it in beacon-cold's own bottom register (E2 falling toward B1, the same "wrong down here"
  // territory as its 98->87.31), starting a beat AFTER the bright top so the two read as call and
  // answer, not as one thick chord. This is the arc's first "something noticed you", half a second
  // before warden-wake says it out loud.
  'seal-burst-3': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.06, gainPeak: 0.5 }),
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.18, frequencyStart: 659.25, frequencyEnd: 1318.51, gainPeak: 0.32,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.12, durationSeconds: 0.5, frequencyStart: 1318.51, frequencyEnd: 1318.51, gainPeak: 0.45,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.2, durationSeconds: 0.7, frequencyStart: 82.41, frequencyEnd: 61.74, gainPeak: 0.3,
    }),
  ]),

  // ── the Warden itself ────────────────────────────────────────────────────────────────────────

  // WRITTEN AS BEACON-COLD'S ANSWER, deliberately, the way beacon-cold was written against
  // victory-sting. beacon-cold is a low G (98) SAGGING to F under a bare D4/D5 that refuses to
  // resolve -- "I found the place and something is wrong here". This reuses its exact three
  // pitches, but the low G now RISES back up through itself (49->98: stone grinding upright), and
  // the same D4 and D5 arrive late over it, unchanged and still refusing a third. The cold sound a
  // child heard on arrival, standing up. The long noise bed is the grind's texture -- engine noise
  // cannot be pitched (see the header), so the WEIGHT is all in the rising tone under it.
  'warden-wake': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 1.1, gainPeak: 0.26 }),
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 1.2, frequencyStart: 49, frequencyEnd: 98, gainPeak: 0.5,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.55, durationSeconds: 0.9, frequencyStart: 293.66, frequencyEnd: 293.66, gainPeak: 0.26,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.75, durationSeconds: 0.8, frequencyStart: 587.33, frequencyEnd: 587.33, gainPeak: 0.2,
    }),
  ]),

  // The maul pair, named for the Warden's heavy strikes (the maul prop itself comes later; the
  // SOUND of a heavy two-part blow does not depend on the model existing). Windup is a warning, not
  // a hit: one low swell rising a clean octave, quiet on purpose -- its whole job is to buy a child
  // the half-second to move, so it must never be mistaken for the impact it promises.
  'maul-windup': Object.freeze([
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.5, frequencyStart: 55, frequencyEnd: 110, gainPeak: 0.32,
    }),
    Object.freeze({ type: 'noise', startSeconds: 0.1, durationSeconds: 0.4, gainPeak: 0.12 }),
  ]),

  // ...and the impact pays the windup off: the hardest single hit in the game, sitting exactly at
  // the table's existing 0.7 ceiling (impact's own peak) rather than above it. Deeper and longer
  // than `thud` (hero-hurt, 150->60) -- this falls 90->41, the floor the frequency rule allows --
  // with a delayed second noise for the earth still settling after the head lands.
  'maul-impact': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.1, gainPeak: 0.6 }),
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.35, frequencyStart: 90, frequencyEnd: 41.2, gainPeak: 0.7,
    }),
    Object.freeze({ type: 'noise', startSeconds: 0.08, durationSeconds: 0.45, gainPeak: 0.22 }),
  ]),

  // The Warden's horizontal swing, written against the hero's own `whoosh` (0.12s of bare noise):
  // this is the same idea from something ten times the mass -- more than twice as long, and DARKER,
  // which unpitchable white noise cannot do alone, so a low tone falls under it (130->65, an octave
  // down) and carries the size. A child hears whose swing it is with eyes shut.
  'warden-sweep': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.3, gainPeak: 0.4 }),
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.3, frequencyStart: 130.81, frequencyEnd: 65.41, gainPeak: 0.3,
    }),
  ]),

  // The cold ring the Warden throws: a shimmer that EXPANDS. The design's "noise sweep down" is
  // another thing white noise cannot literally do (header again), so the expansion is a tone
  // falling two octaves through the beacon's own D family (D6 -> D4) with the airy noise riding on
  // top, and a held D5 in the middle as the ring's own body -- every pitch in it is one the
  // beacon-cold/warden-wake pair already taught, because this attack IS that cold, moving.
  'cold-pulse': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.5, gainPeak: 0.14 }),
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.6, frequencyStart: 1174.66, frequencyEnd: 293.66, gainPeak: 0.24,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.1, durationSeconds: 0.7, frequencyStart: 587.33, frequencyEnd: 587.33, gainPeak: 0.2,
    }),
  ]),

  // The Warden taking a hit: a dull iron flinch, written against `impact` as NOT-impact. A wolf's
  // hit-tone falls 110 Hz because flesh gives; this one barely moves (233->208, a flinch, not a
  // wound) and sits mid-register where struck plate lives. Quieter than the child's own maul
  // moments on purpose -- the fight's loud beats belong to danger, not to chip damage.
  'warden-hit': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.04, gainPeak: 0.28 }),
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.14, frequencyStart: 233.08, frequencyEnd: 207.65, gainPeak: 0.42,
    }),
  ]),

  // The long collapse, the one Warden sound allowed to linger the way relight-bloom is: two tones
  // falling together (the upper from A4, the lower dragging the cold D down with it) over a grind
  // of noise, then the BODY LANDS -- a short noise crack with the deepest legal thump under it --
  // and then, deliberately, almost nothing: a single near-silent floor tone dying away, a beat of
  // silence with a shape, so the quiet after the fall is authored rather than accidental.
  'warden-defeat': Object.freeze([
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 1.0, frequencyStart: 440, frequencyEnd: 110, gainPeak: 0.4,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.2, durationSeconds: 1.0, frequencyStart: 293.66, frequencyEnd: 73.42, gainPeak: 0.35,
    }),
    Object.freeze({ type: 'noise', startSeconds: 0.1, durationSeconds: 0.9, gainPeak: 0.2 }),
    Object.freeze({ type: 'noise', startSeconds: 1.25, durationSeconds: 0.09, gainPeak: 0.55 }),
    Object.freeze({
      type: 'tone', startSeconds: 1.25, durationSeconds: 0.4, frequencyStart: 65.41, frequencyEnd: 41.2, gainPeak: 0.6,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 1.9, durationSeconds: 0.55, frequencyStart: 49, frequencyEnd: 49, gainPeak: 0.1,
    }),
  ]),

  // THE PAYOFF, written as beacon-cold's OPPOSITE the way beacon-cold was written as
  // victory-sting's. Every refusal in that sound is answered here, note for note: its low G sagged
  // (98->87.31) -- this one RISES a full octave (98->196) and warms as it goes; its bare D4/D5
  // stood without a third and simply stopped -- here the same D4 returns and then B4 sounds, THE
  // major third beacon-cold refused, and the moment it lands the chord a child has heard cold since
  // G1 turns G MAJOR, with a warm G5 blooming on top. About 2s, long like relight-bloom and for the
  // same reason: this is the moment the whole arc builds to, and the breath of noise that was wind
  // through dead stone at arrival is the first crackle of flame here.
  'beacon-ignite': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.7, gainPeak: 0.12 }),
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 1.3, frequencyStart: 98, frequencyEnd: 196, gainPeak: 0.34,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.45, durationSeconds: 1.2, frequencyStart: 293.66, frequencyEnd: 293.66, gainPeak: 0.26,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.85, durationSeconds: 1.2, frequencyStart: 493.88, frequencyEnd: 493.88, gainPeak: 0.3,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 1.15, durationSeconds: 1.0, frequencyStart: 783.99, frequencyEnd: 783.99, gainPeak: 0.3,
    }),
  ]),

  // ── the arc's reward and discovery cues ──────────────────────────────────────────────────────

  // An IMPORTANT item arriving, distinct on purpose from every celebration already in the table:
  // victory-sting climbs a C-major triad and tops out sweeping to B5 (987.77); unlock-flourish is
  // four notes; coin-chime is two clicks. This is THREE notes in bare rising fifths -- E5, B5, E6,
  // an open blade-bright shape rather than a cosy triad -- and its last note (1318.51) hangs a
  // fourth above victory-sting's highest reach, so the ear files it as bigger news than winning a
  // fight, which is exactly what it is.
  'blade-unlock': Object.freeze([
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.16, frequencyStart: 659.25, frequencyEnd: 659.25, gainPeak: 0.42,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.14, durationSeconds: 0.16, frequencyStart: 987.77, frequencyEnd: 987.77, gainPeak: 0.45,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.28, durationSeconds: 0.55, frequencyStart: 1318.51, frequencyEnd: 1318.51, gainPeak: 0.5,
    }),
  ]),

  // Finding something the game never pointed at. Two soft notes a rising FOURTH apart (A5 -> D6)
  // -- a question mark, not a fanfare -- written against `sparkle` (mark-earned) as its quieter
  // cousin: sparkle sits at the table's ceiling (G6/C7) because it lands on top of a fanfare;
  // this sits lower and quieter than both currency chimes, because a secret's whole flavour is
  // that nobody announced it.
  'secret-found': Object.freeze([
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.12, frequencyStart: 880, frequencyEnd: 880, gainPeak: 0.14,
    }),
    Object.freeze({
      type: 'tone', startSeconds: 0.1, durationSeconds: 0.28, frequencyStart: 1174.66, frequencyEnd: 1174.66, gainPeak: 0.16,
    }),
  ]),

  // ── blackthorn: the Wildwood's own dead wood ─────────────────────────────────────────────────

  // The sword BOUNCING. Written against seal-crack as its dead opposite: crystal answers a strike
  // with a high ring; dead blackthorn answers with nothing at all -- a knuckle of noise and one
  // flat low knock that swallows its own pitch. No segment here goes above 131 Hz, which is the
  // silence doing the talking: a child hears "this wood does not care about that sword".
  'blackthorn-tough': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.05, gainPeak: 0.3 }),
    Object.freeze({
      type: 'tone', startSeconds: 0, durationSeconds: 0.12, frequencyStart: 130.81, frequencyEnd: 123.47, gainPeak: 0.4,
    }),
  ]),

  // ...and the RIGHT tool going through it: a long fibrous rip (white noise IS torn fibre -- the
  // one job the unfiltered buffer is perfect for) with a tone rising a clean open fifth underneath
  // (A3 -> E4), the "open resolve" of the way coming clear. The pair works like bramble's own
  // tough/tear beat: same target, and the difference between the two sounds is the entire lesson.
  'blackthorn-tear': Object.freeze([
    Object.freeze({ type: 'noise', startSeconds: 0, durationSeconds: 0.28, gainPeak: 0.45 }),
    Object.freeze({
      type: 'tone', startSeconds: 0.12, durationSeconds: 0.3, frequencyStart: 220, frequencyEnd: 329.63, gainPeak: 0.28,
    }),
  ]),
});

// ── the route from a siege event to a sound ─────────────────────────────────────────────────────
//
// A THIRD table rather than an addition to audio/recipes.js's own EVENT_RECIPE_MAP, and the reason
// is the same one rewards/feedback.js's header already gives for splitting REWARD_RECIPE_MAP off:
// EVENT_RECIPE_MAP is pinned by test/audio-recipes.test.mjs to a regex scan of
// combat/encounter.js's OWN source text, so an entry for an event that file never raises is a
// *stray* by that test's definition. These events are raised by world/beaconSiege.js and
// world/blackthornHollow.js. Same discipline -- every event decided explicitly, `null` meaning
// "deliberately silent" rather than "forgotten" -- addressed through the table that owns them.
//
// Where a sound is deliberately absent, the reason is written next to it: the fight is already the
// loudest thing on screen, and a boss that makes a noise for every internal state change stops
// reading as a creature and starts reading as a machine.
export const SIEGE_EVENT_RECIPE_MAP = Object.freeze({
  // The seals. Cracking is one sound; bursting escalates across the three, and the third carries
  // the low answer that says something noticed -- see the recipes' own comments.
  'seal-cracked': 'seal-crack',
  'seal-burst': null,
  // The Warden. Its attacks are driven off MODE TRANSITIONS in main.js rather than from events
  // (the wind-up has to start with the animation, and the animation is a mode), so the attack
  // recipes are not routed here -- they are named in DIRECTLY_PLAYED_SIEGE_RECIPES below.
  'warden-woke': 'warden-wake',
  'warden-hit': 'warden-hit',
  'warden-defeated': 'warden-defeat',
  'beacon-ignited': 'beacon-ignite',
  // Being hurt by the Warden already has the hero's own hurt vignette and hearts (main.js reuses
  // combat/feedback.js's handlers for these), and the maul's own impact lands on the same frame --
  // a third sound stacked on those two is noise, not feedback.
  'warden-hurt-hero': null,
  'siege-swing-missed': null,
  // A phase change is announced by the boss bar's tint and by the Warden's own brazier flaring; the
  // fight's audio bed is already dense at that moment.
  'warden-phase': null,
  // A wipe is already the most legible thing that can happen (every child is on the floor).
  'siege-reset': null,
  // The blackthorn's two answers -- the whole lesson of the Blade is the difference between them.
  'blackthorn-tough': 'blackthorn-tough',
  'blackthorn-cut': null,
  'blackthorn-torn': 'blackthorn-tear',
  'hollow-chest-opened': 'secret-found',
});

/**
 * Recipes main.js plays directly, with no event behind them -- the same third route
 * audio/recipes.js's own DIRECTLY_PLAYED_RECIPES describes, for the same kind of beat.
 *
 * The Warden's three attacks are here because they are driven off mode transitions: a wind-up whose
 * sound started when an event was drained (up to a tenth of a second late, on the next snapshot)
 * would arrive after the arms were already moving. `blade-unlock` is here because it belongs to the
 * unlock ceremony, which main.js fires off a diff of owned items rather than off an event.
 */
export const DIRECTLY_PLAYED_SIEGE_RECIPES = Object.freeze([
  'maul-windup', 'maul-impact', 'warden-sweep', 'cold-pulse', 'blade-unlock',
  'seal-burst-1', 'seal-burst-2', 'seal-burst-3',
]);

/** The one lookup, so a caller never reaches into the table itself -- soundForEvent's own shape. */
export function soundForSiegeEvent(eventType) {
  return SIEGE_EVENT_RECIPE_MAP[eventType] ?? null;
}
