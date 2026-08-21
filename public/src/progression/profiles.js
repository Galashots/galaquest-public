// Local-first family profiles: who is playing, what they are called, and a durable per-profile
// journal of what they have earned.
//
// The product rule this implements is that a same-device family save must recover a child's
// progression even if the server's reward DB is unavailable or ephemeral. So the device keeps its
// own copy of every durable fact, and progression/facts.js's union law makes holding two copies safe
// rather than ambiguous. The server stays authoritative for LIVE ADJUDICATION -- did that hit land,
// is this affordable, is this claim in range -- and the journal is never offered to it as evidence
// for any of that. It exists so a child who plays on a machine whose server database is wiped still
// has their marks, their coins and their sword when they come back.
//
// Storage layout, two keys rather than one document:
//   gq-profiles            the keyring: schema version, which profile is active, and per profile the
//                          identity and the client-only flags nothing else has ever persisted.
//   gq-journal:<profileId> that profile's grow-only fact set.
// Split because they change at very different rates -- the keyring is written when a child is
// created or renamed, the journal on every earned fact -- and because a torn write then costs at
// most the newest fact instead of the whole family.
//
// gq-guest-id is READ for migration and never written again. It is deliberately NOT deleted: it is
// the only thing tying an existing child to rows already in the server's store, and a cleanup that
// felt tidy would be indistinguishable from losing their save.
//
// Every dependency is injected (storage, randomUUID, now) for the reason public/src/net/guestId.js
// gives for doing the same: it is what lets this run under bare `node --test` with no DOM, no real
// clock and no real crypto, so the tests can be deterministic rather than merely probable.

import { DEFAULT_EQUIPPED_WEAPON_ID, DEFAULT_OWNED_ITEM_IDS } from './items.js';
import { foldFacts, isProfileFact, unionFacts } from './facts.js';

export const PROFILES_STORAGE_KEY = 'gq-profiles';
export const JOURNAL_KEY_PREFIX = 'gq-journal:';
export const LEGACY_GUEST_ID_KEY = 'gq-guest-id';

export const PROFILES_SCHEMA_VERSION = 1;
export const JOURNAL_SCHEMA_VERSION = 1;

/** Two children, two spares. A cap at all is deliberate: an unbounded list is a UI nobody designed,
 *  and it invites farming fresh profiles for fresh one-per-profile rewards. */
export const MAX_PROFILES = 4;

export const DISPLAY_NAME_MAX_LENGTH = 16;
export const DEFAULT_DISPLAY_NAME = 'Hero';

/** Mirrors public/src/net/protocol.js's GUEST_ID_PATTERN, because a profile id travels the wire in
 *  that field. Duplicated rather than imported for exactly the reason net/guestId.js states about
 *  the same regex: this is the client deciding what it will mint, not the wire validating what it
 *  received, and one regex literal is not the kind of thing that drifts. Verified: 'p-' plus a
 *  crypto.randomUUID() is 38 characters drawn from [A-Za-z0-9-], so a minted id always matches. */
const PROFILE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

function sanitizeProfileId(candidate) {
  if (typeof candidate !== 'string') return null;
  const stripped = candidate.replace(/[^A-Za-z0-9-]/g, '');
  return PROFILE_ID_PATTERN.test(stripped) ? stripped : null;
}

/** Trimmed, length-capped, never empty. A blank name is replaced rather than rejected: a child who
 *  taps GO without typing gets a hero called Hero, not an error message. */
export function sanitizeDisplayName(candidate) {
  if (typeof candidate !== 'string') return DEFAULT_DISPLAY_NAME;
  const trimmed = candidate.trim().slice(0, DISPLAY_NAME_MAX_LENGTH).trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_DISPLAY_NAME;
}

function journalKeyFor(profileId) {
  return `${JOURNAL_KEY_PREFIX}${profileId}`;
}

function emptyKeyring() {
  return { v: PROFILES_SCHEMA_VERSION, activeProfileId: null, profiles: [] };
}

function freshProfile(id, displayName, nowIso) {
  return {
    id,
    displayName: sanitizeDisplayName(displayName),
    createdAt: nowIso,
    lastPlayedAt: nowIso,
    // Client-only and, before this module existed, not persisted at all: main.js held these as
    // plain `let` bindings, so a child who refreshed was told to go and find the gate again. They
    // are the one class of state with no server copy, which makes this file their only home.
    onboarding: { questGiven: false, movementTaught: false, attackTaught: false },
    discovered: {
      gate: false, camp: false, rowan: false, cart: false,
      beacon: false, hollow: false, lodge: false, trail: false,
    },
    migratedFrom: null,
  };
}

/**
 * Read and repair a keyring. Anything unreadable degrades to "no profiles yet" rather than throwing,
 * for the reason net/guestId.js gives about localStorage: it can be disabled or throw outright, and
 * a child staring at a broken page is a worse outcome than a child starting a new hero.
 *
 * Repair is per-profile, not all-or-nothing -- one corrupt entry must not cost a sibling their save.
 */
