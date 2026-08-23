// The rules of a fight, with no three.js and no DOM in them.
//
// Deliberately pure. main is on protocol v1 and claude/phase-2-tracer has already rewritten the
// wire to v2, so this slice is client-side for now by owner decision of 2026-08-12. When those two
// branches are reconciled the server has to own this state, and a node process must be able to
// import and run it unchanged. Anything that needs a Vector3 or a mesh belongs in wolf.js instead.
//
// Timings are matched to the clips wolf.glb actually ships, measured rather than guessed:
//   bite 1.167s   death 1.750s   hit 0.667s   idle 1.667s   walk 1.708s

// Back to 3, on the owner's call of 2026-08-13, and the round trip is the point rather than an
// embarrassment. It went 3 -> 4 on his playtest note that the wolf died too easily, against a 0.45s
// procedural swing. The swing is now the 1.5s sword_slash clip, so a fight at 4hp would take
// two-thirds longer again -- and he returned it to 3 for exactly that reason. The comment on the old
// value said "re-ask him when the clip lands", which is what happened, so this is the process
// working rather than churn.
export const WOLF_MAX_HP = 3;
export const HERO_MAX_HP = 3;
// THE MOST HEARTS ANY BODY IN THIS GAME CAN HAVE.
//
// HERO_MAX_HP is what a hero STARTS with; this is where the count stops. They were the same number
// until Ranger Wren's charm, and index.html hardcodes one <span class="heart"> per pip because it
// has never had to draw a variable number of them -- so something has to say, in one place, how many
// pips the markup owes. That is a fact about the fight (what a body can be) rather than about the
// charm (what one reward happens to give), which is why it lives here beside HERO_MAX_HP and not
// beside CHARM_BONUS_HEARTS in net/gameServer.mjs.
//
// Four rather than open-ended on purpose. A HUD that grows without bound is a HUD nobody designed,
// and every extra heart is a fight the Warden gets easier at -- its own comment prices it at "three
// mistakes, not one". test/feedback.test.mjs pins the markup to this, and test/game-server.test.mjs
// pins the charm to never exceed it, so the two can never drift apart silently.
export const HERO_MAX_HP_CEILING = 4;
// ── WHAT A SWING IS WORTH, AND WHOSE SWING IT IS ───────────────────────────────────────────────
//
// This was a bare `1`, then a named `1`, and for two chapters the comment under it promised that
// wiring equipment up was somebody else's job. Meanwhile G4 shipped: Rowan keeps the oldest promise
// in the game, an unlock card turns over, the Hero screen prints the Wildwood Blade's "2 DAMAGE"
// straight off progression/items.js -- and the sword swung exactly like the one the child started
// with, because nothing anywhere read that number. The game told a child they were stronger and
// then made them hit the wolf three times again.
//
// So a blow is now worth what the WEAPON IN THE HAND THAT THREW IT is worth. This constant keeps
// its name and its value -- every importer still gets 1 -- but it is now the FLOOR rather than the
// whole rule: what a hero does with nothing better, and what a caller that names no weapon gets.
//
// THE DAMAGE RIDES IN ON THE PER-HERO COMMAND, beside position and heading, as a NUMBER. Not an
// item id, and this file does not import progression/items.js to turn one into the other -- that
// would reach outside combat/, which test/combat-purity.test.mjs forbids in as many words: "route
// the randomness or time through the command/event seam instead of weakening this list". The item
// catalogue is exactly the kind of thing the seam exists to keep out. progression/items.js owns the
// id -> damage question (swingDamageFor there), every caller already knows what is equipped, and
// these rules stay a thing you can reason about with no idea that gear exists.
//
// Carried per tick rather than stored on the hero for the same reason position is: equipment
// changes outside the fight, through a screen this file knows nothing about, and a copy kept here
// would be one more thing that can go stale. What the caller says this tick is the truth this tick.
export const WOLF_DAMAGE_PER_HIT = 1;

// FUTURE, and deliberately not built now -- the owner's direction, 2026-08-13:
//
//   "for future, enemy HP should not be based on how many attacks. Enemy HP and player HP will be
//    based on level (with the latter also boosted by armour), and same with damage."
//
// So these two constants are a placeholder for a stat system, not a design. Today they mean "three
// blows" because there is one enemy, no levels, no damage numbers and one suit of gear; the moment
// any of those exist, HP stops being a hit counter and becomes a derived stat. What that means
// concretely when it is built: a hero's max HP comes from level plus an armour contribution, an
// enemy's from ITS level, and a swing deals damage rather than exactly one point -- at which point
// "how many hits to kill" becomes an OUTPUT of the numbers rather than the input it is here.
//
// Do not grow this into a stat system incrementally. It is a later phase, and the interesting part
// is where the numbers live once the fight is server-owned, not the arithmetic.

