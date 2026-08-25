// GalaQuest wire protocol. Shared verbatim by the browser client and the node server, so there
// is one definition of what a legal message is rather than two that drift. The live version is
// PROTOCOL_VERSION below -- this line used to say "v1" while that constant read 3, which is
// docs/MISTAKES.md GQ-002 ("a stale file header is a lie the file tells about itself") sitting three
// lines above its own contradiction.
//
// JSON text frames. Compact, debuggable in the network panel, and nowhere near the bandwidth where a
// binary format would earn its complexity: a snapshot for two players is ~150 bytes at 10 Hz.
//
// The validation is the point. Every decode is treated as hostile input -- not because these two
// children are a threat model, but because a malformed message reaching game state is the kind of
// bug that presents as "the world went wrong" hours later, and NaN propagates silently through
// position maths until everything is NaN. Rejecting at the boundary keeps the failure local and
// nameable.

// 3, not 2 -- 2 was burned by claude/phase-2-tracer's incompatible identity handshake (Phase B
// brief, Design ruling 2). v1's five messages plus `attack` (client->server) and an `encounter`
// block riding `welcome`/`snapshot`. A stale tab fails loudly at decode instead of half-working.
//
// `equip` (GP1) does NOT bump this to 4: it is additive the same way modeSeconds/rewards were --
// a new client->server message type an old server simply never receives, and a new optional field
// on the existing rewards block (decodeRewards' equippedWeaponId) that an old client never sends and
// an old fixture decodes past unchanged. See decodeRewards' own comment for the precedent this
// follows.
//
// GP2's `search-cart`/`collect-loot` and the encounter block's new `loot`/`coins`/`shards` fields are
// additive for the identical reason -- two more client->server types an old server never receives,
// and optional fields an old client never sends and an old fixture decodes past unchanged.
//
// GP3's `village-upgrade-purchase` and the encounter block's new `village` field are additive for
// the same reason again -- one more client->server type, one more optional field an old client never
// sends and an old fixture decodes past unchanged.

// The first import this file has ever had, and deliberately a narrow one: two pure predicates from
// the progression authority, no runtime, no state. It stays importable by the browser and by node
// exactly as before -- progression/facts.js keeps the same no-DOM/no-storage/no-clock discipline
// this module does. The alternative was a second copy of the durable fact vocabulary living here,
// which is the drift docs/MISTAKES.md GQ-007 exists to stop.
import { isDurableFactType, parseXpFactAmount } from '../progression/facts.js';

export const PROTOCOL_VERSION = 3;

export const MESSAGE_TYPES = [
  'join', 'welcome', 'input', 'snapshot', 'leave', 'attack', 'equip', 'search-cart', 'collect-loot',
  'village-upgrade-purchase', 'claim-blade', 'claim-hollow', 'claim-satchel', 'claim-charm',
  'restore-profile',
];

// Mirrors requireString's own default cap. Item ids are short snake_case tokens
// (progression/items.js), never player-authored text, so this is a sanity ceiling rather than a
// UI constraint -- 32 comfortably covers every id that file defines today.
const ITEM_ID_MAX_LENGTH = 32;
// An equip eventId is `equip:<profileId>:<rev>:<uuid>`: a 64-char profile id ceiling plus the
// prefix, the order and a UUID. Bounded like every other wire string so a client cannot make the
// server store an arbitrarily long primary key.
const EVENT_ID_MAX_LENGTH = 160;
// GP2 pickup ids look like "cart-loot:shard:1" -- world/cartLoot.js's own table entries -- longer
// than an item id but still a short, caller-built token, never player-authored text.
const PICKUP_ID_MAX_LENGTH = 48;

// The wolf's mode is a small closed set on the wire, same as it is in encounter.js -- anything
// else is either a typo or a client running rules the server does not, and either way the frame
// is not trustworthy.
const WOLF_MODES = ['idle', 'walk', 'bite', 'hit', 'dying', 'dead'];

// Inputs are sent at 15 Hz while the stick is live, plus exactly one zero-magnitude message on
// release so the server stops immediately rather than waiting for the stale-input timeout.
export const INPUT_SEND_HZ = 15;
export const SNAPSHOT_HZ = 10;

// How precise this wire is, and therefore the finest difference any client is ABLE to observe.
//
// Every number the server sends is rounded to three decimals before it goes out -- positions,
// headings, speeds and the encounter block's own clocks. net/gameServer.mjs used to spell that out
// four times inline plus once more as a private `round3`, five copies of one rule (GQ-007), and it
// is a property of the WIRE rather than of the server, so it belongs here beside the message shapes
// it applies to.
//
// The reason it is exported rather than merely applied: a consumer measuring the game THROUGH this
// wire cannot resolve anything finer, and needs to say so honestly. tools/runtime-test/play-fight.mjs
// asserts that the authoritative hero is never inside the wolf, and had to allow for exactly this --
// hero and wolf are rounded independently, so each position can shift by hypot(0.0005, 0.0005) =
// 0.000707m and a distance between two of them can read up to 0.00141m short of the truth. That
// tolerance was a restated literal in the harness until this export existed.
//
// EXPRESSED AS A DECIMAL COUNT, not as 0.001, and that is deliberate rather than fussy: the rounding
// must stay `Math.round(value * 1000) / 1000` to the bit. Dividing by a 0.001 literal instead is NOT
// the same arithmetic -- 0.001 is not exactly representable -- and a 1-ULP change to every number on
// the wire is exactly the kind of silent drift the golden-trace test exists to catch.
export const WIRE_DECIMALS = 3;
const WIRE_SCALE = 10 ** WIRE_DECIMALS;
/** The smallest difference the wire can express: 0.001. For consumers reasoning about precision. */
export const WIRE_POSITION_QUANTUM = 1 / WIRE_SCALE;

