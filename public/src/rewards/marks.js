// The Lantern Marks pure fold. Turns combat/encounter.js's own events into mark-earned award
// decisions -- one per wolf-life, one per contributing hero -- with no I/O, no clock, no randomness,
// and no reach into public/src/combat/ or the DOM. `rewards/` is a deliberate sibling of `combat/`
// rather than living inside it: encounter.js stays the one file that owns the rules of the fight, and
// this file only READS the events it already publishes. Copy the discipline, not the directory --
// see combat/encounter.js's own header for why that split exists at all.
//
// Sol's ruling this implements, verbatim: "a mark per kill, three marks unlocking something visible."
//
// PARTICIPATION credit, not killing-blow-only (brief D1, Phase D): every hero who landed at least one
// wolf-hit during the wolf-life that ends in wolf-defeated earns one mark. Kinder than killing-blow
// when two brothers fight one wolf together, and Sol's wording does not forbid it.
//
// lantern-unlocked is deliberately NOT produced here. Whether three marks have accumulated is a
// question about a DURABLE, per-guest total that can span server restarts -- this fold only ever sees
// one server process's events, so it has no way to know a guest's true lifetime count. That decision
// belongs to the store (net/rewardStore.mjs, D2) and the caller that threads awards through it
// (net/gameServer.mjs, D3). The award TYPE union below still names 'lantern-unlocked' because D2/D3
// reuse this exact award shape for the awards they synthesize -- so the wire and the store never see
// two different "what is an award" definitions.

export const MARKS_TO_UNLOCK = 3;

/**
 * A fresh, empty ledger. Every field is bookkeeping private to this module -- the brief calls it
 * "opaque to" the caller, and it is: the caller only ever threads the `ledger` this module hands
 * back into the next foldEvents() call, never reads or writes its fields directly.
 *
 *   livesCompleted   how many wolf-lives have already been folded to completion (i.e. reached a
 *                     wolf-defeated event). Used to derive a life-scoped, deterministic eventId --
 *                     see foldEvents' own comment on why a life INDEX, not a wall-clock timestamp,
 *                     is what makes eventIds reproducible.
 *   contributors      the set of heroIds credited with at least one wolf-hit (or the killing blow
 *                     itself) during the CURRENT, still-open wolf-life. Cleared the instant that
 *                     life's awards are emitted.
 *   processedEvents   a WeakSet of the exact event OBJECTS already folded. This is what makes a
 *                     replayed batch -- the same array of event objects handed to foldEvents a
 *                     second time against the SAME (now-advanced) ledger -- a no-op: each event is
 *                     only ever allowed to affect `contributors`/`livesCompleted` once, by identity.
 *                     A WeakSet rather than a Set so a long-running server does not hold every event
 *                     object it has ever seen; once nothing else references an event, this bookkeeping
 *                     can be collected right along with it.
 */
export function createRewardLedger() {
  return {
    livesCompleted: 0,
    contributors: new Set(),
    processedEvents: new WeakSet(),
  };
}

/**
 * Fold one snapshot's events into award decisions for one wolf-life ledger.
 *
 * @param ledger  the ledger returned by the previous call, or createRewardLedger()/undefined/null to
 *                start fresh.
 * @param events  the events array off a single drainEvents() batch (or, for a replay/sabotage test,
 *                the exact same array/objects handed back through the exact same ledger).
 * @returns { ledger, awards } -- `ledger` threads into the next call; `awards` is
 *          [{ heroId, type: 'mark-earned' | 'lantern-unlocked', eventId }], new awards only.
 *
 * A wolf-life is delimited by wolf-defeated (the life ends in a kill, which is the only kind of life
 * end this fold rewards -- Sol's ruling is "a mark per KILL") and wolf-respawned (the life after
 * begins). Only wolf-hit and wolf-defeated ever add a heroId to the current life's contributors:
 * wolf-defeated's own heroId is the hero who landed the KILLING blow, which encounter.js does not
 * additionally report as a separate wolf-hit (see combat/encounter.js's advancePartyFight: the
 * contact branch pushes either wolf-hit OR wolf-defeated, never both), so it must be credited here or
 * a solo killing blow would earn nothing.
 *
 * eventIds are derived as `mark:<heroId>:<lifeIndex>` -- deterministic and reproducible from the same
 * inputs, which is what makes them usable as D2's idempotency keys: two servers (or one server
 * restarted) folding the same true history of a guest's kills produce the same eventId for the same
 * life, so INSERT OR IGNORE at the store layer is the actual no-op enforcement; this fold's own
 * processedEvents guard is the belt to that store's braces, catching a double-fold before it ever
 * reaches the wire.
 */
export function foldEvents(ledger, events) {
  const start = ledger ?? createRewardLedger();
  let livesCompleted = start.livesCompleted;
  let contributors = new Set(start.contributors);
  const processedEvents = start.processedEvents;
  const awards = [];

  for (const event of events) {
    if (processedEvents.has(event)) continue;
    processedEvents.add(event);

    if (event.type === 'wolf-hit') {
      if (event.heroId != null) contributors.add(event.heroId);
      continue;
    }

    if (event.type === 'wolf-defeated') {
      if (event.heroId != null) contributors.add(event.heroId);
      const lifeIndex = livesCompleted;
      for (const heroId of contributors) {
        awards.push({ heroId, type: 'mark-earned', eventId: `mark:${heroId}:${lifeIndex}` });
      }
      livesCompleted += 1;
      contributors = new Set();
      continue;
    }

    // wolf-respawned and every other event type carry no contributor information this fold needs.
  }

  return {
    ledger: { livesCompleted, contributors, processedEvents },
    awards,
  };
}
