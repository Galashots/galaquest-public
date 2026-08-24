// Can a four-year-old beat the first wolf?
//
// This file exists because that question was answered wrong four times in one night, each time by an
// instrument rather than by the game, and each wrong answer was confident. The measurements that
// produced them are recorded here rather than in a commit message, because the next person to ask
// will reach for the same instruments:
//
//   - a browser probe that tapped coordinates it had invented rather than the ones play-fight.mjs
//     had been using all along -- 0 of 36 taps landed, and it read as a brutally hard fight;
//   - a probe that reused one server across fights, so the second fight walked up to the corpse the
//     first had left and reported a 1.6-second rout;
//   - a probe that sampled the attack button 250ms after each press, when contact is at 0.5167s --
//     it saw no miss rings and reported that whiffs are silent, which is the absence of a thing that
//     had not happened yet;
//   - a probe that mashed for a fixed 45 seconds when the fight takes a fraction of that, so the
//     wolf died, respawned ten seconds later and was fought again; it reported "wolf 3hp -> 3hp"
//     and fifteen whiffs. A window longer than the thing inside it measures the window.
//
// Corrected, in a real online browser: FOUR taps, all four connect, the wolf is down in about
// seventeen seconds -- and the seventeen is the tap cadence, not the game. What follows pins the
// same property deterministically, so nobody has to build a browser probe to ask again.
//
// It asserts that the fight is WINNABLE and ROBUST, not how long it should take. Tuning is Owner and
// Director territory. What this refuses is the case where a change to a combat constant quietly
// makes a small child's first fight unwinnable.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  ATTACK_HALF_ARC_RADIANS,
  ATTACK_REACH,
  HERO_MAX_HP,
  MIN_BODY_SEPARATION,
  SWING_SECONDS,
  WOLF_BITE_COOLDOWN_SECONDS,
  WOLF_MAX_HP,
  WOLF_SPEED,
  canAttack,
  createEncounterState,
  isWithinStrike,
  stepEncounter,
} from '../public/src/combat/encounter.js';
import { WALK_SPEED } from '../public/src/character/speed.js';

/** Where a child can legally be standing when they press: closer is forbidden, further is out of reach. */
const BAND_METERS = ATTACK_REACH - MIN_BODY_SEPARATION;

/**
 * A small child fighting the wolf, driven through the REAL rules.
 *
 * The only things it supplies are the three a child supplies: where they are, which way they are
 * facing, and whether their thumb is down. It never touches the state -- which is frozen anyway, and
 * that is the right shape: a test that could reposition the wolf would be writing the fight it wants
 * to see.
 *
 * @param holdAtMeters  how close they get before they stop walking in.
 * @param aimLagSeconds how stale their facing is. A child does not re-aim every frame.
 * @param pressEvery    seconds between presses. `null` means "whenever the button allows", which is
 *                      the best a player can do; a number models a real thumb.
 * @param aimOffRadians a fixed error in their facing. Lag alone does not exercise the arc at all --
 *                      the wolf walks straight at the hero, so a stale heading is still the right
 *                      one, and a sabotage run narrowing the arc to 15 degrees went unnoticed.
 */
