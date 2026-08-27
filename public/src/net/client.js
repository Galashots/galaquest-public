// The client half of multiplayer: one socket, intent out, snapshots in.
//
// Offline is a first-class state, not an error. The socket is never awaited during boot and a failure
// never blocks the game: two children on a phone with no server should still get a hero that walks.
// Every network path here degrades to single-player rather than to a broken page.

import {
  INPUT_SEND_HZ,
  ProtocolError,
  attackMessage,
  collectDropMessage,
  collectLootMessage,
  decode,
  encode,
  equipMessage,
  restoreProfileMessage,
  inputMessage,
  joinMessage,
  claimBladeMessage,
  claimHollowMessage,
  claimSatchelMessage,
  claimCharmMessage,
  searchCartMessage,
  villageUpgradePurchaseMessage,
} from './protocol.js';
import { createSnapshotBuffer } from './interpolation.js';
import { getOrCreateGuestId } from './guestId.js';

export const INPUT_SEND_INTERVAL_MS = 1000 / INPUT_SEND_HZ;

// Beyond this the local prediction is too wrong to walk back politely, so it snaps. Under it, the
// error is corrected a slice at a time. 0.6 units is about a third of the hero's height -- visible if
// held, but not so tight that ordinary latency causes constant snapping.
export const SNAP_DRIFT_UNITS = 0.6;
// Fraction of the remaining error taken per snapshot. At 10 Hz this closes a 0.3-unit error to under
// a centimetre in about three seconds, which is slow enough to be invisible while walking.
export const NUDGE_FRACTION = 0.1;

export const RECONNECT_DELAY_MS = 2000;

export function defaultServerUrl(location = window.location) {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Same host and port as the page, so the socket cannot point somewhere the page did not come from.
  return `${scheme}//${location.host}/ws`;
}

/**
 * @param options.url        defaults to the page's own host on /ws
 * @param options.name       display name sent with join
 * @param options.onStatus   called with 'connecting' | 'online' | 'offline'
 * @param options.onLeave    called with a player id that has left
 * @param options.onEncounter  called with (encounter, events) on welcome (events always []
 *   there -- ruling 7, events ride snapshots) and on every snapshot (events as decoded off
 *   that snapshot's `events` array). The caller mirrors this; the client does not interpret it.
 * @param options.socketFactory  injectable for tests
 */
