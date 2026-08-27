// test/beacon-siege-multiplayer.test.mjs
//
// THE PLAYTEST BUG, reproduced at the server level: two real children on two real devices, one
// server. Luke lit the Beacon -- on HIS screen the seals were gone and the fire was burning. Henrik,
// connected the whole time on his own iPad, could not strike a seal or the Warden at all, and the
// Beacon stayed cold on his screen.
//
// This drives the actual attachGameServer/WebSocket path two real clients use (test/game-server.test
// .mjs's own `withGameServer`/`client` harness), not a single in-process createSimulation() call --
// the bug this test exists to catch is an ORCHESTRATION bug (who gets told what, in which snapshot),
// and world/beaconSiege.js's own reducer can be perfectly correct while the wiring around it drops a
// second child.
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { attachGameServer } from '../net/gameServer.mjs';
import {
  attackMessage,
  decode,
  encode,
  joinMessage,
} from '../public/src/net/protocol.js';
import { COLD_SEALS } from '../public/src/world/zones/village.js';
import { SWING_CONTACT_SECONDS, SWING_SECONDS } from '../public/src/combat/encounter.js';
import { WARDEN_MELEE_RANGE } from '../public/src/world/beaconSiege.js';

// Same throwaway-store convention test/game-server.test.mjs's own withGameServer uses: a fresh temp
// db per test, never data/rewards.db.
async function withGameServer(body) {
  const dir = mkdtempSync(join(tmpdir(), 'galaquest-siege-mp-'));
  const rewardStorePath = join(dir, 'rewards.db');
  const httpServer = createServer((_request, response) => response.writeHead(404).end());
  const game = attachGameServer(httpServer, { rewardStorePath, allowMissingOrigin: true });
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
    of: (type) => messages.filter((m) => m.type === type),
    waitFor: async (type, count = 1, timeoutMs = 4000) => {
      const deadline = Date.now() + timeoutMs;
      while (messages.filter((m) => m.type === type).length < count) {
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${count} ${type}; got `
            + JSON.stringify(messages.map((m) => m.type)));
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return messages.filter((m) => m.type === type);
    },
    waitForSnapshot: async (predicate, timeoutMs = 6000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const match = messages.filter((m) => m.type === 'snapshot').find(predicate);
        if (match) return match;
        if (Date.now() > deadline) throw new Error('timed out waiting for a matching snapshot');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
  };
}

/** Stand a joined player's server body at a world position without a wire message -- the same
 *  direct-manipulation shortcut test/beacon-arena-handoff.test.mjs already takes for exactly this
 *  reason: teleporting via input messages would take real wall-clock seconds per metre this test does
 *  not need to spend, and the thing under test is who gets told what once a hero IS there. */
function standAt(game, playerId, x, z, heading = 0) {
  const player = game.simulation.players.get(playerId);
  player.x = x;
  player.z = z;
  player.heading = heading;
}

// SWING_SECONDS is the real wall-clock length of one full swing (this harness runs the real
// attachGameServer tick timer, not an injectable clock): a bit more than that between sends lets
// each swing fully resolve -- contact, cooldown, ready again -- before the next one goes out, so N
// sends land N blows rather than N attempts racing one swing.
const SWING_CYCLE_MS = Math.round((SWING_SECONDS + 0.15) * 1000);

/**
 * Swing at a target, over and over, until `predicate()` reads true -- reasserting the body's
 * position and heading every cycle rather than trusting it stayed put.
 *
 * `dodge: true` (the Warden fight) has this step in for contact and then retreat clear of
 * WARDEN_MELEE_RANGE for the rest of the cycle before stepping back in -- a REAL CHILD DODGES the
 * Warden's own long, deliberately telegraphed attacks (world/beaconSiege.js's own header on why)
 * rather than standing in its face for the whole fight, and that is what keeps a single solo hero
 * from being knocked down before ever landing a blow. The retreat is deliberately shallow -- clear
 * of the Warden's own reach, but nowhere near BEACON_ARENA's own radius -- because crossing that
 * boundary hands the hero's body to the WOLF engine for a tick (world/beaconSiege.js's own arena
 * handoff, mirrored in net/gameServerCore.mjs's settleArenas) and every crossing cancels whatever
 * swing was mid-flight, exactly as it should for a hero who actually left the fight. A dodge that
 * never leaves the clearing must never trip that boundary by accident.
 *
 * The seals never move and never swing back, so `dodge: false` (the default) just re-approaches a
 * fixed `[x, z]` and re-swings. The Warden WALKS, though -- its own idle/walk state chases whichever
 * hero is nearest (world/beaconSiege.js's own advanceWarden) -- so `target` may also be a `() => [x,
 * z]` thunk reading its LIVE published position; a fixed coordinate goes stale the moment it takes
 * one step and every subsequent approach swings at empty air.
 */
async function swingUntil(game, who, playerId, target, seqBox, predicate, {
  timeoutMs = 30000, dodge = false,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let swings = 0;
  const contactMs = Math.round((SWING_CONTACT_SECONDS + 0.15) * 1000);
  const targetAt = typeof target === 'function' ? target : () => target;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for the swing predicate after ${swings} swings`);
    }
    const player = game.simulation.players.get(playerId);
    const [tx, tz] = targetAt();
    player.x = tx - 0.5;
    player.z = tz;
    player.heading = Math.atan2(tx - player.x, tz - player.z);
    who.send(attackMessage(seqBox.seq += 1));
    swings += 1;
    if (dodge) {
      // Hold the contact frame, then fall back just clear of melee reach for the rest of the cycle.
      await new Promise((resolve) => setTimeout(resolve, contactMs));
      const [retreatX, retreatZ] = targetAt();
      player.x = retreatX - (WARDEN_MELEE_RANGE + 0.5);
      player.z = retreatZ;
      await new Promise((resolve) => setTimeout(resolve, SWING_CYCLE_MS - contactMs));
    } else {
      await new Promise((resolve) => setTimeout(resolve, SWING_CYCLE_MS));
    }
  }
}

