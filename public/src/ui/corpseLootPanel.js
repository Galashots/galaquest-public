// public/src/ui/corpseLootPanel.js
//
// #87's loot window, plus the "Loot" tap-prompt that opens it -- the DOM half of
// world/corpseLootPresenter.js's pure viewmodel, the same pure/DOM split unlockCard.js documents for
// its own two halves. Self-built rather than declared in index.html (the convention unlockCard.js and
// bossBar.js already keep): the item count is dynamic per corpse, so a hand-authored index.html block
// would either overshoot (empty rows) or need runtime surgery either way -- building the handful of
// nodes here keeps one file responsible for the whole component, the same "deleting this orphans
// nothing in index.html" property unlockCard.js's own header states.
//
// TOUCH-SAFE, NO HOVER: every affordance here is a real <button> reacting to 'click' (which fires for
// touch, mouse and keyboard activation alike) with its own pointerdown listener stopping propagation
// to #game's camera-drag gesture -- the identical discipline #workshop-interact and
// #keeper-speech-speak already take in main.js. Nothing in this file is shown or hidden by :hover.
//
// TAP TARGETS: every button is sized to at least ui/tapTargets.js's own TAP_TARGET_FLOOR_PX (44),
// imported rather than restated (GQ-007) -- the close button in particular, since that constant's own
// header names an under-44 close button as the exact defect class it exists to catch.

import { TAP_TARGET_FLOOR_PX } from './tapTargets.js';

const STYLE_ID = 'corpse-loot-panel-style';

