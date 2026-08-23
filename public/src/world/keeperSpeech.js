// public/src/world/keeperSpeech.js
//
// W1: the game's first tap-to-hear speech line. PURE state->text mapping plus one small
// injectable-speak wrapper -- no three.js, no DOM read here (main.js owns the one place this ever
// meets a <span> and a real SpeechSynthesisUtterance, the same discipline rewards/hud.js's
// pipsForMarks and combat/feedback.js's heartsForHp already follow for their own HUD pieces).
//
// WRITTEN FOR a younger player, who is in the younger bracket. What shipped first was one 27-word sentence
// with an em dash, the word "wilderness", and the speaker's name eating the first line -- and it
// said exactly the same thing whether the child had killed no wolves or two. A quest-giver who
// cannot count your progress is a sign, not a character.
//
// The rules the lines below follow, so the next person writing one keeps them:
//   - one idea per sentence, and no sentence longer than about nine words;
//   - say the NUMBER LEFT, not the number needed, once the child has started ("two more", not
//     "three marks"); it is the question they are actually asking;
//   - never punctuate with an em dash or a semicolon, which a young player reads as a full stop
//     and then loses the thread of;
//   - always end the not-yet-finished lines with what to DO next;
//   - the speaker's name is NOT part of the line. index.html gives it its own row, so the line
//     itself is the sentence a child reads, and the read-aloud button does not spend its first
//     second saying "Keeper Aldric" every time.

export const KEEPER_NAME = 'Keeper Aldric';

// The wolves count DOWN in the text, so the child hears their own progress rather than the target.
export const KEEPER_LINE_QUEST =
  'Our Lantern Tree has gone dark. The wolves out there are carrying its light! '
  + 'Bring me three Lantern Marks.';

export const KEEPER_LINE_ONE_MARK =
  'One mark already! Well fought. Two more and the tree will shine again.';

export const KEEPER_LINE_TWO_MARKS =
  'Two marks! You are nearly there. Just one more wolf, hero.';

export const KEEPER_LINE_ALL_MARKS =
  'All three! Stand by the tree and hold them up. Let us wake it.';

// Ends by pointing somewhere. A finished quest whose giver only congratulates you is a dead end,
// and the road now runs north past the wolf to a lit gate at the treeline -- so he names it.
export const KEEPER_LINE_UNLOCKED =
  'You brought the light back! Wear it proudly, hero. Now follow the lit path north.';

// And once they HAVE followed it. Sending a child north a second time is a quest-giver who is not
// paying attention, which is the same defect the one-line-forever version had, just later.
// Deliberately does not promise a new quest tonight: it names the thing they can really do, which
// is the same thing the objective chip names once the gate is found.
export const KEEPER_LINE_GATE_FOUND =
  'You found the old gate! Something waits beyond it. Keep the wolves off our road until then.';

/**
 * The line for a hero's own quest progress. Four states before the tree is lit and one after, so
 * walking back to the Keeper mid-quest is worth doing.
 *
 * `marks` is the same count rewards/hud.js's pipsForMarks paints, off the same published rewards
 * object; `lanternUnlocked` still wins outright, because a hero whose lantern is lit has finished
 * whatever their mark total happens to read.
 */
export function keeperLineFor(lanternUnlocked, marks = 0, gateFound = false) {
  if (lanternUnlocked === true) {
    return gateFound === true ? KEEPER_LINE_GATE_FOUND : KEEPER_LINE_UNLOCKED;
  }
  const earned = Number.isFinite(marks) ? Math.max(0, Math.round(marks)) : 0;
  if (earned >= 3) return KEEPER_LINE_ALL_MARKS;
  if (earned === 2) return KEEPER_LINE_TWO_MARKS;
  if (earned === 1) return KEEPER_LINE_ONE_MARK;
  return KEEPER_LINE_QUEST;
}

/**
 * Proximity edge + line selection + show/hide, all in one pure read: same 2.0m radius the wave
 * uses (brief W1: "the same proximity the wave uses" -- callers pass zoneLoader.js's own
 * KEEPER_WAVE_RADIUS_METERS as radiusMeters rather than this module re-declaring its own copy).
 * Returns `{ visible: false, line: null }` outside the radius -- "hide the line when the hero
 * walks away" is this one branch, not a separate timer or DOM class toggled from main.js.
 */
export function keeperSpeechState({
  heroX, heroZ, keeperX, keeperZ, radiusMeters, lanternUnlocked, marks = 0, gateFound = false,
}) {
  const distance = Math.hypot(heroX - keeperX, heroZ - keeperZ);
  if (distance > radiusMeters) return { visible: false, line: null };
  return { visible: true, line: keeperLineFor(lanternUnlocked, marks, gateFound) };
}

/**
 * Reads the line aloud through an injectable `speak(text)` -- tests assert the HANDOFF (the right
 * text reached the function), never real audio (brief W1: "assert the utterance handoff through an
 * injectable speak function -- never assert real audio"). `speak` defaults to the real
 * speechSynthesis call, made from inside the button's own click handler so the tap itself is the
 * user gesture iOS requires -- no separate unlock step, unlike audio/engine.js's pointerdown-based
 * unlock() (that engine plays sound EFFECTS on a schedule the child does not control; this speaks
 * only in direct response to the tap that requested it).
 */
export function speakKeeperLine(line, speak = defaultSpeak) {
  if (!line) return false;
  unlocked = true;
  speak(line);
  return true;
}

/**
 * WHY A CHILD WHO CANNOT READ WAS BEING HANDED FOUR LINES OF TEXT.
 *
 * `speakKeeperLine` had exactly one caller: the click handler on the little speaker button in the
 * corner of the speech bubble. Nothing ever spoke on its own. So the whole of this game's narrative
 * -- the quest, the count of marks left, where to go next -- reached its stated audience only if a
 * pre-reader noticed a 44px grey circle and guessed what it was for. Every other route to that
 * information is a sentence.
 *
 * The obvious fix, speaking each line as it appears, does not work and cannot be made to: iOS will
 * not let `speechSynthesis` make a sound until it has been called once inside a real user gesture,
 * and a tablet is what this game is for. main.js says the same thing at the click handler, which is
 * why speak() runs directly in there rather than being deferred a frame.
 *
 * So: the FIRST line still needs the button, and every line after it speaks itself. One tap, ever,
 * and the game starts reading to you. The latch is what that tap bought -- both the platform's
 * permission and the child's own signal that they want to be read to -- so nothing here speaks to a
 * child who never asked, and nobody has to find the button twice.
 *
 * @returns whether it spoke, so a caller can tell "not yet unlocked" from "no line".
 */
export function speakKeeperLineIfUnlocked(line, speak = defaultSpeak) {
  if (!unlocked || !line) return false;
  speak(line);
  return true;
}

/** Whether a real tap has unlocked read-aloud yet. Exported for a harness to read, and reset for
 *  tests -- module state that only a test can clear is module state nobody can test around. */
export function readAloudUnlocked() {
  return unlocked;
}

export function resetReadAloudForTests() {
  unlocked = false;
}

let unlocked = false;

function defaultSpeak(text) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  // CANCEL FIRST. Without it a child walking between two speakers, or tapping the button twice,
  // queues utterances and then listens to the stale one finish before the current one starts. The
  // line on screen and the line being read have to be the same line.
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}