test('a second connected child sees the Beacon light and can fight the moment the first one does', async () => {
  await withGameServer(async ({ url, game }) => {
    const luke = client(url);
    const henrik = client(url);
    await Promise.all([luke.open(), henrik.open()]);
    luke.send(joinMessage('Luke'));
    henrik.send(joinMessage('Henrik'));
    const [welcomeLuke] = await luke.waitFor('welcome');
    const [welcomeHenrik] = await henrik.waitFor('welcome');

    // Henrik never leaves the Beacon clearing, standing right beside the third seal the whole time --
    // "connected at the time" from the playtest report, resolved: he never disconnects, never joins
    // late, and is close enough that a working game would let him fight from the very first seal.
    standAt(game, welcomeHenrik.id, COLD_SEALS[2][0] - 0.5, COLD_SEALS[2][1]);

    const seq = { seq: 0 };
    // Luke alone breaks the first two seals and lets Henrik have the third, then solos the Warden --
    // exactly the "one child does the work" shape the playtest reported, so this reproduces the
    // asymmetry rather than a fight nobody would actually have.
    for (const [index, [x, z]] of [COLD_SEALS[0], COLD_SEALS[1]].entries()) {
      await swingUntil(
        game, luke, welcomeLuke.id, [x, z], seq,
        () => game.simulation.siegeSnapshot().seals[index].burst,
      );
    }
    assert.equal(game.simulation.siegeSnapshot().seals.filter((s) => s.burst).length, 2,
      'test setup: two of three seals should be broken before Henrik ever swings');

    // HENRIK'S OWN SWING, at the seal he has been standing beside the whole time.
    await swingUntil(
      game, henrik, welcomeHenrik.id, COLD_SEALS[2], seq,
      () => game.simulation.siegeSnapshot().seals[2].burst,
    );

    const afterThirdSeal = game.simulation.siegeSnapshot();
    assert.ok(afterThirdSeal.seals[2].burst,
      'Henrik\'s own swing must be able to burst the third seal, exactly like Luke\'s swings');
    assert.equal(afterThirdSeal.warden.mode, 'waking',
      'the third seal bursting must wake the Warden for BOTH connected children, not just whoever is closest to seal 0 and 1');

    // Now Luke finishes the Warden solo -- the playtest's own asymmetric shape, Luke doing the
    // fighting while Henrik stands nearby unable to land a blow. Contact must land on an AWAKE
    // Warden, so this waits out WARDEN_WAKE_SECONDS first (the fight's own invulnerable rise).
    await new Promise((resolve) => setTimeout(resolve, 2200));
    await swingUntil(
      game, luke, welcomeLuke.id, () => {
        const w = game.simulation.siegeSnapshot().warden;
        return [w.x, w.z];
      }, seq,
      () => game.simulation.siegeSnapshot().warden.hp <= 0,
      { dodge: true },
    );
    assert.equal(game.simulation.siegeSnapshot().warden.hp, 0, 'test setup: the Warden must actually fall');
    // Past the fall's own watchable beat (WARDEN_DEATH_SECONDS) into 'dead' -- the fight is OVER,
    // not merely lost, before this test asks what either child's screen shows about it.
    await new Promise((resolve) => setTimeout(resolve, 2800));

    // ── THE ACTUAL BUG REPORT ────────────────────────────────────────────────────────────────
    //
    // Not "does the server's own state say beaconLit" (test/beacon-arena-handoff.test.mjs's sibling
    // already covers the reducer) -- does HENRIK'S OWN WEBSOCKET, the one his iPad is reading, ever
    // carry a snapshot that says the Beacon is lit and the seals are gone.
    const henrikSeesItLit = await henrik.waitForSnapshot(
      (snapshot) => snapshot.encounter.siege.beaconLit === true && snapshot.encounter.siege.warden.mode === 'dead',
    );
    assert.ok(henrikSeesItLit.encounter.siege.beaconLit,
      'Henrik\'s own connection must carry the shared victory, not just Luke\'s');
    assert.ok(henrikSeesItLit.encounter.siege.seals.every((s) => s.burst),
      'the seals Henrik sees must all read burst -- the breakables must not still stand on his screen');
    assert.equal(henrikSeesItLit.encounter.siege.warden.mode, 'dead',
      'Henrik must see the Warden actually fallen, not still fighting');

    luke.socket.close();
    henrik.socket.close();
  });
});