export const ATTACK_REACH = 1.7;
// Just under a quarter turn each side. Wide enough that a young player who is roughly facing the
// wolf connects, narrow enough that swinging away from it visibly misses.
export const ATTACK_HALF_ARC_RADIANS = Math.PI * 0.42;
// 1.5, not 0.45, on the owner's call of 2026-08-13: match the animation. sword_slash is authored at 1.5s
// and swingClip.js drives the clip from THIS number, so at 0.45 the clip was compressed to 3.3x
// speed. Equal durations means it plays at exactly the speed it was animated at.
export const SWING_SECONDS = 1.5;
// The blade lands part-way through the swing rather than at its start, so the wolf reacts when the
// sword arrives instead of when the button is pressed.
//
// MEASURED off sword_slash, not scaled from the old pair. A sword strike is the fastest part of the
// motion -- the wind-up is slow, the strike is a whip, the recovery decelerates -- so contact is the
// peak angular speed of RightArm plus RightForeArm. Decoding the clip's own rotation keyframes puts
// that peak at 0.5167s, 34.4% through. The old pair sat at 40%, so the animator and whoever authored
// the procedural arc independently agreed within six points. That agreement is why this number can be
// trusted; it is not a reason it could have been skipped.
export const SWING_CONTACT_SECONDS = 0.5167;
// 0, down from 0.6, and this one was NOT requested -- it is required to keep the fight winnable
// after the swing tripled in length, so it is flagged rather than slipped in.
//
// The cooldown existed because a 0.45s swing was too short to stop a child mashing the button: the
// cooldown was the rate limiter. A 1.5s swing is its own rate limiter -- nothing can start while one
// is running -- so 0.6s on top only added dead time, and it took the hero's attack cycle to 2.10s
// against a wolf that bites every 1.6s. MEASURED, standing and trading with a hero who swings the
// instant the rules allow: the wolf won in 3.8s with 1hp still on it. Two unit tests failed and were
// right to.
//
// Swept the whole range before choosing. The cooldown turns out to be a weak lever -- 0.1 still
// loses, and only 0.05 or less wins -- because the real mechanism is that the wolf's bite lands at
// 0.45s and the hero's at 0.5167s, so the wolf always strikes first and both sides now trade at
// nearly the same rate with the same 3hp.
//
// The other lever, slowing the wolf, was measured too and works (2.29s+ hands the hero a 2hp win),
// but WOLF_BITE_COOLDOWN_SECONDS also controls how long the wolf STAYS in bite mode, and its bite
// clip is 1.167s -- so slowing it there would freeze the wolf in a clamped bite pose for over a
// second. Splitting that constant in two is the right fix if the wolf ever needs retuning; it was
// not worth doing to solve a problem the hero's own cooldown solves cleanly.
//
// THE FIGHT IS NOW FINELY BALANCED, which the owner should know: the hero wins with 2hp of 3 remaining and
// must land every swing to do it. That is inherent while both sides have 3hp and near-identical
// attack rates, and it is the thing the level-and-damage stat system described above is for.
export const ATTACK_COOLDOWN_SECONDS = 0;

export const WOLF_AGGRO_RANGE = 6;
// Distances here are centre-to-centre, and the wolf is 1.46m long once scaled, so half a wolf is
// 0.73m of nose in front of its origin. At the original 1.25 it closed to 1.125m and stood bodily
// inside the hero -- visible in the first playtest capture. 1.6 keeps its nose about a third of a
// metre clear of him, which reads as a lunge. It must stay UNDER the hero's ATTACK_REACH of 1.7, or
// the wolf bites from a range the hero cannot answer.
export const WOLF_BITE_RANGE = 1.6;
export const WOLF_SPEED = 1.15;

// SPLIT IN TWO on 2026-08-13. One constant used to mean both "how long the wolf stays in its bite"
// and "how long before it can bite again", which is fine only while the two happen to want the same
// number. They stopped wanting the same number the moment the hero's swing went from 0.45s to 1.5s:
// the wolf had to become less relentless, and raising the single constant would have held the wolf in
// a clamped bite pose -- its bite clip is 1.167s -- for over a second every time.
//
// How long the wolf is IN the bite: matched to the clip, so the pose ends when the animation does.
export const WOLF_BITE_SECONDS = 1.2;
// How long from starting one bite until it may start the next. 2.6, up from 1.6, chosen to preserve
// the PRESSURE RATIO the fight was balanced at rather than picked by feel. The hero's attack cycle
// was 1.05s against a 1.6s bite -- he could answer roughly two thirds as fast as the wolf attacked.
// His cycle is now 1.50s, so a 1.6s bite would leave him being bitten during almost every swing.
// 1.50/2.6 = 0.58 restores that ratio, slightly in his favour, which is the right side to err on for
// a young player.
//
// The fight is winnable at 1.6 too -- both a stand-and-trade model and a walk-into-range model say
// so. This is about how relentless the wolf FEELS, not about whether the hero can win, and it is the
// number to revisit first if the owner finds the fight too easy or too frantic.
export const WOLF_BITE_COOLDOWN_SECONDS = 2.6;

// How long a newly arrived wolf must wait before its first bite. 0.6s covers the presenter's own
// fade-in (enemies/wolf.js reaches full opacity in about 0.38s) with room to spare, so by the time
// a bite can even start there is a solid wolf on screen to blame it on. Short enough that it is not
// a free hit: the wolf still walks in and closes the distance during it.
export const WOLF_ARRIVAL_GRACE_SECONDS = 0.6;
export const WOLF_BITE_CONTACT_SECONDS = 0.45;

export const STAGGER_SECONDS = 0.667;
export const DEATH_SECONDS = 1.75;
export const RESPAWN_SECONDS = 2;

// the owner's ruling, 2026-08-13: 10 seconds. Phase B5 left the wolf dead for the process's lifetime --
// fine offline, where a refresh reset everything, but the reward loop (mark per kill) needs
// repeatable kills, so a dead wolf coming back is a prerequisite, not a nice-to-have. A SEPARATE
// constant from the hero's RESPAWN_SECONDS above -- the "one constant doing two jobs" trap AGENTS.md
// already names is exactly why this is not just a longer RESPAWN_SECONDS: a hero and a wolf respawn
// on entirely different clocks, and nothing says they should ever move together.
export const WOLF_RESPAWN_SECONDS = 10;

// Nothing stopped a child walking straight through the wolf. The wolf keeps its own distance -- it
// stops approaching at WOLF_BITE_RANGE * 0.9 -- but the hero was never held off, and a young player
// walks INTO a monster within about two seconds of meeting one. Caught in a playtest capture, where
// the pair measured 0.145m apart and the wolf was drawn bodily through the hero's legs. Every unit
// test passed at the time, because none of them looked at where the two bodies actually were.
//
// Half the wolf is 0.73m of nose and the hero is about 0.4m across, so 1.0m is the point where the
// two silhouettes stop overlapping. Comfortably under WOLF_BITE_RANGE, so the wolf can still reach
// the hero to bite -- push it past that and the wolf could never land a bite at all.
export const MIN_BODY_SEPARATION = 1;

/**
 * Where the hero ends up after being stopped from walking into the wolf.
 *
 * Pure, and returns a corrected position rather than mutating one, so the caller decides whether to
 * apply it and a node server can run the same rule. Only the hero is moved: the wolf is already
 * responsible for its own approach distance, and pushing both apart makes them jitter.
 */
