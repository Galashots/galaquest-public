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

import {
  DEFAULT_EQUIPPED_ITEM_IDS,
  DEFAULT_EQUIPPED_WEAPON_ID,
  DEFAULT_OWNED_ITEM_IDS,
  isKnownItem,
  itemDef,
} from './items.js';
import { foldFacts, isProfileFact, unionFacts } from './facts.js';
// One authority for the client's id rule and one for the legacy key (GQ-007). net/guestId.js already
// owns both -- a profile id travels the wire in the guestId field and so is the same kind of string,
// and re-stating either here would leave two copies to drift apart. guestId.js keeps its own regex
// separate from protocol.js's for a different reason it documents: that one is the WIRE validating
// what it received, this is the CLIENT deciding what it will mint.
import { GUEST_ID_STORAGE_KEY, sanitizeGuestId } from '../net/guestId.js';


import { avatarForProfile, chooseAvatarId } from './heroAvatars.js';
export const PROFILES_STORAGE_KEY = 'gq-profiles';
export const JOURNAL_KEY_PREFIX = 'gq-journal:';
export const LEGACY_GUEST_ID_KEY = GUEST_ID_STORAGE_KEY;

export const PROFILES_SCHEMA_VERSION = 1;
export const JOURNAL_SCHEMA_VERSION = 1;

/** Two children, two spares. A cap at all is deliberate: an unbounded list is a UI nobody designed,
 *  and it invites farming fresh profiles for fresh one-per-profile rewards. */
export const MAX_PROFILES = 4;

export const DISPLAY_NAME_MAX_LENGTH = 16;
export const DEFAULT_DISPLAY_NAME = 'Hero';

/** A profile id IS a guest id as far as the wire is concerned -- it travels in that field -- so it
 *  is sanitized by that module's rule rather than by a second copy of it. Verified: 'p-' plus a
 *  crypto.randomUUID() is 38 characters drawn from [A-Za-z0-9-], so a minted id always passes. */
const sanitizeProfileId = sanitizeGuestId;

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

/** How many deletions the device remembers. A tombstone only has to outlive the other tabs that
 *  were open when the delete happened, so this is a small ring rather than a growing ledger --
 *  and it is capped because it is written to a child's device on every save. */
const MAX_TOMBSTONES = 24;

function emptyKeyring() {
  return { v: PROFILES_SCHEMA_VERSION, activeProfileId: null, profiles: [], deleted: [] };
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
    // `named` is the profile gate's own flag: whether a child has ever been asked what this hero is
    // called. It lives with the other onboarding latches rather than being inferred from the display
    // name, because "is the name still the default" is not the same question -- a child is perfectly
    // entitled to call their hero Hero, and inferring would ask them again forever.
    // The animal a child navigates by. Null until something chooses one -- createProfile does,
    // from what is free on this device. Left null here so migrateLegacyGuest's profiles fall to the
    // id-derived fallback rather than all being handed the same first animal.
    avatar: null,
    onboarding: { questGiven: false, movementTaught: false, attackTaught: false, named: false },
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
      avatar: typeof entry?.avatar === 'string' ? entry.avatar : null,
      onboarding: { ...freshProfile(id, '', null).onboarding, ...(entry?.onboarding ?? {}) },
      discovered: { ...freshProfile(id, '', null).discovered, ...(entry?.discovered ?? {}) },
      migratedFrom: typeof entry?.migratedFrom === 'string' ? entry.migratedFrom : null,
    });
  }

  const activeProfileId = profiles.some((p) => p.id === parsed.activeProfileId)
    ? parsed.activeProfileId
    : (profiles[0]?.id ?? null);

  // Tombstones. Sanitized like any other id, deduped, and capped -- a corrupt or hostile blob here
  // could otherwise hide every profile on the device by listing them all.
  const deleted = [];
  for (const entry of Array.isArray(parsed.deleted) ? parsed.deleted : []) {
    const id = sanitizeProfileId(entry);
    if (id && !deleted.includes(id)) deleted.push(id);
  }

  return { v: PROFILES_SCHEMA_VERSION, activeProfileId, profiles, deleted: deleted.slice(-MAX_TOMBSTONES) };
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

