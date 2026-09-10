import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

import { startOwnedServer } from '../runtime-test/owned-server.mjs';

const delay = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
assert.equal(manifest.buildFlavor, 'LOCAL_CANDIDATE_REVIEW');
assert.equal(manifest.productionPromotion, false);
const clientSha = manifest.sourceSha;
const serverSha = process.env.GQ_REVIEW_SERVER_SHA || clientSha;
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), serverSha);
assert.equal(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
for (const file of manifest.files) {
  const bytes = readFileSync(join('unity/GalaQuest/Builds/GalaQuestWebGL/Build', file.name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.name);
}

const suffix = process.argv[3] ?? '-forge';
assert.match(suffix, /^-[a-z0-9-]+$/);
const output = resolve(`.local/unity-playtest/browser-${clientSha.slice(0, 7)}${suffix}`);
mkdirSync(output, { recursive: true });
const chromeProfile = mkdtempSync(join(tmpdir(), 'gq-forge-chrome-'));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
    this.ws.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) { this.events.push(message); return; }
      const task = this.pending.get(message.id);
      if (!task) return;
      this.pending.delete(message.id);
      clearTimeout(task.timer);
      message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result);
    });
  }
  ready() {
    return new Promise((resolvePromise, reject) => {
      this.ws.addEventListener('open', resolvePromise, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timeout`));
      }, 30000);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
}

const waitFor = async (action, predicate, label, timeout = 30000, interval = 60) => {
  const until = Date.now() + timeout;
  let value;
  while (Date.now() < until) {
    value = await action();
    if (predicate(value)) return value;
    await delay(interval);
  }
  throw new Error(`${label}: ${JSON.stringify(value).slice(0, 1600)}`);
};

const snapshot = page => page.eval(`(()=>{
  const frames=window.__gqUnityCp2Diagnostics?.serverFrames??[];
  return [...frames].reverse().find(frame=>frame.type==='snapshot'||frame.type==='welcome'||frame.type==='destination-changed')??null;
})()`);
const reconciliation = page => page.eval('window.__gqUnityCp2Diagnostics?.latestReconciliation ?? null');
const forgeFrames = page => page.eval('(window.__gqUnityCp2Diagnostics?.serverFrames??[]).filter(frame=>frame.type==="forge-state")');
const controls = async page => {
  const projected = await page.eval('window.__gqRuneForgeControls ?? []');
  if (projected.length > 0) return projected;
  const frames = await forgeFrames(page);
  const forge = frames.at(-1)?.forge ?? page.lastForge?.forge;
  if (page.rect) {
    // Visually measured from this one authored Forge pocket. These bounded fallbacks
    // still enter through the canvas touch/raycast seam and each consequential tap
    // must produce the expected authoritative server state before the driver advances.
    const at = (kind, value, x, y) => ({ kind, value,
      x: page.rect.x + page.rect.width * x,
      y: page.rect.y + page.rect.height * y });
    if (!forge) return [at('open', '', .666, .488)];
    if (forge.status === 'choose-pack') {
      const control = at('pack', 'place-value-rounding', .738, .462);
      control.points = [
        [control.x, control.y],
        [control.x - 24, control.y], [control.x + 24, control.y],
        [control.x, control.y - 22], [control.x, control.y + 22],
        [page.rect.x + page.rect.width * .661, page.rect.y + page.rect.height * .482],
      ];
      return [control];
    }
    if (forge.status === 'active') {
      const runeX = [.581, .656, .731];
      return [
        ...(forge.task?.choices ?? []).map((choice, index) =>
          at('rune', String(choice), runeX[index], .494)),
        at('hammer', '', .762, .470),
        at('hint', '', .539, .482),
        at('hear', '', .537, .465),
      ];
    }
    if (forge.status === 'ready-to-claim') return [at('claim', '', .654, .469)];
    if (forge.status === 'owned') return [at('equip', '', .654, .469)];
  }
  return [];
};
const key = (page, type, value) => page.send('Input.dispatchKeyEvent', {
  type, key: value, code: value === ' ' ? 'Space' : `Key${value.toUpperCase()}`,
  windowsVirtualKeyCode: value === ' ' ? 32 : value.toUpperCase().charCodeAt(0),
});
const touch = (page, type, touchPoints) => page.send('Input.dispatchTouchEvent', { type, touchPoints });
const tapAt = async (page, x, y) => {
  await touch(page, 'touchStart', [{ id: 7, x, y, radiusX: 9, radiusY: 9, force: 1 }]);
  await delay(90);
  await touch(page, 'touchEnd', []);
};
const capture = async (page, name) => {
  const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(output, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
};
const moveAxis = async (page, keyName, axis, target) => {
  const start = (await reconciliation(page)).authoritative[axis];
  if (Math.abs(start - target) < .12) return;
  await key(page, 'keyUp', keyName);
  const releasedAt = (await reconciliation(page)).atMs;
  await waitFor(() => reconciliation(page), value => value.atMs > releasedAt + 60, 'Neutral input frame');
  await key(page, 'keyDown', keyName);
  try {
    await waitFor(() => reconciliation(page), value => target > start
      ? value.authoritative[axis] >= target : value.authoritative[axis] <= target,
    `Move ${axis} to ${target}`, 18000);
  } finally {
    await key(page, 'keyUp', keyName);
  }
  await delay(180);
};

const checks = {};
const pages = [];
let browser;
let chrome;
let server;

try {
  server = await startOwnedServer({ quiet: true });
  chrome = spawn(process.env.GQ_CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    '--window-size=1180,820', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    `--user-data-dir=${chromeProfile}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  const endpoint = await waitFor(async () => {
    try { return readFileSync(join(chromeProfile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); }
    catch (error) { if (['ENOENT', 'EBUSY'].includes(error.code)) return null; throw error; }
  }, value => value?.length === 2 && Number(value[0]) > 0, 'Chrome endpoint', 15000, 100);
  const [port, browserPath] = endpoint;
  browser = new CDP(`ws://127.0.0.1:${port}${browserPath}`);
  await browser.ready();

  const createPlayer = async (profileId, displayName) => {
    const { browserContextId } = await browser.send('Target.createBrowserContext');
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
    const page = new CDP(targets.find(target => target.id === targetId).webSocketDebuggerUrl);
    await page.ready();
    pages.push(page);
    for (const api of ['Runtime.enable', 'Page.enable', 'Log.enable']) await page.send(api);
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1180, height: 820, deviceScaleFactor: 1, mobile: false,
    });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const bootstrap = `
      if(location.origin===${JSON.stringify(server.origin)}&&!localStorage.getItem('gq-profiles')){
        localStorage.setItem('gq-profiles',${JSON.stringify(JSON.stringify({
          v: 1, activeProfileId: profileId, profiles: [{ id: profileId, displayName }],
        }))});
      }
      window.__forgeSpeech=[];
      if(window.speechSynthesis){
        const nativeSpeak=window.speechSynthesis.speak.bind(window.speechSynthesis);
        window.speechSynthesis.speak=function(utterance){window.__forgeSpeech.push(utterance.text);return nativeSpeak(utterance)};
      }
    `;
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: bootstrap });
    await page.send('Page.navigate', { url: `${server.origin}/unity/` });
    await waitFor(() => reconciliation(page), Boolean, `Unity join ${displayName}`, 180000, 1000);
    page.id = await page.eval('window.__gqUnityCp2Diagnostics.serverFrames.find(frame=>frame.type==="welcome").id');
    page.rect = await page.eval('(()=>{const r=document.querySelector("#unity-canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
    page.profileId = profileId;
    console.log(`Connected ${displayName} ${page.id}`);
    return page;
  };

  const travelToForge = async page => {
    await page.send('Page.bringToFront');
    const here = await snapshot(page);
    if (here.destinationId === 'home-hub') {
      await moveAxis(page, 'w', 'z', 4.8);
      const rect = await page.eval('(()=>{const r=document.querySelector("#unity-canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
      await tapAt(page, rect.x + rect.width / 2 - 100, rect.y + rect.height - 55);
      await waitFor(() => snapshot(page), value => value?.destinationId === 'emberworks-deep', 'Emberworks arrival');
    }
    // Clear the right Cinder Gate pillar before moving east. At the arrival z=4 its
    // expanded collision face is x=5.4, so an axis-first route is physically blocked.
    await moveAxis(page, 'w', 'z', 6.0);
    await moveAxis(page, 'd', 'x', 5.0);
    await moveAxis(page, 'w', 'z', 15.0);
    await waitFor(() => controls(page), value => value.length > 0, 'Physical Forge controls projected');
  };

  const latestForge = async page => {
    const frames = await forgeFrames(page);
    return frames.at(-1) ?? null;
  };
  const press = async (page, kind, value = undefined, expectedStatus = undefined) => {
    const before = (await forgeFrames(page)).length;
    const control = await waitFor(() => controls(page), list => list.some(item => item.kind === kind
      && (value === undefined || item.value === value)), `Visible ${kind} control`)
      .then(list => list.find(item => item.kind === kind && (value === undefined || item.value === value)));
    const points = control.points ?? [[control.x, control.y]];
    for (const [x, y] of points) {
      await tapAt(page, x, y);
      if (points.length === 1 || (await forgeFrames(page)).length > before) break;
      await delay(320);
    }
    if (['rune', 'hear', 'equip'].includes(kind)) return control;
    const response = await waitFor(() => forgeFrames(page), list => list.length > before
      && (!expectedStatus || list.at(-1)?.forge?.status === expectedStatus), `${kind} response`)
      .then(list => list.at(-1));
    page.lastForge = response;
    return response;
  };

  const younger = await createPlayer('profile-aaaaaaaa', 'Younger Forge Review');
  await travelToForge(younger);
  await capture(younger, '01-dormant-prize');
  checks.dormant = { reconciliation: await reconciliation(younger), controls: await controls(younger) };

  let state = await press(younger, 'open', undefined, 'choose-pack');
  assert.equal(state.forge.owned, false);
  await capture(younger, '02-awake-choose-pack');
  state = await press(younger, 'pack', 'place-value-rounding', 'active');
  assert.equal(state.forge.task.id, 'value-4582-hundreds');
  await capture(younger, '03-number-runes-ready');

  await press(younger, 'rune', '5000');
  state = await press(younger, 'hammer', undefined, 'active');
  assert.equal(state.forge.response, 'retry');
  assert.equal(state.forge.completedCount, 0);
  checks.wrongRetry = state.forge;
  await capture(younger, '04-wrong-answer-retry');

  state = await press(younger, 'hint', undefined, 'active');
  assert.equal(state.forge.response, 'hint');
  await press(younger, 'hear');
  await waitFor(() => younger.eval('window.__forgeSpeech'), value => value.includes('In four thousand five hundred eighty-two, what is the value of five?'), 'Gesture-started spoken prompt');
  await press(younger, 'rune', '500');
  state = await press(younger, 'hammer', undefined, 'active');
  assert.equal(state.forge.response, 'assisted-success');
  assert.equal(state.forge.completedCount, 1);
  assert.equal(state.forge.task.id, 'round-6742-hundred');
  checks.assisted = state.forge;

  await press(younger, 'rune', '6700');
  state = await press(younger, 'hammer', undefined, 'ready-to-claim');
  assert.equal(state.forge.response, 'independent-success');
  assert.equal(state.forge.completedCount, 2);
  await capture(younger, '05-cage-released');

  state = await press(younger, 'claim', undefined, 'owned');
  assert.equal(state.forge.response, 'claimed');
  assert.equal(state.forge.justGranted, true);
  const entitlementId = 'forge-entitlement:profile-aaaaaaaa:emberworks.rune-forge.magmalord-helmet.v1';
  const factsAfterClaim = await younger.eval("JSON.parse(localStorage.getItem('gq-journal:profile-aaaaaaaa')).facts");
  assert.equal(factsAfterClaim.filter(fact => fact.eventId === entitlementId).length, 1);
  checks.claim = { forge: state.forge, facts: factsAfterClaim };
  await capture(younger, '06-claimed-explicit-equip');

  const beforeEquipPower = await younger.eval('window.__gqUnityCp2Diagnostics.latestProgression?.power');
  await press(younger, 'equip');
  const equippedFrame = await waitFor(() => snapshot(younger), frame =>
    frame?.encounter?.rewards?.[younger.id]?.equippedItemIds?.helmet === 'helmet_magmalord', 'Authoritative equipped helmet');
  const equippedPower = await waitFor(() => younger.eval('window.__gqUnityCp2Diagnostics.latestProgression?.power'), value => value > beforeEquipPower, 'POWER follows equipped item');
  checks.equipped = { powerBefore: beforeEquipPower, powerAfter: equippedPower, frame: equippedFrame };
  await delay(300);
  await capture(younger, '07-worn-magmalord-helmet');

  const older = await createPlayer('profile-bbbbbbbb', 'Older Forge Review');
  await travelToForge(older);
  const olderState = await press(older, 'open', undefined, 'choose-pack');
  assert.equal(olderState.forge.owned, false, 'A late sibling retains a personal opportunity');
  assert.equal((await younger.eval("JSON.parse(localStorage.getItem('gq-journal:profile-aaaaaaaa')).facts"))
    .filter(fact => fact.eventId === entitlementId).length, 1, 'Sibling arrival does not reset or duplicate owner');
  checks.lateSibling = olderState.forge;
  await capture(older, '08-late-sibling-own-forge');

  const supersededId = younger.id;
  const replacement = await createPlayer('profile-aaaaaaaa', 'Younger Replacement');
  await waitFor(() => younger.eval('Object.keys(window.__gqUnitySockets.sockets).length'), value => value === 0, 'Superseded socket retired');
  await delay(4500);
  assert.equal(await younger.eval('Object.keys(window.__gqUnitySockets.sockets).length'), 0, 'Superseded page cannot retake profile');
  await travelToForge(replacement);
  const replacementState = await press(replacement, 'open', undefined, 'owned');
  assert.equal(replacementState.forge.owned, true);
  assert.equal(replacementState.forge.justGranted, undefined);
  const replacementFacts = await replacement.eval("JSON.parse(localStorage.getItem('gq-journal:profile-aaaaaaaa')).facts");
  assert.equal(replacementFacts.filter(fact => fact.eventId === entitlementId).length, 1, 'Takeover hydrates exactly one entitlement');
  assert.ok(!(await snapshot(replacement)).players.some(player => player.id === supersededId));
  assert.ok(!(await controls(replacement)).some(control => control.kind === 'claim'));
  checks.takeover = { supersededId, replacementId: replacement.id, forge: replacementState.forge };
  await capture(replacement, '09-takeover-owned-state');

  const reconnectId = replacement.id;
  await replacement.eval("Object.values(window.__gqUnitySockets.sockets).forEach(socket=>socket.close(1000,'forge reconnect review'))");
  const reconnected = await waitFor(() => snapshot(replacement), frame => frame?.destinationId === 'emberworks-deep'
    && frame.players.some(player => player.id !== reconnectId && player.id !== older.id), 'Reconnect to last destination', 25000, 100);
  replacement.id = reconnected.players.find(player => player.id !== older.id).id;
  const restoredFacts = await replacement.eval("JSON.parse(localStorage.getItem('gq-journal:profile-aaaaaaaa')).facts");
  assert.equal(restoredFacts.filter(fact => fact.eventId === entitlementId).length, 1);
  assert.equal(reconnected.encounter.rewards[replacement.id].equippedItemIds.helmet, 'helmet_magmalord');
  checks.reconnect = { previousId: reconnectId, activeId: replacement.id, frame: reconnected };
  await capture(replacement, '10-reconnected-worn-reward');

  const errors = pages.flatMap(page => page.events.filter(event =>
    event.method === 'Runtime.exceptionThrown'
    || (event.method === 'Log.entryAdded' && event.params.entry.level === 'error')
    || (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error')));
  writeFileSync(join(output, 'report.json'), JSON.stringify({
    clientSha, serverSha, manifest, origin: server.origin, checks, errors,
  }, null, 2));
  assert.equal(errors.length, 0, 'No uncaught browser exceptions, browser-log errors, or console.error events');
  console.log(JSON.stringify({ clientSha, serverSha, output, result: 'PASS', checks: Object.keys(checks) }));
} catch (error) {
  writeFileSync(join(output, 'failure.json'), JSON.stringify({
    clientSha, serverSha, message: error.stack, checks,
    clients: await Promise.all(pages.map(async page => ({
      snapshot: await snapshot(page).catch(() => null),
      controls: await controls(page).catch(() => null), events: page.events,
    }))),
  }, null, 2));
  for (let index = 0; index < pages.length; index++) await capture(pages[index], `failure-${index}`).catch(() => {});
  throw error;
} finally {
  if (browser) await browser.send('Browser.close').catch(() => {});
  for (const page of pages) page.ws.close();
  browser?.ws.close();
  if (chrome?.exitCode === null) chrome.kill();
  if (server) await server.kill();
}