export function separateFromWolf(heroPosition, wolf, minimum = MIN_BODY_SEPARATION) {
  if (wolf.mode === 'dead' || wolf.mode === 'dying') return { x: heroPosition.x, z: heroPosition.z };
  const dx = heroPosition.x - wolf.x;
  const dz = heroPosition.z - wolf.z;
  const distance = Math.hypot(dx, dz);
  if (distance >= minimum) return { x: heroPosition.x, z: heroPosition.z };
  // Dead centre. Any direction is as good as any other, and picking one beats returning NaN.
  if (distance === 0) return { x: wolf.x, z: wolf.z + minimum };
  return {
    x: wolf.x + (dx / distance) * minimum,
    z: wolf.z + (dz / distance) * minimum,
  };
}

/** Is the target inside the attacker's reach AND in front of them? */
export function isWithinStrike(from, heading, target, reach = ATTACK_REACH, halfArc = ATTACK_HALF_ARC_RADIANS) {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance > reach) return false;
  if (distance === 0) return true;
  // main.js derives heading as atan2(x, z), so heading 0 faces +Z and forward is (sin, cos).
  const facing = (dx * Math.sin(heading) + dz * Math.cos(heading)) / distance;
  return facing >= Math.cos(halfArc);
}

function stepTowards(mover, target, speed, deltaSeconds) {
  const dx = target.x - mover.x;
  const dz = target.z - mover.z;
  const distance = Math.hypot(dx, dz);
  if (distance === 0) return { x: mover.x, z: mover.z, heading: mover.heading };
  const travel = Math.min(speed * deltaSeconds, distance);
  return {
    x: mover.x + (dx / distance) * travel,
    z: mover.z + (dz / distance) * travel,
    heading: Math.atan2(dx, dz),
  };
}

// ---------------------------------------------------------------------------
// The authority seam
// ---------------------------------------------------------------------------
//
// stepEncounter(state, command) -> { state, events }
//
// A pure function over a frozen state. It is the shape a server can run: hand it the state it last
// published and the next command off the wire, and it hands back the next state plus what the
// clients need to be told. Nothing is hidden in a closure, because a closure cannot cross a socket.
//
// Two fields exist now that nothing needs yet, and they are here now precisely so that adding them
// later is not a protocol change:
//
//   revision      counts COMMANDS APPLIED, not state changes. A rejected command still bumps it --
//                 "I saw your attack and said no" is a fact the client has to be able to converge
//                 on, and a silent no-op would leave it guessing whether the command was lost.
//   lastCommandId makes replay a no-op. A client that retries a command after a dropped ack must
//                 not swing twice. Enforced here rather than promised in a comment, because a field
//                 that is carried but never checked rots into decoration.
//
// The rules themselves are unchanged by the introduction of this seam. That claim is not a matter of
// opinion: createEncounter() below is now a thin adapter over this function, and the encounter test
// suite that exercises it was not edited. If behaviour had shifted, those tests would say so.

function freezeState(state) {
  Object.freeze(state.wolf);
  Object.freeze(state.hero);
  Object.freeze(state.wolfSpawn);
  for (const point of state.wolfSpawns) Object.freeze(point);
  Object.freeze(state.wolfSpawns);
  Object.freeze(state.heroSpawn);
  return Object.freeze(state);
}

/**
 * A fresh encounter, as plain frozen data.
 *
 * Frozen rather than merely by-convention immutable: modules are strict mode, so a step that
 * accidentally writes through to the state it was given throws a TypeError at the moment of the
 * mistake instead of producing a client and a server that quietly disagree. `heroSpawn` is carried
 * because the old signature accepted it; it has never been read, here or before this refactor.
 */
export function createEncounterState({ wolfSpawn = { x: 0, z: -4 }, wolfSpawns, heroSpawn = { x: 0, z: 0 } } = {}) {
  // Same patrol the party engine takes, for the same reason -- offline is the same fight (Design
  // ruling 1), so a child with no server hunts the same three spots.
  const points = (wolfSpawns?.length ? wolfSpawns : [wolfSpawn]).map((point) => ({ x: point.x, z: point.z }));
  return freezeState({
    revision: 0,
    lastCommandId: null,
    wolfSpawn: { x: points[0].x, z: points[0].z },
    wolfSpawns: points,
    wolfSpawnIndex: 0,
    heroSpawn: { x: heroSpawn.x, z: heroSpawn.z },
    wolf: {
      x: points[0].x, z: points[0].z, heading: 0,
      hp: WOLF_MAX_HP, mode: 'idle', modeSeconds: 0,
      // The same arrival grace freshWolf gives -- see its comment. Offline is the same fight.
      biteCooldown: WOLF_ARRIVAL_GRACE_SECONDS,
      biteLanded: false,
    },
    hero: {
      hp: HERO_MAX_HP, maxHp: HERO_MAX_HP, swingSeconds: -1, cooldown: 0,
      swingLanded: false, downSeconds: -1,
    },
  });
}

/** The one condition. Everything that asks "can he swing?" asks through here. */
function heroCanAttack(hero) {
  return hero.downSeconds < 0 && hero.swingSeconds < 0 && hero.cooldown <= 0;
}

/**
 * Whether a swing would be accepted right now.
 *
 * Exists so the button can grey itself out on the same condition the rules enforce. A UI that
 * decides this for itself will eventually disagree with the rules, and the child sees a lit button
 * that does nothing.
 */
export function canAttack(state) {
  return heroCanAttack(state.hero);
}

function isReplayId(commandId, lastCommandId) {
  return commandId !== null && commandId !== undefined && commandId === lastCommandId;
}

// ---------------------------------------------------------------------------
// The party engine
// ---------------------------------------------------------------------------
//
// One wolf, N heroes, keyed by id. This is the only place the fight's rules are written -- the
// solo API below is a thin wrapper that hands this engine a single-hero party and unwraps the
// result, per Design ruling 1, so the purity guard covers both and the two cannot drift apart.
//
// `heroId == null` is how an event says "this didn't happen to anyone in particular" -- the solo
// wrapper strips heroId back out for its callers, but party events keep it because the client has
// to know whose hearts to flash.
//
// Event objects are built as literal object literals at each push site (`{ type: 'swing' }` and
// so on), not through a shared "make me an event of this type" helper -- feedback.test.mjs's
// ENCOUNTER_EVENT_TYPES check reads encounter.js's own SOURCE TEXT with a regex
// (/type:\s*'([\w-]+)'/g) rather than running the code, precisely so a new event type cannot go
// unhandled by feedback.js unnoticed. A helper that took `type` as a variable would still be
// correct at runtime and would still make that control test fail, for a reason with nothing to do
// with the rules -- so withHeroId only ever merges heroId onto an already-literal event.
function withHeroId(event, heroId) {
  return heroId === undefined || heroId === null ? event : { ...event, heroId };
}

