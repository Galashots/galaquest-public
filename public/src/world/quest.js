// public/src/world/quest.js
//
// What the player is supposed to be doing, in four words, always on screen. PURE: one function from
// published reward state to a line of text (or null). main.js is the only place it meets a <div>.
//
// This exists because of a hole found by playing the sequence rather than reading it. The Keeper
// gives the quest, and then the child walks away from him and there is NOTHING anywhere that says
// what they are doing. The three pips under the hearts are a score, not an instruction: they say
// "one of three" and never say one of three WHAT. And the worst moment is the best one -- earning
// the third mark fires a three-second banner out at the wolf spawn, eighteen metres from the tree,
// and then the screen goes back to saying nothing at all while the child stands in the wilderness
// holding a finished quest.
//
// Rules for the text, the same ones keeperSpeech.js follows: four or five words, an emoji as the
// leading symbol so it reads before it is read (AGENTS.md's own "signs using symbols rather than
// lots of text"), and always a VERB.

import { MARKS_TO_UNLOCK } from '../rewards/marks.js';

/**
 * An objective is a THING WITH A NAME, not a sentence.
 *
 * CP2's keystone. Checkpoint 0's finding was that nothing in the game can answer "where is the
 * current objective?" -- objectives were strings, and a string has no place. The obvious fix is a
 * second module that re-derives the same branch and returns a coordinate, checked against this one
 * by a paired test. That is GQ-011 almost verbatim: two simulations of one decision, with a test as
 * the mitigation rather than the design. It is also the exact set-up GQ-015 describes -- a
 * comparison of two hand-maintained branches passes for as long as somebody keeps both edited, and
 * the day it stops is the day nobody notices.
 *
 * So the branch below stays the single decision and an objective carries an `id` alongside its
 * words. world/destinations.js answers `id -> coordinate`. The arrow and the words then come from
 * the same choice and CANNOT disagree, rather than being checked for agreement afterwards.
 *
 * INTERNED, and that is load-bearing rather than an optimisation: these are value objects, and
 * callers -- including every test in this repo -- compare objectives with `===`. Two calls that mean
 * the same objective must be the same object or equality silently stops working. `toString` is here
 * for the same reason: an objective interpolated into a template still reads as its own words.
 */
function objective(id, text) {
  return Object.freeze({ id, text, toString: () => text });
}

// THE FIRST OBJECTIVE, and the reason it exists: the chip used to read "3 more Lantern Marks" on
// the very first frame, before the child had met anybody. The game announced the quest and then the
// quest-giver announced it again, which makes the old man decoration -- a child who already knows
// what to do has no reason to walk over and find out. Now the chip points AT him first, and hunting
// marks is something he tells you.
export const OBJECTIVE_MEET_THE_KEEPER = objective('meet-the-keeper', '💬 Talk to Keeper Aldric');

// NAMES THE DESTINATION. This read "Take the light home", which is the one step of the quest where
// a child has to walk to a specific place eighteen metres away and nothing on screen said where --
// "home" is a word an adult reads as "the tree" and a young player reads as "somewhere". The
// Keeper's own line for this state already says "stand by the tree"; now the chip agrees with him.
export const OBJECTIVE_LIGHT_THE_TREE = objective('light-the-tree', '🏮 Light the Lantern Tree');
// Where the finished quest points. The relight's last two lanterns stand at the north treeline, so
// once the tree is burning there is a lit way out of the village and the quest log names it rather
// than going blank.
export const OBJECTIVE_FIND_THE_GATE = objective('find-the-gate', '🌲 Follow the lit path north');

