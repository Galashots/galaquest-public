// Reproduces the online -> offline handover freeze, root-caused in
// the private engineering archive: main.js's frame loop mirrors the server's published
// encounter block while netStatus === 'online' as a plain `{ wolf, hero }` two-key object (see the
// frame loop's `netStatus === 'online'` branch). The instant netStatus first leaves 'online', the
// offline branch calls stepEncounter/requestAttack directly on that same `encounterState` --  and
// encounter.js's publish()/publishParty() unconditionally read state.wolfSpawn.x/state.heroSpawn.x
// (encounter.js:289, :618). Undefined on the old mirror, so `.x` threw every single frame, forever,
// with no try/catch around main.js's requestAnimationFrame callback -- freezing the whole render
// loop, not just combat.
//
// This file builds the exact mirror shape main.js's frame loop produces (mirroring its source, not
// re-deriving it) and drives it straight through stepEncounter/requestAttack, with no browser and no
// DOM, the same way the private engineering archive's bare `node -e` reproduction did.

import test from 'node:test';
import assert from 'node:assert/strict';

import { requestAttack, stepEncounter } from '../public/src/combat/encounter.js';

// The wire's hero shape (net/protocol.js's decodeHeroes / main.js's DEFAULT_HERO_VIEW): the four
// fields a client needs to predict its own attack button and render hearts.
const MIRRORED_HERO = { hp: 2, swingSeconds: -1, cooldown: 0, downSeconds: -1 };
// The wire's wolf shape (net/protocol.js's decodeWolf): x/z/heading/hp/mode/targetId, plus optional
// modeSeconds. No wolfSpawn, no biteCooldown, no biteLanded -- those never leave the server.
const MIRRORED_WOLF = { x: 2.5, z: 8, heading: 0, hp: 2, mode: 'idle', targetId: null };

// main.js's frame loop, TODAY, as it builds `encounterState` while netStatus === 'online' -- see
// its `if (netStatus === 'online') { ... encounterState = { wolf: published.wolf, hero: ownHero };
// }`. This is a fixture, not an import, because main.js pulls in three.js and the DOM and cannot run
// under plain node -- exactly why encounter.js is kept pure and importable on its own (AGENTS.md,
// "Never restate a constant. Import it" -- the shape itself cannot be imported, so it is reproduced
// here byte-for-byte instead of re-derived).
function buildOnlineMirror() {
  return { wolf: MIRRORED_WOLF, hero: MIRRORED_HERO };
}

test('the pre-fix online mirror is missing the fields publish()/publishParty() require', () => {
  // Documents the crash this file exists to catch a regression of: a mirror with no wolfSpawn/
  // heroSpawn throws inside encounter.js the moment the offline rules touch it. encounter.js is not
  // being changed (the rules are correct; the mirror was malformed), so this stays true forever --
  // it is the reason main.js's mirror has to carry a complete state, not a symptom of a bug still
  // open in encounter.js.
  const mirror = buildOnlineMirror();
  assert.throws(
    () => stepEncounter(mirror, { deltaSeconds: 0.05 }),
    /Cannot read propert(?:y|ies) of undefined/,
    'expected the malformed mirror to throw on state.wolfSpawn.x -- if this stopped throwing, ' +
      'encounter.js itself changed and that is out of scope for this fix',
  );
  assert.throws(
    () => requestAttack(mirror, 1),
    /Cannot read propert(?:y|ies) of undefined/,
  );
});

// The shape main.js's online mirror must carry after the fix: a complete encounter state, not a
// two-key view. wolfSpawn/heroSpawn match net/gameServer.mjs's WOLF_SPAWN and encounter.js's default
// heroSpawn (main.js keeps its own copies -- the server module is Node-only and not importable by
// the browser). Internal-only fields the wire never carries (biteCooldown, biteLanded, swingLanded)
// default the same way a fresh createEncounterState() does; revision/lastCommandId come along so the
// object is valid on its own terms, not just for the online-only readers that used to be its only
// consumers.
function buildFixedOnlineMirror() {
  return {
    revision: 0,
    lastCommandId: null,
    wolfSpawn: { x: 2.5, z: 8 },
    heroSpawn: { x: 0, z: 0 },
    wolf: { biteCooldown: 0, biteLanded: false, modeSeconds: 0, ...MIRRORED_WOLF },
    hero: { swingLanded: false, ...MIRRORED_HERO },
  };
}

test('the fixed online mirror survives an offline stepEncounter/requestAttack call', () => {
  const mirror = buildFixedOnlineMirror();
  const stepped = stepEncounter(mirror, { deltaSeconds: 0.05, heroPosition: { x: 0, z: 0 }, heroHeading: 0 });
  assert.equal(typeof stepped.state, 'object');
  assert.ok(Array.isArray(stepped.events));
  // The re-seeded spawns must round-trip so a wolf death offline still resets to the right place.
  assert.deepEqual(stepped.state.wolfSpawn, { x: 2.5, z: 8 });
  assert.deepEqual(stepped.state.heroSpawn, { x: 0, z: 0 });

  const attacked = requestAttack(mirror, 1);
  assert.equal(typeof attacked.state, 'object');
  assert.ok(Array.isArray(attacked.events));
});

test('driving several frames offline off the fixed mirror never throws', () => {
  // The freeze was not a one-shot crash; it repeated every frame forever. Simulate a short run of
  // offline frames the way main.js's frame loop would, once the mirror is well-formed.
  let state = buildFixedOnlineMirror();
  let commandId = 1;
  for (let i = 0; i < 30; i += 1) {
    const attack = i === 5;
    if (attack) {
      const asked = requestAttack(state, commandId++);
      state = asked.state;
    }
    const stepped = stepEncounter(state, {
      commandId: commandId++,
      deltaSeconds: 1 / 60,
      heroPosition: { x: 0, z: 6 },
      heroHeading: 0,
    });
    state = stepped.state;
  }
  assert.equal(typeof state, 'object');
});
