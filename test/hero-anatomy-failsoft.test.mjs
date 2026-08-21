import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { heroAnatomyApi, tryInstallHeroAnatomy } from '../public/src/character/hero.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Two gates pull in opposite directions and both must hold.
//
// In CI, semantic anatomy drifting away from the Hero mesh is a HARD FAILURE: that is
// test/hero-anatomy-proof.test.mjs's whole job and nothing here may soften it.
//
// At runtime the same drift must NOT be fatal. Game boot (public/src/main.js), Character Studio
// (public/src/studio/scene.js) and the Asset Forge (which builds on Studio's scene) all
// `await loadHero()` with no try/catch. Before this fail-soft, a throw inside installHeroAnatomy
// rejected that promise and took all three surfaces down -- including the Forge, the tool you would
// use to re-author the anatomy that broke. The degrade must be loud, and it must be no-occlusion
// rather than no-Hero.

function workingAnatomy() {
  let coverage = Object.freeze([]);
  return {
    setCoverage(hidden = []) {
      coverage = Object.freeze([...hidden]);
      return [...coverage];
    },
    get coverage() { return [...coverage]; },
  };
}

test('a successful anatomy install is passed straight through and says nothing', () => {
  const anatomy = workingAnatomy();
  const logged = [];
  const result = tryInstallHeroAnatomy({}, () => anatomy, (line) => logged.push(line));

  assert.equal(result.anatomy, anatomy);
  assert.equal(result.anatomyError, null);
  assert.deepEqual(logged, [], 'a healthy install must not emit a degrade diagnostic');
});

test('an anatomy install that throws degrades instead of propagating', () => {
  const boom = new Error('Hero anatomy proof expected exactly one skinned body mesh, found 2');
  const logged = [];

  const result = tryInstallHeroAnatomy({}, () => { throw boom; }, (line) => logged.push(line));

  assert.equal(result.anatomy, null);
  assert.equal(result.anatomyError, boom, 'the real cause must be retained, not swallowed');
});

test('the degrade diagnostic is loud enough to act on', () => {
  const logged = [];
  tryInstallHeroAnatomy(
    {},
    () => { throw new Error('sidecar targets a different asset'); },
    (line) => logged.push(line),
  );

  assert.equal(logged.length, 1, 'exactly one diagnostic, not silence and not a storm');
  const [line] = logged;
  assert.match(line, /NO ANATOMY OCCLUSION/, 'must name the visible consequence');
  assert.match(line, /bake_anatomy_regions\.py/, 'must name the tool that repairs it');
  assert.match(line, /hero-anatomy-proof\.test\.mjs/, 'must point at the hard gate');
  assert.match(line, /sidecar targets a different asset/, 'must carry the underlying cause');
});

test('drifted anatomy renders without occlusion rather than throwing', () => {
  const api = heroAnatomyApi({ anatomy: null, anatomyError: new Error('drift') });

  assert.equal(api.anatomyAvailable, false);
  assert.ok(api.anatomyError instanceof Error);
  // The Dawnwarden helmet asks for exactly this pair. Under drift it must come back empty-handed,
  // not take the caller down: Studio and the Forge request coverage during scene construction.
  assert.deepEqual(api.setAnatomyCoverage(['hair', 'ears']), []);
  assert.deepEqual(api.anatomyCoverage, []);
});

test('a Hero GLB that failed to load keeps its original, stricter contract', () => {
  const api = heroAnatomyApi({ anatomy: null, anatomyError: null });

  assert.equal(api.anatomyAvailable, false);
  assert.equal(api.anatomyError, null);
  assert.deepEqual(api.setAnatomyCoverage([]), [], 'asking for nothing is still fine');
  assert.throws(
    () => api.setAnatomyCoverage(['hair']),
    /cannot apply anatomy coverage to failed Hero fallback/,
    'a failed Hero is a different fault from drifted anatomy and must not be quietly softened',
  );
});

test('sabotage: the degrade is not a constant -- working anatomy really does apply coverage', () => {
  const api = heroAnatomyApi({ anatomy: workingAnatomy(), anatomyError: null });

  assert.equal(api.anatomyAvailable, true);
  assert.deepEqual(api.setAnatomyCoverage(['hair', 'ears']), ['hair', 'ears']);
  assert.deepEqual(api.anatomyCoverage, ['hair', 'ears'], 'the accessor must stay live after a set');
  assert.deepEqual(api.setAnatomyCoverage([]), [], 'and must be clearable again');
});

test('the hard CI proof does not route through hero.js, so this fail-soft cannot weaken it', () => {
  const proof = readFileSync(resolve(repoRoot, 'test/hero-anatomy-proof.test.mjs'), 'utf8');

  assert.doesNotMatch(
    proof,
    /from '\.\.\/public\/src\/character\/hero\.js'/,
    'the anatomy proof must keep reading the GLB and anatomyOcclusion.js directly; if it ever '
    + 'imports hero.js it inherits the runtime degrade and stops being a hard gate',
  );
  assert.match(proof, /sha256/i, 'the proof still pins the Hero bytes');
});
