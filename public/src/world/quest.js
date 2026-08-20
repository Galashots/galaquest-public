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

// THE FIRST OBJECTIVE, and the reason it exists: the chip used to read "3 more Lantern Marks" on
// the very first frame, before the child had met anybody. The game announced the quest and then the
// quest-giver announced it again, which makes the old man decoration -- a child who already knows
// what to do has no reason to walk over and find out. Now the chip points AT him first, and hunting
// marks is something he tells you.
export const OBJECTIVE_MEET_THE_KEEPER = '💬 Talk to Keeper Aldric';

// NAMES THE DESTINATION. This read "Take the light home", which is the one step of the quest where
// a child has to walk to a specific place eighteen metres away and nothing on screen said where --
// "home" is a word an adult reads as "the tree" and a young player reads as "somewhere". The
// Keeper's own line for this state already says "stand by the tree"; now the chip agrees with him.
export const OBJECTIVE_LIGHT_THE_TREE = '🏮 Light the Lantern Tree';
// Where the finished quest points. The relight's last two lanterns stand at the north treeline, so
// once the tree is burning there is a lit way out of the village and the quest log names it rather
// than going blank.
export const OBJECTIVE_FIND_THE_GATE = '🌲 Follow the lit path north';

// AND THEN WHAT. Finding the gate used to blank the chip, which is what a finished quest looks like
// from the inside and what a dead end looks like to a child: no hearts to earn, nothing named, no
// reason to be anywhere.
//
// It then said "Keep the wolves away" for a while, which was honest and was still a dead end -- it
// is a thing you can do forever and it never becomes anything. Chapter 2 is what it becomes. Past
// the gate the trail is dark and the old lights along it are out; the lantern earned in Chapter 1 is
// what wakes them. So the chip points UP THE TRAIL the moment a child walks under the arch.
export const OBJECTIVE_FOLLOW_THE_DARK_TRAIL = '🌑 Follow the dark trail';
// COUNTS DOWN, the same way objectiveFindMarks does and for the same reason -- "two more" is the
// question a child is actually asking. Named "lights" and not "markers" or "lanterns": it is the
// word they will use for them.
export function objectiveWakeLights(remaining) {
  return remaining === 1 ? '🏮 1 more dark light' : `🏮 ${remaining} more dark lights`;
}
// A sword can be used on the WORLD. This is the only line in the game that says so, and it has to
// carry the whole idea, so it is the verb and the thing and nothing else -- a child who reads
// "cut" while holding a sword in front of a black tangle has the entire instruction.
export const OBJECTIVE_CUT_THE_BRAMBLE = '🗡️ Cut the black bramble';
// The end of the built trail. There is more Wildwood coming and this must not pretend otherwise, so
// it names the mystery rather than declaring the game finished.
export const OBJECTIVE_THE_CAMP = '❓ Who left this camp?';
// ROWAN ANSWERS THE MYSTERY. The camp used to ask a question and never answer it -- a dead end with
// a fresh coat of paint on it. Now Rowan tells the story and hands the child something physical to
// do, which is what turns "who left this camp?" from a mood into a beat.
export const OBJECTIVE_SEARCH_THE_CART = '🔎 Search the broken cart';
// AFTER THE CART. This used to read "🏕️ Guard the camp for Rowan", and the comment above it said,
// honestly, that the world did not extend past the camp so the chip must not promise the Beacon.
// That was true and it was still a dead end: guarding is not a verb this game implements, so the
// last thing a finished child was told to do was nothing at all, in a frame with nothing in it.
//
// G1 built the road, so the chip can now say where it goes. NAMES THE DESTINATION, for the same
// reason OBJECTIVE_LIGHT_THE_TREE had to stop saying "home": "the old Beacon" is a thing Rowan has
// already said out loud and a thing a child can now see from where they are standing.
export const OBJECTIVE_FIND_THE_BEACON = '🗼 Find the old Beacon';
// AND THE HONEST END OF G1. The child has arrived; nothing here can be lit, repaired or fought yet,
// and the chip must not say otherwise -- "the game promised somewhere it could not walk to" is a
// defect this project has shipped once already and is not going to ship as "the game promised a
// thing it could not do".
//
// So it asks rather than instructs, which is the same shape OBJECTIVE_THE_CAMP uses and for the same
// reason: a question is the one form of objective that is still true when the answer is not built.
// It uses ROWAN'S OWN WORD -- they say the Beacon "has gone cold", and the chip agreeing with the
// person who sent you is what makes it read as the story continuing rather than as the game shrugging.
export const OBJECTIVE_BEACON_IS_COLD = '❄️ Why is the Beacon cold?';
// The fallback for a zone with no trail at all. It is honest and it is a verb -- wolves really do
// keep coming back on their patrol -- and it is what the village said between the gate landing and
// the Dark Trail landing. Kept so that a zone which places no dormant lights still says something.
export const OBJECTIVE_KEEP_THE_VILLAGE_SAFE = '🐺 Keep the wolves away';

