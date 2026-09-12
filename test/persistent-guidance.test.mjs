import { strict as assert } from 'node:assert';
import test from 'node:test';

import { SPECIAL_ATTACK_ID, SPECIAL_ATTACK_NAME, SPECIAL_ATTACK_UNLOCK_LEVEL } from '../public/src/combat/specialAttack.js';
import { cumulativeXpForLevel, levelStateForXp } from '../public/src/progression/levels.js';
import {
  persistentGuidanceView,
  wildwoodBurstAspirationView,
} from '../public/src/progression/guidanceView.js';

const UNLOCK_XP = cumulativeXpForLevel(SPECIAL_ATTACK_UNLOCK_LEVEL);

test('a fresh known hero sees the locked Wildwood Burst aspiration with real XP progress', () => {
  const view = wildwoodBurstAspirationView({
    progressionKnown: true,
    levelState: levelStateForXp(0),
  });

  assert.deepEqual(view, {
    id: SPECIAL_ATTACK_ID,
    name: SPECIAL_ATTACK_NAME,
    state: 'locked',
    stateText: `NEXT · LV ${SPECIAL_ATTACK_UNLOCK_LEVEL}`,
    progressText: `0 / ${UNLOCK_XP} XP`,
    progress: 0,
    ariaLabel: `${SPECIAL_ATTACK_NAME} locked. Reach level ${SPECIAL_ATTACK_UNLOCK_LEVEL}. `
      + `0 of ${UNLOCK_XP} XP`,
    desktopText: `next: ${SPECIAL_ATTACK_NAME} · reach level ${SPECIAL_ATTACK_UNLOCK_LEVEL}`,
  });
});
test('the aspiration progress follows the authoritative level fold without inventing a curve', () => {
  const xp = cumulativeXpForLevel(3) + 17;
  const view = wildwoodBurstAspirationView({
    progressionKnown: true,
    levelState: levelStateForXp(xp),
  });

  assert.equal(view.state, 'locked');
  assert.equal(view.progressText, `${xp} / ${UNLOCK_XP} XP`);
  assert.equal(view.progress, xp / UNLOCK_XP);
  assert.ok(view.ariaLabel.includes(`${xp} of ${UNLOCK_XP} XP`));
});

test('the exact Level-5 boundary retires the locked aspiration and marks Burst unlocked', () => {
  const view = wildwoodBurstAspirationView({
    progressionKnown: true,
    levelState: levelStateForXp(UNLOCK_XP),
  });

  assert.equal(view.id, SPECIAL_ATTACK_ID);
  assert.equal(view.state, 'unlocked');
  assert.equal(view.stateText, 'UNLOCKED');
  assert.equal(view.progressText, null);
  assert.equal(view.progress, 1);
  assert.match(view.ariaLabel, /unlocked at level 5/i);
  assert.match(view.desktopText, /unlocked/i);
});

test('unknown or inconsistent progression clears the aspiration rather than showing stale state', () => {
  assert.equal(wildwoodBurstAspirationView(), null);
  assert.equal(wildwoodBurstAspirationView({ progressionKnown: false, levelState: levelStateForXp(0) }), null);
  assert.equal(wildwoodBurstAspirationView({
    progressionKnown: true,
    levelState: { level: 4, totalXp: UNLOCK_XP },
  }), null);
  assert.equal(wildwoodBurstAspirationView({
    progressionKnown: true,
    levelState: { level: 5, totalXp: -1 },
  }), null);
});

test('persistent guidance keeps NOW tied to the supplied current objective and clears it when absent', () => {
  const objective = Object.freeze({ id: 'talk-to-keeper', text: 'Talk to Keeper Aldric' });
  const present = persistentGuidanceView({
    objective,
    progressionKnown: true,
    levelState: levelStateForXp(0),
  });
  assert.deepEqual(present.now, { id: objective.id, text: objective.text });
  assert.equal(present.aspiration.state, 'locked');

  const absent = persistentGuidanceView({
    objective: null,
    progressionKnown: true,
    levelState: levelStateForXp(0),
  });
  assert.equal(absent.now, null);
  assert.equal(absent.aspiration.state, 'locked');
});
