// The game "engine": pure functions that combine the smaller rule modules
// into one top-level state object and one set of player actions. No
// three.js, no DOM -- this is the module that gets unit-tested and is the
// one that could port to Unity later. All actions take an explicit `now`
// (epoch ms) rather than reading the clock themselves, so growth timing is
// fully testable and correct across save/reload.
//
// The goal machine follows CONTRACT.md section 4 exactly:
//   PLANT -> GROW -> HARVEST -> MARKET -> OFFER -> ARMOR -> HATCH -> NAME
//   -> BOOK -> FEED -> REPLANT -> FREE (terminal, loops forever, no cracks)

import * as farm from './farm.js';
import * as economy from './economy.js';
import * as armor from './armor.js';
import * as egg from './egg.js';
import * as collection from './collection.js';
import * as goals from './goals.js';
import * as orderBoard from '../depth/orders.js';

export const SAVE_VERSION = 1;
export const NUM_PLOTS = 3;

/**
 * Minutes 10-30 tease (CONTRACT.md section 5): 3 fed sunberries bloom the
 * first creature's sun crest; 2 FREE order fills earn Pip's gift (one
 * plantable star seed plus a ready Leaf egg for SECOND_EGG_CREATURE_ID).
 */
export const SUN_CREST_FEDS = 3;
export const GIFT_FILLS_REQUIRED = 2;
export const SECOND_EGG_CREATURE_ID = 'mossbun';
export const SECOND_EGG_ELEMENT = 'leaf';

/**
 * Minutes 10-30 tease (CONTRACT.md section 5 item 3): the older player's
 * third card (6 carrots + 2 sunberries → 26), served on a persistent
 * refillable order board in FREE play. The board lane
 * (`src/depth/orders.js`) is reused read-only; the shell curates which
 * offers reach it (below) and owns inventory, coins and saves.
 */
export const BIG_ORDER_OFFER_ID = 'pip_big_order';
export const BOARD_SEED = 1;

/** Builds a cropId->def lookup map from content.CROPS. */
export function cropsById(content) {
  const map = new Map();
  content.CROPS.forEach((c) => map.set(c.id, c));
  return map;
}

function findById(list, id) {
  return list.find((item) => item.id === id) || null;
}

function plainCropDef(content) {
  return content.CROPS.find((c) => !c.distinctive) || content.CROPS[0];
}

/**
 * Chooses which seeds go in the plots for the very first "plant" tap: the
 * one distinctive/star seed, plus the plain crop repeated to fill the rest.
 * There is only ever one star seed in the slice -- every later planting
 * (REPLANT, FREE) uses plain carrot seeds.
 */
export function choosePlantingRecipe(content, numPlots = NUM_PLOTS) {
  const distinctive = content.CROPS.find((c) => c.distinctive) || content.CROPS[0];
  const plain = plainCropDef(content);
  const recipe = [distinctive.id];
  while (recipe.length < numPlots) recipe.push(plain.id);
  return recipe.slice(0, numPlots);
}

export function createGameState(now, numPlots = NUM_PLOTS) {
  return {
    version: SAVE_VERSION,
    band: null, // 'younger' | 'older', set once by a grown-up (CONTRACT.md cast/band)
    farm: farm.createFarmState(numPlots),
    basket: economy.createBasketState(),
    armor: armor.createArmorState(),
    egg: egg.createEggState(),
    collection: collection.createCollectionState(),
    goals: goals.createGoalState(),
    bookSeen: false,
    offersFilled: { crate: 0, bundle: 0 },
    createdAt: now,
    replantPlanted: 0,
    // P1 retention (CONTRACT.md section 5): Pip's gift + second egg. Old v1
    // saves predate these fields; save.js migrates them to these defaults.
    giftEarned: false,
    giftOpened: false,
    starSeeds: 0,
    freeOrderFills: 0,
    secondEgg: null,
    // P2 order board (CONTRACT.md section 5 item 3): persistent refillable
    // orders in FREE play. Created on FREE entry; old saves gain it on load.
    orderBoard: null,
  };
}

/** Fill additive P1/P2 defaults onto a loaded state (pre-P1 v1 saves stay valid). */
export function migrateRetention(state) {
  return {
    giftEarned: false,
    giftOpened: false,
    starSeeds: 0,
    freeOrderFills: 0,
    secondEgg: null,
    orderBoard: null,
    ...state,
  };
}

