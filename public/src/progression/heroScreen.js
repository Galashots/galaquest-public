// The Hero screen: the gear surface a child compares on and equips from, kept out of main.js on
// purpose -- the architecture doctrine (GalaQuest_Gameplay_Expansion_Stream_Plan section 5) singles
// main.js out as a conflict hotspot the asset stream is also touching, and this feature is big
// enough (five slots, an inventory grid, a comparison card, open/close, a hero preview handoff) that
// inlining it would have meant a real chunk of main.js's own growth. main.js calls createHeroScreen()
// once and feeds it a state object each frame.
//
// heroScreenViewModel is pure (no DOM) and unit tested directly. createHeroScreen is the DOM half,
// exercised through the browser and tools/runtime-test/drive-hero-screen.mjs -- the same split
// between a rule you can prove without a screen and one you can only prove by looking at it.
//
// ── #88: WHAT CHANGED HERE, AND WHY THE OLD SHAPE WAS WRONG ────────────────────────────────────
//
// This surface used to be: tap an item to select it, then find a separate EQUIP button and tap that.
// A Checkpoint 0 player-fair session against main@de9f253 photographed the result -- every item, in
// every slot and in the owned strip, drawn as one identical grey rounded rectangle, and a comparison
// card that said "WEAPON DAMAGE 10" with no art, no rarity, and no POWER.
//
// #88 replaces the interaction and the presentation together:
//
//   FIRST TAP on an unequipped item SELECTS it and opens the comparison. It does NOT equip.
//   SECOND TAP on that same item (or on its comparison card) EQUIPS it.
//   There is NO separate Equip button. It is gone from this file and from index.html.
//   A tap on an item that is ALREADY WORN selects it and never takes it off.
//
// The two-tap rule lives in the DOM half rather than the view model because it is about EVENTS, not
// state: "is this the second tap" is answerable only from what the presenter last painted, which is
// exactly what `lastView` is. The view model's job is to say whether an item is ARMED -- selected,
// owned, and not already worn -- and the click handler turns that into compare-or-equip.
//
// WHY NOT A LONG-PRESS, A DOUBLE-TAP, OR A DRAG: a long-press is invisible to a child who has never
// been told about it, a double-tap has to race a 300ms timer against the single-tap it also has to
// serve, and a drag needs precision a five-year-old's thumb does not have. Two ordinary taps with a
// visibly different state in between is the only one of the four where the screen itself can say
// what the next tap will do -- which is why the card carries that sentence.

import {
  DEFAULT_EQUIPPED_ITEM_IDS,
  ITEM_DEFS,
  WEAPON_SLOT,
  damageFor,
  itemDef,
} from './items.js';
// The RESOLVED hero, and the number a child brags about. Imported rather than passed as loose
// numbers so this surface cannot be handed a level and a POWER that disagree with each other.
import { damageReductionPercentForEquipment, resolvedHeroDamage } from './heroStats.js';
import { formatPower, powerFor } from './power.js';
// #88's single art/rarity authority. Imported, never restated (GQ-007): the acquisition ceremony,
// the inventory grid, the equipped slot and the comparison card all draw one item from one row, so
// they cannot disagree about what a Silverguard Helmet looks like.
import { itemIconSvgFor, itemIconUrlFor, rarityFor, rarityLabelFor, rarityRankFor } from './itemArt.js';
// The comparison itself, including the sidegrade rule. This module paints what gearCompare decides
// and decides none of it -- see that file's header for why a verdict a child reads as "yes, put it
// on" belongs somewhere `node --test` can interrogate.
import { gearComparison } from './gearCompare.js';
// A plain numeric hex constant, not a three.js Color or a DOM value -- safe to import into a
// browser-only UI module with zero new coupling. Reusing it (rather than a second guess at "what
// colour is the Wildwood Blade") is what keeps the accent agreeing with the planted prop a child
// already saw in Rowan's clearing.
import { WILDWOOD_COLOR } from '../world/wildwoodBlade.js';

