import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  PROTOCOL_VERSION,
  ProtocolError,
  attackMessage,
  collectLootMessage,
  decode,
  encode,
  equipMessage,
  inputMessage,
  joinMessage,
  leaveMessage,
  searchCartMessage,
  snapshotMessage,
  villageUpgradePurchaseMessage,
  welcomeMessage,
} from '../public/src/net/protocol.js';

const roundTrip = (message) => decode(encode(message));

// A minimal but fully-populated encounter block, reused by the tests below. welcome/snapshot both
// require one under protocol 3, so every existing round-trip that builds those two message types
// has to supply one -- there is no version of this fixture that predates the bump.
const ENCOUNTER_FIXTURE = {
  revision: 5,
  wolf: { x: 2.5, z: 8, heading: 0.1, hp: 2, mode: 'walk', targetId: null },
  heroes: {
    p1: { hp: 3, swingSeconds: -1, cooldown: 0, downSeconds: -1 },
    p2: { hp: 1, swingSeconds: 0.2, cooldown: 0.5, downSeconds: 1.4 },
  },
  // Phase D (D3): present and empty rather than omitted, so this fixture matches what a real
  // gameServer.mjs snapshot always carries today. See "an encounter block with no rewards key at
  // all still decodes" below for the backward-compatibility case this fixture used to cover.
  rewards: {},
  // GP2: same "present and empty, matches what a real snapshot always carries" reasoning as rewards
  // above -- a fresh cart, not yet searched. See "an encounter block with no loot key at all still
  // decodes" below for the pre-GP2 backward-compatibility case this fixture used to cover.
  loot: { spawned: false, collected: {} },
  // GP3: same "present and empty, matches what a real snapshot always carries" reasoning again --
  // nothing earned yet, Workshop I not bought. See "an encounter block with no village key at all
  // still decodes" below for the pre-GP3 backward-compatibility case this fixture used to cover.
  village: { coins: 0, shards: 0, workshopOwned: false },
};

const EVENTS_FIXTURE = [
  { type: 'wolf-hit', heroId: 'p1', remaining: 1 },
  { type: 'bite-missed' },
];

test('every builder produces something the decoder accepts unchanged', () => {
  assert.deepEqual(roundTrip(joinMessage('kid-one')), {
    v: PROTOCOL_VERSION, type: 'join', name: 'kid-one',
  });
  assert.deepEqual(roundTrip(welcomeMessage('p1', 42, [], ENCOUNTER_FIXTURE)), {
    v: PROTOCOL_VERSION, type: 'welcome', id: 'p1', tick: 42, players: [], encounter: ENCOUNTER_FIXTURE,
  });
  assert.deepEqual(roundTrip(inputMessage(7, 0, 1, 0.5, false)), {
    v: PROTOCOL_VERSION, type: 'input', seq: 7, dirX: 0, dirZ: 1, magnitude: 0.5, run: false,
  });
  assert.deepEqual(roundTrip(leaveMessage('p2')), { v: PROTOCOL_VERSION, type: 'leave', id: 'p2' });

  const snapshot = snapshotMessage(
    3,
    [{ id: 'p1', x: 1.5, z: -2.25, heading: 0.75, speed: 1.4 }],
    ENCOUNTER_FIXTURE,
    EVENTS_FIXTURE,
  );
  assert.deepEqual(roundTrip(snapshot), {
    v: PROTOCOL_VERSION,
    type: 'snapshot',
    tick: 3,
    players: [{ id: 'p1', x: 1.5, z: -2.25, heading: 0.75, speed: 1.4 }],
    encounter: ENCOUNTER_FIXTURE,
    events: EVENTS_FIXTURE,
  });
});