/**
 * The offers the FREE order board may serve, curated to what FREE play can
 * actually grow (P2 seed-economy review): Pip's crate + bundle for both
 * bands, plus the third big order for the older band. Wheat, pumpkin,
 * dewmelon, glowleaf and 4-sunberry band offers stay off the board -- the
 * slice never grows those, so surfacing them would ship impossible orders.
 * The lane requires a `band` per offer; the shell stamps it on copies while
 * the shared content stays untouched.
 */
export function boardOffers(content, band) {
  const curated = content.OFFERS
    .filter((o) => o.id === 'pip_crate' || o.id === 'pip_bundle' ||
      (band === 'older' && o.id === BIG_ORDER_OFFER_ID))
    .map((o) => ({ ...o, band }));
  return curated;
}

/**
 * Create the FREE order board once (deterministic seed, one slot per curated
 * offer). No-op before the band is known, outside FREE, or once built --
 * board fills never shrink it, the lane redraws fulfilled orders in place.
 */
export function ensureOrderBoard(state, content) {
  if (!state.band || goals.currentStep(state.goals) !== 'free') return state;
  // A later band switch rebuilds the board for the new band (2 vs 3 cards);
  // fills never shrink it, the lane redraws fulfilled orders in place.
  if (state.orderBoard && state.orderBoard.band === state.band) return state;
  const curated = boardOffers(content, state.band);
  if (!curated.length) return state;
  return {
    ...state,
    orderBoard: orderBoard.createOrderBoard({ offers: curated, band: state.band, seed: BOARD_SEED, slots: curated.length }),
  };
}

/** The board's open orders with content text, or [] before FREE play. */
export function openBoardOrders(state, content) {
  if (!state.orderBoard) return [];
  return orderBoard.getOpenOrders(state.orderBoard, boardOffers(content, state.orderBoard.band));
}

/** A grown-up picks the band once at the start; the economy never changes, only presentation. */
export function setBand(state, band) {
  if (band !== 'younger' && band !== 'older') return state;
  return { ...state, band };
}

/**
 * On a genuine return visit, exactly one ripe "volunteer" carrot appears in
 * the first empty plot -- but only once the player is past the very first
 * planting (CONTRACT.md section 4 "Returning..."/section 8 "Return"). A save
 * made before ever planting gets none, and we never add more than one.
 */
export function applyVolunteerCarrots(state, content, now) {
  if (goals.isStep(state.goals, 'plant') || !farm.allPlotsEmpty(state.farm)) return state;
  const carrotDef = plainCropDef(content);
  if (!carrotDef) return state;
  const emptyIndex = state.farm.plots.findIndex((p) => !p.cropId);
  if (emptyIndex === -1) return state;
  const plantedAt = now - carrotDef.growSeconds * 1000 - 1000;
  const farmState = farm.plantSeed(state.farm, emptyIndex, carrotDef.id, plantedAt);
  return { ...state, farm: farmState };
}

// -- Derived / read helpers ---------------------------------------------

export function getGrowthProgress(state, content, plotIndex, now) {
  const plot = state.farm.plots[plotIndex];
  const cropDef = plot.cropId ? findById(content.CROPS, plot.cropId) : null;
  return farm.getGrowthProgress(plot, cropDef, now);
}

export function readyPlotIndexes(state, content, now) {
  const byId = cropsById(content);
  return farm.readyPlotIndexes(state.farm, byId, now);
}

export function unwateredGrowingPlotIndexes(state, content, now) {
  const byId = cropsById(content);
  return farm.unwateredGrowingPlotIndexes(state.farm, byId, now);
}

/**
 * The goal chip's text + the on-screen target for the arrow, computed with
 * full context (unlike a bare step id) so GROW/HARVEST/REPLANT can point at
 * whichever specific plot needs attention right now.
 * targetKey: 'plot' | 'sprout' | 'ripeCrop' | 'market' | 'mannequin' | 'egg'
 *          | 'nameDialog' | 'book' | 'creature' | null
 */
