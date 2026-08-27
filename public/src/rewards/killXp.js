// public/src/rewards/killXp.js
//
// R1: REPEATABLE COMBAT XP, AND THE DOOR IT WALKS THROUGH.
//
// progression/facts.js's own pendingLanternXpFact names this exactly: "Repeatable combat XP is R1's
// package... the brief is explicit that neither may arrive early through this door." P2 shipped the
// XP fact and its one authored source (the first Lantern unlock); this is the second source, and it
// is meant to ride the IDENTICAL path -- same fact type (`xp-earned`), same fold
// (progression/facts.js's totalXpFromFacts/foldFacts), same level-up ceremony (diffed off the level
// the rewards block reports, never fired from an event) -- so nothing on the client has to learn a
// second kind of XP exists.
//
// Built the same way rewards/marks.js already is, and deliberately shaped like it: a pure read of
// combat/encounter.js's own defeat events, one award per contributing hero per enemy life, no I/O,
// no clock, no randomness, no reach into public/src/combat/ or the DOM. `rewards/` is a deliberate
// sibling of `combat/` for the identical reason marks.js's own header gives -- encounter.js stays the
// one file that owns the rules of the fight, and this file only READS the events it already
// publishes.
//
// THE ONE DIFFERENCE FROM marks.js: SCOPE. Lantern Marks are a Wolf-only reward (Sol's ruling,
// enforced by marks.js's own rewardableWolfId, which returns null for any other kind) -- that rule
// predates this package and stays exactly what it was. A KILL is not scoped that way: every ordinary
// enemy this game defines is a wolf-family predator worth XP (combat/enemyStats.js's own
// killXpForKind), so this fold reads every kind's own wolf-hit/wolf-defeated events rather than
// filtering to `kind === 'wolf'`.
//
// PARTICIPATION credit, the identical rule marks.js documents at length: every hero who landed at
// least one hit during the life that ends in a defeat earns the award, not only the hero who landed
// the killing blow -- kinder than killing-blow-only when two brothers fight one enemy together.

import { killXpForKind } from '../combat/enemyStats.js';

/** A fresh, empty ledger. Every field is bookkeeping private to this module, the same "opaque to the
 *  caller" shape createRewardLedger's own comment documents for marks.js -- a caller only ever
 *  threads this back into the next foldKillXpEvents() call, never reads or writes its fields. */
export function createKillXpLedger() {
  return {
    // One contributor set per still-open enemy life, keyed by enemyId -- the same collection shape
    // marks.js's own contributorsByEnemy keeps, and for the identical E1 reason: two interleaved
    // enemies must never share participation credit.
    contributorsByEnemy: new Map(),
    // A WeakSet of the exact event OBJECTS already folded, so a replayed batch against the SAME
    // (now-advanced) ledger is a no-op -- marks.js's own processedEvents comment explains why a
    // WeakSet rather than a Set is what keeps this from holding every event a long-running server
    // has ever seen.
    processedEvents: new WeakSet(),
  };
}

/**
 * Fold one snapshot's events into kill-XP award decisions.
 *
 * @param ledger  the ledger returned by the previous call, or createKillXpLedger()/undefined/null to
 *                start fresh.
 * @param events  the events array off a single drainEvents() batch (or, for a replay/idempotency
 *                test, the exact same array/objects handed back through the exact same ledger).
 * @param options.mintLifeId  (lifeIndex) => string, called once per completed enemy life -- the SAME
 *   seam rewards/marks.js's own foldEvents takes, for the identical reason: a life INDEX
 *   (this fold's own counter) is only reproducible within one process, so a durable caller
 *   (net/gameServerCore.mjs) mints a real identity (randomUUID) rather than this fold inventing one
 *   from a counter that resets on restart. Defaults to the historical `String(lifeIndex)` so a
 *   caller that does not care about durability (a unit test, an offline fallback) gets a
 *   deterministic id.
 * @returns { ledger, awards } -- `ledger` threads into the next call; `awards` is
 *   `[{ heroId, type: 'xp-earned', enemyId, kind, level, value, lifeId, eventId }]`, new awards only.
 *   `eventId` is `kill-xp:<heroId>:<enemyId>:<lifeId>` -- the in-process shape a caller with no
 *   durable identity (an ephemeral connection, a test) can use directly; a durable caller re-derives
 *   its own guestId-scoped id from `lifeId` the same way net/gameServerCore.mjs's applyMarkAward
 *   re-derives `mark:<guestId>:<lifeId>` from the mark fold's own award.
 */
export function foldKillXpEvents(ledger, events, options = {}) {
  const mintLifeId = options.mintLifeId ?? ((lifeIndex) => String(lifeIndex));
  const start = ledger ?? createKillXpLedger();
  let livesCompleted = start.livesCompleted ?? 0;
  const contributorsByEnemy = new Map(
    [...(start.contributorsByEnemy ?? [])].map(([enemyId, contributors]) => [enemyId, new Set(contributors)]),
  );
  const processedEvents = start.processedEvents instanceof WeakSet ? start.processedEvents : new WeakSet();
  const awards = [];

  for (const event of events) {
    if (processedEvents.has(event)) continue;
    processedEvents.add(event);

    if (event.type === 'wolf-hit') {
      if (typeof event.enemyId !== 'string' || event.enemyId.length === 0) continue;
      const contributors = contributorsByEnemy.get(event.enemyId) ?? new Set();
      if (event.heroId != null) contributors.add(event.heroId);
      contributorsByEnemy.set(event.enemyId, contributors);
      continue;
    }

    if (event.type === 'wolf-defeated') {
      if (typeof event.enemyId !== 'string' || event.enemyId.length === 0) continue;
      const contributors = contributorsByEnemy.get(event.enemyId) ?? new Set();
      // wolf-defeated's own heroId is the hero who landed the KILLING blow, which encounter.js does
      // not additionally report as a separate wolf-hit -- must be credited here or a solo killing
      // blow would earn nothing, the identical reasoning marks.js's own foldEvents gives.
      if (event.heroId != null) contributors.add(event.heroId);
      const amount = killXpForKind(event.kind);
      // A kind this table does not price (should not happen for any kind ENEMY_POPULATION ever
      // authors, but a hostile/malformed event object is not this fold's to trust) mints no award --
      // never a silent zero-value one, which would durably record a fact worth nothing.
      if (amount !== null) {
        const lifeId = mintLifeId(livesCompleted);
        for (const heroId of contributors) {
          awards.push({
            heroId,
            type: 'xp-earned',
            enemyId: event.enemyId,
            kind: event.kind,
            level: event.level,
            value: amount,
            lifeId,
            eventId: `kill-xp:${heroId}:${event.enemyId}:${lifeId}`,
          });
        }
      }
      livesCompleted += 1;
      contributorsByEnemy.delete(event.enemyId);
      continue;
    }

    // Every other event type (a bite, a respawn, a hero going down) carries no contributor
    // information this fold needs.
  }

  return {
    ledger: { livesCompleted, contributorsByEnemy, processedEvents },
    awards,
  };
}
