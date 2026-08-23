import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  NUDGE_FRACTION,
  SNAP_DRIFT_UNITS,
  createNetClient,
  defaultServerUrl,
} from '../public/src/net/client.js';
import { INPUT_SEND_HZ, decode, encode, snapshotMessage, welcomeMessage }
  from '../public/src/net/protocol.js';

// A fake socket, so the client's own logic (throttling, reconciliation, offline handling) can be
// tested without a server. The end-to-end proof that it talks to the real thing is
// game-server.test.mjs plus the two-client CDP harness.
function fakeSocket() {
  const listeners = new Map();
  const sent = [];
  return {
    readyState: 1,
    sent,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    send(data) { sent.push(decode(data)); },
    close() { this.readyState = 3; this.emit('close', {}); },
    emit(type, event) {
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
    deliver(message) { this.emit('message', { data: encode(message) }); },
  };
}

function clientWithFake(options = {}) {
  const socket = fakeSocket();
  let clock = 1000;
  const client = createNetClient({
    url: 'ws://test/ws',
    socketFactory: () => socket,
    now: () => clock,
    ...options,
  });
  return {
    client,
    socket,
    advance: (ms) => { clock += ms; },
    get clock() { return clock; },
  };
}

test('the socket url follows the page, so it cannot point at another host', () => {
  assert.equal(defaultServerUrl({ protocol: 'http:', host: '192.0.2.10:5201' }),
    'ws://192.0.2.10:5201/ws');
  // https must upgrade to wss or the browser blocks it as mixed content.
  assert.equal(defaultServerUrl({ protocol: 'https:', host: 'example.com' }),
    'wss://example.com/ws');
});

test('joining happens on open, and status becomes online only on welcome', () => {
  const statuses = [];
  const { client, socket } = clientWithFake({ onStatus: (s) => statuses.push(s), name: 'kid-a' });
  assert.equal(client.status, 'connecting');
  socket.emit('open', {});
  assert.deepEqual(socket.sent.map((m) => m.type), ['join']);
  assert.equal(socket.sent[0].name, 'kid-a');
  // An open socket is not yet a joined game: until welcome arrives there is no player id.
  assert.equal(client.status, 'connecting');
  socket.deliver(welcomeMessage('p1', 0, []));
  assert.equal(client.status, 'online');
  assert.equal(client.selfId, 'p1');
  assert.deepEqual(statuses, ['connecting', 'online']);
});

// D4: guestId is resolved once at createNetClient() -- reused by reference on every join a
// reconnect sends, since it lives in the outer closure rather than being recomputed inside
// connect(). (Exercising a real reconnect through fakeSocket's single reused instance is not a
// faithful reconnect -- a real one hands back a brand new WebSocket with fresh listeners, which
// this fake cannot cheaply model -- so this test proves the join payload and the getter directly.)
test('an explicit guestId option rides the join, and is readable off the client', () => {
  const { client, socket } = clientWithFake({ guestId: 'abcd1234-explicit-guest' });
  socket.emit('open', {});
  assert.equal(socket.sent[0].guestId, 'abcd1234-explicit-guest');
  assert.equal(client.guestId, 'abcd1234-explicit-guest');
});

// No DOM in this test file (plain `node --test`), so guestId.js's getOrCreateGuestId() finds no
// `window` and falls back to null (ephemeral) on its own -- proven directly in
// test/guest-id.test.mjs. This confirms createNetClient's default wiring reaches that same
// fallback rather than throwing or inventing something else when no guestId option is supplied.
test('with no guestId option and no DOM, the client joins ephemerally rather than throwing', () => {
  const { client, socket } = clientWithFake();
  assert.equal(client.guestId, null);
  socket.emit('open', {});
  assert.equal('guestId' in socket.sent[0], false);
});

test('inputs are throttled to the configured rate', () => {
  const { client, socket, advance } = clientWithFake();
  socket.emit('open', {});
  socket.deliver(welcomeMessage('p1', 0, []));
  socket.sent.length = 0;

  // Sixty frames of held stick at 60fps is one second, which at 15 Hz must be ~15 messages, not 60.
  for (let frame = 0; frame < 60; frame += 1) {
    client.setIntent(0, 1, 1, false);
    advance(1000 / 60);
  }
  const inputs = socket.sent.filter((m) => m.type === 'input');
  assert.ok(inputs.length <= INPUT_SEND_HZ + 1 && inputs.length >= INPUT_SEND_HZ - 2,
    `expected about ${INPUT_SEND_HZ} inputs in a second, got ${inputs.length}`);
  // Sequence numbers must be strictly increasing, or the server will discard them as replays.
  const sequences = inputs.map((m) => m.seq);
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
  assert.equal(new Set(sequences).size, sequences.length, 'sequence numbers must be unique');
});

test('a release is sent immediately rather than waiting for the next slot', () => {
  // Waiting up to 66ms to say "stop" is the difference between a hero that halts and one that
  // overshoots, and overshoot is what a child notices.
  const { client, socket, advance } = clientWithFake();
  socket.emit('open', {});
  socket.deliver(welcomeMessage('p1', 0, []));
  client.setIntent(0, 1, 1, false);
  socket.sent.length = 0;

  advance(5); // nowhere near the 66ms throttle window
  assert.equal(client.setIntent(0, 0, 0, false), true, 'release should send at once');
  const [release] = socket.sent.filter((m) => m.type === 'input');
  assert.equal(release.magnitude, 0);
  assert.equal(release.dirX, 0);
  assert.equal(release.dirZ, 0);

  // But only one: an idle stick must not stream zeroes forever.
  socket.sent.length = 0;
  for (let i = 0; i < 30; i += 1) {
    client.setIntent(0, 0, 0, false);
    advance(20);
  }
  assert.equal(socket.sent.length, 0, 'an idle stick should send nothing');
});

test('what goes on the wire is unit-or-zero, whatever it is handed', () => {
  // The protocol rejects a scaled direction, so this is the guard that keeps the client from being
  // disconnected for the very defect fixed in c75242c.
  const { client, socket, advance } = clientWithFake();
  socket.emit('open', {});
  socket.deliver(welcomeMessage('p1', 0, []));
  socket.sent.length = 0;

  // Hand it a half-length vector, as a caller that forgot to normalise would.
  client.setIntent(0, 0.5, 0.5, false);
  advance(100);
  client.setIntent(3, 4, 1, true); // length 5
  const inputs = socket.sent.filter((m) => m.type === 'input');
  assert.equal(inputs.length, 2);
  for (const input of inputs) {
    const length = Math.hypot(input.dirX, input.dirZ);
    assert.ok(Math.abs(length - 1) < 1e-9, `sent a non-unit direction of length ${length}`);
    // And every message must survive the decoder the server will use.
    assert.doesNotThrow(() => decode(encode(input)));
  }
  assert.equal(inputs[0].magnitude, 0.5, 'magnitude is preserved separately from direction');
});

test('nothing is sent while offline, and setIntent does not throw', () => {
  // The whole offline story: a child with no server still gets a playable hero.
  const { client, socket, advance } = clientWithFake();
  // Never opened, never welcomed.
  assert.equal(client.setIntent(0, 1, 1, false), false);
  advance(1000);
  assert.equal(client.setIntent(0, 1, 1, false), false);
  assert.equal(socket.sent.length, 0);
  assert.equal(client.status, 'connecting');
  assert.deepEqual(client.reconcile({ x: 5, z: 5 }), { drift: 0, snapped: false, corrections: 0 },
    'reconciling with no server data must be a no-op, not a snap to the origin');
});

test('a closed socket goes offline and retries without throwing', () => {
  const statuses = [];
  const { client, socket, advance } = clientWithFake({
    onStatus: (s) => statuses.push(s),
    reconnectDelayMs: 50,
  });
  socket.emit('open', {});
  socket.deliver(welcomeMessage('p1', 0, []));
  assert.equal(client.status, 'online');
  socket.close();
  assert.equal(client.status, 'offline');
  assert.equal(client.selfId, null, 'the player id must not survive the connection');
  // Sampling and intent must both stay safe while offline.
  assert.equal(client.sampleRemotes(2000).size, 0);
  assert.equal(client.setIntent(0, 1, 1, false), false);
  assert.ok(statuses.includes('offline'));
  client.dispose();
});

test('a corrupt message is ignored rather than dropping the session', () => {
  // The server drops a client that sends rubbish; the client must NOT drop the server, or one
  // corrupt frame would end a child's game.
  const { client, socket } = clientWithFake();
  socket.emit('open', {});
  socket.deliver(welcomeMessage('p1', 0, []));
  socket.emit('message', { data: '{"v":99,"type":"nonsense"}' });
  socket.emit('message', { data: 'not json' });
  assert.equal(client.status, 'online', 'still playing');
  socket.deliver(snapshotMessage(1, [{ id: 'p1', x: 1, z: 1, heading: 0, speed: 0 }]));
  assert.equal(client.serverSelf.x, 1, 'and still processing good messages afterwards');
});

test('small drift is nudged, large drift snaps', () => {
  const { client, socket } = clientWithFake();
  socket.emit('open', {});
  socket.deliver(welcomeMessage('p1', 0, []));

  // Server says we are 0.3 away: under the snap threshold, so correct gradually.
  socket.deliver(snapshotMessage(1, [{ id: 'p1', x: 0.3, z: 0, heading: 0, speed: 0 }]));
  const position = { x: 0, z: 0 };
  const nudge = client.reconcile(position);
  assert.equal(nudge.snapped, false);
  assert.ok(Math.abs(nudge.drift - 0.3) < 1e-9);
  assert.ok(Math.abs(position.x - 0.3 * NUDGE_FRACTION) < 1e-9,
    `expected a ${NUDGE_FRACTION} nudge, got ${position.x}`);

  // Repeated nudges must converge, not oscillate or stall -- but only across genuinely new
  // snapshots (10 Hz), not bare calls: each iteration delivers a fresh snapshot before reconciling,
  // matching the real per-snapshot cadence rather than a per-render-frame one.
  for (let i = 0; i < 60; i += 1) {
    socket.deliver(snapshotMessage(2 + i, [{ id: 'p1', x: 0.3, z: 0, heading: 0, speed: 0 }]));
    client.reconcile(position);
  }
  assert.ok(Math.abs(position.x - 0.3) < 0.01, `failed to converge: ${position.x}`);

  // Now a drift past the threshold: snap, because walking that back looks like being dragged.
  socket.deliver(snapshotMessage(100, [{ id: 'p1', x: 10, z: 0, heading: 0, speed: 0 }]));
  const far = { x: 0, z: 0 };
  const snap = client.reconcile(far);
  assert.equal(snap.snapped, true);
  assert.ok(snap.drift > SNAP_DRIFT_UNITS);
  assert.deepEqual([far.x, far.z], [10, 0], 'a snap goes all the way');
});

test('reconcile() only corrects once per new snapshot, not once per call', () => {
  const { client, socket } = clientWithFake();
  socket.emit('open', {});
  socket.deliver(welcomeMessage('p1', 0, []));

  // One new authoritative self-position produces one reconciliation correction.
  socket.deliver(snapshotMessage(1, [{ id: 'p1', x: 0.3, z: 0, heading: 0, speed: 0 }]));
  const position = { x: 0, z: 0 };
  const first = client.reconcile(position);
  assert.ok(first.drift > 0, 'the first reconcile after a new snapshot must apply a correction');
  const afterFirst = { x: position.x, z: position.z };

  // Repeated reconcile() calls without a new authoritative snapshot must not repeatedly apply the
  // same correction -- at 60 fps this would otherwise nudge 6x per snapshot instead of once.
  for (let i = 0; i < 10; i += 1) {
    const repeat = client.reconcile(position);
    assert.deepEqual(repeat, { drift: 0, snapped: false, corrections: 0 },
      'a reconcile() with no new snapshot must be a no-op');
  }
  assert.deepEqual(position, afterFirst, 'position must not move without a new snapshot');

  // A subsequent new snapshot permits another correction.
  socket.deliver(snapshotMessage(2, [{ id: 'p1', x: 0.3, z: 0, heading: 0, speed: 0 }]));
  const second = client.reconcile(position);
  assert.ok(second.drift > 0, 'a new snapshot must permit another correction');
  assert.notDeepEqual(position, afterFirst, 'the second correction must move the position further');
});

// THE OTHER HALF OF THE SAME GATE. The test above proves a fast client cannot take six bites out of
// one snapshot. This one proves a SLOW one still gets all ten bites it was promised, which the flag
// this replaced could not express: it could only ever say "at least one snapshot arrived", so a page
// painting 3 frames a second threw away 7 snapshots in 10 and the hero crawled home at a third of
// the documented rate.
//
// Measured in a real browser before the fix (drive-village under 40x CPU throttle, ~3 fps): the
// drawn hero closed a 0.26m gap from 1.28m to 1.49m over 10.5 SECONDS and had still not arrived,
// against NUDGE_FRACTION's own promise of "under a centimetre in about three seconds". What that
// looks like to a child on a cheap tablet is their hero sliding sideways on his own after they have
// let go of the stick -- and every proximity trigger in the game (the Keeper's wave, his speech
// bubble, the quest marker) reads the DRAWN hero, so the world reacts ten seconds late too.
test('a snapshot backlog is corrected per snapshot, not per frame', () => {
  const { client, socket } = clientWithFake();
  socket.emit('open', {});
  socket.deliver(welcomeMessage('p1', 0, []));

  // Three snapshots arrive between two rendered frames -- the normal case at 3 fps against 10 Hz.
  for (const tick of [1, 2, 3]) {
    socket.deliver(snapshotMessage(tick, [{ id: 'p1', x: 0.3, z: 0, heading: 0, speed: 0 }]));
  }
  const position = { x: 0, z: 0 };
  const applied = client.reconcile(position);
  assert.equal(applied.corrections, 3, 'all three snapshots must be consumed, not just the last');

  // 1-(1-f)^3 IS three separate f-sized bites. Asserted against the compounded value rather than a
  // number typed in by hand, so this test cannot drift away from NUDGE_FRACTION if that ever moves.
  const expected = 0.3 * (1 - (1 - NUDGE_FRACTION) ** 3);
  assert.ok(Math.abs(position.x - expected) < 1e-12,
    `expected ${expected} after three snapshots, got ${position.x}`);
  // And it is emphatically NOT one bite -- this is the assertion the old flag failed.
  assert.ok(position.x > 0.3 * NUDGE_FRACTION * 1.5,
    'three snapshots must move the hero further than one snapshot does');
});

// The property the compounding exists to give, stated directly: the picture a child ends up looking
// at depends on the SNAPSHOTS the server sent, not on how many frames their device managed to paint
// while they arrived. A 60 fps phone and a 3 fps tablet fed the same ten snapshots must draw the
// hero in the same place.
test('the same snapshots put the hero in the same place at any frame rate', () => {
  const authoritative = { id: 'p1', x: 0.3, z: 0, heading: 0, speed: 0 };

  const fast = clientWithFake();
  fast.socket.emit('open', {});
  fast.socket.deliver(welcomeMessage('p1', 0, []));
  const fastPosition = { x: 0, z: 0 };
  for (let tick = 1; tick <= 10; tick += 1) {
    fast.socket.deliver(snapshotMessage(tick, [authoritative]));
    fast.client.reconcile(fastPosition); // one frame per snapshot
  }

  const slow = clientWithFake();
  slow.socket.emit('open', {});
  slow.socket.deliver(welcomeMessage('p1', 0, []));
  const slowPosition = { x: 0, z: 0 };
  for (const batch of [3, 3, 4]) { // ten snapshots, three frames
    for (let i = 0; i < batch; i += 1) {
      slow.socket.deliver(snapshotMessage(i, [authoritative]));
    }
    slow.client.reconcile(slowPosition);
  }

  assert.ok(Math.abs(fastPosition.x - slowPosition.x) < 1e-12,
    `3 fps drew the hero at ${slowPosition.x} where 60 fps drew him at ${fastPosition.x}`);
  assert.ok(Math.abs(fastPosition.z - slowPosition.z) < 1e-12);
});

test('self is excluded from the remotes, so nobody is drawn twice', () => {
  const { client, socket, advance } = clientWithFake();
  socket.emit('open', {});
  socket.deliver(welcomeMessage('p1', 0, []));
  socket.deliver(snapshotMessage(1, [
    { id: 'p1', x: 0, z: 0, heading: 0, speed: 0 },
    { id: 'p2', x: 3, z: 4, heading: 0, speed: 0 },
  ]));
  advance(200);
  const remotes = client.sampleRemotes();
  assert.ok(!remotes.has('p1'), 'the local player must not appear as a remote');
  assert.ok(remotes.has('p2'));
  assert.equal(remotes.size, 1);
});

// -- Task B4: sendAttack() and onEncounter -----------------------------------------------------

test('sendAttack emits a protocol-3 attack frame with its own incrementing seq, only while online', () => {
  const { client, socket } = clientWithFake();
  // Offline: same guard setIntent uses. Nothing should reach the (nonexistent) socket.
  assert.equal(client.sendAttack(), false, 'must not send before the socket is online');

  socket.emit('open', {});
  socket.deliver(welcomeMessage('p1', 0, []));
  socket.sent.length = 0;

  assert.equal(client.sendAttack(), true);
  assert.equal(client.sendAttack(), true);
  assert.equal(client.sendAttack(), true);
  const attacks = socket.sent.filter((m) => m.type === 'attack');
  assert.deepEqual(attacks.map((m) => m.seq), [1, 2, 3],
    'seq must increment on its own counter, independent of setIntent\'s input seq');
  for (const attack of attacks) assert.doesNotThrow(() => decode(encode(attack)));
});

// -- GP1: sendEquip() -----------------------------------------------------------------------

test('sendEquip emits a protocol-3 equip frame with the given itemId, only while online', () => {
  const { client, socket } = clientWithFake();
  assert.equal(client.sendEquip('wildwood_blade'), false, 'must not send before the socket is online');

  socket.emit('open', {});
  socket.deliver(welcomeMessage('p1', 0, []));
  socket.sent.length = 0;

  assert.equal(client.sendEquip('wildwood_blade'), true);
  const equips = socket.sent.filter((m) => m.type === 'equip');
  assert.equal(equips.length, 1);
  assert.equal(equips[0].itemId, 'wildwood_blade');
  assert.doesNotThrow(() => decode(encode(equips[0])));
});

test('a welcome carrying an encounter block invokes onEncounter with the decoded state and no events', () => {
  const encounters = [];
  const { client, socket } = clientWithFake({
    onEncounter: (state, events) => encounters.push({ state, events }),
  });
  socket.emit('open', {});
  socket.deliver(welcomeMessage('p1', 0, [], {
    revision: 3,
    wolf: { x: 1, z: 2, heading: 0, hp: 2, mode: 'idle', targetId: null },
    heroes: { p1: { hp: 3, swingSeconds: -1, cooldown: 0, downSeconds: -1 } },
  }));
  assert.equal(encounters.length, 1);
  assert.equal(encounters[0].state.revision, 3);
  assert.equal(encounters[0].state.wolf.hp, 2);
  assert.deepEqual(encounters[0].state.heroes.p1, { hp: 3, swingSeconds: -1, cooldown: 0, downSeconds: -1 });
  assert.deepEqual(encounters[0].events, [], 'welcome carries no events -- ruling 7');
});

test('a snapshot carrying an encounter block invokes onEncounter with the decoded state and its events', () => {
  const encounters = [];
  const { client, socket } = clientWithFake({
    onEncounter: (state, events) => encounters.push({ state, events }),
  });
  socket.emit('open', {});
  socket.deliver(welcomeMessage('p1', 0, []));
  encounters.length = 0;

  socket.deliver(snapshotMessage(
    1,
    [{ id: 'p1', x: 0, z: 0, heading: 0, speed: 0 }],
    {
      revision: 4,
      wolf: { x: 0, z: 0, heading: 0, hp: 1, mode: 'hit', targetId: null },
      heroes: { p1: { hp: 2, swingSeconds: 0.1, cooldown: 0, downSeconds: -1 } },
    },
    [{ type: 'wolf-hit', heroId: 'p1', remaining: 1 }],
  ));
  assert.equal(encounters.length, 1);
  assert.equal(encounters[0].state.revision, 4);
  assert.equal(encounters[0].state.wolf.mode, 'hit');
  assert.deepEqual(encounters[0].events, [{ type: 'wolf-hit', heroId: 'p1', remaining: 1 }]);
});