/** Round one number the way every number on this wire is rounded. */
export function roundToWire(value) {
  return Math.round(value * WIRE_SCALE) / WIRE_SCALE;
}

// A unit vector's length can exceed 1 by a float hair after normalisation, so the direction check
// has slack. Magnitude is a clamped stick reading and needs none.
const DIRECTION_TOLERANCE = 1.01;

// Phase D: a client-random token in localStorage, no PII (brief D3). 8-64 so a UUID (36 chars,
// hyphens included) fits comfortably with room either side; the alphabet excludes anything that
// would need URL/JSON escaping.
const GUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export class ProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProtocolError';
  }
}

function fail(reason) {
  throw new ProtocolError(reason);
}

function requireFiniteNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${field} must be a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireString(value, field, maxLength = 32) {
  if (typeof value !== 'string') fail(`${field} must be a string, got ${typeof value}`);
  if (value.length > maxLength) fail(`${field} is longer than ${maxLength} characters`);
  return value;
}

function requireInteger(value, field) {
  requireFiniteNumber(value, field);
  if (!Number.isInteger(value)) fail(`${field} must be an integer, got ${value}`);
  return value;
}

export function encode(message) {
  return JSON.stringify(message);
}

// Returns the validated message, or throws ProtocolError. Callers decide what a rejection means:
// the server drops the connection, the client logs and ignores.
export function decode(text) {
  if (typeof text !== 'string') fail('frame payload must be text');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    fail(`payload is not JSON: ${error.message}`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('payload must be a JSON object');
  }
  if (raw.v !== PROTOCOL_VERSION) {
    fail(`unsupported protocol version ${JSON.stringify(raw.v)}, expected ${PROTOCOL_VERSION}`);
  }
  if (!MESSAGE_TYPES.includes(raw.type)) {
    fail(`unknown message type ${JSON.stringify(raw.type)}`);
  }

  switch (raw.type) {
    case 'join': {
      const decoded = { v: PROTOCOL_VERSION, type: 'join', name: requireString(raw.name, 'name') };
      // Additive, not a version bump: absent entirely (a pre-D3 client, or a private-browsing
      // client that could not use localStorage) decodes exactly as it always did -- no `guestId`
      // key at all -- so this server keeps decoding a v3 client's join message unchanged, and a
      // v3-only server ignores this field on a new client's join the same way it ignores any other
      // property it does not read off `raw`. The server then treats the connection as ephemeral:
      // marks still count for the session, in memory, they just do not survive a reconnect.
      if (raw.guestId !== undefined && raw.guestId !== null) {
        if (typeof raw.guestId !== 'string' || !GUEST_ID_PATTERN.test(raw.guestId)) {
          fail(`guestId must match ${GUEST_ID_PATTERN}, got ${JSON.stringify(raw.guestId)}`);
        }
        decoded.guestId = raw.guestId;
      }
      return decoded;
    }

    case 'welcome':
      return {
        v: PROTOCOL_VERSION,
        type: 'welcome',
        id: requireString(raw.id, 'id'),
        tick: requireInteger(raw.tick, 'tick'),
        players: decodePlayers(raw.players),
        encounter: decodeEncounter(raw.encounter),
        // Additive, same reasoning as guestId on join and equippedWeaponId on the rewards block:
        // absent entirely (a pre-1b server, or an ephemeral connection) decodes to `[]` rather than
        // failing, so this is not the version bump. PROTOCOL_VERSION stays 3.
        profileFacts: decodeProfileFacts(raw.profileFacts),
      };

    case 'attack': {
      const seq = requireInteger(raw.seq, 'seq');
      if (seq < 0) fail(`seq must be >= 0, got ${seq}`);
      return { v: PROTOCOL_VERSION, type: 'attack', seq };
    }

    // Client -> server only, same direction as 'attack'. Shape validation only -- whether itemId
    // names a real, owned weapon is a business rule this layer does not know, exactly the boundary
    // net/rewardStore.mjs's apply() and net/gameServer.mjs's applyEquip draw for the same reason
    // decodeRewards below does not range-check marks against MARKS_TO_UNLOCK.
    case 'equip': {
      const itemId = requireString(raw.itemId, 'itemId', ITEM_ID_MAX_LENGTH);
      if (itemId.length === 0) fail('itemId must not be empty');
      // The equip's own identity and order, minted by the device at the moment the child chose --
      // see docs/MISTAKES.md GQ-014. Optional, and additive rather than a version bump: a caller
      // that sends neither (an older client, a harness, a test) still equips, and the server mints
      // an identity above that guest's history instead. What it must never do is let a supplied
      // identity through unvalidated, so both fields are checked exactly as strictly as any other.
      const message = { v: PROTOCOL_VERSION, type: 'equip', itemId };
      if (raw.eventId !== undefined) {
        const eventId = requireString(raw.eventId, 'eventId', EVENT_ID_MAX_LENGTH);
        if (eventId.length === 0) fail('eventId must not be empty');
        message.eventId = eventId;
      }
      if (raw.rev !== undefined) {
        if (!Number.isInteger(raw.rev) || raw.rev < 0) {
          fail(`rev must be a non-negative integer, got ${JSON.stringify(raw.rev)}`);
        }
        message.rev = raw.rev;
      }
      // Half an identity is not one: an eventId with no order would be stored with a NULL rev and
      // silently fall back to being ordered by when it was seen, which is the defect this carries
      // an order to avoid.
      if ((message.eventId === undefined) !== (message.rev === undefined)) {
        fail('equip must carry both eventId and rev, or neither');
      }
      return message;
    }

    // Client -> server only, no payload: whoever sends this first (per the shared physical cart)
    // spawns the authored haul for everyone; world/cartLoot.js's requestSearchCart is what makes
    // every later one, from any client, a clean no-op rather than a second batch.
    case 'search-cart':
      return { v: PROTOCOL_VERSION, type: 'search-cart' };

    // G4. Client -> server only, no payload, exactly like 'search-cart' above and for the same
    // reason: the message says "I am standing in front of Rowan asking for what I was promised", and
    // every fact that decides whether that is TRUE (is the Beacon lit, is this hero actually near
    // Rowan, do they already own it) is server-side world state the client cannot be trusted to
    // assert. A resend is naturally idempotent -- net/rewardStore.mjs's 'gear-owned' rows are a SET,
    // so granting the same item twice is one row either way.
    case 'claim-blade':
      return { v: PROTOCOL_VERSION, type: 'claim-blade' };

    // G5. Same no-payload shape and the same reasoning as 'claim-blade' directly above: the hollow's
    // chest is a place, and where a hero is standing is the server's fact, not the client's.
    case 'claim-hollow':
      return { v: PROTOCOL_VERSION, type: 'claim-hollow' };

    // ARC 2. Two more of the same no-payload shape, and the same reasoning a third and fourth time:
    // 'claim-satchel' says "I am standing over the fallen ranger's satchel in the hollow" and
    // 'claim-charm' says "I am standing in front of Wren holding it". Both are claims about WHERE A
    // HERO IS, which is the server's fact and never the client's, and both are naturally idempotent
    // because the rows behind them are latches (net/rewardStore.mjs's satchelTakenFor/charmEarnedFor).
    case 'claim-satchel':
      return { v: PROTOCOL_VERSION, type: 'claim-satchel' };
    case 'claim-charm':
      return { v: PROTOCOL_VERSION, type: 'claim-charm' };

    // Client -> server. A device handing back the durable facts it still holds, for a store that
    // no longer has them -- see net/gameServer.mjs's restoreProfileFacts for what is and is not
    // accepted, and test/empty-server-recovery.test.mjs for why re-sending only the equip cannot
    // work. Reuses decodeProfileFacts, the SAME validation the welcome direction uses: this is
    // literally the same fact shape travelling the other way, and two validators for one shape is
    // the GQ-007 defect in its usual form.
    case 'restore-profile':
      return { v: PROTOCOL_VERSION, type: 'restore-profile', facts: decodeProfileFacts(raw.facts) };

    // Client -> server only, same direction as 'attack'/'equip'. Shape validation only -- whether
    // pickupId names a real, unclaimed, in-reach pickup is world/cartLoot.js's own business rule,
    // the same boundary 'equip' draws against isKnownWeapon/ownership.
    case 'collect-loot': {
      const pickupId = requireString(raw.pickupId, 'pickupId', PICKUP_ID_MAX_LENGTH);
      if (pickupId.length === 0) fail('pickupId must not be empty');
      return { v: PROTOCOL_VERSION, type: 'collect-loot', pickupId };
    }

    // Client -> server only, same direction as 'collect-loot'. Shape validation only -- whether
    // upgradeId names a real, affordable, not-yet-owned upgrade is village/economy.js's business
    // rule (net/gameServer.mjs's applyVillageUpgradePurchase), the same boundary 'collect-loot'
    // draws against world/cartLoot.js. Reuses PICKUP_ID_MAX_LENGTH's cap rather than a new constant:
    // an upgrade id (e.g. "village-upgrade:workshop:1") is the identical shape of caller-built,
    // colon-namespaced token a pickup id already is.
    case 'village-upgrade-purchase': {
      const upgradeId = requireString(raw.upgradeId, 'upgradeId', PICKUP_ID_MAX_LENGTH);
      if (upgradeId.length === 0) fail('upgradeId must not be empty');
      return { v: PROTOCOL_VERSION, type: 'village-upgrade-purchase', upgradeId };
    }

    case 'input': {
      const dirX = requireFiniteNumber(raw.dirX, 'dirX');
      const dirZ = requireFiniteNumber(raw.dirZ, 'dirZ');
      const magnitude = requireFiniteNumber(raw.magnitude, 'magnitude');
      const length = Math.hypot(dirX, dirZ);
      if (length > DIRECTION_TOLERANCE) {
        fail(`direction is longer than unit: |(${dirX}, ${dirZ})| = ${length.toFixed(4)}`);
      }
      // Zero-length is legal and means "stop"; anything between 0 and unit is not, because the
      // client is responsible for normalising and the server prices magnitude separately. Letting a
      // short vector through would apply the deflection twice -- the exact defect fixed in c75242c.
      if (length > 0 && length < 1 / DIRECTION_TOLERANCE) {
        fail(`direction must be unit or zero, got length ${length.toFixed(4)}`);
      }
      if (magnitude < 0 || magnitude > 1) {
        fail(`magnitude must be within [0, 1], got ${magnitude}`);
      }
      return {
        v: PROTOCOL_VERSION,
        type: 'input',
        seq: requireInteger(raw.seq, 'seq'),
        dirX,
        dirZ,
        magnitude,
        run: Boolean(raw.run),
      };
    }

    case 'snapshot':
      return {
        v: PROTOCOL_VERSION,
        type: 'snapshot',
        tick: requireInteger(raw.tick, 'tick'),
        players: decodePlayers(raw.players),
        encounter: decodeEncounter(raw.encounter),
        events: decodeEvents(raw.events),
      };

    case 'leave':
      return { v: PROTOCOL_VERSION, type: 'leave', id: requireString(raw.id, 'id') };

    default:
      return fail(`unhandled message type ${raw.type}`);
  }
}

