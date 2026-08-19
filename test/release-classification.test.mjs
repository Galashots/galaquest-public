// The movement diagnostic's release classifier, tested against synthetic traces.
//
// WHY THIS EXISTS. The classifier's job is to decide whether a genuine release was rejected by
// setIntent. A run that reports "no defect" means nothing unless the classifier is capable of
// reporting a defect -- so the cases below include a REPRODUCTION of case C, and it must come out
// red-labelled. Without that, a green hosted run is indistinguishable from a broken instrument.
//
// A trace is the ordered list of setIntent calls, one per rendered frame:
//   { seq, t, magnitude, sent, prevSentMagnitude, status, releaseCandidate }
// releaseCandidate mirrors production's own test: magnitude === 0 && lastSentMagnitude > 0.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { classifyReleases } from '../tools/diagnostics/release-classification.mjs';

const call = (seq, t, magnitude, sent, prevSentMagnitude, status = 'online') => ({
  seq, t, magnitude, sent, prevSentMagnitude, status,
  releaseCandidate: magnitude === 0 && prevSentMagnitude > 0,
});

test('case B: a sampled release that transmits is classified B, not a defect', () => {
  const intents = [
    call(0, 100, 1, true, 0),
    call(1, 116, 1, false, 1),
    call(2, 132, 0, true, 1),
  ];
  const { episodes } = classifyReleases(intents, [{ pulse: 1, downT: 90, upT: 125 }]);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].verdict, 'B');
});

test('case C: a genuine release that is NOT transmitted is classified C -- the red case', () => {
  const intents = [
    call(0, 100, 1, true, 0),
    // Online, previous transmitted magnitude was 1, this is the first non-zero -> zero transition,
    // and it did not go out. This is the only shape that justifies touching production code.
    call(1, 132, 0, false, 1),
  ];
  const { episodes } = classifyReleases(intents, [{ pulse: 1, downT: 90, upT: 125 }]);
  assert.equal(episodes[0].verdict, 'C',
    'a genuine unsent release must be reported as C, otherwise a green run proves nothing');
});

test('case C is not reported when the client was offline -- that is a different fault', () => {
  const intents = [
    call(0, 100, 1, true, 0),
    call(1, 132, 0, false, 1, 'offline'),
  ];
  const { episodes } = classifyReleases(intents, [{ pulse: 1, downT: 90, upT: 125 }]);
  assert.equal(episodes[0].verdict, 'C-offline');
});

test('an already-consumed release returning false is NOT a defect', () => {
  // This is the shape that produced the original wrong conclusion: after the real release goes out,
  // lastSentMagnitude is 0, so every later zero is correctly refused and is not a release at all.
  const intents = [
    call(0, 100, 1, true, 0),
    call(1, 132, 0, true, 1),     // the real release, transmitted
    call(2, 148, 0, false, 0),    // correctly refused: not a release
    call(3, 164, 0, false, 0),    // correctly refused
  ];
  const { episodes } = classifyReleases(intents, [{ pulse: 1, downT: 90, upT: 125 }]);
  assert.equal(episodes[0].verdict, 'B');
  assert.equal(episodes[0].candidateSeq, 1, 'the transition, not a later consumed zero, is the candidate');
});

test('case A: a pulse whose zero was never sampled has no release to reject', () => {
  // Frame starvation: the rendered loop never observes pulse 1's gap. The only transition in the
  // trace belongs to pulse 2, so pulse 1 has NO release candidate at all -- which is case A, and
  // emphatically not evidence that setIntent rejected anything.
  const intents = [
    call(0, 100, 1, true, 0),
    call(1, 800, 1, false, 1),    // next frame lands 700 ms later, key already down again
    call(2, 1500, 0, true, 1),
  ];
  const { episodes } = classifyReleases(intents, [
    { pulse: 1, downT: 90, upT: 200 },
    { pulse: 2, downT: 700, upT: 900 },
  ]);
  assert.equal(episodes.length, 2);
  assert.equal(episodes[0].verdict, 'A', 'pulse 1 never had its zero sampled');
  assert.equal(episodes[0].candidateSeq, null, 'and it must not borrow pulse 2 transition');
  assert.equal(episodes[1].verdict, 'B', "pulse 2's own release did transmit");
});

test('a release sampled late, inside the NEXT pulse window, is still attributed and still B', () => {
  // The exact misclassification that invalidated the first hosted conclusion: the zero is sampled
  // after the next key-down, so a window-based partition would never count it as pulse 1's release.
  const intents = [
    call(0, 100, 1, true, 0),
    call(1, 760, 0, true, 1),     // sampled 560 ms after key-up, after pulse 2's key-down at 700
    call(2, 1400, 1, true, 0),
  ];
  const { episodes } = classifyReleases(intents, [
    { pulse: 1, downT: 90, upT: 200 },
    { pulse: 2, downT: 700, upT: 900 },
  ]);
  assert.equal(episodes[0].verdict, 'B');
  assert.equal(episodes[0].landedAfterNextKeyDown, true,
    'the instrument must record that this landed inside the next pulse, not silently drop it');
});

test('sabotage: the classifier is not hard-coded to B -- flipping only `sent` flips the verdict', () => {
  const base = (sent) => classifyReleases(
    [call(0, 100, 1, true, 0), call(1, 132, 0, sent, 1)],
    [{ pulse: 1, downT: 90, upT: 125 }],
  ).episodes[0].verdict;
  assert.equal(base(true), 'B');
  assert.equal(base(false), 'C');
});
