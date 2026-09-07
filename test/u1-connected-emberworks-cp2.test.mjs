import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { attachGameServer, createSimulation } from '../net/gameServer.mjs';
import {
  PROTOCOL_VERSION,
  INPUT_SEND_HZ,
  decode,
  encode,
  inputMessage,
  joinMessage,
} from '../public/src/net/protocol.js';
import {
  RUN_DEFLECTION,
  RUN_SPEED,
  RUN_THRESHOLD,
  WALK_SPEED,
  groundSpeedForInput,
} from '../public/src/character/speed.js';
import {
  MAX_PREDICTION_BACKLOG_SECONDS,
  MAX_PREDICTION_STEP_SECONDS,
} from '../public/src/net/prediction.js';
import {
  EMBERWORKS_DEEP_MOVEMENT_BOUNDS,
  EMBERWORKS_DEEP_HERO_SPAWN,
} from '../public/src/world/zones/emberworksDeep.js';

const VILLAGE_DESTINATION_ID = 'village';
const EMBERWORKS_DEEP_DESTINATION_ID = 'emberworks-deep';

test('Unity movement, prediction, reconciliation, and Emberworks world constants match JavaScript authority', () => {
  const csharp = readFileSync(new URL(
    '../unity/GalaQuest/Assets/GalaQuest/Runtime/Gameplay/GalaQuestMovementLaw.cs',
    import.meta.url,
  ), 'utf8');
  const csharpWorld = readFileSync(new URL(
    '../unity/GalaQuest/Assets/GalaQuest/Runtime/Gameplay/GalaQuestEmberworksMovementWorld.cs',
    import.meta.url,
  ), 'utf8');
  const constant = (source, name) => {
    const match = source.match(new RegExp(`\\b${name}\\s*=\\s*(-?[0-9.]+)f`));
    assert.ok(match, `missing parseable C# constant ${name}`);
    return Number(match[1]);
  };

  assert.equal(constant(csharp, 'WalkSpeed'), WALK_SPEED);
  assert.equal(constant(csharp, 'RunSpeed'), RUN_SPEED);
  assert.equal(constant(csharp, 'RunDeflection'), RUN_DEFLECTION);
  assert.equal(constant(csharp, 'InputSendHz'), INPUT_SEND_HZ);
  assert.equal(constant(csharp, 'MaxPredictionStepSeconds'), MAX_PREDICTION_STEP_SECONDS);
  assert.equal(constant(csharp, 'MaxPredictionBacklogSeconds'), MAX_PREDICTION_BACKLOG_SECONDS);
  assert.equal(constant(csharp, 'SnapDriftUnits'), sourceConstant('../public/src/net/client.js', 'SNAP_DRIFT_UNITS'));
  assert.equal(constant(csharp, 'NudgeFraction'), sourceConstant('../public/src/net/client.js', 'NUDGE_FRACTION'));
  assert.match(csharp, /RunThresholdFraction\s*=\s*3f\s*\/\s*7f/);
  const csharpThreshold = WALK_SPEED + ((RUN_SPEED - WALK_SPEED) * (3 / 7));
  assert.ok(Math.abs(csharpThreshold - RUN_THRESHOLD) < 1e-6);

  for (const magnitude of [0, 0.25, 0.5, 0.62, 0.8, 1]) {
    const csharpLaw = (run) => {
      if (!(magnitude > 0)) return 0;
      if (!run) return Math.min(magnitude / RUN_DEFLECTION, 1) * WALK_SPEED;
      const over = (magnitude - RUN_DEFLECTION) / (1 - RUN_DEFLECTION);
      return WALK_SPEED + Math.min(Math.max(over, 0), 1) * (RUN_SPEED - WALK_SPEED);
    };
    assert.ok(Math.abs(csharpLaw(false) - groundSpeedForInput(magnitude, false)) < 1e-6);
    assert.ok(Math.abs(csharpLaw(true) - groundSpeedForInput(magnitude, true)) < 1e-6);
  }

  assert.deepEqual(EMBERWORKS_DEEP_HERO_SPAWN, {
    x: constant(csharpWorld, 'SpawnX'),
    z: constant(csharpWorld, 'SpawnZ'),
  });
  assert.deepEqual(EMBERWORKS_DEEP_MOVEMENT_BOUNDS, {
    minX: constant(csharpWorld, 'MinX'),
    maxX: constant(csharpWorld, 'MaxX'),
    minZ: constant(csharpWorld, 'MinZ'),
    maxZ: constant(csharpWorld, 'MaxZ'),
  });
});

test('destination identity is additive: browser join stays byte-compatible and Unity can request Emberworks', () => {
  assert.deepEqual(joinMessage('browser-kid', 'profile-aaaaaaaa'), {
    v: PROTOCOL_VERSION,
    type: 'join',
    name: 'browser-kid',
    guestId: 'profile-aaaaaaaa',
  });
  assert.deepEqual(
    decode(encode(joinMessage('unity-kid', 'profile-aaaaaaaa', EMBERWORKS_DEEP_DESTINATION_ID))),
    {
      v: PROTOCOL_VERSION,
      type: 'join',
      name: 'unity-kid',
      guestId: 'profile-aaaaaaaa',
      destinationId: EMBERWORKS_DEEP_DESTINATION_ID,
    },
  );
});

