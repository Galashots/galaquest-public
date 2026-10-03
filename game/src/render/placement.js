// Which egg or creature stands in which farm spot. Pure, no three.js, so it is unit-tested.
//
// - Every egg still waiting to hatch gets a spot.
// - Each species stands on the farm once; later hatchlings of a species it already shows live
//   in the collection book only.
// - A spot, once given, is kept, so nothing jumps around as eggs come and go.
// - When the spots run out, the waiting eggs win and the earliest-placed creatures (after the
//   starter) step back into the book.

/**
 * @param {Array} eggs     state.eggs, in order (the starter first)
 * @param {number} spots   number of farm spots
 * @param {Map} previous   last result (eggId -> spot), for stability
 * @returns {Map} eggId -> spot index, for every egg or creature that is shown
 */
export function placeEggs(eggs, spots, previous = new Map()) {
  const seenSpecies = new Set();
  const wanted = [];
  for (const egg of eggs) {
    if (!egg.hatched) wanted.push({ id: egg.id, waiting: true });
    else if (egg.hatchedCreatureId && !seenSpecies.has(egg.hatchedCreatureId)) {
      seenSpecies.add(egg.hatchedCreatureId);
      wanted.push({ id: egg.id, waiting: false });
    }
  }
  // Too many: drop the earliest-placed creatures (never the starter, never a waiting egg).
  let overflow = wanted.length - spots;
  const keep = wanted.filter((w, i) => {
    if (overflow <= 0 || w.waiting || i === 0) return true;
    overflow -= 1;
    return false;
  });

  const placed = new Map();
  const used = new Set();
  for (const w of keep) {
    const spot = previous.get(w.id);
    if (spot !== undefined && spot < spots && !used.has(spot)) { placed.set(w.id, spot); used.add(spot); }
  }
  for (const w of keep) {
    if (placed.has(w.id)) continue;
    let spot = 0;
    while (used.has(spot)) spot += 1;
    if (spot >= spots) break;
    placed.set(w.id, spot);
    used.add(spot);
  }
  return placed;
}
