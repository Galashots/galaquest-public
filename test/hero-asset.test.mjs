import { strict as assert } from 'node:assert';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const heroPath = resolve(repoRoot, 'public/assets/hero/hero.glb');

// The glTF reader belongs to tools/teardown's dependency tree, not the runtime's. The runtime has no
// dependencies at all, which is why the CI workflow deliberately has no install step -- so on a fresh
// checkout this module is simply absent, and a static import of it fails the whole file before a
// single assertion runs. Resolve it at run time and skip only the assertions that need it.
//
// It was previously imported by absolute Windows path. That hid the problem twice over: it passed on
// the one machine that had it installed, and from inside a git worktree it silently reached across
// into the main checkout's node_modules rather than the worktree's own.
const readerPath = resolve(repoRoot, 'tools/teardown/node_modules/@gltf-transform/core/dist/index.js');
const readerMissing = existsSync(readerPath)
  ? false
  : 'tools/teardown dependencies are not installed; run npm ci in tools/teardown to measure the GLB';

function countTriangles(primitive) {
  const indices = primitive.getIndices();
  const position = primitive.getAttribute('POSITION');
  const count = indices ? indices.getCount() : position?.getCount() ?? 0;
  assert.equal(primitive.getMode(), 4, 'the shipped hero must use TRIANGLES primitives');
  return count / 3;
}

function maxBoneInfluences(primitive) {
  const weightAccessors = ['WEIGHTS_0', 'WEIGHTS_1']
    .map((name) => primitive.getAttribute(name))
    .filter(Boolean);
  const vertexCount = primitive.getAttribute('POSITION')?.getCount() ?? 0;
  let maximum = 0;

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    let influences = 0;
    for (const accessor of weightAccessors) {
      const values = accessor.getElement(vertex, [0, 0, 0, 0]);
      influences += values.filter((weight) => weight > 1e-6).length;
    }
    maximum = Math.max(maximum, influences);
  }

  return maximum;
}

// Split out of the measurement test on purpose: a byte count needs no dependency, so this is the one
// assertion that still guards the shipped asset on a machine that cannot open the GLB. Swapping the
// hero for a different export cannot pass CI silently.
test('the shipped hero is the exact accepted export', () => {
  // 2026-08-12: was 2_559_588. The mesh did not change -- the texture container did. The 1024 base
  // colour shipped as a 1,665,724-byte PNG, which is 65% of the file and the whole reason the asset
  // breached the 1 MB payload cap; re-encoded as a q75 JPEG it is 127,592 bytes and the GLB is
  // 1,021,440, under the cap for the first time.
  //
  // Safe because the material is alphaMode OPAQUE and the PNG's alpha was opaque export residue
  // (95 non-opaque pixels of 1,048,576). Rendered before and after at a true 90px play size, not one
  // pixel differed by more than 2/255. The measurement test below is the real guard and it did not
  // move: same 15,642 triangles, 24 joints, 4 influences, feet at Y=0, same two clips.
  assert.equal(statSync(heroPath).size, 1_021_440, 'hero byte count changed');
});

test('the shipped hero matches the measured runtime asset facts', { skip: readerMissing }, async () => {
  const { NodeIO } = await import(pathToFileURL(readerPath).href);

  const document = await new NodeIO().read(heroPath);
  const root = document.getRoot();
  const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
  const triangles = primitives.reduce((total, primitive) => total + countTriangles(primitive), 0);
  const skeleton = root.listSkins()[0];
  const positions = primitives.map((primitive) => primitive.getAttribute('POSITION'));
  const minimumY = Math.min(...positions.map((position) => position.getMin([0, 0, 0])[1]));
  const clipNames = root.listAnimations().map((animation) => animation.getName());

  assert.equal(triangles, 15_642);
  assert.equal(skeleton?.listJoints().length, 24);
  assert.equal(Math.max(...primitives.map(maxBoneInfluences)), 4);
  assert.ok(Math.abs(minimumY) <= 1e-5, `feet minimum Y was ${minimumY}`);
  assert.deepEqual(clipNames, [
    'Armature|walking_man|baselayer',
    'Armature|running|baselayer',
  ]);
});
