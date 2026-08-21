import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeForgeImageTo3DRequest } from '../net/forgeApi.mjs';

const IMAGE = 'data:image/png;base64,aGVsbG8=';

test('Forge refuses to construct a paid Meshy request without explicit approval', () => {
  assert.throws(
    () => normalizeForgeImageTo3DRequest({ imageDataUrl: IMAGE }),
    /explicit paid-task approval is required/,
  );
});

test('Forge produces a constrained Meshy 6 GLB request for an approved candidate', () => {
  const body = normalizeForgeImageTo3DRequest({
    approvedPaidTask: true,
    imageDataUrl: IMAGE,
    aiModel: 'meshy-6',
    poseMode: 't-pose',
    targetPolycount: 18000,
    shouldTexture: true,
    enablePbr: false,
    removeLighting: true,
  });
  assert.equal(body.image_url, IMAGE);
  assert.equal(body.ai_model, 'meshy-6');
  assert.equal(body.pose_mode, 't-pose');
  assert.equal(body.target_polycount, 18000);
  assert.equal(body.should_remesh, true);
  assert.equal(body.should_texture, true);
  assert.equal(body.remove_lighting, true);
  assert.deepEqual(body.target_formats, ['glb']);
});

test('latest alias deliberately omits Meshy-6-only remove_lighting', () => {
  const body = normalizeForgeImageTo3DRequest({
    approvedPaidTask: true,
    imageDataUrl: IMAGE,
    aiModel: 'latest',
    targetPolycount: 12000,
  });
  assert.equal(body.ai_model, 'latest');
  assert.equal('remove_lighting' in body, false);
});

test('Forge constrains provider model, pose, and polygon budget', () => {
  assert.throws(() => normalizeForgeImageTo3DRequest({ approvedPaidTask: true, imageDataUrl: IMAGE, aiModel: 'meshy-5' }), /unsupported aiModel/);
  assert.throws(() => normalizeForgeImageTo3DRequest({ approvedPaidTask: true, imageDataUrl: IMAGE, poseMode: 'bind-pose' }), /unsupported poseMode/);
  assert.throws(() => normalizeForgeImageTo3DRequest({ approvedPaidTask: true, imageDataUrl: IMAGE, targetPolycount: 499 }), /targetPolycount/);
  assert.throws(() => normalizeForgeImageTo3DRequest({ approvedPaidTask: true, imageDataUrl: IMAGE, targetPolycount: 80001 }), /targetPolycount/);
});

test('Forge accepts only PNG/JPEG data URIs, never arbitrary URLs or HTML', () => {
  assert.throws(() => normalizeForgeImageTo3DRequest({ approvedPaidTask: true, imageDataUrl: 'https://example.com/model.png' }), /PNG\/JPEG base64 data URI/);
  assert.throws(() => normalizeForgeImageTo3DRequest({ approvedPaidTask: true, imageDataUrl: 'data:text/html;base64,PGgxPk5PPC9oMT4=' }), /PNG\/JPEG base64 data URI/);
});
