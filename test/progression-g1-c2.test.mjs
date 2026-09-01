import { strict as assert } from 'node:assert';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_EQUIPPED_ITEM_IDS,
  DEFAULT_OWNED_ITEM_IDS,
  HELMET_SILVERGUARD_ID,
  STARTER_SWORD_ID,
  WILDWOOD_BLADE_ID,
} from '../public/src/progression/items.js';
import { resolveHeroStats } from '../public/src/progression/heroStats.js';
import { powerFor } from '../public/src/progression/power.js';
import { createRewardCoordinator, HOLLOW_CACHE_SHARDS } from '../net/gameServer.mjs';
import { createPartyEncounterState, HERO_MAX_HP, stepParty, WOLF_BITE_DAMAGE } from '../public/src/combat/encounter.js';
import {
  WARDEN_DAMAGE_PER_HIT,
  WARDEN_MAX_HP,
  WARDEN_OVERHEAD_CONTACT_SECONDS,
  stepSiege,
} from '../public/src/world/beaconSiege.js';

function freshCoordinator() {
  const directory = mkdtempSync(join(tmpdir(), 'gq-g1-c2-'));
  const path = join(directory, 'rewards.db');
  const rewards = createRewardCoordinator({ rewardStorePath: path });
  return { rewards, directory, cleanup: () => { rewards.close(); rmSync(directory, { recursive: true, force: true }); } };
}

const WOLF_STEP = 1 / 60;

function wolfHpAfterBite(damageReductionPercent) {
  let state = createPartyEncounterState({ heroIds: ['A'], wolfSpawn: { x: 0, z: 1.1 } });
  for (let tick = 0; tick < 240; tick += 1) {
    const stepped = stepParty(state, {
      deltaSeconds: WOLF_STEP,
      heroes: { A: { position: { x: 0, z: 0 }, heading: 0, damageReductionPercent } },
    });
    state = stepped.state;
    if (stepped.events.some((e) => e.type === 'hero-hurt')) break;
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
      heroes: { A: { position: { x: 0, z: 1.5 }, heading: Math.PI, damageReductionPercent } },
    }).state;
  }
  return state.heroes.A.hp;
}

// ── 1. Hollow chest grants Helmet ownership alongside shards ────────────────────────────────────

test('applyHollowCache grants Helmet ownership alongside the three shards', () => {
  const { rewards, cleanup } = freshCoordinator();
  try {
    rewards.join('hero-a', 'guest-a');
    const result = rewards.applyHollowCache('hero-a');
    assert.ok(result.facts.length > HOLLOW_CACHE_SHARDS,
      'facts must include more than just the shard announcements');
    const helmetFact = result.facts.find(
      (f) => f.type === 'gear-owned' && f.value === HELMET_SILVERGUARD_ID,
    );
    assert.ok(helmetFact, 'Helmet ownership fact must be announced');
    assert.ok(rewards.ownedItemIdsFor('hero-a').includes(HELMET_SILVERGUARD_ID),
      'Helmet must appear in owned items after hollow claim');
    const shardFacts = result.facts.filter((f) => f.type === 'shard-earned');
    assert.equal(shardFacts.length, HOLLOW_CACHE_SHARDS);
  } finally {
    cleanup();
  }
});

// ── 2. Idempotency: second hollow claim grants nothing new ──────────────────────────────────────

test('a second applyHollowCache is a no-op for both shards and Helmet', () => {
  const { rewards, cleanup } = freshCoordinator();
  try {
    rewards.join('hero-a', 'guest-a');
    rewards.applyHollowCache('hero-a');
    const second = rewards.applyHollowCache('hero-a');
    assert.equal(second.granted, 0, 'no new shard rows on replay');
    assert.deepEqual(second.facts, [], 'no announcement facts on replay');
    assert.ok(rewards.ownedItemIdsFor('hero-a').includes(HELMET_SILVERGUARD_ID),
      'Helmet still owned after idempotent replay');
  } finally {
    cleanup();
  }
});

// ── 3. Ownership does NOT auto-equip ────────────────────────────────────────────────────────────

test('Helmet ownership from hollow does not auto-equip', () => {
  const { rewards, cleanup } = freshCoordinator();
  try {
    rewards.join('hero-a', 'guest-a');
    rewards.applyHollowCache('hero-a');
    const r = rewards.rewardsFor(['hero-a'])['hero-a'];
    assert.ok(r.ownedItemIds.includes(HELMET_SILVERGUARD_ID), 'owned');
    assert.equal(r.equippedItemIds.helmet, undefined, 'helmet slot must remain empty');
    assert.equal(r.equippedItemIds.weapon, STARTER_SWORD_ID);
    const stats = rewards.heroStatsFor('hero-a');
    assert.equal(stats.damageReductionPercent, 0, 'no mitigation without explicit equip');
  } finally {
    cleanup();
  }
});