// AND THEN WHAT. Finding the gate used to blank the chip, which is what a finished quest looks like
// from the inside and what a dead end looks like to a child: no hearts to earn, nothing named, no
// reason to be anywhere.
//
// It then said "Keep the wolves away" for a while, which was honest and was still a dead end -- it
// is a thing you can do forever and it never becomes anything. Chapter 2 is what it becomes. Past
// the gate the trail is dark and the old lights along it are out; the lantern earned in Chapter 1 is
// what wakes them. So the chip points UP THE TRAIL the moment a child walks under the arch.
export const OBJECTIVE_FOLLOW_THE_DARK_TRAIL = objective('follow-the-dark-trail', '🌑 Follow the dark trail');
// COUNTS DOWN, the same way objectiveFindMarks does and for the same reason -- "two more" is the
// question a child is actually asking. Named "lights" and not "markers" or "lanterns": it is the
// word they will use for them.
const objectiveWakeLightsCache = new Map();
export function objectiveWakeLights(remaining) {
  // Interned per count, for the reason objective() gives: callers compare with `===`,
  // and a factory handing back a fresh object each call would break every one of them.
  // The cache is bounded by how many of the thing there are, which is a handful.
  if (!objectiveWakeLightsCache.has(remaining)) {
    const text = remaining === 1 ? '🏮 1 more dark light' : `🏮 ${remaining} more dark lights`;
    objectiveWakeLightsCache.set(remaining, objective('wake-lights', text));
  }
  return objectiveWakeLightsCache.get(remaining);
}
// A sword can be used on the WORLD. This is the only line in the game that says so, and it has to
// carry the whole idea, so it is the verb and the thing and nothing else -- a child who reads
// "cut" while holding a sword in front of a black tangle has the entire instruction.
export const OBJECTIVE_CUT_THE_BRAMBLE = objective('cut-the-bramble', '🗡️ Cut the black bramble');
// The end of the built trail. There is more Wildwood coming and this must not pretend otherwise, so
// it names the mystery rather than declaring the game finished.
export const OBJECTIVE_THE_CAMP = objective('the-camp', '❓ Who left this camp?');
// ROWAN ANSWERS THE MYSTERY. The camp used to ask a question and never answer it -- a dead end with
// a fresh coat of paint on it. Now Rowan tells the story and hands the child something physical to
// do, which is what turns "who left this camp?" from a mood into a beat.
export const OBJECTIVE_SEARCH_THE_CART = objective('search-the-cart', '🔎 Search the broken cart');
// AFTER THE CART. This used to read "🏕️ Guard the camp for Rowan", and the comment above it said,
// honestly, that the world did not extend past the camp so the chip must not promise the Beacon.
// That was true and it was still a dead end: guarding is not a verb this game implements, so the
// last thing a finished child was told to do was nothing at all, in a frame with nothing in it.
//
// G1 built the road, so the chip can now say where it goes. NAMES THE DESTINATION, for the same
// reason OBJECTIVE_LIGHT_THE_TREE had to stop saying "home": "the old Beacon" is a thing Rowan has
// already said out loud and a thing a child can now see from where they are standing.
export const OBJECTIVE_FIND_THE_BEACON = objective('find-the-beacon', '🗼 Find the old Beacon');
// AND THE HONEST END OF G1. The child has arrived; nothing here can be lit, repaired or fought yet,
// and the chip must not say otherwise -- "the game promised somewhere it could not walk to" is a
// defect this project has shipped once already and is not going to ship as "the game promised a
// thing it could not do".
//
// So it asks rather than instructs, which is the same shape OBJECTIVE_THE_CAMP uses and for the same
// reason: a question is the one form of objective that is still true when the answer is not built.
// It uses ROWAN'S OWN WORD -- they say the Beacon "has gone cold", and the chip agreeing with the
// person who sent you is what makes it read as the story continuing rather than as the game shrugging.
export const OBJECTIVE_BEACON_IS_COLD = objective('beacon-is-cold', '❄️ Why is the Beacon cold?');
// ── G2/G3/G4: THE BEACON ANSWERS ────────────────────────────────────────────────────────────────
//
// G1 shipped a question, on the honest grounds that a question is the one form of objective still
// true when the answer is not built. The answer is built now, so the chip stops asking and starts
// instructing -- and OBJECTIVE_BEACON_IS_COLD above is deliberately KEPT rather than deleted: it is
// still what a child sees in the gap between arriving and getting close enough to see the seals,
// which is a real second or two of standing there wondering.
//
// COUNTS DOWN THE SAME WAY objectiveWakeLights AND objectiveFindMarks DO, for the third time and the
// same reason: "one more" is the question a child is actually asking, and it turns three identical
// objects into a target. The verb is the one they are already holding -- they have been cutting
// bramble with it since Chapter 2 -- so nothing here has to teach a new word.
const objectiveBreakSealsCache = new Map();
export function objectiveBreakSeals(remaining) {
  // Interned per count, for the reason objective() gives: callers compare with `===`,
  // and a factory handing back a fresh object each call would break every one of them.
  // The cache is bounded by how many of the thing there are, which is a handful.
  if (!objectiveBreakSealsCache.has(remaining)) {
    const text = remaining === 1 ? '🗡️ 1 more cold seal' : `🗡️ ${remaining} cold seals left`;
    objectiveBreakSealsCache.set(remaining, objective('break-seals', text));
  }
  return objectiveBreakSealsCache.get(remaining);
}
// THE "UH OH" BEAT, and it is deliberately not an instruction. Between the third seal bursting and
// the Warden finishing standing up there is a beat where the game must not say "fight the Warden" --
// the child has not seen it yet, and naming a thing before it exists on screen is the same defect as
// promising a place you cannot walk to. So this says only that something happened, in the fewest
// words that carry dread.
export const OBJECTIVE_SOMETHING_ANSWERED = objective('something-answered', '⚠️ Something answered');
// AND NOW IT IS ON SCREEN, so it can be named. This is the only objective in the game that names an
// enemy, because it is the only enemy in the game with a name.
export const OBJECTIVE_FIGHT_THE_WARDEN = objective('fight-the-warden', '🗡️ Beat the Beacon Warden');
// THE PAYOFF POINTS HOME. Rowan's own promise ("Wake the Beacon. This Wildwood Blade is yours.") is
// the oldest unkept promise in the game; the moment the Beacon is lit, the chip goes and collects
// on it. NAMES THE PERSON, not "go back" -- the same rule OBJECTIVE_LIGHT_THE_TREE follows.
export const OBJECTIVE_RETURN_TO_ROWAN = objective('return-to-rowan', '🏕️ Return to Rowan');
// G5. Only ever shown to a child who actually OWNS the Blade, because it is the only objective in
// the game that is impossible with the wrong weapon in your hand -- and a chip telling a child to do
// something their sword cannot do is the game lying to them.
export const OBJECTIVE_CUT_THE_BLACKTHORN = objective('cut-the-blackthorn', '🌿 Cut the blackthorn open');
// THE END OF THE ARC, and it points at the one thing left in it rather than going blank -- the same
// dead-end rule this whole file is written from. It stops being shown once they are inside.
export const OBJECTIVE_SEARCH_THE_HOLLOW = objective('search-the-hollow', '🔦 Search the hollow');
// ARC 2. Names the DESTINATION, the same rule OBJECTIVE_FIND_THE_BEACON follows and for the same
// reason: "the old road" is a thing a child can now see under their feet, running east out of the
// Beacon's clearing, and the Lodge at the end of it is a thing Wren has already talked about. It is
// safe to say only because the road exists -- world/zones/village.js grew the world east in the same
// change that added this line, which is the whole of the discipline this file keeps: never promise a
// place a child cannot walk to.
export const OBJECTIVE_FIND_THE_LODGE = objective('find-the-lodge', '🏚️ Follow the old road east');

