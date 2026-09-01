// Every harness that needs a runtime server must OWN it through one module, not spawn its own.
//
// This is the same lesson test/harness-game-url.test.mjs already learned one layer up, about the
// same two files. That test made "navigate to the game" have exactly one implementation after
// drive-ranger and drive-beacon-siege were found hand-building their own address. It did not notice
// that both were also hand-rolling the SERVER underneath that address, and that half stayed broken.
//
// What the hand-rolled half actually cost:
//
//   const server = spawn(..., { detached: true });
//   } finally { try { process.kill(-server.pid); } catch { /* already gone */ } }
//
// `process.kill(-pid)` kills a process GROUP. Process groups are POSIX; **Windows has none**, so on
// Windows that call throws and the empty catch swallows it, every time, silently. `detached: true`
// then guaranteed the server outlived the harness. And because the port was a FIXED literal rather
// than the shared pool's first-free, the next run did not get a fresh server -- it attached to the
// leaked one, still serving the PREVIOUS run's temp reward store.
//
// The failure that produced was `the seeded guest did not take: ... "marks":0`, which reads as a
// broken reward store or a broken guest seed. It is neither. It is a setup defect wearing a product
// defect's clothes, and it cost three consecutive runs during BW1 before the stale PID was spotted.
// The harness's own comment at that check even anticipates the confusion ("every check after this
// point reports a game defect that is really a setup defect") -- it just never considered that the
// server it was talking to might not be the one it thought it had started.
//
// owned-server.mjs already solved all of it: a port pool instead of a squatted literal, a kill()
// that will not claim success until portFree() independently confirms the port is released, and a
// process-level 'exit' net that process.exit() cannot skip. The rule is not "remember to use it".
// The rule is that there is one implementation, and this is what makes it the only one.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const HARNESS_DIR = join(import.meta.dirname, '..', 'tools', 'runtime-test');

/** Comments legitimately quote the forbidden shapes -- this file's own header does, and so do both
 *  repaired harnesses' explanations of why they were wrong. Scan code only, the same way
 *  test/harness-game-url.test.mjs does for its own patterns. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const harnesses = readdirSync(HARNESS_DIR)
  .filter((file) => file.endsWith('.mjs'))
  // owned-server.mjs is the one implementation; it is allowed to spawn, and it is the only one.
  .filter((file) => file !== 'owned-server.mjs');

/** A process-GROUP kill. POSIX-only, and silently a no-op-that-throws on Windows. */
const GROUP_KILL = /process\.kill\(\s*-/g;

/** A harness spawning `server.mjs` for itself instead of asking the shared module for one. */
const HAND_ROLLED_SERVER = /spawn\s*\([^)]*serverPath|spawn\s*\(\s*process\.execPath\s*,\s*\[[^\]]*server\.mjs/g;

/** `detached: true` -- what makes a leaked child outlive the run rather than dying with it. */
const DETACHED_CHILD = /detached\s*:\s*true/g;

function offendersFor(pattern) {
  const offenders = [];
  for (const file of harnesses) {
    const code = stripComments(readFileSync(join(HARNESS_DIR, file), 'utf8'));
    for (const match of code.matchAll(pattern)) {
      offenders.push(`${file}: ${match[0].replace(/\s+/g, ' ')}`);
    }
  }
  return offenders;
}

test('no harness kills a process GROUP -- that is POSIX-only and a silent no-op on Windows', () => {
  const offenders = offendersFor(GROUP_KILL);
  assert.deepEqual(offenders, [],
    'process.kill(-pid) throws on Windows and is usually swallowed by an empty catch, so the server '
    + `outlives the run and the NEXT run attaches to it -- await server.kill() instead:\n  ${offenders.join('\n  ')}`);
});

test('no harness spawns its own runtime server -- they all go through startOwnedServer', () => {
  const offenders = offendersFor(HAND_ROLLED_SERVER);
  assert.deepEqual(offenders, [],
    'a hand-rolled server misses the port pool, the verified teardown and the exit-handler net that '
    + `owned-server.mjs already provides:\n  ${offenders.join('\n  ')}`);
});

test('no harness detaches its child, which is what lets a leaked server outlive the run', () => {
  const offenders = offendersFor(DETACHED_CHILD);
  assert.deepEqual(offenders, [],
    `detached children survive the harness that made them:\n  ${offenders.join('\n  ')}`);
});

// The guards above are only worth their line count if they can actually fail. Each of these feeds
// the real pattern the real offending source used, because a guard verified against a hand-written
// approximation proves the approximation (docs/MISTAKES.md, GQ-022 and the sabotage rule).
test('sabotage: each guard DOES match the exact shape the two harnesses actually shipped', () => {
  const groupKill = '    try { process.kill(-server.pid); } catch { }';
  assert.equal(stripComments(groupKill).match(GROUP_KILL)?.length, 1,
    'the group-kill guard must match the literal line drive-ranger shipped four times');

  const handRolled = "  const server = spawn(process.execPath, [serverPath, String(port)], {\n"
    + "    env: { ...process.env, GALAQUEST_REWARD_STORE_PATH: storePath },\n"
    + "    stdio: 'ignore', detached: true,\n  });";
  assert.equal(stripComments(handRolled).match(HAND_ROLLED_SERVER)?.length, 1,
    'the hand-rolled-server guard must match the literal spawn drive-beacon-siege shipped');
  assert.equal(stripComments(handRolled).match(DETACHED_CHILD)?.length, 1,
    'the detached guard must match the same block');

  // And it must NOT fire on the legitimate module, or the rule would forbid its own implementation.
  const owned = readFileSync(join(HARNESS_DIR, 'owned-server.mjs'), 'utf8');
  assert.equal(stripComments(owned).match(GROUP_KILL), null,
    'owned-server.mjs itself must not group-kill');
});

test('startOwnedServer never hands out a port a harness used to squat on', async () => {
  // Both repaired harnesses used to pin a literal port that is INSIDE the shared pool, so a
  // hand-rolled server could collide with any other harness the pool had legitimately placed there.
  // Owning them through the pool is what makes concurrent harnesses safe.
  const { PORT_CANDIDATES } = await import('../tools/runtime-test/owned-server.mjs');
  assert.ok(PORT_CANDIDATES.includes(5203) && PORT_CANDIDATES.includes(5204),
    'the two formerly-squatted ports are pool members, which is exactly why squatting them was a '
    + 'collision waiting to happen');
  assert.equal(new Set(PORT_CANDIDATES).size, PORT_CANDIDATES.length,
    'a duplicated candidate would hand the same port to two harnesses');
});