function freshHero() {
  return {
    hp: HERO_MAX_HP,
    // A BODY FACT, stored rather than passed per tick -- unlike weaponDamage, which is whatever the
    // caller says this instant. How many hearts you have is part of what you ARE: it decides what a
    // respawn restores and what a heal is allowed to reach, and the rules have to know it about a
    // hero nobody sent a command for this frame. The caller still owns the NUMBER (see the
    // reconciliation in advancePartyFight); this is where the fight remembers it.
    maxHp: HERO_MAX_HP,
    swingSeconds: -1,
    cooldown: 0,
    swingLanded: false,
    downSeconds: -1,
    lastCommandId: null,
  };
}

/**
 * A body gains or loses a heart, because something outside the fight said so.
 *
 * Ranger Wren's charm is the first thing in this game that changes what a hero IS rather than what
 * they are holding, so it needed a rule the fight could not fudge: the caller states a max on the
 * command, and here is the one place that becomes true.
 *
 * GAINING TOPS YOU UP, and that is the whole payoff. A child handed a fourth heart watches a fourth
 * heart fill, in the same second, standing in front of the person who gave it to them. Granting the
 * max without the heart would be a number changing in a place nobody is looking -- exactly the
 * defect docs/MISTAKES.md GQ-013 is about. But NOT while they are down: a hero on the ground does
 * not stand up because their maximum went up, they stand up when RESPAWN_SECONDS says so, and then
 * they get all of it.
 *
 * LOSING CLAMPS, and cannot happen today (nothing revokes a charm). It is two lines and it means a
 * future that takes something away can never leave a hero holding hearts they no longer have.
 */
function reconcileMaxHp(hero, wanted) {
  const maxHp = Number.isFinite(wanted) ? Math.max(1, Math.round(wanted)) : HERO_MAX_HP;
  const had = Number.isFinite(hero.maxHp) ? hero.maxHp : HERO_MAX_HP;
  if (maxHp === had) { hero.maxHp = had; return; }
  hero.maxHp = maxHp;
  if (maxHp > had) {
    if (hero.downSeconds < 0) hero.hp += maxHp - had;
    return;
  }
  hero.hp = Math.min(hero.hp, maxHp);
}

function freshWolf(wolfSpawn) {
  return {
    x: wolfSpawn.x, z: wolfSpawn.z, heading: 0,
    hp: WOLF_MAX_HP, mode: 'idle', modeSeconds: 0,
    // A wolf that has just arrived cannot bite for a moment. Watched in the running game: the frame
    // a wolf respawned it was already in `bite` mode at 8% opacity, so the windup happened while it
    // was invisible and a child was bitten by something that had not finished appearing. Spent
    // through the same biteCooldown clock every other bite is, so the rules gain no new state.
    // It also covers the party-wipe reset, which is the other moment a wolf lands next to somebody
    // who cannot do anything about it -- a hero who has just got back up.
    biteCooldown: WOLF_ARRIVAL_GRACE_SECONDS,
    biteLanded: false,
    targetId: null,
  };
}

function freezePartyState(state) {
  Object.freeze(state.wolf);
  for (const hero of Object.values(state.heroes)) Object.freeze(hero);
  Object.freeze(state.heroes);
  Object.freeze(state.wolfSpawn);
  for (const point of state.wolfSpawns) Object.freeze(point);
  Object.freeze(state.wolfSpawns);
  return Object.freeze(state);
}

// ── where the next wolf comes from ─────────────────────────────────────────────────────────────
//
// A beaten wolf used to come back on the exact spot it died. Three kills is the whole quest, so a
// child spent it standing in one two-metre circle hitting the same animal three times, with a ten
// second wait in the middle of each -- and the Keeper's own line says "the wolves OUT THERE", plural.
//
// The spawn now walks a fixed loop, so the next one is somewhere else and has to be found. A LOOP and
// not a random pick: the fight is server-authoritative and replayed by the client offline, and the
// only way two simulations agree on a random number is if neither of them draws one.
//
// `wolfSpawns` is carried in published state rather than looked up from zone data, because the rules
// layer is deliberately zone-agnostic (see createEncounterState) -- the village hands its own patrol
// in, and a fight created without one keeps exactly the old single-spot behaviour.
function nextSpawn(spawn) {
  if (spawn.points.length <= 1) return spawn.index;
  return (spawn.index + 1) % spawn.points.length;
}

function spawnDraft(state) {
  return {
    current: { x: state.wolfSpawn.x, z: state.wolfSpawn.z },
    index: state.wolfSpawnIndex ?? 0,
    points: state.wolfSpawns ?? [state.wolfSpawn],
  };
}

function publishParty(state, wolf, heroes, spawn = spawnDraft(state)) {
  return freezePartyState({
    revision: state.revision + 1,
    wolfSpawn: { x: spawn.current.x, z: spawn.current.z },
    wolfSpawns: spawn.points.map((point) => ({ x: point.x, z: point.z })),
    wolfSpawnIndex: spawn.index,
    wolf,
    heroes,
  });
}

/**
 * A fresh party encounter, as plain frozen data. See createEncounterState's comment for why
 * frozen: a step that writes through to the state it was given throws instead of desyncing.
 */
export function createPartyEncounterState({ wolfSpawn = { x: 0, z: -4 }, wolfSpawns, heroIds = [] } = {}) {
  const heroes = {};
  for (const heroId of heroIds) heroes[heroId] = freshHero();
  // The patrol defaults to the single spawn, so every existing caller and test gets the behaviour it
  // always had: one spot, forever.
  const points = (wolfSpawns?.length ? wolfSpawns : [wolfSpawn]).map((point) => ({ x: point.x, z: point.z }));
  return freezePartyState({
    revision: 0,
    wolfSpawn: { x: points[0].x, z: points[0].z },
    wolfSpawns: points,
    wolfSpawnIndex: 0,
    wolf: freshWolf(points[0]),
    heroes,
  });
}

