// Pure egg-cracking + hatch rules. No three.js, no DOM.
// Cracks are tied to goal completion (see goals.js), never to a timer or a
// question gate. Per CONTRACT.md section 1/8/4: the egg takes 4 goal cracks
// to become ready, then the child taps it REQUIRED_HATCH_TAPS times to
// actually hatch it (no flashing, no gate -- just a rising, playful build).

export const MAX_CRACKS = 4;
export const REQUIRED_HATCH_TAPS = 3;

export function createEggState() {
  return {
    cracks: 0,
    maxCracks: MAX_CRACKS,
    readyToHatch: false,
    hatchTaps: 0,
    requiredHatchTaps: REQUIRED_HATCH_TAPS,
    hatched: false,
    elementHint: null,
    hatchedCreatureId: null,
  };
}

/** Add one crack (e.g. on goal completion). Sets readyToHatch once maxCracks is reached. */
export function addCrack(eggState) {
  if (eggState.hatched) return eggState;
  const cracks = Math.min(eggState.maxCracks, eggState.cracks + 1);
  return { ...eggState, cracks, readyToHatch: cracks >= eggState.maxCracks };
}

/** First harvest of a distinctive crop hints at the egg's element (glow color). */
export function setElementHint(eggState, element) {
  if (eggState.elementHint) return eggState;
  return { ...eggState, elementHint: element };
}

function pickCreature(eggState, creaturesList) {
  const match = creaturesList.find((c) => c.element === eggState.elementHint);
  return match || creaturesList[0] || null;
}

/**
 * A single child tap on a ready egg. The first `requiredHatchTaps - 1` taps
 * just add drama (bigger cracks, a rising sound, driven by the UI layer from
 * `hatchTaps`); the final tap actually hatches it. Never a question gate,
 * never punished -- taps before the egg is ready, or after it has already
 * hatched, are safe no-ops.
 */
export function tapEgg(eggState, creaturesList) {
  if (!eggState.readyToHatch || eggState.hatched) {
    return { eggState, hatchedCreatureId: null, hatched: false };
  }
  const hatchTaps = eggState.hatchTaps + 1;
  if (hatchTaps < eggState.requiredHatchTaps) {
    return { eggState: { ...eggState, hatchTaps }, hatchedCreatureId: null, hatched: false };
  }
  const creature = pickCreature(eggState, creaturesList);
  const hatchedCreatureId = creature ? creature.id : null;
  return {
    eggState: {
      ...eggState,
      hatchTaps,
      hatched: true,
      readyToHatch: false,
      hatchedCreatureId,
    },
    hatchedCreatureId,
    hatched: !!hatchedCreatureId,
  };
}
