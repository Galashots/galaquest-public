// Translating rule events into something a young player can see, kept separate from encounter.js
// on purpose -- see the comment at the top of encounter.js. Nothing in this file touches three.js or
// the DOM; wolf.js and main.js do, driven by the numbers and helpers computed here. That split is
// what keeps this file importable and unit-testable under plain `node --test`, with no DOM shim.
//
// Reference research (2026-08-12), per AGENTS.md "Look before you derive": searched World of
// Warcraft first, three-plus image examples per question, convention written down before any number
// below was chosen.
//
//   - A blow landing on a TARGET. WoW nameplates and unit frames (wowinterface.com screenshots, e.g.
//     a boss health bar reading "311K (68%)") show health as a bar that visibly depletes, with the
//     number as backup, not the primary signal -- confirmed on three separate nameplate/frame
//     screenshots. Separately, WoW's floating combat text pops a number AT the point of contact,
//     instantly. Independent of WoW, the "damage flash" technique -- the struck character's material
//     flashes solid white for a couple of frames -- is standard across engines (Unity and Unreal
//     hit-flash tutorials, indie sprite-effect packs, all found independently of each other) because
//     colour needs no reading and registers faster than a number. That is what drives the wolf's hit
//     flash in wolf.js: flash first, because it is the fastest-reading signal; the existing hp number
//     in the status line stays as a secondary, adult-legible readout.
//   - A blow landing on the PLAYER. A red glow at the screen EDGES ("damage vignette") on taking
//     damage is close to universal across genres -- found identically in reddit's r/gamedevscreens,
//     Minecraft damage-vignette mods, and HCI research on "embodied" first-person damage indicators,
//     none of which reference each other. It has to be noticed without looking at a HUD element in a
//     corner, which is exactly the gap this project had: hero-hurt previously produced no feedback of
//     any kind. #hero-hurt-flash in index.html is that convention.
//   - HEALTH, for a game aimed at young players. Zelda's row of hearts (Zelda Wiki's
//     "Health" page, Ocarina of Time's heart-container UI, Tears of the Kingdom's heart-container
//     articles) is discrete, countable icons, filled or not, rather than WoW's numeric/percentage
//     bar. WoW's own bar convention fits a large, continuously-changing health value; this game's
//     HERO_MAX_HP is a small fixed integer (3), which is exactly the shape hearts were built for, and
//     a filled-or-not icon reads without reading anything. Chosen over a bar for that reason.
//   - A MISS. WoW shows a grey "Miss"/"Dodge" over the target -- text, the exact thing a
//     young player will not read mid-fight. Fortnite's hit marker suggests the wordless
//     alternative: confirmation appears instantly at the point of the PLAYER'S OWN action (the
//     reticle), not on the target. This game has no reticle; the nearest equivalent is the ATTACK
//     button the child's thumb and eyes are already on when they tap it, so a miss pulses the button
//     instead of touching the wolf at all.
//
// Duration and colour numbers below are not from any reference -- references establish the
// convention, not the tuning. They were set by looking at tools/runtime-test/play-fight.mjs captures,
// per "Playtests are mandatory" in AGENTS.md, and may move if a future capture says they should.

/**
 * Every event type encounter.js can raise via drainEvents().
 *
 * Kept here, not retyped by hand inside main.js's handler table, so the two can be checked against
 * each other instead of trusted by eye. feedback.test.mjs reads encounter.js's own source and fails
 * if this list ever drifts from what it actually raises -- so a new event type cannot go unnoticed
 * the way hero-hurt previously did.
 */