function childFightsTheWolf({
  holdAtMeters = 1.3, aimLagSeconds = 0, pressEvery = null, aimOffRadians = 0,
} = {}) {
  let state = createEncounterState({ wolfSpawn: { x: 0, z: 4 }, heroSpawn: { x: 0, z: 0 } });
  const step = 1 / 60;
  let hero = { x: 0, z: 0 };
  const headings = [];
  const tally = { swings: 0, hits: 0, misses: 0, drops: 0, bites: 0, downs: 0, wolfHeals: 0 };
  // Design ruling 5 restores the wolf to full whenever the party wipes, and a solo hero wipes
  // every time they go down. Counted here because it is the difference between a fight that is
  // slow and one that cannot be finished, and neither `hits` nor `downs` shows it on its own.
  let wolfHpLastFrame = WOLF_MAX_HP;
  let seconds = 0;
  let sinceLastPress = Infinity;

  while (seconds < 120 && state.wolf.hp > 0) {
    const { x: wx, z: wz } = state.wolf;
    const dx = wx - hero.x;
    const dz = wz - hero.z;
    const distance = Math.hypot(dx, dz) || 1e-9;
    // Walk in at the HERO'S OWN SPEED, imported. A first draft moved them at a multiple of
    // WOLF_SPEED, which made every case here invariant to the wolf's speed -- doubling it doubled
    // the child too, and a sabotage run proved the whole file blind to that constant. Deriving one
    // actor's speed from the other's is the same defect as restating a constant, one step removed.
    if (distance > holdAtMeters) {
      hero = { x: hero.x + (dx / distance) * WALK_SPEED * step,
               z: hero.z + (dz / distance) * WALK_SPEED * step };
    }
    // main.js derives heading as atan2(x, z). Stale by `aimLagSeconds` if the caller asked for it.
    headings.push(Math.atan2(dx, dz));
    const lagFrames = Math.round(aimLagSeconds / step);
    const heading = headings[Math.max(0, headings.length - 1 - lagFrames)] + aimOffRadians;

    const thumbDown = pressEvery === null ? true : sinceLastPress >= pressEvery;
    const attack = thumbDown && canAttack(state);
    if (attack) { tally.swings += 1; sinceLastPress = 0; } else { sinceLastPress += step; }

    const result = stepEncounter(state, {
      deltaSeconds: step, heroPosition: hero, heroHeading: heading, attack,
    });
    state = result.state;
    for (const event of result.events) {
      if (event.type === 'wolf-hit' || event.type === 'wolf-defeated') tally.hits += 1;
      if (event.type === 'swing-missed') tally.misses += 1;
      if (event.type === 'swing-dropped') tally.drops += 1;
      if (event.type === 'hero-hurt') tally.bites += 1;
      if (event.type === 'hero-down') tally.downs += 1;
    }
    if (state.wolf.hp > wolfHpLastFrame) tally.wolfHeals += 1;
    wolfHpLastFrame = state.wolf.hp;
    seconds += step;
  }
  return { won: state.wolf.hp <= 0, seconds: +seconds.toFixed(2), heroHp: state.hero.hp, ...tally };
}

test('a child who walks up and presses beats the first wolf, and it is not close', () => {
  const fight = childFightsTheWolf();
  assert.equal(fight.won, true, `left the wolf alive after ${fight.seconds}s: ${JSON.stringify(fight)}`);
  // A ceiling, not a target. The floor is WOLF_MAX_HP swings; anything under twice that plus the walk
  // in is a fight, and anything far above it is the thing four separate probes wrongly reported.
  assert.ok(fight.seconds < SWING_SECONDS * WOLF_MAX_HP * 2 + 10,
    `took ${fight.seconds}s, which is long enough that a small child has gone to find someone`);
  assert.equal(fight.downs, 0, 'the FIRST wolf must not put a child on the floor while they are learning');
});

test('it does not matter how close they stand, anywhere they are allowed to stand', () => {
  // A child has no idea what "reach" is. Every legal distance has to work, or the fight is really a
  // hidden positioning puzzle. The near end is where separateFromWolf holds the bodies apart; the far
  // end is the reach itself.
  for (const holdAtMeters of [MIN_BODY_SEPARATION, MIN_BODY_SEPARATION + BAND_METERS / 2, ATTACK_REACH - 0.01]) {
    const fight = childFightsTheWolf({ holdAtMeters });
    assert.equal(fight.won, true, `standing at ${holdAtMeters.toFixed(2)}m lost: ${JSON.stringify(fight)}`);
    assert.equal(fight.downs, 0, `standing at ${holdAtMeters.toFixed(2)}m got them knocked down`);
  }
});

test('and it does not matter that their aim is a second behind the wolf', () => {
  // The suspect everybody reaches for first, and it is innocent -- because the wolf walks straight
  // at the child, so a stale heading is still very nearly the right one. Kept, but it is the WEAK
  // half of the aim question; the case below is the one that has teeth.
  for (const aimLagSeconds of [0, 0.25, 0.5, 1]) {
    const fight = childFightsTheWolf({ aimLagSeconds });
    assert.equal(fight.won, true, `aim lagging ${aimLagSeconds}s lost: ${JSON.stringify(fight)}`);
  }
});