// ── 4. Explicit equip writes durable Helmet equipment ───────────────────────────────────────────

test('explicit applyEquip after hollow ownership equips the Helmet durably', () => {
  const { rewards, cleanup } = freshCoordinator();
  try {
    rewards.join('hero-a', 'guest-a');
    rewards.applyHollowCache('hero-a');
    rewards.applyEquip('hero-a', HELMET_SILVERGUARD_ID);
    const r = rewards.rewardsFor(['hero-a'])['hero-a'];
    assert.equal(r.equippedItemIds.helmet, HELMET_SILVERGUARD_ID);
    const stats = rewards.heroStatsFor('hero-a');
    assert.equal(stats.damageReductionPercent, 10);
  } finally {
    cleanup();
  }
});

// ── 5. Equipped Helmet changes POWER ────────────────────────────────────────────────────────────

test('equipped Helmet from hollow changes resolved POWER', () => {
  const { rewards, cleanup } = freshCoordinator();
  try {
    rewards.join('hero-a', 'guest-a');
    rewards.applyHollowCache('hero-a');
    const statsBefore = rewards.heroStatsFor('hero-a');
    const powerBefore = powerFor(statsBefore);
    rewards.applyEquip('hero-a', HELMET_SILVERGUARD_ID);
    const statsAfter = rewards.heroStatsFor('hero-a');
    const powerAfter = powerFor(statsAfter);
    assert.ok(powerAfter > powerBefore,
      `POWER must rise: ${powerBefore} -> ${powerAfter}`);
    assert.equal(powerBefore, 1000, 'L1 starter baseline');
    assert.equal(powerAfter, 1111, 'L1 starter + Helmet');
  } finally {
    cleanup();
  }
});

// ── 6. Combat effect: Wolf and Warden deal 9 damage with equipped Helmet ────────────────────────

test('hollow-granted Helmet reduces Wolf bite from 10 to 9 through the combat seam', () => {
  const { rewards, cleanup } = freshCoordinator();
  try {
    rewards.join('hero-a', 'guest-a');
    rewards.applyHollowCache('hero-a');
    rewards.applyEquip('hero-a', HELMET_SILVERGUARD_ID);
    const stats = rewards.heroStatsFor('hero-a');
    assert.equal(wolfHpAfterBite(stats.damageReductionPercent), HERO_MAX_HP - 9);
    assert.equal(wolfHpAfterBite(0), HERO_MAX_HP - WOLF_BITE_DAMAGE,
      'unarmored baseline must still take full damage');
  } finally {
    cleanup();
  }
});

test('hollow-granted Helmet reduces Warden overhead from 10 to 9 through the combat seam', () => {
  const { rewards, cleanup } = freshCoordinator();
  try {
    rewards.join('hero-a', 'guest-a');
    rewards.applyHollowCache('hero-a');
    rewards.applyEquip('hero-a', HELMET_SILVERGUARD_ID);
    const stats = rewards.heroStatsFor('hero-a');
    assert.equal(wardenHpAfterOverhead(stats.damageReductionPercent), HERO_MAX_HP - 9);
    assert.equal(wardenHpAfterOverhead(0), HERO_MAX_HP - WARDEN_DAMAGE_PER_HIT,
      'unarmored baseline must still take full damage');
  } finally {
    cleanup();
  }
});

// ── 7. Recovery: profileFactsFor includes Helmet ownership ──────────────────────────────────────

test('profileFactsFor returns the Helmet ownership fact after hollow claim', () => {
  const { rewards, cleanup } = freshCoordinator();
  try {
    rewards.join('hero-a', 'guest-a');
    rewards.applyHollowCache('hero-a');
    const facts = rewards.profileFactsFor('hero-a');
    const helmetOwnership = facts.find(
      (f) => f.type === 'gear-owned' && f.value === HELMET_SILVERGUARD_ID,
    );
    assert.ok(helmetOwnership, 'Helmet gear-owned fact must be in profile facts for recovery');
    assert.ok(helmetOwnership.eventId.includes('helmet_silverguard'),
      'eventId must identify the Helmet');
  } finally {
    cleanup();
  }
});