// The fallback for a zone with no trail at all. It is honest and it is a verb -- wolves really do
// keep coming back on their patrol -- and it is what the village said between the gate landing and
// the Dark Trail landing. Kept so that a zone which places no dormant lights still says something.
export const OBJECTIVE_KEEP_THE_VILLAGE_SAFE = objective('keep-the-village-safe', '🐺 Keep the wolves away');

/** The hunting objective COUNTS DOWN, for the same reason the Keeper's lines do: "two more" is the
 *  question a child is actually asking, and it turns the three pips from a score into a target. */
const objectiveFindMarksCache = new Map();
export function objectiveFindMarks(remaining) {
  // Interned per count, for the reason objective() gives: callers compare with `===`,
  // and a factory handing back a fresh object each call would break every one of them.
  // The cache is bounded by how many of the thing there are, which is a handful.
  if (!objectiveFindMarksCache.has(remaining)) {
    const text = remaining === 1 ? '🐺 1 more Lantern Mark' : `🐺 ${remaining} more Lantern Marks`;
    objectiveFindMarksCache.set(remaining, objective('find-marks', text));
  }
  return objectiveFindMarksCache.get(remaining);
}

/**
 * WHAT THE BEACON IS ASKING OF YOU RIGHT NOW -- the whole G2..G5 arc as one ordered read, split out
 * of questObjectiveFor's own branch so the arc's ordering can be tested (and argued about) on its
 * own rather than through five arguments of trail state it does not care about.
 *
 * ORDERED BACKWARDS, newest beat first, which is the same shape the camp branch above already uses
 * and for the same reason: every one of these states is a LATCH, so a child who has got further must
 * never be sent back to be told about a thing they finished. Read top to bottom, this is the arc:
 * the hollow, the blackthorn, the walk home for the Blade, the fight, the answer, the seals -- and
 * G1's own unanswered question underneath all of it as the floor.
 *
 * @param siege `{ sealsLeft, wardenMode, beaconLit, bladeOwned, blackthornTorn, hollowFound }`,
 *              or null before any of it is known (a zone with no seals placed).
 */