function decodePlayers(players) {
  if (!Array.isArray(players)) fail('players must be an array');
  return players.map((player, index) => {
    if (player === null || typeof player !== 'object') fail(`players[${index}] must be an object`);
    return {
      id: requireString(player.id, `players[${index}].id`),
      x: requireFiniteNumber(player.x, `players[${index}].x`),
      z: requireFiniteNumber(player.z, `players[${index}].z`),
      heading: requireFiniteNumber(player.heading, `players[${index}].heading`),
      speed: requireFiniteNumber(player.speed, `players[${index}].speed`),
    };
  });
}

// The encounter block mirrors encounter.js's party state (public/src/combat/encounter.js), but
// only the fields the wire actually needs -- canHeroAttack's BINDING note there names exactly
// heroes[id].{downSeconds, swingSeconds, cooldown} as what a client needs to predict its own
// attack button, plus hp to render hearts. Internal-only fields (biteCooldown, biteLanded,
// swingLanded, lastCommandId) never leave the server.
//
// modeSeconds is the one exception (Task B4.5): enemies/wolf.js's presenter reads it to decide
// whether a one-shot clip (bite/hit/death) re-entering the same mode needs restarting -- e.g. a
// second hero's swing landing while the wolf is already staggering from a first hit. B2 left it
// off the wire and the restart-on-reentry re-flinch silently never fired online. It rides as an
// OPTIONAL field -- validated (finite, >= 0) when present, simply absent from the decoded wolf
// when not -- specifically so every pre-B4.5 caller and fixture that never carried it keeps
// decoding byte-identically; gameServer.mjs's real snapshots always populate it.
function decodeWolf(wolf) {
  if (wolf === null || typeof wolf !== 'object') fail('encounter.wolf must be an object');
  if (!WOLF_MODES.includes(wolf.mode)) {
    fail(`encounter.wolf.mode must be one of ${WOLF_MODES.join(', ')}, got ${JSON.stringify(wolf.mode)}`);
  }
  const targetId = wolf.targetId === null ? null : requireString(wolf.targetId, 'encounter.wolf.targetId');
  const decoded = {
    x: requireFiniteNumber(wolf.x, 'encounter.wolf.x'),
    z: requireFiniteNumber(wolf.z, 'encounter.wolf.z'),
    heading: requireFiniteNumber(wolf.heading, 'encounter.wolf.heading'),
    hp: requireInteger(wolf.hp, 'encounter.wolf.hp'),
    mode: wolf.mode,
    targetId,
  };
  if (wolf.modeSeconds !== undefined) {
    const modeSeconds = requireFiniteNumber(wolf.modeSeconds, 'encounter.wolf.modeSeconds');
    if (modeSeconds < 0) fail(`encounter.wolf.modeSeconds must be >= 0, got ${modeSeconds}`);
    decoded.modeSeconds = modeSeconds;
  }
  return decoded;
}

