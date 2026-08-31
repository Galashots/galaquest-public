/**
 * The player-fair view's ONE job is refusing to hand over what the screen does not say. These tests
 * exist because that refusal is invisible: a leak does not crash anything, it just quietly makes
 * every difficulty and confusion finding from every future session wrong, in the direction of
 * "easier and clearer than it really is".
 *
 * So the view is executed here for real, against a stub runtime, and its OUTPUT is pinned -- not
 * its source text. A source-text check would pass the moment someone spelled a leak differently.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  FORBIDDEN_VIEW_ACCESSORS,
  READ_PLAYER_VIEW,
  distanceBucket,
  healthBucket,
  installPlayerViewSource,
} from '../tools/runtime-test/player-view.mjs';

const playtestSessionSource = () => readFileSync('tools/runtime-test/playtest-session.mjs', 'utf8');

test('healthBucket collapses hp to the four states a bar actually shows', () => {
  assert.equal(healthBucket(100, 100), 'healthy');
  assert.equal(healthBucket(61, 100), 'healthy');
  assert.equal(healthBucket(60, 100), 'hurt');
  assert.equal(healthBucket(26, 100), 'hurt');
  assert.equal(healthBucket(25, 100), 'critical');
  assert.equal(healthBucket(1, 100), 'critical');
  assert.equal(healthBucket(0, 100), 'down');
  assert.equal(healthBucket(undefined, 100), 'unknown');
  assert.equal(healthBucket(50, 0), 'unknown');
});

test('distanceBucket never hands back a number to do arithmetic with', () => {
  assert.equal(distanceBucket(0), 'right-there');
  assert.equal(distanceBucket(3), 'right-there');
  assert.equal(distanceBucket(3.01), 'near');
  assert.equal(distanceBucket(8), 'near');
  assert.equal(distanceBucket(18), 'far');
  assert.equal(distanceBucket(18.01), 'distant');
  assert.equal(distanceBucket(NaN), 'unknown');
});

/** A stand-in for the page: enough window/document/runtime for the installed view to run, and
 *  nothing more. Every privileged accessor is present and THROWS, so reaching for one is a test
 *  failure with a name on it rather than a silently different answer. */
function makeContext({
  enemies = [], drops = [], hero = { hp: 100, maxHp: 100 }, texts = [],
  sceneNodes = [], enemyNameplates = [], questMarker = false, projectY = () => 0.5,
} = {}) {
  const trap = (name) => () => { throw new Error(`player view reached privileged accessor: ${name}`); };

  const vector = (x = 0, y = 0, z = 0) => ({
    x,
    y,
    z,
    set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; return this; },
    // A deterministic stand-in for a real projection: world x/z map linearly into the NDC cube, so
    // a test can put a thing on screen or off it by choosing coordinates.
    project() { this.x /= 20; this.y = projectY(this.y); this.z = 0.5; return this; },
    clone() { return vector(this.x, this.y, this.z); },
  });

  /** `text` may be a plain string (on screen) or `{ text, visible: false }` / `{ text, box }` to
   *  stand for a leaf whose ancestor is hidden, or one laid out off-canvas. */
  const element = (spec) => {
    const { text, visible = true, box = { width: 100, height: 20, top: 10, left: 10, bottom: 30, right: 110 } } = typeof spec === 'string' ? { text: spec } : spec;
    return {
      children: [],
      textContent: text,
      checkVisibility: () => visible,
      getBoundingClientRect: () => box,
    };
  };
  const enemyNameplate = (spec) => {
    const {
      name = 'Wolf', visible = true,
      box = { width: 84, height: 48, top: 120, left: 320, bottom: 168, right: 404 },
    } = spec;
    return {
      checkVisibility: () => visible,
      getBoundingClientRect: () => box,
      querySelector: (selector) => selector === '.enemy-nameplate-name' ? { textContent: name } : null,
    };
  };

  const runtime = {
    hero: {},
    player: { position: vector(0, 0, 0) },
    camera: {},
    scene: {
      traverse: (fn) => sceneNodes.forEach((node) => fn({
        visible: node.visible !== false,
        name: node.name,
        getWorldPosition: (target) => target.set(node.x, 0, node.z),
      })),
    },
    zoneKeeperState: () => ({ questMarker }),
    encounterState: () => ({ hero, enemies }),
    dropsOnGround: () => drops,
    audioDebug: () => ({ triggered: { 'wolf-bite': 2 } }),
    heroDownShown: () => false,
  };
  for (const name of FORBIDDEN_VIEW_ACCESSORS) runtime[name] = trap(name);

  const context = {
    window: { __galaQuestRuntime: runtime, innerWidth: 768, innerHeight: 1024, __gqSpoken: [], __gqSpokenSeen: 0 },
    document: {
      querySelectorAll: (selector) => selector === '.enemy-nameplate'
        ? enemyNameplates.map(enemyNameplate) : [],
      body: { querySelectorAll: () => texts.map(element) },
    },
    getComputedStyle: () => ({ position: 'static', visibility: 'visible', display: 'block', opacity: '1' }),
  };
  context.globalThis = context;
  return context;
}

