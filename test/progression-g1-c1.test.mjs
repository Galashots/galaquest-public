import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_EQUIPPED_ITEM_IDS,
  HELMET_SILVERGUARD_ID,
  SHIELD_IRONWOOD_ID,
  STARTER_SWORD_ID,
  WILDWOOD_BLADE_ID,
  itemDef,
} from '../public/src/progression/items.js';
import {
  foldFacts,
  isProfileFact,
  latestEquippedFacts,
} from '../public/src/progression/facts.js';
import { createProfileStore } from '../public/src/progression/profiles.js';
import {
  damageReductionPercentForEquipment,
  resolveHeroStats,
} from '../public/src/progression/heroStats.js';
import { powerFor } from '../public/src/progression/power.js';
import { createPartyEncounterState, HERO_MAX_HP, stepParty, WOLF_BITE_DAMAGE } from '../public/src/combat/encounter.js';
import { createRewardCoordinator } from '../net/gameServer.mjs';
import {
  WARDEN_DAMAGE_PER_HIT,
  WARDEN_OVERHEAD_CONTACT_SECONDS,
  WARDEN_MAX_HP,
  stepSiege,
} from '../public/src/world/beaconSiege.js';
import { openRewardStore } from '../net/rewardStore.mjs';

const WOLF_STEP = 1 / 60;

function wolfHpAfterBite(damageReductionPercent) {
  let state = createPartyEncounterState({ heroIds: ['A'], wolfSpawn: { x: 0, z: 1.1 } });
  for (let tick = 0; tick < 240; tick += 1) {
    const stepped = stepParty(state, {
      deltaSeconds: WOLF_STEP,
      heroes: {
        A: {
          position: { x: 0, z: 0 },
          heading: 0,
          damageReductionPercent,
        },
      },
    });
    state = stepped.state;
    if (stepped.events.some((event) => event.type === 'hero-hurt')) break;
  }
  return state.heroes.A.hp;
}

function wardenState() {
  return {
    revision: 0,
    arena: { at: [0, 0], radiusMeters: 15 },
    sealsAt: [[-30, 0], [-30, 4], [-30, 8]],
    wardenAt: [0, 0],
    seals: [{ blows: 2, burst: true }, { blows: 2, burst: true }, { blows: 2, burst: true }],
    warden: {
      x: 0, z: 0, heading: 0, hp: WARDEN_MAX_HP, mode: 'idle', modeSeconds: 0,
      phase: 1, targetId: null, attackCooldown: 0, attackLanded: false,
      attackCount: 0, meleeCount: 0, pulseQueued: false, blowsTaken: 0,
    },
    heroes: {
      A: {
        hp: HERO_MAX_HP, maxHp: HERO_MAX_HP, swingSeconds: -1, cooldown: 0,
        swingLanded: false, downSeconds: -1, lastCommandId: null,
      },
    },
    beaconLit: false,
  };
}

function wardenHpAfterOverhead(damageReductionPercent) {
  let state = wardenState();
  const ticks = Math.ceil((WARDEN_OVERHEAD_CONTACT_SECONDS + 0.1) / WOLF_STEP);
  for (let tick = 0; tick < ticks; tick += 1) {
    state = stepSiege(state, {
      deltaSeconds: WOLF_STEP,
      heroes: {
        A: {
          position: { x: 0, z: 1.5 },
          heading: Math.PI,
          damageReductionPercent,
        },
      },
    }).state;
  }
  return state.heroes.A.hp;
}

test('C1 item authority defines truthful baseline Shield and earned Silverguard Helmet', () => {
  assert.equal(itemDef(SHIELD_IRONWOOD_ID).slot, 'shield');
  assert.equal(itemDef(SHIELD_IRONWOOD_ID).damageReductionPercent, 0);
  assert.equal(itemDef(HELMET_SILVERGUARD_ID).slot, 'helmet');
  assert.equal(itemDef(HELMET_SILVERGUARD_ID).damageReductionPercent, 10);
  assert.deepEqual(DEFAULT_EQUIPPED_ITEM_IDS, {
    weapon: STARTER_SWORD_ID,
    shield: SHIELD_IRONWOOD_ID,
  });
});

test('ownership alone does not equip the Helmet or change resolved mitigation', () => {
  const owned = foldFacts([
    { eventId: 'own-helmet', type: 'gear-owned', value: HELMET_SILVERGUARD_ID },
  ], {
    equippedItemIds: DEFAULT_EQUIPPED_ITEM_IDS,
    ownedItemIds: [STARTER_SWORD_ID, SHIELD_IRONWOOD_ID],
  });
  assert.ok(owned.ownedItemIds.includes(HELMET_SILVERGUARD_ID));
  assert.equal(owned.equippedItemIds.helmet, undefined);
  assert.equal(damageReductionPercentForEquipment(owned.equippedItemIds), 0);
  assert.equal(damageReductionPercentForEquipment({
    ...owned.equippedItemIds,
    helmet: HELMET_SILVERGUARD_ID,
  }), 10);
});

