import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleForgeApiRequest,
  resetForgeSpendStateForTests,
  SPEND_RATE_LIMIT,
} from '../net/forgeApi.mjs';

// These tests exercise the real request handler with a stubbed global fetch: the provider is never
// contacted, no credential is real, and no credits can be spent. What they pin is the spend-safety
// contract itself: fail-closed enablement, idempotent generation-start, and the rate guard.

const IMAGE = 'data:image/png;base64,aGVsbG8=';
const TOKEN = 'test-unlock-token';

function makeRequest({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  return {
    method,
    url,
    headers,
    async* [Symbol.asyncIterator]() {
      if (body !== null) yield Buffer.from(JSON.stringify(body));
    },
  };
}

function makeResponse() {
  const captured = { statusCode: null, headers: null, body: null };
  return {
    captured,
    writeHead(statusCode, headers) { captured.statusCode = statusCode; captured.headers = headers; },
    end(chunk) { captured.body = chunk ? JSON.parse(Buffer.from(chunk).toString('utf8')) : null; },
  };
}

async function call(request) {
  const response = makeResponse();
  const handled = await handleForgeApiRequest(request, response);
  assert.equal(handled, true);
  return response.captured;
}

function generationBody(overrides = {}) {
  return {
    approvedPaidTask: true,
    idempotencyKey: 'attempt-0001-abcdef',
    imageDataUrl: IMAGE,
    aiModel: 'meshy-6',
    targetPolycount: 12000,
    ...overrides,
  };
}

function postGeneration(body) {
  return makeRequest({
    method: 'POST',
    url: '/api/forge/meshy/image-to-3d',
    headers: { 'x-gq-forge-token': TOKEN },
    body,
  });
}

const ENV_KEYS = ['GALAQUEST_FORGE_ENABLED', 'GALAQUEST_FORGE_TOKEN', 'MESHY_API_KEY'];

function withEnvironment(env, providerResponses, run) {
  const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  const providerCalls = [];
  return (async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    Object.assign(process.env, env);
    resetForgeSpendStateForTests();
    globalThis.fetch = async (url, init = {}) => {
      providerCalls.push({ url: String(url), method: init.method ?? 'GET' });
      const respond = providerResponses[providerCalls.length - 1] ?? providerResponses.at(-1);
      const payload = typeof respond === 'function' ? respond() : respond;
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
    };
    try {
      return await run(providerCalls);
    } finally {
      globalThis.fetch = savedFetch;
      for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
      }
      resetForgeSpendStateForTests();
    }
  })();
}

const FORGE_ON = { GALAQUEST_FORGE_ENABLED: '1', GALAQUEST_FORGE_TOKEN: TOKEN, MESHY_API_KEY: 'k-test' };

test('paid Forge routes fail closed without GALAQUEST_FORGE_ENABLED even when credentials exist', async () => {
  await withEnvironment({ GALAQUEST_FORGE_TOKEN: TOKEN, MESHY_API_KEY: 'k-test' }, [{}], async (providerCalls) => {
    const post = await call(postGeneration(generationBody()));
    assert.equal(post.statusCode, 503);
    assert.equal(post.body.error, 'forge_disabled');

    const balance = await call(makeRequest({ url: '/api/forge/meshy/balance', headers: { 'x-gq-forge-token': TOKEN } }));
    assert.equal(balance.statusCode, 503);
    assert.equal(balance.body.error, 'forge_disabled');

    const task = await call(makeRequest({ url: '/api/forge/meshy/image-to-3d/task-abc-123', headers: { 'x-gq-forge-token': TOKEN } }));
    assert.equal(task.statusCode, 503);

    assert.equal(providerCalls.length, 0, 'a disabled host must never contact the provider');
  });
});

test('a disabled host reveals nothing about its configuration through the status probe', async () => {
  await withEnvironment({ GALAQUEST_FORGE_TOKEN: TOKEN, MESHY_API_KEY: 'k-test' }, [{}], async () => {
    const status = await call(makeRequest({ url: '/api/forge/meshy/status' }));
    assert.equal(status.statusCode, 200);
    assert.deepEqual(status.body, { enabled: false, spendLocked: true });
    assert.equal('configured' in status.body, false);
    assert.equal('tokenConfigured' in status.body, false);
  });
});

test('secretless CI environment cannot spend: no enablement, no key, no token', async () => {
  await withEnvironment({}, [{}], async (providerCalls) => {
    const status = await call(makeRequest({ url: '/api/forge/meshy/status' }));
    assert.deepEqual(status.body, { enabled: false, spendLocked: true });
    const post = await call(postGeneration(generationBody()));
    assert.equal(post.statusCode, 503);
    assert.equal(providerCalls.length, 0);
  });
});

test('task status and balance stay locked behind the unlock token when enabled', async () => {
  await withEnvironment(FORGE_ON, [{}], async (providerCalls) => {
    const noToken = await call(makeRequest({ url: '/api/forge/meshy/image-to-3d/task-abc-123' }));
    assert.equal(noToken.statusCode, 401);
    const wrongToken = await call(makeRequest({ url: '/api/forge/meshy/balance', headers: { 'x-gq-forge-token': 'wrong' } }));
    assert.equal(wrongToken.statusCode, 401);
    assert.equal(providerCalls.length, 0);
  });
});

test('generation-start without an idempotency key is rejected before any provider call', async () => {
  await withEnvironment(FORGE_ON, [{}], async (providerCalls) => {
    const { idempotencyKey, ...withoutKey } = generationBody();
    const post = await call(postGeneration(withoutKey));
    assert.equal(post.statusCode, 400);
    assert.match(post.body.message, /idempotencyKey/);
    assert.equal(providerCalls.length, 0);
  });
});

test('repeated generation-start with the same idempotency key creates exactly one provider task', async () => {
  await withEnvironment(FORGE_ON, [{ result: 'task-abc-123' }], async (providerCalls) => {
    const first = await call(postGeneration(generationBody()));
    assert.equal(first.statusCode, 202);
    assert.equal(first.body.taskId, 'task-abc-123');
    assert.equal(first.body.replayed, false);

    const second = await call(postGeneration(generationBody()));
    assert.equal(second.statusCode, 202);
    assert.equal(second.body.taskId, 'task-abc-123');
    assert.equal(second.body.replayed, true);

    assert.equal(providerCalls.length, 1, 'the duplicate submission must not reach the provider');
  });
});

test('reusing an idempotency key for a different payload is a conflict, not a second spend', async () => {
  await withEnvironment(FORGE_ON, [{ result: 'task-abc-123' }], async (providerCalls) => {
    await call(postGeneration(generationBody()));
    const conflicting = await call(postGeneration(generationBody({ targetPolycount: 30000 })));
    assert.equal(conflicting.statusCode, 409);
    assert.equal(providerCalls.length, 1);
  });
});

test('the spend rate guard bounds distinct paid submissions inside the window', async () => {
  await withEnvironment(FORGE_ON, [() => ({ result: `task-${Math.random().toString(36).slice(2, 12)}` })], async (providerCalls) => {
    for (let attempt = 0; attempt < SPEND_RATE_LIMIT; attempt += 1) {
      const ok = await call(postGeneration(generationBody({ idempotencyKey: `attempt-${attempt}-abcdef` })));
      assert.equal(ok.statusCode, 202);
    }
    const throttled = await call(postGeneration(generationBody({ idempotencyKey: 'attempt-over-abcdef' })));
    assert.equal(throttled.statusCode, 429);
    assert.equal(providerCalls.length, SPEND_RATE_LIMIT);
  });
});
