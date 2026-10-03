// Planting, watering and harvesting. Pure, no DOM. Every action takes an explicit `now`
// (epoch ms) so growth timing is testable and survives save/reload.
import * as farm from './farm.js';
import * as economy from './economy.js';
import * as egg from './egg.js';
import { cropsById, findById, starterEgg, replaceEgg } from './state.js';
import { step, completeStep } from './progress.js';
import { ensureOrderBoard } from './market.js';

const PLANTING_STEPS = ['plant', 'replant', 'free'];

/** The seed the sack never runs out of. */
export function freeSeedCrop(content) {
  return content.CROPS.find((c) => c.freeSeed) || content.CROPS[0];
}

/** The first tutorial tray: one star seed plus free seeds. */
export function choosePlantingRecipe(content) {
  return [...content.TUTORIAL_SEEDS.plant];
}

/**
 * Seeds the tray offers right now, one per empty plot the player may still fill.
 * Tutorial steps use the fixed recipes; free play offers limited seeds first, then free ones.
 */
export function remainingSeeds(state, content) {
  const current = step(state);
  if (!PLANTING_STEPS.includes(current)) return [];
  const empty = state.farm.plots.filter((p) => !p.cropId).length;
  if (current === 'plant') {
    const recipe = choosePlantingRecipe(content);
    for (const plot of state.farm.plots) {
      const i = recipe.indexOf(plot.cropId);
      if (i !== -1) recipe.splice(i, 1);
    }
    return recipe;
  }
  if (current === 'replant') {
    const left = Math.max(0, content.TUTORIAL_SEEDS.replant.length - (state.replantPlanted || 0));
    return content.TUTORIAL_SEEDS.replant.slice(0, Math.min(left, empty));
  }
  const limited = Object.entries(state.seeds || {}).flatMap(([id, n]) => new Array(Math.max(0, n)).fill(id));
  const seeds = limited.slice(0, empty);
  while (seeds.length < empty) seeds.push(freeSeedCrop(content).id);
  return seeds;
}

/** Plant one seed in one empty plot. Returns { state, planted }. */
export function plantPlot(state, content, plotIndex, cropId, now) {
  const current = step(state);
  if (!PLANTING_STEPS.includes(current)) return { state, planted: false };
  const cropDef = findById(content.CROPS, cropId);
  if (!cropDef) return { state, planted: false };
  if (current === 'free') {
    const limited = !cropDef.freeSeed;
    if (limited && !((state.seeds || {})[cropId] > 0)) return { state, planted: false };
    const farmState = farm.plantSeed(state.farm, plotIndex, cropId, now);
    if (farmState === state.farm) return { state, planted: false };
    const next = { ...state, farm: farmState };
    if (limited) next.seeds = { ...state.seeds, [cropId]: state.seeds[cropId] - 1 };
    return { state: next, planted: true };
  }
  if (!remainingSeeds(state, content).includes(cropId)) return { state, planted: false };
  const farmState = farm.plantSeed(state.farm, plotIndex, cropId, now);
  if (farmState === state.farm) return { state, planted: false };
  let next = { ...state, farm: farmState };
  if (current === 'replant') next.replantPlanted = (state.replantPlanted || 0) + 1;
  if (current === 'plant' && farmState.plots.every((p) => p.cropId)) next = completeStep(next, 'plant');
  return { state: next, planted: true };
}

/** Water a growing plot: halves its remaining grow time, once per crop. Never gates anything. */
export function waterPlot(state, content, plotIndex, now) {
  const plot = state.farm.plots[plotIndex];
  const cropDef = plot && plot.cropId ? findById(content.CROPS, plot.cropId) : null;
  if (!cropDef) return { state, success: false };
  const farmState = farm.waterPlot(state.farm, plotIndex, cropDef, now);
  if (farmState === state.farm) return { state, success: false };
  return { state: { ...state, farm: farmState }, success: true };
}

export function getGrowthProgress(state, content, plotIndex, now) {
  const plot = state.farm.plots[plotIndex];
  const cropDef = plot.cropId ? findById(content.CROPS, plot.cropId) : null;
  return farm.getGrowthProgress(plot, cropDef, now);
}

export function readyPlotIndexes(state, content, now) {
  return farm.readyPlotIndexes(state.farm, cropsById(content), now);
}

export function unwateredGrowingPlotIndexes(state, content, now) {
  return farm.unwateredGrowingPlotIndexes(state.farm, cropsById(content), now);
}

/** Transitions driven by time rather than a tap: GROW ends the moment any crop is ripe. */
export function checkTimeGates(state, content, now) {
  if (step(state) === 'grow' && readyPlotIndexes(state, content, now).length > 0) {
    return completeStep(state, 'grow');
  }
  return state;
}

/** Pick one ripe crop into the basket. Returns { state, harvestedCropId }. */
export function harvestPlot(state, content, plotIndex, now) {
  state = checkTimeGates(state, content, now);
  const { farmState, harvestedCropId } = farm.harvestPlot(state.farm, plotIndex, cropsById(content), now);
  if (!harvestedCropId) return { state, harvestedCropId: null };

  const def = findById(content.CROPS, harvestedCropId);
  let next = { ...state, farm: farmState, basket: economy.addCrop(state.basket, harvestedCropId, def?.yield || 1) };
  // The first special crop picked tells the starter egg what it will hatch into.
  if (def?.distinctive) next = replaceEgg(next, egg.setElementHint(starterEgg(next), def.element));

  if (farm.allPlotsEmpty(farmState)) {
    if (step(state) === 'harvest') next = completeStep(next, 'harvest');
    else if (step(state) === 'replant' && (state.replantPlanted || 0) >= content.TUTORIAL_SEEDS.replant.length) {
      next = ensureOrderBoard(completeStep(next, 'replant'), content);
    }
  }
  return { state: next, harvestedCropId };
}

/**
 * On a return visit to an empty farm, one ripe "volunteer" free crop is waiting
 * (docs/CONTRACT.md §4). Never on the very first planting, never more than one.
 */
export function applyVolunteerCarrots(state, content, now) {
  if (step(state) === 'plant' || !farm.allPlotsEmpty(state.farm)) return state;
  const crop = freeSeedCrop(content);
  const plantedAt = now - crop.growSeconds * 1000 - 1000;
  return { ...state, farm: farm.plantSeed(state.farm, 0, crop.id, plantedAt) };
}