export const ENCOUNTER_EVENT_TYPES = Object.freeze([
  'swing',
  'swing-missed',
  // Raised when the hero goes down with a swing already in flight. Added 2026-08-13, and this list
  // is how it announced itself: the source-scanning test failed the moment encounter.js started
  // raising it, which is precisely the drift the list exists to catch.
  'swing-dropped',
  'wolf-hit',
  'wolf-defeated',
  'hero-hurt',
  'bite-missed',
  'hero-down',
  'hero-respawned',
  // Beating a wolf gives every standing hero one heart back -- see healTheStanding in encounter.js
  // for why, and why it is a kill reward rather than a regeneration timer. Carries `remaining`, the
  // same shape hero-hurt does, so the hearts are re-rendered from the event rather than from a
  // separately-tracked number that could disagree with it.
  'hero-healed',
  // the owner's ruling, 2026-08-13: a dead wolf comes back after WOLF_RESPAWN_SECONDS. Party-shaped like
  // bite-missed -- nobody in particular caused it, so it never carries a heroId.
  'wolf-respawned',
]);

/**
 * Build an encounter event dispatcher from one callback per event type.
 *
 * Throws immediately if `callbacks` is missing an entry for any type encounter.js can raise, so a
 * new event lands as a loud failure at startup rather than a silently dropped one during a fight.
 * Pure: the callbacks are opaque functions supplied by the caller (main.js, where the DOM and
 * three.js actually live), so this factory itself never touches either and can be unit tested with
 * plain stand-in functions.
 */
export function createEncounterFeedback(callbacks) {
  const missing = ENCOUNTER_EVENT_TYPES.filter((type) => typeof callbacks[type] !== 'function');
  if (missing.length > 0) {
    throw new Error(`combat feedback is missing a handler for: ${missing.join(', ')}`);
  }
  return function onEncounterEvent(event) {
    const handler = callbacks[event.type];
    if (!handler) {
      // Defensive only -- the construction check above should make this unreachable for any event
      // encounter.js actually raises. Logging and continuing beats crashing the frame loop over a
      // feedback gap; a silent fight is a smaller failure than a frozen one.
      console.error(`[combat feedback] no handler for encounter event "${event.type}"`);
      return;
    }
    handler(event);
  };
}

/**
 * Filled/empty hearts for a hit-point total, lowest index first.
 *
 * Pure translation of an integer onto the heart convention above. Clamped at both ends so a caller
 * can pass a mid-frame hp of -1 or a post-respawn value without checking first -- the same
 * defensiveness swingPose() uses in character/swing.js for an out-of-range progress value.
 */
export function heartsForHp(hp, maxHp) {
  const filled = Math.max(0, Math.min(maxHp, Math.round(hp)));
  return Array.from({ length: maxHp }, (_, index) => index < filled);
}

/**
 * 1 at the instant of impact, fading linearly to 0 over `durationSeconds`, and 0 outside that window
 * (including for a negative or non-finite input, the same no-op-outside-range shape swingPose() uses).
 *
 * The one piece of maths every flash in this file shares. wolf.js drives its hit and defeat material
 * flash from this curve every frame, because three.js has no CSS transition to lean on the way the
 * DOM-side hero-hurt and miss-pulse effects in main.js do.
 */
export function flashIntensity(elapsedSeconds, durationSeconds) {
  if (!(durationSeconds > 0) || !(elapsedSeconds >= 0) || elapsedSeconds >= durationSeconds) return 0;
  return 1 - elapsedSeconds / durationSeconds;
}

// Quick: shorter than STAGGER_SECONDS (0.667s) in encounter.js, so the flash does not linger through
// the whole stagger pose -- it marks the instant of contact, not the reaction that follows it.
export const WOLF_HIT_FLASH_SECONDS = 0.18;

// Distinctly longer than the hit flash, so the finishing blow does not read as just another hit --
// see wolf-defeated in wolf.js. The death clip (DEATH_SECONDS 1.75s in encounter.js) supplies the
// rest of the distinction; this only needs to outlast a regular hit's flash, not the whole animation.
export const WOLF_DEFEAT_FLASH_SECONDS = 0.5;

// prefers-reduced-motion still needs the STATE change -- index.html's own reduced-motion rule zeroes
// a transition's duration rather than removing the state it transitions to -- so wolf.js reaches for
// this instead of skipping the flash outright. Two frames at 60fps: near-instant, not absent.
export const REDUCED_MOTION_FLASH_SECONDS = 2 / 60;