/** No-op if the hero is already in the fight, so a duplicate join message cannot reset them. */
export function addHero(state, heroId) {
  if (Object.prototype.hasOwnProperty.call(state.heroes, heroId)) return state;
  const heroes = { ...state.heroes, [heroId]: freshHero() };
  return publishParty(state, { ...state.wolf }, heroes);
}

/**
 * No-op if the hero was never in the fight, for the same reason addHero is. Clears wolf.targetId
 * when it pointed at the hero leaving, so a stale id never gets looked up in stepParty.
 */
export function removeHero(state, heroId) {
  if (!Object.prototype.hasOwnProperty.call(state.heroes, heroId)) return state;
  const heroes = { ...state.heroes };
  delete heroes[heroId];
  const wolf = { ...state.wolf };
  if (wolf.targetId === heroId) wolf.targetId = null;
  return publishParty(state, wolf, heroes);
}

/**
 * Whether heroId's swing would be accepted right now.
 *
 * BINDING: reads ONLY heroes[heroId].{downSeconds, swingSeconds, cooldown} -- the three fields the
 * wire carries -- via heroCanAttack, so a client's decoded encounter block works unchanged as this
 * function's `state` argument.
 */
export function canHeroAttack(state, heroId) {
  const hero = state.heroes[heroId];
  return hero ? heroCanAttack(hero) : false;
}

/**
 * Ask for heroId's swing, without advancing time. See requestAttack's comment for why this is
 * separate from stepParty: the button and the clock are different commands.
 *
 * An unknown heroId (never joined, or already left) is a no-op rather than an error -- the wire is
 * not trusted to have applied `attack` and `leave` in the order they were sent.
 */
export function requestPartyAttack(state, heroId, commandId = null) {
  const existing = state.heroes[heroId];
  if (!existing) return { state, events: [], accepted: false };
  if (isReplayId(commandId, existing.lastCommandId)) return { state, events: [], accepted: false };

  const hero = { ...existing, lastCommandId: commandId ?? null };
  const events = [];
  let accepted = false;
  if (heroCanAttack(hero)) {
    hero.swingSeconds = 0;
    hero.swingLanded = false;
    events.push(withHeroId({ type: 'swing' }, heroId));
    accepted = true;
  }

  const heroes = { ...state.heroes, [heroId]: hero };
  return { state: publishParty(state, { ...state.wolf }, heroes), events, accepted };
}

/**
 * Advance the fight by one tick.
 *
 * `command` is { deltaSeconds, heroes: { [id]: { position, heading } } }. Unlike the solo seam,
 * there is no commandId and no embedded attack -- a tick is the server's own clock, applied once
 * per server frame, never retried, so there is nothing here that needs replay protection. Attacks
 * are their own command (requestPartyAttack) for exactly the reason requestAttack's comment gives.
 */
export function stepParty(state, command = {}) {
  const { deltaSeconds = 0, heroes: commandHeroes = {} } = command;

  const heroIds = Object.keys(state.heroes);
  const heroes = {};
  for (const heroId of heroIds) heroes[heroId] = { ...state.heroes[heroId] };
  const wolf = { ...state.wolf };
  const events = [];
  // A mutable draft of "where the wolf comes from", for the same reason `wolf` above is one: a
  // respawn can move it, and the move has to reach published state.
  const spawn = spawnDraft(state);

  advancePartyFight(wolf, heroes, heroIds, commandHeroes, events, deltaSeconds, spawn, state.heroes);

  return { state: publishParty(state, wolf, heroes, spawn), events };
}

/**
 * The rules, on mutable drafts, generalised from advanceFight's original single-hero body to N
 * heroes keyed by id. Every transition is still time-driven so the visual layer can simply read
 * `wolf.mode`; nothing here knows a clip exists.
 */
// ── beating a wolf gives a heart back ──────────────────────────────────────────────────────────
//
// Added after the first real child playtest (child playtest). the child playtesters
// "died a few times" and called the wolves "a little strong". The fight itself was not the problem
// -- they beat every wolf -- but until this existed the ONLY route back to three hearts was dying,
// and the quest is three kills, so a child who won the first fight on one heart started the second
// on one heart. That is a difficulty curve nobody designed; it is just the absence of recovery.
//
// Chosen over passive out-of-combat regeneration on two grounds:
//   - Legibility. "I killed it and a heart came back" is cause and effect a young player reads the
//     first time it happens. A timer that refills hearts for standing still is a rule that has to be
//     taught, and would also have needed a new per-hero field on the wire (see protocol.js's
//     decodeHeroes, which lists exactly four) for a value no client renders.
//   - It rewards winning rather than waiting, so no individual fight is made any easier. Every
//     constant the fight is balanced on is untouched: same wolf HP, same bite, same reach, same
//     cadence. What changes is only what a child carries INTO the next fight.
//
// Everyone standing is healed, not just whoever landed the blow, and not only those in range. That
// is the co-op half: your brother's kill helps you even if you were across the map, which is the
// cheapest possible way to make being on the same team pay. A hero who is DOWN is skipped -- he is
// about to stand up on full hearts anyway (see RESPAWN_SECONDS above), so healing him would be
// banking a heart he never earned, and it would raise a hero-healed event for a child staring at a
// death banner.
function healTheStanding(heroes, heroIds, events) {
  for (const heroId of heroIds) {
    const hero = heroes[heroId];
    if (hero.downSeconds >= 0) continue;
    // Each hero's OWN ceiling: a brother carrying Wren's charm has four, and a kill must not stop
    // healing him at three just because his younger brother's body ends there.
    if (hero.hp >= (hero.maxHp ?? HERO_MAX_HP)) continue;
    hero.hp += 1;
    // A literal, like every other event in this file -- feedback.test.mjs reads this source with a
    // regex rather than running it, so a computed `type` would break the guard. See withHeroId.
    events.push(withHeroId({ type: 'hero-healed', remaining: hero.hp }, heroId));
  }
}

