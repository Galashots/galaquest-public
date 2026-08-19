import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  ATTACK_COOLDOWN_SECONDS,
  ATTACK_REACH,
  MIN_BODY_SEPARATION,
  WOLF_BITE_RANGE,
  createEncounter,
  separateFromWolf,
  DEATH_SECONDS,
  HERO_MAX_HP,
  isWithinStrike,
  RESPAWN_SECONDS,
  STAGGER_SECONDS,
  SWING_CONTACT_SECONDS,
  WOLF_BITE_CONTACT_SECONDS,
  SWING_SECONDS,
  WOLF_DAMAGE_PER_HIT,
  WOLF_MAX_HP,
} from '../public/src/combat/encounter.js';

const STEP = 1 / 60;

function advance(encounter, seconds, position = { x: 0, z: 0 }, heading = 0) {
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    encounter.update(STEP, position, heading);
  }
}

// heading 0 faces +Z, because main.js derives it as atan2(x, z). Getting this backwards would make
// every swing land behind the hero, which is the kind of thing that looks like "combat feels wrong"
// rather than like a bug.
test('a strike reaches forward, not backward', () => {
  const origin = { x: 0, z: 0 };
  assert.equal(isWithinStrike(origin, 0, { x: 0, z: 1 }), true, 'directly ahead');
  assert.equal(isWithinStrike(origin, 0, { x: 0, z: -1 }), false, 'directly behind');
  assert.equal(isWithinStrike(origin, Math.PI, { x: 0, z: -1 }), true, 'behind, after turning round');
});

test('a strike stops at its reach', () => {
  const origin = { x: 0, z: 0 };
  assert.equal(isWithinStrike(origin, 0, { x: 0, z: ATTACK_REACH - 0.01 }), true);
  assert.equal(isWithinStrike(origin, 0, { x: 0, z: ATTACK_REACH + 0.01 }), false);
});

test('the arc is generous enough to be forgiving but not a full circle', () => {
  const origin = { x: 0, z: 0 };
  // Forty-five degrees off is still a hit: a child roughly facing a wolf should connect.
  assert.equal(isWithinStrike(origin, Math.PI / 4, { x: 0, z: 1 }), true);
  // Ninety-five degrees off is a miss, so swinging away from it visibly does nothing.
  assert.equal(isWithinStrike(origin, (95 * Math.PI) / 180, { x: 0, z: 1 }), false);
});

test('the blade lands part way through the swing, not on the button press', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 1 } });
  encounter.requestAttack();
  encounter.drainEvents();

  advance(encounter, SWING_CONTACT_SECONDS * 0.5);
  assert.equal(encounter.wolf.hp, WOLF_MAX_HP, 'nothing has happened yet');

  advance(encounter, SWING_CONTACT_SECONDS);
  assert.equal(encounter.wolf.hp, WOLF_MAX_HP - 1, 'the blade arrived');
});

// So a floating damage number reads WOLF_DAMAGE_PER_HIT off the event rather than a hardcoded "1"
// baked into the presenter -- if the number ever stops being one point per swing (the owner's own noted
// future: HP and damage moving to level/armour-derived stats), the number on screen follows the
// rules layer for free instead of a second constant silently going stale next to it.
test('a landed hit reports how much damage it did, not just what remains', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 1 } });
  encounter.requestAttack();
  advance(encounter, SWING_CONTACT_SECONDS);
  const hit = encounter.drainEvents().find((event) => event.type === 'wolf-hit');
  assert.ok(hit, 'expected a wolf-hit event');
  assert.equal(hit.damage, WOLF_DAMAGE_PER_HIT);
});

test('one swing costs one hit point however long it runs', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 1 } });
  encounter.requestAttack();
  advance(encounter, SWING_SECONDS * 2);
  assert.equal(encounter.wolf.hp, WOLF_MAX_HP - 1, 'a swing must not tick damage per frame');
});

// Rewritten 2026-08-13. It used to assert the MECHANISM -- that a separate cooldown blocked the next
// swing -- which stopped being true when ATTACK_COOLDOWN_SECONDS went to 0 and the 1.5s swing became
// the rate limiter on its own. The property it was really protecting is unchanged and is what it
// asserts now: hammering the button cannot make the hero attack faster than the swing allows. That
// survives whatever the two constants become, including a cooldown coming back.
test('attacks are rate limited, so mashing the button is not a win button', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 1 } });
  const STEP = 1 / 60;
  const position = { x: 0, z: 0 };

  // Ten seconds of a child holding the button down as hard as they can.
  let accepted = 0;
  const seconds = 10;
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    // Twice per frame, because a real child produces a touch AND a keyboard event some frames.
    if (encounter.requestAttack()) accepted += 1;
    if (encounter.requestAttack()) accepted += 1;
    encounter.update(STEP, position, 0);
  }

  const ceiling = Math.ceil(seconds / (SWING_SECONDS + ATTACK_COOLDOWN_SECONDS)) + 1;
  assert.ok(accepted <= ceiling,
    `${accepted} swings accepted in ${seconds}s, but a swing takes `
      + `${SWING_SECONDS + ATTACK_COOLDOWN_SECONDS}s, so at most ${ceiling} are possible`);
  // And the loop has to have actually swung, or a rule that rejected everything would pass.
  assert.ok(accepted >= 2, `only ${accepted} swings accepted, so this proved nothing`);
});

