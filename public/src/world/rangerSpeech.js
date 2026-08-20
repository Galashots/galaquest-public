// public/src/world/rangerSpeech.js
//
// WREN'S LINES. Same split rowanSpeech.js and keeperSpeech.js already make: a PURE state -> text
// mapping with no three.js and no DOM, so what an NPC says can be argued about and tested without a
// browser.
//
// ── WHY SHE EXISTS ──────────────────────────────────────────────────────────────────────────────
//
// Three things in the finished Beacon arc point at a fourth that was never built:
//
//   1. village/boardScreen.js wakes a 'ranger-lodge' node the moment the Beacon is lit, and the only
//      thing it can say is "They saw the Beacon light. Someone is coming."
//   2. world/blackthornHollow.js puts a FALLEN RANGER'S SATCHEL on the ground beside a marker stone
//      and refuses to explain it. Its own comment calls that "the cheapest desire a game can
//      manufacture" and it is right.
//   3. The Beacon is a signal fire. A child spends a whole chapter lighting it and nobody ever
//      answers it. A signal nobody sees is not a signal, it is a bonfire.
//
// So somebody sees it. Wren walks into the village because the fire was lit, which makes the payoff
// of the entire Beacon arc a PERSON rather than a flag -- the world reacting in the one way a child
// reads without being told.
//
// ── AND WHAT SHE MUST NOT DO ────────────────────────────────────────────────────────────────────
//
// She must not send a child anywhere they cannot walk. That is the defect this project has shipped
// three times (world/oldBeacon.js's own header counts them) and the reason the marker stone in the
// hollow carries no chip and no banner. The Lodge is NOT built. So Wren names it exactly the way
// ROWAN_LINE_INTRO names the Beacon before the road existed -- as a REASON, in the past tense, for
// where she has been and who she is looking for -- and the closing line replaces "come with me" with
// something that is simply true today.
//
// That closing line is also the one piece of retroactive world-building in the file, and it is free:
// what she says has no name has been pushing the wolves down onto the village. Chapter 1 is the
// first thing a child ever does here and it has never had a reason. Now it has one, and the reason
// arrived from outside, which is how a world stops feeling like a list of chapters.
//
// Written to the rules keeperSpeech.js documents: short sentences, no em dash, no semicolon, and the
// speaker's name kept out of the line itself.

export const RANGER_NAME = 'Wren';

// ARRIVAL. She answers the signal, says what a ranger is, and names the person she is missing -- and
// she asks the child for nothing at all. There is nothing to ask for yet: the satchel is lying in a
// hollow that may not even be open. A quest-giver whose first line is a chore is a quest-giver; a
// stranger who tells you what she lost is a person, and a child who has already SEEN that satchel
// puts this together themselves. That assembly is the whole beat, and it only works unassembled.
export const RANGER_LINE_INTRO =
  'I saw the Beacon burn from a long way off. '
  + 'Nobody has lit that in my lifetime. '
  + 'So I came to find out who did. '
  + 'I am a ranger. We hunt what comes out of the deep wood. '
  + 'My brother went out weeks ago and he has not come back.';

// RECOGNITION, and it lands BEFORE any thanks -- the same ordering rule ROWAN_LINE_BEACON_LIT
// follows for the same reason. Someone who leads with gratitude has not noticed what they are
// looking at. She interrupts herself, which is what people do.
//
// Shown only to a child actually carrying the satchel, so it can never fire as a guess.
export const RANGER_LINE_SATCHEL_FOUND =
  'Wait. '
  + 'That strap. Let me see it. '
  + 'Where did you find that.';

// THE ANSWER, THE REWARD, AND THE NEXT DESIRE, in that order and in three sentences each.
//
// She does not say he is dead and she does not say he is alive, because she does not know and this
// game does not lie to children in either direction. What she says is where he GOT TO, which is a
// fact, and that it is further than she managed, which is the sentence that makes her a person
// rather than a quest node.
//
// The charm is the first reward in this game that is neither a weapon nor a number on a screen:
// it is a fourth heart, and a fourth heart is felt in every fight a child has ever had here. See
// docs/MISTAKES.md GQ-013 for why the reward had to be something the RULES read rather than
// something the UI announces.
//
// And then the closing pair, which promises nothing and explains everything.
export const RANGER_LINE_SATCHEL_GIVEN =
  'This was his. '
  + 'He got as far as the blackthorn. That is further than I did. '
  + 'Take this. A ranger charm. It will keep you on your feet. '
  + 'There is something out there we have no name for. '
  + 'It has been pushing the wolves down onto your village.';

/**
 * Wren's line for this child's state: three, NEWEST FIRST, in the order they are earned.
 *
 * Ordered backwards for the same reason rowanLineFor and world/quest.js's beaconObjectiveFor are:
 * each of these is a latch, and a child who has got further must never be handed a line about a
 * thing they have already finished.
 *
 * @param satchelCarried  is this child carrying the fallen ranger's satchel right now
 * @param charmOwned      has this child already been given the charm (a PERSONAL fact, so two
 *                        brothers each hear the recognition for themselves and each earn a heart)
 */
export function rangerLineFor(satchelCarried = false, charmOwned = false) {
  if (charmOwned === true) return RANGER_LINE_SATCHEL_GIVEN;
  if (satchelCarried === true) return RANGER_LINE_SATCHEL_FOUND;
  return RANGER_LINE_INTRO;
}

/**
 * Proximity edge + line selection + show/hide, one pure read -- the identical shape
 * rowanSpeechState and keeperSpeechState already take, because main.js shares ONE speech bubble
 * between every NPC in the game and they are far enough apart that two can never be in range at once.
 */
export function rangerSpeechState({
  heroX, heroZ, rangerX, rangerZ, radiusMeters, satchelCarried = false, charmOwned = false,
}) {
  const distance = Math.hypot(heroX - rangerX, heroZ - rangerZ);
  if (distance > radiusMeters) return { visible: false, line: null };
  return { visible: true, line: rangerLineFor(satchelCarried, charmOwned) };
}

/**
 * WHETHER WREN IS HERE AT ALL.
 *
 * She is in the world if and only if the Beacon is burning, and `beaconLit` is a WORLD fact from the
 * durable store (net/rewardStore.mjs) rather than a per-client latch. That distinction is the whole
 * co-op half: a younger brother who joins after the fire is lit walks into a village that already
 * has a stranger in it, and never has to be told why. He can ask.
 *
 * Pure and exported rather than inlined at the build site so the presenter, the speech and any test
 * all ask the same question (GQ-007).
 */
export function rangerIsHere(beaconLit) {
  return beaconLit === true;
}

/**
 * WHETHER WREN OWES THIS CHILD A CHARM RIGHT NOW -- the one condition main.js sends `claim-charm`
 * on, and the same condition net/gameServer.mjs re-checks before granting anything.
 *
 * Exactly the discipline rowanOwesBlade documents at length: the client's "ask" and the server's
 * "allow" are literally the same function rather than two hand-copied opinions free to drift.
 *
 * Deliberately NOT gated on having personally opened the hollow. Carrying the satchel is the proof
 * that you were there, and it is a durable per-guest fact; requiring a separate discovery latch as
 * well would refuse a brother his charm for the crime of having been handed the satchel differently.
 */
export function rangerOwesCharm({ inRange, beaconLit, satchelCarried, charmOwned }) {
  return inRange === true && beaconLit === true
    && satchelCarried === true && charmOwned !== true;
}
