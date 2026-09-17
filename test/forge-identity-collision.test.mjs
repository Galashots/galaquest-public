// test/forge-identity-collision.test.mjs
//
// P3 CP1 durable identity-collision regressions (DeepSeek reproduction): global durable event IDs
// are semantic identities. Identical semantic replay stays a harmless no-op (even across sibling
// provenance); any conflicting reuse fails loudly; and claimForgeRelight reports durable truth.
//
// Socket-free by design: every claim here runs through createRewardCoordinator directly, so this
// file stays green where the sandbox cannot open sockets.

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createRewardCoordinator } from '../net/gameServerCore.mjs';
import { openRewardStore } from '../net/rewardStore.mjs';
import {
  EMBERWORKS_FORGE_LIT_EVENT_ID,
  FORGE_RELIGHT_COMPLETED,
  relightCompletionFact,
} from '../public/src/learning/runeForge.js';
import { WILDWOOD_BLADE_ID } from '../public/src/progression/items.js';

const GUEST_A = 'profile-aaaaaaaa';
const GUEST_B = 'profile-bbbbbbbb';

function tempStorePath(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  return {
    path: join(directory, 'rewards.db'),
    cleanup: () => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}

function countWorldRows(storePath) {
  const db = new DatabaseSync(storePath);
  try {
    return db.prepare("SELECT COUNT(*) AS c FROM reward_events WHERE type = 'emberworks-forge-lit'").get().c;
  } finally {
    db.close();
  }
}

// (1) An equip can neither squat the Forge world event ID first nor silently reuse it later.
test('P3-CP1 equip cannot squat the Forge world event ID, first write or replay', () => {
  const fixture = tempStorePath('gq-forge-collision-equip-');
  const rewards = createRewardCoordinator({ rewardStorePath: fixture.path });
  try {
    rewards.join('hero-a', GUEST_A);
    rewards.grantOwnership('hero-a', WILDWOOD_BLADE_ID);
    assert.throws(
      () => rewards.applyEquip('hero-a', WILDWOOD_BLADE_ID,
        { eventId: EMBERWORKS_FORGE_LIT_EVENT_ID, rev: 1 }),
      /shared-world eventId/,
      'the squat equip itself fails loudly, leaving no row behind',
    );
    assert.equal(rewards.forgeLit(), false, 'no world row was written');
    assert.deepEqual(
      rewards.profileFactsFor('hero-a').filter((fact) => fact.eventId === EMBERWORKS_FORGE_LIT_EVENT_ID),
      [],
      'no equip row squats the world identity either',
    );

    // The honest path still works after the refused attack: the finale lights a dark forge.
    const relight = rewards.claimForgeRelight('hero-a');
    assert.equal(relight.worldApplied, true);
    assert.equal(relight.granted, true);
    assert.equal(rewards.forgeLit(), true);
    assert.equal(countWorldRows(fixture.path), 1);
  } finally {
    rewards.close();
    fixture.cleanup();
  }
});

// (2) Conflicting reuse of one event ID with a different type/value/rev fails loudly, atomically.
test('P3-CP1 conflicting reuse of an event ID fails loudly and writes nothing', () => {
  const fixture = tempStorePath('gq-forge-collision-conflict-');
  const store = openRewardStore(fixture.path);
  try {
    store.apply({ guestId: GUEST_A, type: 'mark-earned', eventId: 'mark:conflict:0' });
    assert.throws(
      () => store.apply({
        guestId: GUEST_A, type: 'xp-earned', eventId: 'mark:conflict:0', value: '100',
      }),
      /conflicting reuse/,
      'same id, different type',
    );
    store.apply({
      guestId: GUEST_A, type: 'gear-owned', eventId: 'own:conflict:blade', value: WILDWOOD_BLADE_ID,
    });
    assert.throws(
      () => store.apply({
        guestId: GUEST_A, type: 'gear-owned', eventId: 'own:conflict:blade', value: 'helmet_silverguard',
      }),
      /conflicting reuse/,
      'same id and type, different value',
    );
    assert.equal(store.ownedItemIdsFor(GUEST_A).length, 1, 'only the first grant survived');
    assert.throws(
      () => store.applyAll([
        { guestId: GUEST_A, type: 'mark-earned', eventId: 'mark:conflict:batch' },
        { guestId: GUEST_A, type: 'xp-earned', eventId: 'mark:conflict:batch', value: '100' },
      ]),
      /conflicting reuse/,
    );
    assert.equal(store.marksFor(GUEST_A), 1, 'the conflicting batch rolled back entirely');
  } finally {
    store.close();
    fixture.cleanup();
  }
});

// (3)+(4) Identical replay is a no-op -- including a sibling replaying shared world truth.
test('P3-CP1 identical semantic replay is a no-op, however many siblings replay it', () => {
  const fixture = tempStorePath('gq-forge-collision-replay-');
  const store = openRewardStore(fixture.path);
  try {
    assert.equal(
      store.apply({ guestId: GUEST_A, type: 'emberworks-forge-lit', eventId: EMBERWORKS_FORGE_LIT_EVENT_ID }).applied,
      true,
    );
    assert.equal(
      store.apply({ guestId: GUEST_B, type: 'emberworks-forge-lit', eventId: EMBERWORKS_FORGE_LIT_EVENT_ID }).applied,
      false,
      'a sibling replaying the shared lighting under their own provenance is the same event',
    );
    assert.equal(store.forgeLit(), true);
    store.close();
    const reopened = openRewardStore(fixture.path);
    try {
      assert.equal(reopened.forgeLit(), true, 'restart keeps the shared lighting');
    } finally {
      reopened.close();
    }
    assert.equal(countWorldRows(fixture.path), 1, 'one shared world row, not one per claimant');
  } finally {
    fixture.cleanup();
  }
});

// (3b) Identical equip replay keeps chronology; a different rev under the same id is a conflict.
test('P3-CP1 identical equip replay is a no-op and keeps the latest choice winning', () => {
  const fixture = tempStorePath('gq-forge-collision-equipreplay-');
  const rewards = createRewardCoordinator({ rewardStorePath: fixture.path });
  try {
    rewards.join('hero-a', GUEST_A);
    rewards.grantOwnership('hero-a', WILDWOOD_BLADE_ID);
    rewards.applyEquip('hero-a', WILDWOOD_BLADE_ID, { eventId: `equip:${GUEST_A}:fixed`, rev: 10 });
    rewards.applyEquip('hero-a', WILDWOOD_BLADE_ID, { eventId: `equip:${GUEST_A}:fixed`, rev: 10 });
    assert.equal(
      rewards.rewardsFor(['hero-a'])['hero-a'].equippedWeaponId, WILDWOOD_BLADE_ID,
      'replaying the identical equip changes nothing',
    );
    assert.throws(
      () => rewards.applyEquip('hero-a', WILDWOOD_BLADE_ID, { eventId: `equip:${GUEST_A}:fixed`, rev: 11 }),
      /conflicting reuse/,
      'the same choice re-ordered under the same id is a different semantic event',
    );
  } finally {
    rewards.close();
    fixture.cleanup();
  }
});

// (5) A squatted personal relight ID cannot produce a false personal grant.
test('P3-CP1 squatting a personal relight ID yields a loud refusal, never a grant', () => {
  const fixture = tempStorePath('gq-forge-collision-personal-');
  const rewards = createRewardCoordinator({ rewardStorePath: fixture.path });
  try {
    rewards.join('hero-a', GUEST_A);
    rewards.grantOwnership('hero-a', WILDWOOD_BLADE_ID);
    const personal = relightCompletionFact(GUEST_A);
    rewards.applyEquip('hero-a', WILDWOOD_BLADE_ID, { eventId: personal.eventId, rev: 5 });
    assert.throws(
      () => rewards.claimForgeRelight('hero-a'),
      /conflicting reuse/,
      'the finale fails loudly instead of granting into a squatted identity',
    );
    assert.deepEqual(
      rewards.profileFactsFor('hero-a').filter((fact) => fact.type === FORGE_RELIGHT_COMPLETED),
      [],
      'no personal completion was granted',
    );
    assert.equal(rewards.forgeLit(), false, 'the rolled-back batch lit nothing either');
  } finally {
    rewards.close();
    fixture.cleanup();
  }
});

// (6) Pre-fix damage (a legacy row squatting the world ID) can never read as a lit forge.
test('P3-CP1 a legacy-squatted world ID throws loudly and never latches a false relit', () => {
  const fixture = tempStorePath('gq-forge-collision-legacy-');
  const setup = openRewardStore(fixture.path);
  try {
    // A row exactly as the pre-fix bug left it: an equip occupying the world identity.
    const raw = new DatabaseSync(fixture.path);
    try {
      raw.prepare(
        'INSERT INTO reward_events (id, guest_id, type, created_at, value, rev) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(EMBERWORKS_FORGE_LIT_EVENT_ID, GUEST_A, 'gear-equipped', 'pre-fix', WILDWOOD_BLADE_ID, 1);
    } finally {
      raw.close();
    }
    assert.equal(setup.forgeLit(), false, 'the squat row is not a lit forge');
    setup.close();
  } finally {
    try { setup.close(); } catch { /* already closed on the honest path */ }
  }
  const rewards = createRewardCoordinator({ rewardStorePath: fixture.path });
  try {
    rewards.join('hero-a', GUEST_A);
    assert.throws(
      () => rewards.claimForgeRelight('hero-a'),
      /conflicting reuse/,
      'the finale refuses loudly rather than reporting a relit it did not durably write',
    );
    assert.equal(rewards.forgeLit(), false, 'durable truth stays dark; no latch, no ceremony');
  } finally {
    rewards.close();
    fixture.cleanup();
  }
});
