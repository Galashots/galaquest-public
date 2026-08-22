// The server and the device must answer "which weapon is equipped" with the SAME law.
//
// Two readers of the same durable rows had grown two different definitions of "latest": the local
// fold resolved by (rev, eventId) -- the order the child actually chose in -- while the store still
// answered by `ORDER BY rowid DESC`, the order the rows happened to arrive in. Whenever those two
// disagree, the rewards block and live combat damage use a different weapon from the reconciled
// profile, which is the whole GQ-014 defect reappearing at the final read.
//
// Arrival order is not chronology, and it is not hypothetical here: two tabs share one profile id,
// WebSocket ordering holds only per connection, and recovery/import writes facts long after the
// moment they describe. So these tests deliberately insert rows in the WRONG order and assert the
// two readers still agree.

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { foldFacts } from '../public/src/progression/facts.js';
import { STARTER_SWORD_ID, WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';
import { openRewardStore } from '../net/rewardStore.mjs';

const GUEST = 'p-agreement-0000-1111-2222';

function withStore(run) {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-equip-authority-'));
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    run(store);
  } finally {
    try { store.close(); } catch { /* already closed by the test */ }
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* OS scratch */ }
  }
}

function equip(store, { eventId, itemId, rev }) {
  store.apply({
    guestId: GUEST, heroId: 'p1', type: 'weapon-equipped', eventId, value: itemId, ...(rev === undefined ? {} : { rev }),
  });
}

/** What the device would render, from the same rows the server is holding. */
function foldedEquip(store) {
  return foldFacts(store.profileFactsFor(GUEST)).equippedWeaponId;
}

test('a newer equip inserted BEFORE an older one still wins, on both sides', () => {
  withStore((store) => {
    // Reverse delivery: the later choice lands in the table first.
    equip(store, { eventId: 'equip:c', itemId: WILDWOOD_BLADE_ID, rev: 200 });
    equip(store, { eventId: 'equip:b', itemId: STARTER_SWORD_ID, rev: 100 });

    assert.equal(foldedEquip(store), WILDWOOD_BLADE_ID, 'the fold reads the order the child chose in');
    assert.equal(
      store.equippedWeaponFor(GUEST),
      WILDWOOD_BLADE_ID,
      'the server must not answer by which row arrived last',
    );
  });
});

test('server and device agree when the equips arrive in the expected order too', () => {
  // The easy case still has to hold -- a repair that only fixed the inverted case would be reading
  // rowid backwards rather than reading rev.
  withStore((store) => {
    equip(store, { eventId: 'equip:b', itemId: STARTER_SWORD_ID, rev: 100 });
    equip(store, { eventId: 'equip:c', itemId: WILDWOOD_BLADE_ID, rev: 200 });

    assert.equal(foldedEquip(store), WILDWOOD_BLADE_ID);
    assert.equal(store.equippedWeaponFor(GUEST), WILDWOOD_BLADE_ID);
  });
});

test('an equal-revision tie resolves the same way on both sides', () => {
  withStore((store) => {
    // Two tabs, same profile, same millisecond. The tiebreak must be one shared rule, not two.
    equip(store, { eventId: 'equip:zzz', itemId: WILDWOOD_BLADE_ID, rev: 500 });
    equip(store, { eventId: 'equip:aaa', itemId: STARTER_SWORD_ID, rev: 500 });

    assert.equal(store.equippedWeaponFor(GUEST), foldedEquip(store),
      'a tie must not be broken differently by the two readers');
  });
});

test('pre-v3 rows with no revision still fall back to arrival order, on both sides', () => {
  withStore((store) => {
    // A real upgraded store: rows written before `rev` existed carry NULL, and the only order they
    // have ever had is the order they were written in. Latest arrival is the intended fallback.
    equip(store, { eventId: 'equip:legacy-1', itemId: WILDWOOD_BLADE_ID });
    equip(store, { eventId: 'equip:legacy-2', itemId: STARTER_SWORD_ID });

    assert.equal(store.equippedWeaponFor(GUEST), STARTER_SWORD_ID, 'the last legacy write is the legacy answer');
    assert.equal(foldedEquip(store), STARTER_SWORD_ID, 'and the fold must reach the same conclusion');
  });
});

test('any revision beats a pre-v3 row, however late the legacy row arrives', () => {
  withStore((store) => {
    equip(store, { eventId: 'equip:modern', itemId: WILDWOOD_BLADE_ID, rev: 10 });
    // Written afterwards, but it predates the ordering: it cannot claim to be the newer choice.
    equip(store, { eventId: 'equip:legacy', itemId: STARTER_SWORD_ID });

    assert.equal(store.equippedWeaponFor(GUEST), WILDWOOD_BLADE_ID);
    assert.equal(foldedEquip(store), WILDWOOD_BLADE_ID);
  });
});

test('a guest who has never equipped anything reads null, not a guess', () => {
  withStore((store) => {
    assert.equal(store.equippedWeaponFor(GUEST), null,
      'the store reports what happened; the caller owns the default');
  });
});