test('attackMessage round-trips and seq must be a non-negative integer', () => {
  assert.deepEqual(roundTrip(attackMessage(7)), { v: PROTOCOL_VERSION, type: 'attack', seq: 7 });

  assert.throws(() => decode(encode({ ...attackMessage(7), seq: -1 })), ProtocolError,
    'a negative seq is not a sequence number');
  assert.throws(() => decode(encode({ ...attackMessage(7), seq: 1.5 })), ProtocolError,
    'a fractional seq is not a sequence number');
});

test('equipMessage round-trips and itemId must be a non-empty, capped string', () => {
  assert.deepEqual(roundTrip(equipMessage('wildwood_blade')), {
    v: PROTOCOL_VERSION, type: 'equip', itemId: 'wildwood_blade',
  });

  assert.throws(() => decode(encode({ ...equipMessage('x'), itemId: '' })), ProtocolError,
    'an empty itemId is not an item');
  assert.throws(() => decode(encode({ ...equipMessage('x'), itemId: 42 })), ProtocolError,
    'itemId must be a string');
  assert.throws(() => decode(encode({ ...equipMessage('x'), itemId: 'x'.repeat(33) })), ProtocolError,
    'itemId longer than the cap is rejected, same discipline as any other wire string');
});

test('a snapshot with an encounter block round-trips intact', () => {
  const snapshot = snapshotMessage(9, [], ENCOUNTER_FIXTURE, EVENTS_FIXTURE);
  assert.deepEqual(roundTrip(snapshot), {
    v: PROTOCOL_VERSION,
    type: 'snapshot',
    tick: 9,
    players: [],
    encounter: ENCOUNTER_FIXTURE,
    events: EVENTS_FIXTURE,
  });

  // targetId is string|null on the wire -- exercise the non-null branch too.
  const targeting = { ...ENCOUNTER_FIXTURE, wolf: { ...ENCOUNTER_FIXTURE.wolf, targetId: 'p1' } };
  assert.deepEqual(roundTrip(snapshotMessage(9, [], targeting, [])).encounter, targeting);
});

test('a welcome message carries the current encounter block for a late joiner', () => {
  const welcome = welcomeMessage('p1', 3, [], ENCOUNTER_FIXTURE);
  assert.deepEqual(roundTrip(welcome), {
    v: PROTOCOL_VERSION,
    type: 'welcome',
    id: 'p1',
    tick: 3,
    players: [],
    encounter: ENCOUNTER_FIXTURE,
  });
});

test('a wolf.mode outside the known set is rejected', () => {
  const flying = { ...ENCOUNTER_FIXTURE, wolf: { ...ENCOUNTER_FIXTURE.wolf, mode: 'flying' } };
  assert.throws(() => decode(encode(snapshotMessage(1, [], flying, []))), ProtocolError);
});

test('a decoded message carries no fields the sender smuggled in', () => {
  // The decoder rebuilds rather than filters, so an extra key cannot ride along into game state.
  const smuggled = { ...inputMessage(1, 0, 1, 1, true), admin: true, magnitude2: 99 };
  const decoded = decode(encode(smuggled));
  assert.deepEqual(Object.keys(decoded).sort(), ['dirX', 'dirZ', 'magnitude', 'run', 'seq', 'type', 'v']);
});

test('version and type are gates, not suggestions', () => {
  assert.throws(() => decode(encode({ ...joinMessage('a'), v: 2 })), ProtocolError);
  assert.throws(() => decode(encode({ ...joinMessage('a'), v: '1' })), ProtocolError);
  assert.throws(() => decode(encode({ v: PROTOCOL_VERSION, type: 'shutdown' })), ProtocolError);
  assert.throws(() => decode(encode({ v: PROTOCOL_VERSION })), ProtocolError);

  // 2 was burned by phase-2-tracer's incompatible handshake (Design ruling 2) and 1 is the old
  // wire -- both a stale and a rogue tab must fail loudly at decode, naming 3 as what is expected.
  assert.throws(() => decode(encode({ ...joinMessage('a'), v: 1 })), ProtocolError,
    /expected 3/);
  assert.throws(() => decode(encode({ ...joinMessage('a'), v: 2 })), ProtocolError,
    /expected 3/);
});