function readKeyring(storage) {
  let raw = null;
  try {
    raw = storage.getItem(PROFILES_STORAGE_KEY);
  } catch {
    return emptyKeyring();
  }
  if (typeof raw !== 'string' || raw.length === 0) return emptyKeyring();

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyKeyring();
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.profiles)) return emptyKeyring();

  const profiles = [];
  for (const entry of parsed.profiles) {
    const id = sanitizeProfileId(entry?.id);
    if (!id || profiles.some((p) => p.id === id)) continue;
    profiles.push({
      id,
      displayName: sanitizeDisplayName(entry?.displayName),
      createdAt: typeof entry?.createdAt === 'string' ? entry.createdAt : null,
      lastPlayedAt: typeof entry?.lastPlayedAt === 'string' ? entry.lastPlayedAt : null,
      onboarding: { ...freshProfile(id, '', null).onboarding, ...(entry?.onboarding ?? {}) },
      discovered: { ...freshProfile(id, '', null).discovered, ...(entry?.discovered ?? {}) },
      migratedFrom: typeof entry?.migratedFrom === 'string' ? entry.migratedFrom : null,
    });
  }

  const activeProfileId = profiles.some((p) => p.id === parsed.activeProfileId)
    ? parsed.activeProfileId
    : (profiles[0]?.id ?? null);

  return { v: PROFILES_SCHEMA_VERSION, activeProfileId, profiles };
}

function writeKeyring(storage, keyring) {
  try {
    storage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(keyring));
    return true;
  } catch (error) {
    // Private browsing, a full quota, or storage disabled outright. The session keeps working from
    // the in-memory keyring; it just will not be there next time. Same degrade-never-crash rule
    // net/guestId.js applies to the guest token itself.
    console.warn('[profiles] could not persist the profile keyring:', error?.message ?? error);
    return false;
  }
}

function readJournal(storage, profileId) {
  let raw = null;
  try {
    raw = storage.getItem(journalKeyFor(profileId));
  } catch {
    return [];
  }
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    const facts = Array.isArray(parsed?.facts) ? parsed.facts : [];
    return facts.filter(isProfileFact);
  } catch {
    return [];
  }
}

function writeJournal(storage, profileId, facts) {
  try {
    storage.setItem(journalKeyFor(profileId), JSON.stringify({ v: JOURNAL_SCHEMA_VERSION, facts }));
    return true;
  } catch (error) {
    console.warn('[profiles] could not persist the profile journal:', error?.message ?? error);
    return false;
  }
}

/**
 * @param options.storage     an object with getItem/setItem/removeItem, defaulting to localStorage.
 * @param options.randomUUID  defaulting to crypto.randomUUID.
 * @param options.now         () => Date, defaulting to the wall clock.
 *
 * Returns null-free: when storage or randomUUID is unavailable the store still works entirely in
 * memory, so a child in a locked-down browser can still play a session -- they just start fresh
 * next time. That is strictly better than the alternative of refusing to boot.
 */
