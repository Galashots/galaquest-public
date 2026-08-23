// Acting and deciding from INSIDE the page, on rendered frames, instead of from the harness on a
// wall clock.
//
// WHY THIS MODULE EXISTS, stated as the measurement that produced it rather than as a preference.
//
// Every harness here drives a browser over CDP: send an input, sleep, read the state back, judge.
// That shape is correct on a developer desktop, where a Runtime.evaluate costs about 5ms and the
// page paints every 17ms, so a read is effectively free and lands within the same frame as the act.
// It is wrong everywhere this project's CI actually runs. The hosted runner has no GPU; the game
// paints somewhere between 3 and 10 frames per second, and on a page that starved a Runtime.evaluate
// waits on the main thread and costs a whole frame. Three consequences follow, and between them they
// account for most of the matrix's red:
//
//   1. A LOOP BUDGETED IN MILLISECONDS gets a fraction of the iterations it was tuned for.
//      Measured: drive-relight's walk spent 7217ms of a 10000ms budget locally to cross 6.44m, of
//      which 3120ms was per-iteration settle sleep and 129ms was CDP. The same loop hosted covered
//      3.1m before the budget expired and stopped 3.3m from the Keeper.
//
//   2. AN INPUT PULSE CAN SPAN NO RENDERED FRAME AT ALL. main.js samples input and calls setIntent
//      only from the frame loop, so a 60-260ms press between two 333ms frames transmits nothing.
//      This is the hypothesis tools/diagnostics/diagnose-movement.mjs was written to discriminate.
//
//   3. A SHORT-LIVED STATE CAN LIVE AND DIE BETWEEN TWO READS. WOLF_HIT_FLASH_SECONDS is 0.18s.
//      A poll written `intervalMs: 20` really samples every ~300ms on a starved runner, so the
//      window it exists to catch is smaller than the gap between its own samples.
//
// The common error is not any one timeout. It is that these harnesses are written in wall-clock time
// while the thing they drive advances in rendered frames. Enlarging a timeout re-decides the same
// number by drift on the next machine; the ledger has that as its own entry, and it has been hit
// enough times to have a rule.
//
// So the two primitives below move the frame-rate-sensitive half into the page:
//
//   startWatch  -- record a value once per rendered frame. Observation then costs nothing and
//                  cannot be too slow, so polling a WATCH is safe at any rate even though polling
//                  LIVE STATE is not. A 0.18s flash lands in the log whether or not anyone was
//                  looking. Read it once at the end.
//   startWalk   -- steer and decide arrival once per rendered frame, so the movement key can be
//                  held for the whole walk. Wall clock becomes distance over speed on any machine,
//                  and CDP latency delays only the release.
//
// Both are additive and read-only with respect to the product: they call published accessors on
// window.__galaQuestRuntime and set the camera heading, which is a control a player owns. Nothing
// here modifies a rule, a tolerance or a gameplay value.
//
// Every function returning a string returns JAVASCRIPT SOURCE for the caller to hand to its own
// page.eval. This module deliberately does not know what a page object looks like -- each harness
// has its own CDP wrapper, and they differ.

import { pollUntilDeadline } from './automation-timing.mjs';

/** Where both primitives keep their state, so a harness can find them by hand in a live tab too. */
const WATCH_STORE = 'window.__gqWatch';
const WALK_STATE = 'window.__gqWalk';

/**
 * Record `sampleExpression` once per rendered frame, under `key`.
 *
 * @param key               names this recording; starting a second under the same key stops the first.
 * @param sampleExpression  JS source for one sample. Evaluated inside the page every frame, so it
 *   must be cheap and must not throw for long -- a throw is recorded as `{ error }` rather than
 *   killing the loop, because a recorder that dies silently is worse than one that reports.
 * @param maxSamples        hard cap on retained samples. Samples past it are COUNTED in `dropped`
 *   rather than silently discarded: a truncated log that reads as complete is how a harness reports
 *   "never happened" for something it simply stopped watching.
 */
