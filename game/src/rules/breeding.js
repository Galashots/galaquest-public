// Breeding: pair two creatures you own to make an egg that hatches on a timer. Pure, no DOM.
//
// A bred egg is an ordinary entry in state.eggs (see state.createEgg) plus a few fields:
//   bred, parentIds, startedAt, hatchAt, observedAt. Its creatureId is the species it will
//   hatch into, chosen when the egg is made from the odds the child was shown, using a seed in
//   state.breeding. So the result is the same after a reload and in tests. The egg is
//   `readyToHatch` once its timer is up; the child then taps it like any other egg
//   (creatures.tapEgg). Nothing is ever lost: no cost, no expiry, no fail state.
//
// The collection is keyed by species, so a child's "inheritance" is which species hatches: the
// egg takes its element from one parent and its rarity from one parent (50/50 each, shown in
// full by previewBreed), then resolves to the creature in content.BREEDING's pool that matches.
//
// State: state.breeding = { seed, made }, state.helpAlong = help-along state (src/depth).
import { previewBreeding, nextRoll } from '../depth/breeding.js';
import { getHelpOffer, answerHelpQuestion } from '../depth/help-along.js';
import { createEgg, findById } from './state.js';
import { isDiscovered } from './collection.js';
import { inFreePlay } from './progress.js';

// observedAt only moves forward, and is written at most this often so saves stay cheap.
const OBSERVE_STEP_MS = 10_000;

/** Creatures that can be a parent: every species in the collection. */
export function breedableCreatures(state, content) {
  return content.CREATURES.filter((c) => isDiscovered(state.collection, c.id));
}

/** The bred egg still waiting to hatch (growing or ready), or null. */
export function nestEggs(state) {
  return state.eggs.filter((e) => e.bred && !e.hatched);
}

export function nestFree(state, content) {
  return nestEggs(state).length < content.BREEDING.nestSlots;
}

/** Free play, a free nest slot and enough creatures owned. */
export function canBreed(state, content) {
  return inFreePlay(state) && nestFree(state, content) &&
    breedableCreatures(state, content).length >= content.BREEDING.parentsNeeded;
}

function pool(content) {
  const { elements, rarities } = content.BREEDING;
  return content.CREATURES.filter((c) => elements[c.element] && rarities.includes(c.rarity));
}

/** The pool creature for a rolled element and rarity: same element, nearest rarity (commoner on a tie). */
function resolveSpecies(element, rarity, creatures, rarities) {
  const rank = rarities.indexOf(rarity);
  const distance = (c) => Math.abs(rarities.indexOf(c.rarity) - rank);
  return creatures.filter((c) => c.element === element)
    .sort((a, b) => distance(a) - distance(b) || rarities.indexOf(a.rarity) - rarities.indexOf(b.rarity))[0] || null;
}

/**
 * The complete odds for a pair, shown before the child confirms and used to pick the hatch.
 * { element: [{value, percent}], rarity: [{value, percent}], outcomes: [{ creatureId, percent }] }
 * `outcomes` lists every creature the egg could be, most likely first; percents add up to 100.
 * Null if either parent is not a creature the child owns, or both are the same.
 */
export function previewBreed(state, content, idA, idB) {
  const a = findById(content.CREATURES, idA);
  const b = findById(content.CREATURES, idB);
  if (!a || !b || a.id === b.id || !isDiscovered(state.collection, a.id) || !isDiscovered(state.collection, b.id)) return null;
  const { element, rarity } = previewBreeding(a, b);
  const creatures = pool(content);
  const totals = new Map();
  for (const e of element) {
    for (const r of rarity) {
      const species = resolveSpecies(e.value, r.value, creatures, content.BREEDING.rarities);
      if (species) totals.set(species.id, (totals.get(species.id) || 0) + e.percent * r.percent / 100);
    }
  }
  const sum = [...totals.values()].reduce((x, y) => x + y, 0);
  if (!sum) return null;
  const order = (id) => content.CREATURES.findIndex((c) => c.id === id);
  const outcomes = [...totals].map(([creatureId, percent]) => ({ creatureId, percent: percent * 100 / sum }))
    .sort((x, y) => y.percent - x.percent || order(x.creatureId) - order(y.creatureId));
  return { element, rarity, outcomes };
}

/** Which outcome a roll in [0, 1) lands on. Exactly the shown percents. */
export function pickOutcome(outcomes, roll) {
  let edge = 0;
  for (const outcome of outcomes) {
    edge += outcome.percent;
    if (roll * 100 < edge) return outcome;
  }
  return outcomes[outcomes.length - 1];
}