function decodeHeroes(heroes) {
  if (heroes === null || typeof heroes !== 'object' || Array.isArray(heroes)) {
    fail('encounter.heroes must be an object');
  }
  const result = {};
  for (const [id, hero] of Object.entries(heroes)) {
    if (hero === null || typeof hero !== 'object') fail(`encounter.heroes[${id}] must be an object`);
    result[id] = {
      hp: requireInteger(hero.hp, `encounter.heroes[${id}].hp`),
      swingSeconds: requireFiniteNumber(hero.swingSeconds, `encounter.heroes[${id}].swingSeconds`),
      cooldown: requireFiniteNumber(hero.cooldown, `encounter.heroes[${id}].cooldown`),
      downSeconds: requireFiniteNumber(hero.downSeconds, `encounter.heroes[${id}].downSeconds`),
    };
    // maxHp rides OPTIONALLY, the same additive shape wolf.modeSeconds uses above and for the same
    // reason: every pre-charm fixture and caller decodes byte-identically, so this is additive
    // validation rather than a version bump. It exists because hearts stopped being a constant --
    // Ranger Wren's charm gives a fourth, and a client rendering three pips for a four-heart hero
    // would show a child full health at 3 of 4 and no health at 0 of 4 on the same bar.
    if (hero.maxHp !== undefined) {
      const maxHp = requireInteger(hero.maxHp, `encounter.heroes[${id}].maxHp`);
      if (maxHp < 1) fail(`encounter.heroes[${id}].maxHp must be >= 1, got ${maxHp}`);
      result[id].maxHp = maxHp;
    }
  }
  return result;
}

