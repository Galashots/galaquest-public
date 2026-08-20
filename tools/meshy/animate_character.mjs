// Apply one Meshy animation-library action to one completed Meshy rig task.
//
// Meshy API authority (verified 2026-08-20): POST /openapi/v1/animations requires rig_task_id and
// integer action_id. A successful task exposes result.animation_glb_url and consumed_credits.
// This tool intentionally does NOT decide which action is good: GalaQuest measures each candidate
// with pose_anatomy.mjs / verify_native_clip.mjs before accepting another paid clip.
//
// Usage:
//   node tools/meshy/animate_character.mjs <rig-task-id> <action-id> <outdir> [--name attack] [--go]
//
// DRY RUN is the default and is fully offline. --go is the only path that reads credentials or
// creates a paid task.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const [rigTaskId, actionArg, outDir] = args;
const actionId = Number(actionArg);
const go = args.includes('--go');
const nameIndex = args.indexOf('--name');
const label = nameIndex >= 0 ? args[nameIndex + 1] : `action-${actionArg}`;
if (!rigTaskId || !outDir || !Number.isInteger(actionId) || actionId < 0 || !label) {
  console.error('usage: node tools/meshy/animate_character.mjs <rig-task-id> <action-id> <outdir> [--name label] [--go]');
  process.exit(2);
}
if (!/^[a-zA-Z0-9._-]+$/.test(label)) {
  console.error('--name may contain only letters, numbers, dot, underscore, and dash');
  process.exit(2);
}

const body = { rig_task_id: rigTaskId, action_id: actionId };
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
const { result: taskId } = await api('/v1/animations', { method: 'POST', body: JSON.stringify(body) });
console.log(`task: ${taskId}`);
let task;
for (let i = 0; i < 240; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  task = await api(`/v1/animations/${taskId}`);
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
writeFileSync(`${outDir}/${label}-task.json`, JSON.stringify(task, null, 2));
const animationUrl = task.result?.animation_glb_url;
if (!animationUrl) throw new Error('Meshy animation task succeeded without result.animation_glb_url');
const animation = Buffer.from(await fetch(animationUrl).then((res) => {
  if (!res.ok) throw new Error(`animation GLB download failed: ${res.status}`);
  return res.arrayBuffer();
}));
writeFileSync(`${outDir}/${label}.glb`, animation);
console.log(`wrote ${outDir}/${label}.glb (${animation.length} bytes)`);
