import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertOwnedBrowserInputs } from '../tools/unity-playtest/owned-browser-cleanup.mjs';

test('browser disposal admits only the spawned PID and this review profile shape', () => {
  assert.doesNotThrow(() => assertOwnedBrowserInputs({pid: 12345}, join(tmpdir(), 'gq-burst-chrome-fixture')));
  assert.doesNotThrow(() => assertOwnedBrowserInputs({pid: 12345}, join(tmpdir(), 'gq-mixed-chrome-fixture')));
  assert.throws(() => assertOwnedBrowserInputs({}, join(tmpdir(), 'gq-burst-chrome-fixture')), /PID/);
  assert.throws(() => assertOwnedBrowserInputs({pid: 0}, join(tmpdir(), 'gq-burst-chrome-fixture')), /PID/);
});

test('browser disposal rejects ordinary and nested profile directories before process control', () => {
  assert.throws(() => assertOwnedBrowserInputs({pid: 12345}, join(tmpdir(), 'ordinary-profile')));
  assert.throws(() => assertOwnedBrowserInputs({pid: 12345}, join(tmpdir(), 'nested', 'gq-burst-chrome-fixture')), /direct OS-temp/);
  assert.throws(() => assertOwnedBrowserInputs({pid: 12345}, join(tmpdir(), '..', 'gq-burst-chrome-fixture')), /direct OS-temp/);
});