// Phase D (D3): marks per hero-as-mapped-to-guest. Optional on the wire, the same additive shape
// modeSeconds uses above -- absent entirely (every pre-D3 fixture and caller) decodes to `{}` rather
// than failing, so this is additive validation, not the protocol version bump the brief's own
// decoder-strictness test asks to check for first. A client only ever needs to read its OWN entry;
// nothing here filters that down, the same way heroes carries every hero and main.js does the
// filtering.
/**
 * The joining profile's DURABLE facts -- the rows behind the rewards block, each with the stable
 * eventId that makes a second copy mergeable instead of double counted.
 *
 * This is deliberately not the same thing as `encounter.rewards`, and the difference is the whole
 * reason it exists. The rewards block is DERIVED: counts and a resolved weapon id. A device cannot
 * journal a count -- a fact with no stable name cannot be deduplicated, so folding "marks: 2" into a
 * grow-only set would add two more marks every reconnect. These are the named facts themselves, so
 * ingesting the same welcome twice is a no-op (progression/facts.js's union law).
 *
 * SHAPE only, exactly the boundary decodeRewards draws for itemIds: this layer does not know which
 * fact types exist. progression/facts.js's isProfileFact owns that list and already drops anything
 * it does not recognise, so a new durable fact type is a progression change and not a wire change.
 * Restating the list here would be a second copy of a rule that has an authority (GQ-007).
 *
 * Not length-capped on purpose. The array grows with a profile's whole history, and the only thing a
 * cap could do to an unusually long-lived save is refuse the join or silently truncate it -- both
 * strictly worse than a large welcome. Worth revisiting if a real profile ever gets big enough to
 * matter; at Stage 1 volumes it is tens of facts.
 */
function decodeProfileFacts(facts) {
  if (facts === undefined || facts === null) return [];
  if (!Array.isArray(facts)) fail('profileFacts must be an array');
  return facts.map((fact, index) => {
    if (fact === null || typeof fact !== 'object') fail(`profileFacts[${index}] must be an object`);
    const decoded = {
      eventId: requireString(fact.eventId, `profileFacts[${index}].eventId`, EVENT_ID_MAX_LENGTH),
      type: requireString(fact.type, `profileFacts[${index}].type`),
    };
    if (decoded.eventId.length === 0) fail(`profileFacts[${index}].eventId must not be empty`);
    // The type has to be one the game actually has, checked against the progression authority rather
    // than a list kept here -- a second hand-maintained vocabulary in the protocol is the same defect
    // net/rewardStore.mjs already had (docs/MISTAKES.md GQ-007).
    //
    // The DURABLE set, not the profile subset: this decoder is shared by `restore-profile` coming IN
    // and the `welcome` facts going OUT, and a child who lit the Beacon or bought the Workshop has
    // guest-stamped WORLD rows among their own. Narrowing this to profile facts alone would make a
    // returning child's own welcome message undecodable. Which types a DEVICE may restore is a
    // different and stricter question, and net/gameServer.mjs answers it where the writing happens.
    if (!isDurableFactType(decoded.type)) {
      fail(`profileFacts[${index}].type is not a durable fact type: ${JSON.stringify(decoded.type)}`);
    }
    if (fact.value !== undefined && fact.value !== null) {
      decoded.value = requireString(fact.value, `profileFacts[${index}].value`, ITEM_ID_MAX_LENGTH);
    }
    // An XP amount is checked HERE, at the boundary, for the reason the file header already gives:
    // rejecting malformed input where it arrives keeps the failure local and nameable instead of
    // letting it become a wrong number somewhere downstream. A negative or fractional amount reaching
    // the fold is a hero's XP quietly moving the wrong way (see parseXpFactAmount).
    if (decoded.type === 'xp-earned' && parseXpFactAmount(decoded.value) === null) {
      fail(`profileFacts[${index}].value is not a valid xp amount: ${JSON.stringify(decoded.value)}`);
    }
    // Absent rather than null when the row has no order -- a fact given a made-up revision here
    // would be claiming a place in a chronology it was never part of, which is the GQ-014 defect.
    if (fact.rev !== undefined && fact.rev !== null) {
      decoded.rev = requireInteger(fact.rev, `profileFacts[${index}].rev`);
    }
    // Who attested this fact. Present only on a row a DEVICE handed back for a store that had lost
    // it; a fact the server adjudicated carries nothing, so the label means something rather than
    // being on everything. Carried in both directions: the device is told which of its facts the
    // server only knows because it was told, which is what makes the attestation visible rather
    // than merely recorded.
    if (fact.origin !== undefined && fact.origin !== null) {
      decoded.origin = requireString(fact.origin, `profileFacts[${index}].origin`);
    }
    return decoded;
  });
}