export function startWatch(key, sampleExpression, { maxSamples = 1200 } = {}) {
  const name = JSON.stringify(key);
  return `(() => {
  const store = ${WATCH_STORE} = ${WATCH_STORE} || {};
  if (store[${name}]) store[${name}].stopped = true;
  const watch = { frames: 0, dropped: 0, stopped: false, samples: [] };
  store[${name}] = watch;
  const step = () => {
    if (watch.stopped) return;
    watch.frames += 1;
    let value;
    try {
      value = (${sampleExpression});
    } catch (error) {
      value = { error: String(error && error.message ? error.message : error) };
    }
    if (watch.samples.length < ${maxSamples}) watch.samples.push(value);
    else watch.dropped += 1;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return true;
})()`;
}

/** JS source reading one recording back. */
export function readWatchSource(key) {
  return `JSON.stringify((${WATCH_STORE} || {})[${JSON.stringify(key)}] || null)`;
}

/** JS source stopping one recording. Safe when it was never started. */
export function stopWatchSource(key) {
  const name = JSON.stringify(key);
  return `Boolean((${WATCH_STORE} || {})[${name}]) && (${WATCH_STORE}[${name}].stopped = true)`;
}

/**
 * Wait until some recorded sample satisfies `predicate`.
 *
 * The difference from polling live state is the whole point of this module: every frame since the
 * recording started is in the log, so a slow poll delays the ANSWER but cannot miss the EVENT.
 *
 * @returns the whole watch, so a caller can report frames and dropped alongside its verdict.
 */
export async function waitForSample(page, key, predicate, { intervalMs = 100, timeoutMs = 5000 } = {}) {
  const read = () => page.eval(readWatchSource(key)).then(JSON.parse);
  return pollUntilDeadline(read, (watch) => Boolean(watch) && watch.samples.some(predicate),
    { intervalMs, timeoutMs });
}

/**
 * Steer toward a target and latch arrival, once per rendered frame.
 *
 * The caller holds the movement input itself -- a real CDP key or touch, so the input route under
 * test stays the real one -- and this only aims the camera. Aiming is enough because forward input
 * is camera-relative: point the heading at the target every frame and "hold forward" means "walk at
 * the target", including while the target moves.
 *
 * @param targetExpression  JS source evaluated every frame, returning `{ x, z }`. An expression
 *   rather than a pair so a moving target is re-read at frame resolution instead of at whatever
 *   rate the harness could have sampled it.
 * @param stopWithin        metres. Arrival needs BOTH the rendered hero and the authoritative one
 *   inside it, which is the pair a caller's own check reads.
 */
export function startWalk(targetExpression, stopWithin) {
  return `(async () => {
  const { headingToward } = await import('/src/world/zoneLoader.js');
  const runtime = window.__galaQuestRuntime;
  const walk = {
    frames: 0, arrived: false, arrivedFrame: null,
    startMetres: null, closestMetres: null, metres: null, stopped: false,
  };
  ${WALK_STATE} = walk;
  const step = () => {
    if (walk.stopped) return;
    walk.frames += 1;
    const target = (${targetExpression});
    const away = (x, z) => Math.hypot(target.x - x, target.z - z);
    const self = runtime.netState().serverSelf;
    // Steer by the position the SERVER holds: it is the one authority will snap the hero back to,
    // and the one a caller's check reads. But do not call the walk done until the rendered hero has
    // caught up as well, because a caller asserts on both.
    const authority = self ? { x: self.x, z: self.z } : runtime.player.position;
    const behind = Math.max(
      away(runtime.player.position.x, runtime.player.position.z),
      away(authority.x, authority.z),
    );
    if (walk.startMetres === null) walk.startMetres = behind;
    walk.metres = behind;
    if (walk.closestMetres === null || behind < walk.closestMetres) walk.closestMetres = behind;
    if (!walk.arrived && behind <= ${stopWithin}) {
      walk.arrived = true;
      walk.arrivedFrame = walk.frames;
    }
    runtime.follow.setHeading(headingToward(authority.x, authority.z, target.x, target.z));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return true;
})()`;
}

/** JS source reading the walk back. */
export const READ_WALK = `JSON.stringify(${WALK_STATE} || null)`;
/** JS source stopping the walk. Safe when it was never started. */
export const STOP_WALK = `Boolean(${WALK_STATE}) && (${WALK_STATE}.stopped = true)`;

/** A metre reading for a log line, or 'unknown' when no frame ever painted. */
export function metresOrUnknown(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}m` : 'unknown';
}
