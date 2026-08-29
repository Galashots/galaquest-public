// public/src/world/beaconSiege.js
//
// THE OLD BEACON SIEGE, as pure rules: three stone seals, the corrupted Warden that wakes when the
// last one bursts, and the fire that finally lights when it falls. Break the seals, beat the thing
// that held them, and the Beacon burns -- the whole arc of the chapter in one engine.
//
// PURE, in exactly the sense combat/encounter.js is pure: no three.js, no DOM, no Math.random, no
// wall clock. This engine is written to run on the server as the shared authoritative fight AND on
// the client as the offline fallback, so a node process must be able to import it unchanged and two
// simulations fed the same commands must agree byte for byte. Anything that needs a mesh belongs in
// the presenter; anything that wants a die roll is forbidden outright -- every choice the Warden
// makes below is a counter, not a draw, because the only way two simulations agree on a random
// number is if neither of them draws one (the same reasoning encounter.js's spawn patrol gives).
//
// The seams deliberately mirror combat/encounter.js's party engine -- createSiegeState /
// addSiegeHero / requestSiegeAttack / stepSiege over frozen plain data, replay guarded per hero by
// commandId -- because the integrator already knows how to wire that shape: main.js drives it the
// way it drives stepParty, and net/gameServer.mjs re-hosts it the same way. Where a number already
// has an owner over there (the hero's swing, reach, body, respawn clock) it is IMPORTED rather
// than restated: GQ-007, one number, one owner. A hero fights the same way everywhere; only the
// enemy is new.
//
// Event objects are literal object literals at each push site, the same convention encounter.js
// keeps for feedback.test.mjs's source-reading guard. That guard does not scan this file today, but
// the convention is kept anyway so the SAME kind of guard can be pointed here the day the siege's
// events get a feedback map -- and so a grep for `type: 'seal-burst'` finds the one place it is born.

import {
  ATTACK_COOLDOWN_SECONDS,
  ATTACK_REACH,
  HERO_MAX_HP,
  RESPAWN_SECONDS,
  STAGGER_SECONDS,
  SWING_CONTACT_SECONDS,
  SWING_SECONDS,
  BASE_HERO_DAMAGE,
  isWithinStrike,
  separateFromEnemies,
} from '../combat/encounter.js';
import { resolveIncomingDamage } from '../combat/damage.js';

// ---------------------------------------------------------------------------
// The seals
// ---------------------------------------------------------------------------

// Two blows, not the brambles' three (world/trail.js, BRAMBLE_BLOWS_TO_CUT). The first blow cracks
// the seal and the second bursts it, so every seal is escalation rather than repetition -- a child
// sees the thing answer the first hit and finish on the second. Three seals at two blows is six
// swings for the whole puzzle, which is a prelude to a boss, not a chore in front of one; at three
// blows each it would be nine swings of the same arm before the fight even starts.
export const SEAL_BLOWS_TO_BREAK = 2;

// How much further than a wolf the sword reaches into a seal, in metres, added to encounter.js's
// ATTACK_REACH the same way main.js adds trail.js's BRAMBLE_EXTRA_REACH_METERS -- and for the same
// underlying reason: a seal is a fixed carved stone, not a dodging animal, so the fight's tight
// body-to-body reach is the wrong yardstick for it. Smaller than the bramble's 1.2 because that
// number was measured against a five-metre tangle nothing stopped a child short of; a seal is a
// single stone a child walks right up to, and 0.9 is enough that stopping a stride short of it
// still connects rather than teaching "walk INTO the rock first".
export const SEAL_EXTRA_REACH_METERS = 0.9;

// ---------------------------------------------------------------------------
// The Warden
// ---------------------------------------------------------------------------
//
// A corrupted guardian: bigger, slower, deliberate, heavy, readable, fair. Everything below is
// tuned to that sentence -- its menace is inevitability, not speed, and every attack telegraphs
// long enough for a child to learn the answer.

// TWELVE STARTER BLOWS SOLO -- a real boss next to a wolf that takes three. With dodging and the
// Warden's own attacks in the way that is around forty seconds of fighting alone, and roughly half
// that with a sibling swinging too, which is the co-op payoff without making the solo fight
// unwinnable.
//
// It was 12 against a 1-damage sword. P2 rescaled the whole fight by ten (see encounter.js's
// combat-scale header) so that a Hero level can be worth +5 max HP and +2 damage without a wolf
// having three hit points; this moved with it, and the twelve-blow promise is preserved exactly
// rather than re-derived. It is no longer standing in for a future stat system -- the Hero half of
// that system is progression/heroStats.js and it is live -- but the WARDEN's own numbers are still
// authored rather than derived from an enemy level, because enemy levels are E1's package and
// explicitly outside P2. test/level-one-preservation.test.mjs pins the blow counts.
export const WARDEN_MAX_HP = 120;

// A third of a fresh hero's body per landed attack. A Level-1 hero has HERO_MAX_HP, so the Warden is
// THREE MISTAKES, not one -- a boss that two-shots a young player teaches fear of trying, and one
// that one-shots teaches quitting. Written as its own number rather than as HERO_MAX_HP / 3 because
// what the Warden hits for is the Warden's to state: the day a hero at Level 10 walks in, this must
// stay the blow it always was and simply take a smaller share of a bigger body, which is the whole
// point of a fixed-world progression (docs/product/PROGRESSION_CONTRACT_V0.md section 8).
export const WARDEN_DAMAGE_PER_HIT = 10;

// Slower than the wolf's 1.15 (encounter.js WOLF_SPEED), on purpose: a child can always walk away
// from the Warden. Its pressure comes from being unavoidable in the arena over time, not from
// running anyone down -- heavy footfalls closing at a walk read as dread, the same thing at a
// sprint reads as panic.
export const WARDEN_SPEED = 0.75;

// Longer arms than a wolf's lunge (WOLF_BITE_RANGE 1.6): the Warden is a big body swinging a long
// reach, and 2.2 keeps its silhouette clear of the hero while its blows still connect. Still bigger
// than the hero's ATTACK_REACH of 1.7 -- the opposite of the wolf's constraint -- because dodging
// OUT of its range and stepping back IN is this fight's whole rhythm, and that only exists if its
// reach exceeds yours.
export const WARDEN_MELEE_RANGE = 2.2;

