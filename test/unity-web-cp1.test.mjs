import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { createRuntimeServer } from '../server.mjs';

async function servingUnityBuild(body) {
  const root = mkdtempSync(join(tmpdir(), 'galaquest-unity-web-'));
  mkdirSync(join(root, 'Build'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<canvas id="unity-canvas"></canvas>');
  writeFileSync(join(root, 'Build', 'GalaQuestWebGL.wasm'), Buffer.from([0, 97, 115, 109]));
  writeFileSync(join(root, 'Build', 'GalaQuestWebGL.data'), Buffer.from([1, 2, 3]));
  writeFileSync(join(root, 'Build', 'GalaQuestWebGL.wasm.br'), Buffer.from([4, 5, 6]));
  writeFileSync(join(root, 'Build', 'GalaQuestWebGL.framework.js.br'), Buffer.from([7, 8, 9]));

  const server = createRuntimeServer({ unityWebBuildDir: root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await body(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
}

test('the ignored Unity Web build is served under one bounded same-origin path', async () => {
  await servingUnityBuild(async (origin) => {
    const entry = await fetch(`${origin}/unity/`);
    assert.equal(entry.status, 200);
    assert.match(entry.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await entry.text(), /unity-canvas/);

    const wasm = await fetch(`${origin}/unity/Build/GalaQuestWebGL.wasm`);
    assert.equal(wasm.status, 200);
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');
    assert.equal(wasm.headers.get('cache-control'), 'no-store');

    const data = await fetch(`${origin}/unity/Build/GalaQuestWebGL.data`);
    assert.equal(data.status, 200);
    assert.equal(data.headers.get('content-type'), 'application/octet-stream');

    const compressedWasm = await fetch(`${origin}/unity/Build/GalaQuestWebGL.wasm.br`);
    assert.equal(compressedWasm.status, 200);
    assert.equal(compressedWasm.headers.get('content-type'), 'application/wasm');
    assert.equal(compressedWasm.headers.get('content-encoding'), 'br');

    const compressedFramework = await fetch(`${origin}/unity/Build/GalaQuestWebGL.framework.js.br`);
    assert.equal(compressedFramework.status, 200);
    assert.match(compressedFramework.headers.get('content-type') ?? '', /text\/javascript/);
    assert.equal(compressedFramework.headers.get('content-encoding'), 'br');

    for (const path of ['/unity/..%2Fserver.mjs', '/unity/%2e%2e%2Fserver.mjs']) {
      const response = await fetch(`${origin}${path}`);
      assert.ok(response.status === 403 || response.status === 404, `${path} answered ${response.status}`);
      assert.doesNotMatch(await response.text(), /createRuntimeServer/);
    }
  });
});

function loadBrowserBridge(storageSeed) {
  const storage = new Map(Object.entries(storageSeed));
  const messages = [];
  const sockets = [];
  const gestureListeners = [];
  const canvas = { style: {} };
  const document = {
    documentElement: { style: {} },
    body: { style: {} },
    querySelector: (selector) => selector === '#unity-canvas' ? canvas : null,
    addEventListener: (name, listener, options) => gestureListeners.push({ name, listener, options }),
  };

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }

    open() {
      this.readyState = 1;
      this.onopen?.();
    }

    receive(data) {
      this.onmessage?.({ data });
    }

    send(data) {
      this.sent.push(data);
    }

    close(code = 1000, reason = '') {
      this.readyState = 3;
      this.onclose?.({ code, reason });
    }
  }
  FakeWebSocket.OPEN = 1;

  const context = {
    console,
    LibraryManager: { library: {} },
    mergeInto: (target, source) => Object.assign(target, source),
    UTF8ToString: (value) => value,
    SendMessage: (gameObject, method, payload) => messages.push({ gameObject, method, payload }),
    WebSocket: FakeWebSocket,
    document,
    window: {
      location: { protocol: 'http:', host: '127.0.0.1:5201' },
      localStorage: {
        getItem: (key) => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, String(value)),
      },
    },
  };
  const source = readFileSync(
    new URL('../unity/GalaQuest/Assets/Plugins/WebGL/GalaQuestBrowserBridge.jslib', import.meta.url),
    'utf8',
  );
  vm.runInNewContext(source, context, { filename: 'GalaQuestBrowserBridge.jslib' });
  return { bridge: context.LibraryManager.library, messages, sockets, storage, document, canvas, gestureListeners };
}

const PROFILE_A = 'profile-aaaaaaaa';
const PROFILE_B = 'profile-bbbbbbbb';
const FACT_A = { eventId: 'mark:a', type: 'mark-earned' };
const FACT_B = { eventId: 'coin:b', type: 'coin-earned' };

function familyStorage(activeProfileId) {
  return {
    'gq-profiles': JSON.stringify({
      v: 1,
      activeProfileId,
      profiles: [
        { id: PROFILE_A, displayName: 'Aster' },
        { id: PROFILE_B, displayName: 'Bramble' },
      ],
    }),
    [`gq-journal:${PROFILE_A}`]: JSON.stringify({ v: 1, facts: [FACT_A] }),
    [`gq-journal:${PROFILE_B}`]: JSON.stringify({ v: 1, facts: [FACT_B] }),
  };
}

function readSelected(runtime) {
  runtime.messages.length = 0;
  const storageBefore = [...runtime.storage.entries()];
  runtime.bridge.GQ_Profile_ReadSelected('GalaQuestRuntime', 'OnBrowserProfile');
  assert.equal(runtime.messages.length, 1);
  assert.deepEqual([...runtime.storage.entries()], storageBefore, 'the Unity bridge must not write profile storage');
  return JSON.parse(runtime.messages[0].payload);
}

test('browser bridge reads only the active existing profile and that profile journal: A -> B -> A', () => {
  const runtime = loadBrowserBridge(familyStorage(PROFILE_A));

  const firstA = readSelected(runtime);
  assert.equal(firstA.profileId, PROFILE_A);
  assert.equal(firstA.displayName, 'Aster');
  assert.deepEqual(JSON.parse(firstA.factsJson), [FACT_A]);

  const keyring = JSON.parse(runtime.storage.get('gq-profiles'));
  keyring.activeProfileId = PROFILE_B;
  runtime.storage.set('gq-profiles', JSON.stringify(keyring));
  const b = readSelected(runtime);
  assert.equal(b.profileId, PROFILE_B);
  assert.equal(b.displayName, 'Bramble');
  assert.deepEqual(JSON.parse(b.factsJson), [FACT_B]);
  assert.doesNotMatch(b.factsJson, /mark:a/);

  keyring.activeProfileId = PROFILE_A;
  runtime.storage.set('gq-profiles', JSON.stringify(keyring));
  const secondA = readSelected(runtime);
  assert.equal(secondA.profileId, PROFILE_A);
  assert.deepEqual(JSON.parse(secondA.factsJson), [FACT_A]);
  assert.doesNotMatch(secondA.factsJson, /coin:b/);
});

test('browser WebSocket bridge targets same-origin /ws and preserves messages verbatim', () => {
  const runtime = loadBrowserBridge(familyStorage(PROFILE_A));
  const id = runtime.bridge.GQ_WebSocket_Connect(
    'GalaQuestRuntime', 'OnSocketOpen', 'OnSocketMessage', 'OnSocketClose',
  );
  assert.equal(id, 1);
  assert.equal(runtime.sockets[0].url, 'ws://127.0.0.1:5201/ws');

  runtime.sockets[0].open();
  assert.deepEqual(runtime.messages.at(-1), {
    gameObject: 'GalaQuestRuntime', method: 'OnSocketOpen', payload: '1',
  });

  const join = '{"v":4,"type":"join","name":"Aster","guestId":"profile-aaaaaaaa"}';
  runtime.bridge.GQ_WebSocket_Send(id, join);
  assert.deepEqual(runtime.sockets[0].sent, [join]);

  const welcome = '{"v":4,"type":"welcome","id":"p1"}';
  runtime.sockets[0].receive(welcome);
  assert.deepEqual(runtime.messages.at(-1), {
    gameObject: 'GalaQuestRuntime', method: 'OnSocketMessage', payload: welcome,
  });
});

test('Unity touch surface blocks Safari page gestures without hiding a rescue interaction', () => {
  const runtime = loadBrowserBridge(familyStorage(PROFILE_A));

  runtime.bridge.GQ_Touch_ConfigureSurface();
  runtime.bridge.GQ_Touch_ConfigureSurface();

  assert.equal(runtime.canvas.style.touchAction, 'none');
  assert.equal(runtime.canvas.style.userSelect, 'none');
  assert.equal(runtime.canvas.style.webkitUserSelect, 'none');
  assert.equal(runtime.document.documentElement.style.overscrollBehavior, 'none');
  assert.equal(runtime.document.body.style.overscrollBehavior, 'none');
  assert.equal(runtime.document.body.style.overflow, 'hidden');
  assert.deepEqual(runtime.gestureListeners.map(({ name }) => name), [
    'gesturestart', 'gesturechange', 'gestureend',
  ]);
  assert.ok(runtime.gestureListeners.every(({ options }) => options.passive === false));
});
