import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { attachGameServer, createRewardCoordinator, createSimulation } from '../net/gameServerCore.mjs';
import { decode, encode, joinMessage, attackMessage, inputMessage } from '../public/src/net/protocolCore.js';

async function withServer(run, options = {}) {
  const http = createServer();
  const game = attachGameServer(http, { rewardStorePath: ':memory:', allowMissingOrigin: true, ...options });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const clients = [];
  async function connect(name, destinationId, guestId = `profile-${name}-aaaaaaaa`) {
    const socket = new WebSocket(`ws://127.0.0.1:${http.address().port}/ws`);
    const messages = [];
    let closed = false;
    const waiters = new Set();
    const wake = () => { for (const waiter of [...waiters]) waiter(); };
    socket.addEventListener('message', event => { messages.push(decode(event.data)); wake(); });
    socket.addEventListener('close', () => { closed = true; wake(); });
    clients.push(socket);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const client = {
      messages, socket,
      send: message => socket.send(encode(message)),
      wait(predicate) {
        return new Promise((resolve, reject) => {
          const finish = (error, value) => {
            clearTimeout(timer); waiters.delete(check);
            if (error) reject(error); else resolve(value);
          };
          const check = () => {
            const match = messages.find(predicate);
            if (match) finish(null, match);
            else if (closed) finish(new Error('socket closed before expected message'));
          };
          const timer = setTimeout(() => finish(new Error(`timed out waiting for ${predicate}; latest=${JSON.stringify(messages.at(-1))}; events=${JSON.stringify(messages.flatMap(message => message.events ?? []))}`)), 4000);
          waiters.add(check); check();
        });
      },
    };
    client.send(joinMessage(name, guestId, destinationId));
    client.welcome = await client.wait(message => message.type === 'welcome');
    return client;
  }
  try { await run({ game, connect }); }
  finally {
    for (const socket of clients) socket.close();
    game.stop();
    await new Promise(resolve => http.close(resolve));
  }
}

test('real sockets: siblings occupy different destinations with distinct identities and isolated snapshots', async () => {
  await withServer(async ({ connect }) => {
    const a = await connect('younger', 'village');
    const b = await connect('older', 'emberworks-deep');
    assert.notEqual(a.welcome.id, b.welcome.id);
    for (const child of [a, b]) {
      const snapshot = await child.wait(message => message.type === 'snapshot'
        && message.tick > child.welcome.tick);
      assert.deepEqual(snapshot.players.map(player => player.id), [child.welcome.id]);
      assert.deepEqual(Object.keys(snapshot.encounter.rewards), [child.welcome.id]);
    }
    assert.equal(b.welcome.destinationId, 'emberworks-deep');
    assert.equal(b.welcome.encounter.enemies[0].kind, 'lava-gremlin');
    assert.ok(a.messages.filter(message => message.type === 'snapshot')
      .every(message => message.destinationId !== 'emberworks-deep'));
  });
});

test('the playtest hub is a small safe destination with no inherited adventure enemies', () => {
  const hub = createSimulation({ destinationId: 'home-hub' });
  const hero = hub.addPlayer('younger');
  assert.deepEqual({ x: hero.x, z: hero.z }, { x: 0, z: 0 });
  assert.deepEqual(hub.encounterSnapshot().enemies, []);
  hero.x = 100; hero.z = -100; hub.step(0, 0);
  assert.deepEqual({ x: hero.x, z: hero.z }, { x: 9, z: -7 });
});

