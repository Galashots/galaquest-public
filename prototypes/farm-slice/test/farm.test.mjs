import test from 'node:test';
import assert from 'node:assert/strict';
import * as farm from '../src/rules/farm.js';

const carrot = { id: 'carrot', growSeconds: 10 };
const cropsById = new Map([['carrot', carrot]]);

test('a freshly planted plot is not ready', () => {
  let state = farm.createFarmState(3);
  const now = 1000;
  state = farm.plantSeed(state, 0, 'carrot', now);
  assert.equal(farm.isReady(state.plots[0], carrot, now), false);
  assert.equal(farm.getGrowthProgress(state.plots[0], carrot, now), 0);
});

test('growth progresses linearly and clamps at 1', () => {
  let state = farm.createFarmState(3);
  const plantedAt = 0;
  state = farm.plantSeed(state, 0, 'carrot', plantedAt);
  assert.equal(farm.getGrowthProgress(state.plots[0], carrot, 5000), 0.5);
  assert.equal(farm.getGrowthProgress(state.plots[0], carrot, 10000), 1);
  assert.equal(farm.getGrowthProgress(state.plots[0], carrot, 999999), 1);
});

test('growth continues correctly across a save/reload gap (timestamp based, not tick based)', () => {
  let state = farm.createFarmState(3);
  const plantedAt = 1_000_000;
  state = farm.plantSeed(state, 0, 'carrot', plantedAt);

  // Simulate "closing the app": serialize to JSON and back, as save.js would.
  const serialized = JSON.stringify(state);
  const reloaded = JSON.parse(serialized);

  // The app was "closed" for 30 seconds -- well past the 10s grow time.
  const reopenedAt = plantedAt + 30_000;
  assert.equal(farm.isReady(reloaded.plots[0], carrot, reopenedAt), true);

  const { farmState, harvestedCropId } = farm.harvestPlot(reloaded, 0, cropsById, reopenedAt);
  assert.equal(harvestedCropId, 'carrot');
  assert.equal(farmState.plots[0].cropId, null);
});

test('harvesting an unripe plot fails and leaves state untouched', () => {
  let state = farm.createFarmState(3);
  state = farm.plantSeed(state, 0, 'carrot', 0);
  const { farmState, harvestedCropId } = farm.harvestPlot(state, 0, cropsById, 1000);
  assert.equal(harvestedCropId, null);
  assert.equal(farmState.plots[0].cropId, 'carrot');
});

test('harvesting an empty plot is a safe no-op', () => {
  const state = farm.createFarmState(3);
  const { harvestedCropId } = farm.harvestPlot(state, 1, cropsById, 5000);
  assert.equal(harvestedCropId, null);
});

test('plantSeeds fills only empty plots, in order, and stops when out of crops', () => {
  let state = farm.createFarmState(3);
  state = farm.plantSeed(state, 1, 'carrot', 0); // occupy the middle plot first
  const { farmState, planted } = farm.plantSeeds(state, ['carrot', 'carrot'], 0);
  assert.equal(planted.length, 2);
  assert.deepEqual(planted.map((p) => p.plotIndex), [0, 2]);
  assert.equal(farmState.plots[0].cropId, 'carrot');
  assert.equal(farmState.plots[2].cropId, 'carrot');
});

test('readyPlotIndexes finds all ripe plots at once', () => {
  let state = farm.createFarmState(3);
  state = farm.plantSeed(state, 0, 'carrot', 0);
  state = farm.plantSeed(state, 2, 'carrot', 0);
  assert.deepEqual(farm.readyPlotIndexes(state, cropsById, 10000), [0, 2]);
});