test('a swing cannot start while one is already running', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 1 } });
  assert.equal(encounter.requestAttack(), true);
  assert.equal(encounter.requestAttack(), false, 'not while a swing is running');

  // Mid-swing, well past where the old 0.45s swing would have finished.
  advance(encounter, SWING_SECONDS * 0.5);
  assert.equal(encounter.requestAttack(), false, 'still not, half way through');

  advance(encounter, SWING_SECONDS * 0.5 + ATTACK_COOLDOWN_SECONDS + 0.02);
  assert.equal(encounter.requestAttack(), true, 'and available again once it has finished');
});

// The attack button greys itself using canAttack(). If that ever disagrees with what requestAttack()
// actually accepts, a child sees a lit button that does nothing, or a greyed one that would have
// worked. Tying them together here is the only thing keeping them honest.
test('canAttack agrees with what requestAttack will accept, in every state', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 1 } });
  const position = { x: 0, z: 0 };
  const statesSeen = new Set();

  for (let step = 0; step < 3600; step += 1) {
    // Classify BEFORE requesting, or the swing that this very call starts hides the ready state and
    // 'ready' is never observed. Attacking on every frame also kept the wolf permanently staggered so
    // it never bit and the hero never went down -- the loop claimed "every state" while visiting two.
    // Swinging only occasionally leaves the wolf room to fight back.
    if (encounter.hero.downSeconds >= 0) statesSeen.add('down');
    else if (encounter.hero.swingSeconds >= 0) statesSeen.add('swinging');
    else if (encounter.hero.cooldown > 0) statesSeen.add('cooling');
    else statesSeen.add('ready');

    const predicted = encounter.canAttack();
    const accepted = step % 120 === 0 ? encounter.requestAttack() : predicted;
    assert.equal(accepted, predicted, `disagreed at step ${step}`);
    // Facing AWAY, deliberately. The wolf has few enough hit points that a hero who lands his
    // periodic swings kills it in seconds, after which nothing can ever bite him and the down state
    // is unreachable. Swinging at thin air keeps the wolf alive to finish the job. (This guard gets
    // SAFER as WOLF_MAX_HP rises, never weaker, which is why it survives owner HP tuning untouched.)
    encounter.update(STEP, position, Math.PI);
  }

  // The assertion that the loop above was worth running. Without this the test passes while
  // exercising a single state, which is what it did when first written.
  // 'cooling' only exists while ATTACK_COOLDOWN_SECONDS is above zero. It went to 0 on 2026-08-13
  // when the 1.5s swing became the rate limiter, so the state is currently unreachable -- but this is
  // written as a condition on the constant rather than deleted, so that the coverage requirement
  // re-arms by itself the moment a cooldown comes back.
  const reachable = ['ready', 'swinging', 'down'];
  if (ATTACK_COOLDOWN_SECONDS > 0) reachable.push('cooling');
  for (const state of reachable) {
    assert.ok(statesSeen.has(state), `never reached the ${state} state, so nothing was proven about it`);
  }
});

test('a downed hero cannot attack, and the button knows it', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 1.1 } });

  // Run until the hero is actually down rather than sampling at a fixed time and asserting inside an
  // `if`. That earlier shape executed zero assertions if the hero happened not to be down, so it
  // would have reported green with the whole down-state broken.
  let wentDown = false;
  for (let step = 0; step < 3600 && !wentDown; step += 1) {
    encounter.update(STEP, { x: 0, z: 0 }, 0);
    wentDown = encounter.hero.downSeconds >= 0;
  }
  assert.ok(wentDown, 'the wolf never managed to put the hero down, so this proves nothing');
  assert.equal(encounter.canAttack(), false, 'a downed hero must not be offered a swing');
  assert.equal(encounter.requestAttack(), false, 'and must not be able to take one');
});

