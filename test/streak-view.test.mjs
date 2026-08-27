import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  coinMultiplierForStreak,
  createStreakState,
  registerKill,
  stepStreak,
  STREAK_TIER_2_KILLS,
} from '../public/src/progression/streaks.js';
import { streakMeterView } from '../public/src/progression/streakView.js';

test('a fresh streak state shows no meter', () => {
  assert.equal(streakMeterView(createStreakState()), null);
});

test('one kill shows the meter at x1, a full ring, and no tier crossed', () => {
  const state = registerKill(createStreakState());
  const view = streakMeterView(state);
  assert.equal(view.streak, 1);
  assert.equal(view.multiplier, 1);
  assert.equal(view.tierLabel, 'STREAK');
  assert.equal(view.countText, 'x1');
  assert.equal(view.ringFraction, 1);
  assert.equal(view.justReachedTier2, false);
  assert.equal(view.justReachedTier3, false);
});

test('the ring drains as the window elapses, and the meter disappears once it expires', () => {
  let state = registerKill(createStreakState());
  state = stepStreak(state, 15);
  assert.equal(streakMeterView(state).ringFraction, 0.5);
  state = stepStreak(state, 15.01);
  assert.equal(streakMeterView(state), null, 'a streak past the window is gone, not a ring at zero');
});

test('tier 2 at five kills reads ON A ROLL and reports the crossing; tier 3 at ten reads ON FIRE', () => {
  let state = createStreakState();
  for (let i = 0; i < 4; i += 1) state = registerKill(state);
  assert.equal(streakMeterView(state).multiplier, 1);

  state = registerKill(state); // 5th kill
  const tier2 = streakMeterView(state);
  assert.equal(tier2.multiplier, 2);
  assert.equal(tier2.tierLabel, 'ON A ROLL');
  assert.equal(tier2.justReachedTier2, true);
  assert.equal(tier2.justReachedTier3, false);

  for (let i = 0; i < 5; i += 1) state = registerKill(state);
  const tier3 = streakMeterView(state);
  assert.equal(tier3.streak, 10);
  assert.equal(tier3.multiplier, 3);
  assert.equal(tier3.tierLabel, 'ON FIRE');
  assert.equal(tier3.justReachedTier3, true);
  assert.equal(tier3.justReachedTier2, false, 'only the tier crossed THIS kill is flagged');
});

/**
 * TWO CHILDREN, ONE METER. The drawn `xN` is not a vague momentum readout: streakView.js builds it
 * from coinMultiplierForStreak, which is the SAME function net/gameServerCore.mjs passes into the
 * drop roll as `streakMultiplier` to size the coins a kill actually pays. So the number on the
 * screen is a promise about the next payout, and the server credits a streak only to the hero whose
 * blow finished the enemy (gameServerCore.mjs's own per-player streakByPlayer).
 *
 * `wolf-defeated` is not one of the server's WOLF_BODY_EVENTS, so it is broadcast to every viewer
 * with heroId intact -- both brothers see both brothers' kills. Folding all of them into one local
 * meter therefore makes the HUD overclaim: below, four kills by one child and one by the other
 * draw "x2 / ON A ROLL" on the second child's screen while the server will pay him x1.
 */
test('two clients: a sibling\'s kill must not move MY multiplier, because the server prices MY next kill off MY OWN streak', () => {
  const broadcast = [
    { type: 'wolf-defeated', enemyId: 'e1', heroId: 'luke' },
    { type: 'wolf-defeated', enemyId: 'e2', heroId: 'luke' },
    { type: 'wolf-defeated', enemyId: 'e3', heroId: 'luke' },
    { type: 'wolf-defeated', enemyId: 'e4', heroId: 'luke' },
    { type: 'wolf-defeated', enemyId: 'e5', heroId: 'henrik' },
  ];
  assert.equal(broadcast.length, STREAK_TIER_2_KILLS,
    'the fixture has to be exactly a tier-2 worth of party kills for the overclaim to be visible');

  let partyWide = createStreakState();
  for (const _event of broadcast) partyWide = registerKill(partyWide);
  let mine = createStreakState();
  for (const event of broadcast) if (event.heroId === 'henrik') mine = registerKill(mine);

  // What a party-wide fold would draw on Henrik's screen...
  assert.equal(streakMeterView(partyWide).countText, 'x2');
  assert.equal(streakMeterView(partyWide).tierLabel, 'ON A ROLL');
  // ...against what the server will actually pay him on his NEXT kill.
  assert.equal(coinMultiplierForStreak(registerKill(mine).streak), 1);
  // So the meter has to be fed the own-kill fold.
  assert.equal(streakMeterView(mine).countText, 'x1');
  assert.equal(streakMeterView(mine).tierLabel, 'STREAK');
});

/**
 * ...and the guard that the client actually feeds it that way. public/src/main.js is the integration
 * file rather than a pure module, so this is a source-seam regression guard -- the same shape
 * test/beacon-ignite-late-zone.test.mjs uses for the same reason.
 */
test('two clients: the drawn xN advances only on THIS hero\'s own killing blow', () => {
  const source = readFileSync(new URL('../public/src/main.js', import.meta.url), 'utf8');
  assert.equal((source.match(/registerStreakKill\(/g) ?? []).length, 1,
    'exactly one streak advance is expected -- a second one would need its own gate');
  const advanceAt = source.indexOf('registerStreakKill(');
  // lastIndexOf, not a forward search: the online dispatch loop further up main.js contains an
  // unrelated `event.type === 'wolf-defeated' && event.heroId === ownHeroId` (the line that fills
  // myKillEnemyIds), and anchoring on that one would pass no matter where the advance sits.
  const openerAt = source.lastIndexOf("if (event.type === 'wolf-defeated'", advanceAt);
  assert.ok(openerAt > 0, 'could not find the wolf-defeated dispatch block');
  assert.match(source.slice(openerAt, advanceAt), /myKillEnemyIds\.has\(event\.enemyId\)/,
    'the streak advance must sit INSIDE the myKillEnemyIds gate: the meter prints an xN coin '
    + 'multiplier and net/gameServerCore.mjs prices coins off the KILLER\'s own streak, so a '
    + "sibling's kill must not move this hero's meter");
});

/**
 * The reason the gate above is a no-op offline, pinned so solo play cannot be broken by it: the
 * offline branch adds EVERY wolf-defeated to myKillEnemyIds, and does so before the `if (!deadEnemy)
 * bail, so offline every defeat is still this hero's own kill and the local streak stays the sole
 * authority exactly as it was.
 */
test('offline, every defeat is still this hero\'s own kill, so the gate cannot cost solo play its streak', () => {
  const source = readFileSync(new URL('../public/src/main.js', import.meta.url), 'utf8');
  const offlineAt = source.indexOf("if (event.type !== 'wolf-defeated') continue;");
  assert.ok(offlineAt > 0, 'the offline kill-drop loop has moved or been renamed');
  const addAt = source.indexOf('myKillEnemyIds.add(event.enemyId);', offlineAt);
  const bailAt = source.indexOf('if (!deadEnemy) continue;', offlineAt);
  assert.ok(addAt > offlineAt && bailAt > addAt,
    'offline, every wolf-defeated must reach myKillEnemyIds.add before any bail-out');
});
