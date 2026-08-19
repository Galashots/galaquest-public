// The Hero screen: GP1's whole UI surface, kept out of main.js on purpose -- the architecture
// doctrine (GalaQuest_Gameplay_Expansion_Stream_Plan section 5) singles main.js out as a conflict
// hotspot the asset stream is also touching, and this feature is big enough (five slots, an owned-
// item strip, a comparison card, open/close, a camera dolly handoff) that inlining it would have
// meant a real chunk of main.js's own growth. main.js only ever calls createHeroScreen() once and
// feeds it a state object each frame, the same "pure logic, main.js does the wiring" split
// rewards/hud.js's pipsForMarks already uses -- just large enough this time to own its DOM binding
// too, rather than leaving forty lines of querySelector calls in main.js.
//
// heroScreenViewModel is pure (no DOM) and unit tested directly. createHeroScreen is the DOM half,
// exercised only through the browser and tools/runtime-test/drive-hero-screen.mjs -- the same split
// AGENTS.md's "Playtests are mandatory" draws between a rule you can prove without a screen and one
// you can only prove by looking at it.

import { WEAPON_SLOT, damageFor, itemDef } from './items.js';
// A plain numeric hex constant, not a three.js Color or a DOM value -- safe to import into a
// browser-only UI module with zero new coupling. Reusing it (rather than a second guess at "what
// colour is the Wildwood Blade") is what keeps the item card's swatch agreeing with the planted prop
// a child already saw in Rowan's clearing.
import { WILDWOOD_COLOR } from '../world/wildwoodBlade.js';

const SLOT_DEFS = Object.freeze([
  { id: WEAPON_SLOT, label: 'Weapon' },
  // GP1 scope: no items are defined for these yet (progression/items.js's own header explains why),
  // so they render locked/empty. Add a slot's first item and it stops being locked automatically --
  // slotViewModel below decides that from ITEM_DEFS, not from a hand-maintained "which slots work"
  // list that could drift from it.
  { id: 'shield', label: 'Shield' },
  { id: 'helmet', label: 'Helmet' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'chest', label: 'Chest' },
]);

// One swatch per item id, standing in for real gear art the same way world/wildwoodBlade.js's own
// planted prop does -- GQ-002 risk kept low by sourcing the one colour that already exists elsewhere
// rather than inventing a second definition of it. Numeric hex (three.js's own colour shape) is the
// source of truth; the DOM's CSS string is derived from it below, not defined a second time.
const ITEM_SWATCH_HEX = Object.freeze({
  starter_sword: 0xb9c2cc,
  wildwood_blade: WILDWOOD_COLOR,
});
const NEUTRAL_SWATCH_HEX = 0x8a97a6;

export function swatchHexFor(itemId) {
  return ITEM_SWATCH_HEX[itemId] ?? NEUTRAL_SWATCH_HEX;
}

export function swatchFor(itemId) {
  return `#${swatchHexFor(itemId).toString(16).padStart(6, '0')}`;
}

/**
 * Pure. Turns { equippedWeaponId, ownedItemIds, selectedItemId } into everything the DOM binder
 * below needs to paint a frame -- no querySelector, no three.js, testable with plain node --test.
 *
 * selectedItemId may be stale (an id no longer owned, or none chosen yet) -- resolved down to the
 * equipped weapon in that case, the same "always a safe fallback, never a blank card" discipline
 * progression/state.js's equippedWeaponIdFromRewards already uses for the wire field it reads.
 */
export function heroScreenViewModel({ equippedWeaponId, ownedItemIds, selectedItemId }) {
  const owned = new Set(ownedItemIds);
  const resolvedSelectedId = owned.has(selectedItemId) ? selectedItemId : equippedWeaponId;
  const selectedDef = itemDef(resolvedSelectedId);
  const equippedDamage = damageFor(equippedWeaponId);

  const weapons = ownedItemIds
    .map((id) => itemDef(id))
    .filter((def) => def !== null && def.slot === WEAPON_SLOT)
    .map((def) => ({
      id: def.id,
      name: def.name,
      damage: def.damage,
      swatch: swatchFor(def.id),
      equipped: def.id === equippedWeaponId,
      selected: def.id === resolvedSelectedId,
    }));

  const slots = SLOT_DEFS.map((slot) => {
    if (slot.id === WEAPON_SLOT) {
      const equippedDef = itemDef(equippedWeaponId);
      return {
        id: slot.id, label: slot.label, locked: false,
        filled: equippedDef !== null,
        name: equippedDef?.name ?? null,
        swatch: swatchFor(equippedWeaponId),
      };
    }
    return { id: slot.id, label: slot.label, locked: true, filled: false, name: null, swatch: null };
  });

  return {
    slots,
    weapons,
    selected: selectedDef && {
      id: selectedDef.id,
      name: selectedDef.name,
      damage: selectedDef.damage,
      swatch: swatchFor(selectedDef.id),
      isEquipped: selectedDef.id === equippedWeaponId,
    },
    // null when the selected item IS the equipped one -- nothing to compare against itself. Section
    // 8's own worked example is `1 -> 2 DAMAGE`; a same-item card has no arrow to draw.
    comparison: (selectedDef && selectedDef.id !== equippedWeaponId)
      ? { fromDamage: equippedDamage, toDamage: selectedDef.damage, isUpgrade: selectedDef.damage > equippedDamage }
      : null,
  };
}

