import { createProfileStore } from '../progression/profiles.js';
import { resolveHeroStats } from '../progression/heroStats.js';
import { powerFor, formatPower, powerChange } from '../progression/power.js';
import { isProfileFact } from '../progression/facts.js';

// Unity owns accepted-frame/player/epoch validation. This adapter only journals the
// accepted personal facts and projects the existing progression authority for its HUD.
export function createUnityProfileProgression(options = {}) {
  // Each operation reads a fresh keyring. A watcher on these short-lived stores would
  // retain every old keyring for the page lifetime and multiply cross-tab callbacks.
  const store = () => createProfileStore({ ...options, watchStorageEvents: false });

  function readSelected() {
    const profiles = store();
    const selected = profiles.activeProfile();
    if (!selected) throw new Error('Select a child in GalaQuest before opening the adventure.');
    return {
      status: 'ok', profileId: selected.id, displayName: selected.displayName,
      factsJson: JSON.stringify(profiles.journalFor(selected.id)),
    };
  }

  function view(profiles, profileId) {
    const state = profiles.stateFor(profileId);
    const stats = resolveHeroStats({ ...state, totalXp: state.xp });
    return {
      status: 'ok', profileId, factsJson: JSON.stringify(profiles.journalFor(profileId)),
      xp: state.xp, level: stats.level,
      xpIntoLevel: stats.levelState.xpIntoLevel, xpForLevel: stats.levelState.xpForLevel,
      power: powerFor(stats), powerText: formatPower(powerFor(stats)),
      maxHp: stats.maxHp, heroDamage: stats.heroDamage,
      coins: state.coins, marks: state.marks, shards: state.shards,
      ownedItemIds: state.ownedItemIds, equippedItemIds: state.equippedItemIds,
    };
  }

  function applyFrame(profileId, playerId, frame) {
    if (!playerId || frame?.v !== 4 || !['welcome', 'destination-changed', 'snapshot'].includes(frame.type))
      throw new Error('An accepted server frame and player are required for progression.');
    const hydration = frame.type !== 'snapshot';
    if (hydration && frame.id !== playerId)
      throw new Error('Personal arrival facts belong to a different player.');
    const personalEvents = (Array.isArray(frame.events) ? frame.events : [])
      .filter(event => event?.heroId === playerId && isProfileFact(event));
    // Ordinary movement snapshots are the hot path. Do not reread and refold a child's
    // entire journal, or marshal it back through WebAssembly, twenty times per second.
    if (!hydration && personalEvents.length === 0) return null;
    const profiles = store();
    if (!profiles.listProfiles().some(profile => profile.id === profileId))
      throw new Error('This adventure profile is no longer on the device.');
    const before = view(profiles, profileId);
    const facts = hydration && Array.isArray(frame.profileFacts) ? frame.profileFacts : [];
    const incoming = [...facts, ...personalEvents].filter(isProfileFact);
    profiles.ingestServerFacts(profileId, incoming);
    const savedIds = new Set(profiles.journalFor(profileId).map(fact => fact.eventId));
    if (incoming.some(fact => !savedIds.has(fact.eventId)))
      throw new Error('This device could not save new progress. Keep this page open and check device storage.');
    const after = view(profiles, profileId);
    const power = powerChange(before.power, after.power);
    return {
      ...after,
      previousPowerText: power.beforeText, powerDeltaText: power.deltaText,
      gainedXp: hydration ? 0 : Math.max(0, after.xp - before.xp),
      gainedCoins: hydration ? 0 : Math.max(0, after.coins - before.coins),
      gainedMarks: hydration ? 0 : Math.max(0, after.marks - before.marks),
      leveledUp: !hydration && after.level > before.level,
      previousLevel: before.level, previousMaxHp: before.maxHp,
      previousDamage: before.heroDamage, previousPower: before.power,
    };
  }

  return { readSelected, applyFrame };
}
