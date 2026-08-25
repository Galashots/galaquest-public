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
//   - HEALTH, for a game aimed at young players. The original research here compared Zelda's row of
//     hearts (Zelda Wiki's "Health" page, Ocarina of Time's heart-container UI, Tears of the Kingdom's
//     heart-container articles) -- discrete, countable icons, filled or not -- against WoW's
//     numeric/percentage bar, and chose hearts, for a reason it stated precisely: "WoW's own bar
//     convention fits a large, continuously-changing health value; this game's HERO_MAX_HP is a small
//     fixed integer (3), which is exactly the shape hearts were built for".
//
//     THAT REASON EXPIRED, and the same research is what now selects the other answer. P2 makes every
//     Hero level grant max HP (docs/product/PROGRESSION_CONTRACT_V0.md, OWNER-LOCKED, which supersedes
//     the old four-heart ceiling in as many words), so HERO_MAX_HP is no longer small and no longer
//     fixed -- a Level-20 hero has 125 and a Level-1000 hero has 5,025. Drawing that as countable
//     icons is not a heart row, it is a wall of dots nobody designed. So the convention the reference
//     work already recorded for exactly this shape applies: a bar that visibly depletes, with the
//     number as backup rather than as the primary signal (wowinterface.com nameplate/unit-frame
//     screenshots, e.g. a boss health bar reading "311K (68%)"). The heart is KEPT as the icon beside
//     it, because what it says -- "this is your life" -- was never the part that stopped working.
//
//     This is GQ-002's sharper form and worth naming: the old paragraph was not a stale fact, it was
//     a superseded ARGUMENT, and a reader trusting it would have rebuilt the heart row.
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
/**
 * WHAT THE HEALTH READOUT SHOWS: a clamped current, a clamped max, and the fraction between them.
 *
 * Replaces heartsForHp, which returned one boolean per pip and was scoped to a body that could not
 * exceed four. The clamping is the part worth keeping and the part worth testing: main.js calls this
 * from a frame loop, so `hp` can legitimately arrive mid-reconciliation as a negative, as a value
 * above the max the caller has not caught up to yet, or as a fraction of a point -- and none of
 * those may become a bar that overflows its track or a number a child reads as "-3".
 *
 * `fraction` is the ONLY float here and it is presentation-only, exactly the split
 * progression/levels.js draws for its own `progress`: the two numbers a child actually reads are
 * exact integers, so nothing that has to be counted is ever read off a rounded value.
 *
 * A max below 1 is clamped to 1 rather than allowed to divide by zero: there is no legal body of
 * size zero (combat/encounter.js's reconcileMaxHp already refuses one), so this is guarding against
 * a caller with no state yet rather than against a real hero.
 */
