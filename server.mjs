// Static file server for the game. No dependencies: `node server.mjs [port]`.
// Serves game/ at the site root and prints LAN URLs so an iPad on the same Wi-Fi can play.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

export const DEFAULT_PORT = 5201;
export const GAME_DIR = resolve(fileURLToPath(new URL('./game', import.meta.url)));

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

/** Resolve a request path inside `root`, or null if it escapes. */
export function resolveInside(root, pathname) {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
  const full = resolve(root, relative || 'index.html');
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

export function createGameServer({ root = GAME_DIR } = {}) {
  return createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' });
        response.end('method not allowed');
        return;
      }
      const { pathname } = new URL(request.url ?? '/', 'http://local');
      // Old links pointed at /farm/; the game now lives at the root.
      if (pathname === '/farm' || pathname.startsWith('/farm/')) {
        response.writeHead(302, { location: '/' });
        response.end();
        return;
      }
      const fullPath = resolveInside(root, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
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
      response.end(notFound ? 'not found' : 'server error');
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? DEFAULT_PORT);
  createGameServer().listen(port, '0.0.0.0', () => {
    console.log(`Hatch & Harvest: http://localhost:${port}/`);
    for (const address of lanAddresses()) console.log(`  on your Wi-Fi: http://${address}:${port}/`);
  });
}