// Reproduces the interleaving an adversarial review found: the hero presses attack, and the bite that
// puts them down lands before the blade does. requestAttack() checks downSeconds once, but the bite
// is processed AFTER the swing block in the same update(), so an in-flight swing used to run its
// full 0.45s and still land -- occasionally killing the wolf while the hero lay defeated, banner and
// all. Reachable in a ~180ms window on every bite of a close fight.
test('a hero who goes down mid-swing drops the blow instead of landing it', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 1.1 } });
  const position = { x: 0, z: 0 };

  let landedWhileDown = false;
  let sawDrop = false;
  for (let step = 0; step < 3600; step += 1) {
    // Aimed, not sprayed. Swinging every frame keeps the wolf staggered so it never bites and the
    // hero never goes down -- the interleaving then never happens and the test proves nothing.
    // Instead: hold fire until the hero is one bite from going down, then start a swing exactly as
    // the wolf's jaws are closing, so the fatal bite lands with the blade still in the air.
    // The timing is the whole test. Swing too early and the blade lands first (contact at 0.18s),
    // staggering the wolf so its bite never arrives and the hero never goes down. The swing has to
    // start late enough in the bite that the JAWS land first: after
    // WOLF_BITE_CONTACT_SECONDS - SWING_CONTACT_SECONDS have already elapsed.
    const oneBiteFromDown = encounter.hero.hp === 1;
    const jawsAboutToLand = encounter.wolf.mode === 'bite'
      && !encounter.wolf.biteLanded
      && encounter.wolf.modeSeconds >= WOLF_BITE_CONTACT_SECONDS - SWING_CONTACT_SECONDS + STEP;
    if (oneBiteFromDown && jawsAboutToLand) encounter.requestAttack();

    const hpBefore = encounter.wolf.hp;
    encounter.update(STEP, position, 0);
    if (encounter.hero.downSeconds >= 0 && encounter.wolf.hp < hpBefore) landedWhileDown = true;
    if (encounter.drainEvents().some((event) => event.type === 'swing-dropped')) sawDrop = true;
    if (encounter.wolf.mode === 'dead') break;
  }

  assert.ok(sawDrop, 'the hero never went down mid-swing, so the interleaving was never exercised');
  assert.equal(landedWhileDown, false, 'a downed hero landed a blow on the wolf');
});

test('a miss is reported as a miss rather than silently doing nothing', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 12 } });
  encounter.requestAttack();
  advance(encounter, SWING_CONTACT_SECONDS + 0.05);

  const kinds = encounter.drainEvents().map((event) => event.type);
  assert.ok(kinds.includes('swing-missed'), `expected a miss, saw ${kinds.join(', ')}`);
  assert.equal(encounter.wolf.hp, WOLF_MAX_HP);
});

test('WOLF_MAX_HP landed hits kill the wolf, and it stays dead', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 1 } });

  for (let blow = 0; blow < WOLF_MAX_HP; blow += 1) {
    encounter.requestAttack();
    advance(encounter, SWING_SECONDS + ATTACK_COOLDOWN_SECONDS + 0.02);
  }
  assert.equal(encounter.wolf.hp, 0);
  assert.equal(encounter.wolf.mode, 'dying');

  advance(encounter, DEATH_SECONDS + 0.1);
  assert.equal(encounter.wolf.mode, 'dead');

  // A dead wolf cannot be hit again, or the kill event fires twice and so does any reward.
  encounter.drainEvents();
  encounter.requestAttack();
  advance(encounter, SWING_SECONDS);
  const kinds = encounter.drainEvents().map((event) => event.type);
  assert.ok(!kinds.includes('wolf-defeated'), 'a corpse must not be defeated twice');
  assert.equal(encounter.wolf.hp, 0, 'and its hit points must not go negative');
});

test('a staggered wolf recovers rather than freezing in its hit pose', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 1 } });
  encounter.requestAttack();
  advance(encounter, SWING_CONTACT_SECONDS + 0.05);
  assert.equal(encounter.wolf.mode, 'hit');

  advance(encounter, STAGGER_SECONDS + 0.1);
  assert.notEqual(encounter.wolf.mode, 'hit', 'the stagger has to end on its own');
});

test('the wolf closes the distance instead of waiting to be walked into', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 5 } });
  const startDistance = encounter.wolf.z;

  advance(encounter, 1.5);
  assert.ok(encounter.wolf.z < startDistance, `wolf did not approach: ${encounter.wolf.z}`);
  assert.equal(encounter.wolf.mode, 'walk');
});

test('a wolf that reaches the hero bites, and the bite costs a hit point', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 1.1 } });

  advance(encounter, 1.2);
  const kinds = encounter.drainEvents().map((event) => event.type);
  assert.ok(kinds.includes('hero-hurt'), `expected a bite, saw ${kinds.join(', ')}`);
  assert.equal(encounter.hero.hp, HERO_MAX_HP - 1);
});

test('a downed hero respawns with the encounter reset, so the loop can repeat', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 1.1 } });

  advance(encounter, 12);
  assert.ok(encounter.hero.hp > 0, 'the hero should be back on their feet, not stuck at zero');
  assert.equal(encounter.wolf.hp, WOLF_MAX_HP, 'and the wolf reset with them');
});

