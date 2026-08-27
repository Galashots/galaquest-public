import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  clearPendingTask,
  isTerminalMeshyStatus,
  loadPendingTask,
  PENDING_TASK_STORAGE_KEY,
  savePendingTask,
} from '../public/src/forge/pendingTask.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

const RECORD = {
  taskId: 'task-abc-12345',
  kind: 'helmet',
  idempotencyKey: 'attempt-0001-abcdef',
  createdAt: '2026-08-21T06:00:00.000Z',
};

test('an in-flight paid task record survives a save/load round trip', () => {
  const storage = fakeStorage();
  savePendingTask(storage, RECORD);
  assert.deepEqual(loadPendingTask(storage), RECORD);
  clearPendingTask(storage);
  assert.equal(loadPendingTask(storage), null);
});

test('a corrupt or malformed pending record degrades to none instead of crashing the Forge', () => {
  const corrupt = fakeStorage({ [PENDING_TASK_STORAGE_KEY]: '{not json' });
  assert.equal(loadPendingTask(corrupt), null);
  assert.equal(corrupt.map.has(PENDING_TASK_STORAGE_KEY), false, 'corrupt record is cleared');

  const malformed = fakeStorage({ [PENDING_TASK_STORAGE_KEY]: JSON.stringify({ taskId: '../../etc' }) });
  assert.equal(loadPendingTask(malformed), null);

  const broken = { getItem() { throw new Error('storage unavailable'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  assert.equal(loadPendingTask(broken), null);
  assert.doesNotThrow(() => savePendingTask(broken, RECORD));
  assert.doesNotThrow(() => clearPendingTask(broken));
});

test('only real provider terminal states retire a pending record', () => {
  assert.equal(isTerminalMeshyStatus('SUCCEEDED'), true);
  assert.equal(isTerminalMeshyStatus('FAILED'), true);
  assert.equal(isTerminalMeshyStatus('CANCELED'), true);
  assert.equal(isTerminalMeshyStatus('IN_PROGRESS'), false);
  assert.equal(isTerminalMeshyStatus('PENDING'), false);
  assert.equal(isTerminalMeshyStatus(undefined), false);
});

// Source pins on the Forge page wiring, in the same style as test/forge-owner-fit.test.mjs: the
// behaviors below are what make the resume design safe, so a refactor that drops them must go red.
const MAIN = readFileSync('public/src/forge/main.js', 'utf8');

test('the Forge unlock token is never persisted in browser storage', () => {
  assert.doesNotMatch(MAIN, /sessionStorage/, 'unlock token must not be written to sessionStorage');
  assert.doesNotMatch(MAIN, /localStorage[^\n]*token/i, 'unlock token must not be written to localStorage');
});

test('every paid submission carries a fresh idempotency key and records the pending task', () => {
  const submit = MAIN.match(/async function generateCandidate\(\)[\s\S]*?\n}/);
  assert.ok(submit, 'generateCandidate missing');
  assert.match(submit[0], /crypto\.randomUUID\(\)/);
  assert.match(submit[0], /idempotencyKey/);
  assert.match(submit[0], /savePendingTask\(/);
  assert.match(submit[0], /loadPendingTask\(/, 'a pending task must block a fresh submission');
});

test('the resume/poll path can only GET the existing task, never start a new paid generation', () => {
  const poll = MAIN.match(/async function pollAndMountTask\([\s\S]*?\n}/);
  assert.ok(poll, 'pollAndMountTask missing');
  assert.doesNotMatch(poll[0], /POST/, 'polling/resume must never submit a generation');
  assert.doesNotMatch(poll[0], /savePendingTask/, 'polling must not mint new pending records');
  assert.match(poll[0], /clearPendingTask\(/, 'terminal states must retire the pending record');
  assert.match(poll[0], /isTerminalMeshyStatus\(/);

  const resume = MAIN.match(/async function resumePendingTask\(\)[\s\S]*?\n}/);
  assert.ok(resume, 'resumePendingTask missing');
  assert.match(resume[0], /pollAndMountTask\(pending\.taskId/);
});

test('a non-terminal poll outcome preserves the pending record for resume', () => {
  const poll = MAIN.match(/async function pollAndMountTask\([\s\S]*?\n}/)[0];
  const nonTerminal = poll.match(/if \(!task \|\| !isTerminalMeshyStatus\(task\.status\)\) \{[\s\S]*?\n  \}/);
  assert.ok(nonTerminal, 'non-terminal branch missing');
  assert.doesNotMatch(nonTerminal[0], /clearPendingTask/, 'a still-running paid task must keep its record');
  assert.match(nonTerminal[0], /Resume/i, 'the human is pointed at resume, not a new generation');
});

test('the Forge page ships the resume controls the pending record depends on', () => {
  const html = readFileSync('public/forge.html', 'utf8');
  for (const id of ['resume-panel', 'resume-task', 'abandon-task', 'resume-info']) {
    assert.match(html, new RegExp(`id="${id}"`), `forge.html is missing #${id}`);
  }
});