const SLOT_DEFS = Object.freeze([
  { id: WEAPON_SLOT, label: 'Weapon' },
  // A slot is locked exactly when the catalogue defines NO item for it -- decided from ITEM_DEFS
  // below, never from a hand-maintained "which slots work" list that could drift from it.
  { id: 'shield', label: 'Shield' },
  { id: 'helmet', label: 'Helmet' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'chest', label: 'Chest' },
]);

// The slots the catalogue has at least one item for. Derived from ITEM_DEFS so adding an item to a
// slot unlocks it with no second edit here.
const SLOTS_WITH_ITEMS = Object.freeze(new Set(Object.values(ITEM_DEFS).map((def) => def.slot)));

// One accent per item id. Retained alongside the rendered portraits in itemArt.js because they
// answer different questions: the PNG is what the item looks like, the accent is what colour the
// glow, the slot ring and the acquisition card take -- and a UI cannot sample a colour out of an
// image it has not loaded yet. Numeric hex (three.js's own colour shape) is the source of truth; the
// CSS string is derived from it below, not defined a second time.
const ITEM_SWATCH_HEX = Object.freeze({
  starter_sword: 0xb9c2cc,
  wildwood_blade: WILDWOOD_COLOR,
  shield_ironwood: 0x6f7d8c,
  helmet_silverguard: 0xaebfd1,
  shoulder_silverguard: 0x9aa6b4,
});
const NEUTRAL_SWATCH_HEX = 0x8a97a6;

export function swatchHexFor(itemId) {
  return ITEM_SWATCH_HEX[itemId] ?? NEUTRAL_SWATCH_HEX;
}

export function swatchFor(itemId) {
  return `#${swatchHexFor(itemId).toString(16).padStart(6, '0')}`;
}

/** The art fields every drawable item carries, in one place so a slot, a grid cell and a comparison
 *  portrait cannot each assemble a different subset of them. */
function artFor(itemId) {
  return {
    swatch: swatchFor(itemId),
    iconUrl: itemIconUrlFor(itemId),
    iconSvg: itemIconSvgFor(itemId),
    rarity: rarityFor(itemId),
    rarityRank: rarityRankFor(itemId),
    rarityLabel: rarityLabelFor(itemId),
  };
}

/**
 * Pure. Turns { equippedWeaponId, equippedItemIds, ownedItemIds, selectedItemId } into everything the
 * DOM binder below needs to paint a frame -- no querySelector, no three.js, testable with node --test.
 *
 * equippedItemIds is the whole equipped-per-slot map, so every slot reads the truth rather than a
 * lock; equippedWeaponId, still accepted for older callers, is folded into that map's weapon slot as
 * its authority.
 *
 * selectedItemId may be stale (an id no longer owned, or none chosen yet) -- resolved down to the
 * equipped weapon in that case, the same "always a safe fallback, never a blank card" discipline
 * progression/state.js's equippedWeaponIdFromRewards already uses for the wire field it reads.
 *
 * @param stats the RESOLVED Hero stats from progression/heroStats.js. Optional: a caller with none
 *   yet (pre-welcome) gets no identity panel rather than a made-up one. When present it is the SAME
 *   object the fight is being fed, so this screen cannot print a hero the combat rules have not
 *   agreed to (docs/MISTAKES.md GQ-013).
 */