test('real sockets: travel preserves the sibling fight, acknowledges arrival and rejects old-world controls', async () => {
  await withServer(async ({ game, connect }) => {
    const a = await connect('younger', 'emberworks-deep');
    const b = await connect('older', 'emberworks-deep');
    const room = game.simulationFor('emberworks-deep');
    const body = room.players.get(a.welcome.id);
    body.x = -4; body.z = 7.5;
    room.step(0, Date.now());
    a.send(attackMessage(1));
    const hit = await a.wait(message => message.type === 'snapshot' && message.encounter.enemies[0].hp === 20);
    // Remove the attacker from reach without changing the enemy's health, so this test measures
    // travel continuity rather than chasing/leash timing.
    body.x = 0; body.z = 4;
    b.send({ v: 4, type: 'travel', destinationId: 'village', worldEpoch: 0 });
    b.send({ ...inputMessage(999, 1, 0, 1, false), worldEpoch: 0 });
    b.send({ ...attackMessage(999), worldEpoch: 0 });
    const arrived = await b.wait(message => message.type === 'destination-changed' && message.worldEpoch === 1);
    assert.equal(arrived.destinationId, 'village');
    assert.equal(arrived.id, b.welcome.id);
    const away = await a.wait(message => message.type === 'snapshot' && message.tick > hit.tick
      && message.players.length === 1);
    assert.equal(away.encounter.enemies[0].hp, 20);
    assert.equal(room.players.has(b.welcome.id), false);
    const stopped = await b.wait(message => message.type === 'snapshot' && message.worldEpoch === 1);
    assert.deepEqual(stopped.players.map(({ x, z, speed }) => ({ x, z, speed })), [{ x: 0, z: 0, speed: 0 }]);
    assert.equal(stopped.encounter.heroes[b.welcome.id].swingSeconds, -1);
    b.send({ v: 4, type: 'travel', destinationId: 'emberworks-deep', worldEpoch: 1 });
    const reunited = await b.wait(message => message.type === 'destination-changed' && message.worldEpoch === 2);
    assert.equal(reunited.encounter.enemies[0].hp, 20);
    assert.deepEqual(new Set(reunited.players.map(p => p.id)), new Set([a.welcome.id, b.welcome.id]));
    assert.equal(room, game.simulationFor('emberworks-deep'));
    b.send({ ...inputMessage(1, 1, 0, 1, false), worldEpoch: 2 });
    await b.wait(message => message.type === 'snapshot' && message.worldEpoch === 2
      && message.players.find(p => p.id === b.welcome.id)?.x > 0);
  });
});

test('shared reward authority keeps equal enemy IDs in different destinations independent', () => {
  const rewards = createRewardCoordinator({ rewardStorePath: ':memory:' });
  try {
    rewards.join('p1', 'profile-aaaaaaaa'); rewards.join('p2', 'profile-bbbbbbbb');
    rewards.processTick([{ type: 'wolf-hit', enemyId: 'guard', kind: 'wolf', heroId: 'p1' }], 'village');
    rewards.processTick([{ type: 'wolf-defeated', enemyId: 'guard', kind: 'wolf', level: 1, heroId: 'p2' }], 'emberworks-deep');
    const rows = rewards.rewardsFor(['p1', 'p2']);
    assert.equal(rows.p1.xp, 0); assert.equal(rows.p1.marks, 0);
    assert.ok(rows.p2.xp > 0); assert.equal(rows.p2.marks, 1);
  } finally { rewards.close(); }
});

test('real sockets: travel carries health and cooldowns; reconnect restores only the returning profile', async () => {
  await withServer(async ({ game, connect }) => {
    const a = await connect('younger', 'emberworks-deep', 'profile-aaaaaaaa');
    const b = await connect('older', 'village', 'profile-bbbbbbbb');
    const room = game.simulationFor('emberworks-deep');
    const travelBody = { hp: 17, maxHp: 30, cooldown: 5, downSeconds: -1,
      protectionSeconds: 0, specialCooldown: 7 };
    room.restorePlayerBody(a.welcome.id, travelBody);
    game.rewards.applyLootAward(a.welcome.id, 'travel-test-coin', 'coin');
    a.send({ v: 4, type: 'travel', destinationId: 'village', worldEpoch: 0 });
    const arrived = await a.wait(message => message.type === 'destination-changed');
    const hero = arrived.encounter.heroes[a.welcome.id];
    assert.equal(hero.hp, 17); assert.equal(hero.maxHp, 30);
    assert.ok(hero.cooldown > 4); assert.ok(hero.specialCooldown > 6);
    assert.equal(hero.swingSeconds, -1);
    assert.equal(arrived.encounter.rewards[a.welcome.id].coins, 1);
    a.socket.close();
    await b.wait(message => message.type === 'leave' && message.id === a.welcome.id);
    const returned = await connect('younger-again', 'emberworks-deep', 'profile-aaaaaaaa');
    assert.notEqual(returned.welcome.id, a.welcome.id);
    assert.equal(returned.welcome.encounter.rewards[returned.welcome.id].coins, 1);
    assert.equal(returned.welcome.profileFacts.filter(fact => fact.eventId === 'travel-test-coin').length, 1);
    assert.equal(game.rewards.rewardsFor([b.welcome.id])[b.welcome.id].coins, 0);
    assert.equal(game.simulationFor('village').players.has(b.welcome.id), true);
  });
});

