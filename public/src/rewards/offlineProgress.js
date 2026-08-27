// What a child earns when there is no server, recorded so it is still theirs tomorrow.
//
// This is main.js's offline reward loop lifted out of the frame loop, for the reason GQ-015 names:
// while it lived inline it could only be proved by driving a browser, so the one part of it that was
// wrong -- the durable id -- had no test that could see it. The split is the same one
// rewards/hud.js and progression/heroScreen.js already use: the rule lives here and is unit tested,
// main.js does the wiring.
//
// Two things happen here and they are not separable, which is why they are one module:
//
// 1. THE FACT IS RECORDED. It used to be a `let` in main.js's closure -- `offlineMarks` -- so a
//    child who beat two wolves on a tablet with no network was back to zero after a refresh. That
//    was written down as deliberate, and Director correction 4 retired it: a same-device family save
//    must recover a child's progression whether or not a server was ever reachable, and marks are
//    named in that list.
//
// 2. THE FACT IS NAMED DURABLY. rewards/marks.js derives a mark's eventId from a lifeId, and its
//    DEFAULT lifeId is the fold's own life index -- reproducible only inside one process. Offline
//    that default was harmless precisely because nothing was kept: nothing to collide with. Making
//    the marks durable makes it reachable, and it lands on the worst possible case -- the first kill
//    after a refresh recomputes `mark:offline-hero:0`, an id the journal already holds, the union
//    collapses it, and the child watches the spark fly while the count does not move.
//
//    rewards/marks.js's own header records this exact defect being found and repaired once already
//    on the server path, which is why mintLifeId is injectable at all. Taking the durable half
//    without the id half would have been the same bug's third outing (docs/MISTAKES.md GQ-014: an
//    identity derived from mutable state is not an identity -- and a process's own counter is
//    mutable state).
//
// 3. P2: AND THE LANTERN IS NOW WORTH A LEVEL. The unlock earns one `xp-earned` fact, whose amount
//    and whose NAME both come from progression/facts.js -- the same function net/gameServer.mjs
//    calls on the online path. The two are written in ONE recordFacts call, which is this side's
//    equivalent of the store's applyAll transaction and exists for the same failure: a Lantern that
//    is permanently present with XP that can never arrive, because the unlock is a latch and will
//    never fire again. Journalling them together makes that state unreachable, and because the award
//    is a pure function of the facts on record, calling it again on a profile that already holds it
//    is a no-op rather than a second hundred XP.
//
// The server is still the only adjudicator when there IS one. Nothing here decides whether a wolf
// died; combat/encounter.js does, exactly as before. This only writes down what was already true.

import { MARKS_TO_UNLOCK, createRewardLedger, foldEvents } from './marks.js';
// The Lantern's XP award, from the same law the server uses. Neither side knows about the other;
// both ask progression/facts.js what this profile is owed, which is what makes "the offline path
// produces the same logical one-time result" true by construction rather than by two matching
// implementations somebody has to keep in step (GQ-007 hit 7).
import { pendingLanternXpFact } from '../progression/facts.js';
// R1: repeatable combat XP, folded the SAME way net/gameServerCore.mjs's own applyKillXpAward does --
// this file's own header already explains why marks.js's fold is reused rather than reimplemented,
// and the identical reasoning applies here: one fold, run by whichever engine holds the fight.
import { foldKillXpEvents } from './killXp.js';

/** The hero id an offline session credits its kills to. foldEvents attributes a mark to a
 *  contributor, and a solo offline hero has no server-assigned player id to be one -- so it gets a
 *  fixed name. Exported because main.js needs the same string for its own offline hero bookkeeping
 *  and two copies of it would be two names for one hero (GQ-007). */
export const OFFLINE_HERO_ID = 'offline-hero';

/** The unlock is ONE fact about ONE child, so its id is derived from the profile and nothing else.
 *  Deliberately not from a count or a timestamp: re-deriving it after a reload has to produce the
 *  same id and be a no-op, or a child who reloads with three marks unlocks the lantern again. */
export function lanternUnlockEventId(profileId) {
  return `lantern-unlocked:${profileId}`;
}

/**
 * A source of life ids that stays unique across page loads, even where `crypto.randomUUID` is not
 * there to be had.
 *
 * That absence is the normal case for this game, not an exotic one: randomUUID requires a secure
 * context, and the tablets this is built for reach the server over plain http on the LAN (see the
 * README's own LAN URL). So the fallback is the path a real child on a real iPad takes, and it has
 * to be as durable as the happy one -- a counter is exactly what it must not be.
 *
 * The fallback names the moment and salts it: the clock separates sessions, the salt separates two
 * devices that loaded in the same millisecond, and the counter separates two kills inside one. A
 * clock knocked backwards onto a previous session's millisecond would still differ by the salt.
 *
 * Every input is injected for the reason net/guestId.js gives for doing the same -- so this is
 * testable under bare `node --test` with no DOM, no real clock and no real crypto.
 */
