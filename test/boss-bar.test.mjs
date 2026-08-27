import { strict as assert } from 'node:assert';
import test from 'node:test';

import { BOSS_BAR_CSS, BOSS_NAME, bossBarState, createBossBar } from '../public/src/ui/bossBar.js';
import { BEACON_GLOW_COLOR } from '../public/src/world/oldBeacon.js';

// Viewmodel-only, the same line test/hero-screen.test.mjs draws: bossBarState is provable in plain
// node; createBossBar is the DOM half and is only ever proven in the browser / a runtime harness.
// The one non-viewmodel assertion here is on the exported CSS STRING -- text, not DOM -- the same
// way hero-screen.test.mjs regex-checks index.html's markup without rendering it.

// A healthy mid-fight snapshot to spread variations over -- the same BASE convention
// hero-screen.test.mjs uses.
const BASE = { mode: 'fighting', hp: 6, maxHp: 12, phase: 1 };

test('the nameplate is BEACON WARDEN, from the viewmodel, not from markup', () => {
  assert.equal(bossBarState(BASE).name, 'BEACON WARDEN');
  assert.equal(BOSS_NAME, 'BEACON WARDEN');
});

// The visibility window the design states: visible from 'waking' through 'dying', gone when
// 'dead'/'dormant'. The middle modes belong to the Warden's own module, so anything that is not
// dormant/dead/nullish shows -- checked with two different fighting-ish names so a rename there
// cannot silently hide the bar.
test('visible from waking through dying; gone when dormant, dead, or before any warden exists', () => {
  assert.equal(bossBarState({ ...BASE, mode: 'dormant' }).visible, false);
  assert.equal(bossBarState({ ...BASE, mode: 'waking' }).visible, true);
  assert.equal(bossBarState({ ...BASE, mode: 'fighting' }).visible, true);
  assert.equal(bossBarState({ ...BASE, mode: 'enraged' }).visible, true);
  assert.equal(bossBarState({ ...BASE, mode: 'dying' }).visible, true);
  assert.equal(bossBarState({ ...BASE, mode: 'dead' }).visible, false);
  assert.equal(bossBarState({ ...BASE, mode: null }).visible, false);
  assert.equal(bossBarState({ ...BASE, mode: undefined }).visible, false);
  assert.equal(bossBarState({ ...BASE, mode: '' }).visible, false);
  assert.equal(bossBarState({}).visible, false);
});

test('entering flags exactly the waking beat; defeated flags dying AND dead', () => {
  const waking = bossBarState({ ...BASE, mode: 'waking' });
  assert.equal(waking.entering, true);
  assert.equal(waking.defeated, false);

  const fighting = bossBarState(BASE);
  assert.equal(fighting.entering, false);
  assert.equal(fighting.defeated, false);

  const dying = bossBarState({ ...BASE, mode: 'dying' });
  assert.equal(dying.entering, false);
  assert.equal(dying.defeated, true);
  assert.equal(bossBarState({ ...BASE, mode: 'dead' }).defeated, true);
});

test('fraction is computed from hp/maxHp, not bucketed or hardcoded', () => {
  assert.equal(bossBarState({ ...BASE, hp: 6, maxHp: 12 }).fraction, 0.5);
  assert.equal(bossBarState({ ...BASE, hp: 3, maxHp: 12 }).fraction, 0.25);
  assert.ok(Math.abs(bossBarState({ ...BASE, hp: 1, maxHp: 3 }).fraction - 1 / 3) < 1e-12);
});

test('fraction clamps: over-full reads full, negative reads empty, and both stay in [0, 1]', () => {
  assert.equal(bossBarState({ ...BASE, hp: 99, maxHp: 12 }).fraction, 1);
  assert.equal(bossBarState({ ...BASE, hp: -4, maxHp: 12 }).fraction, 0);
});

test('a broken maxHp (zero, negative, NaN, missing) reads empty, never NaN or Infinity', () => {
  for (const maxHp of [0, -3, NaN, Infinity, undefined, 'twelve']) {
    const { fraction } = bossBarState({ ...BASE, maxHp });
    assert.equal(fraction, 0, `maxHp=${maxHp} must read empty`);
  }
  assert.equal(bossBarState({ ...BASE, hp: NaN }).fraction, 0, 'NaN hp must read empty');
});