export const CORPSE_LOOT_PANEL_CSS = `
      /* The "Loot" prompt: same fixed-band, gold/dark-pill family as #workshop-interact, in its OWN
         vertical position so the two can never collide (a hero who kills next to the Workshop should
         never see both prompts merge into one unreadable line). main.js drives visible/hidden purely
         off world/corpseLootPresenter.js's own nearestLootableCorpse -- this element only paints it. */
      #corpse-loot-interact {
        position: absolute; top: 68%; left: 50%; transform: translateX(-50%);
        padding: 0.5rem 1rem; min-height: ${TAP_TARGET_FLOOR_PX}px;
        display: grid; place-items: center;
        border: 2px solid rgb(242 179 61 / 75%); border-radius: 0.6rem;
        background: rgb(12 20 31 / 85%); color: #f2b33d;
        font: 800 1rem/1.2 system-ui, sans-serif; letter-spacing: 0.05em; white-space: nowrap;
        touch-action: none; user-select: none; -webkit-user-select: none;
        opacity: 0; transition: opacity 200ms ease-out; pointer-events: none;
      }
      #corpse-loot-interact[data-shown="true"] { opacity: 1; pointer-events: auto; }

      #corpse-loot-panel-layer {
        position: absolute; inset: 0; display: grid; place-items: center;
        opacity: 0; transition: opacity 160ms ease-out;
        pointer-events: none; touch-action: none;
      }
      #corpse-loot-panel-layer[data-shown="true"] { opacity: 1; pointer-events: auto; }
      #corpse-loot-panel-backdrop { position: absolute; inset: 0; background: rgb(6 10 16 / 55%); }
      #corpse-loot-panel {
        position: relative; pointer-events: auto;
        width: min(20rem, calc(100% - 2rem));
        max-height: min(26rem, calc(100% - 4rem));
        display: flex; flex-direction: column;
        padding: 1rem 1.1rem 1.1rem; border-radius: 1rem;
        background: linear-gradient(180deg, #1c2938 0%, #131c27 100%);
        border: 2px solid rgb(242 179 61 / 55%);
        box-shadow: 0 0.6rem 2rem rgb(6 10 16 / 55%);
        color: #f4ede0;
      }
      #corpse-loot-panel-title {
        font: 900 1.05rem/1.2 system-ui, sans-serif; letter-spacing: 0.06em; color: #f2b33d;
        text-align: center; margin-bottom: 0.6rem;
      }
      #corpse-loot-panel-close {
        position: absolute; top: 0.4rem; right: 0.4rem;
        width: ${TAP_TARGET_FLOOR_PX}px; height: ${TAP_TARGET_FLOOR_PX}px;
        border: none; border-radius: 999px; background: rgb(255 255 255 / 10%); color: #f4ede0;
        font: 800 1rem/1 system-ui, sans-serif; cursor: pointer;
      }
      #corpse-loot-panel-items {
        list-style: none; margin: 0; padding: 0;
        display: flex; flex-direction: column; gap: 0.5rem;
        overflow-y: auto; flex: 1 1 auto;
      }
      .corpse-loot-item {
        display: flex; align-items: center; gap: 0.6rem;
        padding: 0.5rem 0.6rem; border-radius: 0.6rem;
        background: rgb(255 255 255 / 6%);
      }
      .corpse-loot-item[data-taken="true"] { opacity: 0.45; }
      .corpse-loot-item-icon { font-size: 1.6rem; line-height: 1; width: 2rem; text-align: center; }
      .corpse-loot-item-body { flex: 1 1 auto; min-width: 0; }
      .corpse-loot-item-name {
        font: 800 0.95rem/1.2 system-ui, sans-serif; white-space: nowrap; overflow: hidden;
        text-overflow: ellipsis;
      }
      .corpse-loot-item-tag {
        font: 700 0.7rem/1.2 system-ui, sans-serif; letter-spacing: 0.05em; color: #8bc9b4;
      }
      .corpse-loot-item-take {
        min-width: ${TAP_TARGET_FLOOR_PX}px; min-height: ${TAP_TARGET_FLOOR_PX}px;
        padding: 0.4rem 0.8rem; border: none; border-radius: 0.5rem;
        background: #2c7a64; color: #f8eed8;
        font: 800 0.8rem/1.2 system-ui, sans-serif; letter-spacing: 0.04em; cursor: pointer;
      }
      .corpse-loot-item-take:disabled { background: rgb(255 255 255 / 12%); color: rgb(244 237 224 / 55%); }
      #corpse-loot-panel-take-all {
        margin-top: 0.75rem; min-height: ${TAP_TARGET_FLOOR_PX}px;
        border: none; border-radius: 0.6rem; padding: 0.6rem 1rem;
        background: #f2b33d; color: #182331;
        font: 900 0.95rem/1.2 system-ui, sans-serif; letter-spacing: 0.06em; cursor: pointer;
      }
      #corpse-loot-panel-take-all:disabled { background: rgb(255 255 255 / 12%); color: rgb(244 237 224 / 55%); }
      #corpse-loot-panel-empty {
        text-align: center; padding: 0.75rem 0; color: rgb(244 237 224 / 70%);
        font: 700 0.85rem/1.3 system-ui, sans-serif;
      }
      @media (prefers-reduced-motion: reduce) {
        #corpse-loot-panel-layer, #corpse-loot-interact { transition: none; }
      }

      /* The short acquired-item toast: rides its own tiny pill, travels toward whatever screen point
         main.js hands show() (the Hero button in the real game), then fades. 'forwards' so it ends at
         its travelled position rather than snapping back before opacity finishes. */
      #corpse-loot-toast-layer {
        position: absolute; inset: 0; pointer-events: none; touch-action: none;
      }
      .corpse-loot-toast {
        position: absolute; left: 50%; top: 42%;
        transform: translate(-50%, -50%);
        display: flex; align-items: center; gap: 0.4rem;
        padding: 0.4rem 0.7rem; border-radius: 999px;
        background: rgb(12 20 31 / 90%); border: 2px solid rgb(242 179 61 / 75%);
        color: #f2b33d; font: 800 0.85rem/1.2 system-ui, sans-serif; letter-spacing: 0.03em;
        white-space: nowrap;
        opacity: 0; transition: transform 650ms ease-in, opacity 650ms ease-in;
      }
      .corpse-loot-toast[data-flying="true"] { opacity: 1; }
      .corpse-loot-toast[data-arrived="true"] { opacity: 0; }
`;

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CORPSE_LOOT_PANEL_CSS;
  doc.head.appendChild(style);
}

