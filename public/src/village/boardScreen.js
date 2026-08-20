// The Village Board: GP3's whole UI surface, kept out of main.js the same way progression/
// heroScreen.js already is (that file's own header explains the reasoning -- this is the identical
// split, one more sibling screen rather than a growth of the Hero screen itself).
//
// villageBoardViewModel is pure (no DOM) and unit tested directly. createVillageBoardScreen is the
// DOM half, exercised only through the browser and a runtime harness -- the same split heroScreen.js
// draws between heroScreenViewModel and createHeroScreen.
//
// The Board is a strategic popup MAP, not an economy spreadsheet (the GP3 brief, section 4): a fixed
// list of large village nodes, only Workshop actionable today. Tapping Workshop opens a focused
// detail state; the Board itself never spends anything or shows the 3D world -- the actual Village
// changing is the reward, not this screen (section 4's own closing line).

import { WORKSHOP_I_COST, WORKSHOP_I_ID, canAffordWorkshopI } from './economy.js';

// Section 4's exact five nodes. 'current' shows the Village's already-restored state (read-only,
// nothing to tap toward); 'actionable' opens a real detail/purchase state; 'future' communicates
// "not yet" without fabricating a mechanic, cost, or level for something that does not exist (the
// brief's own instruction: "Do not fabricate mechanics, levels or resource costs for the future
// nodes"). Order matches the brief's own list.
export const VILLAGE_BOARD_NODES = Object.freeze([
  Object.freeze({ id: 'lantern-tree', label: 'Lantern Tree', kind: 'current' }),
  Object.freeze({ id: 'workshop', label: 'Workshop', kind: 'actionable' }),
  Object.freeze({ id: 'lantern-library', label: 'Lantern Library', kind: 'future' }),
  Object.freeze({ id: 'ranger-lodge', label: 'Ranger Lodge', kind: 'future' }),
  Object.freeze({ id: 'garden-farm', label: 'Garden & Farm', kind: 'future' }),
]);

/**
 * Pure. Turns { village, lanternUnlocked, selectedNodeId } into everything the DOM binder below
 * needs to paint a frame -- no querySelector, no wire decoding, testable with plain node --test.
 *
 * @param village          the wire's own encounter.village shape: { coins, shards, workshopOwned }
 * @param lanternUnlocked  the existing D4 lantern-unlocked flag (net/rewardStore.mjs's
 *   unlockedFor/protocol.js's rewards.lanternUnlocked), reused verbatim for the Lantern Tree node's
 *   "current restored state" rather than inventing a second truth for whether it is lit.
 * @param selectedNodeId   which node (if any) is drilled into -- null/undefined for "board only".
 */
