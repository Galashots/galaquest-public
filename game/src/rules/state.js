// The game state shape, new-game creation, and save migrations. Pure: no DOM, no three.js.
//
// State (version 2):
//   band            'younger' | 'older' | null   set once by a grown-up
//   farm            { plots: [{ cropId, plantedAt, watered, ... }] }
//   basket          { crops: { [cropId]: n }, coins }
//   seeds           { [cropId]: n }   limited seeds in the sack (free seeds never run out)
//   armor           { owned: [id], equipped: { slot: id } }
//   eggs            [egg]             eggs[0] is the starter egg; rewards and breeding add more
//   collection      { owned, names, fed }   keyed by creature id
//   goals           { stepIndex }     position in content.TUTORIAL
//   rewards         { earned: [id], seen: [id] }
//   decorations     [id]              farm decorations earned (content.REWARDS grant.decoration)
//   offersFilled    { [offerId]: n }
//   freeOrderFills  orders filled in free play
//   orderBoard      the free-play order board (src/depth/orders.js), or null
//   breeding        { seed, made }   bred eggs are entries in `eggs` (see breeding.js)
//   helpAlong       help-along question state (src/depth/help-along.js)
import * as farm from './farm.js';
import * as economy from './economy.js';
import * as armor from './armor.js';
import * as egg from './egg.js';
import * as collection from './collection.js';
import * as goals from './goals.js';

export const SAVE_VERSION = 2;
export const NUM_PLOTS = 3;
export const STARTER_EGG_ID = 'starter';

export function createEgg({ id, element = null, creatureId = null, label = null, ready = false } = {}) {
  return {
    ...egg.createEggState(),
    id,
    label,
    creatureId,
    elementHint: element,
    readyToHatch: ready,
  };
}

export function createGameState(now, numPlots = NUM_PLOTS) {
  return {
    version: SAVE_VERSION,
    band: null,
    createdAt: now,
    farm: farm.createFarmState(numPlots),
    basket: economy.createBasketState(),
    seeds: {},
    armor: armor.createArmorState(),
    eggs: [createEgg({ id: STARTER_EGG_ID })],
    collection: collection.createCollectionState(),
    goals: goals.createGoalState(),
    rewards: { earned: [], seen: [] },
    decorations: [],
    bookSeen: false,
    offersFilled: {},
    replantPlanted: 0,
    freeOrderFills: 0,
    orderBoard: null,
    breeding: { seed: (now >>> 0) || 1, made: 0 },
    helpAlong: {},
  };
}

const V1_OFFER_KEYS = { crate: 'pip_crate', bundle: 'pip_bundle', big: 'pip_big_order' };

/** Version 1 (single `egg` + `secondEgg`, gift booleans, `starSeeds`) to version 2. */
export function migrateV1(old) {
  const {
    egg: starter, secondEgg, starSeeds, giftEarned, giftOpened, offersFilled, ...rest
  } = old;
  const eggs = [{ ...egg.createEggState(), ...starter, id: STARTER_EGG_ID, label: null, creatureId: null }];
  if (secondEgg) {
    eggs.push({
      ...egg.createEggState(),
      ...secondEgg,
      id: 'pip_gift',
      label: 'Leaf egg',
      creatureId: secondEgg.hatchedCreatureId || 'mossbun',
    });
  }
  const filled = {};
  for (const [key, count] of Object.entries(offersFilled || {})) filled[V1_OFFER_KEYS[key] || key] = count;
  return {
    ...rest,
    version: 2,
    eggs,
    seeds: starSeeds > 0 ? { sunberry: starSeeds } : {},
    rewards: { earned: giftEarned ? ['pip_gift'] : [], seen: giftOpened ? ['pip_gift'] : [] },
    offersFilled: filled,
    freeOrderFills: rest.freeOrderFills || 0,
    orderBoard: rest.orderBoard || null,
  };
}

/** Bring any saved state up to SAVE_VERSION, or return null if it can't be read. */
export function migrateSave(saved, version) {
  if (!saved || typeof saved !== 'object') return null;
  let state = saved;
  if (version === 1) state = migrateV1(state);
  else if (version !== SAVE_VERSION) return null;
  if (!Array.isArray(state.farm?.plots) || !Number.isInteger(state.goals?.stepIndex) ||
      !Array.isArray(state.eggs) || !state.eggs.length || !state.basket || !state.collection) return null;
  // Fields added since the save was made (or missing from it) take their new-game defaults.
  const merged = { ...createGameState(state.createdAt ?? 0, state.farm.plots.length) };
  for (const [key, value] of Object.entries(state)) if (value !== undefined) merged[key] = value;
  return { ...merged, version: SAVE_VERSION };
}

/** The egg the farm started with. */
export function starterEgg(state) {
  return state.eggs[0];
}

export function findEgg(state, eggId) {
  return state.eggs.find((e) => e.id === eggId) || null;
}

export function replaceEgg(state, nextEgg) {
  return { ...state, eggs: state.eggs.map((e) => (e.id === nextEgg.id ? nextEgg : e)) };
}

export function findById(list, id) {
  return list.find((item) => item.id === id) || null;
}

export function cropsById(content) {
  return new Map(content.CROPS.map((c) => [c.id, c]));
}
