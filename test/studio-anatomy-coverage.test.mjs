import test from 'node:test';
import assert from 'node:assert/strict';

import { DAWNWARDEN_HELMET_CANDIDATE } from '../public/src/studio/candidateGear.js';
import { STUDIO_LOADOUTS, loadoutDescriptor } from '../public/src/studio/loadoutDescriptors.js';

test('Dawnwarden helmet declares semantic coverage instead of relying on head-slot magic', () => {
  assert.deepEqual(DAWNWARDEN_HELMET_CANDIDATE.hideAnatomy, ['hair', 'ears']);
  assert.throws(() => DAWNWARDEN_HELMET_CANDIDATE.hideAnatomy.push('face'), TypeError);
});

test('Studio derives the equipped anatomy coverage from gear metadata', () => {
  const helmet = loadoutDescriptor('candidate-dawnwarden-helmet');
  assert.deepEqual(helmet.hideAnatomy, ['hair', 'ears']);
  assert.throws(() => helmet.hideAnatomy.push('face'), TypeError);

  for (const descriptor of STUDIO_LOADOUTS.filter((entry) => entry.id !== helmet.id)) {
    assert.deepEqual(descriptor.hideAnatomy, [], `${descriptor.id} unexpectedly hides anatomy`);
  }
});
