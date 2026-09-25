// One text prompt to one reference image, bracketed by balance reads so cost is MEASURED.
//
// Same guard shape as tools/meshy/image_to_3d.mjs:
// - dry-run is the default and is fully offline; only --go (or --recover) reads credentials;
// - the key file is gitignored (.local/meshy/api-key.txt) or passed with --key-file; never printed;
// - balance is read before and after; the task's own consumed_credits is the authoritative cost;
// - submission.json is persisted immediately after the task id is returned, so a failed poll or
//   download is recovered with --recover <task-id> (read-only, no new task, no spend) instead of
//   paying again.
//
// Meshy API authority (verified 2026-09-24 against https://docs.meshy.ai/en/api/text-to-image):
//   POST /openapi/v1/text-to-image  { ai_model, prompt, aspect_ratio?, pose_mode?, remove_background?,
//                                     generate_multi_view? }  -> { result: <task id> }
//   GET  /openapi/v1/text-to-image/:id -> { status, progress, image_urls[], consumed_credits, task_error }
//   ai_model: nano-banana (3), nano-banana-2 (6), nano-banana-pro (9), gpt-image-2 (9) credits.
//   generate_multi_view and aspect_ratio cannot be combined.
//
// Usage:
//   node tools/meshy/text_to_image.mjs <outdir> (--prompt "<text>" | --prompt-file <file>)
//        [--model nano-banana-2] [--aspect 1:1] [--pose t-pose|a-pose] [--remove-bg]
//        [--name <stem>] [--key-file <file>] [--go]
//   node tools/meshy/text_to_image.mjs <outdir> --recover <task-id> [--name <stem>] [--key-file <file>]

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const outDir = args[0];
const opt = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const go = args.includes('--go');
const recoverId = opt('--recover');
const model = opt('--model') ?? 'nano-banana-2';
const aspect = opt('--aspect');
const pose = opt('--pose');
const removeBg = args.includes('--remove-bg');
const stem = opt('--name') ?? 'reference';
const keyPath = opt('--key-file') ?? new URL('../../.local/meshy/api-key.txt', import.meta.url);
const promptFile = opt('--prompt-file');
const prompt = promptFile ? readFileSync(promptFile, 'utf8').trim() : opt('--prompt');

const MODELS = { 'nano-banana': 3, 'nano-banana-2': 6, 'nano-banana-pro': 9, 'gpt-image-2': 9 };
const ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];
const usage = 'usage: node tools/meshy/text_to_image.mjs <outdir> (--prompt "<text>" | --prompt-file <file>) '
  + '[--model nano-banana-2] [--aspect 1:1] [--pose t-pose|a-pose] [--remove-bg] [--name stem] [--key-file F] [--go]\n'
  + '       node tools/meshy/text_to_image.mjs <outdir> --recover <task-id> [--name stem] [--key-file F]';
if (!outDir || outDir.startsWith('--') || (!recoverId && !prompt)
    || !(model in MODELS) || (aspect !== undefined && !ASPECTS.includes(aspect))
    || (pose !== undefined && !['t-pose', 'a-pose'].includes(pose))
    || !/^[a-zA-Z0-9._-]+$/.test(stem)) {
  console.error(usage);
  process.exit(2);
}

const body = recoverId ? null : {
  ai_model: model,
  prompt,
  ...(aspect ? { aspect_ratio: aspect } : {}),
  ...(pose ? { pose_mode: pose } : {}),
  ...(removeBg ? { remove_background: true } : {}),
};
const promptSha256 = prompt ? createHash('sha256').update(prompt).digest('hex') : null;

if (body) {
  console.log(`request: ${JSON.stringify({ ...body, prompt: `<${prompt.length} chars, sha256 ${promptSha256.slice(0, 16)}...>` }, null, 2)}`);
  console.log(`prompt text:\n${prompt}\n`);
  console.log(`nominal cost: ${MODELS[model]} credits (the task's consumed_credits is authoritative)`);
}
if (!go && !recoverId) {
  console.log('\nDRY RUN — no credentials read, no network calls, no credits spent. Re-run with --go to send.');
  process.exit(0);
}

let key;
try {
  key = readFileSync(keyPath, 'utf8').trim();
} catch {
  console.error('Meshy API key file is unavailable');
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

mkdirSync(outDir, { recursive: true });
let taskId = recoverId;
let before = null;
if (recoverId) {
  console.log(`RECOVER — polling existing task ${recoverId}; no new task is created, no credits spent.`);
} else {
  before = await balance();
  console.log(`balance before: ${before}`);
  ({ result: taskId } = await api('/v1/text-to-image', { method: 'POST', body: JSON.stringify(body) }));
  console.log(`task: ${taskId}`);
  writeFileSync(`${outDir}/submission.json`, JSON.stringify({
    taskId, before, model, aspect: aspect ?? null, pose: pose ?? null, removeBackground: removeBg,
    promptSha256, prompt, submittedAt: new Date().toISOString(),
  }, null, 2));
}

let task;
for (let i = 0; i < 180; i += 1) {
  task = await api(`/v1/text-to-image/${taskId}`);
  process.stdout.write(`\r  ${task.status} ${task.progress ?? 0}%   `);
  if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(task.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 4000));
}
console.log('');
writeFileSync(`${outDir}/task.json`, JSON.stringify(task, null, 2));
if (task?.status !== 'SUCCEEDED') {
  throw new Error(`task ended ${task?.status ?? 'TIMEOUT'}: ${JSON.stringify(task?.task_error ?? {})}`);
}

const after = await balance();
const consumed = task.consumed_credits;
console.log(`\nCOST OF THIS TASK: ${consumed ?? '(api reported none)'} credits <- authoritative`);
if (before !== null) {
  console.log(`balance ${before} -> ${after} (delta ${before - after})`);
  if (consumed !== undefined && before - after !== consumed) {
    console.log('NOTE: balance delta differs from consumed_credits; other account activity may be concurrent.');
  }
} else {
  console.log(`balance now: ${after}`);
}

const urls = task.image_urls ?? [];
if (!urls.length) throw new Error('Meshy task succeeded without image_urls');
const written = [];
for (const [i, url] of urls.entries()) {
  const bytes = Buffer.from(await fetch(url).then((res) => {
    if (!res.ok) throw new Error(`image download failed: ${res.status}`);
    return res.arrayBuffer();
  }));
  const path = `${outDir}/${stem}${urls.length > 1 ? `_${i}` : ''}.png`;
  writeFileSync(path, bytes);
  written.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
writeFileSync(`${outDir}/result.json`, JSON.stringify({
  taskId, model: task.ai_model ?? model, before, after, consumed_credits: consumed ?? null,
  promptSha256, images: written,
}, null, 2));
for (const w of written) console.log(`wrote ${w.path} (${w.bytes} bytes, sha256 ${w.sha256.slice(0, 16)}...)`);