export function currentGoal(state, content, now) {
  const step = goals.currentStep(state.goals);
  switch (step) {
    case 'plant':
      return { step, text: state.farm.plots.some((p) => p.cropId) ? 'Plant all 3 seeds' : 'Plant a seed', targetKey: 'plot', plotIndex: state.farm.plots.findIndex((p) => !p.cropId) };

    case 'grow': {
      const unwatered = unwateredGrowingPlotIndexes(state, content, now);
      if (unwatered.length) return { step, text: 'Water your sprouts', targetKey: 'sprout', plotIndex: unwatered[0] };
      return { step, text: 'Your crops are growing...', targetKey: 'sprout', plotIndex: state.farm.plots.findIndex((p) => p.cropId) };
    }

    case 'harvest': {
      const ready = readyPlotIndexes(state, content, now);
      if (ready.length) return { step, text: 'Pick your crops', targetKey: 'ripeCrop', plotIndex: ready[0] };
      return { step, text: 'Your crops are growing...', targetKey: 'sprout', plotIndex: state.farm.plots.findIndex((p) => p.cropId) };
    }

    case 'market':
      return { step, text: 'Go to the market', targetKey: 'market' };

    case 'offer':
      return { step, text: 'Pick a deal', targetKey: 'market' };

    case 'armor':
      return { step, text: 'Buy the helmet', targetKey: 'mannequin' };

    case 'hatch':
      return { step, text: 'Tap the egg!', targetKey: 'egg' };

    case 'name':
      return { step, text: 'Name your creature', targetKey: 'nameDialog' };

    case 'book':
      return { step, text: 'Open your book', targetKey: 'book' };

    case 'feed':
      return { step, text: 'Feed Sprout a sunberry', targetKey: 'creature' };

    case 'replant': {
      if (!farm.allPlotsEmpty(state.farm)) {
        const empty = state.farm.plots.findIndex((p) => !p.cropId);
        if ((state.replantPlanted || 0) < 3 && empty >= 0) return { step, text: 'Plant all 3 carrots', targetKey: 'plot', plotIndex: empty };
        const ready = readyPlotIndexes(state, content, now);
        if (ready.length) return { step, text: 'Pick your crops', targetKey: 'ripeCrop', plotIndex: ready[0] };
        const unwatered = unwateredGrowingPlotIndexes(state, content, now);
        if (unwatered.length) return { step, text: 'Water your sprouts', targetKey: 'sprout', plotIndex: unwatered[0] };
        return { step, text: 'Your crops are growing...', targetKey: 'sprout', plotIndex: state.farm.plots.findIndex((p) => p.cropId) };
      }
      return { step, text: 'Plant again', targetKey: 'plot', plotIndex: state.farm.plots.findIndex((p) => !p.cropId) };
    }

    case 'free':
    default: {
      // Retention novelties first: an unopened gift, then the Leaf egg.
      if (state.giftEarned && !state.giftOpened) {
        return { step, text: 'Pip has a gift for you!', targetKey: 'market' };
      }
      if (state.secondEgg && !state.secondEgg.hatched) {
        return { step, text: 'Tap the Leaf egg!', targetKey: 'egg2' };
      }
      // Always an obvious next step: only send the child to Pip when a
      // board order can actually be filled; otherwise pick, plant or wait.
      // (Board-aware once FREE opens it, so unreachable band-catalog offers
      // can never summon the arrow; legacy boardless states keep the old check.)
      const fillable = state.orderBoard
        ? openBoardOrders(state, content).some((o) => economy.canFulfillOffer(state.basket, o))
        : content.OFFERS.some((o) => economy.canFulfillOffer(state.basket, o));
      if (fillable) {
        return { step, text: 'Pip wants more carrots', targetKey: 'market' };
      }
      const ready = readyPlotIndexes(state, content, now);
      if (ready.length) return { step, text: 'Pick your crops', targetKey: 'ripeCrop', plotIndex: ready[0] };
      const empty = state.farm.plots.findIndex((p) => !p.cropId);
      if (empty >= 0) {
        if ((state.starSeeds || 0) > 0) return { step, text: 'Plant your star seed!', targetKey: 'plot', plotIndex: empty };
        return { step, text: 'Plant more carrots', targetKey: 'plot', plotIndex: empty };
      }
      const unwatered = unwateredGrowingPlotIndexes(state, content, now);
      if (unwatered.length) return { step, text: 'Water your sprouts', targetKey: 'sprout', plotIndex: unwatered[0] };
      // Every plot is planted and watered: the shortest wait in the slice
      // (at most half a crop's grow time). Point at the most-grown plot.
      const byId = cropsById(content);
      const soonest = state.farm.plots
        .map((p, i) => ({ i, progress: farm.getGrowthProgress(p, byId.get(p.cropId), now) }))
        .sort((a, b) => b.progress - a.progress)[0].i;
      return { step, text: 'Your crops are growing...', targetKey: 'sprout', plotIndex: soonest };
    }
  }
}