export function villageBoardViewModel({
  village, lanternUnlocked, selectedNodeId, beaconLit = false,
}) {
  const nodes = VILLAGE_BOARD_NODES.map((node) => {
    const selected = node.id === selectedNodeId;
    if (node.id === 'lantern-tree') {
      return { ...node, status: lanternUnlocked ? 'Lit' : 'Unlit', selected };
    }
    if (node.id === 'workshop') {
      return { ...node, status: village.workshopOwned ? 'Built' : 'Available', selected };
    }
    // G6: THE BOARD IS A DESIRE ENGINE, and this is the one line that makes it one.
    //
    // Every future node reads "Not yet" forever, which is honest and is also the reason a child
    // stops opening this screen: nothing on it has ever changed in response to anything they did.
    // Lighting the Old Beacon changes exactly ONE of them, and deliberately only one -- the
    // directive's own "show one or two things that make a child ask how do I get that", never forty.
    //
    // The Ranger Lodge is the right one to wake because the Blackthorn Hollow the Beacon arc ends in
    // already points at it: a fallen ranger's satchel and a carved marker aiming north-east
    // (world/blackthornHollow.js). A child who found that secret meets the same promise again here,
    // in the village, from a different direction -- which is how a place starts to feel real before
    // it has been built.
    if (node.id === 'ranger-lodge' && beaconLit) {
      return { ...node, kind: 'next', status: 'The light is seen', selected };
    }
    return { ...node, status: 'Not yet', selected };
  });

  let detail = null;
  if (selectedNodeId === 'workshop') {
    detail = {
      nodeId: 'workshop',
      upgradeId: WORKSHOP_I_ID,
      title: 'WORKSHOP',
      // Section 4's own three answers a child must get without reading a paragraph.
      whatIsIt: 'A place to work on gear.',
      whatChanges: village.workshopOwned
        ? 'The Workshop is open. Gear work is available.'
        : 'The Workshop opens. Gear work becomes available.',
      cost: WORKSHOP_I_COST,
      owned: { coins: village.coins, shards: village.shards },
      alreadyOwned: village.workshopOwned,
      // Never true once alreadyOwned is true -- canAffordWorkshopI's own ownership check already
      // guarantees this, not restated here as a second condition that could drift from it.
      affordable: canAffordWorkshopI(village.coins, village.shards, village.workshopOwned),
    };
  } else if (selectedNodeId != null) {
    // Read off the COMPUTED nodes, not the static table: a node's kind is now a function of what
    // the player has done (see the ranger-lodge branch above), and looking it up in the frozen
    // definition would forever report the kind it was born with -- the detail would stay the empty
    // "future" card even while the board itself showed the node awake.
    const node = nodes.find((candidate) => candidate.id === selectedNodeId);
    if (node && node.kind === 'future') {
      detail = { nodeId: node.id, title: node.label.toUpperCase(), future: true };
    } else if (node && node.kind === 'next') {
      // The one node that has something to SAY. Still not buildable -- it promises a place and a
      // reward class and stops there (the Board's own rule), because promising a thing a child can
      // walk to before it exists is the defect G1 spent a whole slice not shipping.
      detail = {
        nodeId: node.id,
        title: node.label.toUpperCase(),
        future: true,
        // A PLACE, a FANTASY and a REWARD CLASS, in the fewest words that carry all three.
        whatIsIt: 'Rangers hunt the rare beasts.',
        whatChanges: 'They saw the Beacon light. Someone is coming.',
      };
    }
    // A selectedNodeId naming the 'current' Lantern Tree, or an id this table does not define at
    // all, opens no detail state -- the board's own node already shows everything the Lantern Tree
    // has to say (section 4 only asks for a detail state on the ACTIONABLE node).
  }

  return { nodes, detail };
}

/**
 * The DOM half. Queries its elements once from `root` (defaults to document, injectable the same
 * way createHeroScreen's own root option is), wires clicks straight to the callbacks it is given,
 * and exposes render()/open()/close()/isOpen() -- main.js calls render() every frame the screen is
 * open and open()/close() off the board button and the close button's own tap, the identical shape
 * createHeroScreen already takes.
 *
 * @param options.onSelectNode(nodeId)  a node was tapped -- caller re-renders with that as
 *   selectedNodeId; this presenter holds no selection state of its own, the same "main.js owns the
 *   selection, the presenter only ever reflects what it is handed" split heroScreen.js's own
 *   onSelect/selectedItemId already draws.
 * @param options.onPurchase(upgradeId)  UPGRADE was tapped for the current detail's upgrade
 * @param options.onOpenChange(open)  fires after open()/close() actually change the shown state, so
 *   main.js can gate movement input and hand the camera over, the same contract createHeroScreen's
 *   own onOpenChange already has.
 */