export function createNetClient(options = {}) {
  const url = options.url ?? defaultServerUrl();
  const socketFactory = options.socketFactory ?? ((target) => new WebSocket(target));
  const now = options.now ?? (() => performance.now());
  const reconnectDelayMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS;
  const buffer = createSnapshotBuffer(options.buffer);
  // Resolved ONCE, not per (re)connect attempt, so a dropped-and-restored socket still identifies
  // as the same guest rather than minting a new token on every reconnect. `options.guestId` lets a
  // test (or a future explicit "play as guest" flow) supply one directly instead of going through
  // localStorage; omitted, this falls back to getOrCreateGuestId()'s own localStorage/crypto.randomUUID
  // path, which itself degrades to null (ephemeral) rather than throwing -- see guestId.js's header.
  const guestId = options.guestId !== undefined ? options.guestId : getOrCreateGuestId();

  let socket = null;
  let status = 'offline';
  let selfId = null;
  let sequence = 0;
  // Its own counter, independent of setIntent's `sequence` above: an attack and an input are
  // different message types, and the server's per-player replay guard is keyed per type
  // (`${playerId}:${seq}` inside applyAttack), so sharing a counter would only make the two
  // streams harder to read on the wire for no protection either one needs.
  let attackSequence = 0;
  let lastSentAtMs = -Infinity;
  let lastSentMagnitude = 0;
  let latestSelf = null;
  // How many snapshots have updated latestSelf since reconcile() last consumed them. A COUNT rather
  // than a flag, and the difference is the whole of the frame-rate note on reconcile() below: a flag
  // can only say "at least one", which silently throws away every snapshot after the first whenever
  // frames come slower than snapshots do.
  let pendingSnapshots = 0;
  let reconnectTimer = null;
  let disposed = false;

  function setStatus(next) {
    if (status === next) return;
    status = next;
    options.onStatus?.(next);
  }

  function connect() {
    if (disposed) return;
    setStatus('connecting');
    let candidate;
    try {
      candidate = socketFactory(url);
    } catch (error) {
      // A bad URL throws synchronously. Treat it as offline rather than letting it escape into boot.
      console.warn('[net] could not open a socket:', error.message);
      scheduleReconnect();
      return;
    }
    socket = candidate;

    socket.addEventListener('open', () => {
      sequence = 0;
      attackSequence = 0;
      lastSentAtMs = -Infinity;
      lastSentMagnitude = 0;
      send(joinMessage(options.name ?? 'player', guestId));
    });

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = decode(event.data);
      } catch (error) {
        // The client's job on a bad message is to ignore it and keep playing. Dropping the connection
        // would turn a single corrupt frame into a lost session.
        if (error instanceof ProtocolError) console.warn('[net] ignoring bad message:', error.message);
        else console.error('[net] decode failed', error);
        return;
      }

      if (message.type === 'welcome') {
        selfId = message.id;
        setStatus('online');
        buffer.record({ tick: message.tick, players: message.players }, now());
        options.onWelcome?.(message);
        // No events on welcome (ruling 7: events ride snapshots) -- [] rather than omitting the
        // call, so a late joiner's consumer sees the mid-fight encounter immediately rather than
        // waiting for the first snapshot to learn a fight is even happening.
        options.onEncounter?.(message.encounter, []);
        return;
      }
      if (message.type === 'snapshot') {
        buffer.record(message, now());
        latestSelf = message.players.find((player) => player.id === selfId) ?? null;
        pendingSnapshots += 1;
        options.onSnapshot?.(message);
        options.onEncounter?.(message.encounter, message.events);
        return;
      }
      if (message.type === 'leave') {
        options.onLeave?.(message.id);
      }
    });

    socket.addEventListener('close', () => {
      socket = null;
      selfId = null;
      latestSelf = null;
      pendingSnapshots = 0;
      buffer.reset();
      scheduleReconnect();
    });

    // 'error' is always followed by 'close', so reconnection is handled in one place.
    socket.addEventListener('error', () => {});
  }

  function scheduleReconnect() {
    setStatus('offline');
    if (disposed || reconnectTimer !== null) return;
    // Keep trying: a server restart mid-play should heal itself rather than need a page reload from a
    // child. Fixed delay rather than backoff -- this is a LAN with one server and two players.
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
  }

  function send(message) {
    if (socket === null || socket.readyState !== 1) return false;
    try {
      socket.send(encode(message));
      return true;
    } catch (error) {
      console.warn('[net] send failed:', error.message);
      return false;
    }
  }

  /**
   * Called every frame with the current intent. Throttles to INPUT_SEND_HZ, except that a release is
   * sent the instant it happens: waiting up to 66ms to say "stop" is the difference between a hero
   * that halts and one that overshoots.
   */
  function setIntent(dirX, dirZ, magnitude, run) {
    if (status !== 'online') return false;
    const nowMs = now();
    const released = magnitude === 0 && lastSentMagnitude > 0;
    const due = nowMs - lastSentAtMs >= INPUT_SEND_INTERVAL_MS;
    if (!released && (!due || magnitude === 0)) return false;

    // Direction must be unit-or-zero: the server prices magnitude separately, and sending a scaled
    // vector would apply the deflection twice. The protocol decoder rejects it, so this is the second
    // guard on the same mistake.
    const length = Math.hypot(dirX, dirZ);
    const unitX = length > 0 ? dirX / length : 0;
    const unitZ = length > 0 ? dirZ / length : 0;

    lastSentAtMs = nowMs;
    lastSentMagnitude = magnitude;
    return send(inputMessage(sequence += 1, unitX, unitZ, Math.min(1, Math.max(0, magnitude)), run));
  }

  /**
   * Send an attack request. Mirrors setIntent's online-only guard: offline there is no socket to
   * carry it, and the caller (main.js) never reaches this without first passing a local
   * canHeroAttack check against the last server state, so a false return here should not happen
   * in practice -- it exists so a race between going offline and a queued button press fails
   * quietly instead of throwing on a null socket.
   */
  function sendAttack() {
    if (status !== 'online') return false;
    return send(attackMessage(attackSequence += 1));
  }

  /**
   * Send an equip request. Same online-only guard as sendAttack -- offline there is no socket, and
   * progression/state.js's own offline fallback applies the choice locally instead of calling this.
   * No sequence number: unlike attack (idempotency matters -- a resend must not double-hit) and
   * input (staleness matters -- an old direction must not override a new one), equip is naturally
   * idempotent on the server (net/gameServer.mjs's applyEquip just records "the latest choice"), so
   * there is nothing a seq would protect here that the store's own latest-wins read does not already.
   */
  /** @param identity the device's own `{ eventId, rev }` for this choice, minted at the moment the
   *  child tapped EQUIP (progression/profiles.js's mintEquipFact) and journalled before it is sent.
   *  Passing it through unchanged is what lets the server store the SAME fact the device holds, so
   *  the two copies merge instead of becoming two equips; omitted, the server mints its own, which
   *  is the pre-1b behaviour a harness or an older client still gets. */
  function sendEquip(itemId, identity) {
    if (status !== 'online') return false;
    return send(equipMessage(itemId, identity));
  }

  /**
   * Hand the server durable facts this device still holds, for a store that has lost them.
   *
   * Same online-only guard as every other send. No sequence number and no reply expected: the facts
   * carry their own ids, so the server's INSERT OR IGNORE makes a resend a no-op, and there is
   * nothing to acknowledge that the next welcome does not already say.
   */
  function sendRestoreProfile(facts) {
    if (status !== 'online') return false;
    if (!Array.isArray(facts) || facts.length === 0) return false;
    return send(restoreProfileMessage(facts));
  }

  /** GP2: ask the server to search the shared cart. Same online-only guard and no-sequence-number
   *  reasoning as sendEquip -- the server's own requestSearchCart is what makes a resend (offline
   *  reconnect retrying its own local trigger) a clean no-op rather than a second haul. */
  function sendSearchCart() {
    if (status !== 'online') return false;
    return send(searchCartMessage());
  }

  /** GP2: ask the server to collect one physical pickup. Same online-only guard as sendAttack/
   *  sendEquip -- offline there is no shared world to collect from at all (see main.js's own comment
   *  on why cart loot has no offline fallback the way combat does). No sequence number, for the same
   *  reason sendEquip has none: a resend of the SAME pickupId is naturally idempotent server-side
   *  (world/cartLoot.js's requestCollectLoot rejects an already-collected id outright). */
  function sendCollectLoot(pickupId) {
    if (status !== 'online') return false;
    return send(collectLootMessage(pickupId));
  }

  /** R1: the same shape and reasoning as sendCollectLoot, for the dynamic kill-drop pickups
   *  world/enemyDrops.js spawns -- online-only (there is no shared drop to collect offline; the
   *  offline fallback runs its own local copy of the same rules instead), no sequence number, and a
   *  resend of the same dropId is naturally idempotent server-side (requestCollectEnemyDrop rejects an
   *  already-collected id outright, the identical "first request wins" rule requestCollectLoot uses). */
  function sendCollectDrop(dropId) {
    if (status !== 'online') return false;
    return send(collectDropMessage(dropId));
  }

  /** G4: ask Rowan for the Wildwood Blade. NO PAYLOAD AT ALL -- every fact that decides whether the
   *  promise is owed (where this hero is standing, whether the Beacon is burning, whether this guest
   *  already owns it) is server-side world state, so there is nothing here for a client to assert or
   *  get wrong. Same online-only guard as sendSearchCart: offline there is no durable identity to
   *  own anything with. A resend is naturally idempotent -- ownership is a SET server-side. */
  function sendClaimBlade() {
    if (status !== 'online') return false;
    return send(claimBladeMessage());
  }

  /** G5: tell the server this hero opened the hollow's chest. Same shape and the same reasoning as
   *  sendClaimBlade -- position is re-checked server-side and the award is idempotent per guest. */
  function sendClaimHollow() {
    if (status !== 'online') return false;
    return send(claimHollowMessage());
  }

  /** ARC 2. Both the same throttled-ask shape sendClaimBlade documents: position is re-checked
   *  server-side and both awards are idempotent latches per guest, so a resend costs one row either
   *  way and a refused claim is a clean silence rather than a disconnect. */
  function sendClaimSatchel() {
    if (status !== 'online') return false;
    return send(claimSatchelMessage());
  }

  function sendClaimCharm() {
    if (status !== 'online') return false;
    return send(claimCharmMessage());
  }

  /** GP3: ask the server to purchase a village upgrade (Workshop I today). Same online-only guard
   *  and no-sequence-number reasoning as sendSearchCart/sendCollectLoot -- Village Supplies is
   *  shared, server-authoritative state with no offline fallback (there is nothing local to spend
   *  against), and a resend of the SAME upgradeId is naturally idempotent server-side
   *  (net/gameServer.mjs's applyVillageUpgradePurchase, backed by the store's own eventId PRIMARY
   *  KEY -- see village/economy.js's WORKSHOP_I_ID). */
  function sendVillageUpgradePurchase(upgradeId) {
    if (status !== 'online') return false;
    return send(villageUpgradePurchaseMessage(upgradeId));
  }

  /**
   * Pull the local prediction back towards the server's version of us. Returns the correction applied,
   * for diagnostics, so a harness can measure drift rather than infer it.
   *
   * PER SNAPSHOT, IN BOTH DIRECTIONS, and the second direction is the bug this counter fixes.
   * NUDGE_FRACTION's own comment states the contract -- "fraction of the remaining error taken per
   * snapshot... at 10 Hz this closes a 0.3-unit error to under a centimetre in about three seconds"
   * -- and main.js calls this once per RENDERED FRAME, which is not the same clock. The original
   * flag fixed the fast half: at 60 fps six calls would otherwise take six bites out of one
   * snapshot's drift. It left the slow half wrong. Below 10 fps the snapshots keep arriving and the
   * flag can still only say "at least one", so a runner painting 3 frames a second applies 3
   * corrections where the contract promises 10, and the hero takes ten seconds to arrive where he
   * was promised to arrive in three. That is not a hypothetical device: the hosted playtest runners
   * measure 3-4 fps, a cheap tablet is the machine this game is FOR, and what a child sees during
   * those seconds is their own hero sliding sideways on his own.
   *
   * So consume the whole backlog and compound the same fraction over it. 1-(1-f)^n IS n separate
   * f-sized bites, exactly -- not a bigger nudge picked to feel right, which is the tuning mistake
   * this codebase keeps a ledger about. At any frame rate at or above the snapshot rate n is 1 and
   * every number here is unchanged.
   */
  function reconcile(position) {
    if (latestSelf === null) return { drift: 0, snapped: false, corrections: 0 };
    if (pendingSnapshots === 0) return { drift: 0, snapped: false, corrections: 0 };
    const corrections = pendingSnapshots;
    pendingSnapshots = 0;
    const driftX = latestSelf.x - position.x;
    const driftZ = latestSelf.z - position.z;
    const drift = Math.hypot(driftX, driftZ);
    if (drift === 0) return { drift: 0, snapped: false, corrections };

    if (drift > SNAP_DRIFT_UNITS) {
      // Too far to walk back without looking like the hero is being dragged.
      position.x = latestSelf.x;
      position.z = latestSelf.z;
      return { drift, snapped: true, corrections };
    }
    const fraction = 1 - (1 - NUDGE_FRACTION) ** corrections;
    position.x += driftX * fraction;
    position.z += driftZ * fraction;
    return { drift, snapped: false, corrections };
  }

  connect();

  return {
    setIntent,
    sendAttack,
    sendEquip,
    sendRestoreProfile,
    sendSearchCart,
    sendClaimBlade,
    sendClaimSatchel,
    sendClaimCharm,
    sendClaimHollow,
    sendCollectLoot,
    sendCollectDrop,
    sendVillageUpgradePurchase,
    reconcile,
    // Remote players only: self is drawn from the local prediction, which is always more current.
    sampleRemotes(nowMs = now()) {
      const sampled = buffer.sample(nowMs);
      if (selfId !== null) sampled.delete(selfId);
      return sampled;
    },
    get status() {
      return status;
    },
    get selfId() {
      return selfId;
    },
    // Exposed for the HUD/harness the same way selfId is -- e.g. D6's drive-marks.mjs reads this
    // to confirm the SAME guestId (not merely "some" guestId) survives a page reload.
    get guestId() {
      return guestId;
    },
    get serverSelf() {
      return latestSelf;
    },
    get snapshotCount() {
      return buffer.length;
    },
    get url() {
      return url;
    },
    dispose() {
      disposed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      socket?.close();
      socket = null;
    },
  };
}