test('malformed payloads are rejected before they become game state', () => {
  assert.throws(() => decode('not json at all'), ProtocolError);
  assert.throws(() => decode('[]'), ProtocolError, 'a bare array is not a message');
  assert.throws(() => decode('null'), ProtocolError);
  assert.throws(() => decode('7'), ProtocolError);
  assert.throws(() => decode(undefined), ProtocolError);
});

// NaN is the dangerous one: it propagates through position maths silently until every coordinate is
// NaN and the hero vanishes, with nothing in the log to say when it started. JSON cannot even carry
// it -- JSON.stringify turns NaN into null -- so both spellings have to bounce.
test('non-finite numbers cannot reach the simulation', () => {
  for (const bad of ['null', 'NaN', '"1"', 'true', '1e999']) {
    const text = `{"v":1,"type":"input","seq":1,"dirX":0,"dirZ":1,"magnitude":${bad},"run":false}`;
    assert.throws(() => decode(text), ProtocolError, `magnitude ${bad} should be rejected`);
  }
  assert.throws(
    () => decode(encode({ ...inputMessage(1, 0, 1, 1, false), dirX: Number.NaN })),
    ProtocolError,
    'NaN survives JSON.stringify as null and must still be rejected',
  );
  assert.throws(() => decode(encode({ ...inputMessage(1.5, 0, 1, 1, false) })), ProtocolError,
    'a fractional sequence number is not a sequence number');
});

test('direction must be unit-or-zero and magnitude must be a fraction', () => {
  // Zero means stop, and is legal.
  assert.equal(decode(encode(inputMessage(1, 0, 0, 0, false))).magnitude, 0);

  // Over-long: a client that forgot to normalise would move faster diagonally, the classic bug.
  assert.throws(() => decode(encode(inputMessage(1, 1, 1, 1, false))), ProtocolError,
    'an un-normalised diagonal (length 1.41) must be rejected');
  assert.throws(() => decode(encode(inputMessage(1, 5, 0, 1, false))), ProtocolError);

  // Short-but-not-zero: this is the c75242c defect arriving over the wire. If the server accepted a
  // 0.5-length direction AND a 0.5 magnitude it would apply the deflection twice.
  assert.throws(() => decode(encode(inputMessage(1, 0, 0.5, 0.5, false))), ProtocolError,
    'a half-length direction must be rejected, not silently squared');

  // Magnitude outside [0, 1].
  assert.throws(() => decode(encode(inputMessage(1, 0, 1, 1.5, false))), ProtocolError);
  assert.throws(() => decode(encode(inputMessage(1, 0, 1, -0.1, false))), ProtocolError);

  // Float slack: a normalised vector can miss unit length by an ulp or two and must still pass.
  const almost = 1 - 1e-12;
  assert.doesNotThrow(() => decode(encode(inputMessage(1, 0, almost, 1, false))));
  const diagonal = Math.SQRT1_2;
  assert.doesNotThrow(() => decode(encode(inputMessage(1, diagonal, diagonal, 1, false))));
});

test('player lists in snapshots are validated per entry', () => {
  const withBadEntry = {
    v: 1,
    type: 'snapshot',
    tick: 1,
    players: [{ id: 'ok', x: 0, z: 0, heading: 0, speed: 0 }, { id: 'broken', x: 0, z: 0 }],
  };
  assert.throws(() => decode(encode(withBadEntry)), ProtocolError, 'missing heading/speed');
  assert.throws(() => decode(encode({ v: 1, type: 'snapshot', tick: 1, players: 'none' })),
    ProtocolError, 'players must be an array');
  assert.throws(() => decode(encode({ v: 1, type: 'snapshot', tick: 1, players: [null] })),
    ProtocolError);
});