export function healthReadout(hp, maxHp) {
  const max = Number.isFinite(maxHp) ? Math.max(1, Math.round(maxHp)) : 1;
  const current = Number.isFinite(hp) ? Math.max(0, Math.min(max, Math.round(hp))) : 0;
  return { current, max, fraction: current / max };
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
//
// GP1-C5 correction: duration alone did NOT carry that distinction, and the claim above was wrong on
// screen for as long as it has been written down. tools/runtime-test/play-fight.mjs's own baseline
// captures, looked at rather than described (.local/combat-baseline/): fight-wolf-hit-flash.png and
// fight-04-defeated.png are the same white shape. Both flashes lerp the same materials toward the
// same FLASH_COLOR, so a kill was a hit held longer -- and a still frame is exactly what a ten-year-
// old gets, because they are looking at the wolf for a quarter of a second, not timing it. The
// distinction now lives in COLOUR and in what the burst below does, and the duration is merely what
// keeps it on screen. See WOLF_DEFEAT_FLASH_COLOR in enemies/wolf.js.
export const WOLF_DEFEAT_FLASH_SECONDS = 0.5;

// ── impact bursts ────────────────────────────────────────────────────────────────────────────────
//
// GP1-C5. The white flash marks WHICH thing was hit; it cannot mark that a blow LANDED, because at
// the distance the fight is actually played (the baseline captures put the hero at roughly a tenth of
// frame height) a recoloured wolf is a small pale smudge among other small pale smudges. What reads
// at that size is a shape that was not there a frame ago and is bigger than the thing it happened to.
// So contact gets its own object in the world, at the contact point, for a fraction of a second.
//
// Reference research, per AGENTS.md "Look before you derive" -- three-plus independent examples
// before any number here was chosen. The expanding-ring-plus-flare impact is close to universal:
// Zelda: Breath of the Wild's hit sparks, Hades' hit "pops", and generic engine VFX tutorials for
// Unity/Unreal impact effects all resolve to the same two-part shape (a bright core at the contact
// point plus a ring that expands outward and fades), and none of the three cites the others. The
// ring is what survives being small: it moves OUTWARD, and motion away from a point is legible at
// sizes where colour and detail are not.
//
// The numbers themselves are not from the references -- references establish the convention, the
// captures set the tuning (same rule the flash durations above follow).

// A hit is a punch: small, fast, gone before the stagger pose finishes so it never competes with the
// wolf's own reaction. It ends larger than the wolf is wide (WOLF_SCALE puts the body near 1m) so the
// ring clearly leaves the body rather than sitting inside it.
export const HIT_BURST_SECONDS = 0.26;
export const HIT_BURST_START_METERS = 0.35;
export const HIT_BURST_END_METERS = 1.55;

// A kill is an event: bigger, slower, and it keeps expanding after the hit-sized ring would already
// be gone, so the two are told apart by the SHAPE of the motion and not only by its colour. This is
// the "stolen light leaving" made visible -- the light the wolf carried blows outward and is gone,
// which is why enemies/wolf.js tints the defeat flash with the spark's own warm colour rather than
// the hit's white.
export const KILL_BURST_SECONDS = 0.62;
export const KILL_BURST_START_METERS = 0.5;
export const KILL_BURST_END_METERS = 4.2;

/**
 * How wide the ring is at `elapsedSeconds`, in metres. Ease-out cubic: almost all of the growth
 * happens in the first third, which is what makes it read as something that BURST rather than
 * something that inflated. Clamps to `endMeters` past the end rather than running away, so a caller
 * that ticks one frame late gets the final size instead of a ring the size of the village.
 */
export function burstScaleMeters(elapsedSeconds, durationSeconds, startMeters, endMeters) {
  if (!(durationSeconds > 0) || !(elapsedSeconds > 0)) return startMeters;
  const t = Math.min(1, elapsedSeconds / durationSeconds);
  return startMeters + (endMeters - startMeters) * (1 - (1 - t) ** 3);
}

/**
 * How bright the ring is at `elapsedSeconds`, 1 down to 0. Quadratic rather than the linear
 * flashIntensity() above, on purpose: a linear fade spends half its life at half brightness, which
 * on an additive sprite reads as a lingering smear over the wolf. This holds near full for the first
 * moments -- the part a child's eye actually catches -- and then leaves quickly.
 *
 * Same defensive shape as flashIntensity(): 0 outside the window, including for negative or
 * non-finite input, so a caller need not check before asking.
 */
export function burstOpacity(elapsedSeconds, durationSeconds) {
  if (!(durationSeconds > 0) || !(elapsedSeconds >= 0) || elapsedSeconds >= durationSeconds) return 0;
  return (1 - elapsedSeconds / durationSeconds) ** 2;
}

// prefers-reduced-motion still needs the STATE change -- index.html's own reduced-motion rule zeroes
// a transition's duration rather than removing the state it transitions to -- so wolf.js reaches for
// this instead of skipping the flash outright. Two frames at 60fps: near-instant, not absent.
export const REDUCED_MOTION_FLASH_SECONDS = 2 / 60;