export function heroScreenViewModel({
  equippedWeaponId,
  equippedItemIds = DEFAULT_EQUIPPED_ITEM_IDS,
  ownedItemIds,
  selectedItemId,
  stats = null,
}) {
  const equipped = { ...DEFAULT_EQUIPPED_ITEM_IDS, ...equippedItemIds };
  if (typeof equippedWeaponId === 'string') equipped[WEAPON_SLOT] = equippedWeaponId;
  const equippedWeapon = equipped[WEAPON_SLOT];
  const owned = new Set(ownedItemIds);
  const resolvedSelectedId = owned.has(selectedItemId) ? selectedItemId : equippedWeapon;
  const selectedDef = itemDef(resolvedSelectedId);
  const equippedDamage = damageFor(equippedWeapon);

  // Whether an item is the one currently worn in ITS slot. One helper so the grid, the card and the
  // slot row all agree.
  const isEquippedInSlot = (def) => def !== null && equipped[def.slot] === def.id;

  // The inventory: every item this child actually owns and the catalogue defines.
  //
  // `armed` is #88's whole interaction in one boolean: selected, owned, and not already worn --
  // therefore the next tap on it equips. The DOM half reads this rather than re-deriving
  // "selected && !equipped" at the click site, so the sentence the card prints ("TAP AGAIN TO
  // EQUIP") and the behaviour the click performs come from the same field. A card that promised one
  // and did the other is the defect this shape exists to make impossible.
  const items = ownedItemIds
    .map((id) => itemDef(id))
    .filter((def) => def !== null)
    .map((def) => {
      const equippedHere = isEquippedInSlot(def);
      const selected = def.id === resolvedSelectedId;
      return {
        id: def.id,
        name: def.name,
        slot: def.slot,
        damage: def.damage ?? null,
        damageReductionPercent: def.damageReductionPercent ?? null,
        equipped: equippedHere,
        selected,
        armed: selected && !equippedHere,
        ...artFor(def.id),
      };
    });

  const slots = SLOT_DEFS.map((slot) => {
    const locked = !SLOTS_WITH_ITEMS.has(slot.id);
    const equippedDef = locked ? null : itemDef(equipped[slot.id] ?? null);
    return {
      id: slot.id,
      label: slot.label,
      locked,
      filled: equippedDef !== null,
      itemId: equippedDef?.id ?? null,
      name: equippedDef?.name ?? null,
      swatch: equippedDef ? swatchFor(equippedDef.id) : null,
      iconUrl: equippedDef ? itemIconUrlFor(equippedDef.id) : null,
      iconSvg: equippedDef ? itemIconSvgFor(equippedDef.id) : null,
      rarity: equippedDef ? rarityFor(equippedDef.id) : null,
      // The slot the selected item WOULD go into, so the screen can show a child where the thing
      // they are looking at belongs before they commit to it. This is the cheapest possible answer
      // to "what would this replace" and it costs no extra tap.
      isTarget: selectedDef !== null && selectedDef.slot === slot.id && !isEquippedInSlot(selectedDef),
    };
  });

  // WHO THIS HERO IS, from the resolved stats rather than from the catalogue.
  //
  // `damage` here is the hero's RESOLVED blow -- weapon plus what their level added to the arm --
  // not the sword's catalogue number. A screen that printed the sword's 10 beside a hero who hits
  // for 12 would be true about the item and false about the child.
  const identity = stats ? {
    level: stats.level,
    maxHp: stats.maxHp,
    damage: stats.heroDamage,
    power: powerFor(stats),
    powerText: formatPower(powerFor(stats)),
  } : null;

  // #88's comparison, in full: portrait, rarity, stat rows with deltas, POWER before/after, and a
  // truthful verdict that obeys the contract's sidegrade rule. One call, so the card and any future
  // surface that wants the same answer share the arithmetic.
  const compare = selectedDef === null ? null : gearComparison({
    candidateItemId: selectedDef.id,
    equippedItemIds: equipped,
    stats,
  });

  // ── THE TWO PRE-#88 FIELDS, NOW DERIVED RATHER THAN COMPUTED TWICE ────────────────────────────
  //
  // `comparison` and `powerComparison` are the shapes this module already published and other code
  // and tests already read. They are kept -- but they are now READ OFF `compare` instead of being
  // calculated a second time here. That is the GQ-007 point: two independent derivations of "what
  // would this swap do to POWER" is exactly how a card and a ceremony start disagreeing by a
  // rounding step, and the fix is one arithmetic with two views of it, not two arithmetics that
  // happen to match today.
  const comparison = (compare && selectedDef.slot === WEAPON_SLOT && !compare.isEquipped)
    ? {
      fromDamage: equippedDamage,
      toDamage: selectedDef.damage,
      isUpgrade: selectedDef.damage > equippedDamage,
    }
    : null;

  const powerComparison = (compare && compare.power && !compare.isEquipped)
    ? {
      from: compare.power.before,
      to: compare.power.after,
      delta: compare.power.delta,
      fromText: compare.power.beforeText,
      toText: compare.power.afterText,
      deltaText: compare.power.deltaText,
    }
    : null;

  return {
    slots,
    items,
    identity,
    selected: selectedDef && {
      id: selectedDef.id,
      name: selectedDef.name,
      slot: selectedDef.slot,
      damage: selectedDef.damage ?? null,
      damageReductionPercent: selectedDef.damageReductionPercent ?? null,
      isEquipped: isEquippedInSlot(selectedDef),
      // #88's interaction, restated on the selection itself so the card can decide what sentence to
      // print without walking `items`.
      armed: !isEquippedInSlot(selectedDef),
      ...artFor(selectedDef.id),
    },
    compare,
    comparison,
    powerComparison,
  };
}