function decodeRewards(rewards) {
  if (rewards === undefined) return {};
  if (rewards === null || typeof rewards !== 'object' || Array.isArray(rewards)) {
    fail('encounter.rewards must be an object');
  }
  const result = {};
  for (const [id, reward] of Object.entries(rewards)) {
    if (reward === null || typeof reward !== 'object') fail(`encounter.rewards[${id}] must be an object`);
    const marks = requireInteger(reward.marks, `encounter.rewards[${id}].marks`);
    if (marks < 0) fail(`encounter.rewards[${id}].marks must be >= 0, got ${marks}`);
    const decoded = { marks, lanternUnlocked: Boolean(reward.lanternUnlocked) };
    // Optional, same additive shape decodeWolf's own modeSeconds uses (GP1): absent entirely for
    // every pre-GP1 fixture and caller, so this is not the protocol version bump the guestId
    // precedent above already explains the reasoning for. A client with no equip yet falls back to
    // progression/items.js's DEFAULT_EQUIPPED_WEAPON_ID -- this layer only reports what rode the wire.
    if (reward.equippedWeaponId !== undefined) {
      decoded.equippedWeaponId = requireString(
        reward.equippedWeaponId, `encounter.rewards[${id}].equippedWeaponId`, ITEM_ID_MAX_LENGTH,
      );
    }
    // GP1-C1: same additive/optional treatment as equippedWeaponId just above -- absent for every
    // pre-C1 fixture and caller. A client with no field falls back to progression/items.js's
    // DEFAULT_OWNED_ITEM_IDS (starter sword only); this layer only validates SHAPE (an array of
    // strings), never which items exist or are legal to own -- that is rewardStore.mjs's job, the
    // same boundary equippedWeaponId already draws.
    if (reward.ownedItemIds !== undefined) {
      if (!Array.isArray(reward.ownedItemIds)) {
        fail(`encounter.rewards[${id}].ownedItemIds must be an array`);
      }
      decoded.ownedItemIds = reward.ownedItemIds.map(
        (itemId, index) => requireString(itemId, `encounter.rewards[${id}].ownedItemIds[${index}]`, ITEM_ID_MAX_LENGTH),
      );
    }
    // GP2: same additive/optional treatment as equippedWeaponId above -- absent for every pre-GP2
    // fixture and caller, so a client with no field falls back to 0 (nothing collected yet), the same
    // "always a safe fallback" discipline the rest of this block already follows.
    if (reward.coins !== undefined) {
      const coins = requireInteger(reward.coins, `encounter.rewards[${id}].coins`);
      if (coins < 0) fail(`encounter.rewards[${id}].coins must be >= 0, got ${coins}`);
      decoded.coins = coins;
    }
    if (reward.shards !== undefined) {
      const shards = requireInteger(reward.shards, `encounter.rewards[${id}].shards`);
      if (shards < 0) fail(`encounter.rewards[${id}].shards must be >= 0, got ${shards}`);
      decoded.shards = shards;
    }
    // P2: the hero's total XP, same additive/optional treatment as coins and shards above, and NOT a
    // protocol version bump for the same reason those were not -- an old client decodes past a field
    // it does not know, and a client with no field falls back to 0, which is the honest answer for a
    // hero who has earned nothing.
    //
    // A TOTAL, not a level. The level is derived from it by progression/levels.js on whichever side
    // is asking, so the wire cannot carry a level that disagrees with the XP beside it -- the exact
    // contradiction the one-authority rule exists to prevent (GQ-007). Range-checked as a
    // non-negative integer because that is the only shape progression/levels.js accepts; a malformed
    // total must be refused at the boundary rather than folded into a plausible Level 1.
    if (reward.xp !== undefined) {
      const xp = requireInteger(reward.xp, `encounter.rewards[${id}].xp`);
      if (xp < 0) fail(`encounter.rewards[${id}].xp must be >= 0, got ${xp}`);
      decoded.xp = xp;
    }
    // ARC 2: two more latches, same additive/optional treatment and the same "absent falls back to
    // false" discipline as every field above. Both ride here rather than as world state because both
    // are PER GUEST -- two brothers can be carrying different things and owe each other nothing.
    // Booleans coerced rather than validated, the same way lanternUnlocked already is: there is no
    // malformed shape for a flag, only a truthy one and a falsy one.
    if (reward.satchelCarried !== undefined) decoded.satchelCarried = Boolean(reward.satchelCarried);
    if (reward.charmOwned !== undefined) decoded.charmOwned = Boolean(reward.charmOwned);
    result[id] = decoded;
  }
  return result;
}

// GP2: which pickups off world/cartLoot.js's CART_LOOT_TABLE are gone, and whether the cart has even
// been searched yet. Optional/additive, the same shape decodeRewards itself uses -- absent entirely
// for every pre-GP2 fixture and caller, decoding to "nothing has happened yet" rather than failing.
// `collected` only ever needs pickupId -> whoever collected it: the pickup's own kind/position are
// derivable from cartLoot.js's own table, not restated on the wire a second time.
function decodeLoot(loot) {
  if (loot === undefined) return { spawned: false, collected: {} };
  if (loot === null || typeof loot !== 'object' || Array.isArray(loot)) fail('encounter.loot must be an object');
  const collected = {};
  if (loot.collected !== undefined) {
    if (loot.collected === null || typeof loot.collected !== 'object' || Array.isArray(loot.collected)) {
      fail('encounter.loot.collected must be an object');
    }
    for (const [pickupId, heroId] of Object.entries(loot.collected)) {
      collected[pickupId] = requireString(heroId, `encounter.loot.collected[${pickupId}]`);
    }
  }
  return { spawned: Boolean(loot.spawned), collected };
}