/**
 * The highest equip revision this device has ever recorded for a profile.
 *
 * Read from the journal rather than held in a variable, and that is the entire repair: an in-memory
 * counter is reset by the next page load, and a row index is reset by the next database, so either
 * one lets a NEW equip be minted beneath an OLD one. The journal is the one participant present on
 * both sides of a reload AND of a server wipe, so it is the only thing whose ordering can be trusted
 * across them. -1 for a profile that has never equipped anything, so the first revision is 0.
 */
function highestEquipRevision(facts) {
  let highest = -1;
  for (const fact of facts) {
    if (fact.type !== 'weapon-equipped' && fact.type !== 'gear-equipped') continue;
    if (typeof fact.rev === 'number' && Number.isFinite(fact.rev) && fact.rev > highest) {
      highest = fact.rev;
    }
  }
  return highest;
}

/**
 * Stamp a durable revision onto equip facts that arrived without one, continuing above everything
 * already on record. Facts already in the journal are left exactly as they are -- re-stamping a
 * known fact would move an ordering that has already been decided, which is how a replayed snapshot
 * could otherwise re-equip an old weapon.
 *
 * Incoming order is preserved because it is meaningful: net/rewardStore.mjs returns a profile's
 * facts in rowid order, so a device meeting an existing profile for the first time replays that
 * server's real chronology rather than inventing one.
 */
