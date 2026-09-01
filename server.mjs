import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

import { attachGameServer } from './net/gameServer.mjs';
import { handleForgeApiRequest } from './net/forgeApi.mjs';
import { handleRegistryApiRequest } from './net/registryApi.mjs';

export const DEFAULT_PORT = 5201;
const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
export const PUBLIC_DIR = join(HERE, 'public');

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function safePath(requestUrl) {
  const pathname = new URL(requestUrl, 'http://runtime.local').pathname;
  const decoded = decodeURIComponent(pathname);
  const relative = normalize(decoded).replace(/^[/\\]+/, '');
  const full = resolve(PUBLIC_DIR, relative || 'index.html');
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + sep)) return null;
  return full;
}

export function createRuntimeServer() {
  return createServer(async (request, response) => {
    try {
      // The Asset Forge API is same-origin with the game so generated model bytes can move directly
      // into the real Three.js inspection scene without exposing the Meshy credential to the browser.
      // handleForgeApiRequest returns false for every non-Forge URL, preserving the existing runtime.
      if (await handleForgeApiRequest(request, response)) return;

      // Studio Library (#92 STUDIO-V2A): a read-only, same-origin passthrough of the canonical
      // asset registry, augmented with a live "can this checkout actually serve these bytes"
      // check. See net/registryApi.mjs's own header for why this is not a second asset database.
      if (await handleRegistryApiRequest(request, response)) return;

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' });
        response.end('method not allowed');
        return;
      }

      const fullPath = safePath(request.url ?? '/');
      if (!fullPath) {
        response.writeHead(403);
        response.end('forbidden');
        return;
      }

      const body = await readFile(fullPath);
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': body.byteLength,
        'content-type': CONTENT_TYPES[extname(fullPath).toLowerCase()] ?? 'application/octet-stream',
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      const notFound = error?.code === 'ENOENT' || error?.code === 'EISDIR';
      response.writeHead(notFound ? 404 : 500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(notFound ? 'not found' : `error: ${error.message}`);
      if (!notFound) console.error(error);
    }
  });
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

export function startRuntimeServer(port = DEFAULT_PORT, options = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`invalid runtime port: ${port}`);
  }
  if (port === 5199) {
    throw new Error('port 5199 belongs to the decision lab; choose a runtime port such as 5201');
  }

  const server = createRuntimeServer();
  // The multiplayer endpoint shares this port on purpose: one URL for both iPads, no second port to
  // forward, and no chance of the page loading from one host while the socket points at another.
  const game = attachGameServer(server, options);
  server.on('close', () => game.stop());
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`port ${port} is already in use; pass another port to node server.mjs`);
      process.exitCode = 1;
      return;
    }
    throw error;
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`GalaQuest runtime serving ${PUBLIC_DIR}`);
    console.log(`  cwd=${process.cwd()}`);
    console.log(`  port=${port}`);
    console.log(`  local=http://localhost:${port}/`);
    console.log(`  multiplayer=ws://localhost:${port}/ws`);
    console.log(`  forge=http://localhost:${port}/forge.html`);
    for (const address of lanAddresses()) console.log(`  lan=http://${address}:${port}/`);
  });
  return server;
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : null;
if (entrypoint === resolve(fileURLToPath(import.meta.url))) {
  const port = Number(process.argv[2] ?? DEFAULT_PORT);
  // GALAQUEST_REWARD_STORE_PATH is opt-in and unset for every real invocation (the family's own
  // `node server.mjs 5201`, and every other tools/runtime-test harness) -- it exists solely so a
  // harness that owns its own server (tools/runtime-test/owned-server.mjs) can point it at a scratch
  // file instead of the real, tracked data/rewards.db. Without this, a harness proving something as
  // permanent as Workshop I ownership (net/rewardStore.mjs's own durable, never-un-bought design)
  // would durably and irreversibly "buy" it in the children's real save. See data/README.md's own
  // "tests must never open a store at a path under data/" rule, extended here to this harness layer.
  const rewardStorePath = process.env.GALAQUEST_REWARD_STORE_PATH || undefined;
  // #87: GALAQUEST_TEST_GUARANTEED_CORPSE_ITEMS carries the identical opt-in discipline as
  // GALAQUEST_REWARD_STORE_PATH immediately above, and is unset for every real invocation -- the
  // family's own `node server.mjs 5201` never sets it, no npm script sets it, and the only writer
  // anywhere in the tree is tools/runtime-test/owned-server.mjs on behalf of one harness.
  //
  // WHY IT EXISTS. drive-corpse-loot.mjs has to reach a REAL personal corpse claim before it can
  // prove anything about the presenter, and a corpse only carries gear when an unseeded server dice
  // roll says so (world/enemyDrops.js: 20% on a frost-wolf, 0% on a common wolf). The hosted matrix
  // job spent its entire budget re-killing an enemy waiting for that roll and went red having never
  // once opened the loot panel it exists to test. This hands the server a fixed item list instead,
  // so the corpse itself, the claim, the wire, the presenter, and the collect path all stay real and
  // only the DICE stop being a coin flip a CI gate has to sit through.
  //
  // Unset -> the empty list -> net/gameServerCore.mjs behaves exactly as it did before this existed.
  const guaranteedCorpseItemIds = (process.env.GALAQUEST_TEST_GUARANTEED_CORPSE_ITEMS ?? '')
    .split(',').map((itemId) => itemId.trim()).filter((itemId) => itemId.length > 0);
  startRuntimeServer(port, { rewardStorePath, guaranteedCorpseItemIds });
}
