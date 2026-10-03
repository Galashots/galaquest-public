import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGameServer } from '../server.mjs';

let server;
let port;

before(async () => {
  server = createGameServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(() => {
  server.closeAllConnections?.();
  server.close();
});

// Raw request so the path is sent exactly as given (no URL normalisation).
function request(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET / serves the game html', async () => {
  const res = await request('/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /html/);
  assert.ok(res.body.includes('Hatch'));
});

test('GET /src/main.js is javascript', async () => {
  const res = await request('/src/main.js');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /javascript/);
});

test('GET /farm/ redirects to /', async () => {
  const res = await request('/farm/');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/');
});

test('path traversal does not leak server source', async () => {
  const res = await request('/%2e%2e/server.mjs');
  assert.ok([403, 404].includes(res.status), `unexpected status ${res.status}`);
  assert.ok(!res.body.includes('createGameServer'));
});

test('POST / is rejected with 405', async () => {
  const res = await request('/', 'POST');
  assert.equal(res.status, 405);
});

test('missing file is 404', async () => {
  const res = await request('/no-such-file.txt');
  assert.equal(res.status, 404);
});