function advancePartyFight(wolf, heroes, heroIds, commandHeroes, events, deltaSeconds, spawn, heroesAtStepStart) {
  /** @param moveOn true when a wolf was BEATEN, so the next one prowls the next spot on the patrol.
   *                False when the party simply wiped: that is a reset, not a victory, and moving the
   *                wolf would reward being knocked down with a shorter walk next time. */
  function resetWolf({ moveOn = false } = {}) {
    if (moveOn) {
      spawn.index = nextSpawn(spawn);
      spawn.current = { x: spawn.points[spawn.index].x, z: spawn.points[spawn.index].z };
    }
    Object.assign(wolf, freshWolf(spawn.current));
  }

  // Pass 1: each hero's own clock -- cooldown, down/respawn, swing -- independently of the others
  // and of the wolf's own state machine below. This is line-for-line advanceFight's original body,
  // just addressed through heroes[id] instead of a single `hero`, and the per-hero events now carry
  // heroId (withHeroId omits it when heroId is undefined, which is how the solo wrapper gets the
  // old heroId-less shape back out).
  const respawnedIds = [];
  for (const heroId of heroIds) {
    const hero = heroes[heroId];
    const cmd = commandHeroes[heroId];
    const position = cmd?.position ?? { x: 0, z: 0 };
    const heading = cmd?.heading ?? 0;

    // Before anything else this tick: how many hearts is this body supposed to have. See
    // reconcileMaxHp -- a heart gained is felt on the frame it is given, not on the next respawn.
    reconcileMaxHp(hero, cmd?.maxHp);

    hero.cooldown = Math.max(0, hero.cooldown - deltaSeconds);

    if (hero.downSeconds >= 0) {
      hero.downSeconds += deltaSeconds;
      if (hero.downSeconds >= RESPAWN_SECONDS) {
        hero.downSeconds = -1;
        hero.hp = hero.maxHp;
        events.push(withHeroId({ type: 'hero-respawned' }, heroId));
        respawnedIds.push(heroId);
      }
    }

    // The swing runs to completion once started, and lands exactly once. See advanceFight's
    // original comment (still true, per hero) on why a hero going down mid-swing has to drop it.
    if (hero.swingSeconds >= 0) {
      hero.swingSeconds += deltaSeconds;
      const droppedIt = hero.downSeconds >= 0;
      if (droppedIt) {
        hero.swingSeconds = -1;
        hero.swingLanded = false;
        hero.cooldown = ATTACK_COOLDOWN_SECONDS;
        events.push(withHeroId({ type: 'swing-dropped' }, heroId));
      }
      const contactReached = !droppedIt && hero.swingSeconds >= SWING_CONTACT_SECONDS;
      if (contactReached && !hero.swingLanded) {
        hero.swingLanded = true;
        const alive = wolf.mode !== 'dead' && wolf.mode !== 'dying';
        if (alive && isWithinStrike(position, heading, wolf)) {
          // Read at CONTACT rather than at the start of the swing. Nobody will ever equip mid-swing,
          // but "a blow is worth what the hand holds when it lands" is the version of this rule that
          // needs no further explaining, and it is one line either way.
          const damage = Number.isFinite(cmd?.weaponDamage) ? cmd.weaponDamage : WOLF_DAMAGE_PER_HIT;
          wolf.hp -= damage;
          wolf.modeSeconds = 0;
          if (wolf.hp <= 0) {
            wolf.mode = 'dying';
            events.push(withHeroId({ type: 'wolf-defeated' }, heroId));
            healTheStanding(heroes, heroIds, events);
          } else {
            wolf.mode = 'hit';
            events.push(withHeroId({ type: 'wolf-hit', remaining: wolf.hp, damage }, heroId));
          }
        } else {
          events.push(withHeroId({ type: 'swing-missed' }, heroId));
        }
      }
      if (hero.swingSeconds >= SWING_SECONDS) {
        hero.swingSeconds = -1;
        hero.cooldown = ATTACK_COOLDOWN_SECONDS;
      }
    }
  }

  // Pass 2: wipe-and-reset (Design ruling 5), resolved after every hero's own clock has run so it
  // reads a stable picture rather than one that depends on iteration order. "Currently alive" means
  // "alive at the start of THIS step" -- heroesAtStepStart is the frozen state this call was handed,
  // untouched by pass 1 -- so two heroes crossing RESPAWN_SECONDS in the same tick agree on whether
  // the other was alive, whichever of them is processed first. With one hero (the solo wrapper's
  // case) there is never an "other", so this always resets -- exactly today's solo behaviour.
  for (const heroId of respawnedIds) {
    const otherAlive = heroIds.some(
      (otherId) => otherId !== heroId && heroesAtStepStart[otherId].downSeconds < 0,
    );
    if (!otherAlive) resetWolf();
  }

  wolf.modeSeconds += deltaSeconds;
  wolf.biteCooldown = Math.max(0, wolf.biteCooldown - deltaSeconds);

  if (wolf.mode === 'dying') {
    // modeSeconds resets on entry to 'dead', the same convention every other mode transition in this
    // function already follows (hit -> idle, bite -> idle) -- so the respawn clock below measures
    // time spent dead, not time since the death animation started.
    if (wolf.modeSeconds >= DEATH_SECONDS) { wolf.mode = 'dead'; wolf.modeSeconds = 0; }
    return;
  }
  if (wolf.mode === 'dead') {
    if (wolf.modeSeconds >= WOLF_RESPAWN_SECONDS) {
      resetWolf({ moveOn: true });
      // Party path: nobody in particular caused this, the same reasoning bite-missed already uses
      // for an event that isn't anyone's -- so no heroId, and withHeroId is not involved. The solo
      // wrapper's stripHeroId is a no-op on an event that never had one, per its own comment.
      events.push({ type: 'wolf-respawned' });
    }
    return;
  }

  if (wolf.mode === 'hit') {
    if (wolf.modeSeconds >= STAGGER_SECONDS) { wolf.mode = 'idle'; wolf.modeSeconds = 0; }
    return;
  }

  if (wolf.mode === 'bite') {
    const contact = wolf.modeSeconds >= WOLF_BITE_CONTACT_SECONDS;
    if (contact && !wolf.biteLanded) {
      wolf.biteLanded = true;
      // The target was chosen at bite start (Design ruling 4) and is read fresh here, at contact
      // time, from wherever this tick's command says they are -- not from a position captured back
      // when the bite began. A hero who left mid-bite (removeHero clears targetId) or who is no
      // longer standing (downed by something else in the meantime) makes the bite miss cleanly.
      const targetId = wolf.targetId;
      const target = targetId == null ? null : heroes[targetId];
      const targetPosition = targetId == null ? null : (commandHeroes[targetId]?.position ?? { x: 0, z: 0 });
      // Re-checked at CONTACT and not only at bite start, for the same reason downSeconds is: the
      // target is read fresh here, so a hero who has stepped out of the wolf's reach -- or who the
      // caller has stopped offering as a target -- between windup and contact does not take a blow
      // decided a third of a second ago.
      const stillTargetable = targetId == null || commandHeroes[targetId]?.targetable !== false;
      if (target && target.downSeconds < 0 && stillTargetable
        && isWithinStrike(wolf, wolf.heading, targetPosition, WOLF_BITE_RANGE)) {
        target.hp -= 1;
        events.push(withHeroId({ type: 'hero-hurt', remaining: Math.max(0, target.hp) }, targetId));
        if (target.hp <= 0) {
          target.downSeconds = 0;
          events.push(withHeroId({ type: 'hero-down' }, targetId));
        }
      } else {
        // Nobody was hit, so there is no heroId to hang this on -- binding, per the interface list.
        events.push({ type: 'bite-missed' });
      }
    }
    // Leaves the bite when the BITE ends, not when the cooldown does -- see advanceFight's original
    // comment; unchanged by the generalisation.
    if (wolf.modeSeconds >= WOLF_BITE_SECONDS) { wolf.mode = 'idle'; wolf.modeSeconds = 0; }
    return;
  }

  // idle or walking: find the nearest hero who is not down (Design ruling 4), then close the
  // distance or bite. A hero position missing from this tick's command defaults the same way the
  // solo seam always has -- {x:0, z:0}, heading 0.
  let nearestId = null;
  let nearestDx = 0;
  let nearestDz = 0;
  let nearestDistance = Infinity;
  for (const heroId of heroIds) {
    if (heroes[heroId].downSeconds >= 0) continue;
    // NOT A TARGET THIS TICK, because the caller said so. One generic boolean, defaulting to
    // targetable when absent, so every caller written before this existed keeps the fight it had.
    // The rules layer deliberately does not know WHY -- the reason lives with whoever owns the
    // world (see world/rangerSpeech.js's rangerSanctuaryHolds, and combat-purity.test.mjs).
    if (commandHeroes[heroId]?.targetable === false) continue;
    const position = commandHeroes[heroId]?.position ?? { x: 0, z: 0 };
    const dx = position.x - wolf.x;
    const dz = position.z - wolf.z;
    const distance = Math.hypot(dx, dz);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestId = heroId;
      nearestDx = dx;
      nearestDz = dz;
    }
  }

  // No living hero at all (everyone down, or nobody in the party) -- nothing to chase or bite.
  if (nearestId === null) { wolf.mode = 'idle'; return; }

  if (nearestDistance <= WOLF_BITE_RANGE && wolf.biteCooldown === 0) {
    wolf.mode = 'bite';
    wolf.modeSeconds = 0;
    wolf.biteLanded = false;
    wolf.biteCooldown = WOLF_BITE_COOLDOWN_SECONDS;
    wolf.heading = Math.atan2(nearestDx, nearestDz);
    wolf.targetId = nearestId;
    return;
  }

  if (nearestDistance <= WOLF_AGGRO_RANGE && nearestDistance > WOLF_BITE_RANGE * 0.9) {
    const moved = stepTowards(wolf, commandHeroes[nearestId]?.position ?? { x: 0, z: 0 }, WOLF_SPEED, deltaSeconds);
    wolf.x = moved.x;
    wolf.z = moved.z;
    wolf.heading = moved.heading;
    wolf.mode = 'walk';
    return;
  }

  wolf.mode = 'idle';
}