test('strings are length-capped so a name cannot be a payload', () => {
  assert.doesNotThrow(() => decode(encode(joinMessage('a'.repeat(32)))));
  assert.throws(() => decode(encode(joinMessage('a'.repeat(33)))), ProtocolError);
  assert.throws(() => decode(encode(joinMessage(12))), ProtocolError);
});

// Task B4.5: enemies/wolf.js's presenter reads wolf.modeSeconds to decide whether a one-shot clip
// re-entered mid-mode needs restarting (a second hero's hit landing mid-stagger re-flinches the
// wolf), and B2's wire block omitted it -- so the re-flinch never fired online. Added here as its
// own field, present-and-validated rather than defaulted, so the B2-era ENCOUNTER_FIXTURE (which
// never carried it) keeps round-tripping unedited above.
test('wolf.modeSeconds rides the wire and round-trips intact', () => {
  const withModeSeconds = {
    ...ENCOUNTER_FIXTURE,
    wolf: { ...ENCOUNTER_FIXTURE.wolf, modeSeconds: 0.734 },
  };
  const snapshot = snapshotMessage(9, [], withModeSeconds, []);
  assert.deepEqual(roundTrip(snapshot).encounter, withModeSeconds);
  assert.equal(roundTrip(snapshot).encounter.wolf.modeSeconds, 0.734);

  const welcome = welcomeMessage('p1', 3, [], withModeSeconds);
  assert.deepEqual(roundTrip(welcome).encounter, withModeSeconds);
});

test('a negative wolf.modeSeconds is rejected', () => {
  const negative = {
    ...ENCOUNTER_FIXTURE,
    wolf: { ...ENCOUNTER_FIXTURE.wolf, modeSeconds: -0.001 },
  };
  assert.throws(() => decode(encode(snapshotMessage(1, [], negative, []))), ProtocolError,
    'a negative modeSeconds is not a time-in-mode');
});

// ── Phase D (D3): guestId on join ────────────────────────────────────────────────────────────────

test('joinMessage omits guestId entirely when none is supplied -- byte-identical to pre-D3', () => {
  assert.deepEqual(roundTrip(joinMessage('kid-one')), {
    v: PROTOCOL_VERSION, type: 'join', name: 'kid-one',
  });
  assert.deepEqual(Object.keys(roundTrip(joinMessage('kid-one'))).sort(), ['name', 'type', 'v']);
});

test('a well-formed guestId rides the wire and round-trips intact', () => {
  const withGuest = joinMessage('kid-one', 'abcd1234-guest-token');
  assert.deepEqual(roundTrip(withGuest), {
    v: PROTOCOL_VERSION, type: 'join', name: 'kid-one', guestId: 'abcd1234-guest-token',
  });
});

test('a real crypto.randomUUID() shape is accepted (36 chars, hyphens included)', () => {
  const uuid = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  assert.doesNotThrow(() => decode(encode(joinMessage('kid', uuid))));
});

test('guestId is validated against [A-Za-z0-9-]{8,64} -- too short, too long, or wrong alphabet all fail', () => {
  assert.throws(() => decode(encode({ ...joinMessage('kid'), guestId: 'short' })), ProtocolError,
    'under 8 characters');
  assert.throws(() => decode(encode({ ...joinMessage('kid'), guestId: 'a'.repeat(65) })), ProtocolError,
    'over 64 characters');
  assert.throws(() => decode(encode({ ...joinMessage('kid'), guestId: 'has spaces!!' })), ProtocolError,
    'outside the validated alphabet');
  assert.throws(() => decode(encode({ ...joinMessage('kid'), guestId: 12345678 })), ProtocolError,
    'guestId must be a string, not a number');
});

test('an absent guestId decodes cleanly -- the server treats the connection as ephemeral', () => {
  const decoded = decode(encode({ v: PROTOCOL_VERSION, type: 'join', name: 'kid' }));
  assert.equal('guestId' in decoded, false);
});