test('a child facing well off to one side still connects, because the arc is forgiving on purpose', () => {
  // THE CASE THAT ACTUALLY EXERCISES THE ARC. Lag does not, and a sabotage run narrowing the arc from
  // 152 degrees to 29 went completely unnoticed by this file until this test existed -- every other
  // case aims dead-on and would pass with the arc set to a pinhole.
  //
  // AN ABSOLUTE ANGLE, DELIBERATELY NOT A FRACTION OF THE CONSTANT UNDER TEST. The first version used
  // half of ATTACK_HALF_ARC_RADIANS, which is self-defeating: narrow the arc and the probe narrows
  // with it, so the case stays green forever. A sabotage run proved exactly that -- 152 degrees down
  // to 29 and this file did not blink.
  //
  // Importing a constant is right for an EXPECTED value and wrong for the INPUT you are probing its
  // boundary with. The input has to come from the product claim instead, and the claim here is the
  // one written on the constant itself: "wide enough that a young player who is ROUGHLY facing the
  // wolf connects". Forty-five degrees is what roughly means for a four-year-old with a thumb on a
  // stick, and it is a number this file is entitled to hold because it is a statement about children
  // rather than about the rules.
  const ROUGHLY_FACING_RADIANS = Math.PI / 4;
  assert.ok(ATTACK_HALF_ARC_RADIANS >= ROUGHLY_FACING_RADIANS,
    `the arc is +/-${(ATTACK_HALF_ARC_RADIANS * 180 / Math.PI).toFixed(0)} degrees, which is narrower than `
    + 'a small child can reliably aim; they would have to track the animal to hit it');
  for (const sign of [-1, 1]) {
    const aimOffRadians = sign * ROUGHLY_FACING_RADIANS;
    const fight = childFightsTheWolf({ aimOffRadians });
    assert.equal(fight.won, true,
      `facing ${(aimOffRadians * 180 / Math.PI).toFixed(0)} degrees off lost: ${JSON.stringify(fight)}`);
  }
});

test('...and one facing the wrong way misses, so the arc is a real boundary rather than a formality', () => {
  // The other side of it. If swinging with your back to the wolf still connected, the case above
  // would be proving nothing at all.
  const backTurned = childFightsTheWolf({ aimOffRadians: Math.PI });
  assert.equal(backTurned.won, false, 'swinging away from the wolf must visibly miss');
  assert.ok(backTurned.misses > 0, 'and it must be recorded as a miss rather than as nothing');
});

test('a slow thumb is still a winning thumb', () => {
  // The real cadence a browser measured: presses about half a second apart, and every one that the
  // rules accepted connected. A child who presses once a second must still finish.
  for (const pressEvery of [0.3, 0.6, 1]) {
    const fight = childFightsTheWolf({ pressEvery });
    assert.equal(fight.won, true, `pressing every ${pressEvery}s lost: ${JSON.stringify(fight)}`);
    assert.equal(fight.downs, 0, `pressing every ${pressEvery}s got them knocked down`);
  }
});

// THE CADENCE A CHILD MUST KEEP, AND WHAT IS ON THE OTHER SIDE OF IT.
//
// The sweep above stops at one press a second, which is comfortably inside the safe zone and so
// says nothing about where the zone ENDS. It ends abruptly, and the shape of the failure past it is
// the worst one available to a small child.
//
// Measured over this same helper, holding at 1.3m, with a ten-minute budget:
//
//     press every 3.7s  -> WON in 16.7s, 5 swings, 4 hits, 1 knockdown
//     press every 3.8s  -> NEVER won: 135 swings, 134 hits, 67 knockdowns, 67 wolf heals
//
// One tenth of a second apart. Past it the child is not losing slowly, they are landing a hundred
// and thirty-four hits on a three-health wolf and finishing nothing, forever. Standing further out
// (1.65m, the far edge of the band) moves the cliff not at all.
//
// The mechanism is arithmetic rather than mystery. A hero holds HERO_MAX_HP hearts and the wolf
// takes one every WOLF_BITE_COOLDOWN_SECONDS, so a life lasts that product; Design ruling 5 then
// restores the wolf to full on the wipe, so every hit landed before the knockdown is discarded. The
// child must therefore land all WOLF_MAX_HP hits inside ONE life, and the cadence that demands is
// the product divided by the hit count.
//
// WHAT THIS FILE ASSERTS is a REQUIREMENT ABOUT CHILDREN, deliberately not a value derived from the
// combat constants. The first draft of this test set its bar to
// `HERO_MAX_HP * WOLF_BITE_COOLDOWN_SECONDS / WOLF_MAX_HP` -- which reads like rigour and is the
// opposite: a bar computed from the constants under test moves with them, so a sabotage run
// dropping HERO_MAX_HP to 2 broke four other tests in this file and left this one green. That is
// docs/MISTAKES.md's own "a test that derives its probe from the constant under test", made twice
// in one session, the second time by me while writing the entry.
//
// So the number below is a statement about a four-year-old's thumb and nothing else. It is slow
// enough that the child WILL be knocked down once on the way -- which no other test here covers,
// since they all assert `downs === 0` -- and that is exactly the regime Design ruling 5 threatens.
// Moving it is Owner and Director territory; what it refuses is a change to any combat constant
// that quietly puts a slow child on the wrong side of the cliff.
//
// It deliberately does NOT assert the cliff itself. The cliff is the design question, and pinning
// it would make a fix look like a regression.
//
// SABOTAGE, run before this was committed, because a test nobody has seen fail is a test nobody has
// seen work:
//   HERO_MAX_HP 3 -> 2                 caught (this test and four others in this file)
//   WOLF_BITE_COOLDOWN_SECONDS 2.6->1.9  NOT caught -- 27% off the wolf's pace is absorbed
//   WOLF_BITE_COOLDOWN_SECONDS 2.6->1.5  caught
// Recorded rather than tuned away. The slack is real and it is where it should be: a child's first
// fight ought to survive the wolf being somewhat quicker, and this file's job is the cliff edge,
// not the whole gradient.
const SLOW_CHILD_PRESSES_EVERY_SECONDS = 2.5;