export function createLifeIdMinter(options = {}) {
  const randomUUID = options.randomUUID
    ?? (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? () => crypto.randomUUID()
      : null);
  if (randomUUID) return () => randomUUID();

  const now = options.now ?? (() => Date.now());
  const random = options.random ?? (() => Math.random());
  const salt = Math.floor(random() * 0xffffff).toString(36);
  let counter = 0;
  return () => `${now().toString(36)}-${salt}-${counter += 1}`;
}

/**
 * @param options.profiles   a progression/profiles.js store.
 * @param options.profileId  whose journal these facts belong to.
 * @param options.mintLifeId () => string, called once per wolf-life. REQUIRED, and required for a
 *   reason: defaulting it here would silently reinstate the life-index collision above. A caller
 *   with no source of unique ids has no business writing durable facts, so this throws rather than
 *   quietly producing ids that look fine until the second session.
 */
export function createOfflineProgress({ profiles, profileId, mintLifeId }) {
  if (typeof mintLifeId !== 'function') {
    throw new TypeError('createOfflineProgress needs a mintLifeId that is unique across sessions');
  }

  let ledger = createRewardLedger();
  // R1: a SEPARATE ledger from marks' own -- foldKillXpEvents keeps its own contributor bookkeeping
  // and its own life-index counter, and threading one fold's ledger through the other's function would
  // mix two unrelated tallies. Both still mint life ids off the SAME `mintLifeId`, which is fine: each
  // call returns a fresh, durable id regardless of which fold asked for it, and the two id families
  // (`mark:offline-hero:<lifeId>` / `kill-xp:offline-hero:<enemyId>:<lifeId>`) never collide.
  let killXpLedger = null;

  /**
   * Fold one frame's combat events and record whatever they earned.
   *
   * @param encounterEvents combat/encounter.js's own events for this frame, heroId-less.
   * @returns the reward events to raise this frame, each carrying the durable eventId it was
   *          recorded under -- so main.js's dispatcher journals the same fact rather than a nameless
   *          one, and so a harness can read what was actually written.
   *
   * The facts are recorded HERE rather than left to the dispatcher because the unlock below has to
   * read the count back to decide, and a count that does not yet include this frame's mark would
   * hold the ceremony one kill late. main.js's journalDurableFact then records the same ids again
   * and the journal collapses them: writing an identical fact twice is not a bug in a grow-only set
   * keyed by id, it is the property the whole two-copy design rests on.
   */
  function recordKills(encounterEvents) {
    const stamped = encounterEvents.map((event) => ({ ...event, heroId: OFFLINE_HERO_ID }));
    const folded = foldEvents(ledger, stamped, { mintLifeId });
    ledger = folded.ledger;

    const raised = [];
    for (const award of folded.awards) {
      if (award.type !== 'mark-earned') continue;
      profiles.recordFacts(profileId, [{ eventId: award.eventId, type: 'mark-earned' }]);
      raised.push({ type: 'mark-earned', eventId: award.eventId });
    }

    // R1: repeatable combat XP -- every kill this game defines is priced (killXpForKind), not just a
    // Wolf's own Lantern Mark, so this reads the SAME stamped events rather than the mark-only subset
    // foldEvents above already filtered. eventId already rides the award (killXp.js's own header:
    // `kill-xp:<heroId>:<enemyId>:<lifeId>`), so `value` is the only extra thing this device journals.
    const foldedXp = foldKillXpEvents(killXpLedger, stamped, { mintLifeId });
    killXpLedger = foldedXp.ledger;
    for (const award of foldedXp.awards) {
      profiles.recordFacts(profileId, [{ eventId: award.eventId, type: 'xp-earned', value: String(award.value) }]);
      raised.push({ type: 'xp-earned', eventId: award.eventId, value: String(award.value) });
    }

    // Derived from the durable count, never from a counter alongside it. A child who earned two
    // marks last session and one this session has three, and the threshold has to see all three --
    // which a session-scoped tally by construction cannot.
    const state = profiles.stateFor(profileId);
    if (!state.lanternUnlocked && state.marks >= MARKS_TO_UNLOCK) {
      const eventId = lanternUnlockEventId(profileId);
      const lanternFact = { eventId, type: 'lantern-unlocked' };
      // Computed against the profile's WHOLE journal plus the unlock about to be written, not against
      // the unlock alone: a child who already met a server carries the server's `lantern:<guestId>`
      // too, and the Lantern is a latch -- one child, one unlock, one award. pendingLanternXpFact
      // answers null in that case rather than paying a second time for the same lantern.
      const xpFact = pendingLanternXpFact([...profiles.journalFor(profileId), lanternFact]);
      // ONE CALL, so the pair cannot half-land. See this file's header, point 3.
      profiles.recordFacts(profileId, xpFact ? [lanternFact, xpFact] : [lanternFact]);
      raised.push({ type: 'lantern-unlocked', eventId });
      if (xpFact) raised.push({ type: 'xp-earned', eventId: xpFact.eventId, value: xpFact.value });
    }

    return raised;
  }

  return { recordKills };
}
