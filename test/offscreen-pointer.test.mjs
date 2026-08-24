// The arrow has to point where the thing actually is, including when the thing is behind you.
//
// The case worth writing tests for at all is the last one. three.js's project() does not clip, so a
// point behind the camera comes back mirrored through the origin -- a target directly behind the
// hero reports as directly in front, on screen, at a plausible coordinate. An indicator built on the
// raw result does not merely misplace itself; it confidently points a child the wrong way, which is
// worse than no indicator at all, because a child who sees nothing looks around and a child who sees
// an arrow follows it.
//
// Everything else here exists so that the behind-camera cases cannot be satisfied by an
// implementation that is wrong about the ordinary ones.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  DEFAULT_EDGE_MARGIN_PX,
  edgeIndicatorFor,
} from '../public/src/ui/offscreenPointer.js';

/** A portrait tablet, which is what this game is built for. */
const VIEW = { width: 768, height: 1024, marginPx: DEFAULT_EDGE_MARGIN_PX };

const at = (ndcX, ndcY, behindCamera = false) => edgeIndicatorFor({ ndcX, ndcY, behindCamera, ...VIEW });

/** Degrees, for assertions a human can check against a picture. atan2 in a +y-DOWN space, so 0 is
 *  right, +90 is DOWN the screen, ±180 is left, -90 is up. */
const degrees = (radians) => Math.round((radians * 180) / Math.PI);

test('a target in the middle of the view is on screen, and points nowhere', () => {
  const it = at(0, 0);
  assert.equal(it.onScreen, true);
  assert.equal(it.x, 384);
  assert.equal(it.y, 512);
  // Not 0, not "up" -- null. An indicator sitting on the thing it indicates is not pointing
  // anywhere, and a caller that draws an arrow from a null angle has a bug this makes loud.
  assert.equal(it.angle, null);
});

test('the vertical axis is not flipped', () => {
  // NDC +y is UP; overlay +y is DOWN. Getting this backwards renders the whole guidance system
  // upside down, silently, and it is why render/screenProjection.js exists as its own tested unit.
  assert.ok(at(0, 0.5).y < 512, 'a target above centre draws above centre');
  assert.ok(at(0, -0.5).y > 512, 'a target below centre draws below centre');
});

test('a target off the right edge is pinned to the right, pointing right', () => {
  const it = at(3, 0);
  assert.equal(it.onScreen, false);
  assert.equal(it.x, 768 - DEFAULT_EDGE_MARGIN_PX, 'pinned to the inset edge, not to the viewport edge');
  assert.equal(it.y, 512);
  assert.equal(degrees(it.angle), 0);
});

test('a target off the top is pinned to the top, pointing up', () => {
  const it = at(0, 3);
  assert.equal(it.onScreen, false);
  assert.equal(it.y, DEFAULT_EDGE_MARGIN_PX);
  assert.equal(it.x, 384);
  assert.equal(degrees(it.angle), -90, 'up the screen is negative in a +y-down space');
});

test('an indicator never leaves the inset rectangle, from any direction', () => {
  const margin = DEFAULT_EDGE_MARGIN_PX;
  for (const [x, y] of [[9, 0], [-9, 0], [0, 9], [0, -9], [7, 7], [-7, 7], [7, -7], [-7, -7], [1.01, 0.2]]) {
    const it = at(x, y);
    assert.equal(it.onScreen, false, `(${x},${y}) should be off screen`);
    assert.ok(it.x >= margin - 1e-9 && it.x <= 768 - margin + 1e-9, `x ${it.x} outside the inset box`);
    assert.ok(it.y >= margin - 1e-9 && it.y <= 1024 - margin + 1e-9, `y ${it.y} outside the inset box`);
  }
});

test('the bearing is measured in PIXELS, so a tall screen does not skew it', () => {
  // The same NDC offset on both axes is NOT the same number of pixels on a 768x1024 view: one unit
  // of NDC is 384 px across and 512 px down. An arrow computed in NDC would claim 45 degrees while
  // the target visibly sits steeper than that, and the child would be sent off at an angle.
  // (2,-2) rather than (1,-1): the latter sits exactly ON the frame boundary, which is on screen by
  // the rule below, so it has no bearing to check. Same 1:1 NDC offset, same direction, off screen.
  const it = at(2, -2); // right and DOWN the screen (NDC -y is down)
  const expected = Math.round((Math.atan2(512, 384) * 180) / Math.PI);
  assert.equal(degrees(it.angle), expected, 'the bearing follows the pixels the child can see');
  assert.notEqual(degrees(it.angle), 45, 'and is deliberately not the NDC-space answer');
});