test('travel protocol requires a bounded epoch and a nonempty destination', () => {
  for (const worldEpoch of [undefined, null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => decode(encode({ v: 4, type: 'travel', destinationId: 'village', worldEpoch })), /worldEpoch/);
  }
  assert.throws(() => decode(encode({ v: 4, type: 'travel', destinationId: '', worldEpoch: 0 })), /destinationId/);
  assert.deepEqual(decode(encode({ ...attackMessage(5), worldEpoch: 2 })), { ...attackMessage(5), worldEpoch: 2 });
});

test('real sockets: a returning contributor receives earned XP in their current destination', async () => {
  await withServer(async ({ game, connect }) => {
    const a = await connect('younger', 'emberworks-deep', 'profile-aaaaaaaa');
    const b = await connect('older', 'emberworks-deep', 'profile-bbbbbbbb');
    const room = game.simulationFor('emberworks-deep');
    const stage = id => {
      Object.assign(room.players.get(id), { x: -4, z: 7.5, heading: 0 });
      room.step(0, Date.now());
    };
    stage(a.welcome.id);
    a.send(attackMessage(1));
    await a.wait(message => message.type === 'snapshot' && message.encounter.enemies[0].hp === 20);
    a.socket.close();
    await b.wait(message => message.type === 'leave' && message.id === a.welcome.id);
    const returned = await connect('younger-again', 'village', 'profile-aaaaaaaa');
    stage(b.welcome.id);
    b.send(attackMessage(1));
    const second = await b.wait(message => message.type === 'snapshot' && message.encounter.enemies[0].hp === 10);
    await b.wait(message => message.type === 'snapshot' && message.tick > second.tick
      && message.encounter.heroes[b.welcome.id].cooldown === 0
      && message.encounter.heroes[b.welcome.id].swingSeconds < 0);
    stage(b.welcome.id); b.send(attackMessage(2));
    await b.wait(message => message.type === 'snapshot' && message.encounter.enemies[0].hp === 0);
    const paid = await returned.wait(message => message.type === 'snapshot'
      && message.encounter.rewards[returned.welcome.id]?.xp > 0);
    assert.ok(paid.events.some(event => event.type === 'xp-earned' && event.heroId === returned.welcome.id));
    assert.equal(paid.players.length, 1);
    assert.ok(paid.encounter.enemies.every(enemy => enemy.kind !== 'lava-gremlin'));
  });
});

test('same profile takeover retires the live old avatar across destinations before accepting more gameplay', async () => {
  await withServer(async ({ game, connect }) => {
    const old = await connect('old', 'emberworks-deep', 'profile-takeover');
    const sibling = await connect('sibling', 'home-hub', 'profile-sibling');
    const oldWire = [...game.ws.clients].find(c => c.data.playerId === old.welcome.id);
    // Keep the physical connection open to attack authority revocation independently of TCP close.
    const close = oldWire.close;
    oldWire.close = () => {};
    const active = await connect('active', 'home-hub', 'profile-takeover');
    oldWire.close = close;
    const count = () => ['emberworks-deep', 'home-hub'].reduce((n, d) => n +
      [...game.simulationFor(d).players.keys()].filter(id => [old.welcome.id, active.welcome.id].includes(id)).length, 0);
    assert.equal(count(), 1, 'old baseline leaves two live avatars for one profile');
    old.send({ ...inputMessage(91, 1, 0, 1, false), worldEpoch: 0 });
    old.send(attackMessage(91));
    old.send(joinMessage('revive', 'profile-takeover', 'emberworks-deep'));
    await active.wait(m => m.type === 'snapshot' && m.tick > active.welcome.tick + 2);
    assert.equal(count(), 1);
    assert.equal(game.simulationFor('emberworks-deep').players.has(old.welcome.id), false);
    assert.equal(game.simulationFor('home-hub').players.has(sibling.welcome.id), true);
    assert.equal(game.rewards.hasDurableIdentity(old.welcome.id), false);
    oldWire.close = close;
  });
});