test('Emberworks simulation starts at its authored spawn and uses its bounded planar envelope', () => {
  const sim = createSimulation({ destinationId: EMBERWORKS_DEEP_DESTINATION_ID });
  const player = sim.addPlayer('unity-kid');
  assert.equal(sim.destinationId, EMBERWORKS_DEEP_DESTINATION_ID);
  assert.deepEqual({ x: player.x, z: player.z }, { x: 0, z: 4 });

  player.x = 100;
  player.z = 100;
  sim.step(0, 1000);
  assert.deepEqual({ x: player.x, z: player.z }, { x: 10, z: 22 });
});

test('Emberworks movement does not run Village enemy, Beacon, Warden, or recovery separation', () => {
  const sim = createSimulation({ destinationId: EMBERWORKS_DEEP_DESTINATION_ID });
  const player = sim.addPlayer('unity-kid');

  // This is exactly Village wolf-2's home, but a harmless point on the planar Emberworks route.
  // Village separation would push the Hero away even with zero delta; Emberworks must leave it alone.
  player.x = -5.5;
  player.z = 5;
  sim.step(0, 1000);
  assert.deepEqual({ x: player.x, z: player.z }, { x: -5.5, z: 5 });
  assert.deepEqual(sim.drainEvents(), []);
});

test('omitted destination still selects the unchanged Village simulation', () => {
  const sim = createSimulation();
  const player = sim.addPlayer('browser-kid');
  assert.equal(sim.destinationId, VILLAGE_DESTINATION_ID);
  assert.deepEqual({ x: player.x, z: player.z }, { x: 0, z: 0 });
  assert.ok(sim.encounterSnapshot().enemies.length > 0, 'Village ordinary enemies remain active');
});

test('unknown destination IDs fail explicitly', () => {
  assert.throws(
    () => createSimulation({ destinationId: 'not-a-real-destination' }),
    /unknown destination/i,
  );
});

test('real socket: Emberworks welcome, ordered movement, immediate release, and authoritative stop', async () => {
  await withGameServer(async ({ url }) => {
    const c = client(url);
    await c.open();
    c.send(joinMessage('unity-kid', 'profile-aaaaaaaa', EMBERWORKS_DEEP_DESTINATION_ID));
    const welcome = await c.waitForMessage((message) => message.type === 'welcome');
    assert.equal(welcome.destinationId, EMBERWORKS_DEEP_DESTINATION_ID);
    assert.deepEqual(welcome.players.map(({ x, z }) => ({ x, z })), [{ x: 0, z: 4 }]);

    c.send(inputMessage(1, 0, 1, 1, false));
    const moving = await c.waitForMessage((message) => (
      message.type === 'snapshot'
      && message.destinationId === EMBERWORKS_DEEP_DESTINATION_ID
      && message.players[0]?.z > 4
      && message.players[0]?.speed > 0
    ));

    // The release is a newer zero-intent frame sent immediately by the Unity client; the server
    // must obey it on the next tick rather than waiting for STALE_INPUT_MS.
    c.send(inputMessage(2, 0, 0, 0, false));
    const stopped = await c.waitForMessage((message) => (
      message.type === 'snapshot'
      && message.tick > moving.tick
      && message.players[0]?.speed === 0
    ));
    const stoppedAgain = await c.waitForMessage((message) => (
      message.type === 'snapshot'
      && message.tick > stopped.tick
      && message.players[0]?.speed === 0
    ));
    assert.equal(stoppedAgain.players[0].z, stopped.players[0].z);
    c.close();
  });
});

test('real socket: unknown and incompatible destination joins are policy-rejected', async () => {
  await withGameServer(async ({ url }) => {
    const unknown = client(url);
    await unknown.open();
    unknown.send({
      v: PROTOCOL_VERSION,
      type: 'join',
      name: 'lost-kid',
      guestId: 'profile-aaaaaaaa',
      destinationId: 'not-a-real-destination',
    });
    assert.equal((await unknown.closed()).code, 1008);

    const village = client(url);
    const unity = client(url);
    await Promise.all([village.open(), unity.open()]);
    village.send(joinMessage('browser-kid', 'profile-bbbbbbbb'));
    await village.waitForMessage((message) => message.type === 'welcome');
    unity.send(joinMessage('unity-kid', 'profile-cccccccc', EMBERWORKS_DEEP_DESTINATION_ID));
    assert.equal((await unity.closed()).code, 1008);
    village.close();
  });
});

async function withGameServer(body) {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-u1-cp2-'));
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
    open: () => new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('failed to open')), { once: true });
    }),
    send: (message) => socket.send(encode(message)),
    close: () => socket.close(),
    closed: () => new Promise((resolve) => {
      socket.addEventListener('close', (event) => resolve(event), { once: true });
    }),
    waitForMessage: async (predicate, timeoutMs = 4000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const match = messages.find(predicate);
        if (match) return match;
        if (Date.now() > deadline) throw new Error(`timed out; messages=${JSON.stringify(messages)}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
  };
}

function sourceConstant(relativePath, name) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const match = source.match(new RegExp(`export const ${name} = (-?[0-9.]+);`));
  assert.ok(match, `missing parseable JavaScript constant ${name}`);
  return Number(match[1]);
}
