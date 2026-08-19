// Release classification for the movement diagnostic.
//
// Split out of diagnose-movement.mjs so it can be tested directly. A classifier that only ever
// reports "no defect" is worthless unless you can show it reports a defect when one exists, and
// that demonstration needs synthetic traces rather than a browser.

// THE DECISION THIS FILE EXISTS TO MAKE.
//
// For every successfully transmitted non-zero intent, what happens next in chronological client
// state? Exactly one of:
//
//   A  release never sampled -- input went non-zero again (or the trace ended) before the rendered
//      loop ever observed a zero. Nothing was rejected; the zero state was never presented. This is
//      a frame-starvation / pulse-shape problem, NOT evidence about setIntent.
//   B  release sampled and transmitted -- the first zero after a transmitted non-zero went out.
//      Release semantics work. Every LATER zero returning false is correct and expected, because
//      lastSentMagnitude is now 0 so those calls are not releases at all.
//   C  genuine release sampled but rejected -- online, prior sent magnitude > 0, first non-zero ->
//      zero transition, and it did not go out. ONLY this establishes a release-transmission defect.
//
// wireZeroFrames is the independent check: what the socket actually carried, from CDP, rather than
// setIntent's own return value.
// THE UNIT OF ANALYSIS IS THE HARNESS PULSE, NOT THE INDIVIDUAL SEND. An earlier version of this
// walked forward from every transmitted non-zero and asked what came next; mid-pulse that is always
// another non-zero, so it labelled 21 of 22 sends "release never sampled" while the wire showed six
// releases actually transmitted. A pulse has exactly one release to account for: the first
// zero-magnitude sample after its key-up. That is what gets classified.
export function classifyReleases(intents, pulseKeys) {
  // Every actual non-zero -> zero transition the rendered loop sampled. This list, not the harness
  // clock, is the ground truth about when a release was presented to setIntent.
  const transitions = [];
  for (let j = 1; j < intents.length; j += 1) {
    if (intents[j].magnitude === 0 && intents[j - 1].magnitude > 0) {
      transitions.push({ call: intents[j], prevNonZeroT: intents[j - 1].t });
    }
  }

  const episodes = [];
  for (let i = 0; i < pulseKeys.length; i += 1) {
    const { pulse, downT, upT } = pulseKeys[i];
    const nextDownT = pulseKeys[i + 1]?.downT ?? Infinity;

    // Attribute the pulse's release to a STRUCTURAL transition in the sampled stream -- a zero
    // sample immediately preceded by a non-zero one -- rather than to the first zero after upT.
    // upT is read by a CDP round-trip AFTER the key-up dispatch, so a frame can sample the zero
    // before upT is even recorded; anchoring on upT then skips the real release and lands on a
    // later, already-consumed zero. The transition is the physical event; upT is only a label.
    const candidate = transitions.find((tr) => tr.prevNonZeroT >= downT
      && tr.prevNonZeroT <= (pulseKeys[i + 1]?.downT ?? Infinity))?.call ?? null;
    const sentInPulse = intents.some((c) => c.t >= downT && c.t <= upT && c.sent && c.magnitude > 0);

    let verdict;
    if (!candidate) {
      verdict = 'A';                                  // no zero was ever sampled again
    } else if (candidate.sent) {
      verdict = 'B';
    } else if (candidate.releaseCandidate) {
      // Production's own test held (prevSentMagnitude > 0) and it still did not go out.
      verdict = candidate.status === 'online' ? 'C' : 'C-offline';
    } else {
      // prevSentMagnitude was already 0: an earlier zero consumed the release. Correct refusal.
      verdict = 'B-consumed';
    }

    episodes.push({
      pulse,
      downT: +downT.toFixed(1),
      upT: +upT.toFixed(1),
      transmittedNonZeroInPulse: sentInPulse,
      verdict,
      candidateSeq: candidate?.seq ?? null,
      candidateT: candidate ? +candidate.t.toFixed(1) : null,
      candidateSent: candidate?.sent ?? null,
      candidatePrevSentMagnitude: candidate?.prevSentMagnitude ?? null,
      candidateStatus: candidate?.status ?? null,
      msFromKeyUpToCandidate: candidate ? +(candidate.t - upT).toFixed(1) : null,
      // The evidence the previous conclusion needed and did not have: whether the release was
      // sampled so late that it landed inside the NEXT pulse's nominal window.
      landedAfterNextKeyDown: candidate ? candidate.t > nextDownT : null,
    });
  }

  // Two pulses resolving to the SAME candidate call means the runs merged: the earlier pulse's
  // key-up was never separately observed by the rendered loop. That is case A, not a rejection.
  const seen = new Map();
  for (const e of episodes) {
    if (e.candidateSeq == null) continue;
    if (seen.has(e.candidateSeq)) {
      const first = seen.get(e.candidateSeq);
      first.verdict = 'A';
      first.mergedWithPulse = e.pulse;
    }
    seen.set(e.candidateSeq, e);
  }
  return { episodes, transitionCount: transitions.length };
}
