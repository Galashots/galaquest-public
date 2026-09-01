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

/**
 * Track something that is DYING while the harness works on it, and budget waits against what it has
 * left rather than against a constant typed here.
 *
 * `pollUntilDeadline` above fixes one half of the hosted-latency problem: a loop must be bounded by
 * elapsed time, not by a sample count. This fixes the other half, which drive-corpse-loot found the
 * expensive way at a20fcd7. Every one of that run's budgets was already a wall-clock deadline and
 * every gameplay assertion it reached passed -- and it still went red, because the budgets were
 * sized against each other and not against the subject. One re-approach was allowed sixty seconds
 * of a claim that only lives a hundred and eighty, so the choreography outlived the corpse and the
 * final tap landed on a body that had already expired.
 *
 * The rule this encodes: a wait can never be budgeted longer than the subject has left to live, and
 * a phase that still has work after it must reserve the time that work needs. `budgetFor` is
 * therefore the only way a caller should turn "I would like N milliseconds" into a real deadline.
 */
export function subjectLifetime({ bornAtMillis, lifetimeSeconds, now = Date.now } = {}) {
  const born = finiteMillis(bornAtMillis, now());
  const lifetime = Math.max(0, finiteMillis(lifetimeSeconds * 1000, 0));
  const remainingMillis = () => Math.max(0, born + lifetime - now());
  return {
    remainingMillis,
    /** Seconds spent so far, rounded the way a log line wants to read. */
    elapsedSeconds: () => Math.round((now() - born) / 100) / 10,
    expired: () => remainingMillis() <= 0,
    /**
     * The largest wait this phase may actually take: what it wanted, what the subject has left, and
     * what the phases after it still need, whichever is smallest. Never negative -- a caller that
     * passes this straight to deadlineAfter must get "no time at all", not a deadline in the past
     * that reads as an enormous one.
     */
    budgetFor: (wantedMillis, { reserveMillis = 0 } = {}) => Math.max(
      0,
      Math.min(finiteMillis(wantedMillis, 0), remainingMillis() - Math.max(0, finiteMillis(reserveMillis, 0))),
    ),
  };
}