/**
 * The "Loot" tap-prompt -- the identical shape/contract main.js already keeps for #workshop-interact
 * (renderWorkshopInteract): show(boolean) toggles data-shown, a click fires onOpen(), pointerdown
 * stops propagation so a tap here never also starts a camera drag underneath.
 *
 * @param options.onOpen()  fires on a real tap/click/keyboard activation only.
 */
export function createCorpseLootInteract(doc, options = {}) {
  const onOpen = options.onOpen ?? (() => {});
  const button = doc.createElement('button');
  button.id = 'corpse-loot-interact';
  button.type = 'button';
  button.dataset.shown = 'false';
  button.textContent = '🎁 LOOT';
  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  button.addEventListener('click', () => onOpen());

  let shown = false;
  function show(next) {
    if (shown === next) return;
    shown = next;
    button.dataset.shown = String(shown);
  }

  return { element: button, show, isShown: () => shown };
}

/**
 * The loot window itself. Pure DOM/event wiring over whatever viewmodel main.js hands show() --
 * world/corpseLootPresenter.js's own corpseLootPanelViewModel(corpse, heroId) shape:
 * [{ id, itemId, name, icon, guaranteed, taken }].
 *
 * @param options.onCollectItem(claimItemId)  a single item's own TAKE button.
 * @param options.onCollectAll()              the prominent Take All action.
 * @param options.onClose()                   ✕, backdrop tap, or main.js's own dismiss (walking away).
 */
export function createCorpseLootPanel(doc, options = {}) {
  ensureStyle(doc);
  const onCollectItem = options.onCollectItem ?? (() => {});
  const onCollectAll = options.onCollectAll ?? (() => {});
  const onClose = options.onClose ?? (() => {});

  const layer = doc.createElement('div');
  layer.id = 'corpse-loot-panel-layer';
  layer.dataset.shown = 'false';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-label', 'Loot');

  const backdrop = doc.createElement('div');
  backdrop.id = 'corpse-loot-panel-backdrop';

  const panel = doc.createElement('div');
  panel.id = 'corpse-loot-panel';

  const closeButton = doc.createElement('button');
  closeButton.id = 'corpse-loot-panel-close';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close loot');
  closeButton.textContent = '✕';

  const title = doc.createElement('div');
  title.id = 'corpse-loot-panel-title';
  title.textContent = 'LOOT';

  const list = doc.createElement('ul');
  list.id = 'corpse-loot-panel-items';

  const empty = doc.createElement('div');
  empty.id = 'corpse-loot-panel-empty';
  empty.textContent = 'Already looted!';
  empty.hidden = true;

  const takeAllButton = doc.createElement('button');
  takeAllButton.id = 'corpse-loot-panel-take-all';
  takeAllButton.type = 'button';
  takeAllButton.textContent = 'TAKE ALL';

  panel.appendChild(closeButton);
  panel.appendChild(title);
  panel.appendChild(list);
  panel.appendChild(empty);
  panel.appendChild(takeAllButton);
  layer.appendChild(backdrop);
  layer.appendChild(panel);

  let shown = false;
  let currentCorpseId = null;

  function setShown(next) {
    if (shown === next) return;
    shown = next;
    layer.dataset.shown = String(shown);
    if (!shown) currentCorpseId = null;
  }

  /**
   * Render THIS corpse's rows fresh every call -- render(corpse.id, rows) is idempotent and safe to
   * call every frame the panel is open (main.js re-derives rows from the live snapshot each frame, so
   * a sibling's simultaneous Take All or this hero's own click is reflected the instant the next
   * snapshot says so, without the panel needing its own diffing).
   */
  function render(corpseId, rows) {
    currentCorpseId = corpseId;
    list.textContent = '';
    const untaken = rows.filter((row) => !row.taken);
    empty.hidden = untaken.length > 0;
    takeAllButton.disabled = untaken.length === 0;
    for (const row of rows) {
      const li = doc.createElement('li');
      li.className = 'corpse-loot-item';
      li.dataset.taken = String(row.taken);

      const icon = doc.createElement('span');
      icon.className = 'corpse-loot-item-icon';
      icon.textContent = row.icon;
      icon.setAttribute('aria-hidden', 'true');

      const body = doc.createElement('div');
      body.className = 'corpse-loot-item-body';
      const name = doc.createElement('div');
      name.className = 'corpse-loot-item-name';
      name.textContent = row.name;
      body.appendChild(name);
      if (row.guaranteed) {
        const tag = doc.createElement('div');
        tag.className = 'corpse-loot-item-tag';
        tag.textContent = 'GUARANTEED';
        body.appendChild(tag);
      }

      const take = doc.createElement('button');
      take.type = 'button';
      take.className = 'corpse-loot-item-take';
      take.textContent = row.taken ? 'TAKEN' : 'TAKE';
      take.disabled = row.taken;
      take.addEventListener('pointerdown', (event) => event.stopPropagation());
      take.addEventListener('click', () => onCollectItem(row.id));

      li.appendChild(icon);
      li.appendChild(body);
      li.appendChild(take);
      list.appendChild(li);
    }
  }

  function show(corpseId, rows) {
    render(corpseId, rows);
    setShown(true);
  }

  function close() {
    setShown(false);
    onClose();
  }

  closeButton.addEventListener('pointerdown', (event) => event.stopPropagation());
  closeButton.addEventListener('click', () => close());
  backdrop.addEventListener('pointerdown', (event) => event.stopPropagation());
  backdrop.addEventListener('click', () => close());
  panel.addEventListener('pointerdown', (event) => event.stopPropagation());
  takeAllButton.addEventListener('click', () => onCollectAll());

  return {
    element: layer,
    show,
    render,
    close,
    isOpen: () => shown,
    currentCorpseId: () => currentCorpseId,
  };
}

