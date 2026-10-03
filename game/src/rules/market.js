// Pip's market: offers, the free-play order board, and armor. Pure, no DOM.
import * as economy from './economy.js';
import * as armor from './armor.js';
import * as orderBoard from '../depth/orders.js';
import { findById } from './state.js';
import { step, completeStep } from './progress.js';
import { checkRewards } from './rewards.js';

export const BOARD_SEED = 1;

/** Offers the free-play board may show for a band (content.MARKET.board). */
export function boardOffers(content, band) {
  const ids = content.MARKET.board[band] || [];
  // The board lane needs a `band` on each offer; stamp copies so content stays untouched.
  return ids.map((id) => findById(content.OFFERS, id)).filter(Boolean).map((o) => ({ ...o, band }));
}

/** The two first-visit offer cards. */
export function firstVisitOffers(content) {
  return content.MARKET.firstVisit.map((id) => findById(content.OFFERS, id)).filter(Boolean);
}

/** Create the free-play board once the band is known; rebuild it if the band changes. */
export function ensureOrderBoard(state, content) {
  if (!state.band || step(state) !== 'free') return state;
  if (state.orderBoard && state.orderBoard.band === state.band) return state;
  const offers = boardOffers(content, state.band);
  if (!offers.length) return state;
  return {
    ...state,
    orderBoard: orderBoard.createOrderBoard({ offers, band: state.band, seed: BOARD_SEED, slots: offers.length }),
  };
}

/** The board's open orders with their offer text, or [] before free play. */
export function openBoardOrders(state, content) {
  if (!state.orderBoard) return [];
  return orderBoard.getOpenOrders(state.orderBoard, boardOffers(content, state.orderBoard.band));
}

/** The offers the market shows right now: the board in free play, else the first-visit pair. */
export function visibleOffers(state, content) {
  return step(state) === 'free' && state.orderBoard ? openBoardOrders(state, content) : firstVisitOffers(content);
}

/** A grown-up picks the band once; the economy is the same, only the presentation changes. */
export function setBand(state, band, content) {
  if (band !== 'younger' && band !== 'older') return state;
  const next = { ...state, band };
  return content ? ensureOrderBoard(next, content) : next;
}

/** Opening the stall completes the MARKET step. */
export function openMarket(state) {
  return completeStep(state, 'market');
}

export function canFulfillOffer(state, offerDef) {
  return ['offer', 'free'].includes(step(state)) && economy.canFulfillOffer(state.basket, offerDef);
}

function countFill(state, offerId) {
  return { ...state, offersFilled: { ...state.offersFilled, [offerId]: (state.offersFilled?.[offerId] || 0) + 1 } };
}

function countFreeFill(state, content) {
  return checkRewards({ ...state, freeOrderFills: (state.freeOrderFills || 0) + 1 }, content);
}

/** Fill one open board order by its instance id. Unknown or unfillable orders are safe no-ops. */
export function fulfillBoardOrder(state, content, orderId) {
  if (step(state) !== 'free' || !state.orderBoard) return { state, success: false };
  let filled;
  try {
    filled = orderBoard.fulfillOrder({
      board: state.orderBoard,
      orderId,
      inventory: { ...state.basket.crops },
      offers: boardOffers(content, state.orderBoard.band),
    });
  } catch {
    return { state, success: false };
  }
  let next = {
    ...state,
    orderBoard: filled.board,
    basket: { ...state.basket, crops: filled.inventory, coins: state.basket.coins + filled.coinsEarned },
  };
  next = countFreeFill(countFill(next, filled.fulfilledOfferId), content);
  return { state: next, success: true, fulfilledOfferId: filled.fulfilledOfferId, coinsEarned: filled.coinsEarned };
}

/** Fill a market offer by offer id. A short or wrong pick changes nothing. */
export function fulfillOffer(state, content, offerId) {
  if (step(state) === 'free' && state.orderBoard) {
    const open = openBoardOrders(state, content).find((o) => o.offerId === offerId);
    if (open) return fulfillBoardOrder(state, content, open.id);
  }
  const offerDef = findById(content.OFFERS, offerId);
  if (!offerDef || !canFulfillOffer(state, offerDef)) return { state, success: false };
  const { basketState, success } = economy.fulfillOffer(state.basket, offerDef);
  if (!success) return { state, success: false };

  let next = countFill({ ...state, basket: basketState }, offerId);
  if (step(state) === 'offer') next = completeStep(next, 'offer');
  else if (step(state) === 'free') next = ensureOrderBoard(countFreeFill(next, content), content);
  return { state: next, success: true, coinsEarned: offerDef.coins };
}

/** The next piece on the mannequin: the first unowned piece of the market's set, or null. */
export function nextArmorForSale(state, content) {
  return content.ARMOR.find((a) => a.set === content.MARKET.armorSet && !state.armor.owned.includes(a.id)) || null;
}

/** Equipped pieces resolved to their content defs, by slot. */
export function equippedArmorDefs(state, content) {
  const defs = {};
  for (const [slot, armorId] of Object.entries(state.armor.equipped)) {
    if (armorId) defs[slot] = findById(content.ARMOR, armorId);
  }
  return defs;
}

/** Buy and immediately equip a piece from the mannequin. */
export function buyArmor(state, content, armorId) {
  const armorDef = findById(content.ARMOR, armorId);
  if (!armorDef || armorDef.set !== content.MARKET.armorSet) return { state, success: false };
  const { armorState, basketState, success } = armor.buyArmor(state.armor, state.basket, armorDef);
  if (!success) return { state, success: false };
  return { state: completeStep({ ...state, armor: armorState, basket: basketState }, 'armor'), success: true };
}
