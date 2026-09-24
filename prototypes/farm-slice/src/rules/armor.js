// Pure armor inventory + equip rules. No three.js, no DOM.

import { spendCoins } from './economy.js';

export function createArmorState() {
  return {
    owned: [],
    equipped: { helmet: null, chest: null, boots: null, shield: null },
  };
}

export function isOwned(armorState, armorId) {
  return armorState.owned.includes(armorId);
}

/** Equip an already-owned armor piece into its slot immediately. */
export function equipArmor(armorState, armorDef) {
  if (!isOwned(armorState, armorDef.id)) return armorState;
  return {
    ...armorState,
    equipped: { ...armorState.equipped, [armorDef.slot]: armorDef.id },
  };
}

/**
 * Buy + immediately equip an armor piece from the market stall.
 * Returns { armorState, basketState, success }. On insufficient coins,
 * nothing changes and success is false (never punished beyond "not yet").
 */
export function buyArmor(armorState, basketState, armorDef) {
  const { basketState: nextBasket, success } = spendCoins(basketState, armorDef.price);
  if (!success) return { armorState, basketState, success: false };
  const owned = armorState.owned.includes(armorDef.id)
    ? armorState.owned
    : [...armorState.owned, armorDef.id];
  const equipped = { ...armorState.equipped, [armorDef.slot]: armorDef.id };
  return { armorState: { owned, equipped }, basketState: nextBasket, success: true };
}