const TOAST_TRAVEL_MS = 650;
const TOAST_LIFETIME_MS = 900;

/**
 * The short acquired-item confirmation, plus the "visible movement toward the inventory/Hero
 * destination" #87 asks for: a small pill that appears where the loot was taken FROM (panel-centre by
 * default) and CSS-transitions toward `destination` (main.js hands in #hero-button's own
 * getBoundingClientRect-derived screen point) before fading, the same one-shot
 * setTimeout-driven-cleanup discipline main.js's own popLootHud already uses for the coin/shard pop.
 *
 * Deliberately its own tiny layer rather than living inside the panel: a toast for the LAST item taken
 * before Take All closes the panel must still be able to fly after the panel itself is gone.
 */
export function createCorpseLootToastLayer(doc) {
  const layer = doc.createElement('div');
  layer.id = 'corpse-loot-toast-layer';
  layer.setAttribute('aria-hidden', 'true');

  /** @param text  e.g. "+ Silverguard Shoulders". @param destination  { x, y } in CSS pixels. */
  function announce(text, destination) {
    const toast = doc.createElement('div');
    toast.className = 'corpse-loot-toast';
    toast.dataset.flying = 'false';
    toast.dataset.arrived = 'false';
    toast.textContent = text;
    layer.appendChild(toast);

    doc.defaultView?.requestAnimationFrame?.(() => {
      toast.dataset.flying = 'true';
      if (destination) {
        const dx = destination.x - layer.clientWidth / 2;
        const dy = destination.y - layer.clientHeight * 0.42;
        toast.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.7)`;
      }
    });
    const arrive = () => { toast.dataset.arrived = 'true'; };
    const remove = () => { toast.remove(); };
    doc.defaultView?.setTimeout?.(arrive, TOAST_TRAVEL_MS) ?? setTimeout(arrive, TOAST_TRAVEL_MS);
    (doc.defaultView?.setTimeout ?? setTimeout)(remove, TOAST_TRAVEL_MS + TOAST_LIFETIME_MS);
  }

  return { element: layer, announce };
}