/** The next armor piece standing on the market mannequin, or null once every piece is owned. */
export function nextArmorForSale(state, content) {
  return content.ARMOR.find((a) => !state.armor.owned.includes(a.id)) || null;
}

/** All armor pieces currently equipped, resolved to their content defs (for the renderer). */
export function equippedArmorDefs(state, content) {
  const defs = {};
  for (const [slot, armorId] of Object.entries(state.armor.equipped)) {
    if (armorId) defs[slot] = findById(content.ARMOR, armorId);
  }
  return defs;
}

// -- Actions --------------------------------------------------------------

/**
 * Seeds still plantable right now in FREE play: unlimited carrots plus one
 * slot per gifted star seed (CONTRACT.md section 5: the gift's star seed is
 * the only non-carrot seed past 10:00, so the crest stays reachable without
 * changing the first tray or the REPLANT carrot beat).
 */
export function freeRemainingSeeds(state) {
  const empty = state.farm.plots.filter((p) => !p.cropId).length;
  const seeds = new Array(empty).fill('carrot');
  const stars = Math.min(state.starSeeds || 0, empty);
  for (let i = 0; i < stars; i++) seeds[i] = 'sunberry';
  return seeds;
}

/** Plant one selected seed in one empty hole. The first tray has two carrots and one star seed. */
export function plantPlot(state, content, plotIndex, cropId, now) {
  const step = goals.currentStep(state.goals);
  if (!['plant', 'replant', 'free'].includes(step)) return { state, planted: false };
  if (step === 'free') {
    if (cropId !== 'carrot' && cropId !== 'sunberry') return { state, planted: false };
    if (cropId === 'sunberry' && (state.starSeeds || 0) < 1) return { state, planted: false };
    const farmState = farm.plantSeed(state.farm, plotIndex, cropId, now);
    if (farmState === state.farm) return { state, planted: false };
    const next = { ...state, farm: farmState };
    if (cropId === 'sunberry') next.starSeeds = (state.starSeeds || 0) - 1;
    return { state: next, planted: true };
  }
  const allowed = step === 'plant'
    ? choosePlantingRecipe(content, state.farm.plots.length)
    : new Array(state.farm.plots.length).fill('carrot');
  const used = state.farm.plots.filter((p) => p.cropId).map((p) => p.cropId);
  const remaining = allowed.filter((id) => used.filter((v) => v === id).length < allowed.filter((v) => v === id).length);
  if (!remaining.includes(cropId)) return { state, planted: false };
  const farmState = farm.plantSeed(state.farm, plotIndex, cropId, now);
  if (farmState === state.farm) return { state, planted: false };
  let next = { ...state, farm: farmState };
  if (step === 'replant') next.replantPlanted = (state.replantPlanted || 0) + 1;
  if (step === 'plant' && farmState.plots.every((p) => p.cropId)) {
    next = { ...next, egg: egg.addCrack(next.egg), goals: goals.advanceGoal(next.goals) };
  }
  return { state: next, planted: true };
}

/** Water an unwatered, still-growing plot: halves its remaining grow time, once per crop. Optional, never gates anything. */
export function waterPlot(state, content, plotIndex, now) {
  const plot = state.farm.plots[plotIndex];
  const cropDef = plot && plot.cropId ? findById(content.CROPS, plot.cropId) : null;
  if (!cropDef) return { state, success: false };
  const farmState = farm.waterPlot(state.farm, plotIndex, cropDef, now);
  if (farmState === state.farm) return { state, success: false };
  return { state: { ...state, farm: farmState }, success: true };
}

