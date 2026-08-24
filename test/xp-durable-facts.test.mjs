// `xp-earned` as a REAL durable fact, end to end: store, wire, fold, and device->server recovery.
//
// Before P1 this fact type existed in exactly one place and worked in none of them.
// public/src/progression/facts.js listed it and folded it; net/rewardStore.mjs's known award types
// did not contain it, so apply() threw on the way to the disk. A fact the client can name and the
// server cannot record is not a durable fact -- it is a placeholder that looks like one, which is
// the worst version because every reader assumes it works.
//
// Two properties are load-bearing here and both are tested against the real store and the real
// server rather than against a hand-built array (docs/MISTAKES.md GQ-015: a test that hand-feeds a
// pure function proves the function, not where its inputs come from):
//
//   1. AN XP AMOUNT IS NOT A NUMBER SOMEBODY PARSED. The old fold used Number.parseInt, which reads
//      "12abc" as 12, "-5" as -5, and "1e9" as 1. A durable progression currency that accepts a
//      negative amount can be made to run BACKWARDS by a corrupt journal, so the amount now has one
//      shared canonical parser and everything that folds or accepts XP calls it.
//
//   2. A RESTORE IS ALL-OR-SAFE. The device->server path applied facts one at a time, so a request
//      that failed part way through left the prefix behind it durably written. That is a profile
//      that is neither what the device said nor what the server had.

import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { attachGameServer } from '../net/gameServer.mjs';
import { openRewardStore } from '../net/rewardStore.mjs';
import {
  ProtocolError,
  decode,
  encode,
  joinMessage,
  restoreProfileMessage,
} from '../public/src/net/protocol.js';
import {
  DURABLE_FACT_TYPES,
  PROFILE_FACT_TYPES,
  foldFacts,
  parseXpFactAmount,
} from '../public/src/progression/facts.js';

const GUEST = 'p-xp-1111-2222-3333';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'galaquest-xp-facts-'));
}

