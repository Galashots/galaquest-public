// The 44 px floor: the pure rule, and a sweep of the real stylesheet that enforces it.
//
// The sweep is the half that matters. A pure function that decides whether a measured rect is too
// small proves nothing about the game -- GQ-015, a test that hand-feeds a function proves the
// function. So the second half reads public/index.html, finds every control given an explicit
// pixel size, and holds it against the floor. That is what would have caught the two 36 px close
// buttons at the moment they were written, instead of in an audit months later.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  TAP_TARGET_FLOOR_PX,
  describeUndersized,
  undersizedTargets,
} from '../public/src/ui/tapTargets.js';

// ── the rule ───────────────────────────────────────────────────────────────────────────────────

test('a target under the floor in EITHER dimension is too small', () => {
  // A 100x20 bar is not a hittable button because it is wide. The smaller side is the one a thumb
  // misses on.
  const offenders = undersizedTargets([
    { label: 'wide-but-thin', width: 100, height: 20 },
    { label: 'tall-but-narrow', width: 20, height: 100 },
    { label: 'fine', width: 44, height: 44 },
  ]);
  assert.deepEqual(offenders.map((o) => o.label), ['wide-but-thin', 'tall-but-narrow']);
  assert.equal(offenders[0].shortBy, 24);
});

test('a hidden control has no tap target, and an unmeasured one is not silently excused', () => {
  assert.deepEqual(undersizedTargets([{ label: 'closed', width: 10, height: 10, visible: false }]), []);
  // No `visible` key at all must NOT be read as hidden -- that would let a caller that does not
  // track visibility pass everything by omission, which is the quiet way a sweep stops sweeping.
  assert.equal(undersizedTargets([{ label: 'unknown', width: 10, height: 10 }]).length, 1);
});

test('layout rounding does not count as too small', () => {
  // A 44 px button really does measure 43.999998 in some layouts. Failing that is testing the
  // browser's arithmetic, not whether a child can hit it.
  assert.deepEqual(undersizedTargets([{ label: 'rounded', width: 43.999998, height: 44 }]), []);
  // But an actually-short control still fails, so the slack cannot be used to excuse a real gap.
  assert.equal(undersizedTargets([{ label: 'short', width: 43, height: 44 }]).length, 1);
});

test('the rule reacts to the floor rather than to the number 44', () => {
  const target = [{ label: 'x', width: 50, height: 50 }];
  assert.deepEqual(undersizedTargets(target), []);
  assert.equal(undersizedTargets(target, 64).length, 1);
});

test('the failure names the control and how far off it is', () => {
  // A failure that says "a tap target is too small" sends someone measuring every button by hand.
  const line = describeUndersized(undersizedTargets([{ label: '#hero-screen-close', width: 36, height: 36 }]));
  assert.match(line, /#hero-screen-close/);
  assert.match(line, /36/);
  assert.match(line, /8/);
});

// ── the sweep ──────────────────────────────────────────────────────────────────────────────────

const MARKUP = readFileSync(join(import.meta.dirname, '..', 'public', 'index.html'), 'utf8');

/**
 * Every CSS rule in index.html that pins an explicit pixel width or height.
 *
 * Deliberately reads the stylesheet rather than a running page: it costs a millisecond, it runs in
 * the required gate rather than the diagnostic matrix, and the two defects this is written for were
 * both plain literals in this file. A running-browser measurement catches strictly more -- padding,
 * flex, transforms -- and the harnesses do that; this catches the common case before a push.
 */
function pixelSizedRules() {
  const rules = [];
  for (const match of MARKUP.matchAll(/([#.][\w-]+(?:\[[^\]]*\])?)\s*\{([^}]*)\}/g)) {
    const [, selector, body] = match;
    const width = /(?<![-\w])width:\s*(\d+(?:\.\d+)?)px/.exec(body);
    const height = /(?<![-\w])height:\s*(\d+(?:\.\d+)?)px/.exec(body);
    if (!width && !height) continue;
    rules.push({
      selector,
      width: width ? Number(width[1]) : Infinity,
      height: height ? Number(height[1]) : Infinity,
    });
  }
  return rules;
}

/**
 * The selectors this rule does NOT apply to, each with the reason it is not a tap target.
 *
 * An allow-list rather than a heuristic, because "is this thing tappable" cannot be read off a
 * stylesheet and a wrong guess in either direction is bad: guessing tappable makes the sweep cry
 * wolf about progress bars until somebody deletes it, and guessing not-tappable is how a real
 * control slips through. Anything not named here is treated as a tap target, so a NEW control is
 * covered by default and its author has to argue otherwise in this list.
 */
const NOT_TAP_TARGETS = new Map([
  ['#hero-down-bar', 'a progress bar; nothing is aimed at it'],
  ['#touch-stick-knob', 'the visual knob INSIDE the 112px stick, and pointer-events: none'],
]);

test('the sweep finds the controls it is supposed to be looking at', () => {
  // The guard on the guard. If the selector scan stops matching, the rule below goes green over an
  // empty list while reading as coverage -- and this file exists because that already happened once
  // in this repo with a regex that matched nothing.
  const selectors = pixelSizedRules().map((r) => r.selector);
  assert.ok(selectors.length >= 3, `only ${selectors.length} pixel-sized rules found; the scan is broken`);
  for (const expected of ['#hero-screen-close', '#village-board-close', '#touch-stick']) {
    assert.ok(selectors.includes(expected), `the scan no longer sees ${expected}`);
  }
});

test('every pixel-sized control in the real stylesheet meets the floor', () => {
  const targets = pixelSizedRules()
    .filter((rule) => !NOT_TAP_TARGETS.has(rule.selector))
    .map((rule) => ({ label: rule.selector, width: rule.width, height: rule.height }));

  const offenders = undersizedTargets(targets);
  assert.deepEqual(offenders, [],
    `a child cannot reliably hit these: ${describeUndersized(offenders)}`);
});

test('every excused selector still exists, so the list cannot rot into a blanket', () => {
  // An allow-list that outlives the thing it excuses is how a sweep quietly stops sweeping: the
  // entry stays, a NEW control takes the same name, and it is exempt on arrival.
  for (const [selector, why] of NOT_TAP_TARGETS) {
    assert.ok(MARKUP.includes(selector), `${selector} is excused (${why}) but no longer exists`);
  }
});
