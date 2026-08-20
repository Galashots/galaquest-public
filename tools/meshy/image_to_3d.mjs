// One reference image to one textured GLB, bracketed by balance reads so cost is MEASURED.
//
// Safe-ported from the historical private pipeline. Public changes are intentionally small:
// - key path is repository-relative and gitignored;
// - dry-run is the default; only --go can spend credits;
// - no credential or full data URI is ever printed.
//
// Usage:
//   node tools/meshy/image_to_3d.mjs <image.png> <outdir> [--polycount N] [--go]
//
// The reference should already have a plain/flattened background. Raw Meshy GLBs never ship;
// recompress and run tools/budget/glb_budget.mjs after generation.

import { basename } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const [imagePath, outDir] = args;
const go = args.includes('--go');
const polycount = args.includes('--polycount') ? Number(args[args.indexOf('--polycount') + 1]) : 300;
if (!imagePath || !outDir || !Number.isFinite(polycount) || polycount <= 0) {
  console.error('usage: node tools/meshy/image_to_3d.mjs <image.png> <outdir> [--polycount N] [--go]');
  process.exit(2);
}

const keyUrl = new URL('../../.local/meshy/api-key.txt', import.meta.url);
let key;
try {
  key = readFileSync(keyUrl, 'utf8').trim();
} catch {
  console.error('Meshy API key not found at .local/meshy/api-key.txt');
  process.exit(2);
}
if (!key) {
  console.error('Meshy API key file is empty');
  process.exit(2);
}

const API = 'https://api.meshy.ai/openapi';
const auth = { Authorization: `Bearer ${key}` };

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...auth, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

const balance = () => api('/v1/balance').then((result) => result.balance);
const imageBytes = readFileSync(imagePath);
const body = {
  image_url: `data:image/png;base64,${imageBytes.toString('base64')}`,
  ai_model: 'meshy-t2',
  model_type: 'smart-topology',
  topology: 'triangle',
  target_polycount: polycount,
  should_texture: true,
  texture_resolution: '2k',
};

const before = await balance();
console.log(`balance before: ${before}`);
console.log(`image: ${basename(imagePath)} (${(imageBytes.length / 1024).toFixed(0)} KiB)`);
console.log(`request: ${JSON.stringify({ ...body, image_url: `<data uri, ${body.image_url.length} chars>` }, null, 2)}`);

if (!go) {
  console.log('\nDRY RUN — no credits spent. Re-run with --go to send.');
  process.exit(0);
}

const { result: taskId } = await api('/v1/image-to-3d', { method: 'POST', body: JSON.stringify(body) });
console.log(`task: ${taskId}`);

let task;
for (let i = 0; i < 240; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  task = await api(`/v1/image-to-3d/${taskId}`);
  process.stdout.write(`\r  ${task.status} ${task.progress ?? 0}%   `);
  if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(task.status)) break;
}
console.log('');
if (task?.status !== 'SUCCEEDED') {
  throw new Error(`task ended ${task?.status ?? 'TIMEOUT'}: ${JSON.stringify(task?.task_error ?? {})}`);
}

const after = await balance();
const consumed = task.consumed_credits;
console.log(`\nCOST OF THIS TASK: ${consumed ?? '(api reported none)'} credits <- authoritative`);
console.log(`balance ${before} -> ${after} (delta ${before - after})`);
if (consumed !== undefined && before - after !== consumed) {
  console.log('NOTE: balance delta differs from consumed_credits; other account activity may be concurrent.');
}

mkdirSync(outDir, { recursive: true });
const glbUrl = task.model_urls?.glb;
if (!glbUrl) throw new Error('Meshy task succeeded without model_urls.glb');
const stem = basename(imagePath).replace(/\.[^.]+$/, '').replace(/_ref(_v\d+)?$/, '');
const glb = Buffer.from(await fetch(glbUrl).then((res) => {
  if (!res.ok) throw new Error(`GLB download failed: ${res.status}`);
  return res.arrayBuffer();
}));
writeFileSync(`${outDir}/${stem}.glb`, glb);
writeFileSync(`${outDir}/task.json`, JSON.stringify(task, null, 2));

// Inspect the GLB itself rather than importing into a DCC that may synthesize helper geometry.
const jsonLen = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
let triangles = 0;
for (const mesh of gltf.meshes ?? []) {
  for (const primitive of mesh.primitives ?? []) {
    if (primitive.indices === undefined) continue;
    triangles += gltf.accessors[primitive.indices].count / 3;
  }
}
console.log(`GLB ${glb.length} bytes; meshes ${(gltf.meshes ?? []).length}; triangles ${triangles}; animations ${(gltf.animations ?? []).length}; skins ${(gltf.skins ?? []).length}`);

for (const [i, set] of (task.texture_urls ?? []).entries()) {
  for (const [kind, url] of Object.entries(set)) {
    if (!url) continue;
    const bytes = Buffer.from(await fetch(url).then((res) => {
      if (!res.ok) throw new Error(`texture download failed: ${res.status}`);
      return res.arrayBuffer();
    }));
    writeFileSync(`${outDir}/texture_${i}_${kind}.png`, bytes);
  }
}