// ── THE DOM HALF ────────────────────────────────────────────────────────────────────────────────

/** An <img> for a rendered portrait with the inline silhouette behind it, so a missing or
 *  slow-loading PNG degrades to a readable shape rather than an empty frame. #88's final art arrives
 *  as a file drop at the same URL, which is why this is an <img src> and not an inlined asset. */
function paintArt(host, { iconUrl, iconSvg }) {
  if (host.dataset.artUrl === String(iconUrl) && host.dataset.artPainted === 'true') return;
  host.dataset.artUrl = String(iconUrl);
  host.dataset.artPainted = 'true';
  host.innerHTML = '';
  const fallback = document.createElement('span');
  fallback.className = 'item-art-fallback';
  fallback.setAttribute('aria-hidden', 'true');
  fallback.innerHTML = iconSvg ?? '';
  host.appendChild(fallback);
  if (!iconUrl) return;
  const img = document.createElement('img');
  img.className = 'item-art-image';
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'eager';
  // The fallback is hidden only once the real portrait has actually decoded. Hiding it up front
  // would leave an empty square for as long as the PNG takes, and an empty square is the exact
  // Checkpoint 0 failure this whole package is about.
  img.addEventListener('load', () => { fallback.hidden = true; });
  img.addEventListener('error', () => { img.remove(); });
  img.src = iconUrl;
  host.appendChild(img);
}