/**
 * Put two parents in the nest. Needs free play, a free slot and two different owned creatures.
 * Returns { state, success, egg } with egg = the new nest egg.
 */
export function startBreeding(state, content, idA, idB, now) {
  const fail = { state, success: false, egg: null };
  if (!canBreed(state, content)) return fail;
  const odds = previewBreed(state, content, idA, idB);
  if (!odds) return fail;
  // Two steps: the first LCG output of nearby seeds is nearly the same number.
  const [seed, roll] = nextRoll(nextRoll(state.breeding.seed)[0]);
  const species = findById(content.CREATURES, pickOutcome(odds.outcomes, roll).creatureId);
  const made = state.breeding.made + 1;
  const tint = content.BREEDING.elements[species.element];
  const egg = {
    ...createEgg({ id: `bred_${made}`, element: species.element, creatureId: species.id, label: `${tint.label} egg` }),
    bred: true,
    parentIds: [idA, idB],
    startedAt: now,
    hatchAt: now + content.BREEDING.hatchSeconds * 1000,
    observedAt: now,
  };
  const next = { ...state, eggs: [...state.eggs, egg], breeding: { seed, made } };
  return { state: next, success: true, egg };
}

/** The clock the timer trusts: never earlier than the latest time already seen. */
const clock = (egg, now) => Math.max(now, egg.observedAt ?? egg.startedAt);

/** How far along a bred egg is, 0 to 1. It never goes backward, even if the device clock does. */
export function eggProgress(egg, now) {
  if (!egg.bred) return 1;
  if (egg.hatched || egg.readyToHatch) return 1;
  const span = Math.max(1, egg.hatchAt - egg.startedAt);
  return Math.min(1, Math.max(0, (clock(egg, now) - egg.startedAt) / span));
}

/**
 * Move the nest's clock on: remember the latest time seen, and make the egg ready (with its
 * shell cracked, ready for taps) once its time is up. Returns the same state if nothing changed.
 */
export function observeNest(state, now) {
  let changed = false;
  const eggs = state.eggs.map((egg) => {
    if (!egg.bred || egg.hatched) return egg;
    const seen = clock(egg, now);
    if (!egg.readyToHatch && seen >= egg.hatchAt) {
      changed = true;
      return { ...egg, observedAt: seen, readyToHatch: true, cracks: egg.maxCracks };
    }
    if (seen - (egg.observedAt ?? 0) >= OBSERVE_STEP_MS) {
      changed = true;
      return { ...egg, observedAt: seen };
    }
    return egg;
  });
  return changed ? { ...state, eggs } : state;
}

function helpTarget(state, content, egg) {
  const species = findById(content.CREATURES, egg.creatureId);
  return { id: egg.id, kind: 'egg', rarity: species?.rarity, ordinal: Number(egg.id.split('_')[1]),
    startedAt: egg.startedAt, readyAt: egg.hatchAt };
}

function helpContext(state, content, now) {
  const egg = nestEggs(state).find((e) => !e.readyToHatch);
  const grade = content.BREEDING.helpAlong.grades[state.band];
  if (!egg || !grade) return null;
  return { egg, grade, target: helpTarget(state, content, egg), questions: content.QUESTIONS,
    state: state.helpAlong || {}, now };
}

/**
 * An optional question that can shorten a growing rare egg's wait, or null. The answer is not
 * included. Asking never costs anything and nothing depends on it.
 */
export function helpAlongOffer(state, content, now) {
  const ctx = helpContext(state, content, now);
  if (!ctx) return null;
  const { offer } = getHelpOffer(ctx);
  if (!offer) return null;
  const { answerIndex, outcome, ...question } = offer;
  return { eggId: ctx.egg.id, ...question };
}

/**
 * Answer the offered question. Wrong: { correct: false, hint }, nothing changes, try again.
 * Right: the egg's timer is shortened (bounded, see help-along.js) and { correct: true, shortenedMs }.
 */
export function answerHelpAlong(state, content, choiceIndex, now) {
  const ctx = helpContext(state, content, now);
  const { offer } = ctx ? getHelpOffer(ctx) : {};
  if (!offer) return { state, correct: false, hint: null, shortenedMs: 0 };
  const result = answerHelpQuestion({ ...ctx, question: offer, choiceIndex });
  if (!result.correct) return { state, correct: false, hint: result.hint, shortenedMs: 0 };
  const egg = { ...ctx.egg, hatchAt: result.target.readyAt };
  const next = observeNest({ ...state, eggs: state.eggs.map((e) => (e.id === egg.id ? egg : e)),
    helpAlong: result.state }, now);
  return { state: next, correct: true, hint: null, shortenedMs: result.shortenedMs };
}
