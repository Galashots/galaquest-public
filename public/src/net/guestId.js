// A client-random token identifying this browser (not this person -- no PII), so the server can
// persist Lantern Marks across a refresh. Brief D4: created once via crypto.randomUUID(), stripped
// to the validated alphabet, stored in localStorage under 'gq-guest-id'. localStorage can throw in
// private browsing (Safari) or with storage disabled entirely -- every path here falls back to
// `null` (ephemeral: marks still count for the session, just never persist) rather than throwing,
// the same "every network path degrades to single-player rather than to a broken page" rule
// net/client.js's own header states for the socket itself.

// Mirrors public/src/net/protocol.js's GUEST_ID_PATTERN exactly -- not imported, because protocol.js
// is the wire's own validation and this is the CLIENT deciding what it will even attempt to send;
// keeping the pattern local means this file never has to import the wire layer just to sanitise a
// string, and the two are simple enough (one regex literal) that duplication is not a real drift risk
// the way a whole schema would be.
const GUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export const GUEST_ID_STORAGE_KEY = 'gq-guest-id';

/**
 * Strip a candidate id down to the validated alphabet and confirm it is still a legal shape
 * afterwards. Returns null rather than throwing on anything that cannot be salvaged -- a caller
 * treats null exactly like "no guestId available at all".
 */
export function sanitizeGuestId(candidate) {
  if (typeof candidate !== 'string') return null;
  const stripped = candidate.replace(/[^A-Za-z0-9-]/g, '');
  return GUEST_ID_PATTERN.test(stripped) ? stripped : null;
}

/**
 * @param options.storage     an object with getItem/setItem, defaulting to window.localStorage.
 * @param options.randomUUID  defaulting to crypto.randomUUID. Both injectable so this is testable
 *   under plain `node --test` with no DOM and no real crypto.randomUUID call.
 * @returns a validated guestId string, or null if none is available (no storage, no randomUUID, or
 *   storage threw) -- the caller's cue to join ephemerally.
 */
export function getOrCreateGuestId(options = {}) {
  const storage = options.storage
    ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  const randomUUID = options.randomUUID
    ?? (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? () => crypto.randomUUID()
      : undefined);

  if (!storage || !randomUUID) return null;

  try {
    const existing = sanitizeGuestId(storage.getItem(GUEST_ID_STORAGE_KEY));
    if (existing) return existing;

    const fresh = sanitizeGuestId(randomUUID());
    if (!fresh) return null;
    storage.setItem(GUEST_ID_STORAGE_KEY, fresh);
    return fresh;
  } catch (error) {
    // Private browsing throws on setItem (Safari's classic quota-of-zero), and some browsers throw
    // on getItem too when storage is disabled outright. Either way: ephemeral, never crash.
    console.warn('[net] guestId unavailable, falling back to an ephemeral session:', error.message);
    return null;
  }
}