/**
 * Queries its elements once from `root`, wires clicks straight to the callbacks it is given, and
 * exposes render()/open()/close()/isOpen().
 *
 * @param options.onSelect(itemId)            an item was tapped for the first time -- compare it.
 * @param options.onEquip(itemId, context)    the ARMED item was tapped again -- equip it. `context`
 *   carries `{ sourceElement, slotElement }` so main.js can fly the icon from where the child
 *   touched it to where it lands, without this module owning an animation.
 * @param options.onOpenChange(open)          fires after open()/close() change the shown state.
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
  const cardEl = root.querySelector('#hero-item-card');
  const cardArtEl = root.querySelector('#hero-card-art');
  const nameEl = root.querySelector('#hero-item-name');
  const rarityEl = root.querySelector('#hero-item-rarity');
  const verdictEl = root.querySelector('#hero-item-verdict');
  const statsEl = root.querySelector('#hero-compare-stats');
  const powerEl = root.querySelector('#hero-compare-power');
  const actionEl = root.querySelector('#hero-compare-action');
  const identityEl = root.querySelector('#hero-identity');
  const identityLevelEl = root.querySelector('#hero-identity-level-value');
  const identityPowerEl = root.querySelector('#hero-identity-power-value');
  const identityHpEl = root.querySelector('#hero-identity-hp');
  const identityDamageEl = root.querySelector('#hero-identity-damage');

  let shown = false;
  // The last view() this presenter was handed, so a click handler (which fires between frames, not
  // during a render() call) can read "what item is this button for" without re-deriving it.
  let lastView = null;
  // itemId -> its button. RECONCILED, not rebuilt: main.js renders every frame the screen is open,
  // and tearing the grid down each frame would (a) restart every portrait's decode, and (b) destroy
  // the element the flight animation needs a stable rect for -- an item that is replaced between the
  // tap and the animation has no on-screen position to fly from.
  const itemEls = new Map();

  function setShown(next) {
    if (shown === next) return;
    shown = next;
    screen.dataset.shown = String(shown);
    button.setAttribute('aria-pressed', String(shown));
    onOpenChange(shown);
  }

  /** The equipped slot's element, so a caller can fly an icon into it. Public via the returned API
   *  rather than reached for with a querySelector in main.js: where a slot lives is this module's
   *  business. */
  function slotElement(slotId) {
    return slotsEl.querySelector(`.hero-slot[data-slot="${slotId}"]`) ?? null;
  }

  function itemElement(itemId) {
    return itemEls.get(itemId) ?? null;
  }

  function renderSlots(slots) {
    for (const slot of slots) {
      const el = slotElement(slot.id);
      if (!el) continue;
      el.dataset.locked = String(slot.locked);
      el.dataset.filled = String(slot.filled);
      el.dataset.rarity = slot.rarity ?? '';
      el.dataset.target = String(slot.isTarget);
      el.style.setProperty('--slot-swatch', slot.swatch ?? 'transparent');
      const art = el.querySelector('.hero-slot-art');
      if (art) {
        if (slot.filled) paintArt(art, slot);
        else if (art.dataset.artPainted === 'true') {
          art.innerHTML = '';
          art.dataset.artPainted = 'false';
          art.dataset.artUrl = '';
        }
      }
      const nameSpan = el.querySelector('.hero-slot-name');
      // Filled -> the worn item's name; unlocked-but-empty -> the slot's own label (an empty
      // "Helmet" slot reads as a helmet slot); locked -> nothing but the lock glyph.
      if (nameSpan) nameSpan.textContent = slot.filled ? slot.name : (slot.locked ? '' : slot.label);
    }
  }

  // A screen-reader stat for one owned item, by kind, so the grid announces a helmet honestly
  // rather than "damage undefined".
  function itemAriaStat(item) {
    if (item.slot === WEAPON_SLOT) return `damage ${item.damage}`;
    if (item.damageReductionPercent !== null) return `${item.damageReductionPercent}% armor`;
    return 'gear';
  }

  function buildItemButton(item) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'hero-item';
    el.dataset.itemId = item.id;
    const art = document.createElement('span');
    art.className = 'hero-item-art item-art';
    const label = document.createElement('span');
    label.className = 'hero-item-label';
    const tag = document.createElement('span');
    tag.className = 'hero-item-tag';
    el.append(art, label, tag);
    // #88's two-tap rule, at the only place that can know whether this is the second tap: an ARMED
    // item equips, anything else selects. An item that is already worn therefore falls to the
    // `else` and is merely re-selected -- which is the requirement that "an accidental second tap
    // on an ALREADY EQUIPPED slot must NOT unequip it", satisfied by construction rather than by a
    // guard someone has to remember to keep.
    el.addEventListener('click', () => {
      const current = lastView?.items?.find((candidate) => candidate.id === item.id) ?? null;
      if (current?.armed) {
        onEquip(item.id, { sourceElement: el, slotElement: slotElement(current.slot) });
      } else {
        onSelect(item.id);
      }
    });
    return el;
  }

  function renderItemList(items) {
    const seen = new Set();
    for (const item of items) {
      seen.add(item.id);
      let el = itemEls.get(item.id);
      if (!el) {
        el = buildItemButton(item);
        itemEls.set(item.id, el);
      }
      el.dataset.selected = String(item.selected);
      el.dataset.equipped = String(item.equipped);
      el.dataset.armed = String(item.armed);
      el.dataset.rarity = item.rarity;
      el.style.setProperty('--slot-swatch', item.swatch);
      el.setAttribute(
        'aria-label',
        `${item.name}, ${item.rarityLabel}, ${itemAriaStat(item)}`
        + `${item.equipped ? ', equipped' : ''}${item.armed ? ', tap again to equip' : ''}`,
      );
      paintArt(el.querySelector('.hero-item-art'), item);
      el.querySelector('.hero-item-label').textContent = item.name;
      el.querySelector('.hero-item-tag').textContent = item.equipped ? 'WORN' : '';
    }
    // Drop anything no longer owned, then re-append in view order so the DOM order matches the
    // model's without rebuilding the nodes.
    for (const [itemId, el] of itemEls) {
      if (seen.has(itemId)) continue;
      el.remove();
      itemEls.delete(itemId);
    }
    for (const item of items) itemListEl.appendChild(itemEls.get(item.id));
  }

  function statRow(row) {
    const el = document.createElement('div');
    el.className = 'hero-compare-row';
    el.dataset.direction = row.direction;
    el.innerHTML = `<span class="hero-compare-row-label">${row.label}</span>`
      + `<span class="hero-compare-row-from">${row.currentText}</span>`
      + '<span class="hero-compare-row-arrow" aria-hidden="true">→</span>'
      + `<span class="hero-compare-row-to">${row.candidateText}</span>`
      + (row.deltaText ? `<span class="hero-compare-row-delta">${row.deltaText}</span>` : '');
    return el;
  }

  function renderCard(compare) {
    if (!compare) {
      cardEl.dataset.shown = 'false';
      return;
    }
    cardEl.dataset.shown = 'true';
    cardEl.dataset.verdict = compare.verdict;
    cardEl.dataset.rarity = compare.candidate.rarity;
    cardEl.dataset.armed = String(!compare.isEquipped);
    cardEl.style.setProperty('--slot-swatch', swatchFor(compare.candidate.id));

    paintArt(cardArtEl, compare.candidate);
    nameEl.textContent = compare.candidate.name;
    rarityEl.textContent = compare.candidate.rarityLabel;
    // The verdict as a WORD, not only as the attribute the stylesheet colours from. "Is this better"
    // is the question the first tap asked, and an answer only a CSS rule can read is not an answer.
    if (verdictEl) verdictEl.textContent = compare.verdictLabel;

    statsEl.innerHTML = '';
    for (const row of compare.stats) statsEl.appendChild(statRow(row));
    statsEl.hidden = compare.stats.length === 0;

    // POWER: the before -> delta -> after shape #41 asks for, on the surface where a child is
    // deciding. The delta is the loud element because it is the answer to the question they asked
    // by tapping; the before and after are there so the number has a scale.
    if (compare.power && !compare.isEquipped) {
      powerEl.hidden = false;
      powerEl.dataset.direction = compare.power.delta > 0 ? 'up' : (compare.power.delta < 0 ? 'down' : 'same');
      powerEl.innerHTML = '<span class="hero-compare-power-label">POWER</span>'
        + `<span class="hero-compare-power-from">${compare.power.beforeText}</span>`
        + '<span class="hero-compare-power-arrow" aria-hidden="true">→</span>'
        + `<span class="hero-compare-power-to">${compare.power.afterText}</span>`
        + `<span class="hero-compare-power-delta">${compare.power.deltaText}</span>`;
    } else {
      powerEl.hidden = true;
    }

    // THE SENTENCE THAT MAKES THE GESTURE DISCOVERABLE. A two-tap interaction nobody is told about
    // is a two-tap interaction nobody performs -- and a child who cannot read still learns it,
    // because the first tap visibly changes the card and this line changes with it.
    actionEl.textContent = compare.isEquipped ? 'WEARING IT' : 'TAP AGAIN TO EQUIP';
    actionEl.dataset.armed = String(!compare.isEquipped);
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
    renderItemList(view.items);
    renderIdentity(view.identity ?? null);
    renderCard(view.compare ?? null);
  }

  // A TOGGLE, because that is what a button in the top-right corner of a phone means. This was
  // open-only, and the Owner found it with his son on a real iPhone: tapping #hero-button again did
  // nothing, so the only way out was to find the small X. The explicit X stays: a second, obvious
  // way out, not the only one.
  button.addEventListener('click', () => setShown(!shown));
  closeButton.addEventListener('click', () => setShown(false));

  // The card is the second tap target for the same act. #88 asks for "tapping the already-selected
  // inventory item/card again equips it" -- the card is often the larger, closer thing under a
  // child's thumb once they have read it, and making them travel back to a small grid cell to
  // confirm is the administration this package exists to remove.
  cardEl.addEventListener('click', () => {
    const selected = lastView?.selected;
    if (!selected || !selected.armed) return;
    onEquip(selected.id, {
      sourceElement: itemEls.get(selected.id) ?? cardEl,
      slotElement: slotElement(selected.slot),
    });
  });

  return {
    render,
    open() { setShown(true); },
    close() { setShown(false); },
    isOpen() { return shown; },
    slotElement,
    itemElement,
  };
}