/**
 * The DOM half. Queries its elements once from `root` (defaults to document, injectable for a
 * future test that wants a detached fragment), wires clicks straight to the callbacks it is given,
 * and exposes render()/open()/close()/isOpen() -- main.js calls render() every frame the screen is
 * open (cheap: five slots and a handful of buttons, nothing three.js-scale) and open()/close() off
 * the hero button and the close button's own tap, plus main.js's own escape hatch if it ever needs
 * one (e.g. a future pause-on-blur rule).
 *
 * @param options.onSelect(itemId)  a weapon in the owned strip was tapped
 * @param options.onEquip(itemId)   EQUIP was tapped for the currently selected item
 * @param options.onOpenChange(open)  fires after open()/close() actually change the shown state,
 *   so main.js can gate movement input and hand the camera to/from the preview dolly without
 *   polling isOpen() every frame.
 */
export function createHeroScreen(options = {}) {
  const root = options.root ?? document;
  const onSelect = options.onSelect ?? (() => {});
  const onEquip = options.onEquip ?? (() => {});
  const onOpenChange = options.onOpenChange ?? (() => {});

  const button = root.querySelector('#hero-button');
  const screen = root.querySelector('#hero-screen');
  const closeButton = root.querySelector('#hero-screen-close');
  const slotsEl = root.querySelector('#hero-slots');
  const itemListEl = root.querySelector('#hero-item-list');
  const nameEl = root.querySelector('#hero-item-name');
  const damageEl = root.querySelector('#hero-item-damage');
  const compareEl = root.querySelector('#hero-item-compare');
  const equipButton = root.querySelector('#hero-equip-button');

  let shown = false;
  // The last view() this presenter was handed, so a click handler (which fires between frames, not
  // during a render() call) can read "what item is this button for" without re-deriving it.
  let lastView = null;

  function setShown(next) {
    if (shown === next) return;
    shown = next;
    screen.dataset.shown = String(shown);
    button.setAttribute('aria-pressed', String(shown));
    onOpenChange(shown);
  }

  function renderSlots(slots) {
    slotsEl.querySelectorAll('.hero-slot').forEach((el, index) => {
      const slot = slots[index];
      if (!slot) return;
      el.dataset.locked = String(slot.locked);
      el.dataset.filled = String(slot.filled);
      el.style.setProperty('--slot-swatch', slot.swatch ?? 'transparent');
      const nameSpan = el.querySelector('.hero-slot-name');
      if (nameSpan) nameSpan.textContent = slot.filled ? slot.name : (slot.locked ? '' : '—');
    });
  }

  function renderItemList(weapons) {
    itemListEl.innerHTML = '';
    for (const weapon of weapons) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'hero-item';
      item.dataset.itemId = weapon.id;
      item.dataset.selected = String(weapon.selected);
      item.dataset.equipped = String(weapon.equipped);
      item.style.setProperty('--slot-swatch', weapon.swatch);
      item.setAttribute('aria-label', `${weapon.name}, damage ${weapon.damage}${weapon.equipped ? ', equipped' : ''}`);
      item.innerHTML = `<span class="hero-item-swatch" aria-hidden="true"></span>`
        + `<span class="hero-item-label">${weapon.name}</span>`
        + (weapon.equipped ? '<span class="hero-item-equipped-tag">EQUIPPED</span>' : '');
      item.addEventListener('click', () => onSelect(weapon.id));
      itemListEl.appendChild(item);
    }
  }

  function renderCard(selected, comparison) {
    if (!selected) {
      nameEl.textContent = '';
      damageEl.textContent = '';
      compareEl.textContent = '';
      equipButton.disabled = true;
      equipButton.dataset.shown = 'false';
      return;
    }
    nameEl.textContent = selected.name;
    damageEl.textContent = `DAMAGE ${selected.damage}`;
    if (comparison) {
      compareEl.textContent = `${comparison.fromDamage} → ${comparison.toDamage} DAMAGE`;
      compareEl.dataset.upgrade = String(comparison.isUpgrade);
    } else {
      compareEl.textContent = '';
    }
    equipButton.dataset.shown = String(!selected.isEquipped);
    equipButton.disabled = selected.isEquipped;
  }

  function render(view) {
    lastView = view;
    renderSlots(view.slots);
    renderItemList(view.weapons);
    renderCard(view.selected, view.comparison);
  }

  button.addEventListener('click', () => setShown(true));
  closeButton.addEventListener('click', () => setShown(false));
  equipButton.addEventListener('click', () => {
    if (lastView?.selected && !lastView.selected.isEquipped) onEquip(lastView.selected.id);
  });

  return {
    render,
    open() { setShown(true); },
    close() { setShown(false); },
    isOpen() { return shown; },
  };
}