/**
 * Time-gated transitions that aren't triggered by a discrete tap: GROW exits
 * the moment any crop becomes ripe (CONTRACT.md: "GROW | Any crop is ripe |
 * none"). Call this whenever `now` moves forward (e.g. every render tick) so
 * the goal chip flips the instant a crop ripens, even with no interaction.
 */
export function checkTimeGates(state, content, now) {
  if (goals.isStep(state.goals, 'grow') && readyPlotIndexes(state, content, now).length > 0) {
    return { ...state, goals: goals.advanceGoal(state.goals) }; // GROW -> HARVEST, no crack
  }
  return state;
}

/** Tap a single ripe crop to pop it into the basket. HARVEST/REPLANT only exit once every plot is empty. */
export function harvestPlot(state, content, plotIndex, now) {
  state = checkTimeGates(state, content, now);
  const byId = cropsById(content);
  const { farmState, harvestedCropId } = farm.harvestPlot(state.farm, plotIndex, byId, now);
  if (!harvestedCropId) return { state, harvestedCropId: null };

  const harvestedDef = findById(content.CROPS, harvestedCropId);
  const qty = (harvestedDef && harvestedDef.yield) || 1;
  let next = { ...state, farm: farmState, basket: economy.addCrop(state.basket, harvestedCropId, qty) };

  if (harvestedDef && harvestedDef.distinctive) {
    next = { ...next, egg: egg.setElementHint(next.egg, harvestedDef.element) };
  }

  const step = goals.currentStep(state.goals);
  if (step === 'harvest' && farm.allPlotsEmpty(farmState)) {
    next = { ...next, egg: egg.addCrack(next.egg), goals: goals.advanceGoal(next.goals) }; // HARVEST -> MARKET, crack 2
  } else if (step === 'replant' && (state.replantPlanted || 0) >= 3 && farm.allPlotsEmpty(farmState)) {
    next = { ...next, goals: goals.advanceGoal(next.goals) }; // REPLANT -> FREE, no crack
    next = ensureOrderBoard(next, content); // the persistent board opens with FREE play
  }
  return { state: next, harvestedCropId };
}

/** Opening the market stall is itself the MARKET step's exit condition ("the stall is open"). */
export function openMarket(state) {
  if (goals.isStep(state.goals, 'market')) {
    return { ...state, goals: goals.advanceGoal(state.goals) }; // MARKET -> OFFER, no crack
  }
  return state;
}

/**
 * "If the player leaves the stall mid-goal, the chip reverts to 'Go to the
 * market'" (CONTRACT.md section 4). Call this whenever the market panel
 * closes (including a fresh boot after a reload mid-visit) while the goal is
 * still OFFER or ARMOR.
 */
export function revertMarketGoal(state) {
  return state; // Closing the panel changes the chip, not completed progress.
}

/** During the first path, commit one chosen deal; later FREE play can refill both. */
export function canFulfillOffer(state, offerDef) {
  return ['offer', 'free'].includes(goals.currentStep(state.goals)) && economy.canFulfillOffer(state.basket, offerDef);
}

/**
 * Count one FREE order fill toward Pip's gift (CONTRACT.md section 5 item 2:
 * 2 more FREE fills earn one plantable star seed plus a ready (ungated) Leaf
 * second egg). Granted exactly once; the gift dialog is announcement-only.
 * Shared by direct and board fills so both count identically.
 */
function applyFreeFillReward(state) {
  const fills = (state.freeOrderFills || 0) + 1;
  let next = { ...state, freeOrderFills: fills };
  if (fills >= GIFT_FILLS_REQUIRED && !state.giftEarned) {
    next = {
      ...next,
      giftEarned: true,
      starSeeds: (state.starSeeds || 0) + 1,
      secondEgg: {
        cracks: 0,
        maxCracks: egg.MAX_CRACKS,
        readyToHatch: true,
        hatchTaps: 0,
        requiredHatchTaps: egg.REQUIRED_HATCH_TAPS,
        hatched: false,
        elementHint: SECOND_EGG_ELEMENT,
        hatchedCreatureId: null,
      },
    };
  }
  return next;
}