test('joinMessage ignores an empty-string guestId rather than sending a token that fails validation', () => {
  assert.deepEqual(Object.keys(joinMessage('kid', '')), ['v', 'type', 'name']);
});

// ── Phase D (D3): rewards on the encounter block ─────────────────────────────────────────────────

test('an encounter block with no rewards key at all still decodes, defaulting to {}', () => {
  const preD3Shape = {
    revision: 5,
    wolf: { x: 2.5, z: 8, heading: 0.1, hp: 2, mode: 'walk', targetId: null },
    heroes: { p1: { hp: 3, swingSeconds: -1, cooldown: 0, downSeconds: -1 } },
  };
  const decoded = decode(encode(welcomeMessage('p1', 3, [], preD3Shape)));
  assert.deepEqual(decoded.encounter.rewards, {});
});

test('rewards rides the wire per hero and round-trips intact', () => {
  const withRewards = {
    ...ENCOUNTER_FIXTURE,
    rewards: {
      p1: { marks: 2, lanternUnlocked: false },
      p2: { marks: 3, lanternUnlocked: true },
    },
  };
  const snapshot = snapshotMessage(9, [], withRewards, []);
  assert.deepEqual(roundTrip(snapshot).encounter, withRewards);

  const welcome = welcomeMessage('p1', 3, [], withRewards);
  assert.deepEqual(roundTrip(welcome).encounter, withRewards);
});

test('rewards.<id>.marks must be a non-negative integer', () => {
  const negative = { ...ENCOUNTER_FIXTURE, rewards: { p1: { marks: -1, lanternUnlocked: false } } };
  assert.throws(() => decode(encode(snapshotMessage(1, [], negative, []))), ProtocolError,
    'a negative mark count is nonsense');

  const fractional = { ...ENCOUNTER_FIXTURE, rewards: { p1: { marks: 1.5, lanternUnlocked: false } } };
  assert.throws(() => decode(encode(snapshotMessage(1, [], fractional, []))), ProtocolError,
    'marks are a count, not a fraction');
});

test('rewards.<id>.lanternUnlocked is coerced to a boolean rather than validated strictly', () => {
  // Matches decodeHeroes'/decodePlayers' own convention elsewhere in this file: booleans on the wire
  // are Boolean()-coerced, not type-gated, because JSON has no way to smuggle something dangerous
  // through a truthiness check the way a string or object could.
  const decoded = decode(encode(snapshotMessage(
    1, [], { ...ENCOUNTER_FIXTURE, rewards: { p1: { marks: 1, lanternUnlocked: 1 } } }, [],
  )));
  assert.equal(decoded.encounter.rewards.p1.lanternUnlocked, true);
});

test('rewards must be an object, not an array or a primitive', () => {
  assert.throws(() => decode(encode(snapshotMessage(1, [], { ...ENCOUNTER_FIXTURE, rewards: [] }, []))),
    ProtocolError);
  assert.throws(() => decode(encode(snapshotMessage(1, [], { ...ENCOUNTER_FIXTURE, rewards: 'nope' }, []))),
    ProtocolError);
});

test('rewards.<id>.equippedWeaponId is optional, additive, and round-trips when present', () => {
  const withEquip = { ...ENCOUNTER_FIXTURE, rewards: { p1: { marks: 0, lanternUnlocked: false, equippedWeaponId: 'wildwood_blade' } } };
  assert.deepEqual(roundTrip(snapshotMessage(1, [], withEquip, [])).encounter, withEquip);

  // Absent entirely -- every pre-GP1 fixture and caller -- decodes with no key at all, not a default
  // value smuggled in by this layer (the caller decides the default; see progression/items.js).
  const withoutEquip = { ...ENCOUNTER_FIXTURE, rewards: { p1: { marks: 0, lanternUnlocked: false } } };
  const decoded = decode(encode(snapshotMessage(1, [], withoutEquip, [])));
  assert.equal('equippedWeaponId' in decoded.encounter.rewards.p1, false);
});