export function createProfileStore(options = {}) {
  const memory = new Map();
  const fallbackStorage = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => { memory.set(k, String(v)); },
    removeItem: (k) => { memory.delete(k); },
  };

  let storage = fallbackStorage;
  if (options.storage) {
    storage = options.storage;
  } else if (typeof window !== 'undefined' && window.localStorage) {
    try {
      // Touching localStorage can itself throw when storage is disabled, so the probe is the guard.
      window.localStorage.getItem(PROFILES_STORAGE_KEY);
      storage = window.localStorage;
    } catch {
      storage = fallbackStorage;
    }
  }

  const randomUUID = options.randomUUID
    ?? (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? () => crypto.randomUUID()
      : null);
  const now = options.now ?? (() => new Date());
  const nowIso = () => {
    try { return now().toISOString(); } catch { return null; }
  };

  let keyring = readKeyring(storage);
  let sequence = 0;

  function mintProfileId() {
    if (randomUUID) {
      const minted = sanitizeProfileId(`p-${randomUUID()}`);
      if (minted) return minted;
    }
    // No crypto: still needs an id that matches the wire pattern. Uniqueness here only has to hold
    // within one device's keyring, which the explicit collision check below actually enforces.
    let candidate = null;
    let attempt = 0;
    do {
      attempt += 1;
      candidate = sanitizeProfileId(`p-local-${keyring.profiles.length + attempt}-${sequence += 1}`);
    } while (candidate && keyring.profiles.some((p) => p.id === candidate));
    return candidate;
  }

  function persist() {
    writeKeyring(storage, keyring);
  }

  /**
   * Fold an existing gq-guest-id into a profile whose id IS that guest id, verbatim.
   *
   * This is the whole migration, and it is free precisely because the id is reused rather than
   * translated: every reward_events row on the server already points at this string, so there is no
   * backfill, no schema bump, and no window in which a child's marks are invisible. A migration that
   * minted a NEW id would have had to move rows that live on a machine this code cannot reach.
   */
  function migrateLegacyGuest() {
    if (keyring.profiles.length > 0) return null;
    let legacy = null;
    try {
      legacy = sanitizeProfileId(storage.getItem(LEGACY_GUEST_ID_KEY));
    } catch {
      legacy = null;
    }
    if (!legacy) return null;
    const profile = freshProfile(legacy, DEFAULT_DISPLAY_NAME, nowIso());
    profile.migratedFrom = LEGACY_GUEST_ID_KEY;
    keyring.profiles.push(profile);
    keyring.activeProfileId = legacy;
    persist();
    return profile;
  }

  function listProfiles() {
    return keyring.profiles.map((p) => ({ ...p }));
  }

  function activeProfile() {
    const found = keyring.profiles.find((p) => p.id === keyring.activeProfileId);
    return found ? { ...found } : null;
  }

  function createProfile(displayName) {
    if (keyring.profiles.length >= MAX_PROFILES) {
      throw new Error(`this device already holds ${MAX_PROFILES} profiles`);
    }
    const id = mintProfileId();
    if (!id) throw new Error('could not mint a profile id');
    const profile = freshProfile(id, displayName, nowIso());
    keyring.profiles.push(profile);
    keyring.activeProfileId = id;
    persist();
    return { ...profile };
  }

  function selectProfile(profileId) {
    const found = keyring.profiles.find((p) => p.id === profileId);
    if (!found) return null;
    keyring.activeProfileId = found.id;
    found.lastPlayedAt = nowIso();
    persist();
    return { ...found };
  }

  function renameProfile(profileId, displayName) {
    const found = keyring.profiles.find((p) => p.id === profileId);
    if (!found) return null;
    // The id never moves. That separation is the whole reason they are two fields: renaming a hero
    // must not orphan the save, and two brothers will absolutely pick the same name.
    found.displayName = sanitizeDisplayName(displayName);
    persist();
    return { ...found };
  }

  /** Deleting a profile deletes its journal too -- leaving an orphaned journal behind would silently
   *  restore a deleted child's earnings to whoever next minted a colliding id. */
  function deleteProfile(profileId) {
    const index = keyring.profiles.findIndex((p) => p.id === profileId);
    if (index === -1) return false;
    keyring.profiles.splice(index, 1);
    if (keyring.activeProfileId === profileId) {
      keyring.activeProfileId = keyring.profiles[0]?.id ?? null;
    }
    try { storage.removeItem(journalKeyFor(profileId)); } catch { /* nothing to remove */ }
    persist();
    return true;
  }

  function setFlags(profileId, { onboarding, discovered } = {}) {
    const found = keyring.profiles.find((p) => p.id === profileId);
    if (!found) return null;
    if (onboarding) found.onboarding = { ...found.onboarding, ...onboarding };
    if (discovered) found.discovered = { ...found.discovered, ...discovered };
    persist();
    return { ...found };
  }

  function journalFor(profileId) {
    return readJournal(storage, profileId);
  }

  /**
   * Append durable facts to a profile's journal, ignoring any it already holds.
   *
   * Idempotent by the same eventId the server keys its own store on, which is what makes the two
   * copies mergeable at all: record the same fact from a snapshot, a replayed snapshot and a
   * reconnect, and the journal still holds it once.
   */
  function recordFacts(profileId, facts) {
    const incoming = (Array.isArray(facts) ? facts : [facts]).filter(isProfileFact);
    if (incoming.length === 0) return { appended: 0 };

    const existing = readJournal(storage, profileId);
    const before = existing.length;
    const stamped = incoming.map((fact) => (
      fact.type === 'weapon-equipped' && typeof fact.seq !== 'number'
        ? { ...fact, seq: (sequence += 1) }
        : fact
    ));
    const merged = unionFacts(existing, stamped);
    if (merged.length === before) return { appended: 0 };
    writeJournal(storage, profileId, merged);
    return { appended: merged.length - before };
  }

  /**
   * The profile's durable state, derived from the local journal alone and optionally unioned with
   * whatever the server currently reports.
   *
   * Called with no server facts this answers "what does this device alone still know", which is the
   * recovery case the whole design exists for. Called with them it answers "everything either side
   * has seen" -- and because both are folded through the same union law, the answer does not depend
   * on which of the two was reachable.
   */
  function stateFor(profileId, serverFacts = []) {
    return foldFacts(unionFacts(readJournal(storage, profileId), serverFacts), {
      equippedWeaponId: DEFAULT_EQUIPPED_WEAPON_ID,
      ownedItemIds: DEFAULT_OWNED_ITEM_IDS,
    });
  }

  /** The id this device should send as the wire's guestId, creating or migrating a profile if this
   *  is a first run. Returns null only when a profile genuinely could not be minted. */
  function activeProfileId() {
    if (!keyring.activeProfileId) {
      migrateLegacyGuest();
    }
    return keyring.activeProfileId ?? null;
  }

  return {
    listProfiles,
    activeProfile,
    activeProfileId,
    createProfile,
    selectProfile,
    renameProfile,
    deleteProfile,
    setFlags,
    migrateLegacyGuest,
    journalFor,
    recordFacts,
    stateFor,
  };
}