test('per-slot equip facts share the durable revision and event-id ordering law', () => {
  const older = { eventId: 'helmet-old', type: 'gear-equipped', value: HELMET_SILVERGUARD_ID, rev: 10 };
  const newer = { eventId: 'helmet-new', type: 'gear-equipped', value: HELMET_SILVERGUARD_ID, rev: 20 };
  assert.equal(latestEquippedFacts([newer, older]).get('helmet').eventId, 'helmet-new');
  assert.equal(latestEquippedFacts([older, newer]).get('helmet').eventId, 'helmet-new');
});

test('equipment fact type and canonical item slot are one semantic boundary', () => {
  const malformedWeapon = {
    eventId: 'malformed-weapon-helmet', type: 'weapon-equipped', value: HELMET_SILVERGUARD_ID, rev: 99,
  };
  const malformedGear = {
    eventId: 'malformed-gear-weapon', type: 'gear-equipped', value: WILDWOOD_BLADE_ID, rev: 100,
  };
  assert.equal(isProfileFact(malformedWeapon), false);
  assert.equal(isProfileFact(malformedGear), false);
  const folded = foldFacts([malformedWeapon, malformedGear], {
    equippedItemIds: DEFAULT_EQUIPPED_ITEM_IDS,
    equippedWeaponId: STARTER_SWORD_ID,
  });
  assert.deepEqual(folded.equippedItemIds, DEFAULT_EQUIPPED_ITEM_IDS);
  assert.equal(folded.equippedWeaponId, STARTER_SWORD_ID);
});

test('POWER uses effective survivability and preserves the C1 benchmarks', () => {
  const starterL1 = resolveHeroStats({ equippedItemIds: DEFAULT_EQUIPPED_ITEM_IDS });
  const starterL2 = resolveHeroStats({ totalXp: 100, equippedItemIds: DEFAULT_EQUIPPED_ITEM_IDS });
  const helmetL2 = resolveHeroStats({
    totalXp: 100,
    equippedItemIds: { ...DEFAULT_EQUIPPED_ITEM_IDS, helmet: HELMET_SILVERGUARD_ID },
  });
  assert.equal(powerFor(starterL1), 1000);
  assert.equal(powerFor(starterL2), 1400);
  assert.equal(powerFor(helmetL2), 1556);
  assert.equal(helmetL2.damageReductionPercent, 10);
  assert.equal(powerFor({ ...starterL2, damageReductionPercent: 0 }), 1400);
  const bladeL2 = resolveHeroStats({
    totalXp: 100,
    equippedItemIds: { ...DEFAULT_EQUIPPED_ITEM_IDS, weapon: WILDWOOD_BLADE_ID },
  });
  const bladeHelmetL2 = resolveHeroStats({
    totalXp: 100,
    equippedItemIds: {
      ...DEFAULT_EQUIPPED_ITEM_IDS, weapon: WILDWOOD_BLADE_ID, helmet: HELMET_SILVERGUARD_ID,
    },
  });
  assert.equal(powerFor(bladeL2), 2567);
  assert.equal(powerFor(bladeHelmetL2), 2852);
});

test('the real Wolf seam resolves 10 damage to 10 unarmored and 9 with the equipped Helmet', () => {
  assert.equal(wolfHpAfterBite(0), HERO_MAX_HP - WOLF_BITE_DAMAGE);
  assert.equal(wolfHpAfterBite(10), HERO_MAX_HP - 9);
});

test('the real Warden seam resolves 10 damage to 10 unarmored and 9 with the equipped Helmet', () => {
  assert.equal(wardenHpAfterOverhead(0), HERO_MAX_HP - WARDEN_DAMAGE_PER_HIT);
  assert.equal(wardenHpAfterOverhead(10), HERO_MAX_HP - 9);
});