// Wider than the wolf's 6: the Warden owns the Beacon's whole forecourt. A child who has woken it
// cannot stand ten metres off and heal up in its sight -- but can still leave, because 9 is finite
// and the Warden walks home (WARDEN_SPEED above) rather than pursuing forever.
export const WARDEN_AGGRO_RANGE = 9;

// The rise from kneeling. Two full seconds of invulnerable-but-visible getting-up, so the third
// seal's burst, the wake, and the first attack are three separate beats a child can watch happen
// instead of one frame of ambush. Invulnerable because free hits into an animation-locked boss
// teach "mash during cutscenes", which is the worst lesson in games.
export const WARDEN_WAKE_SECONDS = 2.0;

// ── the three attacks ───────────────────────────────────────────────────────────────────────────
//
// Each attack lives inside ONE mode, timed by modeSeconds, with contact partway through -- the
// exact shape the wolf's bite uses (WOLF_BITE_CONTACT_SECONDS inside WOLF_BITE_SECONDS), so the
// presenter drives a clip from the mode and the duration and nothing else.

// The default melee: a two-handed blow onto its chosen target. Contact at 1.1 of 1.9 is a long,
// readable windup -- more than double the wolf's 0.45 -- because this is the attack a child sees
// most and the one they must learn to step out of. Step out of the front arc or out of range
// before 1.1s and it misses; that lesson is the fight.
export const WARDEN_OVERHEAD_SECONDS = 1.9;
export const WARDEN_OVERHEAD_CONTACT_SECONDS = 1.1;

// The answer to ganging up: a horizontal sweep that hits EVERY standing hero in its front arc.
// Slightly slower than the overhead with a slightly later contact, because it punishes more people
// and therefore owes them more warning.
export const WARDEN_SWEEP_SECONDS = 2.2;
export const WARDEN_SWEEP_CONTACT_SECONDS = 1.3;
// Wider than the hero's own PI * 0.42 half-arc (encounter.js ATTACK_HALF_ARC_RADIANS): a sweep is
// a body-turning cut, so standing BESIDE the Warden is not safe -- only behind it is. PI * 0.62 is
// just past a quarter turn each side, which leaves a genuine back arc to escape into rather than a
// sliver.
export const WARDEN_SWEEP_HALF_ARC_RADIANS = Math.PI * 0.62;
// Every third melee attack is a sweep even against one hero, on a counter rather than a die
// (determinism, see the header). Three, so a solo child meets the move and learns it exists, but
// most attacks stay the dodgeable overhead.
export const WARDEN_SWEEP_EVERY_MELEE_ATTACKS = 3;

// The radial cold ring, phase 2 onward: hits every standing hero within range REGARDLESS of
// facing, so "get behind it" -- the answer to both melees -- stops being the whole fight. Contact
// at 1.6 of 2.4 is the longest telegraph in the game, deliberately: it is the scariest move, so it
// must be the most escapable. The answer is distance, and 1.6 seconds at hero walking speed is
// comfortably enough to leave the ring.
export const WARDEN_PULSE_SECONDS = 2.4;
export const WARDEN_PULSE_CONTACT_SECONDS = 1.6;
// Bigger than melee reach, smaller than half the arena: standing in the Warden's face is inside
// it, kiting at mid-range is inside it, the arena's edge is out of it.
export const WARDEN_PULSE_RANGE = 3.4;
// At most every fourth attack overall (again a counter, not a roll). Each of phases 2 and 3 also
// OPENS with one pulse -- queued on the phase transition, outside this cadence -- so the phase
// change is announced by its signature move rather than by a health bar.
export const WARDEN_PULSE_EVERY_ATTACKS = 4;

// Rest between attacks, applied when an attack ENDS -- not at its start, the way the wolf spends
// biteCooldown, because every Warden attack is longer than this gap and a start-spent cooldown
// would have elapsed mid-swing and chained attacks back to back. 1.4 in phase 1; from phase 2 on
// the cadence rises slightly to 1.1. That -- not a speed spike, not more damage -- is the whole
// late-fight escalation on the clock side; the pulse and the presentation do the drama.
export const WARDEN_ATTACK_COOLDOWN_SECONDS = 1.4;
export const WARDEN_ATTACK_COOLDOWN_PHASE2_SECONDS = 1.1;

// The Warden flinches on every THIRD landed blow, not every blow and not never. A boss that
// staggers on every hit can be stun-locked by two children into never attacking at all; one that
// never flinches feels like hitting a wall, and "my hits do nothing" is the moment a child puts
// the controller down. Every third blow is a visible reward on a rhythm a pair can feel, without
// ever letting them own its clock. The stagger itself reuses the wolf's STAGGER_SECONDS -- one
// flinch length everywhere until a Warden-specific hit clip exists to measure against, at which
// point split the constant (the WOLF_BITE_COOLDOWN_SECONDS split is the precedent).
export const WARDEN_STAGGER_EVERY_BLOWS = 3;

// A boss death is a beat, not a disappearance: longer than the wolf's 1.75 DEATH_SECONDS because
// this fall ends the chapter and the Beacon lights over it. After 'dying' comes 'dead', and the
// Warden NEVER respawns -- there is no warden equivalent of WOLF_RESPAWN_SECONDS, because a beaten
// boss coming back would un-tell the story.
export const WARDEN_DEATH_SECONDS = 2.6;

// ── phases ──────────────────────────────────────────────────────────────────────────────────────
//
// A presentation-driving field computed from hp, nothing more: phase 1 above 60%, phase 2 at and
// below it, phase 3 at and below 25%. The RULES change only in two places (the pulse unlocks, the
// attack cooldown shortens); everything else phase does is the presenter's -- glow, cracks, sound.
// No unfair speed spike in phase 3, deliberately.
export const WARDEN_PHASE2_FRACTION = 0.6;
export const WARDEN_PHASE3_FRACTION = 0.25;

