// Headless-Chromium screenshots of the game at two iPad viewports, over raw CDP.
// Usage: node tools/screenshot.mjs [--out <dir>] [--save <file.json>]   (default tmp/screenshots)
// --save writes that JSON (a full localStorage payload) to the save key before capture, so a
// mid-game state can be photographed. --click <selector> (repeatable) clicks that element, in order,
// before capture, so a dialog can be photographed.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createGameServer } from '../server.mjs';

const VIEWPORTS = [
  { name: 'landscape', width: 1024, height: 768 },
  { name: 'portrait', width: 768, height: 1024 },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = '/opt/pw-browsers';
  if (existsSync(base)) {
    for (const dir of readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      const bin = join(base, dir, 'chrome-linux', 'chrome');
      if (existsSync(bin)) return bin;
    }
  }
  return 'google-chrome'; // PATH lookup; `chromium` is tried if this fails to spawn
}

const outIndex = process.argv.indexOf('--out');
const outDir = resolve(outIndex > 0 ? process.argv[outIndex + 1] : 'tmp/screenshots');
const saveIndex = process.argv.indexOf('--save');
const saveJson = saveIndex > 0 ? readFileSync(resolve(process.argv[saveIndex + 1]), 'utf8') : null;
const clicks = process.argv.flatMap((a, i) => (a === '--click' ? [process.argv[i + 1]] : []));
const SAVE_KEY = 'gq.farmSlice.v1';
const errors = [];
let chrome, server, profile, ws;

// Minimal CDP client: send(method, params, sessionId) and an event hook.
let nextId = 1;
const pending = new Map();
let onEvent = () => {};
function send(method, params = {}, sessionId) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((res, rej) => pending.set(id, { res, rej, method }));
}

function noteEvent(msg) {
  const { method, params } = msg;
  if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
    errors.push(`console.error: ${params.args.map((a) => a.value ?? a.description).join(' ')}`);
  } else if (method === 'Runtime.exceptionThrown') {
    const d = params.exceptionDetails;
    errors.push(`exception: ${d.exception?.description ?? d.text}`);
  } else if (method === 'Log.entryAdded' && params.entry.level === 'error') {
    const { text, url } = params.entry;
    if (!(url ?? '').endsWith('/favicon.ico') && !text.includes('/favicon.ico')) errors.push(`log: ${text} ${url ?? ''}`);
  }
}

async function launchChrome() {
  const args = [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-sandbox',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--disable-gpu-sandbox', 'about:blank',
  ];
  let bin = findChrome();
  chrome = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (bin === 'google-chrome') {
    // Fall back to chromium on PATH if google-chrome is not installed.
    const failed = await new Promise((r) => { chrome.once('error', () => r(true)); setTimeout(() => r(false), 300); });
    if (failed) chrome = spawn('chromium', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  }
  return new Promise((res, rej) => {
    let buf = '';
    chrome.on('error', rej);
    chrome.on('exit', (code) => rej(new Error(`chrome exited early (${code}): ${buf.slice(-300)}`)));
    chrome.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) res(m[1]);
    });
  });
}

async function capture(sessionId, url, vp) {
  await send('Emulation.setDeviceMetricsOverride',
    { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: true }, sessionId);
  if (saveJson) {
    // Seed localStorage from a plain (non-game) file on the same origin, so the game itself loads
    // only once. Loading the game first and then reloading cut its model downloads off mid-way,
    // which Chrome reports as a texture error.
    await send('Page.navigate', { url: `${url}content/index.js` }, sessionId);
    await sleep(300);
    await send('Runtime.evaluate', {
      expression: `localStorage.setItem(${JSON.stringify(SAVE_KEY)}, ${JSON.stringify(saveJson)})`,
    }, sessionId);
  }
  await send('Page.navigate', { url }, sessionId);
  const start = Date.now();
  for (;;) {
    const { result } = await send('Runtime.evaluate', {
      expression: `!!document.querySelector('canvas') && performance.now() > 3000`,
      returnByValue: true,
    }, sessionId);
    if (result.value === true) break;
    if (Date.now() - start > 30000) throw new Error(`timeout waiting for canvas (${vp.name})`);
    await sleep(250);
  }
  for (const selector of clicks) {
    await sleep(300);
    const { result } = await send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.click(); return !!el; })()`,
      returnByValue: true,
    }, sessionId);
    if (!result.value) throw new Error(`--click: nothing matches ${selector}`);
  }
  await sleep(500); // let a few more frames render
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const file = join(outDir, `${vp.name}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(file);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  server = createGameServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  profile = mkdtempSync(join(tmpdir(), 'gq-shot-'));

  const wsUrl = await launchChrome();
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('devtools ws failed')); });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.rej(new Error(`${p.method}: ${msg.error.message}`)); else p.res(msg.result);
    } else if (msg.method) noteEvent(msg);
  };

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await Promise.all(['Runtime', 'Log', 'Page'].map((d) => send(`${d}.enable`, {}, sessionId)));
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
  for (const vp of VIEWPORTS) await capture(sessionId, url, vp);
}

let failure;
try {
  await main();
} catch (error) {
  failure = error;
  errors.push(`script: ${error.message}`);
} finally {
  try { ws?.close(); } catch {}
  chrome?.removeAllListeners('exit');
  chrome?.kill('SIGKILL');
  server?.closeAllConnections?.();
  server?.close();
  if (profile) {
    await sleep(200); // Chrome may still be flushing files
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}

if (errors.length) {
  console.log(`FAIL: ${errors.length} browser errors`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log('OK');
process.exit(0);