export function beaconObjectiveFor(siege) {
  // NOTHING LEFT TO SAY, once they have walked the whole of it. The same rule as ever: the chip goes
  // quiet rather than inventing a chore.
  if (siege?.lodgeFound === true) return null;
  // ...but until then it names the one place left. This branch could not exist until Arc 2 built the
  // road east: the hollow used to BE the end of the world in that direction, so the chip went silent
  // there and the next desire was carried entirely by a marker stone the child could see. The stone
  // now points somewhere they can actually walk, and a chip that stayed quiet would be the game
  // knowing about a place and declining to mention it.
  //
  // Gated on having been in the hollow rather than on owning the Blade: the road east is real ground,
  // and a child who got past the tangle without cutting it has still found the road.
  if (siege?.hollowFound === true) return OBJECTIVE_FIND_THE_LODGE;
  if (siege?.blackthornTorn === true) return OBJECTIVE_SEARCH_THE_HOLLOW;
  // ONLY WITH THE BLADE. See OBJECTIVE_CUT_THE_BLACKTHORN's own comment: a child holding the starter
  // sword is not told to do a thing the starter sword cannot do. Before they own it, the chip is
  // still pointing them at Rowan, which is where the Blade actually comes from.
  if (siege?.bladeOwned === true) return OBJECTIVE_CUT_THE_BLACKTHORN;
  const mode = siege?.wardenMode;
  // LET THE VICTORY BREATHE. `beaconLit` latches on the FINISHING BLOW, but the Warden then spends
  // 2.6 s falling and the Beacon takes 2.4 s to catch -- so checking the flag before the mode sent
  // the child off to Rowan while the boss was still collapsing in front of them and the fire had not
  // yet taken. The biggest moment in the game, interrupted by an errand.
  //
  // So the errand waits for the body to finish falling. 'dying' holds the dread beat; only once the
  // Warden is actually gone does the chip turn the child around and point them home.
  if (siege?.beaconLit === true) return mode === 'dying' ? OBJECTIVE_SOMETHING_ANSWERED : OBJECTIVE_RETURN_TO_ROWAN;
  // 'waking' is the one beat that must NOT name the Warden -- it is still standing up and a child
  // who has not seen it yet cannot be told to beat it. Every mode after that is a fight in progress.
  if (mode === 'waking') return OBJECTIVE_SOMETHING_ANSWERED;
  if (mode != null && mode !== 'dormant' && mode !== 'dead') return OBJECTIVE_FIGHT_THE_WARDEN;
  // 'dead' with the Beacon somehow NOT lit is not a state the rules can produce (the ignition
  // latches in the same step as the defeat), but a client mirroring a snapshot can observe the two
  // fields a frame apart. Holding the dread beat is the honest answer for that frame.
  if (mode === 'dead') return OBJECTIVE_SOMETHING_ANSWERED;
  const sealsLeft = siege?.sealsLeft;
  if (Number.isFinite(sealsLeft) && sealsLeft > 0) return objectiveBreakSeals(sealsLeft);
  // G1's own ending, kept: before a child is close enough for the seals to have been noticed at all
  // (and for any zone that places none), the Beacon is still just cold and the chip still just asks.
  return OBJECTIVE_BEACON_IS_COLD;
}

/**
 * @param rewards      the published `{ marks, lanternUnlocked }` for this hero, or null/undefined
 *                     before the server has said (in which case there is nothing to instruct yet)
 * @param treeLit      whether the Lantern Tree is already burning
 * @param gateFound    whether this player has already walked to the Wildwood Gate
 * @param questGiven   whether the Keeper has actually said his piece to this player yet
 * @param trail        `{ lights, lit, campFound, atBramble, rowanMet, cartSearched, beaconFound }`
 *                     -- how many trail lights exist, how many this player has woken, and which of
 *                     Chapter 2's places and beats they have reached: the camp, a standing bramble,
 *                     Rowan, the cart, and the Old Beacon at the end of the road. Optional and
 *                     defaulted, so every existing caller and test keeps the pre-Chapter-2 answers.
 * @param siege        the Beacon arc's own state, `{ sealsLeft, wardenMode, beaconLit, bladeOwned,
 *                     blackthornTorn, hollowFound }`. Optional and defaulted to null for the same
 *                     reason `trail` is: every pre-G2 caller and test keeps the answers it had, and
 *                     a zone that places no seals at all still ends on G1's honest question.
 * @returns the objective line, or null when there is nothing to show
 *
 * Keyed on `treeLit` and not on `lanternUnlocked` for the finished case, because between earning the
 * third mark and walking home those two disagree on purpose -- and the whole point of the second
 * objective is that window.
 */