/** The phase the Warden is in at this hp. Inclusive at the boundaries: AT 60% is already phase 2,
 *  AT 25% already phase 3 -- crossing the line is the event, standing on it is not a fourth state. */
export function wardenPhaseFor(hp) {
  if (hp <= WARDEN_MAX_HP * WARDEN_PHASE3_FRACTION) return 3;
  if (hp <= WARDEN_MAX_HP * WARDEN_PHASE2_FRACTION) return 2;
  return 1;
}

// ── the body, as a thing you cannot walk through ────────────────────────────────────────────────
//
// Children walked straight THROUGH the Warden in a real playtest (#79), and the cause was not a
// wrong number -- it was that no separation rule was ever applied to this fight at all.
// combat/encounter.js already owns the law (separateFromEnemies) and net/gameServerCore.mjs already
// runs it every tick against the ordinary enemy collection; the Warden simply is not in that
// collection, because it belongs to a different engine. So the law is IMPORTED and pointed at the
// Warden rather than reimplemented here: one rule for "you cannot stand inside a monster", two
// callers (GQ-011 -- two simulations of the same thing are not one thing).
//
// Centre-to-centre, the same convention MIN_BODY_SEPARATION uses for the wolf's 1. The Warden is a
// far bigger body -- its measured footprint is a little over a metre across once scaled to
// WARDEN_HEIGHT_METERS -- so 1.6 keeps a child clear of the legs and cloak without planting an
// invisible wall out at the antler span, which is nearly twice as wide as anything a child can
// actually collide with.
//
// IT MUST STAY UNDER WARDEN_MELEE_RANGE, and that is the constraint worth stating out loud rather
// than leaving for someone to rediscover: separation pushes the hero OUT, melee range decides what
// the Warden can reach. Set them equal and the boss is held permanently just past its own reach and
// can never land a blow again. test/warden.test.mjs pins the inequality.
export const WARDEN_BODY_SEPARATION_METERS = 1.6;

/**
 * Push a hero's feet out of the Warden's body.
 *
 * Pure and deterministic like every other rule in this file, so the server's authority and the
 * client's own prediction run the identical function and cannot disagree about where a child ends up.
 *
 * A DEAD Warden does not block: the body sinks into the ground and is gone, and leaving a collider
 * standing on the arena floor after the fight would fence children out of the place they just won.
 * Everything else blocks, including the dormant kneel -- a huge iron shape crouched over the seals is
 * exactly the thing #79 says a child must not be able to stroll through.
 */
