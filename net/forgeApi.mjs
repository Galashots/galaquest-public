import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const MESHY_API = 'https://api.meshy.ai/openapi';
const MAX_JSON_BYTES = 12 * 1024 * 1024;
const LOCAL_KEY_URL = new URL('../.local/meshy/api-key.txt', import.meta.url);

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': body.byteLength,
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(body);
}

async function resolveMeshyKey() {
  if (process.env.MESHY_API_KEY?.trim()) return process.env.MESHY_API_KEY.trim();
  try {
    const local = (await readFile(LOCAL_KEY_URL, 'utf8')).trim();
    return local || null;
  } catch {
    return null;
  }
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  if (left.byteLength !== right.byteLength || left.byteLength === 0) return false;
  return timingSafeEqual(left, right);
}

function requestToken(request) {
  const direct = request.headers['x-gq-forge-token'];
  if (Array.isArray(direct)) return direct[0] ?? '';
  return direct ?? '';
}

function requireForgeToken(request, response) {
  const expected = process.env.GALAQUEST_FORGE_TOKEN?.trim();
  if (!expected) {
    sendJson(response, 503, {
      error: 'forge_locked',
      message: 'Paid Forge actions are disabled until GALAQUEST_FORGE_TOKEN is configured on the server.',
    });
    return false;
  }
  if (!safeEqual(requestToken(request), expected)) {
    sendJson(response, 401, { error: 'unauthorized', message: 'Forge unlock token is missing or incorrect.' });
    return false;
  }
  return true;
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.byteLength;
    if (bytes > MAX_JSON_BYTES) throw Object.assign(new Error('request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('request body must be valid JSON'), { status: 400 });
  }
}

function assertDataImage(value) {
  if (typeof value !== 'string' || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/i.test(value)) {
    throw Object.assign(new Error('imageDataUrl must be a PNG/JPEG base64 data URI'), { status: 400 });
  }
  if (value.length > MAX_JSON_BYTES - 1024) {
    throw Object.assign(new Error('imageDataUrl is too large for the Forge bridge'), { status: 413 });
  }
  return value;
}

/** Pure request normalization so CI can pin the credit-spend gate without touching Meshy. */
export function normalizeForgeImageTo3DRequest(input = {}) {
  if (input.approvedPaidTask !== true) {
    throw Object.assign(new Error('explicit paid-task approval is required'), { status: 400 });
  }

  const aiModel = input.aiModel ?? 'meshy-6';
  if (!['meshy-6', 'latest'].includes(aiModel)) {
    throw Object.assign(new Error(`unsupported aiModel ${aiModel}`), { status: 400 });
  }

  const poseMode = input.poseMode || null;
  if (poseMode !== null && !['a-pose', 't-pose'].includes(poseMode)) {
    throw Object.assign(new Error(`unsupported poseMode ${poseMode}`), { status: 400 });
  }

  const targetPolycount = Number(input.targetPolycount ?? 20_000);
  if (!Number.isInteger(targetPolycount) || targetPolycount < 500 || targetPolycount > 80_000) {
    throw Object.assign(new Error('targetPolycount must be an integer from 500 to 80000'), { status: 400 });
  }

  const body = {
    image_url: assertDataImage(input.imageDataUrl),
    ai_model: aiModel,
    model_type: 'standard',
    topology: 'triangle',
    target_polycount: targetPolycount,
    should_remesh: true,
    should_texture: input.shouldTexture !== false,
    enable_pbr: Boolean(input.enablePbr),
    image_enhancement: input.imageEnhancement !== false,
    target_formats: ['glb'],
  };
  if (poseMode) body.pose_mode = poseMode;
  // Meshy currently documents remove_lighting for Meshy 6. Keep `latest` forward-compatible rather
  // than sending a field the provider may not support on a future model alias.
  if (aiModel === 'meshy-6') body.remove_lighting = input.removeLighting !== false;
  return body;
}

async function meshyJson(key, path, init = {}) {
  const response = await fetch(`${MESHY_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { message: text.slice(0, 500) }; }
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.detail || `Meshy request failed with ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function validTaskId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,100}$/.test(value);
}

async function taskFor(key, taskId) {
  if (!validTaskId(taskId)) throw Object.assign(new Error('invalid Meshy task id'), { status: 400 });
  return meshyJson(key, `/v1/image-to-3d/${taskId}`);
}

/**
 * Handle only /api/forge/* requests. Returns false for every other path so server.mjs can continue
 * with the existing static/runtime handler unchanged.
 */
export async function handleForgeApiRequest(request, response) {
  const url = new URL(request.url ?? '/', 'http://forge.local');
  if (!url.pathname.startsWith('/api/forge/')) return false;

  try {
    const key = await resolveMeshyKey();

    if (request.method === 'GET' && url.pathname === '/api/forge/meshy/status') {
      sendJson(response, 200, {
        configured: Boolean(key),
        spendLocked: true,
        tokenConfigured: Boolean(process.env.GALAQUEST_FORGE_TOKEN?.trim()),
      });
      return true;
    }

    if (!requireForgeToken(request, response)) return true;
    if (!key) {
      sendJson(response, 503, {
        error: 'meshy_not_configured',
        message: 'Set MESHY_API_KEY or .local/meshy/api-key.txt before using Meshy from the Forge.',
      });
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/forge/meshy/balance') {
      const balance = await meshyJson(key, '/v1/balance');
      sendJson(response, 200, balance);
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/forge/meshy/image-to-3d') {
      const input = await readJsonBody(request);
      const body = normalizeForgeImageTo3DRequest(input);
      const created = await meshyJson(key, '/v1/image-to-3d', { method: 'POST', body: JSON.stringify(body) });
      sendJson(response, 202, { taskId: created.result });
      return true;
    }

    const taskMatch = url.pathname.match(/^\/api\/forge\/meshy\/image-to-3d\/([^/]+)$/);
    if (request.method === 'GET' && taskMatch) {
      const task = await taskFor(key, taskMatch[1]);
      sendJson(response, 200, task);
      return true;
    }

    const modelMatch = url.pathname.match(/^\/api\/forge\/meshy\/image-to-3d\/([^/]+)\/model\.glb$/);
    if (request.method === 'GET' && modelMatch) {
      const task = await taskFor(key, modelMatch[1]);
      if (task.status !== 'SUCCEEDED' || !task.model_urls?.glb) {
        sendJson(response, 409, { error: 'model_not_ready', status: task.status, progress: task.progress ?? 0 });
        return true;
      }
      const modelUrl = new URL(task.model_urls.glb);
      if (modelUrl.hostname !== 'assets.meshy.ai' && !modelUrl.hostname.endsWith('.assets.meshy.ai')) {
        throw Object.assign(new Error('Meshy returned an unexpected model host'), { status: 502 });
      }
      const model = await fetch(modelUrl);
      if (!model.ok) throw Object.assign(new Error(`Meshy model download failed with ${model.status}`), { status: 502 });
      const bytes = Buffer.from(await model.arrayBuffer());
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': bytes.byteLength,
        'content-type': 'model/gltf-binary',
      });
      response.end(bytes);
      return true;
    }

    sendJson(response, 404, { error: 'not_found', message: 'Unknown Forge API route.' });
    return true;
  } catch (error) {
    sendJson(response, Number(error.status) || 502, {
      error: 'forge_api_error',
      message: error.message,
      provider: error.payload ?? undefined,
    });
    return true;
  }
}