// GP3: Village Supplies, shared once for the whole simulation rather than per-hero -- unlike
// `rewards` above (net/gameServer.mjs's own createRewardCoordinator draws this same shared-vs-per-
// guest line: coinsFor/shardsFor stay personal provenance, this is the communal spendable total).
// Optional/additive, the same shape decodeLoot itself uses -- absent entirely for every pre-GP3
// fixture and caller, decoding to "nothing earned yet, nothing bought" rather than failing.
function decodeVillage(village) {
  if (village === undefined) return { coins: 0, shards: 0, workshopOwned: false };
  if (village === null || typeof village !== 'object' || Array.isArray(village)) {
    fail('encounter.village must be an object');
  }
  const coins = requireInteger(village.coins, 'encounter.village.coins');
  if (coins < 0) fail(`encounter.village.coins must be >= 0, got ${coins}`);
  const shards = requireInteger(village.shards, 'encounter.village.shards');
  if (shards < 0) fail(`encounter.village.shards must be >= 0, got ${shards}`);
  return { coins, shards, workshopOwned: Boolean(village.workshopOwned) };
}

// ── G2/G3: THE BEACON SIEGE ─────────────────────────────────────────────────────────────────────
//
// The one piece of this arc that genuinely has to ride the wire, and the reason is the co-op rule
// the design brief states plainly: two children must see ONE boss with ONE health bar, both land
// blows on it, and both watch it fall. Everything else in the Beacon arc is either a per-client
// discovery latch (arriving, finding the hollow -- main.js keeps those local, the same way
// beaconFound already is) or a durable per-guest possession (the Blade, which rides `rewards`).
// Shared, live, contested state is exactly what a snapshot is for.
//
// Optional/additive, the same shape decodeLoot and decodeVillage already use -- absent entirely for
// every pre-G2 fixture and caller, decoding to "the seals are whole and nothing has woken" rather
// than failing. That is what lets an old server and a new client meet without a version bump.
//
// Only what a PRESENTER needs rides here. world/beaconSiege.js's own internal bookkeeping
// (attackCount, staggerBlows, per-hero lastCommandId) stays server-side, the identical boundary
// decodeWolf already draws against biteCooldown/biteLanded -- and `modeSeconds` is carried for the
// identical reason it is carried for the wolf: enemies/warden.js drives every pose procedurally off
// (mode, modeSeconds), so without it the Warden cannot animate at all on a remote client.
const WARDEN_MODES = [
  'dormant', 'waking', 'idle', 'walk', 'overhead', 'sweep', 'pulse', 'hit', 'dying', 'dead',
];

function decodeSiegeWarden(warden) {
  if (warden === null || typeof warden !== 'object') fail('encounter.siege.warden must be an object');
  if (!WARDEN_MODES.includes(warden.mode)) {
    fail(`encounter.siege.warden.mode must be one of ${WARDEN_MODES.join(', ')}, got ${JSON.stringify(warden.mode)}`);
  }
  const phase = requireInteger(warden.phase, 'encounter.siege.warden.phase');
  if (phase < 1 || phase > 3) fail(`encounter.siege.warden.phase must be 1..3, got ${phase}`);
  const modeSeconds = requireFiniteNumber(warden.modeSeconds, 'encounter.siege.warden.modeSeconds');
  if (modeSeconds < 0) fail(`encounter.siege.warden.modeSeconds must be >= 0, got ${modeSeconds}`);
  return {
    x: requireFiniteNumber(warden.x, 'encounter.siege.warden.x'),
    z: requireFiniteNumber(warden.z, 'encounter.siege.warden.z'),
    heading: requireFiniteNumber(warden.heading, 'encounter.siege.warden.heading'),
    hp: requireInteger(warden.hp, 'encounter.siege.warden.hp'),
    mode: warden.mode,
    modeSeconds,
    phase,
    targetId: warden.targetId === null || warden.targetId === undefined
      ? null
      : requireString(warden.targetId, 'encounter.siege.warden.targetId'),
  };
}

// The seals as a plain array of `{ blows, burst }`, INDEX-ALIGNED with the zone's own COLD_SEALS
// list -- their coordinates never ride the wire for the same reason a pickup's kind/position never
// does (decodeLoot's own comment): both sides already import the same zone data, so restating it on
// the wire would be a second copy free to disagree with the first.
function decodeSiegeSeals(seals) {
  if (!Array.isArray(seals)) fail('encounter.siege.seals must be an array');
  return seals.map((seal, index) => {
    if (seal === null || typeof seal !== 'object' || Array.isArray(seal)) {
      fail(`encounter.siege.seals[${index}] must be an object`);
    }
    const blows = requireInteger(seal.blows, `encounter.siege.seals[${index}].blows`);
    if (blows < 0) fail(`encounter.siege.seals[${index}].blows must be >= 0, got ${blows}`);
    return { blows, burst: Boolean(seal.burst) };
  });
}

const EMPTY_SIEGE = Object.freeze({
  seals: Object.freeze([]),
  warden: Object.freeze({
    x: 0, z: 0, heading: 0, hp: 0, mode: 'dormant', modeSeconds: 0, phase: 1, targetId: null,
  }),
  beaconLit: false,
});

function decodeSiege(siege) {
  if (siege === undefined) return EMPTY_SIEGE;
  if (siege === null || typeof siege !== 'object' || Array.isArray(siege)) {
    fail('encounter.siege must be an object');
  }
  return {
    seals: decodeSiegeSeals(siege.seals),
    warden: decodeSiegeWarden(siege.warden),
    beaconLit: Boolean(siege.beaconLit),
  };
}