export function separateFromWarden(heroPosition, warden) {
  const position = { x: heroPosition.x, z: heroPosition.z };
  if (!warden || warden.mode === 'dead') return position;
  return separateFromEnemies(position, [warden], WARDEN_BODY_SEPARATION_METERS);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function freshSiegeHero() {
  // The same five clocks the wolf engine's freshHero carries plus the same per-hero replay guard --
  // a hero is a hero, whichever fight he is standing in.
  return {
    hp: HERO_MAX_HP,
    // ...plus the ceiling, for the same reason encounter.js's own freshHero carries one: how big a
    // body is is part of what it IS, and this fight has to know it about a hero nobody sent a
    // command for this frame. Wren's charm moves it, and since P2 so does every Hero level
    // (progression/heroStats.js's resolvedMaxHp) -- which is why it stays a caller-stated number.
    maxHp: HERO_MAX_HP,
    swingSeconds: -1,
    cooldown: 0,
    swingLanded: false,
    downSeconds: -1,
    lastCommandId: null,
  };
}

/** The siege's copy of encounter.js's reconcileMaxHp -- see that function for the whole argument.
 *  Duplicated rather than imported because it writes a DRAFT of this file's own hero shape, and the
 *  two engines deliberately keep their own hero bookkeeping (GQ-011); the RULE, not the code, is the
 *  thing that has to match, and test/beacon-siege.test.mjs pins it on both sides. */
function reconcileSiegeMaxHp(hero, wanted) {
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

function freshWarden(wardenAt) {
  return {
    x: wardenAt[0], z: wardenAt[1], heading: 0,
    hp: WARDEN_MAX_HP, mode: 'dormant', modeSeconds: 0, phase: 1, targetId: null,
    // Attack bookkeeping. attackCount / meleeCount are the deterministic cadence counters the
    // sweep and pulse choose by; pulseQueued is the phase-entry pulse waiting to happen;
    // blowsTaken feeds the every-third-blow stagger. All carried in published state because a pure
    // step has nowhere else to keep them -- a closure cannot cross a socket (encounter.js's words).
    attackCooldown: 0, attackLanded: false,
    attackCount: 0, meleeCount: 0, pulseQueued: false, blowsTaken: 0,
  };
}

function freezeSiegeState(state) {
  Object.freeze(state.arena.at);
  Object.freeze(state.arena);
  for (const at of state.sealsAt) Object.freeze(at);
  Object.freeze(state.sealsAt);
  Object.freeze(state.wardenAt);
  for (const seal of state.seals) Object.freeze(seal);
  Object.freeze(state.seals);
  Object.freeze(state.warden);
  for (const hero of Object.values(state.heroes)) Object.freeze(hero);
  Object.freeze(state.heroes);
  return Object.freeze(state);
}

/**
 * A fresh siege, as plain frozen data. Frozen for encounter.js's reason, verbatim: modules are
 * strict mode, so a step that accidentally writes through to the state it was given throws at the
 * moment of the mistake instead of producing a client and a server that quietly disagree.
 *
 * `arena` is carried and published but not consulted by the rules: the presenter draws the ring
 * and the zone owns where heroes can walk, while the Warden is leashed by WARDEN_AGGRO_RANGE and
 * its own home. Carried anyway so client and server agree on the one description of the place.
 */
export function createSiegeState({
  arena = { at: [0, 0], radiusMeters: 12 },
  // Placeholder triangle; the zone hands the real positions in, exactly as it hands trail.js its
  // lights. The rules are deliberately zone-agnostic (encounter.js's createEncounterState note).
  sealsAt = [[-3, -2], [3, -2], [0, 3.5]],
  wardenAt = [0, 0],
  heroIds = [],
} = {}) {
  const heroes = {};
  for (const heroId of heroIds) heroes[heroId] = freshSiegeHero();
  return freezeSiegeState({
    revision: 0,
    arena: { at: [arena.at[0], arena.at[1]], radiusMeters: arena.radiusMeters },
    sealsAt: sealsAt.map(([x, z]) => [x, z]),
    wardenAt: [wardenAt[0], wardenAt[1]],
    seals: sealsAt.map(() => ({ blows: 0, burst: false })),
    warden: freshWarden(wardenAt),
    heroes,
    beaconLit: false,
  });
}

/**
 * The siege as it stands in a world where the Beacon is ALREADY BURNING.
 *
 * Exists for exactly one caller: net/gameServer.mjs's boot, which reads the durable `beacon-lit`
 * world fact (net/rewardStore.mjs) before the simulation exists and has to hand the rules a state
 * that agrees with the sky. Without it a server restart puts the fire out, which is precisely the
 * "reload should not pretend the player never won" failure the whole payoff is built against.
 *
 * EVERY SEAL BURST AND THE WARDEN DEAD, not merely `beaconLit: true`, and that is the honest
 * reading rather than a convenience: a world in which the Beacon burns is a world in which both of
 * those already happened. The alternative -- a lit Beacon guarded by a Warden still kneeling at its
 * foot -- would offer a second child a boss fight whose outcome is already painted on the sky, and
 * would let the same Beacon be lit twice.
 *
 * Heroes are carried through untouched: who is connected has nothing to do with what the world
 * remembers.
 */
export function restoreLitSiege(state) {
  return freezeSiegeState({
    revision: state.revision + 1,
    arena: state.arena,
    sealsAt: state.sealsAt,
    wardenAt: state.wardenAt,
    seals: state.seals.map(() => ({ blows: SEAL_BLOWS_TO_BREAK, burst: true })),
    warden: {
      ...freshWarden(state.wardenAt),
      hp: 0,
      mode: 'dead',
      // Past every clip this mode could still be playing, so a client that connects to a restored
      // world draws a Warden that is simply gone rather than one caught mid-collapse.
      modeSeconds: WARDEN_DEATH_SECONDS,
      phase: 3,
    },
    heroes: Object.fromEntries(
      Object.entries(state.heroes).map(([heroId, hero]) => [heroId, { ...hero }]),
    ),
    beaconLit: true,
  });
}

/** Mutable copies of everything a step may change. arena / sealsAt / wardenAt never change after
 *  creation, so their frozen objects are reused by reference rather than re-copied every tick. */
function draftOf(state) {
  const heroIds = Object.keys(state.heroes);
  const heroes = {};
  for (const heroId of heroIds) heroes[heroId] = { ...state.heroes[heroId] };
  return {
    seals: state.seals.map((seal) => ({ ...seal })),
    sealsAt: state.sealsAt,
    warden: { ...state.warden },
    heroes,
    heroIds,
    home: state.wardenAt,
    beaconLit: state.beaconLit,
  };
}

function publishSiege(state, draft) {
  return freezeSiegeState({
    // Counts commands applied, like the party engine's: a rejected command still bumps it, because
    // "I saw it and said no" is a fact a client must be able to converge on.
    revision: state.revision + 1,
    arena: state.arena,
    sealsAt: state.sealsAt,
    wardenAt: state.wardenAt,
    seals: draft.seals,
    warden: draft.warden,
    heroes: draft.heroes,
    beaconLit: draft.beaconLit,
  });
}

// ---------------------------------------------------------------------------
// The party seam
// ---------------------------------------------------------------------------

/** The one condition, character for character encounter.js's heroCanAttack -- reads only the three
 *  fields the wire carries, so a decoded block works unchanged as this function's argument. */
function heroCanSwing(hero) {
  return hero.downSeconds < 0 && hero.swingSeconds < 0 && hero.cooldown <= 0;
}

/** No-op if the hero is already in the siege, so a duplicate join message cannot reset them. */
export function addSiegeHero(state, heroId) {
  if (Object.prototype.hasOwnProperty.call(state.heroes, heroId)) return state;
  const draft = draftOf(state);
  draft.heroes[heroId] = freshSiegeHero();
  return publishSiege(state, draft);
}

/**
 * Carry a hero's BODY into this fight from the one they just left.
 *
 * ── why this exists ─────────────────────────────────────────────────────────────────────────────
 *
 * A child has one body. Two engines each keeping their own `hp`/`downSeconds`/`cooldown` for the
 * same hero is fine only while nobody crosses between them -- and the moment somebody does, merely
 * CHOOSING which copy to publish is not continuity, it is a coin flip with a stale side. Take wolf
 * damage, walk to the Beacon, and the Warden's untouched copy publishes a full body; walk back and
 * the wolf's copy resurrects the old state. Down and cooldown jump the same way.
 *
 * So the arena boundary is an explicit HANDOFF, and this is the receiving half: the persistent parts
 * of the body (health, being down, the attack cooldown) move across intact.
 *
 * THE SWING IS DELIBERATELY NOT CARRIED. A swing belongs to the fight it was thrown in -- it was
 * aimed at something in that engine and its contact frame would resolve against a different world
 * here -- so it is cancelled at the boundary rather than teleported. Cancelled silently: the arm has
 * already moved on the child's screen, and `swing-dropped` means "you were knocked out of it", which
 * is not what happened.
 *
 * @param body `{ hp, downSeconds, cooldown }` read out of the engine the hero is leaving.
 */
export function transferSiegeHeroBody(state, heroId, body) {
  if (!Object.prototype.hasOwnProperty.call(state.heroes, heroId)) return state;
  const draft = draftOf(state);
  const hero = draft.heroes[heroId];
  if (Number.isFinite(body?.hp)) hero.hp = body.hp;
  if (Number.isFinite(body?.downSeconds)) hero.downSeconds = body.downSeconds;
  if (Number.isFinite(body?.cooldown)) hero.cooldown = body.cooldown;
  hero.swingSeconds = -1;
  hero.swingLanded = false;
  return publishSiege(state, draft);
}

/** The persistent half of a hero's body, for handing to the other engine. See
 *  transferSiegeHeroBody for why these three fields and not the swing. */
export function siegeHeroBody(state, heroId) {
  const hero = state.heroes[heroId];
  return hero ? { hp: hero.hp, downSeconds: hero.downSeconds, cooldown: hero.cooldown } : null;
}

/** No-op if the hero was never here, for the same reason addSiegeHero is. Clears the Warden's
 *  targetId when it pointed at the hero leaving, so a stale id never gets looked up in stepSiege. */
export function removeSiegeHero(state, heroId) {
  if (!Object.prototype.hasOwnProperty.call(state.heroes, heroId)) return state;
  const draft = draftOf(state);
  delete draft.heroes[heroId];
  draft.heroIds = draft.heroIds.filter((id) => id !== heroId);
  if (draft.warden.targetId === heroId) draft.warden.targetId = null;
  return publishSiege(state, draft);
}

/** Whether heroId's swing would be accepted right now -- exists so the button can grey itself out
 *  on the same condition the rules enforce (canAttack's reasoning in encounter.js). */
export function canSiegeHeroAttack(state, heroId) {
  const hero = state.heroes[heroId];
  return hero ? heroCanSwing(hero) : false;
}

/**
 * Ask for heroId's swing, without advancing time. The button and the clock are different commands
 * (requestAttack's reasoning in encounter.js); replay of the same commandId is a no-op enforced
 * per hero, and an unknown heroId is a no-op rather than an error because the wire is not trusted
 * to have applied `attack` and `leave` in the order they were sent.
 */
export function requestSiegeAttack(state, heroId, commandId = null) {
  const existing = state.heroes[heroId];
  if (!existing) return { state, events: [], accepted: false };
  if (commandId !== null && commandId !== undefined && commandId === existing.lastCommandId) {
    return { state, events: [], accepted: false };
  }

  const draft = draftOf(state);
  const hero = draft.heroes[heroId];
  hero.lastCommandId = commandId ?? null;
  const events = [];
  let accepted = false;
  if (heroCanSwing(hero)) {
    hero.swingSeconds = 0;
    hero.swingLanded = false;
    events.push({ type: 'siege-swing', heroId });
    accepted = true;
  }
  return { state: publishSiege(state, draft), events, accepted };
}

/**
 * Advance the siege by one tick.
 *
 * `command` is { deltaSeconds, heroes: { [id]: { position, heading } } } -- the exact shape
 * stepParty takes, and like it there is no commandId: a tick is the server's own clock, applied
 * once, never retried, so nothing here needs replay protection.
 */
export function stepSiege(state, command = {}) {
  const { deltaSeconds = 0, heroes: commandHeroes = {} } = command;
  const draft = draftOf(state);
  const events = [];
  advanceSiege(draft, commandHeroes, events, deltaSeconds);
  return { state: publishSiege(state, draft), events };
}

// ---------------------------------------------------------------------------
// The rules, on mutable drafts
// ---------------------------------------------------------------------------

function advanceSiege(draft, commandHeroes, events, deltaSeconds) {
  const { warden, heroes, heroIds } = draft;

  // Pass 1: each hero's own clocks -- cooldown, down/respawn, swing -- line for line the wolf
  // engine's pass 1 (encounter.js advancePartyFight), because a hero fights the same way
  // everywhere. Only what the landed swing RESOLVES AGAINST is new, in resolveSiegeSwing.
  for (const heroId of heroIds) {
    const hero = heroes[heroId];
    const cmd = commandHeroes[heroId];
    const position = cmd?.position ?? { x: 0, z: 0 };
    const heading = cmd?.heading ?? 0;

    reconcileSiegeMaxHp(hero, cmd?.maxHp);

    hero.cooldown = Math.max(0, hero.cooldown - deltaSeconds);

    if (hero.downSeconds >= 0) {
      hero.downSeconds += deltaSeconds;
      if (hero.downSeconds >= RESPAWN_SECONDS) {
        hero.downSeconds = -1;
        hero.hp = hero.maxHp;
        events.push({ type: 'hero-respawned', heroId });
      }
    }

    if (hero.swingSeconds >= 0) {
      hero.swingSeconds += deltaSeconds;
      const droppedIt = hero.downSeconds >= 0;
      if (droppedIt) {
        hero.swingSeconds = -1;
        hero.swingLanded = false;
        hero.cooldown = ATTACK_COOLDOWN_SECONDS;
        events.push({ type: 'siege-swing-dropped', heroId });
      }
      const contactReached = !droppedIt && hero.swingSeconds >= SWING_CONTACT_SECONDS;
      if (contactReached && !hero.swingLanded) {
        hero.swingLanded = true;
        resolveSiegeSwing(draft, position, heading, heroId, events, cmd?.heroDamage);
      }
      if (hero.swingSeconds >= SWING_SECONDS) {
        hero.swingSeconds = -1;
        hero.cooldown = ATTACK_COOLDOWN_SECONDS;
      }
    }
  }

  // Pass 2: the Warden's own state machine.
  advanceWarden(draft, commandHeroes, events, deltaSeconds);

  // Pass 3: the wipe. If the LAST standing hero went down this very tick, the fight restarts --
  // but never the puzzle: the Warden refills and returns home, the seals stay broken. Keyed on a
  // hero-down event raised THIS step so it fires exactly once per wipe rather than every tick the
  // party spends on the ground, and gated on the Warden actually being in the fight -- a party
  // that somehow all falls over in front of a dormant statue has not wiped to anything.
  if (events.some((event) => event.type === 'hero-down')) {
    const noneStanding = heroIds.length > 0
      && heroIds.every((heroId) => heroes[heroId].downSeconds >= 0);
    if (noneStanding && wardenFightable(warden)) resetWardenAfterWipe(warden, events);
  }
}

/** The modes in which the Warden is a thing that can be fought -- and struck. Dormant and waking
 *  are before the fight, dying and dead are after it; only the middle is fair game either way. */
function wardenFightable(warden) {
  return warden.mode !== 'dormant' && warden.mode !== 'waking'
    && warden.mode !== 'dying' && warden.mode !== 'dead';
}

// ── what one swing hits ─────────────────────────────────────────────────────────────────────────
//
// ONE SWING RESOLVES AGAINST AT MOST ONE THING, the same ruling strikeBrambles wrote down: a blow
// that damages two things at once reads as a bug, not a bonus, and no swing in this game is worth
// double. The one thing is the NEAREST in-reach target among the unburst seals and the fightable
// Warden. While the Warden is dormant it is not a candidate at all -- it is not yet a thing that
// can be fought -- so swings beside it pass to seals or miss; same while it wakes (invulnerable by
// design, see WARDEN_WAKE_SECONDS) and once it is dying or dead.
//
// `damage` is what the swinging hero is worth -- their weapon plus what their LEVEL adds to the arm
// (progression/heroStats.js's resolvedHeroDamage, resolved by the caller before it ever gets here,
// exactly as the wolf engine's own heroDamage command field is). Note
// that it reaches the WARDEN and not the seals: a seal is not a health bar, it is two blows and
// then it bursts, and a sharper sword does not make a stone crack in one. That asymmetry is
// deliberate -- it keeps the arc's opening beat the same for every child regardless of what they
// walked in carrying, and it means the Blade's reward is felt where a fight is, not where a lock is.
function resolveSiegeSwing(draft, position, heading, heroId, events, damage) {
  const { seals, sealsAt, warden } = draft;

  let bestKind = null;
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < seals.length; i += 1) {
    if (seals[i].burst) continue;
    const target = { x: sealsAt[i][0], z: sealsAt[i][1] };
    if (!isWithinStrike(position, heading, target, ATTACK_REACH + SEAL_EXTRA_REACH_METERS)) continue;
    const distance = Math.hypot(target.x - position.x, target.z - position.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestKind = 'seal';
      bestIndex = i;
    }
  }
  // The Warden is struck at the fight's own ATTACK_REACH, no extra: it is a body you close on,
  // like the wolf, not a fixture you chop at.
  if (wardenFightable(warden) && isWithinStrike(position, heading, warden)) {
    const distance = Math.hypot(warden.x - position.x, warden.z - position.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestKind = 'warden';
    }
  }

  if (bestKind === 'seal') {
    strikeSeal(draft, bestIndex, heroId, events);
    return;
  }
  if (bestKind === 'warden') {
    strikeWarden(draft, heroId, events, damage);
    return;
  }
  // Named distinctly from encounter.js's swing-missed so a listener wired to both fights can never
  // confuse whose whiff it is being told about.
  events.push({ type: 'siege-swing-missed', heroId });
}

function strikeSeal(draft, index, heroId, events) {
  const seal = draft.seals[index];
  seal.blows += 1;
  if (seal.blows < SEAL_BLOWS_TO_BREAK) {
    events.push({ type: 'seal-cracked', index, heroId });
    return;
  }
  seal.burst = true;
  const remaining = draft.seals.filter((one) => !one.burst).length;
  events.push({ type: 'seal-burst', index, remaining, heroId });
  if (remaining === 0) {
    // The third burst is the wake -- one beat, on the same tick, so the presenter can stage the
    // burst and the rise as cause and effect. No heroId on warden-woke: all three seals woke it,
    // not whoever happened to land the last blow.
    draft.warden.mode = 'waking';
    draft.warden.modeSeconds = 0;
    events.push({ type: 'warden-woke' });
  }
}

function strikeWarden(draft, heroId, events, damage) {
  const { warden, heroes, heroIds } = draft;
  // WHAT THE HERO IS ACTUALLY CARRYING, passed down from the swing that threw it. This used to be a
  // flat one point, which was honest while nothing in the game could hit harder and became a lie the
  // day the Wildwood Blade shipped. BASE_HERO_DAMAGE survives as the floor for a caller
  // that named no weapon -- see encounter.js's swingDamageFor for why a swing never resolves to
  // nothing just because equipment went unmentioned.
  warden.hp -= Number.isFinite(damage) ? damage : BASE_HERO_DAMAGE;
  warden.blowsTaken += 1;

  if (warden.hp <= 0) {
    warden.mode = 'dying';
    warden.modeSeconds = 0;
    // Whoever landed the last blow gets the defeat event -- the same attribution wolf-defeated
    // carries -- and the Beacon lights ON THE SAME STEP: beaconLit latches true here and is never
    // set false again anywhere in this file, which is what makes it a latch.
    events.push({ type: 'warden-defeated', heroId });
    draft.beaconLit = true;
    events.push({ type: 'beacon-ignited' });
    // MIRRORED from encounter.js's healTheStanding rather than imported -- it is not exported, and
    // the generosity is deliberately bigger here: everyone standing goes to FULL, not by one
    // VICTORY_HEAL_HP, because a boss falls once per save and the moment after it is for cheering,
    // not for limping to the next fight on whatever health you happened to have left. Same skip for
    // the downed, same reason: they stand up whole anyway (RESPAWN_SECONDS), and a heal event under
    // a death banner is noise.
    for (const otherId of heroIds) {
      const other = heroes[otherId];
      if (other.downSeconds >= 0) continue;
      // Each hero's OWN ceiling -- a brother carrying Wren's charm, or simply a level ahead, is
      // restored to HIS body, not to whatever the shortest one in the party happens to hold.
      const ceiling = other.maxHp ?? HERO_MAX_HP;
      if (other.hp >= ceiling) continue;
      other.hp = ceiling;
      events.push({ type: 'hero-healed', remaining: other.hp, heroId: otherId });
    }
    return;
  }

  events.push({ type: 'warden-hit', remaining: warden.hp, heroId });
  const phase = wardenPhaseFor(warden.hp);
  if (phase !== warden.phase) {
    warden.phase = phase;
    // Each new phase opens with the pulse -- queued here, spent by the next attack the Warden
    // starts. Outside the every-fourth cadence on purpose: the announcement is the point.
    warden.pulseQueued = true;
    events.push({ type: 'warden-phase', phase });
  }
  // Every third blow flinches it; the other two are events without a stagger (see
  // WARDEN_STAGGER_EVERY_BLOWS). A stagger mid-attack cancels the attack outright -- that IS the
  // reward -- and deliberately does not charge the attack cooldown: the stagger already cost the
  // Warden its swing, and stacking a rest on top would hand two heroes its clock after all.
  if (warden.blowsTaken % WARDEN_STAGGER_EVERY_BLOWS === 0) {
    warden.mode = 'hit';
    warden.modeSeconds = 0;
  }
}

// ── the Warden's own clock ──────────────────────────────────────────────────────────────────────

function hurtHero(hero, heroId, events, damageReductionPercent) {
  hero.hp -= resolveIncomingDamage(WARDEN_DAMAGE_PER_HIT, damageReductionPercent);
  // warden-hurt-hero, as distinct from warden-hit: the names are one letter of carelessness away
  // from each other in a lesser scheme, so both say who did what to whom in full. Here heroId is
  // the hero who WAS struck; on warden-hit it is the hero who struck.
  events.push({ type: 'warden-hurt-hero', remaining: Math.max(0, hero.hp), heroId });
  if (hero.hp <= 0) {
    hero.downSeconds = 0;
    // The wolf engine's own event, semantics unchanged -- one 'hero-down' everywhere.
    events.push({ type: 'hero-down', heroId });
  }
}

function endAttack(warden) {
  warden.mode = 'idle';
  warden.modeSeconds = 0;
  warden.attackCooldown = warden.phase >= 2
    ? WARDEN_ATTACK_COOLDOWN_PHASE2_SECONDS
    : WARDEN_ATTACK_COOLDOWN_SECONDS;
}

/** Local twin of encounter.js's stepTowards, which is not exported; same maths, same heading
 *  convention (atan2(dx, dz) -- heading 0 faces +Z). */
function moveTowards(mover, target, speed, deltaSeconds) {
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

/** Nobody worth fighting: walk back to the Beacon's foot and stand. This one behaviour covers both
 *  the leash (a child who leaves aggro range watches it turn back, which reads as territory) and
 *  the wipe ("walks back to wardenAt" happens by itself, because a wiped party has nobody standing). */
function walkHome(warden, home, deltaSeconds) {
  const target = { x: home[0], z: home[1] };
  if (Math.hypot(target.x - warden.x, target.z - warden.z) <= 0.05) {
    warden.mode = 'idle';
    return;
  }
  const moved = moveTowards(warden, target, WARDEN_SPEED, deltaSeconds);
  warden.x = moved.x;
  warden.z = moved.z;
  warden.heading = moved.heading;
  warden.mode = 'walk';
}

function startAttack(draft, commandHeroes, nearestId, dx, dz) {
  const { warden, heroes, heroIds } = draft;
  warden.attackCount += 1;
  warden.modeSeconds = 0;
  warden.attackLanded = false;
  warden.targetId = nearestId;

  // The pulse first: phase-gated, then either the queued phase-entry pulse or the every-fourth
  // cadence (attackCount is 1-indexed by the increment above, so attacks 4, 8, 12... pulse).
  const pulseDue = warden.phase >= 2
    && (warden.pulseQueued || warden.attackCount % WARDEN_PULSE_EVERY_ATTACKS === 0);
  if (pulseDue) {
    warden.pulseQueued = false;
    warden.mode = 'pulse';
    // heading untouched: a ring has no facing, and snapping to the target would telegraph a
    // direction the attack does not have.
    return;
  }

  warden.meleeCount += 1;
  warden.heading = Math.atan2(dx, dz);
  let standingInMelee = 0;
  for (const heroId of heroIds) {
    if (heroes[heroId].downSeconds >= 0) continue;
    const position = commandHeroes[heroId]?.position ?? { x: 0, z: 0 };
    if (Math.hypot(position.x - warden.x, position.z - warden.z) <= WARDEN_MELEE_RANGE) {
      standingInMelee += 1;
    }
  }
  // Two or more in its face is ALWAYS a sweep -- ganging up point-blank must never be strictly
  // better than taking turns -- and even a lone hero meets one every third melee attack.
  warden.mode = (standingInMelee >= 2
    || warden.meleeCount % WARDEN_SWEEP_EVERY_MELEE_ATTACKS === 0) ? 'sweep' : 'overhead';
}

function resetWardenAfterWipe(warden, events) {
  // ── THE WARDEN KEEPS ITS WOUNDS ────────────────────────────────────────────────────────────────
  //
  // This restored `hp` to WARDEN_MAX_HP and `phase` to 1 until it was actually played, and the
  // measurement is why it does not any more. Simulated solo against a hero who never retreats: 33
  // deaths, 33 full heals, and the Warden never once fell below half -- an unwinnable treadmill. A
  // 12 HP boss takes about eighteen seconds of unbroken contact to fell, and a child who goes down
  // ONCE in that window used to lose every blow they had landed.
  //
  // That is exactly the difficulty curve nobody designed that combat/encounter.js's own
  // heal-on-victory comment describes finding in the wolf fight, one stage further on. The rule now
  // is the forgiving one, and it is also the more legible one: I HURT IT AND IT STAYS HURT. The cost
  // of going down is the respawn and the walk back, which is a real cost a child can feel without it
  // erasing what they did.
  //
  // What DOES reset is the Warden's own composure: its attack cadence, its counters, its target and
  // its queued pulse, so it resumes its post cleanly rather than continuing a swing at somebody who
  // is no longer standing. Its position is left alone -- with nobody standing, walkHome walks it
  // back to wardenAt over the party's down time, which reads as the guardian resuming its post
  // rather than teleporting to it. Mode is 'idle', never 'dormant': a wipe restarts the fight, not
  // the puzzle, and the seals are not touched here at all, which is what keeps them broken.
  //
  // `phase` is deliberately left where the damage puts it too -- it is DERIVED from hp everywhere
  // else (wardenPhaseFor), and a boss at a quarter health pretending to be in phase 1 would be the
  // one number on screen disagreeing with the boss bar right next to it.
  warden.mode = 'idle';
  warden.modeSeconds = 0;
  warden.targetId = null;
  warden.attackLanded = false;
  warden.attackCooldown = WARDEN_ATTACK_COOLDOWN_SECONDS;
  warden.attackCount = 0;
  warden.meleeCount = 0;
  warden.pulseQueued = false;
  warden.blowsTaken = 0;
  events.push({ type: 'siege-reset' });
}

function advanceWarden(draft, commandHeroes, events, deltaSeconds) {
  const { warden, heroes, heroIds, home } = draft;

  // Kneeling before the seals break: no clock, no movement, no target. Not even modeSeconds runs,
  // so a siege left alone for an hour publishes the same warden every tick.
  if (warden.mode === 'dormant') return;

  warden.modeSeconds += deltaSeconds;
  warden.attackCooldown = Math.max(0, warden.attackCooldown - deltaSeconds);

  if (warden.mode === 'waking') {
    if (warden.modeSeconds >= WARDEN_WAKE_SECONDS) {
      warden.mode = 'idle';
      warden.modeSeconds = 0;
    }
    return;
  }

  if (warden.mode === 'dying') {
    // modeSeconds resets on entry to 'dead' -- the same convention every mode transition in the
    // wolf engine follows -- though nothing reads the dead clock: the Warden never respawns.
    if (warden.modeSeconds >= WARDEN_DEATH_SECONDS) {
      warden.mode = 'dead';
      warden.modeSeconds = 0;
    }
    return;
  }
  if (warden.mode === 'dead') return;

  if (warden.mode === 'hit') {
    if (warden.modeSeconds >= STAGGER_SECONDS) {
      warden.mode = 'idle';
      warden.modeSeconds = 0;
    }
    return;
  }

  if (warden.mode === 'overhead') {
    if (!warden.attackLanded && warden.modeSeconds >= WARDEN_OVERHEAD_CONTACT_SECONDS) {
      warden.attackLanded = true;
      // The target was chosen at attack start and is read FRESH here, at contact time, from
      // wherever this tick's command says they are (the wolf's bite rule, verbatim): a hero who
      // stepped out of range or out of the front arc during the windup makes it miss cleanly.
      const targetId = warden.targetId;
      const target = targetId == null ? null : heroes[targetId];
      const position = targetId == null ? null : (commandHeroes[targetId]?.position ?? { x: 0, z: 0 });
      if (target && target.downSeconds < 0
        && isWithinStrike(warden, warden.heading, position, WARDEN_MELEE_RANGE)) {
        hurtHero(target, targetId, events, commandHeroes[targetId]?.damageReductionPercent);
      }
    }
    if (warden.modeSeconds >= WARDEN_OVERHEAD_SECONDS) endAttack(warden);
    return;
  }

  if (warden.mode === 'sweep') {
    if (!warden.attackLanded && warden.modeSeconds >= WARDEN_SWEEP_CONTACT_SECONDS) {
      warden.attackLanded = true;
      // EVERY standing hero in the wide front arc, not just the chosen target -- that is the whole
      // point of the move.
      for (const heroId of heroIds) {
        const hero = heroes[heroId];
        if (hero.downSeconds >= 0) continue;
        const position = commandHeroes[heroId]?.position ?? { x: 0, z: 0 };
        if (isWithinStrike(warden, warden.heading, position, WARDEN_MELEE_RANGE, WARDEN_SWEEP_HALF_ARC_RADIANS)) {
          hurtHero(hero, heroId, events, commandHeroes[heroId]?.damageReductionPercent);
        }
      }
    }
    if (warden.modeSeconds >= WARDEN_SWEEP_SECONDS) endAttack(warden);
    return;
  }

  if (warden.mode === 'pulse') {
    if (!warden.attackLanded && warden.modeSeconds >= WARDEN_PULSE_CONTACT_SECONDS) {
      warden.attackLanded = true;
      // Range only, no arc: the ring does not care which way anybody is facing -- the answer to it
      // is distance, and only distance.
      for (const heroId of heroIds) {
        const hero = heroes[heroId];
        if (hero.downSeconds >= 0) continue;
        const position = commandHeroes[heroId]?.position ?? { x: 0, z: 0 };
        if (Math.hypot(position.x - warden.x, position.z - warden.z) <= WARDEN_PULSE_RANGE) {
          hurtHero(hero, heroId, events, commandHeroes[heroId]?.damageReductionPercent);
        }
      }
    }
    if (warden.modeSeconds >= WARDEN_PULSE_SECONDS) endAttack(warden);
    return;
  }

  // idle or walking: the nearest standing hero, freshly chosen each tick like the wolf's.
  let nearestId = null;
  let nearestDx = 0;
  let nearestDz = 0;
  let nearestDistance = Infinity;
  for (const heroId of heroIds) {
    if (heroes[heroId].downSeconds >= 0) continue;
    const position = commandHeroes[heroId]?.position ?? { x: 0, z: 0 };
    const dx = position.x - warden.x;
    const dz = position.z - warden.z;
    const distance = Math.hypot(dx, dz);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestId = heroId;
      nearestDx = dx;
      nearestDz = dz;
    }
  }

  // Nobody standing, or everybody has genuinely left: back to the Beacon's foot.
  if (nearestId === null || nearestDistance > WARDEN_AGGRO_RANGE) {
    walkHome(warden, home, deltaSeconds);
    return;
  }

  // All three attacks start from the same gate the wolf's bite uses -- target in melee reach,
  // cooldown spent. The pulse could justify its own longer gate (its range is bigger), but one
  // gate means one rhythm a child can read: the Warden closes, then it does SOMETHING.
  if (nearestDistance <= WARDEN_MELEE_RANGE && warden.attackCooldown === 0) {
    startAttack(draft, commandHeroes, nearestId, nearestDx, nearestDz);
    return;
  }

  if (nearestDistance > WARDEN_MELEE_RANGE * 0.9) {
    const moved = moveTowards(warden, commandHeroes[nearestId]?.position ?? { x: 0, z: 0 }, WARDEN_SPEED, deltaSeconds);
    warden.x = moved.x;
    warden.z = moved.z;
    warden.heading = moved.heading;
    warden.mode = 'walk';
    return;
  }

  warden.mode = 'idle';
}
