/**
 * Owner Review Mode browser gate. Exercises the actual Character Studio DOM/WebGL surface rather
 * than only the pure review-packet helpers:
 *   - Review Mode locks the exact Studio context and source SHA;
 *   - pointer input creates normalized annotations on the overlay;
 *   - a no-mark capture contains real rendered Studio pixels, not a cleared WebGL buffer;
 *   - the exported packet carries the target/view/time/note/annotations and an annotated PNG;
 *   - a Studio state mutation invalidates the packet rather than silently rebinding annotations;
 *   - portrait and landscape review panels protect the inspection surface.
 *
 * Appearance is still a human gate. This harness proves mechanics and writes captures for review.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startOwnedServer } from './owned-server.mjs';
import { PORTRAIT_VIEWPORT, LANDSCAPE_VIEWPORT } from '../../public/src/review/cameraPresets.js';

const CHROME_PORT = 9224;
const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';
const OUT = fileURLToPath(new URL('../../.local/runtime-test/owner-review/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const server = await startOwnedServer();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let failures = 0;
function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  }
  ready() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('websocket error')), { once: true });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 20000);
    });
  }
  async eval(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails) {
      throw new Error(`eval threw: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text}`);
    }
    return response.result.value;
  }
}

const version = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`).then((response) => response.json());
const browser = new CDP(version.webSocketDebuggerUrl);
await browser.ready();

async function openStudio(viewport) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const targets = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`).then((response) => response.json());
  const target = targets.find((item) => item.id === targetId);
  const page = new CDP(target.webSocketDebuggerUrl);
  await page.ready();
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  const exceptions = [];
  page.ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
  });
  await page.send('Emulation.setDeviceMetricsOverride', viewport);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.send('Storage.clearDataForOrigin', { origin: server.origin, storageTypes: 'local_storage' });
  await page.send('Page.navigate', {
    url: `${server.url}studio.html?ref=owner-review-ci&sourceSha=${SOURCE_SHA}`,
  });
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
    await sleep(500);
    ready = await page.eval('Boolean(window.__galaQuestStudioReady && window.__galaQuestReview)').catch(() => false);
  }
  return { page, targetId, ready, exceptions };
}

async function screenshot(page, name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}${name}.png`, Buffer.from(data, 'base64'));
}

async function imageStatsFromPacket(page) {
  return page.eval(`(async () => {
    const packet = await window.__galaQuestReview.buildPacket({ includeImage: true });
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = packet.image.dataUrl;
    });
    const sample = document.createElement('canvas');
    sample.width = 32;
    sample.height = 32;
    const ctx = sample.getContext('2d');
    ctx.drawImage(image, 0, 0, 32, 32);
    const pixels = ctx.getImageData(0, 0, 32, 32).data;
    const colours = new Set();
    let opaque = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 200) opaque += 1;
      colours.add(((pixels[i] >> 4) << 8) | ((pixels[i + 1] >> 4) << 4) | (pixels[i + 2] >> 4));
    }
    return {
      prefix: packet.image.dataUrl.slice(0, 22),
      dataLength: packet.image.dataUrl.length,
      uniqueColours: colours.size,
      opaquePixels: opaque,
      packetJsonLength: JSON.stringify(packet).length,
      sourceSha: packet.source.sha,
      target: packet.studioState.reviewTarget,
      view: packet.studioState.view,
      clip: packet.studioState.clipName,
      time: packet.studioState.animationTimeSeconds,
      annotations: packet.annotations.length,
      note: packet.review.note,
      authority: packet.authority,
    };
  })()`);
}

const portrait = await openStudio(PORTRAIT_VIEWPORT);
check('Owner Review Studio boots at portrait', portrait.ready);
if (!portrait.ready) {
  console.log('exceptions:', portrait.exceptions);
  await browser.send('Target.closeTarget', { targetId: portrait.targetId });
  await server.kill();
  process.exit(1);
}

const { page } = portrait;
await page.eval(`(async () => {
  await window.__galaQuestStudio.setLoadout('candidate-wildwood-blade');
  window.__galaQuestStudio.setAnimationPlaying(false);
  window.__galaQuestStudio.setAnimationTime(0.42);
  window.__galaQuestStudio.setView('closeup', 'opposite-side');
})()`);
await sleep(250);

const opened = await page.eval(`(() => {
  window.__galaQuestReview.open();
  const review = window.__galaQuestReview.getState();
  const panel = document.querySelector('#review-panel').getBoundingClientRect();
  return {
    active: review.active,
    sourceSha: review.source.sha,
    target: review.frozenStudioState.reviewTarget,
    view: review.frozenStudioState.view,
    time: review.frozenStudioState.animationTimeSeconds,
    playing: review.frozenStudioState.playing,
    panel: { x: panel.x, y: panel.y, width: panel.width, height: panel.height, bottom: panel.bottom },
    bodyReviewMode: document.body.classList.contains('review-mode'),
  };
})()`);
check('Review Mode locks active context', opened.active && opened.bodyReviewMode);
check('Review Mode binds explicit source SHA', opened.sourceSha === SOURCE_SHA, opened.sourceSha);
check('Review Mode freezes requested target/view',
  opened.target === 'sword_wildwood_w1a'
    && opened.view.scale === 'closeup'
    && opened.view.bearing === 'opposite-side',
  `${opened.target} ${opened.view.scale}/${opened.view.bearing}`);
check('Review Mode pauses before snapshot', opened.playing === false);
check('Review Mode preserves requested animation time', Math.abs(opened.time - 0.42) < 0.001, String(opened.time));
check('Portrait review panel protects the inspection surface',
  opened.panel.width < PORTRAIT_VIEWPORT.width * 0.55
    && opened.panel.height <= PORTRAIT_VIEWPORT.height * 0.47
    && opened.panel.bottom <= PORTRAIT_VIEWPORT.height + 1,
  JSON.stringify(opened.panel));

// Build once with NO marks. This is the critical WebGL-buffer seam: if captureStudioFrameDataUrl
// fires after Chrome has cleared the non-preserved drawing buffer, the composed image collapses to a
// blank/transparent frame. The downsample must contain real opaque colour variation before any
// annotation can hide the failure.
const baseImage = await imageStatsFromPacket(page);
check('Review packet carries a PNG data URL', baseImage.prefix === 'data:image/png;base64,', baseImage.prefix);
check('Review packet captures real Studio pixels before annotations',
  baseImage.opaquePixels > 900 && baseImage.uniqueColours > 12,
  `opaque=${baseImage.opaquePixels}/1024 colours=${baseImage.uniqueColours}`);
check('Review packet is bound to exact target/view/time',
  baseImage.sourceSha === SOURCE_SHA
    && baseImage.target === 'sword_wildwood_w1a'
    && baseImage.view.scale === 'closeup'
    && baseImage.view.bearing === 'opposite-side'
    && Math.abs(baseImage.time - 0.42) < 0.001,
  `${baseImage.target} ${baseImage.view.scale}/${baseImage.view.bearing} @ ${baseImage.time}`);
check('No-mark packet starts with zero annotations', baseImage.annotations === 0);
check('Owner packet authority cannot promote or visually accept',
  baseImage.authority?.productionAuthority === false && baseImage.authority?.visualAcceptance === false);

// Actual pointer path, not only the programmatic addAnnotation seam.
await page.eval(`(() => {
  window.__galaQuestReview.setTool('arrow');
  document.querySelector('#review-note').value = 'This arrow marks the palm/hilt seating angle that future sword reviews must reproduce.';
})()`);
await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 420, y: 500, button: 'left', clickCount: 1 });
await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 500, y: 555, button: 'left' });
await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 500, y: 555, button: 'left', clickCount: 1 });
await sleep(100);
const markState = await page.eval(`(() => {
  const state = window.__galaQuestReview.getState();
  return { count: state.annotations.length, annotation: state.annotations[0] ?? null };
})()`);
check('Pointer input creates one annotation', markState.count === 1, JSON.stringify(markState.annotation));
check('Pointer annotation is normalized and uses selected tool',
  markState.annotation?.tool === 'arrow'
    && markState.annotation.start.x > 0 && markState.annotation.start.x < 1
    && markState.annotation.end.y > 0 && markState.annotation.end.y < 1,
  JSON.stringify(markState.annotation));

const markedPacket = await imageStatsFromPacket(page);
check('Marked packet preserves owner note', markedPacket.note.includes('palm/hilt seating angle'));
check('Marked packet carries annotation and serializable image',
  markedPacket.annotations === 1 && markedPacket.dataLength > 10000 && markedPacket.packetJsonLength > markedPacket.dataLength,
  `annotations=${markedPacket.annotations} png=${markedPacket.dataLength} json=${markedPacket.packetJsonLength}`);
await screenshot(page, 'portrait-owner-review-annotated');

// A camera/state move after annotations exist must invalidate rather than silently rebind the marks.
await page.eval(`window.__galaQuestStudio.setView('inspection', 'front')`);
const invalid = await page.eval(`(async () => {
  const state = window.__galaQuestReview.getState();
  let error = null;
  try {
    await window.__galaQuestReview.buildPacket({ includeImage: false });
  } catch (caught) {
    error = caught.message;
  }
  return { contextInvalid: state.contextInvalid, error };
})()`);
check('Studio mutation invalidates the active review', invalid.contextInvalid === true);
check('Invalidated review refuses export/build', /changed after Review Mode was opened/.test(invalid.error ?? ''), invalid.error ?? 'no error');

await page.eval(`window.__galaQuestReview.close()`);
const closed = await page.eval(`({
  active: window.__galaQuestReview.getState().active,
  panelHidden: document.querySelector('#review-panel').hidden,
  openDisabled: document.querySelector('#review-open').disabled,
  reviewClass: document.body.classList.contains('review-mode'),
})`);
check('Closing Review Mode restores normal Studio controls',
  closed.active === false && closed.panelHidden === true && closed.openDisabled === false && closed.reviewClass === false,
  JSON.stringify(closed));

// Landscape layout gets its own open context and screenshot. Reopening after the camera change must
// clear the old marks rather than carrying a palm arrow into a new view.
await page.send('Emulation.setDeviceMetricsOverride', LANDSCAPE_VIEWPORT);
await sleep(250);
const landscape = await page.eval(`(() => {
  window.__galaQuestReview.open();
  const state = window.__galaQuestReview.getState();
  const panel = document.querySelector('#review-panel').getBoundingClientRect();
  return {
    count: state.annotations.length,
    invalid: state.contextInvalid,
    panel: { x: panel.x, y: panel.y, width: panel.width, height: panel.height, right: panel.right, bottom: panel.bottom },
  };
})()`);
check('Rebinding to a changed view clears old annotations', landscape.count === 0 && landscape.invalid === false,
  `count=${landscape.count} invalid=${landscape.invalid}`);
check('Landscape review panel stays a secondary right-side surface',
  landscape.panel.width < LANDSCAPE_VIEWPORT.width * 0.4
    && landscape.panel.right <= LANDSCAPE_VIEWPORT.width + 1
    && landscape.panel.bottom <= LANDSCAPE_VIEWPORT.height + 1,
  JSON.stringify(landscape.panel));
await page.eval(`window.__galaQuestReview.addAnnotation({ tool: 'circle', start: { x: 0.43, y: 0.42 }, end: { x: 0.60, y: 0.63 } })`);
await screenshot(page, 'landscape-owner-review-annotated');

check('No uncaught page exceptions during Owner Review gate', portrait.exceptions.length === 0,
  portrait.exceptions.slice(0, 3).join(' | '));

await browser.send('Target.closeTarget', { targetId: portrait.targetId });
await server.kill();
writeFileSync(`${OUT}results.json`, JSON.stringify({ results, failures }, null, 2));
console.log(`\n${results.length} checks, ${failures} failures. Evidence in ${OUT}`);
process.exit(failures ? 1 : 0);
