import { strict as assert } from 'node:assert';
import test from 'node:test';

import { report, scoreEquipped } from '../tools/budget/glb_budget.mjs';

// The per-file report answers "is this asset legal on its own", which is not what the budget is
// for. Sol's Q10 ruling of 2026-08-12 is that we budget against the WORST LEGAL RUNTIME STATE at
// each LOD, and a hero with a full tier equipped is several files at once. Scoring them one at a
// time is how six draw calls passed as six separate PASSes.
//
// The configuration below is the one Sol's Q3 ruling asks for -- the plain decimated hero with
// gear attached at runtime, rather than the Tier 2 arrangement where gear is baked into the hero
// GLB. These are parsed from the served files, so a payload, geometry, or atlas change goes red.
const TIER3_EQUIPPED_PATHS = [
  'public/assets/hero/hero_lod1_6800.glb',
  'public/assets/gear/helmet_silverguard.glb',
  'public/assets/gear/shoulder_silverguard.glb',
  'public/assets/gear/shoulder_silverguard.glb',
  'public/assets/gear/sword_silverguard.glb',
  'public/assets/gear/shield_ironwood.glb',
];
const TIER3_EQUIPPED = TIER3_EQUIPPED_PATHS.map((path) => report(path, { log: false }));

test('a full Tier 3 kit sums to six draw calls and fits the six-draw budget', () => {
  const { totals, verdicts } = scoreEquipped(TIER3_EQUIPPED);

  assert.equal(totals.primitives, 6);
  const draws = verdicts.find((v) => v.name === 'heroMaxDraws');
  // Contract version 8 (owner-authorized 2026-08-13): heroMaxDraws is 6, geometry only, raised
  // from the never-device-measured 4. Six primitives is now exactly at the cap, not a breach.
  assert.equal(draws.ok, true, 'six primitives must fit a six-draw budget');
});

test('the same gear file worn twice is one atlas, not two', () => {
  const { totals } = scoreEquipped(TIER3_EQUIPPED);

  // Both pauldrons are shoulder_silverguard.glb mirrored by a negative X scale, so they are one
  // texture resident on the GPU however many times the mesh is instanced. Counting the instances
  // would overstate the atlas count and make the number easy to dismiss.
  assert.equal(totals.images, 5, 'five distinct source files carry five distinct atlases');

  // Contract version 8 re-scoped uniqueFullBodyTextures to the body alone; gear files carry their
  // own single atlases, counted separately. The scoreable rule left is per-file: no source file
  // may carry more than one atlas, and all five here carry exactly one.
  const atlases = verdictNamed(scoreEquipped(TIER3_EQUIPPED), 'one atlas per file');
  assert.equal(atlases.ok, true, 'every distinct file carries at most one atlas');
});

test('equipped triangles breach the LOD1 target but stay inside its hard cap', () => {
  const { totals, verdicts } = scoreEquipped(TIER3_EQUIPPED);

  assert.equal(totals.triangles, 8_125);
  assert.equal(verdictNamed({ verdicts }, 'LOD1 target').ok, false, '8,125 is over the 8,000 target');
  assert.equal(verdictNamed({ verdicts }, 'LOD1 hard cap').ok, true, '8,125 is under the 10,000 cap');
});

test('the payload verdict scores against the ruled scope: whole equipped character, 1.5 MB', () => {
  const { totals, verdicts } = scoreEquipped(TIER3_EQUIPPED);

  // The scope question this verdict used to decline is ruled (the owner, 2026-08-13, recorded in
  // the private engineering archive): the cap covers the WHOLE
  // EQUIPPED CHARACTER, counted as distinct bytes, and is raised to 1.5 MB. So the tool now
  // scores what it used to only report.
  assert.equal(verdictNamed({ verdicts }, 'payload').ok, true, '1,046,916 distinct bytes fit a 1.5 MB cap');

  // 1,046,916 rather than 1,093,388: the second pauldron is the same file and is downloaded once.
  assert.equal(totals.bytes, 1_046_916);
});

function verdictNamed(scored, name) {
  const found = scored.verdicts.find((v) => v.name === name);
  assert.ok(found, `no verdict named ${name}`);
  return found;
}