// ---------------------------------------------------------------------------
// The solo API, as a wrapper over the party engine
// ---------------------------------------------------------------------------
//
// Design ruling 1: published state and event shapes stay byte-identical to what this file
// produced before the party engine existed -- top-level lastCommandId, a `hero` object without
// lastCommandId, a `wolf` object without targetId, events without heroId. That is enforced here by
// construction: wolfFromParty/heroFromParty list exactly the old fields rather than passing the
// party engine's objects through, and stripHeroId removes the one key party events add.
//
// The solo hero always has this id inside the party engine; it never escapes to a caller.
const SOLO_HERO_ID = 'hero';

// A scratch party shape built fresh from the solo state on every call. It is never frozen and
// never returned to a caller -- the party engine only reads it -- and it does not need to persist
// hero.lastCommandId between calls: replay is guarded independently below using the solo state's
// own top-level lastCommandId (as it always was). wolf.targetId DOES need reconstructing, though,
// and not as a blanket null: a bite spans several ticks and only picks its target on the tick it
// STARTS (Design ruling 4), so a tick that lands mid-bite must recover 'who this bite is against'
// from the one bit of information the solo shape kept -- wolf.mode already being 'bite' -- or
// contact resolves against a null target and every bite misses. With exactly one hero there is
// never any ambiguity in that recovery.
function toPartyState(state) {
  return {
    revision: 0,
    wolfSpawn: state.wolfSpawn,
    // Carried through, or the patrol resets to spot one on every single tick and the wolf never
    // moves on -- the solo state is rebuilt from scratch each call, so anything the party engine
    // advances has to make the round trip.
    wolfSpawns: state.wolfSpawns,
    wolfSpawnIndex: state.wolfSpawnIndex,
    wolf: { ...state.wolf, targetId: state.wolf.mode === 'bite' ? SOLO_HERO_ID : null },
    heroes: { [SOLO_HERO_ID]: { ...state.hero, lastCommandId: null } },
  };
}