// ── behind the camera: the whole reason this module exists ─────────────────────────────────────

test('a target DIRECTLY BEHIND is never reported as on screen', () => {
  // The defect in one line. project() hands back (0,0) for a point directly behind the camera --
  // dead centre, perfectly plausible -- and an implementation that trusts it draws the marker over
  // the middle of the view, on top of nothing, while the child walks further away from the thing.
  const it = at(0, 0, true);
  assert.equal(it.onScreen, false);
});

test('...and it says "turn around" rather than producing a NaN bearing', () => {
  const it = at(0, 0, true);
  // The mirrored point lands exactly on the centre, so the direction from centre to target is the
  // zero vector and its angle is genuinely undefined. Straight down: toward the child's own feet in
  // a +y-down overlay, and the one bearing that can never be a real on-screen heading.
  assert.equal(Number.isFinite(it.angle), true, 'a bearing of NaN would rotate the marker to nothing');
  assert.equal(degrees(it.angle), 90);
  assert.equal(it.x, 384);
  assert.ok(it.y > 512, 'and it sits below the hero, not above');
});

test('a target behind and to the LEFT points left, not right', () => {
  // The mirror is the entire test. project() reports a behind-left target with a POSITIVE x, so an
  // implementation that skips the negation sends the child right when they should turn left -- and
  // it does so with total confidence, at a sensible-looking screen position.
  const naive = at(0.5, 0, false);
  const correct = at(0.5, 0, true);

  assert.equal(degrees(naive.angle ?? 0), 0, 'the raw reading says "to your right"');
  assert.equal(degrees(correct.angle), 180, 'the truth is "behind you, to your left"');
});

test('a target behind and below points up-screen after the mirror', () => {
  const it = at(0, -0.5, true);
  assert.equal(it.onScreen, false);
  assert.equal(degrees(it.angle), -90, 'mirrored to above centre, so the arrow points up');
});

test('being behind the camera beats being inside the frame, always', () => {
  // Every one of these has an NDC that reads as comfortably on screen. All of them are behind.
  for (const [x, y] of [[0, 0], [0.5, 0.5], [-0.9, 0.9], [0.1, -0.1]]) {
    assert.equal(at(x, y, true).onScreen, false, `(${x},${y}) behind the camera must not read on screen`);
  }
});

// ── shapes a real device actually produces ─────────────────────────────────────────────────────

test('landscape works, and the margin is respected on the short axis', () => {
  const it = edgeIndicatorFor({ ndcX: 0, ndcY: 5, behindCamera: false, width: 1024, height: 768, marginPx: 36 });
  assert.equal(it.onScreen, false);
  assert.equal(it.y, 36);
  assert.equal(it.x, 512);
});

test('a margin wider than half the view collapses to the centre instead of inverting', () => {
  // Reachable on a small phone with a generous margin, and an inside-out rectangle would place the
  // indicator on the OPPOSITE edge from the target -- pointing at the right answer from the wrong
  // side of the screen, which is the most confusing thing this could do.
  const it = edgeIndicatorFor({ ndcX: 5, ndcY: 0, behindCamera: false, width: 200, height: 200, marginPx: 400 });
  assert.equal(it.onScreen, false);
  assert.equal(it.x, 100, 'collapsed to the centre, not mirrored past it');
  assert.equal(it.y, 100);
});

test('a target exactly on the frame edge is still on screen', () => {
  // The boundary belongs to the visible side: at exactly ndc 1 the target is drawn at the last
  // column of pixels, and swapping to an edge indicator there would make the marker flicker between
  // two presentations while a child stands still.
  assert.equal(at(1, 0).onScreen, true);
  assert.equal(at(-1, 0).onScreen, true);
  assert.equal(at(0, 1).onScreen, true);
  assert.equal(at(0, -1).onScreen, true);
});

test('nothing produces NaN, for any input the projection can hand over', () => {
  for (const behind of [false, true]) {
    for (const x of [-5, -1, -0.001, 0, 0.001, 1, 5]) {
      for (const y of [-5, -1, 0, 1, 5]) {
        const it = at(x, y, behind);
        assert.ok(Number.isFinite(it.x) && Number.isFinite(it.y),
          `(${x},${y},behind=${behind}) produced ${it.x},${it.y}`);
        assert.ok(it.angle === null || Number.isFinite(it.angle),
          `(${x},${y},behind=${behind}) produced angle ${it.angle}`);
      }
    }
  }
});
