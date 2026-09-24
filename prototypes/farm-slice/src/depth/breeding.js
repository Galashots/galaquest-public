const TRAITS = ['element', 'shape', 'rarity'];

function choice(a, b) {
  return a === b ? [{ value: a, percent: 100 }] :
    [{ value: a, percent: 50 }, { value: b, percent: 50 }];
}

function validateParent(parent) {
  if (!parent || !parent.id || !parent.colors ||
    [...TRAITS, 'body', 'accent'].some((trait) => !(
      trait === 'body' || trait === 'accent' ? parent.colors[trait] : parent[trait]
    ))) throw new Error('Parents need owned IDs and visible traits');
}

export function previewBreeding(parentA, parentB) {
  validateParent(parentA);
  validateParent(parentB);
  if (parentA.id === parentB.id) throw new Error('Choose two different creatures');
  const odds = {
    element: choice(parentA.element, parentB.element),
    shape: choice(parentA.shape, parentB.shape),
    rarity: choice(parentA.rarity, parentB.rarity),
    bodyColor: choice(parentA.colors.body, parentB.colors.body),
    accentColor: choice(parentA.colors.accent, parentB.colors.accent),
  };
  let outcomes = [{ child: {}, percent: 100 }];
  for (const [trait, options] of Object.entries(odds)) {
    outcomes = outcomes.flatMap((outcome) => options.map((option) => ({
      child: { ...outcome.child, [trait]: option.value },
      percent: outcome.percent * option.percent / 100,
    })));
  }
  return { ...odds, outcomes };
}

function nextRoll(seed) {
  const next = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return [next, next / 4294967296];
}

export function createBreedingEgg({ parentA, parentB, ownedCreatureIds, eggId, ordinal, now,
  hatchMs, seed }) {
  const odds = previewBreeding(parentA, parentB);
  if (!Array.isArray(ownedCreatureIds) || !ownedCreatureIds.includes(parentA.id) ||
    !ownedCreatureIds.includes(parentB.id)) throw new Error('Both parents must be owned');
  if (typeof eggId !== 'string' || !eggId || !Number.isSafeInteger(ordinal) || ordinal < 1 ||
    !Number.isSafeInteger(now) || !Number.isSafeInteger(hatchMs) || hatchMs < 1 ||
    !Number.isSafeInteger(seed) || !Number.isSafeInteger(now + hatchMs)) throw new Error('Invalid egg settings');
  const traits = {};
  let cursor = seed >>> 0;
  for (const key of ['element', 'shape', 'rarity', 'bodyColor', 'accentColor']) {
    const options = odds[key];
    let roll;
    [cursor, roll] = nextRoll(cursor);
    traits[key] = options[Math.floor(roll * options.length)].value;
  }
  const egg = { id: eggId, ordinal, parentIds: [parentA.id, parentB.id],
    createdAt: now, readyAt: now + hatchMs, lastObservedAt: now, hatchedAt: null,
    child: { element: traits.element, shape: traits.shape, rarity: traits.rarity,
      colors: { body: traits.bodyColor, accent: traits.accentColor } } };
  return { egg, odds, nextSeed: cursor };
}

export function observeEgg(egg, now) {
  if (!Number.isSafeInteger(now)) throw new Error('Invalid timestamp');
  const observedAt = Math.max(egg.createdAt, egg.lastObservedAt ?? egg.createdAt, now);
  const updatedEgg = { ...egg, lastObservedAt: observedAt };
  return { egg: updatedEgg, ready: observedAt >= egg.readyAt,
    remainingMs: Math.max(0, egg.readyAt - observedAt) };
}

export function hatchEgg(egg, now) {
  if (egg.hatchedAt !== null) throw new Error('Egg already hatched');
  const observed = observeEgg(egg, now);
  if (!observed.ready) throw new Error('Egg is still growing');
  return { egg: { ...observed.egg, hatchedAt: observed.egg.lastObservedAt },
    creature: { id: `hatched-${egg.id}`, ...egg.child } };
}
