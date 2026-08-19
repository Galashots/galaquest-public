/**
 * Wall-clock timing helpers for browser automation.
 *
 * CDP state reads are not free: under hosted headless load a Runtime.evaluate call can take far
 * longer than the nominal sleep between samples. A loop bounded by "number of samples" therefore
 * stops being bounded by time and can keep a movement key held for minutes. These helpers make the
 * elapsed wall clock authoritative instead.
 */

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Clamp a timeout-like value to a finite, non-negative number. */
function finiteMillis(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Read until a predicate is true or a wall-clock deadline expires.
 *
 * The read itself may cross the deadline; at most one in-flight read can do so. That is deliberate:
 * callers still receive the freshest observable state rather than a stale sample taken before the
 * timeout boundary.
 */
export async function pollUntilDeadline(
  read,
  predicate,
  {
    intervalMs = 100,
    timeoutMs = 5000,
    sleep = defaultSleep,
    now = Date.now,
  } = {},
) {
  const interval = finiteMillis(intervalMs, 100);
  const timeout = finiteMillis(timeoutMs, 5000);
  const deadline = now() + timeout;
  let last = await read();

  while (!predicate(last)) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(interval, remaining));
    last = await read();
  }
  return last;
}

/** A simple wall-clock deadline token for movement loops. */
export function deadlineAfter(timeoutMs, now = Date.now) {
  return now() + finiteMillis(timeoutMs, 0);
}

/**
 * Duration for one bounded movement pulse.
 *
 * Long pulses are useful while far away; short pulses prevent crossing a small trigger radius when
 * the next CDP state read is slow. The caller releases input before doing that read, so automation
 * load can no longer turn observation latency into extra movement.
 */
export function movementPulseMillis(distanceMeters, {
  minMs = 70,
  maxMs = 300,
  msPerMeter = 55,
} = {}) {
  const distance = Number.isFinite(distanceMeters) ? Math.max(0, distanceMeters) : 0;
  const lower = Math.max(0, finiteMillis(minMs, 70));
  const upper = Math.max(lower, finiteMillis(maxMs, 300));
  const scaled = distance * finiteMillis(msPerMeter, 55);
  return Math.min(upper, Math.max(lower, Math.round(scaled)));
}
