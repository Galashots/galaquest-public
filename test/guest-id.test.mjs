// D4: the client-side guestId helper. No DOM needed -- storage and randomUUID are both injected,
// the same pattern net/client.js's own tests use for the socket.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { GUEST_ID_STORAGE_KEY, getOrCreateGuestId, sanitizeGuestId } from '../public/src/net/guestId.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = value; },
  };
}

const UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

test('sanitizeGuestId accepts a well-formed candidate unchanged', () => {
  assert.equal(sanitizeGuestId(UUID), UUID);
});

test('sanitizeGuestId strips characters outside the validated alphabet', () => {
  assert.equal(sanitizeGuestId('abc def!!123456'), 'abcdef123456');
});

test('sanitizeGuestId rejects anything left too short after stripping', () => {
  assert.equal(sanitizeGuestId('a b'), null);
});

test('sanitizeGuestId rejects a non-string outright', () => {
  assert.equal(sanitizeGuestId(12345678), null);
  assert.equal(sanitizeGuestId(null), null);
  assert.equal(sanitizeGuestId(undefined), null);
});

test('a fresh guestId is created via randomUUID and persisted to storage', () => {
  const storage = fakeStorage();
  const id = getOrCreateGuestId({ storage, randomUUID: () => UUID });
  assert.equal(id, UUID);
  assert.equal(storage.data[GUEST_ID_STORAGE_KEY], UUID);
});

test('an existing stored guestId is reused, not regenerated', () => {
  const storage = fakeStorage({ [GUEST_ID_STORAGE_KEY]: UUID });
  let calls = 0;
  const id = getOrCreateGuestId({ storage, randomUUID: () => { calls += 1; return 'should-not-be-used-0000'; } });
  assert.equal(id, UUID);
  assert.equal(calls, 0, 'randomUUID must not be called when a valid id is already stored');
});

test('a stored value that no longer validates is replaced with a fresh one', () => {
  // 'bad' sanitizes to itself (already inside the alphabet) but is under the 8-character minimum.
  const storage = fakeStorage({ [GUEST_ID_STORAGE_KEY]: 'bad' });
  const id = getOrCreateGuestId({ storage, randomUUID: () => UUID });
  assert.equal(id, UUID);
  assert.equal(storage.data[GUEST_ID_STORAGE_KEY], UUID);
});

test('storage that throws on getItem falls back to ephemeral (null), never crashes', () => {
  const storage = {
    getItem() { throw new Error('SecurityError: storage disabled'); },
    setItem() {},
  };
  assert.doesNotThrow(() => {
    const id = getOrCreateGuestId({ storage, randomUUID: () => UUID });
    assert.equal(id, null);
  });
});

test('storage that throws on setItem (private browsing) falls back to ephemeral, never crashes', () => {
  const storage = {
    getItem() { return null; },
    setItem() { throw new Error('QuotaExceededError'); },
  };
  assert.doesNotThrow(() => {
    const id = getOrCreateGuestId({ storage, randomUUID: () => UUID });
    assert.equal(id, null);
  });
});

test('no storage at all (e.g. no DOM) falls back to ephemeral', () => {
  assert.equal(getOrCreateGuestId({ storage: undefined, randomUUID: () => UUID }), null);
});

// NOTE: an explicit `randomUUID: undefined` is NOT the same as "no randomUUID available" -- passing
// undefined asks getOrCreateGuestId to fall back to the real global crypto.randomUUID, which exists
// in this Node version (and in every real browser this game targets) and would happily produce a
// real id, making that scenario untestable without mutating the global crypto object. The
// no-crypto-at-all path exists in the source for a genuinely crypto-less environment; it is not
// reachable through the public options this test suite can exercise safely.
test('a randomUUID implementation producing something unsanitizable falls back to ephemeral', () => {
  const storage = fakeStorage();
  assert.equal(getOrCreateGuestId({ storage, randomUUID: () => '!!' }), null);
});
