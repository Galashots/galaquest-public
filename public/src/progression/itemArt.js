// WHAT AN ITEM LOOKS LIKE, AND HOW RARE IT IS -- one authority, read by every surface that draws
// gear.
//
// #88 is explicit that this has to be single-sourced, and about the direction the single source
// points: "weapon/armor icons use polished illustrated item portraits that remain an exact
// recognizable likeness of the in-game model", and "rarity is communicated through the icon
// border/frame rather than changing the item identity/art itself". Two surfaces guessing separately
// at what a Silverguard Helmet looks like is exactly how an acquisition ceremony ends up showing one
// helmet and the inventory strip a different grey square ten seconds later -- which is what the
// Checkpoint 0 capture of this game actually showed (every item, every slot, one identical grey
// rounded rectangle).
//
// Pure: no DOM, no three.js, no I/O, no clock. Same discipline as its neighbours under progression/
// -- net/gameServer.mjs imports files from this directory directly, so anything here has to stay
// framework-free to be importable there at all. A `.png` URL is a STRING in this file; nothing here
// loads it.
//
// ── WHERE THE ART ITSELF COMES FROM, STATED HONESTLY ───────────────────────────────────────────
//
// `iconUrl` names a PNG under public/assets/items/, rendered from the SAME GLB the running game
// mounts on the hero, by tools/assets/render-item-icons.mjs. That makes the likeness exact by
// construction rather than by an artist's memory of the model -- but a clean orthographic render of
// a game mesh is NOT the polished illustrated portrait #88 asks for, and this file does not pretend
// otherwise. It is a PROVISIONAL input that lets the whole compare/equip interaction be built,
// played and rejected now.
//
// FINAL ILLUSTRATED ITEM ART = UNKNOWN / OWNER-CHATGPT ART HANDOFF.
//
// The replacement path is deliberately a file drop, not a code change: overwrite
// public/assets/items/<id>.png with the final illustration at the same size and nothing in this
// repository has to be edited. That is the whole reason the icon is a URL here rather than an inline
// SVG -- the inline SVGs below are the FALLBACK, drawn when a PNG is missing or fails to load, so a
// half-delivered art batch degrades to a readable silhouette instead of an empty frame.

import {
  HELMET_SILVERGUARD_ID,
  SHIELD_IRONWOOD_ID,
  SHOULDER_SILVERGUARD_ID,
  STARTER_SWORD_ID,
  WILDWOOD_BLADE_ID,
} from './items.js';

// ── RARITY ──────────────────────────────────────────────────────────────────────────────────────
//
// The contract's own words (PROGRESSION_CONTRACT_V0 section 6, OWNER-LOCKED): "Familiar rarity
// language is acceptable and preferred: Common -> Uncommon -> Rare -> Epic -> Legendary". Ordered,
// not a bare set, because a frame's strength has to be able to grow WITH the tier ("higher rarity
// should increasingly receive stronger visual treatment") and a UI that wants "is this frame louder
// than that one" needs a rank to compare, not a colour to switch on.

export const RARITY_COMMON = 'common';
export const RARITY_UNCOMMON = 'uncommon';
export const RARITY_RARE = 'rare';
export const RARITY_EPIC = 'epic';
export const RARITY_LEGENDARY = 'legendary';

/** Weakest first. The index IS the rank -- see rarityRankFor. */
export const RARITY_ORDER = Object.freeze([
  RARITY_COMMON, RARITY_UNCOMMON, RARITY_RARE, RARITY_EPIC, RARITY_LEGENDARY,
]);

/** A child-facing label. Uppercased by CSS, not here: a view model should carry the word, not the
 *  shouting, or a screen reader announces the shouting too. */
export const RARITY_LABELS = Object.freeze({
  [RARITY_COMMON]: 'Common',
  [RARITY_UNCOMMON]: 'Uncommon',
  [RARITY_RARE]: 'Rare',
  [RARITY_EPIC]: 'Epic',
  [RARITY_LEGENDARY]: 'Legendary',
});

