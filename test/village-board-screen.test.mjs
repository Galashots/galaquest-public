import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { VILLAGE_BOARD_NODES, villageBoardViewModel } from '../public/src/village/boardScreen.js';
import { WORKSHOP_I_COST, WORKSHOP_I_ID } from '../public/src/village/economy.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Same discipline hero-screen.test.mjs's own "index.html hardcodes exactly the 5 GP1 slots" test
// uses: the markup is hand-written, not generated, so this is what makes the coupling between it
// and VILLAGE_BOARD_NODES safe rather than merely commented.
test('index.html hardcodes exactly the five Board nodes, in the same order and kind as VILLAGE_BOARD_NODES', () => {
  const source = readFileSync(resolve(repoRoot, 'public/index.html'), 'utf8');
  const nodes = [...source.matchAll(/class="village-board-node" type="button" data-node="([\w-]+)" data-kind="(\w+)"/g)]
    .map((m) => ({ id: m[1], kind: m[2] }));
  assert.deepEqual(nodes, VILLAGE_BOARD_NODES.map((n) => ({ id: n.id, kind: n.kind })));
});

const FRESH_VILLAGE = { coins: 0, shards: 0, workshopOwned: false };
const AFFORDABLE_VILLAGE = { coins: 3, shards: 2, workshopOwned: false };
const BOUGHT_VILLAGE = { coins: 3, shards: 2, workshopOwned: true };

test('the Board always renders exactly the brief\'s five nodes, in its own order', () => {
  const view = villageBoardViewModel({ village: FRESH_VILLAGE, lanternUnlocked: false, selectedNodeId: null });
  assert.deepEqual(view.nodes.map((n) => n.id), [
    'lantern-tree', 'workshop', 'lantern-library', 'ranger-lodge', 'garden-farm',
  ]);
});

test('only Workshop is actionable -- the brief\'s own node kinds are not fabricated per-instance', () => {
  const kinds = VILLAGE_BOARD_NODES.map((n) => ({ id: n.id, kind: n.kind }));
  assert.deepEqual(kinds, [
    { id: 'lantern-tree', kind: 'current' },
    { id: 'workshop', kind: 'actionable' },
    { id: 'lantern-library', kind: 'future' },
    { id: 'ranger-lodge', kind: 'future' },
    { id: 'garden-farm', kind: 'future' },
  ]);
});

test('the Lantern Tree node reflects the real lanternUnlocked flag, not a fabricated state', () => {
  const unlit = villageBoardViewModel({ village: FRESH_VILLAGE, lanternUnlocked: false, selectedNodeId: null });
  assert.equal(unlit.nodes.find((n) => n.id === 'lantern-tree').status, 'Unlit');
  const lit = villageBoardViewModel({ village: FRESH_VILLAGE, lanternUnlocked: true, selectedNodeId: null });
  assert.equal(lit.nodes.find((n) => n.id === 'lantern-tree').status, 'Lit');
});

test('the Workshop node status flips from Available to Built once owned', () => {
  const before = villageBoardViewModel({ village: AFFORDABLE_VILLAGE, lanternUnlocked: false, selectedNodeId: null });
  assert.equal(before.nodes.find((n) => n.id === 'workshop').status, 'Available');
  const after = villageBoardViewModel({ village: BOUGHT_VILLAGE, lanternUnlocked: false, selectedNodeId: null });
  assert.equal(after.nodes.find((n) => n.id === 'workshop').status, 'Built');
});

test('the three future nodes all say "Not yet", never a fabricated cost or level', () => {
  const view = villageBoardViewModel({ village: FRESH_VILLAGE, lanternUnlocked: false, selectedNodeId: null });
  for (const id of ['lantern-library', 'ranger-lodge', 'garden-farm']) {
    const node = view.nodes.find((n) => n.id === id);
    assert.equal(node.status, 'Not yet');
    assert.ok(!('cost' in node));
  }
});

test('with no node selected, there is no detail state at all', () => {
  const view = villageBoardViewModel({ village: FRESH_VILLAGE, lanternUnlocked: false, selectedNodeId: null });
  assert.equal(view.detail, null);
});

test('selecting a future node opens a "not yet" detail, with no cost or mechanic fabricated', () => {
  const view = villageBoardViewModel({ village: FRESH_VILLAGE, lanternUnlocked: false, selectedNodeId: 'ranger-lodge' });
  assert.deepEqual(view.detail, { nodeId: 'ranger-lodge', title: 'RANGER LODGE', future: true });
});

test('selecting the current Lantern Tree node opens no detail -- the board node already says everything', () => {
  const view = villageBoardViewModel({ village: FRESH_VILLAGE, lanternUnlocked: true, selectedNodeId: 'lantern-tree' });
  assert.equal(view.detail, null);
});

test('selecting Workshop with nothing earned yet: unaffordable, not owned, correct 0/2 and 0/1 display data', () => {
  const view = villageBoardViewModel({ village: FRESH_VILLAGE, lanternUnlocked: false, selectedNodeId: 'workshop' });
  assert.equal(view.detail.title, 'WORKSHOP');
  assert.equal(view.detail.upgradeId, WORKSHOP_I_ID);
  assert.deepEqual(view.detail.cost, WORKSHOP_I_COST);
  assert.deepEqual(view.detail.owned, { coins: 0, shards: 0 });
  assert.equal(view.detail.affordable, false);
  assert.equal(view.detail.alreadyOwned, false);
  // Section 4's own three answers must all be present and non-empty -- "the younger-player path
  // must not depend on paragraph reading" still needs SOMETHING there to read.
  assert.ok(view.detail.whatIsIt.length > 0);
  assert.ok(view.detail.whatChanges.length > 0);
});

test('selecting Workshop with the guaranteed GP2 haul (3 coins, 2 shards): affordable, not yet owned', () => {
  const view = villageBoardViewModel({ village: AFFORDABLE_VILLAGE, lanternUnlocked: false, selectedNodeId: 'workshop' });
  assert.equal(view.detail.affordable, true);
  assert.equal(view.detail.alreadyOwned, false);
  assert.deepEqual(view.detail.owned, { coins: 3, shards: 2 });
});

test('selecting Workshop once bought: alreadyOwned true, affordable false regardless of funds', () => {
  const view = villageBoardViewModel({ village: BOUGHT_VILLAGE, lanternUnlocked: false, selectedNodeId: 'workshop' });
  assert.equal(view.detail.alreadyOwned, true);
  assert.equal(view.detail.affordable, false);
  assert.equal(view.detail.whatChanges, 'The Workshop is open. Gear work is available.');
});

test('an unknown selectedNodeId opens no detail rather than throwing', () => {
  assert.doesNotThrow(() => villageBoardViewModel({
    village: FRESH_VILLAGE, lanternUnlocked: false, selectedNodeId: 'not-a-real-node',
  }));
  const view = villageBoardViewModel({
    village: FRESH_VILLAGE, lanternUnlocked: false, selectedNodeId: 'not-a-real-node',
  });
  assert.equal(view.detail, null);
});

test('sabotage: selected is not a constant -- each node\'s own selected flag flips independently', () => {
  const view = villageBoardViewModel({ village: FRESH_VILLAGE, lanternUnlocked: false, selectedNodeId: 'workshop' });
  const selectedIds = view.nodes.filter((n) => n.selected).map((n) => n.id);
  assert.deepEqual(selectedIds, ['workshop']);
});
