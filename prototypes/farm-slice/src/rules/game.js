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

export const SAVE_VERSION = 1;
export const NUM_PLOTS = 3;

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
  };
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
      // Always an obvious next step: only send the child to Pip when a
      // crate can actually be filled; otherwise pick, plant or wait.
      if (content.OFFERS.some((o) => economy.canFulfillOffer(state.basket, o))) {
        return { step, text: 'Pip wants more carrots', targetKey: 'market' };
      }
      const ready = readyPlotIndexes(state, content, now);
      if (ready.length) return { step, text: 'Pick your crops', targetKey: 'ripeCrop', plotIndex: ready[0] };
      const empty = state.farm.plots.findIndex((p) => !p.cropId);
      if (empty >= 0) return { step, text: 'Plant more carrots', targetKey: 'plot', plotIndex: empty };
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

/** Plant one selected seed in one empty hole. The first tray has two carrots and one star seed. */
export function plantPlot(state, content, plotIndex, cropId, now) {
  const step = goals.currentStep(state.goals);
  if (!['plant', 'replant', 'free'].includes(step)) return { state, planted: false };
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

/** Fulfil a market offer. Never punishes a short/wrong pick -- a failed attempt changes nothing. */
export function fulfillOffer(state, content, offerId, now) {
  const offerDef = findById(content.OFFERS, offerId);
  if (!offerDef || !canFulfillOffer(state, offerDef)) return { state, success: false };

  const { basketState, success } = economy.fulfillOffer(state.basket, offerDef);
  if (!success) return { state, success: false };

  const key = offerId === 'pip_crate' ? 'crate' : offerId === 'pip_bundle' ? 'bundle' : null;
  let next = { ...state, basket: basketState, offersFilled: key
    ? { ...state.offersFilled, [key]: (state.offersFilled?.[key] || 0) + 1 } : state.offersFilled };
  if (goals.isStep(state.goals, 'offer')) {
    next = { ...next, egg: egg.addCrack(next.egg), goals: goals.advanceGoal(next.goals) }; // OFFER -> ARMOR, crack 3
  }
  return { state: next, success: true };
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
  const collectionState = collection.nameCreature(state.collection, state.egg.hatchedCreatureId, name);
  if (collectionState === state.collection) return { state, success: false };
  let next = { ...state, collection: collectionState };
  if (goals.isStep(state.goals, 'name')) {
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