// ── THE FALLBACK SILHOUETTES ────────────────────────────────────────────────────────────────────
//
// Inline SVG in `currentColor`, so a frame can tint one without a second copy of the path data.
//
// THE SWORD, HELMET AND SHOULDER SILHOUETTES MOVED HERE FROM ui/unlockCard.js, and that move is the
// point rather than tidying: they were a UI ceremony's private constants, and the Hero screen drew
// its own unrelated grey square for the same items. One item, two opinions about its shape, is the
// drift #88's "exact recognizable likeness" requirement exists to close. ui/unlockCard.js now
// re-exports these from here (a pointer, not a copy -- GQ-007), so its existing importers are
// unchanged and there is still exactly one definition.
//
// They live in progression/ rather than ui/ because this module has to stay DOM-free to be
// importable beside items.js, and a template string is not DOM.

/** A sword, point down -- the same silhouette as the planted prop in Rowan's clearing. */
export const SWORD_ICON_SVG = `
  <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="currentColor">
      <rect x="21.5" y="2" width="5" height="7" rx="1.5"/>
      <rect x="22.75" y="8" width="2.5" height="5"/>
      <rect x="12" y="13" width="24" height="4.5" rx="2.25"/>
      <path d="M20 17.5 h8 l-2.4 22.5 L24 46 l-1.6 -6 Z"/>
    </g>
  </svg>
`;

/** An open-face helmet: a domed skull-cap with a raised brow ridge, the read the running-game mount
 *  and its hair/ear occlusion are authored for (character/gear.js). */
export const HELMET_ICON_SVG = `
  <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="currentColor">
      <path d="M24 6 C13 6 7 14 7 25 v3 h6 v-3 c0-8 4-13 11-13 s11 5 11 13 v3 h6 v-3 C41 14 35 6 24 6 Z"/>
      <rect x="6" y="27" width="8" height="6" rx="2"/>
      <rect x="34" y="27" width="8" height="6" rx="2"/>
      <rect x="20" y="6" width="8" height="9" rx="3"/>
    </g>
  </svg>
`;

/** A pair of pauldrons -- two domed shoulder caps. */
export const SHOULDER_ICON_SVG = `
  <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="currentColor">
      <path d="M6 22 C6 13 12 7 18 7 s10 5 10 11 v6 H6 Z"/>
      <path d="M42 22 C42 13 36 7 30 7 s-10 5 -10 11 v6 h22 Z"/>
      <rect x="4" y="27" width="16" height="7" rx="2.5"/>
      <rect x="28" y="27" width="16" height="7" rx="2.5"/>
    </g>
  </svg>
`;

/** A round strapped shield: rim, boss, and the two cross-braces the Ironwood mesh reads as. New
 *  here, because the Shield had no silhouette at all before this package -- it was one of the grey
 *  squares. */
export const SHIELD_ICON_SVG = `
  <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="currentColor">
      <path d="M24 3 C24 3 12 5.5 6.5 8 v14 c0 10.5 7.5 18 17.5 23 c10-5 17.5-12.5 17.5-23 V8 C36 5.5 24 3 24 3 Z
               m0 4.4 c3.9 .8 9.4 2 13.6 3.2 v11.4 c0 8.2-5.7 14.4-13.6 18.6 c-7.9-4.2-13.6-10.4-13.6-18.6 V10.6
               C14.6 9.4 20.1 8.2 24 7.4 Z"/>
      <circle cx="24" cy="21" r="4.2"/>
      <rect x="22.4" y="10" width="3.2" height="22" rx="1.4"/>
      <rect x="13" y="19.4" width="22" height="3.2" rx="1.4"/>
    </g>
  </svg>
`;