function stampEquipRevisions(incoming, knownEventIds) {
  // An equip that arrives with no revision at all is a row written before the order existed
  // (rewardStore schema v2 and earlier). It is therefore OLDER than anything this device has
  // numbered, and it is given a revision below zero to say so.
  //
  // An earlier version numbered these ABOVE the journal's history, on the reasoning that a fact
  // arriving now must be new. That is the defect this whole field exists to prevent, one level up:
  // it measures delivery, so an ancient equip handed over on reconnect outranked a choice the child
  // had just made offline. Arrival is not chronology.
  //
  // Their order relative to EACH OTHER is real and is preserved: net/rewardStore.mjs returns a
  // profile's facts in rowid order, so the last legacy equip to arrive is the last one that was made.
  const unstamped = incoming.filter((fact) => (
    (fact.type === 'weapon-equipped' || fact.type === 'gear-equipped')
    && !knownEventIds.has(fact.eventId)
    && !(typeof fact.rev === 'number' && Number.isFinite(fact.rev))
  ));
  const revById = new Map();
  unstamped.forEach((fact, index) => {
    revById.set(fact.eventId, index - unstamped.length);
  });
  return incoming.map((fact) => (
    revById.has(fact.eventId) ? { ...fact, rev: revById.get(fact.eventId) } : fact
  ));
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
  const nowMillis = () => {
    try { return now().getTime(); } catch { return NaN; }
  };

  let keyring = readKeyring(storage);
  // Uniqueness only, never ordering: this disambiguates fallback ids minted on a host with no
  // crypto.randomUUID. Equip ordering deliberately does NOT come from a counter like this one --
  // see highestEquipRevision for why a number that restarts cannot order anything durable.
  let mintCounter = 0;

  function mintProfileId() {
    if (randomUUID) {
      const minted = sanitizeProfileId(`p-${randomUUID()}`);
      if (minted) return minted;
    }
    // No crypto: still needs an id that matches the wire pattern. Uniqueness has to hold against the
    // keyring AND against the tombstones, and the second half is not decoration -- this id is
    // derived from `keyring.profiles.length` and a counter that restarts every session, so it
    // repeats across reloads by construction. Delete a hero on a no-crypto device, reload, make a
    // new one: without this it can be handed the dead hero's id, and the merge in persist() would
    // then tombstone the child at birth. They would tap GO and get nothing, with no error anywhere.
    //
    // Found by re-reading this file after the tombstones landed, not by a failure -- the crypto path
    // covers every real browser, so no harness would ever have walked into it.
    const onDevice = readKeyring(storage);
    const taken = new Set([
      ...keyring.profiles.map((p) => p.id),
      ...(onDevice.deleted ?? []),
      ...deletedHere,
    ]);
    let candidate = null;
    let attempt = 0;
    do {
      attempt += 1;
      candidate = sanitizeProfileId(`p-local-${keyring.profiles.length + attempt}-${mintCounter += 1}`);
    } while (candidate && taken.has(candidate));
    return candidate;
  }

  /**
   * MERGE, DO NOT OVERWRITE -- because a device can have more than one tab of this game open and
   * they share one localStorage.
   *
   * `keyring` is read once, at init, and every persist() used to write that whole snapshot back. Two
   * tabs is then a textbook lost update:
   *
   *   tab A inits, reads []           tab B inits, reads []
   *   tab A creates Ada  -> [Ada]
   *                                   tab B creates Bo   -> [Bo]     <- Ada is gone
   *
   * Nothing throws and nothing warns. Tab A carries on with a perfectly usable in-memory id that no
   * longer exists on the device, and finds out on its next reload -- as somebody else, with every
   * reward the server granted the old id orphaned behind it. Measured in drive-two-clients hosted:
   * `gq-profiles held p-5714ab7e-… before the reload: FALSE`, for an id the app was still using.
   *
   * Two tabs is not an exotic case for the thing this module is FOR. "Two children on one device" is
   * its whole purpose, and a second tab is an ordinary way for a child to get there -- a sibling
   * opening the game while the first is still up, or yesterday's tab still in the switcher.
   *
   * WHAT DECIDES A CONFLICT IS WHETHER THIS TAB TOUCHED THE PROFILE, not a timestamp. The first
   * version compared `lastPlayedAt` and got two things wrong. It resolved a tie in the device's
   * favour, and most mutations -- setFlags above all -- change a profile without touching that
   * timestamp, so the common case IS a tie and the edit being saved lost to the copy read at init:
   * discovery flags stopped surviving a reload and the gate started re-asking for a name it already
   * had. Turning the tie round fixed those and still could not fix rename, because rename does not
   * move `lastPlayedAt` either, so a stale copy could win by arriving second.
   *
   * `dirtyHere` answers it directly. A profile this tab has edited is authoritative here; anything
   * else comes from the device, which is where another tab's edits are. Cleared after a successful
   * write, because at that point the device holds them too.
   *
   * A PROFILE THIS TAB HAS NOT TOUCHED AND THE DEVICE NO LONGER HAS IS ONE ANOTHER TAB DELETED, so
   * it is dropped rather than carried forward -- that is how a delete propagates to tabs that were
   * already open. `deleted` on the stored keyring is the other half: `deletedHere` alone only
   * protects the tab that pressed delete, and every other tab would write the child straight back.
   * Deleting also drops the journal, so what came back was a name with no earnings behind it.
   */
  const deletedHere = new Set();
  const dirtyHere = new Set();

  function mergedWithDevice() {
    const onDevice = readKeyring(storage);
    const tombstoned = new Set([...(onDevice.deleted ?? []), ...deletedHere]);
    const mine = new Map(keyring.profiles.map((profile) => [profile.id, profile]));

    const merged = [];
    const taken = new Set();
    for (const profile of onDevice.profiles) {
      if (tombstoned.has(profile.id)) continue;
      merged.push(dirtyHere.has(profile.id) ? (mine.get(profile.id) ?? profile) : profile);
      taken.add(profile.id);
    }
    for (const profile of keyring.profiles) {
      if (tombstoned.has(profile.id) || taken.has(profile.id)) continue;
      // Not on the device and not touched here: another tab deleted it while this tab held it.
      if (!dirtyHere.has(profile.id)) continue;
      merged.push(profile);
      taken.add(profile.id);
    }

    // This tab's own idea of who is playing, always -- the other tab's is about a different screen
    // and adopting it would switch a child mid-play. Only falls back when that child is gone.
    const active = merged.some((profile) => profile.id === keyring.activeProfileId)
      ? keyring.activeProfileId
      : (merged[0]?.id ?? null);
    const deleted = [...new Set([...(onDevice.deleted ?? []), ...deletedHere])].slice(-MAX_TOMBSTONES);
    return { v: PROFILES_SCHEMA_VERSION, activeProfileId: active, profiles: merged, deleted };
  }

  /** @param touchedId the profile this tab just changed, so the merge knows to prefer its copy. */
  function persist(touchedId = null) {
    if (touchedId) dirtyHere.add(touchedId);
    keyring = mergedWithDevice();
    // Only on a successful write: if storage refused, this tab's edits are still the only copy.
    if (writeKeyring(storage, keyring)) dirtyHere.clear();
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
    persist(legacy);
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
    // Chosen once, here, from what is free on this device -- see heroAvatars.js on why it is stored
    // rather than computed from the set every time it is drawn.
    //
    // AGAINST WHAT IS ON SCREEN, not against what is written down. A migrated profile predates the
    // avatar field and has `avatar: null`, but it is DRAWN with the id-derived fallback -- so
    // filtering the nulls away hid a legacy child's effective Fox and handed Fox to the sibling
    // arriving next. Two children, one animal, and for the non-reader this feature exists for that
    // is the only thing on the card telling their save from their brother's.
    //
    // avatarForProfile is the same law the cards render with, deliberately, rather than a second
    // fallback implementation here that could disagree with the one on screen (GQ-007).
    profile.avatar = chooseAvatarId(keyring.profiles.map((existing) => avatarForProfile(existing).id));
    keyring.profiles.push(profile);
    keyring.activeProfileId = id;
    persist(id);
    return { ...profile };
  }

  function selectProfile(profileId) {
    const found = keyring.profiles.find((p) => p.id === profileId);
    if (!found) return null;
    keyring.activeProfileId = found.id;
    found.lastPlayedAt = nowIso();
    persist(found.id);
    return { ...found };
  }

  function renameProfile(profileId, displayName) {
    const found = keyring.profiles.find((p) => p.id === profileId);
    if (!found) return null;
    // The id never moves. That separation is the whole reason they are two fields: renaming a hero
    // must not orphan the save, and two brothers will absolutely pick the same name.
    found.displayName = sanitizeDisplayName(displayName);
    persist(profileId);
    return { ...found };
  }

  /** Deleting a profile deletes its journal too -- leaving an orphaned journal behind would silently
   *  restore a deleted child's earnings to whoever next minted a colliding id. */
  function deleteProfile(profileId) {
    const index = keyring.profiles.findIndex((p) => p.id === profileId);
    if (index === -1) return false;
    keyring.profiles.splice(index, 1);
    // Recorded BOTH ways. `deletedHere` stops this tab writing the child back; the tombstone on the
    // stored keyring is what stops every OTHER tab doing it, and that is the half the first version
    // was missing -- a delete was honoured only by the tab that pressed it.
    deletedHere.add(profileId);
    if (keyring.activeProfileId === profileId) {
      keyring.activeProfileId = keyring.profiles[0]?.id ?? null;
    }
    try { storage.removeItem(journalKeyFor(profileId)); } catch { /* nothing to remove */ }
    persist(null);
    return true;
  }

  function setFlags(profileId, { onboarding, discovered } = {}) {
    const found = keyring.profiles.find((p) => p.id === profileId);
    if (!found) return null;
    if (onboarding) found.onboarding = { ...found.onboarding, ...onboarding };
    if (discovered) found.discovered = { ...found.discovered, ...discovered };
    persist(profileId);
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
    const known = new Set(existing.map((fact) => fact.eventId));
    const stamped = stampEquipRevisions(incoming, known);
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
  /**
   * This profile's durable state, derived from the journal and nothing else.
   *
   * READ-ONLY, and it takes no server facts on purpose. An earlier version accepted them and stamped
   * revisions onto the unseen ones for the duration of the call, which quietly made a revision a
   * property of WHEN YOU LOOKED rather than of when the child equipped something: the same unchanged
   * server equip was numbered from the journal's current maximum, so it drifted upward every time
   * the journal grew around it, and an old equip could overtake a newer local one having had nothing
   * happen to it at all.
   *
   * Assigning a revision is therefore an act of observation, and observation has to be durable. Use
   * ingestServerFacts to take facts in; this function only reports what has already been taken in.
   */
  function stateFor(profileId) {
    return foldFacts(readJournal(storage, profileId), {
      equippedWeaponId: DEFAULT_EQUIPPED_WEAPON_ID,
      equippedItemIds: DEFAULT_EQUIPPED_ITEM_IDS,
      ownedItemIds: DEFAULT_OWNED_ITEM_IDS,
    });
  }

  /**
   * Create this device's equip fact for `itemId` -- identity and order together -- journal it, and
   * hand it back so the caller can send the same fact to the server.
   *
   * The order is created HERE, at the moment the child chooses, because that is the only moment it
   * describes. Every version of this number that was computed later was wrong about something the
   * later moment could not see, and the last of them could not distinguish an older equip delivered
   * late from a newer one, because arrival is not chronology (docs/MISTAKES.md GQ-014).
   *
   * Journalled before it is sent, deliberately: a child who equips a sword with no network has
   * equipped a sword. The send is how the server finds out, not how it becomes true.
   *
   * Assumes the caller has already ingested whatever the server knows -- which is why
   * ingestServerFacts is the reconnect contract. A device that mints before ingesting can number a
   * new choice beneath history it has not heard about yet; ingesting first is what makes the local
   * maximum the real one.
   */
  function mintEquipFact(profileId, itemId) {
    if (!isKnownItem(itemId)) throw new Error(`cannot equip unknown item ${JSON.stringify(itemId)}`);
    const journal = readJournal(storage, profileId);
    const highest = highestEquipRevision(journal);
    // WHEN it happened, in epoch milliseconds -- not how many have happened. A per-profile counter
    // cannot order two choices made by writers that have not spoken to each other, and after a
    // disconnect that is exactly the situation: a device whose journal is empty numbers its first
    // offline equip 0, and so did the equip it has not heard about yet. Two zeroes is a tie, and a
    // tiebreak is not chronology. A clock is the one thing both writers already share.
    //
    // Guarded to stay strictly above this profile's own history, so a device whose clock jumps
    // backwards -- a manual change, a timezone edit by a child -- still orders its OWN equips
    // correctly. Cross-device skew is left alone deliberately: the stake is which of your own swords
    // your hero draws, and a household's tablets are not worth a vector clock.
    const stamp = nowMillis();
    const rev = Number.isFinite(stamp) ? Math.max(stamp, highest + 1) : highest + 1;
    const unique = randomUUID ? randomUUID() : `local-${mintCounter += 1}`;
    const fact = {
      eventId: `equip:${profileId}:${rev}:${unique}`,
      type: itemDef(itemId).slot === 'weapon' ? 'weapon-equipped' : 'gear-equipped',
      value: itemId,
      rev,
    };
    recordFacts(profileId, [fact]);
    return fact;
  }

  /**
   * Take server facts in and report the resulting state -- journalling anything unseen, with its
   * revision settled, BEFORE deriving.
   *
   * One operation rather than two because the two halves must not be separable: any window between
   * "the device has seen this fact" and "the device has written down where it sits in the order" is
   * a window in which a newer local equip can be numbered underneath an older remote one. Once event
   * B has been observed at revision N it stays at N forever, however much the journal grows later.
   *
   * This is the call the client makes whenever server facts arrive -- on welcome, and on any
   * reconnect -- and it must happen before local progression can mint anything new.
   */
  function ingestServerFacts(profileId, serverFacts = []) {
    recordFacts(profileId, serverFacts);
    return stateFor(profileId);
  }

  /**
   * The id this device should send as the wire's guestId, creating or migrating a profile if this is
   * a first run. Returns null only when a profile genuinely could not be minted.
   *
   * A device with nothing at all gets a default profile rather than nothing: before this module the
   * client always minted a guest token on first load, and a child who opens the game must not lose
   * their marks because the naming screen has not been built yet. They get a hero called Hero and
   * can rename it; what matters is that the id exists and is durable from the first kill onward.
   */
  /**
   * Adopt a hero named in the URL: select the one already called that, or create it.
   *
   * The README's whole distribution model is "players join by URL", and on a shared tablet the
   * natural extension is a link per child -- `.../?hero=Sam` is Sam's link, and following it puts
   * Sam's save on screen without a five-year-old having to pick their own name off a list first.
   *
   * By NAME rather than by id on purpose: the id is a 38-character machine string that nobody is
   * going to put in a link, and a name is the thing a family already uses. The consequence is
   * accepted rather than overlooked -- two heroes deliberately called the same name share a link,
   * and the first one wins. Inside one household that is the behaviour a parent would predict.
   *
   * Select-or-create rather than always-create, or every reload of the same link would mint another
   * hero and fill the four slots with duplicates.
   *
   * Returns the profile, or null when the name was unusable or the tablet is full -- callers fall
   * back to the ordinary gate, which is the honest thing to do when a link cannot be honoured.
   */
  function adoptNamedHero(rawName) {
    const wanted = sanitizeDisplayName(rawName);
    if (typeof rawName !== 'string' || rawName.trim().length === 0) return null;

    // MIGRATION BEFORE CREATE, and this is the one place it could most easily have been skipped.
    // A device that has been played on before this module existed holds a bare gq-guest-id, and
    // every reward row on the server points at that string. Minting a fresh profile here instead
    // would leave the child looking at an empty save while their real one sat on the server under a
    // name nothing on the device pointed at any more -- orphaned, not deleted, which is worse
    // because nothing looks broken. Caught by a harness: the seeded guest's owned Blade vanished
    // because ?hero= had created a second profile beside it.
    const migrated = migrateLegacyGuest();

    const existing = keyring.profiles.find((p) => p.displayName === wanted);
    if (existing) return selectProfile(existing.id);

    // The legacy save IS this device's save, so the name in the link belongs to it rather than to a
    // new hero standing next to it. Renaming keeps the id -- which is the whole point of the id and
    // the name being different things.
    if (migrated) {
      const named = renameProfile(migrated.id, wanted);
      setFlags(migrated.id, { onboarding: { named: true } });
      return named;
    }

    if (keyring.profiles.length >= MAX_PROFILES) return null;
    try {
      const created = createProfile(wanted);
      // A hero who arrived by name has been named, so the gate must not ask again.
      setFlags(created.id, { onboarding: { named: true } });
      return { ...created, onboarding: { ...created.onboarding, named: true } };
    } catch (error) {
      console.warn('[profiles] could not adopt the hero named in the URL:', error?.message ?? error);
      return null;
    }
  }

  function activeProfileId() {
    if (!keyring.activeProfileId) {
      migrateLegacyGuest();
    }
    if (!keyring.activeProfileId) {
      try {
        createProfile(DEFAULT_DISPLAY_NAME);
      } catch (error) {
        console.warn('[profiles] could not create a first profile:', error?.message ?? error);
      }
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
    adoptNamedHero,
    journalFor,
    recordFacts,
    mintEquipFact,
    ingestServerFacts,
    stateFor,
  };
}