test('phase maps 1..3 through and clamps junk to the arc\'s real range, defaulting to 1', () => {
  assert.equal(bossBarState({ ...BASE, phase: 1 }).phase, 1);
  assert.equal(bossBarState({ ...BASE, phase: 2 }).phase, 2);
  assert.equal(bossBarState({ ...BASE, phase: 3 }).phase, 3);
  assert.equal(bossBarState({ ...BASE, phase: 0 }).phase, 1);
  assert.equal(bossBarState({ ...BASE, phase: 7 }).phase, 3);
  assert.equal(bossBarState({ ...BASE, phase: 2.4 }).phase, 2);
  assert.equal(bossBarState({ ...BASE, phase: undefined }).phase, 1);
  assert.equal(bossBarState({ ...BASE, phase: NaN }).phase, 1);
});

test('sabotage: defeat is a fact about MODE -- a dying Warden with a stale full-hp snapshot still reads defeated', () => {
  const staleDying = bossBarState({ mode: 'dying', hp: 12, maxHp: 12, phase: 3 });
  assert.equal(staleDying.defeated, true, 'defeated must derive from mode, not from hp reaching 0');
  assert.equal(staleDying.visible, true);

  const wakingAtZero = bossBarState({ mode: 'waking', hp: 0, maxHp: 12, phase: 1 });
  assert.equal(wakingAtZero.defeated, false, 'an hp of 0 during waking is not a defeat');
});

// The bar's one accent is the Beacon's own cold halo -- oldBeacon.js's BEACON_GLOW_COLOR, derived
// into the CSS rather than restated, the same single-source rule heroScreen.js's swatch keeps with
// WILDWOOD_COLOR. If someone retunes the Beacon's glow, the bar follows for free; this pins that.
test('the CSS accent is derived from BEACON_GLOW_COLOR, not a second guess at the colour', () => {
  const derived = `#${BEACON_GLOW_COLOR.toString(16).padStart(6, '0')}`;
  assert.ok(BOSS_BAR_CSS.includes(derived), `BOSS_BAR_CSS must carry ${derived}`);
});

test('the CSS is reduced-motion safe', () => {
  assert.ok(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(BOSS_BAR_CSS), 'reduced motion must be handled in CSS');
});

// The bar moved from a fixed top-of-screen readout to an overhead, screen-projected card -- a real
// playtest asked for it to be "consistent with other enemies", i.e. above the Warden's own head, the
// same place enemies/nameplate.js already puts every ordinary enemy's name and health. Pinned here
// as a CSS-text check (not exercised in a browser) so a future edit cannot quietly re-pin it to the
// top of the screen without a test noticing: overhead means POSITIONED PER FRAME, not pinned to a
// notch-relative constant.
test('the bar is positioned overhead (per-frame left/top), not pinned to the top of the screen', () => {
  assert.ok(!BOSS_BAR_CSS.includes('env(safe-area-inset-top'),
    'the card must not be pinned under the device notch any more -- it now rides the Warden\'s own head');
  assert.ok(/translate\(-50%,\s*-100%\)/.test(BOSS_BAR_CSS),
    'the card must rise up from its anchor point (bottom-anchored, centred), the same convention a nameplate uses');
});

// "Segmented HP", per the brief -- a chunky boss bar reads in notches a child can count, not as one
// smooth wolf-spark dim. Checked as a CSS-text fact rather than rendered pixels, the same level this
// file's other CSS assertions already work at.
test('the health track is segmented, not a single smooth fill', () => {
  assert.ok(BOSS_BAR_CSS.includes('boss-bar-segments'), 'a segment overlay must exist on the track');
  assert.ok(/repeating-linear-gradient/.test(BOSS_BAR_CSS), 'the segments must be drawn as discrete notches');
});

test('the DOM half exports the factory shape main.js will wire (not exercised here -- browser/harness territory)', () => {
  assert.equal(typeof createBossBar, 'function');
});
