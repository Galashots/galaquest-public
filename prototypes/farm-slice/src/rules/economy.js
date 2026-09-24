// Pure basket/coins/offer rules. No three.js, no DOM.

export function createBasketState() {
  return { crops: {}, coins: 0 };
}

export function addCrop(basketState, cropId, qty = 1) {
  const crops = { ...basketState.crops };
  crops[cropId] = (crops[cropId] || 0) + qty;
  return { ...basketState, crops };
}

export function countOf(basketState, cropId) {
  return basketState.crops[cropId] || 0;
}

export function addCoins(basketState, amount) {
  return { ...basketState, coins: basketState.coins + amount };
}

/** True if the basket has at least the crops an offer's `wants` map requires. */
export function canFulfillOffer(basketState, offerDef) {
  return Object.entries(offerDef.wants).every(
    ([cropId, qty]) => countOf(basketState, cropId) >= qty
  );
}

/**
 * Attempt to fulfil a market offer: removes the wanted crops and adds the
 * coin reward. Never punishes a wrong/short pick -- it just reports failure
 * so the UI can nudge the player, nothing is lost from the basket on failure.
 */
export function fulfillOffer(basketState, offerDef) {
  if (!canFulfillOffer(basketState, offerDef)) {
    return { basketState, success: false };
  }
  const crops = { ...basketState.crops };
  for (const [cropId, qty] of Object.entries(offerDef.wants)) {
    crops[cropId] = crops[cropId] - qty;
  }
  const next = { crops, coins: basketState.coins + offerDef.coins };
  return { basketState: next, success: true };
}

export function canAfford(basketState, price) {
  return basketState.coins >= price;
}

export function spendCoins(basketState, amount) {
  if (!canAfford(basketState, amount)) return { basketState, success: false };
  return { basketState: { ...basketState, coins: basketState.coins - amount }, success: true };
}
