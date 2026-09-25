// A tiny zero-dependency static file server for local testing of the farm
// slice prototype. Not used in production -- the real repo has its own
// server.mjs for public/. Run with: node serve.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 5310;
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
};

function safePath(requestUrl) {
  const pathname = new URL(requestUrl, 'http://runtime.local').pathname;
  const decoded = decodeURIComponent(pathname);
  const relative = normalize(decoded).replace(/^([/\\]|\.\.[/\\])+/, '');
  const full = resolve(ROOT, relative || 'index.html');
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  return full;
}

const server = createServer(async (req, res) => {
  const requested = safePath(req.url || '/');
  if (!requested) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  let filePath = requested;
  try {
    const stat = await import('node:fs/promises').then((fs) => fs.stat(filePath));
    if (stat.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // fall through -- readFile below will 404
  }

  try {
    const data = await readFile(filePath);
    const type = CONTENT_TYPES[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Farm slice serving at http://localhost:${PORT}/`);
});