test('rewards.<id>.equippedWeaponId must be a string when present', () => {
  assert.throws(() => decode(encode(snapshotMessage(
    1, [], { ...ENCOUNTER_FIXTURE, rewards: { p1: { marks: 0, lanternUnlocked: false, equippedWeaponId: 7 } } }, [],
  ))), ProtocolError);
});

test('rewards.<id>.coins and .shards are optional, additive, and round-trip when present', () => {
  const withLoot = { ...ENCOUNTER_FIXTURE, rewards: { p1: { marks: 0, lanternUnlocked: false, coins: 3, shards: 2 } } };
  assert.deepEqual(roundTrip(snapshotMessage(1, [], withLoot, [])).encounter, withLoot);

  // Absent entirely -- every pre-GP2 fixture and caller -- decodes with no key at all, same treatment
  // equippedWeaponId's own test above gives it.
  const without = { ...ENCOUNTER_FIXTURE, rewards: { p1: { marks: 0, lanternUnlocked: false } } };
  const decoded = decode(encode(snapshotMessage(1, [], without, [])));
  assert.equal('coins' in decoded.encounter.rewards.p1, false);
  assert.equal('shards' in decoded.encounter.rewards.p1, false);
});

test('rewards.<id>.coins and .shards must be non-negative integers', () => {
  assert.throws(() => decode(encode(snapshotMessage(
    1, [], { ...ENCOUNTER_FIXTURE, rewards: { p1: { marks: 0, lanternUnlocked: false, coins: -1 } } }, [],
  ))), ProtocolError, 'a negative coin count is nonsense');
  assert.throws(() => decode(encode(snapshotMessage(
    1, [], { ...ENCOUNTER_FIXTURE, rewards: { p1: { marks: 0, lanternUnlocked: false, shards: 1.5 } } }, [],
  ))), ProtocolError, 'shards are a count, not a fraction');
});

// ── GP2: search-cart / collect-loot messages and the encounter block's loot field ─────────────────

test('searchCartMessage round-trips with no payload', () => {
  assert.deepEqual(roundTrip(searchCartMessage()), { v: PROTOCOL_VERSION, type: 'search-cart' });
});

test('collectLootMessage round-trips and pickupId must be a non-empty, capped string', () => {
  assert.deepEqual(roundTrip(collectLootMessage('cart-loot:coin:0')), {
    v: PROTOCOL_VERSION, type: 'collect-loot', pickupId: 'cart-loot:coin:0',
  });
  assert.throws(() => decode(encode({ ...collectLootMessage('x'), pickupId: '' })), ProtocolError,
    'an empty pickupId is not a pickup');
  assert.throws(() => decode(encode({ ...collectLootMessage('x'), pickupId: 42 })), ProtocolError,
    'pickupId must be a string');
  assert.throws(() => decode(encode({ ...collectLootMessage('x'), pickupId: 'x'.repeat(49) })), ProtocolError,
    'pickupId longer than the cap is rejected, same discipline equip\'s itemId already follows');
});

test('an encounter block with no loot key at all still decodes, defaulting to not-yet-searched', () => {
  const preGp2Shape = {
    revision: 5,
    wolf: { x: 2.5, z: 8, heading: 0.1, hp: 2, mode: 'walk', targetId: null },
    heroes: { p1: { hp: 3, swingSeconds: -1, cooldown: 0, downSeconds: -1 } },
  };
  const decoded = decode(encode(welcomeMessage('p1', 3, [], preGp2Shape)));
  assert.deepEqual(decoded.encounter.loot, { spawned: false, collected: {} });
});