export function createVillageBoardScreen(options = {}) {
  const root = options.root ?? document;
  const onSelectNode = options.onSelectNode ?? (() => {});
  const onPurchase = options.onPurchase ?? (() => {});
  const onOpenChange = options.onOpenChange ?? (() => {});

  const button = root.querySelector('#village-board-button');
  const screen = root.querySelector('#village-board-screen');
  const closeButton = root.querySelector('#village-board-close');
  const nodesEl = root.querySelector('#village-board-nodes');
  const detailEl = root.querySelector('#village-board-detail');
  const detailTitleEl = root.querySelector('#village-board-detail-title');
  const detailWhatEl = root.querySelector('#village-board-detail-what');
  const detailCostEl = root.querySelector('#village-board-detail-cost');
  const detailFutureEl = root.querySelector('#village-board-detail-future');
  const upgradeButton = root.querySelector('#village-board-upgrade-button');

  let shown = false;
  // The last view() this presenter was handed, so a click handler (which fires between frames, not
  // during a render() call) can read "what upgrade is this button for" without re-deriving it -- the
  // same reason heroScreen.js's own createHeroScreen keeps `lastView`.
  let lastView = null;

  function setShown(next) {
    if (shown === next) return;
    shown = next;
    screen.dataset.shown = String(shown);
    button.setAttribute('aria-pressed', String(shown));
    onOpenChange(shown);
  }

  function renderNodes(nodes) {
    nodesEl.querySelectorAll('.village-board-node').forEach((el, index) => {
      const node = nodes[index];
      if (!node) return;
      el.dataset.kind = node.kind;
      el.dataset.selected = String(node.selected);
      const statusSpan = el.querySelector('.village-board-node-status');
      if (statusSpan) statusSpan.textContent = node.status;
    });
  }

  function renderDetail(detail) {
    detailEl.dataset.shown = String(detail !== null);
    if (!detail) return;

    if (detail.future) {
      detailTitleEl.textContent = detail.title;
      detailWhatEl.textContent = 'Not yet.';
      detailCostEl.dataset.shown = 'false';
      detailFutureEl.dataset.shown = 'true';
      upgradeButton.dataset.shown = 'false';
      return;
    }

    detailTitleEl.textContent = detail.title;
    detailWhatEl.textContent = `${detail.whatIsIt} ${detail.whatChanges}`;
    detailFutureEl.dataset.shown = 'false';
    detailCostEl.dataset.shown = 'true';

    const coinEl = detailCostEl.querySelector('.village-board-cost-coin .village-board-cost-value');
    const shardEl = detailCostEl.querySelector('.village-board-cost-shard .village-board-cost-value');
    if (coinEl) coinEl.textContent = `${detail.owned.coins} / ${detail.cost.coins}`;
    if (shardEl) shardEl.textContent = `${detail.owned.shards} / ${detail.cost.shards}`;
    detailCostEl.querySelectorAll('.village-board-cost-icon').forEach((el) => {
      el.dataset.short = String(
        (el.dataset.kind === 'coin' && detail.owned.coins < detail.cost.coins)
        || (el.dataset.kind === 'shard' && detail.owned.shards < detail.cost.shards),
      );
    });

    if (detail.alreadyOwned) {
      upgradeButton.dataset.shown = 'true';
      upgradeButton.textContent = 'BUILT';
      upgradeButton.disabled = true;
    } else {
      upgradeButton.dataset.shown = 'true';
      upgradeButton.textContent = 'UPGRADE';
      upgradeButton.disabled = !detail.affordable;
    }
  }

  function render(view) {
    lastView = view;
    renderNodes(view.nodes);
    renderDetail(view.detail);
  }

  button.addEventListener('click', () => setShown(true));
  closeButton.addEventListener('click', () => setShown(false));
  nodesEl.querySelectorAll('.village-board-node').forEach((el, index) => {
    el.addEventListener('click', () => {
      const node = lastView?.nodes[index];
      if (node) onSelectNode(node.id);
    });
  });
  upgradeButton.addEventListener('click', () => {
    if (lastView?.detail && !lastView.detail.future && !lastView.detail.alreadyOwned && lastView.detail.affordable) {
      onPurchase(lastView.detail.upgradeId);
    }
  });

  return {
    render,
    open() { setShown(true); },
    close() { setShown(false); },
    isOpen() { return shown; },
  };
}
