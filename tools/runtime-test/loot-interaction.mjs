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
 * #124 warns that A and B "are different failures" and that treating them as one flake "will produce
 * a fix that only addresses one". A is a targeting failure: the touch never reached a loot control.
 * B reached the intended control and still produced no click and no collect -- and #124 leaves open
 * that B is the real product defect #113 describes rather than noise. Collapsing B into "missed"
 * would stamp it "no dispatched touch ever reached a loot control", which B's own
 * `hitIsTarget:true` payload contradicts, and launder a possibly-product event into CI noise.
 *
 * This module is the retry rule, kept pure and injectable so it can be proven without a browser. An
 * interaction is retried until its verified post-condition holds, bounded by the subject's own
 * remaining lifetime rather than by a count. It also names the class the old harness conflated:
 *
 *   collected    the post-condition verified
 *   missed       no dispatched touch ever reached a loot control                (instrument)
 *   no-budget    the deadline passed before even one touch was dispatched       (instrument)
 *   out-of-reach a touch reached the control but the server showed the hero out of range (instrument)
 *   refused      a landed, in-range touch collected nothing before the confirmation window closed;
 *                the server never positively said "no", so this is an INFERENCE of a product
 *                refusal (the #113 shape), not proof of one
 *   reached-no-click a touch reached the intended loot control but no click was observed and
 *                nothing was collected (#124 signature B). UNRESOLVED: the reach evidence rules
 *                out a targeting failure, but a product cause is not ruled out either. This is
 *                never an instrument miss and never asserts #113 or a refusal.
 *
 * `reached-no-click` describes the RUN, not the final attempt: it fires when ANY dispatched tap
 * reached the control, even if other taps -- including the last one -- hit bare canvas. A mixed
 * run is still B-shaped, because one reached tap contradicts the `missed` sentence for the whole
 * run. The reported result therefore carries BOTH taps: `tap` is the final dispatched attempt,
 * and `reachedTap` is the first tap that reached the control without a click. A caller that
 * prints the outcome must show `reachedTap` alongside it -- a B headline above an A-shaped final
 * tap, with the justifying evidence nowhere in sight, is the same failure class as the original
 * collapse (label refuted by its own payload), merely inverted.
 *   gone         the corpse/claim left the wire before confirmation            (instrument)
 *   expired      the subject's own lifetime ran out                            (instrument)
 *
 * Only `collected` licenses the product assertions that follow. `missed`, `no-budget`,
 * `out-of-reach`, `gone`, and `expired` are instrument outcomes: a caller reports the single red
 * that names the interaction and records the downstream product checks as not judged, rather than
 * billing one missed tap as ten independent product defects. `refused` and `reached-no-click` are
 * not instrument outcomes -- the caller still gates red on them, but must report them in a way no
 * reader can mistake for noise, because a product cause is open in both cases.
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
 * The probe saw the intended loot control under the tap point, whether or not a click followed.
 * Weaker than landedOnControl, and that weakness is the point: a tap can reach the control
 * (`hitIsTarget:true`) without any click being observed (`clickLanded:false`) -- #124 signature B.
 * That shape contradicts "no dispatched touch ever reached a loot control", so it must never be
 * classified as `missed`, even though, like a miss, it waits on no receipt and retries.
 */
function reachedControl(tap) {
  return Boolean(tap && tap.found !== false && tap.hitIsTarget);
}

/**
 * Drive one interaction until its post-condition verifies, its subject dies, or its deadline passes.
 *
 * All side effects are injected so the rule is testable on a fake clock:
 *
 *   attempt()  -> one real input dispatch; resolves to the tap probe (`found`, `hitIsTarget`,
 *                 `clickLanded`, `disabled`, ...). A tap that produced no click is retried
 *                 without waiting on a receipt; one that reached the control is also recorded.
 *   confirm()  -> one authoritative read of the post-condition; resolves to
 *                 `{ verified, gone, outOfReach, wire? }`.
 *   recover()  -> put the hero back in front of the control between landed-but-unconfirmed attempts.
 *   expired()  -> whether the subject the interaction is spending has run out of life.
 *
 * @returns {Promise<{collected:boolean,outcome:string,attempts:number,recovered:boolean,
 *   sawOutOfReach:boolean,sawReachedNoClick:boolean,tap:object|null,reachedTap:object|null,
 *   wire:object|null}>} `recovered`
 *   reports the recovery on the path to the final dispatched attempt: true when no recovery
 *   was needed or the most recent one succeeded, false when the most recent recovery failed. It is
 *   NOT "every recovery ever succeeded", so an early failed recovery cannot stay sticky once a later
 *   one puts the hero back in range. `sawReachedNoClick` records whether any dispatched tap reached
 *   the control without a click being observed (#124 signature B); `reachedTap` is the first such
 *   tap (null when none), so a mixed run reports the evidence its outcome rests on rather than
 *   only the final attempt.
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
  let sawReachedNoClick = false;
  let tap = null;
  let reachedTap = null;
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
      // Recovery succeeded: clear any earlier failure so `recovered` describes the attempt this
      // recovery is about to enable, not the whole run.
      recovered = true;
      // Recovery can spend the last of the subject's life (or the deadline can pass during it). Never
      // dispatch another tap at a subject that is already gone.
      if (done()) break;
    }

    tap = (await attempt()) ?? null;
    if (!landedOnControl(tap)) {
      // No click was observed, so there is no receipt to wait on: the request was never made. But
      // "no click" is not "never reached". A tap the probe saw ON the control (hitIsTarget:true)
      // with no click following is #124 signature B -- record it, because that reach evidence
      // contradicts the `missed` sentence and a product cause is not ruled out for it. Retry until
      // the subject or the deadline says stop.
      // (Reach is the probe-time observation: the control was under the tap point when probed.
      // A product dismissal landing between the probe and the touch can also yield this shape,
      // which is why the outcome asserts only reach plus no-effect and rules nothing out.)
      // Keep the FIRST reaching tap: it is the evidence the run-level outcome rests on, and the
      // final tap -- reported separately as `tap` -- may be a canvas miss in a mixed run.
      if (reachedControl(tap)) {
        sawReachedNoClick = true;
        reachedTap ??= tap;
      }
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
      return {
        collected: true, outcome: 'collected', attempts, recovered, sawOutOfReach, sawReachedNoClick,
        tap, reachedTap, wire,
      };
    }
    if (attemptGone) {
      return {
        collected: false, outcome: 'gone', attempts, recovered, sawOutOfReach, sawReachedNoClick,
        tap, reachedTap, wire,
      };
    }
    if (!attemptOutOfReach) {
      // A real click reached a real control, the server's own reach check did not reject it, and the
      // confirmation window closed without the item being taken. This is an INFERRED product refusal
      // -- the #113 shape -- not a harness miss, and it is recorded as such even if a later attempt
      // succeeds. It is only an inference: the server never positively said no, it merely did not say
      // yes before the window ran out.
      sawInRangeLandedClick = true;
    }
  }

  // Priority is by strength of evidence. A landed click says strictly more than a reached one,
  // so the landed outcomes keep their order; but any reach evidence at all contradicts `missed`,
  // so `reached-no-click` outranks it even in a run where other taps hit bare canvas.
  const outcome = expired()
    ? 'expired'
    : attempts === 0 ? 'no-budget'
      : sawInRangeLandedClick ? 'refused'
        : sawLandedClick ? 'out-of-reach'
          : sawReachedNoClick ? 'reached-no-click'
            : 'missed';
  return {
    collected: false, outcome, attempts, recovered, sawOutOfReach, sawReachedNoClick, tap,
    reachedTap, wire,
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
    case 'no-budget':
      return 'the interaction ran out of budget before even one touch was dispatched (instrument: '
        + 'zero attempts, not a product verdict)';
    case 'refused':
      return 'a landed, in-range touch collected nothing before the confirmation window closed; the '
        + 'server never positively said no, so this is an INFERRED product refusal (the #113 shape), '
        + 'not proof of one';
    case 'out-of-reach':
      return 'a touch reached the control but the server showed the hero out of interact reach';
    case 'reached-no-click':
      return 'a dispatched touch reached the intended loot control but produced no click and '
        + 'nothing was collected (the control was reached, so this is not a targeting failure; '
        + 'a product cause is not ruled out -- #124 signature B)';
    case 'gone':
      return 'the corpse/claim left the wire before the interaction could be confirmed';
    case 'expired':
      return 'the corpse ran out of lifetime before the interaction could be confirmed';
    default:
      return `the interaction ended in an unknown state (${result?.outcome})`;
  }
}
