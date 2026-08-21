import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DAWNWARDEN_HELMET_CANDIDATE,
  DAWNWARDEN_SWORD_CANDIDATE,
} from '../public/src/studio/candidateGear.js';

const SOURCE_SHA = '687f903f33def5dddc7662e9093de4d80f55fc12';

test('Dawnwarden sword preserves the owner Forge fit packet', () => {
  const fit = DAWNWARDEN_SWORD_CANDIDATE.ownerFit;
  assert.equal(fit.schema, 'galaquest.asset-forge-fit/1');
  assert.equal(fit.sourceSha, SOURCE_SHA);
  assert.deepEqual([...fit.delta.positionWorld], [0.09, -0.020000000000000007, 0]);
  assert.deepEqual([...fit.delta.rotationDeg], [-64, -13, 40]);
  assert.deepEqual([...fit.effective.localPosition], [-1.6385421309043957, 5.85455133950245, 2.4074804446994165]);
  assert.deepEqual([...fit.effective.localScale], [47.38742650536052, 47.38742650536052, 47.38742650536052]);
});

test('Dawnwarden helmet preserves the owner Forge fit packet', () => {
  const fit = DAWNWARDEN_HELMET_CANDIDATE.ownerFit;
  assert.equal(fit.schema, 'galaquest.asset-forge-fit/1');
  assert.equal(fit.sourceSha, SOURCE_SHA);
  assert.deepEqual([...fit.delta.positionWorld], [0, 0.045, 0]);
  assert.deepEqual([...fit.delta.rotationDeg], [0, 0, 0]);
  assert.deepEqual([...fit.effective.localPosition], [-0.12855126128084882, 13.826713406476742, -4.365260824014637]);
  assert.deepEqual([...fit.effective.localScale], [20.009290639414257, 20.009290639414257, 20.009290639414257]);
});

test('Forge animation selection resumes playback instead of freezing at clip time zero', () => {
  const source = readFileSync('public/src/forge/main.js', 'utf8');
  const handler = source.match(/#animation-select[\s\S]{0,500}?#toggle-animation/);
  assert.ok(handler, 'animation select handler missing');
  assert.match(handler[0], /setAnimation\(/);
  assert.match(handler[0], /setAnimationPlaying\(true\)/);
});

test('saved Forge deltas are versioned by source SHA so a baked fit is not applied twice', () => {
  const source = readFileSync('public/src/forge/main.js', 'utf8');
  assert.match(source, /gq-forge-fit:\$\{sourceSha\}:\$\{assetId\}/);
});
