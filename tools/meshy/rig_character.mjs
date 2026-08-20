// Rig a textured humanoid produced by a Meshy API task, with cost measured from the task itself.
//
// Meshy API authority (verified 2026-08-20): POST /openapi/v1/rigging accepts input_task_id and an
// optional positive height_meters. A successful task exposes result.rigged_character_glb_url and
// consumed_credits. Public production uses input_task_id so no temporary model URL has to be hosted.
//
// Usage:
//   node tools/meshy/rig_character.mjs <input-task-id> <outdir> [--height 2.2] [--go]
//
// DRY RUN is the default and is fully offline. --go is the only path that reads credentials or
// creates a paid task.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const [inputTaskId, outDir] = args;
const go = args.includes('--go');
const height = args.includes('--height') ? Number(args[args.indexOf('--height') + 1]) : 1.7;
if (!inputTaskId || !outDir || !Number.isFinite(height) || height <= 0) {
  console.error('usage: node tools/meshy/rig_character.mjs <input-task-id> <outdir> [--height 2.2] [--go]');
  process.exit(2);
}

const body = { input_task_id: inputTaskId, height_meters: height };
console.log(`request: ${JSON.stringify(body, null, 2)}`);
if (!go) {
  console.log('\nDRY RUN — no credentials read, no network calls, no credits spent. Re-run with --go to send.');
  process.exit(0);
}

let key;
try {
  key = readFileSync(new URL('../../.local/meshy/api-key.txt', import.meta.url), 'utf8').trim();
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

const before = await balance();
console.log(`balance before: ${before}`);
const { result: taskId } = await api('/v1/rigging', { method: 'POST', body: JSON.stringify(body) });
console.log(`task: ${taskId}`);
let task;
for (let i = 0; i < 240; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  task = await api(`/v1/rigging/${taskId}`);
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
writeFileSync(`${outDir}/rig-task.json`, JSON.stringify(task, null, 2));
const rigUrl = task.result?.rigged_character_glb_url;
if (!rigUrl) throw new Error('Meshy rig task succeeded without result.rigged_character_glb_url');
const rigged = Buffer.from(await fetch(rigUrl).then((res) => {
  if (!res.ok) throw new Error(`rigged GLB download failed: ${res.status}`);
  return res.arrayBuffer();
}));
writeFileSync(`${outDir}/rigged.glb`, rigged);
console.log(`wrote ${outDir}/rigged.glb (${rigged.length} bytes)`);

// The API may include basic walk/run outputs. Preserve them as source evidence without treating them
// as accepted gameplay clips; GalaQuest still measures every clip against this exact rig.
for (const [name, url] of Object.entries(task.result?.basic_animations ?? {})) {
  if (!name.endsWith('_glb_url') || !url) continue;
  const bytes = Buffer.from(await fetch(url).then((res) => {
    if (!res.ok) throw new Error(`${name} download failed: ${res.status}`);
    return res.arrayBuffer();
  }));
  writeFileSync(`${outDir}/${name.replace(/_glb_url$/, '')}.glb`, bytes);
}
