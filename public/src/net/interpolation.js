// Remote players are drawn in the past, on purpose.
//
// Snapshots arrive 10 times a second. Drawing each one as it lands gives 10 fps motion no matter how
// fast the renderer runs, so instead we hold a short buffer and render the position each remote had
// INTERPOLATION_DELAY_MS ago, lerping between the two snapshots that bracket that moment. The cost is
// that remotes are seen ~120ms behind; the benefit is smooth motion, which is the one thing this
// project has measured as making modest art look premium.
//
// 120ms is one and a bit snapshot intervals (100ms), which is what buys tolerance for a late packet.
// Exactly one interval would leave nothing spare and would stutter on the first jitter. Two intervals
// would be smoother still and visibly laggy. If a child ever says another player "feels behind",
// this is the number to turn down, and the floor is the observed jitter.

export const INTERPOLATION_DELAY_MS = 120;

// How long a buffer to keep. One second is ten snapshots -- far more than the interpolator reads, but
// it costs nothing and means a hitch does not empty the buffer.
export const BUFFER_MS = 1000;

// On starvation, hold position and bleed speed to zero across this window, so a remote settles into
// its idle pose instead of sliding along at its last known speed. Shorter than the stale-input
// timeout on the server (1000ms), so the client gives up animating before the server gives up moving.
export const STARVATION_DECAY_MS = 250;

// Shortest way round the circle, so a player turning past PI does not spin the long way.
export function lerpAngle(from, to, t) {
  const difference = ((((to - from) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return from + difference * t;
}

export function lerp(from, to, t) {
  return from + (to - from) * t;
}

export function createSnapshotBuffer(options = {}) {
  const delayMs = options.delayMs ?? INTERPOLATION_DELAY_MS;
  const bufferMs = options.bufferMs ?? BUFFER_MS;
  const decayMs = options.decayMs ?? STARVATION_DECAY_MS;
  // { receivedAtMs, players: Map<id, {x, z, heading, speed}> }
  const snapshots = [];

  function record(snapshot, receivedAtMs) {
    const players = new Map();
    for (const player of snapshot.players) {
      players.set(player.id, {
        x: player.x, z: player.z, heading: player.heading, speed: player.speed,
      });
    }
    snapshots.push({ receivedAtMs, tick: snapshot.tick, players });
    // Ordered delivery is guaranteed by WebSocket, so this only trims; it never sorts.
    while (snapshots.length > 2 && snapshots[0].receivedAtMs < receivedAtMs - bufferMs) {
      snapshots.shift();
    }
  }

  /**
   * The set of remote players as they should be drawn right now.
   * Returns Map<id, { x, z, heading, speed, interpolated, starvedMs }>.
   */
  function sample(nowMs) {
    if (snapshots.length === 0) return new Map();
    const targetMs = nowMs - delayMs;

    // Find the pair bracketing targetMs: `before` is the newest snapshot at or before it.
    let before = null;
    let after = null;
    for (const snapshot of snapshots) {
      if (snapshot.receivedAtMs <= targetMs) before = snapshot;
      else if (after === null) after = snapshot;
    }

    // Not enough history yet -- the very first snapshots of a session, still inside the delay window.
    // Show the oldest thing known rather than nothing, so a remote appears immediately at a sensible
    // place instead of popping in 120ms later.
    if (before === null) {
      const first = snapshots[0];
      return snapshotAsSample(first, { interpolated: false, starvedMs: 0 });
    }

    // Bracketed: the normal case.
    if (after !== null) {
      const span = after.receivedAtMs - before.receivedAtMs;
      const t = span <= 0 ? 1 : Math.min(1, Math.max(0, (targetMs - before.receivedAtMs) / span));
      const result = new Map();
      for (const [id, from] of before.players) {
        const to = after.players.get(id);
        if (to === undefined) {
          // Present then, gone now: it left. Drop it rather than freeze a ghost in place.
          continue;
        }
        result.set(id, {
          x: lerp(from.x, to.x, t),
          z: lerp(from.z, to.z, t),
          heading: lerpAngle(from.heading, to.heading, t),
          speed: lerp(from.speed, to.speed, t),
          interpolated: true,
          starvedMs: 0,
        });
      }
      // A player that appears only in the newer snapshot has just joined; show it at its position.
      for (const [id, to] of after.players) {
        if (!before.players.has(id)) {
          result.set(id, { ...to, interpolated: false, starvedMs: 0 });
        }
      }
      return result;
    }

    // Starved: nothing newer than the moment we want to draw. Hold position -- extrapolating would
    // walk remotes through walls and then snap them back, which reads far worse than a pause -- and
    // decay speed so the pose settles to idle instead of sliding.
    const starvedMs = targetMs - before.receivedAtMs;
    const decay = Math.max(0, 1 - starvedMs / decayMs);
    const result = new Map();
    for (const [id, player] of before.players) {
      result.set(id, {
        x: player.x,
        z: player.z,
        heading: player.heading,
        speed: player.speed * decay,
        interpolated: false,
        starvedMs,
      });
    }
    return result;
  }

  function snapshotAsSample(snapshot, extra) {
    const result = new Map();
    for (const [id, player] of snapshot.players) result.set(id, { ...player, ...extra });
    return result;
  }

  return {
    record,
    sample,
    get length() {
      return snapshots.length;
    },
    get latest() {
      return snapshots.at(-1) ?? null;
    },
    reset() {
      snapshots.length = 0;
    },
  };
}
