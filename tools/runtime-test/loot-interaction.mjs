/**
 * One real loot interaction, retried on its VERIFIED POST-CONDITION.
 *
 * Issue #124: `drive-corpse-loot` flipped between pass and fail at the same SHA, and when it failed a
 * single interaction that did not take effect printed as roughly nine product regressions. Two
 * distinct signatures were recorded, both ending in `clickLanded:false`:
 *
 *   A  hitIsTarget:false, hit:"CANVAS#game-canvas",                attempts:2
 *   B  hitIsTarget:true,  hit:"BUTTON#corpse-loot-panel-take-all", attempts:3
 *
 * The old loop gave every interaction exactly three attempts. Both signatures spent that budget -- A
 * used two, B all three -- and then the harness went on to assert the product consequences of a
 * collect that had never happened. Neither signature is by itself a statement about the product.
 *
 * This module is the retry rule, kept pure and injectable so it can be proven without a browser. An
 * interaction is retried until its verified post-condition holds, bounded by the subject's own
 * remaining lifetime rather than by a count. It also names the class the old harness conflated:
 *
 *   collected    the post-condition verified
 *   missed       no dispatched touch ever reached a loot control                (instrument)
 *   out-of-reach a touch reached the control but the server showed the hero out of range (instrument)
 *   refused      a touch reached the control while the server showed the hero IN reach and the
 *                server still never collected                              (product; the #113 shape)
 *   gone         the corpse/claim left the wire before confirmation            (instrument)
 *   expired      the subject's own lifetime ran out                            (instrument)
 *
 * Only `collected` licenses the product assertions that follow. The rest are instrument outcomes: a
 * caller reports the single red that names the interaction and records the downstream product checks
 * as not judged, rather than billing one missed tap as ten independent product defects.
 */

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Clamp a timeout-like value to a finite, non-negative number. */
function finiteMillis(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function landedOnControl(tap) {
  return Boolean(tap && tap.found !== false && tap.hitIsTarget && tap.clickLanded);
}

/**
 * Drive one interaction until its post-condition verifies, its subject dies, or its deadline passes.
 *
 * All side effects are injected so the rule is testable on a fake clock:
 *
 *   attempt()  -> one real input dispatch; resolves to the tap probe (`found`, `hitIsTarget`,
 *                 `clickLanded`, `disabled`, ...). A tap that did not reach the control is retried.
 *   confirm()  -> one authoritative read of the post-condition; resolves to
 *                 `{ verified, gone, outOfReach, wire? }`.
 *   recover()  -> put the hero back in front of the control between landed-but-unconfirmed attempts.
 *   expired()  -> whether the subject the interaction is spending has run out of life.
 *
 * @returns {Promise<{collected:boolean,outcome:string,attempts:number,recovered:boolean,
 *   sawOutOfReach:boolean,tap:object|null,wire:object|null}>}
 */
export async function collectUntilEffect({
  attempt,
  confirm,
  recover = async () => true,
  expired = () => false,
  now = Date.now,
  deadline = now(),
  confirmTimeoutMs = 6_000,
  pollIntervalMs = 120,
  sleep = defaultSleep,
} = {}) {
  const hardStop = finiteMillis(deadline, now());
  const confirmWindow = finiteMillis(confirmTimeoutMs, 6_000);
  const poll = finiteMillis(pollIntervalMs, 120);
  const done = () => now() >= hardStop || expired();

  let attempts = 0;
  let recovered = true;
  let sawOutOfReach = false;
  let sawLandedClick = false;
  let sawInRangeLandedClick = false;
  let tap = null;
  let wire = null;

  while (!done()) {
    attempts += 1;
    if (attempts > 1) {
      // Recovery must be attempted between tries, but a failed recovery is not a verdict: keep
      // trying while the subject is alive, because the deadline -- not a count -- is the bound.
      if (!(await recover({ deadline: hardStop }))) {
        recovered = false;
        await sleep(poll);
        continue;
      }
      // Recovery can spend the last of the subject's life (or the deadline can pass during it). Never
      // dispatch another tap at a subject that is already gone.
      if (done()) break;
    }

    tap = (await attempt()) ?? null;
    if (!landedOnControl(tap)) {
      // The dispatched touch never reached a loot control. Do NOT wait on a receipt: the request was
      // never made. Retry until the subject or the deadline says stop.
      continue;
    }
    sawLandedClick = true;

    let confirmed = false;
    let attemptGone = false;
    let attemptOutOfReach = false;
    const confirmDeadline = Math.min(now() + confirmWindow, hardStop);
    for (;;) {
      wire = (await confirm()) ?? null;
      if (wire?.verified) { confirmed = true; break; }
      if (wire?.gone) { attemptGone = true; break; }
      if (wire?.outOfReach) { attemptOutOfReach = true; sawOutOfReach = true; break; }
      if (now() >= confirmDeadline) break;
      await sleep(poll);
    }

    if (confirmed) {
      return { collected: true, outcome: 'collected', attempts, recovered, sawOutOfReach, tap, wire };
    }
    if (attemptGone) {
      return { collected: false, outcome: 'gone', attempts, recovered, sawOutOfReach, tap, wire };
    }
    if (!attemptOutOfReach) {
      // A real click reached a real control, the server's own reach rule allowed it, and the server
      // still never reported the item taken. That is a product refusal -- the #113 shape -- not a
      // harness miss, and it is recorded as such even if a later attempt succeeds.
      sawInRangeLandedClick = true;
    }
  }

  const outcome = expired()
    ? 'expired'
    : sawInRangeLandedClick ? 'refused'
      : sawLandedClick ? 'out-of-reach'
        : 'missed';
  return {
    collected: false, outcome, attempts, recovered, sawOutOfReach, tap, wire,
  };
}

/**
 * The single sentence a receipt prints to say WHY the product assertions that follow were not
 * judged. Kept here so the harness cannot silently reclassify a product refusal as noise.
 */
export function interactionClassReason(result) {
  switch (result?.outcome) {
    case 'collected':
      return 'the interaction verified';
    case 'missed':
      return 'no dispatched touch ever reached a loot control (instrument miss, not a product verdict)';
    case 'refused':
      return 'a touch reached the control while the server showed the hero in reach and the server '
        + 'still did not collect (product refusal, the #113 shape)';
    case 'out-of-reach':
      return 'a touch reached the control but the server showed the hero out of interact reach';
    case 'gone':
      return 'the corpse/claim left the wire before the interaction could be confirmed';
    case 'expired':
      return 'the corpse ran out of lifetime before the interaction could be confirmed';
    default:
      return `the interaction ended in an unknown state (${result?.outcome})`;
  }
}
