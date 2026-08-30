import test from 'node:test';
import assert from 'node:assert/strict';
import { relative } from 'node:path';
import { selectOwnedRewardStore } from '../tools/runtime-test/owned-server.mjs';

// data/README.md is explicit: "Tests must never open a store at a path under `data/`."
//
// The structural selection law lives with startOwnedServer, so a new caller is safe even when it
// omits every option.

test('real reward-store access is deliberate and cannot be combined with an explicit path', () => {
  const realStore = selectOwnedRewardStore({ useRealRewardStore: true });
  assert.deepEqual(realStore, { kind: 'real', rewardStorePath: null });

  assert.throws(
    () => selectOwnedRewardStore({ rewardStorePath: 'C:/safe/rewards.db', useRealRewardStore: true }),
    /cannot combine rewardStorePath with useRealRewardStore/,
  );
});

test('explicit reward-store paths remain distinguishable from the safe temporary default', () => {
  const explicitPath = 'C:/safe/rewards.db';
  assert.deepEqual(selectOwnedRewardStore({ rewardStorePath: explicitPath }), {
    kind: 'explicit',
    rewardStorePath: explicitPath,
  });

  const temporaryStore = selectOwnedRewardStore();
  assert.equal(temporaryStore.kind, 'temporary');
  assert.equal(relative(process.cwd(), temporaryStore.rewardStorePath).startsWith('..'), true);
});