test('a child who joins AFTER the Beacon is already lit sees it lit on arrival, not cold', async () => {
  await withGameServer(async ({ url, game }) => {
    const luke = client(url);
    await luke.open();
    luke.send(joinMessage('Luke'));
    const [welcomeLuke] = await luke.waitFor('welcome');

    const seq = { seq: 0 };
    for (const [index, [x, z]] of COLD_SEALS.entries()) {
      await swingUntil(
        game, luke, welcomeLuke.id, [x, z], seq,
        () => game.simulation.siegeSnapshot().seals[index].burst,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2200));
    await swingUntil(
      game, luke, welcomeLuke.id, () => {
        const w = game.simulation.siegeSnapshot().warden;
        return [w.x, w.z];
      }, seq,
      () => game.simulation.siegeSnapshot().warden.hp <= 0,
      { dodge: true },
    );
    // Past the fall's own watchable beat (WARDEN_DEATH_SECONDS) into 'dead' -- Henrik is joining a
    // world where the fight is truly OVER, not one mid-collapse.
    await new Promise((resolve) => setTimeout(resolve, 2800));
    assert.equal(game.simulation.siegeSnapshot().beaconLit, true, 'test setup: the Beacon must actually be lit before Henrik joins');

    // Henrik was not connected at all for any of that -- a genuine late join.
    const henrik = client(url);
    await henrik.open();
    henrik.send(joinMessage('Henrik'));
    const [welcomeHenrik] = await henrik.waitFor('welcome');

    assert.equal(welcomeHenrik.encounter.siege.beaconLit, true,
      'a late joiner\'s very first welcome must already show the Beacon burning');
    assert.ok(welcomeHenrik.encounter.siege.seals.every((s) => s.burst),
      'a late joiner must not be shown three whole seals guarding an already-won fight');
    assert.equal(welcomeHenrik.encounter.siege.warden.mode, 'dead',
      'a late joiner must not be offered a boss fight whose outcome the sky has already painted');

    luke.socket.close();
    henrik.socket.close();
  });
});
