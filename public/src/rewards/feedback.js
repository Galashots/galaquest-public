// Reward-event dispatch, copied in SHAPE from combat/feedback.js's createEncounterFeedback -- same
// discipline (throws at construction on a missing handler, logs rather than crashes on an unknown
// type at dispatch) -- but deliberately its own table rather than an extension of ENCOUNTER_EVENT_TYPES.
//
// Why a separate table, not an addition to combat/feedback.js's: mark-earned and lantern-unlocked are
// never raised by public/src/combat/encounter.js -- they are raised by rewards/marks.js's foldEvents
// and applied by net/gameServer.mjs. combat/feedback.js's ENCOUNTER_EVENT_TYPES is pinned, by
// feedback.test.mjs, to a regex scan of encounter.js's OWN source text -- so adding these two names
// there would either be a no-op (encounter.js was not edited, so the regex would never find them,
// making the list wrong) or would require editing encounter.js itself, which public/src/combat/ is
// never edited (repo convention). This module gives the reward events the exact same "every event
// must be accounted for" guarantee, scoped to the table that actually owns them.

// coin-earned / shard-earned join the table for DURABILITY rather than for presentation. The loot
// HUD already shows a collected pickup, diffed off the rewards block, and nothing here changes that
// -- these exist so the device can journal the fact under the same id the store keyed it on, which
// a count can never be. Their handlers in main.js are deliberately empty of ceremony; see there.
// P2's xp-earned joins on the same footing as currency: DURABILITY, not presentation. The level-up
// ceremony is fired by DIFFING the folded level off the rewards block, not by this event -- the same
// discipline the Blade's unlock card, the satchel lift and Wren's charm already follow, and for the
// same reason. A one-shot beat hung off an announcement replays on a reconnect to a wiped server,
// where the device teaches its own facts back and the server announces every one of them straight
// to it; a beat hung off a diff cannot.
export const REWARD_EVENT_TYPES = Object.freeze([
  'mark-earned', 'lantern-unlocked', 'coin-earned', 'shard-earned',
  'gear-owned', 'gear-equipped', 'satchel-taken', 'charm-earned', 'xp-earned',
]);

/**
 * Build a reward-event dispatcher from one callback per event type. Throws immediately if a handler
 * is missing, so main.js discovers a gap at startup rather than mid-session -- combat/feedback.js's
 * own createEncounterFeedback comment explains why that shape matters; this is the same shape.
 */
export function createRewardFeedback(callbacks) {
  const missing = REWARD_EVENT_TYPES.filter((type) => typeof callbacks[type] !== 'function');
  if (missing.length > 0) {
    throw new Error(`reward feedback is missing a handler for: ${missing.join(', ')}`);
  }
  /**
   * @param event   the reward event.
   * @param context what the caller knows that the event itself cannot say. Currently one field:
   *   `firstTimeSeen` -- false when this device had already journalled this eventId, which happens
   *   on a reconnect where the device teaches its own facts back to a server that has never heard
   *   of them and the server announces them straight back. The fact is the same fact; the CEREMONY
   *   is not owed twice, and a handler that fires one anyway replays a one-shot beat for something
   *   the child did minutes ago.
   *
   *   Defaulted to true so a caller that does not know stays exactly as loud as it was.
   */
  return function onRewardEvent(event, context = {}) {
    const handler = callbacks[event.type];
    if (!handler) {
      console.error(`[reward feedback] no handler for reward event "${event.type}"`);
      return;
    }
    handler(event, { firstTimeSeen: context.firstTimeSeen !== false });
  };
}

// Both were explicit `null` -- decided silence, pending the owner's taste call. They are first-draft
// placeholders now instead, on exactly the same footing as the eight in audio/recipes.js: what they
// are MADE of is here, how they SOUND is still his call on a real iPad. The reason for filling them
// in rather than waiting is that the Lantern Tree quest made no sound at any of its beats while
// every swing and every miss did, so a child heard more from whiffing at a wolf than from finishing
// the game's only story. See audio/recipes.js for what each one is and why it is shaped that way.
export const REWARD_RECIPE_MAP = Object.freeze({
  'mark-earned': 'sparkle',
  'lantern-unlocked': 'unlock-flourish',
  // Explicitly silent, not forgotten. Collecting a pickup already has its own sound and its own
  // burst on the pickup itself; a second one fired from the durable announcement would be the same
  // moment played twice, which is the defect GP1-C6 fixed for marks in the other direction.
  'coin-earned': null,
  'shard-earned': null,
  // Same reasoning, one step further along the arc: each of these already has a ceremony of its own
  // -- the Blade's unlock card, the satchel being lifted, Wren's charm -- fired by DIFFING
  // the rewards block, which is how those beats survive a reconnect without replaying. The durable
  // announcement is for the JOURNAL, and a sound here would be that beat played a second time.
  'gear-owned': null,
  // An equipment choice is durable state, not a ceremony. The visible result is derived from the
  // equipped-item snapshot; this event only lets the device journal the named choice.
  'gear-equipped': null,
  'satchel-taken': null,
  'charm-earned': null,
  // Silent HERE for the same reason, and loudly not silent elsewhere: the level-up ceremony this XP
  // pays for has its own sound, fired from the level diff. A recipe here would play it a beat early,
  // and play it again on every reconnect that re-announces the fact.
  'xp-earned': null,
});

export function soundForRewardEvent(eventType) {
  return REWARD_RECIPE_MAP[eventType] ?? null;
}