test('loot.collected rides the wire and round-trips intact', () => {
  const collected = {
    ...ENCOUNTER_FIXTURE,
    loot: { spawned: true, collected: { 'cart-loot:coin:0': 'p1', 'cart-loot:shard:1': 'p2' } },
  };
  const snapshot = snapshotMessage(9, [], collected, []);
  assert.deepEqual(roundTrip(snapshot).encounter, collected);

  const welcome = welcomeMessage('p1', 3, [], collected);
  assert.deepEqual(roundTrip(welcome).encounter, collected);
});

test('loot.collected values must be strings (a collector\'s heroId), not smuggled objects', () => {
  const bad = { ...ENCOUNTER_FIXTURE, loot: { spawned: true, collected: { 'cart-loot:coin:0': 7 } } };
  assert.throws(() => decode(encode(snapshotMessage(1, [], bad, []))), ProtocolError);
});

// ── GP3: village-upgrade-purchase message and the encounter block's village field ──────────────

test('villageUpgradePurchaseMessage round-trips and upgradeId must be a non-empty, capped string', () => {
  assert.deepEqual(roundTrip(villageUpgradePurchaseMessage('village-upgrade:workshop:1')), {
    v: PROTOCOL_VERSION, type: 'village-upgrade-purchase', upgradeId: 'village-upgrade:workshop:1',
  });
  assert.throws(() => decode(encode({ ...villageUpgradePurchaseMessage('x'), upgradeId: '' })), ProtocolError,
    'an empty upgradeId is not an upgrade');
  assert.throws(() => decode(encode({ ...villageUpgradePurchaseMessage('x'), upgradeId: 42 })), ProtocolError,
    'upgradeId must be a string');
  assert.throws(() => decode(encode({ ...villageUpgradePurchaseMessage('x'), upgradeId: 'x'.repeat(49) })), ProtocolError,
    'upgradeId longer than the cap is rejected, same discipline collect-loot\'s pickupId already follows');
});

test('an encounter block with no village key at all still decodes, defaulting to nothing earned/bought', () => {
  const preGp3Shape = {
    revision: 5,
    wolf: { x: 2.5, z: 8, heading: 0.1, hp: 2, mode: 'walk', targetId: null },
    heroes: { p1: { hp: 3, swingSeconds: -1, cooldown: 0, downSeconds: -1 } },
  };
  const decoded = decode(encode(welcomeMessage('p1', 3, [], preGp3Shape)));
  assert.deepEqual(decoded.encounter.village, { coins: 0, shards: 0, workshopOwned: false });
});

test('village rides the wire and round-trips intact -- shared totals plus Workshop I ownership', () => {
  const withVillage = { ...ENCOUNTER_FIXTURE, village: { coins: 3, shards: 2, workshopOwned: true } };
  const snapshot = snapshotMessage(9, [], withVillage, []);
  assert.deepEqual(roundTrip(snapshot).encounter, withVillage);

  const welcome = welcomeMessage('p1', 3, [], withVillage);
  assert.deepEqual(roundTrip(welcome).encounter, withVillage);
});

test('village.coins and village.shards must be non-negative integers', () => {
  const negativeCoins = { ...ENCOUNTER_FIXTURE, village: { coins: -1, shards: 0, workshopOwned: false } };
  assert.throws(() => decode(encode(snapshotMessage(1, [], negativeCoins, []))), ProtocolError);

  const fractionalShards = { ...ENCOUNTER_FIXTURE, village: { coins: 0, shards: 1.5, workshopOwned: false } };
  assert.throws(() => decode(encode(snapshotMessage(1, [], fractionalShards, []))), ProtocolError);
});

test('loot must be an object, and loot.collected must be an object, not an array or a primitive', () => {
  assert.throws(() => decode(encode(snapshotMessage(1, [], { ...ENCOUNTER_FIXTURE, loot: [] }, []))),
    ProtocolError);
  assert.throws(() => decode(encode(snapshotMessage(
    1, [], { ...ENCOUNTER_FIXTURE, loot: { spawned: true, collected: [] } }, [],
  ))), ProtocolError);
});