// The wolf must never be able to bite from somewhere the hero cannot swing back at. If this ever
// inverts, a child is chewed on by something they are standing too far away to hit, and the only
// symptom is that the fight feels unfair.
test('the wolf cannot bite from outside the hero\'s reach', () => {
  assert.ok(
    WOLF_BITE_RANGE < ATTACK_REACH,
    `wolf bites at ${WOLF_BITE_RANGE} but the hero only reaches ${ATTACK_REACH}`,
  );
});

// Found by looking at a playtest capture, not by a test: the hero and wolf measured 0.145m apart and
// the wolf was drawn straight through his legs. Nothing in the rules held the hero off, and walking
// into the monster is the first thing a young player does.
test('the hero cannot walk inside the wolf', () => {
  const wolf = { x: 0, z: 0, mode: 'idle' };
  const inside = separateFromWolf({ x: 0.1, z: 0.05 }, wolf);
  assert.ok(
    Math.hypot(inside.x - wolf.x, inside.z - wolf.z) >= MIN_BODY_SEPARATION - 1e-9,
    `hero ended up ${Math.hypot(inside.x, inside.z)} from the wolf`,
  );
});

test('being pushed out keeps the direction the hero approached from', () => {
  const wolf = { x: 3, z: -2, mode: 'walk' };
  const pushed = separateFromWolf({ x: 3.4, z: -2 }, wolf);
  assert.ok(pushed.x > wolf.x, 'approached from +x, so must be pushed back towards +x');
  assert.ok(Math.abs(pushed.z - wolf.z) < 1e-9, 'and not slid sideways');
});

test('a hero already clear of the wolf is left exactly where they are', () => {
  const wolf = { x: 0, z: 0, mode: 'idle' };
  const free = { x: 4, z: 4 };
  assert.deepEqual(separateFromWolf(free, wolf), free);
});

test('standing dead centre picks a direction instead of returning NaN', () => {
  const wolf = { x: 2, z: 2, mode: 'idle' };
  const pushed = separateFromWolf({ x: 2, z: 2 }, wolf);
  assert.ok(Number.isFinite(pushed.x) && Number.isFinite(pushed.z), `got ${JSON.stringify(pushed)}`);
  assert.ok(Math.abs(Math.hypot(pushed.x - 2, pushed.z - 2) - MIN_BODY_SEPARATION) < 1e-9);
});

// A corpse must not keep shoving the hero around, and the testers will absolutely try to stand on it.
test('a dead wolf stops pushing the hero away', () => {
  const corpse = { x: 0, z: 0, mode: 'dead' };
  const standing = { x: 0.1, z: 0 };
  assert.deepEqual(separateFromWolf(standing, corpse), standing);
});

// If the separation ever exceeded the bite range the wolf could never reach the hero, and the fight
// would quietly become unloseable.
test('the separation still leaves the wolf close enough to bite', () => {
  assert.ok(
    MIN_BODY_SEPARATION < WOLF_BITE_RANGE,
    `held off at ${MIN_BODY_SEPARATION} but bites at ${WOLF_BITE_RANGE}: the wolf can never land one`,
  );
});

test('a wolf out of range ignores the hero entirely', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 40 } });
  advance(encounter, 2);
  assert.equal(encounter.wolf.mode, 'idle');
  assert.equal(encounter.wolf.z, 40, 'it should not have moved a millimetre');
});

// Measures the real interval between going down and standing up, rather than sampling at a fixed
// time and asserting inside an `if`. The old shape ran zero assertions whenever the hero happened not
// to be down at t=6s, so it would have gone green with respawn timing completely broken.
test('respawn takes the stated time rather than happening instantly', () => {
  const encounter = createEncounter({ wolfSpawn: { x: 0, z: 1.1 } });
  const position = { x: 0, z: 0 };

  let downAtSeconds = null;
  let upAtSeconds = null;
  for (let step = 0; step < 3600 && upAtSeconds === null; step += 1) {
    const wasDown = encounter.hero.downSeconds >= 0;
    encounter.update(STEP, position, 0);
    const isDown = encounter.hero.downSeconds >= 0;
    if (!wasDown && isDown && downAtSeconds === null) downAtSeconds = step * STEP;
    if (wasDown && !isDown && downAtSeconds !== null) upAtSeconds = step * STEP;
  }

  assert.ok(downAtSeconds !== null, 'the hero never went down, so respawn was never exercised');
  assert.ok(upAtSeconds !== null, 'the hero went down and never got back up');
  const downFor = upAtSeconds - downAtSeconds;
  assert.ok(
    Math.abs(downFor - RESPAWN_SECONDS) <= STEP * 2,
    `stayed down ${downFor.toFixed(3)}s against a stated ${RESPAWN_SECONDS}s`,
  );
});