function viewFrom(options) {
  const context = makeContext(options);
  runInNewContext(installPlayerViewSource(), context);
  return JSON.parse(runInNewContext(READ_PLAYER_VIEW, context));
}

test('the view exposes exactly the player-fair keys and no others', () => {
  const view = viewFrom({});
  assert.deepEqual(
    Object.keys(view).sort(),
    ['down', 'health', 'heard', 'read', 'ready', 'screen', 'see', 'spoken'],
  );
});

test('a visible enemy nameplate arrives as player-rendered kind and screen position — never its stats', () => {
  const view = viewFrom({
    enemies: [{
      kind: 'wolf', x: 4, z: 1, hp: 3, maxHp: 40,
      leashRadius: 12, patrol: [{ x: 0, z: 0 }], enemyId: 'wolf-1', level: 2, biteDamage: 5, speed: 3.2,
    }],
    enemyNameplates: [{ name: 'Wolf' }],
  });

  assert.equal(view.see.length, 1);
  assert.deepEqual(Object.keys(view.see[0]).sort(), ['distance', 'what', 'xPct', 'yPct']);
  assert.equal(view.see[0].what, 'wolf');
  assert.equal(view.see[0].distance, 'unknown');

  // The load-bearing assertion, made STRUCTURALLY rather than by hunting for the number 3 in the
  // serialized view. Screen positions are numbers too, and an hp that happens to equal a coordinate
  // would sail past a substring check -- so the invariant is the key set, which cannot coincide.
  const serialized = JSON.stringify(view);
  for (const leak of ['leashRadius', 'patrol', 'enemyId', 'biteDamage', 'maxHp', 'hp']) {
    assert.ok(!serialized.includes(`"${leak}"`), `view leaked ${leak}: ${serialized}`);
  }
});

test('an off-screen enemy nameplate is absent, not listed as hidden', () => {
  const offScreen = viewFrom({
    enemies: [{ kind: 'wolf', x: 4, z: 1, hp: 40, maxHp: 40 }],
    enemyNameplates: [{ box: { width: 84, height: 48, top: 120, left: -100, bottom: 168, right: -16 } }],
  });
  assert.deepEqual(offScreen.see, []);
});

test('a known enemy without a rendered nameplate is absent', () => {
  const view = viewFrom({ enemies: [{ kind: 'wolf', x: 4, z: 1, hp: 0, maxHp: 40 }] });
  assert.deepEqual(view.see, []);
});

/**
 * The regression from the first session's spawn capture: the view reported an empty screen while
 * the screenshot showed the Keeper, three villagers and the pet. A playtest agent told the village
 * is deserted reports a deserted village.
 */
test('characters in the scene are seen as a child sees them, not as the code names them', () => {
  const view = viewFrom({
    sceneNodes: [
      { name: 'keeper', x: 4, z: 1 },
      { name: 'villager-0', x: 2, z: 1 },
      { name: 'prototype-companion', x: 1, z: 0 },
      { name: 'prop-cart', x: 1, z: 1 },
      { name: 'lantern-tree-light', x: 1, z: 1 },
    ],
  });
  assert.deepEqual(view.see.map((s) => s.what).sort(), ['a person', 'a person', 'a small animal']);
  // Scene-node names are the code's vocabulary and must not reach the agent at any distance.
  const serialized = JSON.stringify(view);
  for (const leak of ['keeper', 'villager', 'prototype-companion', 'prop-cart']) {
    assert.ok(!serialized.includes(leak), `view leaked the scene node name ${leak}: ${serialized}`);
  }
});

test('the Keeper is distinguishable at a distance only by the mark actually drawn above him', () => {
  const nodes = [{ name: 'keeper', x: 4, z: 1 }];
  assert.deepEqual(viewFrom({ sceneNodes: nodes }).see.map((s) => s.what), ['a person']);
  assert.deepEqual(
    viewFrom({ sceneNodes: nodes, questMarker: true }).see.map((s) => s.what),
    ['a person with a mark above them'],
  );
});

test('an invisible scene node is not on screen', () => {
  const view = viewFrom({ sceneNodes: [{ name: 'keeper', x: 4, z: 1, visible: false }] });
  assert.deepEqual(view.see, []);
});

test('a character the camera is not pointing at is absent', () => {
  const view = viewFrom({ sceneNodes: [{ name: 'villager-0', x: 400, z: 1 }] });
  assert.deepEqual(view.see, []);
});

