// The client half of multiplayer: one socket, intent out, snapshots in.
//
// Offline is a first-class state, not an error. The socket is never awaited during boot and a failure
// never blocks the game: two children on a phone with no server should still get a hero that walks.
// Every network path here degrades to single-player rather than to a broken page.

import {
  INPUT_SEND_HZ,
  ProtocolError,
  attackMessage,
  collectLootMessage,
  decode,
  encode,
  equipMessage,
  inputMessage,
  joinMessage,
  claimBladeMessage,
  claimHollowMessage,
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
  // True from the moment a snapshot updates latestSelf until reconcile() next consumes it. Without
  // this, reconcile() has no way to tell "a new authoritative position arrived" from "called again
  // this render frame" -- see the frame-rate note on reconcile() itself.
  let hasNewSnapshot = false;
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
        hasNewSnapshot = true;
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
      hasNewSnapshot = false;
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
  function sendEquip(itemId) {
    if (status !== 'online') return false;
    return send(equipMessage(itemId));
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
   * Gated on hasNewSnapshot rather than applied every call: the caller (main.js) invokes this once
   * per rendered frame (~60 Hz), but snapshots only arrive at ~10 Hz, and NUDGE_FRACTION above is
   * calibrated per snapshot, not per frame. Without the gate, six frame-rate calls would take six
   * bites out of the same drift between snapshots -- six times the documented correction rate.
   */
  function reconcile(position) {
    if (latestSelf === null) return { drift: 0, snapped: false };
    if (!hasNewSnapshot) return { drift: 0, snapped: false };
    hasNewSnapshot = false;
    const driftX = latestSelf.x - position.x;
    const driftZ = latestSelf.z - position.z;
    const drift = Math.hypot(driftX, driftZ);
    if (drift === 0) return { drift: 0, snapped: false };

    if (drift > SNAP_DRIFT_UNITS) {
      // Too far to walk back without looking like the hero is being dragged.
      position.x = latestSelf.x;
      position.z = latestSelf.z;
      return { drift, snapped: true };
    }
    position.x += driftX * NUDGE_FRACTION;
    position.z += driftZ * NUDGE_FRACTION;
    return { drift, snapped: false };
  }

  connect();

  return {
    setIntent,
    sendAttack,
    sendEquip,
    sendSearchCart,
    sendClaimBlade,
    sendClaimHollow,
    sendCollectLoot,
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