function offersFilledKey(offerId) {
  if (offerId === 'pip_crate') return 'crate';
  if (offerId === 'pip_bundle') return 'bundle';
  if (offerId === BIG_ORDER_OFFER_ID) return 'big';
  return null;
}

/**
 * Fill one open board order by its instance id. The lane spends the crops
 * and redraws the board (persistent refillable orders, never expiring); the
 * shell adds the coins and applies the same FREE-fill counting as a direct
 * fill. Lane errors (unknown or unfillable order) are safe no-ops.
 */
export function fulfillBoardOrder(state, content, orderId, now) {
  if (goals.currentStep(state.goals) !== 'free' || !state.orderBoard) return { state, success: false };
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
  const key = offersFilledKey(filled.fulfilledOfferId);
  let next = {
    ...state,
    orderBoard: filled.board,
    basket: { ...state.basket, crops: filled.inventory, coins: state.basket.coins + filled.coinsEarned },
    offersFilled: key
      ? { ...state.offersFilled, [key]: (state.offersFilled?.[key] || 0) + 1 } : state.offersFilled,
  };
  next = applyFreeFillReward(next);
  return { state: next, success: true, fulfilledOfferId: filled.fulfilledOfferId, coinsEarned: filled.coinsEarned };
}

/** Fulfil a market offer. Never punishes a short/wrong pick -- a failed attempt changes nothing. */
export function fulfillOffer(state, content, offerId, now) {
  // In FREE play with a board, route through the matching open order so the
  // board and the basket stay consistent (one code path for coins/gifts).
  if (goals.isStep(state.goals, 'free') && state.orderBoard) {
    const open = openBoardOrders(state, content).find((o) => o.offerId === offerId);
    if (open) return fulfillBoardOrder(state, content, open.id, now);
  }
  const offerDef = findById(content.OFFERS, offerId);
  if (!offerDef || !canFulfillOffer(state, offerDef)) return { state, success: false };

  const { basketState, success } = economy.fulfillOffer(state.basket, offerDef);
  if (!success) return { state, success: false };

  const key = offersFilledKey(offerId);
  let next = { ...state, basket: basketState, offersFilled: key
    ? { ...state.offersFilled, [key]: (state.offersFilled?.[key] || 0) + 1 } : state.offersFilled };
  if (goals.isStep(state.goals, 'offer')) {
    next = { ...next, egg: egg.addCrack(next.egg), goals: goals.advanceGoal(next.goals) }; // OFFER -> ARMOR, crack 3
  } else if (goals.isStep(state.goals, 'free')) {
    next = applyFreeFillReward(next);
    next = ensureOrderBoard(next, content); // boardless FREE states gain the board on first fill
  }
  return { state: next, success: true };
}

/** The gift dialog was opened and its contents announced; the grant itself happened at earn time. */
export function openGift(state) {
  if (!state.giftEarned || state.giftOpened) return state;
  return { ...state, giftOpened: true };
}

/** True once the first creature has been fed SUN_CREST_FEDS sunberries: its sun crest blooms. */
export function hasSunCrest(state) {
  const id = state.egg.hatchedCreatureId;
  return !!id && (state.collection.fed?.[id] || 0) >= SUN_CREST_FEDS;
}

/** The creature the Leaf egg would hatch into right now, or null once hatched (or before the gift). */
export function nextSecondHatchCreatureId(state, content) {
  if (!state.secondEgg || state.secondEgg.hatched) return null;
  return egg.pickCreature(state.secondEgg, content.CREATURES)?.id ?? null;
}

/**
 * One child tap on the Leaf egg. Ungated like the first hatch: the first
 * `requiredHatchTaps - 1` taps only add drama, the last hatches it and files
 * the creature in the collection. Safe no-op before the gift or after hatching.
 */
export function tapSecondEgg(state, content, now) {
  if (!state.secondEgg || state.secondEgg.hatched) {
    return { state, hatchedCreatureId: null, hatched: false };
  }
  const { eggState, hatchedCreatureId, hatched } = egg.tapEgg(state.secondEgg, content.CREATURES);
  let next = { ...state, secondEgg: eggState };
  if (hatched) {
    next = { ...next, collection: collection.discoverCreature(next.collection, hatchedCreatureId) };
  }
  return { state: next, hatchedCreatureId, hatched };
}