test('unpublished contribution survives live takeover once and presents only to the active profile', async () => {
  await withServer(async ({ game, connect }) => {
    const old = await connect('old', 'emberworks-deep', 'profile-credit');
    const sibling = await connect('sibling', 'home-hub', 'profile-isolated');
    const room = game.simulationFor('emberworks-deep');
    Object.assign(room.players.get(old.welcome.id), { x: -4, z: 7.5, heading: 0 });
    room.step(0, Date.now());
    // Queue meaningful real combat work without publishing: takeover must settle this before remapping.
    room.applyAttack(old.welcome.id, attackMessage(1)); room.step(0.55, Date.now());
    assert.equal(room.encounterSnapshot().enemies[0].hp, 20);
    const active = await connect('active', 'home-hub', 'profile-credit');
    const finisher = await connect('finisher', 'emberworks-deep', 'profile-finisher');
    const stage = () => {
      Object.assign(room.players.get(finisher.welcome.id), { x: -4, z: 7.5, heading: 0 });
      room.step(0, Date.now());
    };
    stage(); finisher.send(attackMessage(1));
    const hit = await finisher.wait(m => m.type === 'snapshot' && m.encounter.enemies[0].hp === 10);
    await finisher.wait(m => m.type === 'snapshot' && m.tick > hit.tick && m.encounter.heroes[finisher.welcome.id].cooldown === 0 && m.encounter.heroes[finisher.welcome.id].swingSeconds < 0);
    stage(); finisher.send(attackMessage(2));
    const paid = await active.wait(m => m.type === 'snapshot' && m.events.some(e => e.type === 'xp-earned' && e.heroId === active.welcome.id));
    assert.equal(paid.encounter.rewards[active.welcome.id].xp, 20);
    await active.wait(m => m.type === 'snapshot' && m.tick > paid.tick + 3);
    assert.equal(game.rewards.profileFactsFor(active.welcome.id).filter(f => f.type === 'xp-earned').length, 1);
    assert.equal(active.messages.flatMap(m => m.events ?? []).filter(e => e.type === 'xp-earned' && e.heroId === active.welcome.id).length, 1);
    assert.equal(old.messages.flatMap(m => m.events ?? []).filter(e => e.type === 'xp-earned').length, 0);
    assert.equal(game.rewards.rewardsFor([sibling.welcome.id])[sibling.welcome.id].xp, 0);
  });
});

test('invalid same-profile destination cannot evict the valid active session', async () => {
  await withServer(async ({ game, connect }) => {
    const active = await connect('active', 'home-hub', 'profile-valid-join');
    await assert.rejects(connect('invalid', 'not-a-destination', 'profile-valid-join'), /socket closed/);
    assert.equal(game.simulationFor('home-hub').players.has(active.welcome.id), true);
    active.send(inputMessage(1, 1, 0, 1, false));
    await active.wait(m => m.type === 'snapshot' && m.players.some(p => p.id === active.welcome.id && p.x > 0));
  });
});


test('live takeover reattaches an existing personal corpse claim in the departed destination', async () => {
  await withServer(async ({ game, connect }) => {
    const old = await connect('old', 'village', 'profile-corpse-owner');
    const room = game.simulationFor('village');
    const body = room.players.get(old.welcome.id);
    for (let seq = 1; seq <= 25 && room.encounterSnapshot().enemies[0].hp > 0; seq++) {
      const enemy = room.encounterSnapshot().enemies[0];
      Object.assign(body, { x: enemy.x, z: enemy.z - 1.3, heading: 0 });
      room.step(0, Date.now());
      room.applyAttack(old.welcome.id, attackMessage(seq));
      for(let tick=0;tick<34;tick++)room.step(.05,Date.now());
    }
    const before = room.corpsesSnapshot().find(c => c.claims.some(claim => claim.heroId === old.welcome.id));
    assert.ok(before, 'actual combat must create a personal corpse claim before reassignment is tested');
    const active = await connect('active', 'home-hub', 'profile-corpse-owner');
    const after = room.corpsesSnapshot().find(c => c.id === before.id);
    assert.ok(after.claims.some(c => c.heroId === active.welcome.id));
    assert.ok(after.claims.every(c => c.heroId !== old.welcome.id));
    assert.deepEqual(after.claims.find(c => c.heroId === active.welcome.id).items,
      before.claims.find(c => c.heroId === old.welcome.id).items);
    assert.equal(room.players.has(old.welcome.id), false);
  }, { enemies: [{ enemyId: 'claim-wolf', kind: 'frost-wolf', spawn: { x: 0, z: 8 } }], rng: () => 0 });
});