function decodeEncounter(encounter) {
  if (encounter === null || typeof encounter !== 'object') fail('encounter must be an object');
  return {
    revision: requireInteger(encounter.revision, 'encounter.revision'),
    wolf: decodeWolf(encounter.wolf),
    heroes: decodeHeroes(encounter.heroes),
    rewards: decodeRewards(encounter.rewards),
    loot: decodeLoot(encounter.loot),
    village: decodeVillage(encounter.village),
    siege: decodeSiege(encounter.siege),
  };
}

// Snapshot-only. type is the one field decode enforces (non-empty, capped, matches feedback.js's
// startup guard against unknown types); everything else rides through untouched -- events carry
// different fields per type (heroId, remaining, ...) and this is not the layer that knows them.
function decodeEvents(events) {
  if (!Array.isArray(events)) fail('events must be an array');
  return events.map((event, index) => {
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      fail(`events[${index}] must be an object`);
    }
    const type = requireString(event.type, `events[${index}].type`);
    if (type.length === 0) fail(`events[${index}].type must not be empty`);
    return { ...event, type };
  });
}

// gameServer.mjs does not build a party encounter yet -- that is Task B3's job, hosting stepParty
// in the 20 Hz loop. Until that lands, its still-unmodified welcomeMessage/snapshotMessage call
// sites (and this file's own pre-B2 test callers) do not pass an encounter, so the builders default
// to this "nothing is fighting yet" shape rather than requiring every caller to be touched in the
// same commit as the wire bump. decode still requires the field: this default only fills the
// builder side, so every message the builders emit is wire-legal either way.
const EMPTY_ENCOUNTER = Object.freeze({
  revision: 0,
  wolf: Object.freeze({ x: 0, z: 0, heading: 0, hp: 0, mode: 'idle', targetId: null }),
  heroes: Object.freeze({}),
  rewards: Object.freeze({}),
  loot: Object.freeze({ spawned: false, collected: Object.freeze({}) }),
  village: Object.freeze({ coins: 0, shards: 0, workshopOwned: false }),
  siege: EMPTY_SIEGE,
});
const NO_EVENTS = Object.freeze([]);
// An ephemeral connection (no guestId) owns no durable facts, and neither does a caller that predates
// the field. Its own frozen constant rather than a shared one with NO_EVENTS: they are different
// kinds of empty, and sharing the binding would make a later change to one silently change the other.
const NO_PROFILE_FACTS = Object.freeze([]);

// Builders, so no call site hand-assembles an object shape the decoder would reject.

export function joinMessage(name, guestId) {
  const message = { v: PROTOCOL_VERSION, type: 'join', name };
  // Only present when a real guestId is supplied -- an omitted key, not an explicit null/undefined
  // property, so a round trip through decode() stays byte-identical for every pre-D3 caller that
  // never passes a second argument at all.
  if (typeof guestId === 'string' && guestId.length > 0) message.guestId = guestId;
  return message;
}

export function welcomeMessage(id, tick, players, encounter = EMPTY_ENCOUNTER, profileFacts = NO_PROFILE_FACTS) {
  return { v: PROTOCOL_VERSION, type: 'welcome', id, tick, players, encounter, profileFacts };
}

export function inputMessage(seq, dirX, dirZ, magnitude, run) {
  return { v: PROTOCOL_VERSION, type: 'input', seq, dirX, dirZ, magnitude, run: Boolean(run) };
}

export function attackMessage(seq) {
  return { v: PROTOCOL_VERSION, type: 'attack', seq };
}

export function restoreProfileMessage(facts) {
  return { v: PROTOCOL_VERSION, type: 'restore-profile', facts: facts ?? NO_PROFILE_FACTS };
}

export function equipMessage(itemId, identity) {
  const message = { v: PROTOCOL_VERSION, type: 'equip', itemId };
  if (identity?.eventId !== undefined && identity?.rev !== undefined) {
    message.eventId = identity.eventId;
    message.rev = identity.rev;
  }
  return message;
}

export function searchCartMessage() {
  return { v: PROTOCOL_VERSION, type: 'search-cart' };
}

export function claimSatchelMessage() {
  return { v: PROTOCOL_VERSION, type: 'claim-satchel' };
}

export function claimCharmMessage() {
  return { v: PROTOCOL_VERSION, type: 'claim-charm' };
}

export function claimBladeMessage() {
  return { v: PROTOCOL_VERSION, type: 'claim-blade' };
}

export function claimHollowMessage() {
  return { v: PROTOCOL_VERSION, type: 'claim-hollow' };
}

export function collectLootMessage(pickupId) {
  return { v: PROTOCOL_VERSION, type: 'collect-loot', pickupId };
}

export function villageUpgradePurchaseMessage(upgradeId) {
  return { v: PROTOCOL_VERSION, type: 'village-upgrade-purchase', upgradeId };
}

export function snapshotMessage(tick, players, encounter = EMPTY_ENCOUNTER, events = NO_EVENTS) {
  return { v: PROTOCOL_VERSION, type: 'snapshot', tick, players, encounter, events };
}

export function leaveMessage(id) {
  return { v: PROTOCOL_VERSION, type: 'leave', id };
}