test('a child slow enough to be knocked down once still finishes the fight', () => {
  const fight = childFightsTheWolf({ pressEvery: SLOW_CHILD_PRESSES_EVERY_SECONDS });
  assert.equal(fight.won, true,
    `pressing every ${SLOW_CHILD_PRESSES_EVERY_SECONDS}s did not finish: ${JSON.stringify(fight)}`);
  assert.ok(fight.downs > 0,
    'premise: this cadence is meant to be slow enough to be bitten down at least once, and was not');
  // The failure past the cliff is not "slower", it is hits piling up that never add to a kill,
  // because every knockdown hands the wolf its health back. A win may cost one reset; it may not
  // cost an unbounded number of them.
  assert.ok(fight.wolfHeals <= 1,
    `the wolf was healed ${fight.wolfHeals} times, which is the unwinnable shape rather than a slow `
    + `win: ${JSON.stringify(fight)}`);
});

test('guards the guard: one press and then nothing is a loss, and this helper can see it', () => {
  // A file whose losing case never occurs proves nothing by winning. This one depends on no design
  // ruling, so it keeps working whatever is decided about the wolf healing on a wipe.
  //
  // ONE press, not none, and that is the helper being honest rather than a typo. `sinceLastPress`
  // starts at Infinity, which means "ready now", so even an infinite cadence spends its opening
  // press on the first frame and never gets another. That is also a real four-year-old: they try it
  // once, it does not obviously do anything, and they stop.
  const pressedOnce = childFightsTheWolf({ pressEvery: Infinity });
  assert.equal(pressedOnce.swings, 1, 'premise: exactly the one opening press, and no more');
  assert.equal(pressedOnce.won, false, 'a hero who swung once somehow beat a three-health wolf');
  assert.ok(pressedOnce.downs > 0, 'and standing there not swinging really does get them bitten down');
});

test('the wolf being FASTER does not make the first fight harder, and that is not a gap in this file', () => {
  // Recorded because a sabotage sweep doubled WOLF_SPEED and nothing here moved, which looks like a
  // blind spot and is not one. The damage rate is governed by WOLF_BITE_COOLDOWN_SECONDS, and a
  // child who stands and fights is not outrun. Speed decides whether they can DISENGAGE, which is a
  // different question and not this file's.
  const normal = childFightsTheWolf();
  assert.equal(normal.won, true);
  assert.ok(normal.bites <= WOLF_MAX_HP + 1,
    `the wolf landed ${normal.bites} bites; the bite cooldown, not its speed, is what paces this fight`);
});

test('the swing is dropped only by going DOWN, not by every bite', () => {
  // Recorded because I claimed the opposite from a harness diagnostic, and the rules say otherwise:
  // `droppedIt` is `hero.downSeconds >= 0`. A bite that costs a heart does not cancel the swing, so
  // the fight is not the race it looked like.
  const fight = childFightsTheWolf();
  assert.ok(fight.bites > 0, 'premise: the wolf really does bite during this fight');
  assert.equal(fight.drops, 0, 'and none of those bites cancelled a swing');
});

test('the near edge of the band is reachable, so the band is real', () => {
  // Guards the guard. If separateFromWolf ever let the bodies overlap, or the reach shrank below the
  // separation, the sweep above would silently be testing one distance instead of three.
  assert.ok(BAND_METERS > 0,
    `bodies held ${MIN_BODY_SEPARATION}m apart against a ${ATTACK_REACH}m reach leaves nowhere to stand`);
  assert.equal(isWithinStrike({ x: 0, z: 0 }, 0, { x: 0, z: MIN_BODY_SEPARATION }), true);
  assert.equal(isWithinStrike({ x: 0, z: 0 }, 0, { x: 0, z: ATTACK_REACH + 0.01 }), false);
});
