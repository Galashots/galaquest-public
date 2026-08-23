import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

import { attachGameServer } from './net/gameServer.mjs';
import { handleForgeApiRequest } from './net/forgeApi.mjs';

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

/**
 * A 1x1 transparent GIF: the smallest thing that is unambiguously an image to every browser.
 *
 * Shipped as bytes rather than as a file so there is no asset to lose, and as a GIF rather than as
 * the empty SVG index.html uses because this answers a request for `.ico` -- a real raster body is
 * what every browser will accept there without argument.
 */
const EMPTY_FAVICON = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64',
);

export function createRuntimeServer() {
  return createServer(async (request, response) => {
    try {
      // The Asset Forge API is same-origin with the game so generated model bytes can move directly
      // into the real Three.js inspection scene without exposing the Meshy credential to the browser.
      // handleForgeApiRequest returns false for every non-Forge URL, preserving the existing runtime.
      if (await handleForgeApiRequest(request, response)) return;

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' });
        response.end('method not allowed');
        return;
      }

      // A BROWSER ASKS FOR THIS WITHOUT BEING TOLD TO, on any document that does not declare an
      // icon. index.html declares an empty one, so the game itself is quiet; every OTHER page on
      // this origin -- a vendored module opened directly, a harness hop, a parent poking at a URL --
      // still triggers the automatic request and logs a 404 nobody asked for.
      //
      // Found by drive-profile-gate, which is the one harness that collects Log.entryAdded and so is
      // the only one that can see it. Allowlisting it was the older habit here; this removes the
      // cause instead, for every page rather than for the one that noticed.
      //
      // A REAL 200 WITH A BODY, NOT A 204, AND THAT IS NOT A STYLE CHOICE. My first version answered
      // 204 No Content, which is the textbook answer for "there is no icon" -- and it broke five
      // harnesses at once. `drive-village-board`, `drive-beacon-siege`, `drive-cart-loot`,
      // `drive-hero-screen` and `drive-profile-gate` all navigate to /favicon.ico deliberately, as a
      // same-origin blank page to set localStorage on before the real load (GQ-016's clear-before-pin
      // needs somewhere to stand). A 204 tells the browser to STAY WHERE IT IS, so the waypoint never
      // arrived and the harness threw after three attempts.
      //
      // The lesson is not about favicons: a route added to silence a log line is still a route, and
      // five callers already depended on this one's navigation behaviour. Grep before you answer
      // differently, even when the new answer is more correct in the abstract.
      if (request.url === '/favicon.ico') {
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-length': EMPTY_FAVICON.byteLength,
          'content-type': 'image/gif',
        });
        response.end(request.method === 'HEAD' ? undefined : EMPTY_FAVICON);
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
  startRuntimeServer(port, { rewardStorePath });
}
