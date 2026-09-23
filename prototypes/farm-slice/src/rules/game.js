// The game "engine": pure functions that combine the smaller rule modules
// into one top-level state object and one set of player actions. No
// three.js, no DOM -- this is the module that gets unit-tested and is the
// one that could port to Unity later. All actions take an explicit `now`
// (epoch ms) rather than reading the clock themselves, so growth timing is
// fully testable and correct across save/reload.

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

/**
 * Chooses which seeds go in the plots for the single "plant" tap: the first
 * distinctive crop, plus the first plain crop repeated to fill the rest.
 * Falls back gracefully if content only defines one crop.
 */
export function choosePlantingRecipe(content, numPlots = NUM_PLOTS) {
  const distinctive = content.CROPS.find((c) => c.distinctive) || content.CROPS[0];
  const plain = content.CROPS.find((c) => !c.distinctive) || content.CROPS[0];
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
    createdAt: now,
  };
}

/** A grown-up picks the band once at the start; the economy never changes, only presentation. */
export function setBand(state, band) {
  if (band !== 'younger' && band !== 'older') return state;
  return { ...state, band };
}

/**
 * On a genuine return visit (not a brand-new game), any plot left empty gets
 * one ripe "volunteer" carrot so the hatch/harvest moment is never lost to
 * an empty diorama. Per CONTRACT.md section 4 "Returning after 1 hour or 1
 * week". Never call this for a freshly created game.
 */
export function applyVolunteerCarrots(state, content, now) {
  const carrotDef = content.CROPS.find((c) => !c.distinctive) || content.CROPS[0];
  if (!carrotDef) return state;
  let farmState = state.farm;
  state.farm.plots.forEach((plot, i) => {
    if (!plot.cropId) {
      const plantedAt = now - carrotDef.growSeconds * 1000 - 1000;
      farmState = farm.plantSeed(farmState, i, carrotDef.id, plantedAt);
    }
  });
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

export function currentGoal(state) {
  return goals.describeGoal(state.goals);
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

/** Beat 2: a single tap on the (empty) plot plants the whole recipe. */
export function plantAll(state, content, now) {
  const recipe = choosePlantingRecipe(content, state.farm.plots.length);
  const { farmState, planted } = farm.plantSeeds(state.farm, recipe, now);
  if (planted.length === 0) return { state, planted };

  let next = { ...state, farm: farmState };
  if (goals.isStep(state.goals, 'plant')) {
    next = {
      ...next,
      egg: egg.addCrack(next.egg),
      goals: goals.advanceGoal(next.goals),
    };
  }
  return { state: next, planted };
}

/** Beat 3: tap a single ripe crop to pop it into the basket. */
export function harvestPlot(state, content, plotIndex, now) {
  const byId = cropsById(content);
  const { farmState, harvestedCropId } = farm.harvestPlot(state.farm, plotIndex, byId, now);
  if (!harvestedCropId) return { state, harvestedCropId: null };

  const harvestedDef = findById(content.CROPS, harvestedCropId);
  const qty = (harvestedDef && harvestedDef.yield) || 1;
  let next = { ...state, farm: farmState, basket: economy.addCrop(state.basket, harvestedCropId, qty) };

  if (harvestedDef && harvestedDef.distinctive) {
    next = { ...next, egg: egg.setElementHint(next.egg, harvestedDef.element) };
  }

  if (goals.isStep(state.goals, 'harvest')) {
    next = { ...next, egg: egg.addCrack(next.egg), goals: goals.advanceGoal(next.goals) };
  }
  return { state: next, harvestedCropId };
}

/** Beat 4: fulfil a market offer. Never punishes a short/wrong pick. */
export function fulfillOffer(state, content, offerId, now) {
  const offerDef = findById(content.OFFERS, offerId);
  if (!offerDef) return { state, success: false };

  const { basketState, success } = economy.fulfillOffer(state.basket, offerDef);
  if (!success) return { state, success: false };

  let next = { ...state, basket: basketState };
  if (goals.isStep(state.goals, 'market')) {
    next = { ...next, egg: egg.addCrack(next.egg), goals: goals.advanceGoal(next.goals) };
  }
  return { state: next, success: true };
}

/** Beat 5: buy + immediately equip armor from the mannequin. */
export function buyArmor(state, content, armorId, now) {
  const armorDef = findById(content.ARMOR, armorId);
  if (!armorDef) return { state, success: false };

  const { armorState, basketState, success } = armor.buyArmor(state.armor, state.basket, armorDef);
  if (!success) return { state, success: false };

  let next = { ...state, armor: armorState, basket: basketState };
  if (goals.isStep(state.goals, 'armor')) {
    next = { ...next, egg: egg.addCrack(next.egg), goals: goals.advanceGoal(next.goals) };
  }
  return { state: next, success: true };
}

/**
 * Beat 6: one child tap on a ready egg. No question gate, ever -- just
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
    next = { ...next, goals: goals.advanceGoal(next.goals) };
  }
  return { state: next, hatchedCreatureId, hatched: true };
}

/** Beat 6 (cont'd): name the hatchling. Advances into the loop-tease beat. */
export function nameCreature(state, content, name, now) {
  if (!state.egg.hatchedCreatureId) return { state, success: false };
  const collectionState = collection.nameCreature(state.collection, state.egg.hatchedCreatureId, name);
  let next = { ...state, collection: collectionState };
  if (goals.isStep(state.goals, 'name')) {
    next = { ...next, goals: goals.advanceGoal(next.goals) };
  }
  return { state: next, success: true };
}

/**
 * Loop tease (CONTRACT.md 5.1 / brief beat 7): feed the hatchling a
 * sunberry. Purely a gentle, ungated counter -- there is no fail state, it
 * just requires having a sunberry in the basket.
 */
export function feedSunberry(state, content, now) {
  const creatureId = state.egg.hatchedCreatureId;
  if (!creatureId) return { state, success: false };
  const sunberryDef = content.CROPS.find((c) => c.distinctive) || content.CROPS.find((c) => c.id === 'sunberry');
  const cropId = sunberryDef ? sunberryDef.id : 'sunberry';
  if (economy.countOf(state.basket, cropId) < 1) return { state, success: false };

  const basket = economy.addCrop(state.basket, cropId, -1);
  const collectionState = collection.feedCreature(state.collection, creatureId);
  return { state: { ...state, basket, collection: collectionState }, success: true };
}