/** The hunting objective COUNTS DOWN, for the same reason the Keeper's lines do: "two more" is the
 *  question a child is actually asking, and it turns the three pips from a score into a target. */
export function objectiveFindMarks(remaining) {
  return remaining === 1 ? '🐺 1 more Lantern Mark' : `🐺 ${remaining} more Lantern Marks`;
}

/**
 * @param rewards      the published `{ marks, lanternUnlocked }` for this hero, or null/undefined
 *                     before the server has said (in which case there is nothing to instruct yet)
 * @param treeLit      whether the Lantern Tree is already burning
 * @param gateFound    whether this player has already walked to the Wildwood Gate
 * @param questGiven   whether the Keeper has actually said his piece to this player yet
 * @param trail        `{ lights, lit, campFound, rowanMet, cartSearched, atBramble, beaconFound }`
 *                     -- how many trail lights exist, how many this
 *                     player has woken, and whether they have reached the camp. Optional and
 *                     defaulted, so every existing caller and test keeps the pre-Chapter-2 answers.
 * @returns the objective line, or null when there is nothing to show
 *
 * Keyed on `treeLit` and not on `lanternUnlocked` for the finished case, because between earning the
 * third mark and walking home those two disagree on purpose -- and the whole point of the second
 * objective is that window.
 */
export function questObjectiveFor(rewards, treeLit, gateFound = false, questGiven = true, trail = null) {
  if (rewards == null) return null;
  if (treeLit === true) {
    if (gateFound !== true) return OBJECTIVE_FIND_THE_GATE;
    // ARRIVING BEATS COLLECTING. A child who reaches the camp having missed a lamp on the way is
    // finished with this stretch of trail, and being sent back for one they walked past would be
    // the game arguing with them about something it never asked for.
    // THE BRAMBLE INTERRUPTS EVERYTHING, because it is the only thing on the trail a child could be
    // stuck at. Standing in front of a black tangle while the chip says "3 more dark lights" is the
    // game pointing past the problem; it takes the chip only while the tangle is actually there, and
    // hands it straight back the moment it falls.
    if (trail?.atBramble === true) return OBJECTIVE_CUT_THE_BRAMBLE;
    if (trail?.campFound === true) {
      // ARRIVING BEATS COLLECTING, one more time and at the top of the branch: a child who has stood
      // at the Old Beacon has done something bigger than anything the camp can still ask of them, and
      // sending them back down the road to be introduced to Rowan would be the game arguing with them
      // about a thing it never made them do. The same rule the bramble interrupt and the missed-lamp
      // case above are both written from.
      if (trail?.beaconFound === true) return OBJECTIVE_BEACON_IS_COLD;
      // ROWAN, THEN THE CART, THEN THE ROAD NORTH -- each only claims the chip once its own
      // precondition is real, so a camp with no Rowan spoken to yet still asks the mystery.
      if (trail?.rowanMet !== true) return OBJECTIVE_THE_CAMP;
      if (trail?.cartSearched !== true) return OBJECTIVE_SEARCH_THE_CART;
      return OBJECTIVE_FIND_THE_BEACON;
    }
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
