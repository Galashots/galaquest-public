import { strict as assert } from 'node:assert';
import test from 'node:test';

import { readFileSync } from 'node:fs';

import { nextDropPresenterPhase } from '../public/src/world/enemyDropsPresenter.js';
import { OFFLINE_HERO_ID } from '../public/src/rewards/offlineProgress.js';

test('appearing holds until its own pop-in tween completes, then rests', () => {
  assert.equal(nextDropPresenterPhase('appearing', { phaseComplete: false }), 'appearing');
  assert.equal(nextDropPresenterPhase('appearing', { phaseComplete: true }), 'resting');
});

test('resting holds while uncollected, flies to whoever collected it, and despawns for everyone else', () => {
  assert.equal(nextDropPresenterPhase('resting', { collectedBy: null }), 'resting');
  assert.equal(nextDropPresenterPhase('resting', { collectedBy: 'p1', selfHeroId: 'p1' }), 'attracting');
  assert.equal(nextDropPresenterPhase('resting', { collectedBy: 'p2', selfHeroId: 'p1' }), 'gone');
});

test('attracting holds for the whole flight, then is gone', () => {
  assert.equal(nextDropPresenterPhase('attracting', { phaseComplete: false }), 'attracting');
  assert.equal(nextDropPresenterPhase('attracting', { phaseComplete: true }), 'gone');
});

test('gone is a terminal state regardless of what is passed', () => {
  assert.equal(nextDropPresenterPhase('gone', { collectedBy: 'p1', selfHeroId: 'p1', phaseComplete: true }), 'gone');
});

/**
 * OFFLINE, THE COLLECTOR IS `OFFLINE_HERO_ID`, NOT A SOCKET ID.
 *
 * With no server there is no net.selfId -- net/client.js holds it null before it ever connects and
 * clears it again on disconnect -- while the offline collect stamps every drop it takes with
 * OFFLINE_HERO_ID. Handing the presenter a null self therefore made the child's OWN drop read as
 * somebody else's: the phase jumped straight to 'gone', the mesh blinked out with no attraction
 * flight, and update() returned no arrival. Every offline reward is driven by those arrivals, so a
 * child playing with no server walked onto the heart a Frost Wolf dropped at 8 HP, watched it
 * vanish, and stayed at 8 HP -- the whole offline heart-heal path was unreachable.
 */
test('offline, the hero\'s own drop still flies to them: the collector id is OFFLINE_HERO_ID', () => {
  assert.equal(
    nextDropPresenterPhase('resting', { collectedBy: OFFLINE_HERO_ID, selfHeroId: OFFLINE_HERO_ID }),
    'attracting',
  );
  // ...and the null the socket hands out before it has ever connected is exactly the value that
  // used to be passed in its place.
  assert.equal(
    nextDropPresenterPhase('resting', { collectedBy: OFFLINE_HERO_ID, selfHeroId: null }),
    'gone',
  );
});

test('main.js hands the drops presenter the offline hero id when it is not online', () => {
  // A source-seam guard: main.js is the integration file, not a pure module, and the pure state
  // machine above cannot see which id its caller passes.
  const source = readFileSync(new URL('../public/src/main.js', import.meta.url), 'utf8');
  const updateAt = source.indexOf('dropsPresenter.update(');
  assert.ok(updateAt > 0, 'the drops presenter update call has moved or been renamed');
  const call = source.slice(updateAt, source.indexOf(';', updateAt));
  assert.doesNotMatch(call, /net\.selfId/,
    'net.selfId alone is null offline, so every offline drop reads as somebody else\'s and pays out '
    + 'nothing -- the collecting hero id has to branch on netStatus');
  // ANCHORED ON THE ASSIGNMENT, which is code, rather than on a window of source above the call,
  // which is mostly comment. The first version of this guard matched OFFLINE_HERO_ID anywhere in
  // the preceding 600 characters -- and the comment block above the call mentions it twice, so
  // re-wording a comment would have silently disarmed the test while it stayed green. The call
  // passes a local, so the binding of that local is the thing that has to be pinned.
  const collector = /const\s+(\w+)\s*=\s*([^;]*OFFLINE_HERO_ID[^;]*);/.exec(source);
  assert.ok(collector, 'no binding resolves the collecting hero id from OFFLINE_HERO_ID at all');
  assert.match(call, new RegExp(`\\b${collector[1]}\\b`),
    'the drops presenter must be handed the id that branches to OFFLINE_HERO_ID, not some other one');
  assert.match(collector[2], /netStatus/,
    'offline the collecting hero is OFFLINE_HERO_ID -- the same constant the offline collect stamps '
    + 'the drop with -- so the binding has to branch on netStatus rather than trusting net.selfId');
});
