// The Lantern Marks pure fold. Turns combat/encounter.js's own events into mark-earned award
// decisions -- one per Wolf life, one per contributing hero -- with no I/O, no clock, no randomness,
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
    // E1: contributors belong to ONE stable enemy life, not to "the Wolf" globally. A Map keeps two
    // interleaved Wolves from sharing participation credit. The default shipped world still authors
    // exactly one Wolf; this is collection correctness, not density.
    contributorsByEnemy: new Map(),
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
 * eventIds are derived as `mark:<heroId>:<lifeId>`, where lifeId identifies THE WOLF-LIFE rather
 * than the hero's own count of them. That distinction is the whole point, and it was learned twice:
 *
 *   - A life INDEX (this fold's `livesCompleted`) is reproducible, but only WITHIN one process: it
 *     restarts at 0, and so does createSimulation's `p<n>`, so the first kill after a restart
 *     recomputes an eventId already on record and INSERT OR IGNORE silently swallows a real kill.
 *   - Deriving the durable key from the STORE's current count instead (the fix that replaced it)
 *     cured that but was not idempotent at all: two heroIds mapped to one guestId -- two tabs in one
 *     browser share localStorage, so they share a guestId -- produce two awards for one wolf-life,
 *     and the count is re-read BETWEEN them, so the second computes a different key and inserts.
 *     One kill, two marks. See test/profile-identity.test.mjs, which fails against that version.
 *
 * What both attempts were reaching for is a name for the FACT being paid for. `mintLifeId` supplies
 * it: called exactly once per wolf-defeated, so every contributor to that life carries the SAME
 * lifeId. Two heroes of one guest then derive one identical durable key and the store's INSERT OR
 * IGNORE does its job; two different guests derive different keys and are both paid, which is the
 * participation-credit rule this file exists to keep. A server passes randomUUID, which cannot
 * collide across a restart the way an index could.
 *
 * The default keeps the historical `String(lifeIndex)` so a caller that does not care about
 * durability -- the offline fallback in main.js, and every existing test -- gets byte-identical
 * eventIds to before. This fold's own processedEvents guard is unchanged: it still catches a
 * double-fold of the same event objects before anything reaches the wire.
 *
 * @param options.mintLifeId  (lifeIndex) => string, called once per completed wolf-life.
 */
const LEGACY_WOLF_ID = '__legacy-wolf__';

function rewardableWolfId(event) {
  // Identity-bearing non-Wolf events must never mint Lantern Marks. An event without `kind` is a
  // pre-E1 compatibility fixture and therefore historically meant Wolf.
  if (event?.kind !== undefined && event.kind !== 'wolf') return null;
  if (event?.enemyId === undefined || event.enemyId === null) return LEGACY_WOLF_ID;
  if (typeof event.enemyId !== 'string' || event.enemyId.length === 0) return null;
  return event.enemyId;
}

export function foldEvents(ledger, events, options = {}) {
  const mintLifeId = options.mintLifeId ?? ((lifeIndex) => String(lifeIndex));
  const start = ledger ?? createRewardLedger();
  let livesCompleted = start.livesCompleted;

  // Compatibility is intentionally one-way: an old opaque ledger can be threaded into E1 without
  // losing the current Wolf's contributors, but every ledger returned from here is collection-shaped.
  const contributorsByEnemy = start.contributorsByEnemy instanceof Map
    ? new Map([...start.contributorsByEnemy].map(([enemyId, contributors]) => [enemyId, new Set(contributors)]))
    : new Map(start.contributors instanceof Set ? [[LEGACY_WOLF_ID, new Set(start.contributors)]] : []);
  const processedEvents = start.processedEvents instanceof WeakSet ? start.processedEvents : new WeakSet();
  const awards = [];

  for (const event of events) {
    if (processedEvents.has(event)) continue;
    processedEvents.add(event);

    if (event.type === 'wolf-hit') {
      const enemyId = rewardableWolfId(event);
      if (enemyId === null) continue;
      const contributors = contributorsByEnemy.get(enemyId) ?? new Set();
      if (event.heroId != null) contributors.add(event.heroId);
      contributorsByEnemy.set(enemyId, contributors);
      continue;
    }

    if (event.type === 'wolf-defeated') {
      const enemyId = rewardableWolfId(event);
      if (enemyId === null) continue;
      const contributors = contributorsByEnemy.get(enemyId) ?? new Set();
      if (event.heroId != null) contributors.add(event.heroId);
      // Once per ENEMY LIFE, not once per contributor. Interleaved enemies keep separate sets and
      // therefore cannot pay each other's contributors when either one dies.
      const lifeId = mintLifeId(livesCompleted);
      for (const heroId of contributors) {
        awards.push({ heroId, type: 'mark-earned', lifeId, eventId: `mark:${heroId}:${lifeId}` });
      }
      livesCompleted += 1;
      contributorsByEnemy.delete(enemyId);
      continue;
    }

    // respawn and every other event type carry no contributor information this fold needs.
  }

  return {
    ledger: { livesCompleted, contributorsByEnemy, processedEvents },
    awards,
  };
}