// ── THE CATALOGUE ───────────────────────────────────────────────────────────────────────────────
//
// One row per item the game can actually put in a child's hands. Deliberately NOT generated from
// ITEM_DEFS with a default: an item with no art decision is a missing decision, and defaulting it to
// a grey square silently is precisely the Checkpoint 0 defect. itemArtFor returns a NEUTRAL entry
// for an unknown id (a UI must always be able to draw something), but a shipping item that is not
// listed here fails test/gear-compare.test.mjs, which is the loud version of the same answer.
//
// RARITY IS A PRESENTATION DECISION ABOUT AN EXISTING ITEM, not a new economy. #88 asks for a rarity
// frame; PROGRESSION_CONTRACT_V0 fixes the vocabulary. Nothing in this file changes a stat, a drop
// rate, or what an item does -- rarityFor is read by frames and labels only, and no combat or reward
// path imports this module (test/gear-compare.test.mjs pins that, the same way
// test/progression-power.test.mjs pins POWER's own direction of dependency).
//
// The assignments themselves are the conservative reading of what already exists:
//   - the two items every child starts with are Common: they are the baseline, by definition;
//   - the Wildwood Blade is Uncommon -- twice the starter sword's damage, and the game's first
//     authored weapon reward;
//   - the Silverguard Helmet is Rare: it is G1's one earned upgrade and the first item that changes
//     how the hero LOOKS;
//   - the Silverguard Shoulders are Uncommon: a real kill drop, from the same Silverguard set, but a
//     smaller moment than the authored Helmet reward.
// None of these promotes an item, changes a drop table, or pre-decides the Owner's six selected
// intake gear identities recorded on #88.

const NEUTRAL_ART = Object.freeze({
  rarity: RARITY_COMMON,
  iconUrl: null,
  iconSvg: SWORD_ICON_SVG,
});

const ITEM_ART = Object.freeze({
  [STARTER_SWORD_ID]: Object.freeze({
    rarity: RARITY_COMMON,
    iconUrl: 'assets/items/starter_sword.png',
    iconSvg: SWORD_ICON_SVG,
  }),
  [WILDWOOD_BLADE_ID]: Object.freeze({
    rarity: RARITY_UNCOMMON,
    iconUrl: 'assets/items/wildwood_blade.png',
    iconSvg: SWORD_ICON_SVG,
  }),
  [SHIELD_IRONWOOD_ID]: Object.freeze({
    rarity: RARITY_COMMON,
    iconUrl: 'assets/items/shield_ironwood.png',
    iconSvg: SHIELD_ICON_SVG,
  }),
  [HELMET_SILVERGUARD_ID]: Object.freeze({
    rarity: RARITY_RARE,
    iconUrl: 'assets/items/helmet_silverguard.png',
    iconSvg: HELMET_ICON_SVG,
  }),
  [SHOULDER_SILVERGUARD_ID]: Object.freeze({
    rarity: RARITY_UNCOMMON,
    iconUrl: 'assets/items/shoulder_silverguard.png',
    iconSvg: SHOULDER_ICON_SVG,
  }),
});

/** Every item id this module has an art decision for. Exported so a test can assert the catalogue
 *  covers ITEM_DEFS without importing the private object. */
export function itemIdsWithArt() {
  return Object.keys(ITEM_ART);
}

/** The whole art row for an item. Never null: a UI always has something to draw. */
export function itemArtFor(itemId) {
  return ITEM_ART[itemId] ?? NEUTRAL_ART;
}

export function rarityFor(itemId) {
  return itemArtFor(itemId).rarity;
}

/**
 * Where this item's rarity sits on the Common..Legendary ladder, 0-based.
 *
 * A number rather than the word, so a frame can scale its own treatment with the tier instead of
 * carrying a five-branch switch that has to be edited every time a tier is used somewhere new.
 */
export function rarityRankFor(itemId) {
  return RARITY_ORDER.indexOf(rarityFor(itemId));
}

export function rarityLabelFor(itemId) {
  return RARITY_LABELS[rarityFor(itemId)] ?? RARITY_LABELS[RARITY_COMMON];
}

/** The rendered portrait's URL, or null when this item has none yet (draw iconSvgFor instead). */
export function itemIconUrlFor(itemId) {
  return itemArtFor(itemId).iconUrl;
}

/** The fallback silhouette, always a string. */
export function itemIconSvgFor(itemId) {
  return itemArtFor(itemId).iconSvg;
}
