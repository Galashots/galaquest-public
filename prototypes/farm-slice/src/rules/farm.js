// Pure farm-plot rules: no three.js, no DOM. Growth is timestamp-based so
// crops keep growing while the app is closed -- state only ever stores
// `plantedAt` (epoch ms), and readiness is derived from `now` at read time.

/**
 * @param {number} numPlots
 * @returns {{plots: Array<{cropId: string|null, plantedAt: number|null, watered: boolean}>}}
 */
export function createFarmState(numPlots = 3) {
  const plots = [];
  for (let i = 0; i < numPlots; i++) {
    plots.push({ cropId: null, plantedAt: null, watered: false });
  }
  return { plots };
}

/** Plant a crop in a specific empty plot. Returns a new farm state. No-op (same ref semantics aside) if the plot is occupied or out of range. */
export function plantSeed(farmState, plotIndex, cropId, now) {
  const plot = farmState.plots[plotIndex];
  if (!plot || plot.cropId) return farmState;
  const plots = farmState.plots.slice();
  plots[plotIndex] = { cropId, plantedAt: now, watered: false };
  return { ...farmState, plots };
}

/** Plant several seeds at once into the first empty plots available, in order. Returns { farmState, planted } where planted is the list of {plotIndex, cropId} actually planted. */
export function plantSeeds(farmState, cropIds, now) {
  let state = farmState;
  const planted = [];
  let cropIdx = 0;
  for (let plotIndex = 0; plotIndex < state.plots.length && cropIdx < cropIds.length; plotIndex++) {
    if (state.plots[plotIndex].cropId) continue;
    const cropId = cropIds[cropIdx];
    state = plantSeed(state, plotIndex, cropId, now);
    planted.push({ plotIndex, cropId });
    cropIdx++;
  }
  return { farmState: state, planted };
}

export function getCropDef(cropsById, cropId) {
  return cropsById.get ? cropsById.get(cropId) : cropsById[cropId];
}

/** 0..1 growth progress for a plot, given its crop's growSeconds. Empty plots return 0. */
export function getGrowthProgress(plot, cropDef, now) {
  if (!plot.cropId || plot.plantedAt == null || !cropDef) return 0;
  const elapsedMs = Math.max(0, now - plot.plantedAt);
  const totalMs = Math.max(1, cropDef.growSeconds * 1000);
  return Math.min(1, elapsedMs / totalMs);
}

export function isReady(plot, cropDef, now) {
  return !!plot.cropId && getGrowthProgress(plot, cropDef, now) >= 1;
}

/**
 * Water an unwatered, not-yet-ripe plot: halves its *remaining* grow time,
 * once per crop (CONTRACT.md section 1/2/8). Implemented by moving
 * `plantedAt` earlier so the new ready-time is `now + remaining/2` --
 * growth stays purely timestamp-based (correct across save/reload) rather
 * than needing a separate accumulator. A no-op if the plot is empty,
 * already ripe, or already watered.
 */
export function waterPlot(farmState, plotIndex, cropDef, now) {
  const plot = farmState.plots[plotIndex];
  if (!plot || !plot.cropId || !cropDef || plot.watered) return farmState;
  if (isReady(plot, cropDef, now)) return farmState;

  const growMs = cropDef.growSeconds * 1000;
  const readyAt = plot.plantedAt + growMs;
  const remaining = readyAt - now;
  const newReadyAt = now + remaining / 2;
  const newPlantedAt = newReadyAt - growMs;

  const plots = farmState.plots.slice();
  plots[plotIndex] = { ...plot, plantedAt: newPlantedAt, watered: true };
  return { ...farmState, plots };
}

/**
 * Harvest a single ready plot. Returns { farmState, harvestedCropId } where
 * harvestedCropId is null if the plot wasn't ready (or empty) -- in which
 * case farmState is returned unchanged.
 */
export function harvestPlot(farmState, plotIndex, cropDefsById, now) {
  const plot = farmState.plots[plotIndex];
  if (!plot || !plot.cropId) return { farmState, harvestedCropId: null };
  const cropDef = getCropDef(cropDefsById, plot.cropId);
  if (!isReady(plot, cropDef, now)) return { farmState, harvestedCropId: null };
  const harvestedCropId = plot.cropId;
  const plots = farmState.plots.slice();
  plots[plotIndex] = { cropId: null, plantedAt: null, watered: false };
  return { farmState: { ...farmState, plots }, harvestedCropId };
}

/** Returns the list of plot indexes that are ready to harvest right now. */
export function readyPlotIndexes(farmState, cropDefsById, now) {
  const indexes = [];
  farmState.plots.forEach((plot, i) => {
    const cropDef = getCropDef(cropDefsById, plot.cropId);
    if (isReady(plot, cropDef, now)) indexes.push(i);
  });
  return indexes;
}

/** Plots that are growing (occupied, not yet ripe) and haven't been watered yet. */
export function unwateredGrowingPlotIndexes(farmState, cropDefsById, now) {
  const indexes = [];
  farmState.plots.forEach((plot, i) => {
    if (!plot.cropId || plot.watered) return;
    const cropDef = getCropDef(cropDefsById, plot.cropId);
    if (!isReady(plot, cropDef, now)) indexes.push(i);
  });
  return indexes;
}

/** True once every occupied-at-planting-time plot has been harvested (all plots empty). */
export function allPlotsEmpty(farmState) {
  return farmState.plots.every((p) => !p.cropId);
}

/** True if at least one plot currently holds a crop (growing or ripe). */
export function anyPlotOccupied(farmState) {
  return farmState.plots.some((p) => !!p.cropId);
}
