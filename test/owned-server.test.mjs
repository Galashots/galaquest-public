// tools/runtime-test/owned-server.mjs's kill() reliability fix (SR5 closeout, 2026-08-16). Real
// process spawn/kill, not mocked -- the defect this pins (a graceful-only kill() resolving without
// error while the child stayed alive and reachable) was only ever caught by watching the REAL process
// and REAL port, so a mock of child_process would prove nothing about the actual fix. Slower than the
// rest of the unit suite (each test boots a real server.mjs child) but still bounded to a few seconds.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createProbeServer } from 'node:net';
import { startOwnedServer } from '../tools/runtime-test/owned-server.mjs';

// MUST probe '0.0.0.0', the exact host server.mjs itself binds -- see owned-server.mjs's own portFree()
// for why probing '127.0.0.1' instead silently lies on Windows (the exact bug this test file pins).
function portFree(port) {
  return new Promise((resolve) => {
    const tester = createProbeServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => tester.close(() => resolve(true)));
    tester.listen(port, '0.0.0.0');
  });
}

test('kill() terminates the real owned child and the port is independently confirmed free afterward', async () => {
  const server = await startOwnedServer({ quiet: true });
  assert.equal(await portFree(server.port), false, 'the server should genuinely be listening before kill()');

  const result = await server.kill();

  assert.equal(result, true, 'kill() should report a trustworthy true, not just "an exit event fired"');
  assert.equal(await portFree(server.port), true, 'the port must be independently verified free, not merely assumed');
});

test('kill() is idempotent -- calling it a second time after the child already exited still confirms free and does not throw', async () => {
  const server = await startOwnedServer({ quiet: true });
  await server.kill();
  const second = await server.kill();
  assert.equal(second, true);
  assert.equal(await portFree(server.port), true);
});

test('two owned servers started back to back each get their own port, and killing one does not affect the other', async () => {
  const first = await startOwnedServer({ quiet: true });
  const second = await startOwnedServer({ quiet: true });
  assert.notEqual(first.port, second.port, 'first-free-wins must not hand out the same port twice while the first is still up');

  await first.kill();
  assert.equal(await portFree(first.port), true);
  assert.equal(await portFree(second.port), false, 'killing the first owned server must not touch the second');

  await second.kill();
  assert.equal(await portFree(second.port), true);
});
