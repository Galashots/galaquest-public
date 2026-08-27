import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  HERO_MAX_HP, createEncounterState, requestSoloHeroHeal, stepEncounter,
} from '../public/src/combat/encounter.js';

test('R1: requestSoloHeroHeal restores hp, capped at max, and raises hero-healed with no heroId', () => {
  const fresh = createEncounterState();
  // Hurt the solo hero directly on the published shape the way a bite already would, so there is
  // real ground to heal back from.
  const hurt = { ...fresh, hero: { ...fresh.hero, hp: HERO_MAX_HP - 5 } };

  const healed = requestSoloHeroHeal(hurt, 3);
  assert.equal(healed.state.hero.hp, HERO_MAX_HP - 2);
  assert.equal(healed.events.length, 1);
  assert.equal(healed.events[0].type, 'hero-healed');
  assert.equal(healed.events[0].remaining, HERO_MAX_HP - 2);
  assert.ok(!('heroId' in healed.events[0]), 'the solo path is heroId-less, like every other solo event');

  const overheal = requestSoloHeroHeal(healed.state, 100);
  assert.equal(overheal.state.hero.hp, HERO_MAX_HP, 'a heal never exceeds max hp');
});

test('a heal on an already-full hero is a clean no-op: no event, unchanged state reference fields', () => {
  const fresh = createEncounterState();
  const result = requestSoloHeroHeal(fresh, 20);
  assert.equal(result.events.length, 0);
  assert.equal(result.state.hero.hp, fresh.hero.hp);
});

test('a heal does not disturb the attack replay guard -- stepEncounter still dedupes the same commandId after one', () => {
  let state = createEncounterState();
  const attacked = stepEncounter(state, { commandId: 7, deltaSeconds: 0.1, attack: true });
  state = attacked.state;
  const healed = requestSoloHeroHeal(state, 1);
  const replay = stepEncounter(healed.state, { commandId: 7, deltaSeconds: 0.1, attack: true });
  assert.equal(replay.events.length, 0, 'commandId 7 must still read as a replay after an intervening heal');
});
