import { strict as assert } from 'node:assert';
import test from 'node:test';

import { createFrameSampler, FRAME_BUDGET_MS } from '../public/src/debug/diagnostics.js';

test('frame sampler reports measured mean, p90, worst, and budget misses', () => {
  const sampler = createFrameSampler(4);
  for (const cost of [10, 20, 30, 40]) sampler.record(cost);
  const stats = sampler.stats();
  assert.equal(FRAME_BUDGET_MS, 16.7);
  assert.equal(stats.count, 4);
  assert.equal(stats.meanMs, 25);
  assert.equal(stats.p90Ms, 40);
  assert.equal(stats.worstMs, 40);
  assert.equal(stats.overBudget, 3);
});