/** Buy + immediately equip armor from the mannequin. */
export function buyArmor(state, content, armorId, now) {
  const armorDef = findById(content.ARMOR, armorId);
  if (!armorDef) return { state, success: false };

  const { armorState, basketState, success } = armor.buyArmor(state.armor, state.basket, armorDef);
  if (!success) return { state, success: false };

  let next = { ...state, armor: armorState, basket: basketState };
  if (goals.isStep(state.goals, 'armor')) {
    next = { ...next, egg: egg.addCrack(next.egg), goals: goals.advanceGoal(next.goals) }; // ARMOR -> HATCH, crack 4 (READY)
  }
  return { state: next, success: true };
}

/** The creature the egg would hatch into right now, or null once hatched (lets the renderer fetch just that one). */
export function nextHatchCreatureId(state, content) {
  if (state.egg.hatched) return null;
  return egg.pickCreature(state.egg, content.CREATURES)?.id ?? null;
}

/**
 * One child tap on a ready egg. No question gate, ever -- just
 * `egg.REQUIRED_HATCH_TAPS` (3) taps of rising drama, the last of which
 * actually hatches it. Safe no-op before the egg is ready or after hatching.
 */
export function tapEgg(state, content, now) {
  const { eggState, hatchedCreatureId, hatched } = egg.tapEgg(state.egg, content.CREATURES);
  let next = { ...state, egg: eggState };
  if (!hatched) return { state: next, hatchedCreatureId: null, hatched: false };

  next = {
    ...next,
    collection: collection.discoverCreature(next.collection, hatchedCreatureId),
  };
  if (goals.isStep(state.goals, 'hatch')) {
    next = { ...next, goals: goals.advanceGoal(next.goals) }; // HATCH -> NAME
  }
  return { state: next, hatchedCreatureId, hatched: true };
}

/** Name the hatchling. Advances into the BOOK beat. */
export function nameCreature(state, content, name, now) {
  if (!state.egg.hatchedCreatureId) return { state, success: false };
  return nameCreatureById(state, content, state.egg.hatchedCreatureId, name, now);
}

/**
 * Name any discovered creature (the first hatchling or a later one). Only
 * naming the first hatchling during the NAME beat advances the goal machine;
 * later namings just file the name.
 */
export function nameCreatureById(state, content, creatureId, name, now) {
  if (!creatureId || !collection.isDiscovered(state.collection, creatureId)) return { state, success: false };
  const collectionState = collection.nameCreature(state.collection, creatureId, name);
  if (collectionState === state.collection) return { state, success: false };
  let next = { ...state, collection: collectionState };
  if (goals.isStep(state.goals, 'name') && creatureId === state.egg.hatchedCreatureId) {
    next = { ...next, goals: goals.advanceGoal(next.goals) }; // NAME -> BOOK
  }
  return { state: next, success: true };
}

/** BOOK exits "when the book is closed" -- call this whenever the collection book panel is closed. */
export function closeBook(state) {
  let next = { ...state, bookSeen: true };
  if (goals.isStep(state.goals, 'book')) {
    next = { ...next, goals: goals.advanceGoal(next.goals) }; // BOOK -> FEED
  }
  return next;
}

/**
 * Feed the hatchling a sunberry. Purely a gentle, ungated counter -- there is
 * no fail state, it just requires having a sunberry in the basket.
 */
export function feedSunberry(state, content, now) {
  const creatureId = state.egg.hatchedCreatureId;
  if (!creatureId || !['feed', 'free'].includes(goals.currentStep(state.goals))) return { state, success: false };
  const sunberryDef = content.CROPS.find((c) => c.distinctive) || content.CROPS.find((c) => c.id === 'sunberry');
  const cropId = sunberryDef ? sunberryDef.id : 'sunberry';
  if (economy.countOf(state.basket, cropId) < 1) return { state, success: false };

  const basket = economy.addCrop(state.basket, cropId, -1);
  const collectionState = collection.feedCreature(state.collection, creatureId);
  let next = { ...state, basket, collection: collectionState };
  if (goals.isStep(state.goals, 'feed')) {
    next = { ...next, goals: goals.advanceGoal(next.goals) }; // FEED -> REPLANT
  }
  return { state: next, success: true };
}
