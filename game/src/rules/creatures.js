// Eggs hatching, naming, feeding and growth. Pure, no DOM.
import * as economy from './economy.js';
import * as egg from './egg.js';
import * as collection from './collection.js';
import { findById, findEgg, replaceEgg, starterEgg, STARTER_EGG_ID } from './state.js';
import { step, completeStep } from './progress.js';

/** The creature an egg will hatch into: a fixed one, else the first matching its element. */
export function hatchCreatureId(eggState, content) {
  if (eggState.hatched) return null;
  if (eggState.creatureId) return eggState.creatureId;
  return egg.pickCreature(eggState, content.CREATURES)?.id ?? null;
}

/** Eggs still waiting to hatch. */
export function unhatchedEggs(state) {
  return state.eggs.filter((e) => !e.hatched);
}

/**
 * One child tap on an egg. The last of its hatch taps hatches it and adds the creature to
 * the collection. Never gated by a question. Unready, hatched or unknown eggs are no-ops.
 */
export function tapEgg(state, content, eggId = STARTER_EGG_ID) {
  const target = findEgg(state, eggId);
  if (!target) return { state, hatchedCreatureId: null, hatched: false };
  const creatures = target.creatureId
    ? [findById(content.CREATURES, target.creatureId)].filter(Boolean)
    : content.CREATURES;
  const { eggState, hatchedCreatureId, hatched } = egg.tapEgg(target, creatures);
  if (eggState === target) return { state, hatchedCreatureId: null, hatched: false };
  let next = replaceEgg(state, eggState);
  if (!hatched) return { state: next, hatchedCreatureId: null, hatched: false };
  next = { ...next, collection: collection.discoverCreature(next.collection, hatchedCreatureId) };
  if (eggId === STARTER_EGG_ID) next = completeStep(next, 'hatch');
  return { state: next, hatchedCreatureId, hatched: true };
}

/** The creature that hatched from the starter egg, or null. */
export function firstCreatureId(state) {
  return starterEgg(state).hatchedCreatureId;
}

/** Hatched creatures in hatch order, with the egg they came from. */
export function hatchedCreatures(state) {
  return state.eggs.filter((e) => e.hatched && e.hatchedCreatureId)
    .map((e) => ({ eggId: e.id, creatureId: e.hatchedCreatureId }));
}

/** Name any owned creature. Naming the first hatchling completes the NAME step. */
export function nameCreatureById(state, content, creatureId, name) {
  if (!creatureId || !collection.isDiscovered(state.collection, creatureId)) return { state, success: false };
  const collectionState = collection.nameCreature(state.collection, creatureId, name);
  if (collectionState === state.collection) return { state, success: false };
  let next = { ...state, collection: collectionState };
  if (creatureId === firstCreatureId(state)) next = completeStep(next, 'name');
  return { state: next, success: true };
}

export function nameCreature(state, content, name) {
  return nameCreatureById(state, content, firstCreatureId(state), name);
}

/** Closing the collection book completes the BOOK step. */
export function closeBook(state) {
  return completeStep({ ...state, bookSeen: true }, 'book');
}

export function canFeed(state, content) {
  return ['feed', 'free'].includes(step(state)) && economy.countOf(state.basket, content.FEEDING.food) > 0;
}

/** Feed a creature (default: the first hatchling) one piece of content.FEEDING.food. */
export function feedCreature(state, content, creatureId = firstCreatureId(state)) {
  if (!creatureId || !collection.isDiscovered(state.collection, creatureId) || !canFeed(state, content)) {
    return { state, success: false };
  }
  const basket = economy.addCrop(state.basket, content.FEEDING.food, -1);
  let next = { ...state, basket, collection: collection.feedCreature(state.collection, creatureId) };
  if (creatureId === firstCreatureId(state)) next = completeStep(next, 'feed');
  return { state: next, success: true };
}

/** Growth stages a creature has reached (content.FEEDING.stages), in order. */
export function growthStages(state, content, creatureId) {
  const fed = collection.getFedCount(state.collection, creatureId);
  return content.FEEDING.stages.filter((s) => fed >= s.feeds);
}

/** Adornments a creature has grown, e.g. ['sunCrest']. */
export function adornments(state, content, creatureId) {
  return growthStages(state, content, creatureId).map((s) => s.adornment).filter(Boolean);
}

/** The next growth stage for a creature, or null once fully grown. */
export function nextGrowthStage(state, content, creatureId) {
  const fed = collection.getFedCount(state.collection, creatureId);
  return content.FEEDING.stages.find((s) => fed < s.feeds) || null;
}