function withStore(body) {
  const dir = tempDir();
  const store = openRewardStore(join(dir, 'rewards.db'));
  try {
    return body(store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/** An XP award in the shape net/gameServer.mjs hands the store. The amount is a canonical decimal
 *  string because the store's `value` column is TEXT and every other payload fact already is one. */
function xpAward(guestId, eventId, amount) {
  return { guestId, heroId: 'p1', type: 'xp-earned', eventId, value: String(amount) };
}

// ── the shared amount parser ───────────────────────────────────────────────────────────────────

test('an XP amount is a canonical positive decimal integer and nothing else', () => {
  assert.equal(parseXpFactAmount('1'), 1);
  assert.equal(parseXpFactAmount('100'), 100);
  assert.equal(parseXpFactAmount(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);

  for (const bad of [
    '0',            // an earned-XP fact that earned nothing is not a fact
    '-5',           // the one that could run progression backwards
    '+5',
    '007',          // not canonical: two spellings of one amount defeat idempotency reasoning
    '1.5',
    '1e3',          // parseInt read this as 1
    '12abc',        // parseInt read this as 12
    ' 7',
    '7 ',
    '',
    'NaN',
    'Infinity',
    String(Number.MAX_SAFE_INTEGER + 2),   // past exact integer representation
    100,            // a number, not the canonical string form
    null,
    undefined,
  ]) {
    assert.equal(parseXpFactAmount(bad), null,
      `${JSON.stringify(bad)} must not parse as an XP amount`);
  }
});

test('folding refuses malformed XP amounts instead of quietly scoring them', () => {
  const folded = foldFacts([
    { eventId: 'xp:good', type: 'xp-earned', value: '50' },
    { eventId: 'xp:negative', type: 'xp-earned', value: '-40' },
    { eventId: 'xp:trailing', type: 'xp-earned', value: '12abc' },
    { eventId: 'xp:exponent', type: 'xp-earned', value: '1e6' },
    { eventId: 'xp:fraction', type: 'xp-earned', value: '2.5' },
    { eventId: 'xp:zero', type: 'xp-earned', value: '0' },
  ]);
  assert.equal(folded.xp, 50, 'only the one well-formed amount counts');
});

test('folding XP is order-independent and idempotent, like every other durable fact', () => {
  const facts = [
    { eventId: 'xp:a', type: 'xp-earned', value: '30' },
    { eventId: 'xp:b', type: 'xp-earned', value: '70' },
  ];
  assert.equal(foldFacts(facts).xp, 100);
  assert.equal(foldFacts([...facts].reverse()).xp, 100, 'order must not change the total');
  assert.equal(foldFacts([...facts, ...facts]).xp, 100,
    'the same eventId folded twice is the same total -- that is what makes replay safe');
});

test('the durable fact vocabulary is one list, and XP is in the profile half of it', () => {
  // The split P1 exists to close: the store used to keep its own hand-written copy of this list, and
  // the two disagreed about exactly one type. Deriving one from the other is what makes a future
  // fact type impossible to add to only half the system (docs/MISTAKES.md GQ-007).
  assert.ok(PROFILE_FACT_TYPES.includes('xp-earned'));
  for (const type of PROFILE_FACT_TYPES) {
    assert.ok(DURABLE_FACT_TYPES.includes(type),
      `${type} is a profile fact, so it must also be a durable fact the store can record`);
  }
});

// ── the store ──────────────────────────────────────────────────────────────────────────────────

test('the store durably accepts a valid xp-earned fact', () => {
  withStore((store) => {
    const result = store.apply(xpAward(GUEST, 'xp:quest:one', 100));
    assert.equal(result.applied, true, 'the store must record XP, not refuse it as an unknown type');
  });
});

test('two distinct XP facts add, and replaying either one does not', () => {
  withStore((store) => {
    store.apply(xpAward(GUEST, 'xp:one', 40));
    store.apply(xpAward(GUEST, 'xp:two', 60));
    assert.equal(foldFacts(store.profileFactsFor(GUEST)).xp, 100);

    const replay = store.apply(xpAward(GUEST, 'xp:one', 40));
    assert.equal(replay.applied, false, 'a known eventId is a no-op, not a second award');
    assert.equal(foldFacts(store.profileFactsFor(GUEST)).xp, 100, 'the total must not move on replay');
  });
});

test('persisted XP round-trips through profileFactsFor with its amount intact', () => {
  withStore((store) => {
    store.apply(xpAward(GUEST, 'xp:round-trip', 275));
    const fact = store.profileFactsFor(GUEST).find((f) => f.type === 'xp-earned');
    assert.equal(fact.eventId, 'xp:round-trip');
    assert.equal(fact.value, '275', 'the amount comes back in the canonical form it went in as');
    assert.equal(foldFacts([fact]).xp, 275);
  });
});

test('a client-attested XP fact keeps its origin forever', () => {
  withStore((store) => {
    store.apply({ ...xpAward(GUEST, 'xp:from-device', 25), origin: 'client' });
    store.apply(xpAward(GUEST, 'xp:from-server', 25));
    const facts = store.profileFactsFor(GUEST);
    const attested = facts.find((f) => f.eventId === 'xp:from-device');
    const adjudicated = facts.find((f) => f.eventId === 'xp:from-server');
    assert.equal(attested.origin, 'client', 'provenance must survive the round trip');
    assert.equal(adjudicated.origin, undefined, 'a fact the server decided carries no label');
    assert.equal(foldFacts(facts).xp, 50, 'origin is provenance, not permission: both still count');
  });
});

test('the store refuses a malformed XP amount rather than writing it', () => {
  withStore((store) => {
    for (const bad of ['-5', '0', '1e3', '12abc', '1.5', '', null, undefined]) {
      assert.throws(
        () => store.apply({ guestId: GUEST, heroId: 'p1', type: 'xp-earned', eventId: `xp:bad:${bad}`, value: bad }),
        /xp/i,
        `${JSON.stringify(bad)} must be refused by the store`,
      );
    }
    assert.equal(foldFacts(store.profileFactsFor(GUEST)).xp, 0, 'nothing malformed reached the disk');
  });
});

// ── all-or-safe batch application ──────────────────────────────────────────────────────────────

test('applyAll writes the whole batch or none of it', () => {
  withStore((store) => {
    const batch = [
      { guestId: GUEST, heroId: 'p1', type: 'mark-earned', eventId: 'mark:batch:one' },
      xpAward(GUEST, 'xp:batch:two', 50),
      xpAward(GUEST, 'xp:batch:three', -1),   // invalid, and LAST: the prefix before it is valid
    ];
    assert.throws(() => store.applyAll(batch), /xp/i, 'a bad member must fail the whole batch');

    const facts = store.profileFactsFor(GUEST);
    assert.deepEqual(facts, [],
      'the valid prefix must not survive a failed batch -- that is the partial write P1 removes');
    assert.equal(store.marksFor(GUEST), 0);
  });
});

test('applyAll commits a fully valid batch and stays idempotent on replay', () => {
  withStore((store) => {
    const batch = [
      { guestId: GUEST, heroId: 'p1', type: 'mark-earned', eventId: 'mark:ok:one' },
      xpAward(GUEST, 'xp:ok:two', 120),
      xpAward(GUEST, 'xp:ok:three', 30),
    ];
    assert.equal(store.applyAll(batch).applied, 3);
    assert.equal(foldFacts(store.profileFactsFor(GUEST)).xp, 150);

    assert.equal(store.applyAll(batch).applied, 0, 'replaying the batch adds nothing');
    assert.equal(foldFacts(store.profileFactsFor(GUEST)).xp, 150);
    assert.equal(store.marksFor(GUEST), 1);
  });
});

// ── the wire boundary ──────────────────────────────────────────────────────────────────────────

function roundTrip(facts) {
  return decode(encode(restoreProfileMessage(facts)));
}

test('the wire refuses a fact type outside the durable vocabulary', () => {
  assert.throws(
    () => roundTrip([{ eventId: 'made-up:1', type: 'made-up-fact' }]),
    ProtocolError,
    'an unknown type must be refused at the boundary, before anything durable sees it',
  );
});

test('the wire refuses a malformed XP amount', () => {
  for (const bad of ['-5', '0', '1e3', '12abc', '1.5']) {
    assert.throws(
      () => roundTrip([{ eventId: `xp:wire:${bad}`, type: 'xp-earned', value: bad }]),
      ProtocolError,
      `${bad} must not survive the wire`,
    );
  }
});

test('the wire still carries every legitimate fact, including world facts on welcome', () => {
  // REGRESSION GUARD. `profileFactsFor` selects every row for a guest, and a child who lit the
  // Beacon or bought the Workshop has guest-scoped WORLD rows among them. Tightening the type check
  // to the profile subset alone would make a returning child's own welcome message undecodable.
  const decoded = roundTrip([
    { eventId: 'xp:wire:ok', type: 'xp-earned', value: '250' },
    { eventId: 'mark:wire:ok', type: 'mark-earned' },
    { eventId: 'beacon-lit:old-beacon', type: 'beacon-lit' },
    { eventId: 'workshop-i', type: 'village-upgrade' },
  ]);
  assert.equal(decoded.facts.length, 4);
  assert.equal(decoded.facts[0].value, '250');
});

// ── device -> server recovery, against a real server ───────────────────────────────────────────

async function withEmptyServer(body) {
  const dir = tempDir();
  const httpServer = createServer((_request, response) => response.writeHead(404).end());
  const game = attachGameServer(httpServer, {
    rewardStorePath: join(dir, 'rewards.db'),
    allowMissingOrigin: true,
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  try {
    return await body({ url: `ws://127.0.0.1:${port}/ws`, game });
  } finally {
    game.stop();
    await new Promise((resolve) => httpServer.close(resolve));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function client(url) {
  const socket = new WebSocket(url);
  const messages = [];
  socket.addEventListener('message', (event) => messages.push(decode(event.data)));
  return {
    socket,
    messages,
    open: () => new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('failed to open')), { once: true });
    }),
    send: (message) => socket.send(encode(message)),
    waitFor: async (type, timeoutMs = 4000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = messages.find((m) => m.type === type);
        if (found) return found;
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${type}; saw ${JSON.stringify(messages.map((m) => m.type))}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    close: () => socket.close(),
  };
}

/** Join, restore these facts, and leave -- the whole shape of a device handing its journal back to a
 *  store that has never seen it. */
async function restoreOnce(url, facts) {
  const c = client(url);
  await c.open();
  c.send(joinMessage('kid', GUEST));
  await c.waitFor('welcome');
  c.send(restoreProfileMessage(facts));
  await new Promise((resolve) => setTimeout(resolve, 150));
  c.close();
}

async function rejoinAndReadFacts(url) {
  const c = client(url);
  await c.open();
  c.send(joinMessage('kid-again', GUEST));
  const welcome = await c.waitFor('welcome');
  c.close();
  return welcome.profileFacts;
}

test('XP earned on a device survives an empty server, once, across repeated reconnects', async () => {
  await withEmptyServer(async ({ url }) => {
    const journal = [
      { eventId: 'xp:device:one', type: 'xp-earned', value: '100' },
      { eventId: 'xp:device:two', type: 'xp-earned', value: '150' },
      { eventId: 'mark:device:one', type: 'mark-earned' },
    ];

    await restoreOnce(url, journal);
    const first = await rejoinAndReadFacts(url);
    assert.equal(foldFacts(first).xp, 250, 'the server now holds what the device earned');
    assert.ok(first.filter((f) => f.type === 'xp-earned').every((f) => f.origin === 'client'),
      'restored XP stays attested to the device that claimed it');

    // The same device reconnecting and re-sending its whole journal is the ordinary case, not an
    // attack: it must be a no-op rather than a doubling.
    await restoreOnce(url, journal);
    const second = await rejoinAndReadFacts(url);
    assert.equal(foldFacts(second).xp, 250, 'a replayed journal must not double the XP');
    assert.equal(second.filter((f) => f.type === 'xp-earned').length, 2);
  });
});

test('a restore carrying an apply-invalid XP fact leaves no partial prefix behind', async () => {
  await withEmptyServer(async ({ url, game }) => {
    // Driven through the coordinator rather than the socket ON PURPOSE: the wire now refuses a
    // malformed amount outright, so the only way to reach the durable path with one is to call the
    // layer beneath it. That is exactly the layer the all-or-safe guarantee has to hold at, because
    // the wire check is a first line of defence and not the last one.
    const c = client(url);
    await c.open();
    c.send(joinMessage('kid', GUEST));
    const welcome = await c.waitFor('welcome');

    const result = game.rewards.restoreProfileFacts(welcome.id, [
      { eventId: 'xp:mixed:valid', type: 'xp-earned', value: '90' },
      { eventId: 'mark:mixed:valid', type: 'mark-earned' },
      { eventId: 'xp:mixed:bad', type: 'xp-earned', value: '-90' },
      { eventId: 'xp:mixed:also-bad', type: 'xp-earned', value: '3.5' },
    ]);
    c.close();

    assert.equal(result.refused, 2, 'both malformed amounts are refused');
    assert.equal(result.restored, 2, 'and the two well-formed facts are still recovered');

    const facts = await rejoinAndReadFacts(url);
    assert.equal(foldFacts(facts).xp, 90, 'only the well-formed amount became progression');
    assert.equal(facts.filter((f) => f.type === 'xp-earned').length, 1,
      'no malformed amount reached the disk in any form');
  });
});