function wolfFromParty(wolf) {
  return {
    x: wolf.x, z: wolf.z, heading: wolf.heading, hp: wolf.hp,
    mode: wolf.mode, modeSeconds: wolf.modeSeconds,
    biteCooldown: wolf.biteCooldown, biteLanded: wolf.biteLanded,
  };
}

function heroFromParty(hero) {
  return {
    hp: hero.hp, swingSeconds: hero.swingSeconds, cooldown: hero.cooldown,
    swingLanded: hero.swingLanded, downSeconds: hero.downSeconds,
  };
}

function stripHeroId(event) {
  if (!('heroId' in event)) return event;
  const { heroId, ...rest } = event;
  return rest;
}

/** `from` is whichever state carries the authoritative patrol position now: the party engine's
 *  result when a step may have advanced it, and the solo state itself when nothing could have. */
function publish(state, commandId, wolf, hero, from = state) {
  // The `?? [wolfSpawn]` is the same fallback spawnDraft uses, and it is load-bearing: main.js hands
  // the offline rules a hand-built mirror of the server's block when a connection drops mid-fight
  // (test/offline-handover.test.mjs), and that mirror is not a state this module made.
  const points = from.wolfSpawns ?? [from.wolfSpawn];
  return freezeState({
    revision: state.revision + 1,
    lastCommandId: commandId ?? null,
    wolfSpawn: { x: from.wolfSpawn.x, z: from.wolfSpawn.z },
    wolfSpawns: points.map((point) => ({ x: point.x, z: point.z })),
    wolfSpawnIndex: from.wolfSpawnIndex ?? 0,
    heroSpawn: { x: state.heroSpawn.x, z: state.heroSpawn.z },
    wolf,
    hero,
  });
}

/**
 * Ask for a swing, without advancing time.
 *
 * Separate from stepEncounter because pressing the button and the clock ticking are genuinely two
 * different commands -- the button is a player intent that arrives whenever the player likes, the
 * tick is the server's own clock. Folding the request into a zero-delta step would run the whole
 * time-advance for a command that contains no time.
 */
export function requestAttack(state, commandId = null) {
  if (isReplayId(commandId, state.lastCommandId)) return { state, events: [], accepted: false };
  const result = requestPartyAttack(toPartyState(state), SOLO_HERO_ID, null);
  const wolf = wolfFromParty(result.state.wolf);
  const hero = heroFromParty(result.state.heroes[SOLO_HERO_ID]);
  return { state: publish(state, commandId, wolf, hero), events: result.events.map(stripHeroId), accepted: result.accepted };
}

/**
 * Advance the fight by one command.
 *
 * `command` is { commandId, deltaSeconds, heroPosition, heroHeading, attack }. The attack is applied
 * before time advances, which is the order main.js has always used -- press, then tick -- and the
 * order that makes a swing land on the frame it was asked for rather than the one after. Composed
 * here from the party engine's two calls (request, then step) rather than from one combined
 * function, because that request-then-step order is exactly what produces the same result: the
 * request only ever starts a swing, and does nothing that time-advance also does.
 */
export function stepEncounter(state, command = {}) {
  const {
    commandId = null,
    deltaSeconds = 0,
    heroPosition = { x: 0, z: 0 },
    heroHeading = 0,
    // The solo wrapper carries what a blow is worth the same way it carries position and heading:
    // as one more thing the caller knows and the rules do not. Omitted falls to
    // WOLF_DAMAGE_PER_HIT, so every caller written before equipment existed keeps the fight it has
    // always had.
    heroWeaponDamage = null,
    // One more thing the caller knows and the rules do not, carried exactly as position and weapon
    // damage are. Defaults to targetable so every existing caller fights unchanged.
    heroTargetable = true,
    attack = false,
  } = command;

  if (isReplayId(commandId, state.lastCommandId)) return { state, events: [] };

  let partyState = toPartyState(state);
  const events = [];

  if (attack) {
    const attacked = requestPartyAttack(partyState, SOLO_HERO_ID, null);
    partyState = attacked.state;
    events.push(...attacked.events.map(stripHeroId));
  }

  const stepped = stepParty(partyState, {
    deltaSeconds,
    heroes: {
      [SOLO_HERO_ID]: {
        position: heroPosition,
        heading: heroHeading,
        weaponDamage: heroWeaponDamage,
        targetable: heroTargetable !== false,
      },
    },
  });
  events.push(...stepped.events.map(stripHeroId));

  const wolf = wolfFromParty(stepped.state.wolf);
  const hero = heroFromParty(stepped.state.heroes[SOLO_HERO_ID]);

  return { state: publish(state, commandId, wolf, hero, stepped.state), events };
}

/**
 * The old stateful surface, now an adapter over the seam above.
 *
 * Kept deliberately. The whole encounter suite drives this object and was NOT edited during the
 * refactor, so it is the control that says the rules did not move. New callers -- and the server --
 * should use createEncounterState + stepEncounter directly and read published state; this exists so
 * that migration can happen one caller at a time instead of in one unverifiable jump.
 *
 * `wolf` and `hero` are getters, not fields. Every step publishes fresh frozen objects, so a field
 * captured once would go stale after the first command. Nothing in the repo aliased them into a
 * local -- checked before this was written -- which is the only reason getters are sufficient.
 */
export function createEncounter(options = {}) {
  let state = createEncounterState(options);
  const pending = [];
  let nextCommandId = 1;

  return {
    get wolf() { return state.wolf; },
    get hero() { return state.hero; },
    /** The published state, for callers that have moved onto the seam. */
    get state() { return state; },

    canAttack() {
      return canAttack(state);
    },

    requestAttack() {
      const result = requestAttack(state, nextCommandId++);
      state = result.state;
      pending.push(...result.events);
      return result.accepted;
    },

    /** Drain the events raised since the last call, so the caller can react once to each. */
    drainEvents() {
      return pending.splice(0, pending.length);
    },

    update(deltaSeconds, heroPosition, heroHeading) {
      const result = stepEncounter(state, {
        commandId: nextCommandId++,
        deltaSeconds,
        heroPosition,
        heroHeading,
      });
      state = result.state;
      pending.push(...result.events);
    },
  };
}
