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
// P2: the RESOLVED hero, and the number a child brags about. Imported rather than passed as loose
// numbers so this surface cannot be handed a level and a POWER that disagree with each other.
import { resolvedHeroDamage } from './heroStats.js';
import { formatPower, powerFor } from './power.js';
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
 *
 * @param stats the RESOLVED Hero stats from progression/heroStats.js -- `{ level, maxHp, heroDamage }`.
 *   Optional: a caller with none yet (pre-welcome) gets no identity panel rather than a made-up one,
 *   which is the same "absent is not zero" posture the wire's own optional fields take. When present
 *   it is the SAME object the fight is being fed, so this screen cannot print a hero the combat rules
 *   have not agreed to (docs/MISTAKES.md GQ-013, one layer out from where it was first found).
 */
export function heroScreenViewModel({ equippedWeaponId, ownedItemIds, selectedItemId, stats = null }) {
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

  // P2: WHO THIS HERO IS, from the resolved stats rather than from the catalogue.
  //
  // `damage` here is the hero's RESOLVED blow -- weapon plus what their level added to the arm --
  // not the sword's catalogue number. A screen that printed the sword's 10 beside a hero who hits
  // for 12 would be true about the item and false about the child, which is the version of GQ-013
  // that is hardest to notice because every individual number is correct.
  const identity = stats ? {
    level: stats.level,
    maxHp: stats.maxHp,
    damage: stats.heroDamage,
    power: powerFor(stats),
    powerText: formatPower(powerFor(stats)),
  } : null;

  // What equipping the selected weapon would do to this hero's POWER.
  //
  // The DRAMATIC before/delta/after equip ceremony is G1's, explicitly; what P2 owes is a surface
  // that is truthful and ready for it. So the delta is computed here, from the same law the level-up
  // ceremony uses, and simply printed on the comparison card. Null without stats: a POWER change
  // needs a hero to happen to, and inventing one would be worse than saying nothing.
  const powerComparison = (identity && selectedDef && selectedDef.id !== equippedWeaponId)
    ? (() => {
      const after = powerFor({
        maxHp: stats.maxHp,
        heroDamage: resolvedHeroDamage(stats.level, selectedDef.id),
      });
      return {
        from: identity.power,
        to: after,
        delta: after - identity.power,
        fromText: formatPower(identity.power),
        toText: formatPower(after),
        deltaText: `${after - identity.power < 0 ? '-' : '+'}${formatPower(Math.abs(after - identity.power))}`,
      };
    })()
    : null;

  return {
    slots,
    weapons,
    identity,
    selected: selectedDef && {
      id: selectedDef.id,
      name: selectedDef.name,
      damage: selectedDef.damage,
      swatch: swatchFor(selectedDef.id),
      isEquipped: selectedDef.id === equippedWeaponId,
    },
    // null when the selected item IS the equipped one -- nothing to compare against itself. Section
    // 8's own worked example was `1 -> 2 DAMAGE`; a same-item card has no arrow to draw.
    comparison: (selectedDef && selectedDef.id !== equippedWeaponId)
      ? { fromDamage: equippedDamage, toDamage: selectedDef.damage, isUpgrade: selectedDef.damage > equippedDamage }
      : null,
    powerComparison,
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
  const identityEl = root.querySelector('#hero-identity');
  const identityLevelEl = root.querySelector('#hero-identity-level-value');
  const identityPowerEl = root.querySelector('#hero-identity-power-value');
  const identityHpEl = root.querySelector('#hero-identity-hp');
  const identityDamageEl = root.querySelector('#hero-identity-damage');

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

  function renderCard(selected, comparison, powerComparison) {
    if (!selected) {
      nameEl.textContent = '';
      damageEl.textContent = '';
      compareEl.textContent = '';
      equipButton.disabled = true;
      equipButton.dataset.shown = 'false';
      return;
    }
    nameEl.textContent = selected.name;
    // "WEAPON DAMAGE", not "DAMAGE", since P2 put the HERO's resolved damage on the same screen.
    // Caught in a capture: the identity panel read "12 DAMAGE" while the card underneath it read
    // "DAMAGE 10", and both were true -- of different subjects. Two numbers a child cannot tell
    // apart is a worse readout than either alone, and the fix is a word rather than a number.
    damageEl.textContent = `WEAPON DAMAGE ${selected.damage}`;
    if (comparison) {
      // The stat delta, and -- when a hero is known -- what it would do to the one number the child
      // actually reads. Two lines rather than one because they answer different questions and the
      // contract's sidegrade rule depends on both being visible.
      compareEl.textContent = powerComparison
        ? `${comparison.fromDamage} → ${comparison.toDamage} DAMAGE · POWER ${powerComparison.deltaText}`
        : `${comparison.fromDamage} → ${comparison.toDamage} DAMAGE`;
      // Read off the POWER change when there is one, because POWER is the game's official
      // single-number estimate of readiness and a two-stat item can be a legitimate sidegrade the
      // damage line alone would mislabel as strictly better.
      compareEl.dataset.upgrade = String(
        powerComparison ? powerComparison.delta > 0 : comparison.isUpgrade,
      );
    } else {
      compareEl.textContent = '';
    }
    equipButton.dataset.shown = String(!selected.isEquipped);
    equipButton.disabled = selected.isEquipped;
  }

  function renderIdentity(identity) {
    if (!identityEl) return;
    // Hidden rather than blank when there is no hero yet: an empty POWER panel reads as "you have no
    // power", which is a different and untrue statement from "this is not known yet".
    identityEl.hidden = identity === null;
    if (identity === null) return;
    identityLevelEl.textContent = String(identity.level);
    identityPowerEl.textContent = identity.powerText;
    identityHpEl.textContent = String(identity.maxHp);
    identityDamageEl.textContent = String(identity.damage);
  }

  function render(view) {
    lastView = view;
    renderSlots(view.slots);
    renderItemList(view.weapons);
    renderIdentity(view.identity ?? null);
    renderCard(view.selected, view.comparison, view.powerComparison ?? null);
  }

  // A TOGGLE, because that is what a button in the top-right corner of a phone means.
  //
  // This was `setShown(true)` -- open-only -- and the Owner found it with his son on a real iPhone:
  // tapping #hero-button again did nothing, so the only way out was to find the small X. On a
  // phone, the control that opened a panel is the control a person expects to close it, and a child
  // who cannot read has no other way to guess.
  //
  // setShown already no-ops when the state is unchanged, and the mutual-exclusion in main.js's
  // onOpenChange only fires on OPEN, so toggling shut cannot disturb the other panel. The explicit
  // X stays: it is a second, obvious way out, not the only one.
  button.addEventListener('click', () => setShown(!shown));
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