test('non-weapon equip facts persist through the existing profile and store architecture', () => {
  const storage = new Map();
  const profileStore = createProfileStore({
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    randomUUID: () => 'fixture',
    now: () => new Date(1000),
  });
  const profile = profileStore.createProfile('C1');
  const fact = profileStore.mintEquipFact(profile.id, HELMET_SILVERGUARD_ID);
  assert.equal(fact.type, 'gear-equipped');
  assert.equal(profileStore.stateFor(profile.id).equippedItemIds.helmet, HELMET_SILVERGUARD_ID);

  const directory = mkdtempSync(join(tmpdir(), 'gq-g1-c1-'));
  const path = join(directory, 'rewards.db');
  const store = openRewardStore(path);
  try {
    store.apply({ guestId: 'guest-c1', type: 'gear-owned', eventId: 'own-helmet', value: HELMET_SILVERGUARD_ID });
    store.apply({
      guestId: 'guest-c1', type: 'gear-equipped', eventId: 'equip-helmet', value: HELMET_SILVERGUARD_ID, rev: 10,
    });
    assert.equal(store.equippedItemsFor('guest-c1').helmet, HELMET_SILVERGUARD_ID);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('reward-store acceptance refuses both malformed equipment encodings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gq-g1-c1-slot-store-'));
  const path = join(directory, 'rewards.db');
  const store = openRewardStore(path);
  try {
    assert.throws(() => store.apply({
      guestId: 'guest-c1-slot', type: 'weapon-equipped', eventId: 'bad-weapon-helmet',
      value: HELMET_SILVERGUARD_ID,
    }), /slot|weapon/i);
    assert.throws(() => store.apply({
      guestId: 'guest-c1-slot', type: 'gear-equipped', eventId: 'bad-gear-weapon',
      value: WILDWOOD_BLADE_ID,
    }), /slot|equipment/i);
    assert.deepEqual(store.profileFactsFor('guest-c1-slot'), []);
    store.close();
    const raw = new DatabaseSync(path);
    raw.prepare(
      'INSERT INTO reward_events (id, guest_id, type, created_at, value, rev) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('legacy-bad-weapon-helmet', 'guest-c1-published', 'weapon-equipped', 'now', HELMET_SILVERGUARD_ID, 1);
    raw.prepare(
      'INSERT INTO reward_events (id, guest_id, type, created_at, value, rev) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('legacy-bad-gear-weapon', 'guest-c1-published', 'gear-equipped', 'now', WILDWOOD_BLADE_ID, 2);
    raw.close();
    const reopened = openRewardStore(path);
    assert.deepEqual(reopened.profileFactsFor('guest-c1-published'), []);
    reopened.close();
  } finally {
    try { store.close(); } catch {}
    try { rmSync(directory, { recursive: true, force: true }); } catch {}
  }
});

test('restore rejects malformed equipment while recovering historical Weapon and new Helmet facts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gq-g1-c1-slot-restore-'));
  const path = join(directory, 'rewards.db');
  const rewards = createRewardCoordinator({ rewardStorePath: path });
  rewards.join('hero-c1-slot', 'guest-c1-slot-restore');
  rewards.grantOwnership('hero-c1-slot', WILDWOOD_BLADE_ID);
  try {
    const result = rewards.restoreProfileFacts('hero-c1-slot', [
      { eventId: 'bad-weapon-helmet-restore', type: 'weapon-equipped', value: HELMET_SILVERGUARD_ID, rev: 99 },
      { eventId: 'bad-gear-weapon-restore', type: 'gear-equipped', value: WILDWOOD_BLADE_ID, rev: 100 },
      { eventId: 'historical-weapon', type: 'weapon-equipped', value: WILDWOOD_BLADE_ID, rev: 10 },
      { eventId: 'new-helmet-owned', type: 'gear-owned', value: HELMET_SILVERGUARD_ID },
      { eventId: 'new-helmet', type: 'gear-equipped', value: HELMET_SILVERGUARD_ID, rev: 11 },
      { eventId: 'new-shield-owned', type: 'gear-owned', value: SHIELD_IRONWOOD_ID },
      { eventId: 'new-shield', type: 'gear-equipped', value: SHIELD_IRONWOOD_ID, rev: 12 },
    ]);
    assert.equal(result.refused, 2);
    const rewardsForHero = rewards.rewardsFor(['hero-c1-slot'])['hero-c1-slot'];
    assert.equal(rewardsForHero.equippedWeaponId, WILDWOOD_BLADE_ID);
    assert.equal(rewardsForHero.equippedItemIds.helmet, HELMET_SILVERGUARD_ID);
    assert.equal(rewardsForHero.equippedItemIds.shield, SHIELD_IRONWOOD_ID);
    assert.ok(rewards.profileFactsFor('hero-c1-slot').every((fact) => (
      fact.type !== 'weapon-equipped' || itemDef(fact.value)?.slot === 'weapon'
    )));
  } finally {
    rewards.close();
    try { rmSync(directory, { recursive: true, force: true }); } catch {}
  }
});