test('a drop is describable without naming what it is worth', () => {
  const view = viewFrom({ drops: [{ x: 2, z: 0, itemId: 'wildwood-blade', coins: 25 }] });
  assert.equal(view.see.length, 1);
  assert.equal(view.see[0].what, 'something on the ground');
  // Structural, for the same reason as the wolf's stats above: `coins: 25` must not survive, and
  // checking for the string "25" would instead have caught the drop's own yPct.
  assert.deepEqual(Object.keys(view.see[0]).sort(), ['distance', 'what', 'xPct', 'yPct']);
  assert.ok(!JSON.stringify(view).includes('wildwood-blade'));
  assert.ok(!JSON.stringify(view).includes('"coins"'));
});

test('readable text is what is on screen, deduplicated', () => {
  const view = viewFrom({ texts: ['Find the Lantern Keeper', 'Find the Lantern Keeper', '  Coins 3  '] });
  assert.deepEqual(view.read, ['Find the Lantern Keeper', 'Coins 3']);
});

/**
 * The regression from the first real session. Checking only the leaf reported "LEVEL UP!" and the
 * whole closed hero panel as readable at village spawn, because each is a leaf with its own text
 * sitting inside a hidden ancestor. An agent cannot be told the screen says something it does not.
 */
test('text inside a hidden ancestor is not readable, however visible the leaf itself is', () => {
  const view = viewFrom({
    texts: [
      'Talk to Keeper Aldric',
      { text: 'LEVEL UP!', visible: false },
      { text: 'Who is playing?', visible: false },
    ],
  });
  assert.deepEqual(view.read, ['Talk to Keeper Aldric']);
});

test('text laid out off-canvas is not readable', () => {
  const view = viewFrom({
    texts: [
      'Coins 3',
      { text: 'parked off to the left', box: { width: 100, height: 20, top: 10, left: -9999, bottom: 30, right: -9899 } },
      { text: 'parked below the fold', box: { width: 100, height: 20, top: 5000, left: 10, bottom: 5020, right: 110 } },
    ],
  });
  assert.deepEqual(view.read, ['Coins 3']);
});

test('sounds are reported once without leaking privileged engine recipe names', () => {
  const context = makeContext({});
  runInNewContext(installPlayerViewSource(), context);
  const first = JSON.parse(runInNewContext(READ_PLAYER_VIEW, context));
  const second = JSON.parse(runInNewContext(READ_PLAYER_VIEW, context));
  assert.deepEqual(first.heard, ['a sound', 'a sound']);
  assert.doesNotMatch(JSON.stringify(first), /wolf-bite/,
    'audioDebug recipe names are harness truth and must not cross the player-fair boundary');
  assert.deepEqual(second.heard, [], 'the same two bites must not be heard again on the next look');
});

test('the view degrades to not-ready rather than throwing before the hero exists', () => {
  const context = makeContext({});
  context.window.__galaQuestRuntime.hero = null;
  runInNewContext(installPlayerViewSource(), context);
  assert.deepEqual(JSON.parse(runInNewContext(READ_PLAYER_VIEW, context)), { ready: false });
});

test('an enemy behind an occluder stays absent when its nameplate is not rendered', () => {
  const view = viewFrom({
    enemies: [{ kind: 'wolf', x: 4, z: 1, hp: 40, maxHp: 40, enemyId: 'wolf-behind-building' }],
  });
  assert.deepEqual(view.see, []);
  assert.doesNotMatch(installPlayerViewSource(), /const enemies = \(encounter && encounter\.enemies\)/);
  assert.match(installPlayerViewSource(), /document\.querySelectorAll\('\.enemy-nameplate'\)/);
});

test('a silent playtest stdin read races the requested deadline instead of blocking the session forever', () => {
  const source = playtestSessionSource();
  assert.match(source, /async function nextLineBeforeDeadline\(\)/);
  assert.match(source, /Promise\.race\(\[\s*lines\.next\(\)\.then[\s\S]*deadlineWait/);
  assert.match(source, /clearTimeout\(timer\)/);
  assert.match(source, /if \(pending\.deadline\) \{\s*endSession\('time'\);\s*break;/);
});

test('the session records one authoritative ending and centralizes idempotent owned-resource cleanup', () => {
  const source = playtestSessionSource();
  assert.equal((source.match(/record\(\{ kind: 'session-end'/g) || []).length, 1);
  assert.match(source, /if \(sessionEnded\) return;/);
  assert.match(source, /if \(cleanupPromise\) return cleanupPromise;/);
  assert.match(source, /process\.stdin\.destroy\(\)/);
  assert.match(source, /page\?\.ws\.close\(\);\s*browser\?\.ws\.close\(\);/);
  assert.match(source, /try \{[\s\S]*\} finally \{[\s\S]*await cleanup\(\);/);
});

test('the action contract calls direct camera orbit a controlled action, not a real player gesture', () => {
  const source = playtestSessionSource();
  const guide = readFileSync('docs/agent-playtest.md', 'utf8');
  assert.match(source, /controlled camera action through follow\.orbit\(\), not a verified player drag/);
  assert.match(guide, /calls the existing camera control directly as a controlled playtest action/);
  assert.match(guide, /not a gesture-\s*fidelity or camera-control-discoverability test/);
});