export function questObjectiveFor(
  rewards, treeLit, gateFound = false, questGiven = true, trail = null, siege = null,
) {
  if (rewards == null) return null;
  if (treeLit === true) {
    // ARRIVING BEATS COLLECTING. A child who reaches the camp having missed a lamp on the way is
    // finished with this stretch of trail, and being sent back for one they walked past would be
    // the game arguing with them about something it never asked for.
    // THE BRAMBLE INTERRUPTS EVERYTHING, because it is the only thing on the trail a child could be
    // stuck at. Standing in front of a black tangle while the chip says "3 more dark lights" is the
    // game pointing past the problem; it takes the chip only while the tangle is actually there, and
    // hands it straight back the moment it falls.
    if (trail?.atBramble === true) return OBJECTIVE_CUT_THE_BRAMBLE;
    // ARRIVING BEATS COLLECTING, one more time and OUTSIDE the camp branch: a child who has stood at
    // the Old Beacon has done something bigger than anything the trail can still ask of them. The
    // same rule the bramble interrupt and the missed-lamp case above are both written from.
    //
    // Outside, because campFound is a 4.5 m radius and the road only passes 2.5 m from its centre.
    // Walking wide around the clearing and straight on up the road reaches the Beacon with campFound
    // still false -- and this check living INSIDE the branch let that fall all the way through to the
    // lamp counter, so the game told a child who had just found a dead Beacon to go and light lamps.
    // rowanSpeech.js already gives beaconFound unconditional top priority; this now agrees with it.
    //
    // (Found independently by the review of the G1 merge and by this branch's own G2 work, which is
    // a fair sign it was real. The hoist is that review's; what it delegates to is this branch's --
    // G1's single honest question has become the whole Beacon arc, so the answer moved into
    // beaconObjectiveFor and OBJECTIVE_BEACON_IS_COLD is now that function's own floor.)
    if (trail?.beaconFound === true) return beaconObjectiveFor(siege);
    if (trail?.campFound === true) {
      // ROWAN, THEN THE CART, THEN THE ROAD NORTH -- each only claims the chip once its own
      // precondition is real, so a camp with no Rowan spoken to yet still asks the mystery.
      if (trail?.rowanMet !== true) return OBJECTIVE_THE_CAMP;
      if (trail?.cartSearched !== true) return OBJECTIVE_SEARCH_THE_CART;
      return OBJECTIVE_FIND_THE_BEACON;
    }
    // ...AND THE GATE IS SUBJECT TO THE SAME RULE, which is where the beaconFound hoist above was
    // still incomplete: gateFound latches on a radius around the arch, and the road does not force
    // a child through it. Walking wide of the arch and straight up the trail reaches the camp, the
    // cart, and the Beacon itself with gateFound still false -- and with this check sitting above
    // every deeper beat, the chip read "Follow the lit path north" through all of them (measured
    // hosted at 9df59da: drive-old-beacon's portrait hero searched the cart and latched the Beacon
    // arrival with the chip still pointing at the gate the whole run). A place a child is standing
    // PAST is a place they can never be sent back to, so the gate claims the chip only from a
    // child who has reached nothing beyond it.
    if (gateFound !== true) return OBJECTIVE_FIND_THE_GATE;
    const lights = trail?.lights ?? 0;
    if (lights <= 0) return OBJECTIVE_KEEP_THE_VILLAGE_SAFE;
    const lit = Math.max(0, Math.min(lights, trail?.lit ?? 0));
    // Before the first one wakes, the chip cannot count down to a thing a child has not yet seen
    // happen -- "5 more dark lights" means nothing until one has lit. Name the direction first.
    return lit === 0 ? OBJECTIVE_FOLLOW_THE_DARK_TRAIL : objectiveWakeLights(Math.max(1, lights - lit));
  }
  if (rewards.lanternUnlocked === true) return OBJECTIVE_LIGHT_THE_TREE;
  const marks = Number.isFinite(rewards.marks) ? Math.max(0, Math.round(rewards.marks)) : 0;
  // Any progress at all IS the quest, whoever gave it -- a child returning tomorrow with two marks
  // must not be sent back to the old man to be told something they have already half done.
  if (questGiven !== true && marks === 0) return OBJECTIVE_MEET_THE_KEEPER;
  return objectiveFindMarks(Math.max(1, MARKS_TO_UNLOCK - marks));
}