test('profileFactsFor includes both Helmet ownership and equipment after equip', () => {
  const { rewards, cleanup } = freshCoordinator();
  try {
    rewards.join('hero-a', 'guest-a');
    rewards.applyHollowCache('hero-a');
    rewards.applyEquip('hero-a', HELMET_SILVERGUARD_ID);
    const facts = rewards.profileFactsFor('hero-a');
    const owned = facts.find((f) => f.type === 'gear-owned' && f.value === HELMET_SILVERGUARD_ID);
    const equipped = facts.find((f) => f.type === 'gear-equipped' && f.value === HELMET_SILVERGUARD_ID);
    assert.ok(owned, 'ownership fact survives');
    assert.ok(equipped, 'equipment fact survives');
  } finally {
    cleanup();
  }
});

// ── 8. Profile isolation: two guests get independent hollow rewards ──────────────────────────────

test('two guests each get their own Helmet from the hollow independently', () => {
  const { rewards, cleanup } = freshCoordinator();
  try {
    rewards.join('hero-a', 'guest-a');
    rewards.join('hero-b', 'guest-b');
    const resultA = rewards.applyHollowCache('hero-a');
    const resultB = rewards.applyHollowCache('hero-b');
    const helmetA = resultA.facts.find((f) => f.type === 'gear-owned' && f.value === HELMET_SILVERGUARD_ID);
    const helmetB = resultB.facts.find((f) => f.type === 'gear-owned' && f.value === HELMET_SILVERGUARD_ID);
    assert.ok(helmetA && helmetB, 'both guests get Helmet ownership');
    assert.notEqual(helmetA.eventId, helmetB.eventId, 'eventIds are per-guest');
    assert.ok(rewards.ownedItemIdsFor('hero-a').includes(HELMET_SILVERGUARD_ID));
    assert.ok(rewards.ownedItemIdsFor('hero-b').includes(HELMET_SILVERGUARD_ID));

    rewards.applyEquip('hero-a', HELMET_SILVERGUARD_ID);
    const rA = rewards.rewardsFor(['hero-a'])['hero-a'];
    const rB = rewards.rewardsFor(['hero-b'])['hero-b'];
    assert.equal(rA.equippedItemIds.helmet, HELMET_SILVERGUARD_ID, 'guest A equipped');
    assert.equal(rB.equippedItemIds.helmet, undefined, 'guest B not affected by A equipping');
  } finally {
    cleanup();
  }
});

// ── 9. Equip without ownership is refused ───────────────────────────────────────────────────────

test('equipping Helmet without hollow ownership is cleanly refused', () => {
  // Issue #82: an ownership miss returns { accepted: false } instead of throwing -- the refusal is
  // the property, the throw (which closed the connection) was the mechanism. See applyEquip.
  const { rewards, cleanup } = freshCoordinator();
  try {
    rewards.join('hero-a', 'guest-a');
    assert.deepEqual(rewards.applyEquip('hero-a', HELMET_SILVERGUARD_ID), { accepted: false },
      'equip without ownership must be refused');
    assert.equal(rewards.rewardsFor(['hero-a'])['hero-a'].equippedItemIds.helmet ?? null, null,
      'the refused helmet must not be equipped');
  } finally {
    cleanup();
  }
});

// ── 10. Ephemeral connection gets no Helmet ─────────────────────────────────────────────────────

test('ephemeral connection (no guestId) gets no Helmet from hollow', () => {
  const { rewards, cleanup } = freshCoordinator();
  try {
    rewards.join('hero-e');
    const result = rewards.applyHollowCache('hero-e');
    assert.equal(result.granted, 0);
    assert.deepEqual(result.facts, []);
    assert.ok(!rewards.ownedItemIdsFor('hero-e').includes(HELMET_SILVERGUARD_ID));
  } finally {
    cleanup();
  }
});

// ── 11. Full vertical: hollow → own → equip → stats → POWER → fight ────────────────────────────

test('full vertical: hollow claim through equipped Helmet to reduced Wolf damage', () => {
  const { rewards, cleanup } = freshCoordinator();
  try {
    rewards.join('hero-a', 'guest-a');

    const beforeStats = rewards.heroStatsFor('hero-a');
    assert.equal(beforeStats.damageReductionPercent, 0);
    assert.equal(wolfHpAfterBite(beforeStats.damageReductionPercent), HERO_MAX_HP - 10);

    rewards.applyHollowCache('hero-a');
    const midStats = rewards.heroStatsFor('hero-a');
    assert.equal(midStats.damageReductionPercent, 0, 'ownership alone changes nothing');

    rewards.applyEquip('hero-a', HELMET_SILVERGUARD_ID);
    const afterStats = rewards.heroStatsFor('hero-a');
    assert.equal(afterStats.damageReductionPercent, 10);
    assert.equal(wolfHpAfterBite(afterStats.damageReductionPercent), HERO_MAX_HP - 9);

    assert.ok(powerFor(afterStats) > powerFor(beforeStats));
  } finally {
    cleanup();
  }
});
