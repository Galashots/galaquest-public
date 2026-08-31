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

// 4, not 3: E1 replaces the singular `encounter.wolf` wire field with the canonical
// `encounter.enemies[]` collection. That is a breaking shape change, so a stale v3 tab must fail
// loudly at decode instead of half-working against a server whose ordinary-enemy authority no longer
// has a singular slot. v2 remains the burned phase-2-tracer handshake and v1 the original wire.
//
// Earlier GP1/GP2/GP3 additions remained additive inside v3. E1 is intentionally different: stable
// enemy identity is now part of the protocol contract, not an optional decoration on the old Wolf.

// The first import this file has ever had, and deliberately a narrow one: two pure predicates from
// the progression authority, no runtime, no state. It stays importable by the browser and by node
// exactly as before -- progression/facts.js keeps the same no-DOM/no-storage/no-clock discipline
// this module does. The alternative was a second copy of the durable fact vocabulary living here,
// which is the drift docs/MISTAKES.md GQ-007 exists to stop.
import { isDurableFactType, parseXpFactAmount } from '../progression/facts.js';
import { ENEMY_KINDS, enemyStatsForLevel, isSupportedEnemyLevel } from '../combat/enemyStats.js';

export const PROTOCOL_VERSION = 4;

export const MESSAGE_TYPES = [
  'join', 'welcome', 'input', 'snapshot', 'leave', 'attack', 'equip', 'search-cart', 'collect-loot',
  'village-upgrade-purchase', 'claim-blade', 'claim-hollow', 'claim-satchel', 'claim-charm',
  'restore-profile',
  // R1: kill drops -- the same client->server, no-business-rule-here shape 'collect-loot' already
  // is (see that message's own decode comment). Its dropId cap is DROP_ID_MAX_LENGTH, NOT
  // PICKUP_ID_MAX_LENGTH -- see the correction note on those constants below.
  'collect-drop',
  // #87: personal corpse loot -- the identical shape/reasoning as 'collect-drop' just above, for a
  // claim that lives on world/corpseLoot.js's own corpses rather than enemyDrops.js's ground state.
  // Two messages, not one with an optional field: 'collect-corpse-item' takes exactly one named item
  // off one corpse, 'collect-corpse-all' is the `Take All` action and takes every item that hero's
  // own claim still has untaken. Whether either is legal (does this corpse exist, does THIS hero
  // hold a claim on it, is any of it still untaken, is the hero actually close enough) is
  // corpseLoot.js's own business rule, not this layer's.
  'collect-corpse-item',
  'collect-corpse-all',
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
// A kill-drop id is NOT that shape, and the day this file assumed it was cost a playtest: R1 ids
// are `drop:<enemyId>:<lifeId>:<index>` with the server's randomUUID() as lifeId -- 50 characters
// for the shortest authored enemy, 56 for a frost wolf -- minted per kill, never authored. The
// original 'collect-drop' decoder reused PICKUP_ID_MAX_LENGTH "exactly as village-upgrade-purchase
// does", so every legitimate collection died in decode, the server closed the socket (1008), the
// client rejoined as a fresh player at {x:0,z:0}, and the Owner's children were teleported to spawn
// each time they picked up their own loot. One id crosses this wire in BOTH directions -- outbound
// in encounter.drops[].id, inbound in collect-drop -- so both legs share this single authority.
// Declared here beside the other string caps because the inbound decoder reads it; the outbound
// drops block below uses the same constant. test/collect-drop-wire.test.mjs pins both legs to it.
const DROP_ID_MAX_LENGTH = 96;

// #87: a corpse id is `corpse:<enemyId>:<lifeId>` -- the same shape/length family as a drop id just
// above, minted per kill rather than authored. A claim item id is one segment longer
// (`corpse-item:<enemyId>:<lifeId>:<heroId>:<slot>`), so it gets its own, slightly larger cap rather
// than reusing DROP_ID_MAX_LENGTH and hoping every future heroId stays short enough by accident.
const CORPSE_ID_MAX_LENGTH = 96;
const CORPSE_CLAIM_ITEM_ID_MAX_LENGTH = 160;

// E1 ordinary-enemy identity is explicit on the wire. The collection is bounded like every other
// wire aggregate/string so a malformed frame cannot turn validation itself into unbounded work.
// Only Wolf is implemented in E1; later archetypes extend this closed set deliberately rather than
// smuggling an unknown kind into a presenter that has no visuals or rules for it.
const ENEMY_ID_MAX_LENGTH = 64;
const ENEMY_KIND_MAX_LENGTH = 32;
const ENEMY_COLLECTION_MAX_LENGTH = 128;
// The wire's own allowlist is combat/enemyStats.js's own kind table (GQ-007) rather than a second
// hand-kept list -- the density package's variants (ember-wolf, frost-wolf, alpha-wolf) become
// wire-legal the instant that table names them, with no second edit here to forget.
const ENEMY_MODES = ['idle', 'walk', 'bite', 'hit', 'returning', 'dying', 'dead'];

// Directional abuse bound only: welcome/profileFacts remains intentionally uncapped so a legitimate
// long-lived profile is never truncated merely because restore-profile accepts hostile client input.
export const MAX_RESTORE_PROFILE_FACTS = 128;

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
      // key at all -- so this server keeps decoding a v4 client's join message unchanged, and a
      // v4-only server ignores this field on a new client's join the same way it ignores any other
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
        // failing, so it is additive within v4 rather than another protocol-version change.
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
    case 'restore-profile': {
      if (Array.isArray(raw.facts) && raw.facts.length > MAX_RESTORE_PROFILE_FACTS) {
        fail(`restore-profile facts must contain at most ${MAX_RESTORE_PROFILE_FACTS} facts`);
      }
      return { v: PROTOCOL_VERSION, type: 'restore-profile', facts: decodeProfileFacts(raw.facts) };
    }

    // Client -> server only, same direction as 'attack'/'equip'. Shape validation only -- whether
    // pickupId names a real, unclaimed, in-reach pickup is world/cartLoot.js's own business rule,
    // the same boundary 'equip' draws against isKnownWeapon/ownership.
    case 'collect-loot': {
      const pickupId = requireString(raw.pickupId, 'pickupId', PICKUP_ID_MAX_LENGTH);
      if (pickupId.length === 0) fail('pickupId must not be empty');
      return { v: PROTOCOL_VERSION, type: 'collect-loot', pickupId };
    }

    // R1: the same shape and reasoning as 'collect-loot' just above, for the dynamic kill-drop
    // pickups world/enemyDrops.js spawns -- whether dropId names a real, uncollected, in-reach drop
    // is that module's own business rule, not this layer's. The cap is DROP_ID_MAX_LENGTH, the same
    // authority the outbound encounter.drops[].id leg uses: this is that exact id coming back, and
    // capping it at PICKUP_ID_MAX_LENGTH here once rejected every real minted id (see the
    // constant's own correction note).
    case 'collect-drop': {
      const dropId = requireString(raw.dropId, 'dropId', DROP_ID_MAX_LENGTH);
      if (dropId.length === 0) fail('dropId must not be empty');
      return { v: PROTOCOL_VERSION, type: 'collect-drop', dropId };
    }

    // #87: take ONE named item off a personal corpse claim. Shape validation only -- whether this
    // corpse exists, whether THIS hero holds a claim on it, and whether that item is still untaken
    // and in reach is world/corpseLoot.js's own business rule, the identical boundary 'collect-drop'
    // draws against world/enemyDrops.js.
    case 'collect-corpse-item': {
      const corpseId = requireString(raw.corpseId, 'corpseId', CORPSE_ID_MAX_LENGTH);
      if (corpseId.length === 0) fail('corpseId must not be empty');
      const claimItemId = requireString(raw.claimItemId, 'claimItemId', CORPSE_CLAIM_ITEM_ID_MAX_LENGTH);
      if (claimItemId.length === 0) fail('claimItemId must not be empty');
      return {
        v: PROTOCOL_VERSION, type: 'collect-corpse-item', corpseId, claimItemId,
      };
    }

    // #87: the `Take All` action -- every item still untaken in THIS hero's own claim on one corpse.
    // Same reasoning as 'collect-corpse-item' just above; corpseLoot.js's own requestClaimAllCorpseLoot
    // is what actually scopes this to the calling hero's own claim, never a sibling's.
    case 'collect-corpse-all': {
      const corpseId = requireString(raw.corpseId, 'corpseId', CORPSE_ID_MAX_LENGTH);
      if (corpseId.length === 0) fail('corpseId must not be empty');
      return { v: PROTOCOL_VERSION, type: 'collect-corpse-all', corpseId };
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

// The encounter block mirrors encounter.js's ordinary-enemy collection and party hero state, but
// only the fields the wire actually needs. Every ordinary enemy carries stable `enemyId` + `kind`;
// array order is presentation/transport order only and must never become identity.
//
// modeSeconds remains optional for the same presenter reason it had on the singular Wolf: a one-shot
// clip (bite/hit/death) re-entering the same mode needs to restart. gameServer.mjs's real snapshots
// populate it, while an older fixture within protocol v4 may omit it without inventing a clock.
function decodeEnemy(enemy, index) {
  const field = `encounter.enemies[${index}]`;
  if (enemy === null || typeof enemy !== 'object' || Array.isArray(enemy)) {
    fail(`${field} must be an object`);
  }

  const enemyId = requireString(enemy.enemyId, `${field}.enemyId`, ENEMY_ID_MAX_LENGTH);
  if (enemyId.length === 0) fail(`${field}.enemyId must not be empty`);
  const kind = requireString(enemy.kind, `${field}.kind`, ENEMY_KIND_MAX_LENGTH);
  if (kind.length === 0) fail(`${field}.kind must not be empty`);
  if (!ENEMY_KINDS.includes(kind)) {
    fail(`${field}.kind must be one of ${ENEMY_KINDS.join(', ')}, got ${JSON.stringify(kind)}`);
  }
  if (!ENEMY_MODES.includes(enemy.mode)) {
    fail(`${field}.mode must be one of ${ENEMY_MODES.join(', ')}, got ${JSON.stringify(enemy.mode)}`);
  }
  // Level/maxHp are E2 additions inside protocol v4. Production always sends them; an older v4
  // fixture/client that omits them remains an honest Level-1 decode rather than failing before the
  // additive field was introduced. When present, both values are strict and must agree with the
  // canonical table for THIS enemy's own kind -- a Wolf and an Ember Wolf both claiming "level 1"
  // must never be checked against one shared table (see enemyStats.js's own header on why the
  // lookup is kind-aware).
  const level = enemy.level === undefined ? 1 : requireInteger(enemy.level, `${field}.level`);
  if (!isSupportedEnemyLevel(kind, level)) {
    fail(`${field}.level is not a supported ${kind === 'wolf' ? 'Wolf' : kind} level, got ${JSON.stringify(level)}`);
  }
  const maxHp = enemy.maxHp === undefined ? enemyStatsForLevel(kind, level).maxHp
    : requireInteger(enemy.maxHp, `${field}.maxHp`);
  if (maxHp !== enemyStatsForLevel(kind, level).maxHp) {
    fail(`${field}.maxHp must match Level-${level} ${kind} stats`);
  }

  const targetId = enemy.targetId === null
    ? null
    : requireString(enemy.targetId, `${field}.targetId`);
  const decoded = {
    enemyId,
    kind,
    level,
    maxHp,
    x: requireFiniteNumber(enemy.x, `${field}.x`),
    z: requireFiniteNumber(enemy.z, `${field}.z`),
    heading: requireFiniteNumber(enemy.heading, `${field}.heading`),
    hp: requireInteger(enemy.hp, `${field}.hp`),
    mode: enemy.mode,
    targetId,
  };
  if (enemy.modeSeconds !== undefined) {
    const modeSeconds = requireFiniteNumber(enemy.modeSeconds, `${field}.modeSeconds`);
    if (modeSeconds < 0) fail(`${field}.modeSeconds must be >= 0, got ${modeSeconds}`);
    decoded.modeSeconds = modeSeconds;
  }
  return decoded;
}

function decodeEnemies(enemies) {
  if (!Array.isArray(enemies)) fail('encounter.enemies must be an array');
  if (enemies.length > ENEMY_COLLECTION_MAX_LENGTH) {
    fail(`encounter.enemies may contain at most ${ENEMY_COLLECTION_MAX_LENGTH} entries`);
  }
  const ids = new Set();
  return enemies.map((enemy, index) => {
    const decoded = decodeEnemy(enemy, index);
    if (ids.has(decoded.enemyId)) fail(`encounter.enemies contains duplicate enemyId ${JSON.stringify(decoded.enemyId)}`);
    ids.add(decoded.enemyId);
    return decoded;
  });
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
    if (hero.protectionSeconds !== undefined) {
      const protectionSeconds = requireFiniteNumber(
        hero.protectionSeconds, `encounter.heroes[${id}].protectionSeconds`,
      );
      if (protectionSeconds < 0) {
        fail(`encounter.heroes[${id}].protectionSeconds must be >= 0, got ${protectionSeconds}`);
      }
      result[id].protectionSeconds = protectionSeconds;
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
    if (reward.equippedItemIds !== undefined) {
      if (reward.equippedItemIds === null || typeof reward.equippedItemIds !== 'object'
        || Array.isArray(reward.equippedItemIds)) {
        fail(`encounter.rewards[${id}].equippedItemIds must be an object`);
      }
      decoded.equippedItemIds = Object.fromEntries(Object.entries(reward.equippedItemIds).map(
        ([slot, itemId]) => [
          requireString(slot, `encounter.rewards[${id}].equippedItemIds slot`, ITEM_ID_MAX_LENGTH),
          requireString(itemId, `encounter.rewards[${id}].equippedItemIds[${slot}]`, ITEM_ID_MAX_LENGTH),
        ],
      ));
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

// R1: kill drops -- coins, hearts, and gear scattered where an ordinary enemy fell. Optional/
// additive, the same shape decodeLoot itself uses -- absent entirely for every pre-R1 fixture and
// caller, decoding to "nothing on the ground" rather than failing.
//
// UNLIKE decodeLoot's cart pickups, a drop's own kind/position/itemId CANNOT be derived from a
// shared table both sides already own: world/cartLoot.js's CART_LOOT_TABLE is fixed and authored,
// while a kill drop's id is minted at the moment of a kill nobody could pre-author. So every field a
// presenter needs rides here, kept to the minimum world/enemyDrops.js actually needs restated
// (server-only bookkeeping -- ageSeconds past the point a presenter cares, per-life counters -- stays
// server-side, the identical boundary decodeEnemy already draws against patrol/spawn cursors).
const DROP_KINDS = ['coin', 'heart', 'gear'];
// DROP_ID_MAX_LENGTH lives with the other string caps at the top of this file -- the inbound
// 'collect-drop' decoder shares it, and the two legs of the same id must never drift apart again.
// A little above world/enemyDrops.js's own MAX_CONCURRENT_DROPS server-side cap, so the brief linger
// window a just-collected drop stays on the wire for its attraction flight (see that module's own
// COLLECTED_LINGER_SECONDS) can never itself trip this ceiling.
const MAX_WIRE_DROPS = 32;

function decodeDrop(drop, index) {
  const field = `encounter.drops[${index}]`;
  if (drop === null || typeof drop !== 'object' || Array.isArray(drop)) fail(`${field} must be an object`);
  const id = requireString(drop.id, `${field}.id`, DROP_ID_MAX_LENGTH);
  if (id.length === 0) fail(`${field}.id must not be empty`);
  const kind = requireString(drop.kind, `${field}.kind`, 16);
  if (!DROP_KINDS.includes(kind)) {
    fail(`${field}.kind must be one of ${DROP_KINDS.join(', ')}, got ${JSON.stringify(kind)}`);
  }
  const decoded = {
    id,
    kind,
    x: requireFiniteNumber(drop.x, `${field}.x`),
    z: requireFiniteNumber(drop.z, `${field}.z`),
  };
  // Only a gear drop carries a payload beyond kind/position -- a coin is always worth one coin and a
  // heart always heals the same amount (world/enemyDrops.js's own HEART_HEAL_HP), so restating either
  // on the wire would be a number free to disagree with the rule that actually pays it out.
  if (kind === 'gear') {
    const itemId = requireString(drop.itemId, `${field}.itemId`, ITEM_ID_MAX_LENGTH);
    if (itemId.length === 0) fail(`${field}.itemId must not be empty`);
    decoded.itemId = itemId;
  }
  // Present only once a hero has started collecting it -- absent for every drop still sitting on the
  // ground, the same "absent means nothing has happened yet" shape decodeLoot's own collected map
  // uses, just carried per-drop instead of in a parallel object (a drop's id is already unique, so a
  // second map keyed by the same id would be a second place for the two to disagree).
  if (drop.collectedBy !== undefined && drop.collectedBy !== null) {
    decoded.collectedBy = requireString(drop.collectedBy, `${field}.collectedBy`);
  }
  return decoded;
}

function decodeDrops(drops) {
  if (drops === undefined) return [];
  if (!Array.isArray(drops)) fail('encounter.drops must be an array');
  if (drops.length > MAX_WIRE_DROPS) fail(`encounter.drops may contain at most ${MAX_WIRE_DROPS} entries`);
  const ids = new Set();
  return drops.map((drop, index) => {
    const decoded = decodeDrop(drop, index);
    if (ids.has(decoded.id)) fail(`encounter.drops contains duplicate id ${JSON.stringify(decoded.id)}`);
    ids.add(decoded.id);
    return decoded;
  });
}

// #87: personal corpse loot -- world/corpseLoot.js's own gear claims, one corpse per loot-bearing
// kill, one claim per eligible hero, one or more items per claim (an independently-rolled ordinary
// item, a guaranteed one, or both). Optional/additive, the same shape decodeDrops itself uses --
// absent entirely for every pre-#87 fixture and caller, decoding to "no corpses on the ground" rather
// than failing.
// #87: 'coin' joined 'gear' when personal corpse loot took over the ordinary non-health reward
// receipt -- an ordinary Wolf has gearChance 0, so a gear-only claim meant the opening fight could
// never show the loot UI at all. A coin item carries an AMOUNT and no itemId; a gear item carries
// an itemId and no amount. Both are validated below rather than trusted, because this is the
// boundary a hostile or stale frame crosses.
const CORPSE_LOOT_KINDS = ['gear', 'coin'];
// A claim's coin row is a COUNT, not a stack of objects, and a count that arrives absurd is a
// frame this decoder should refuse rather than render. Sized well above any real streak-multiplied
// band (the richest table is the Alpha's 4-7 at a x3 streak) so a legitimate payout is never
// rejected.
const MAX_CORPSE_COIN_AMOUNT = 999;
// Small player counts in practice (this game's own co-op ceiling), capped generously rather than
// tied to a literal player count so a malformed frame cannot turn validation into unbounded work.
const MAX_CORPSE_CLAIMS = 8;
// A claim carries at most one guaranteed item plus one ordinary item today (requestCorpseLoot's own
// shape) -- capped a little above that so a future second guaranteed reward does not need a wire
// bump.
const MAX_CORPSE_ITEMS_PER_CLAIM = 6;
// A little above world/corpseLoot.js's own MAX_CONCURRENT_CORPSES server-side cap, the same
// headroom-over-the-server-cap relationship MAX_WIRE_DROPS keeps over enemyDrops.js's own ceiling.
const MAX_WIRE_CORPSES = 16;

function decodeCorpseItem(item, field) {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) fail(`${field} must be an object`);
  const id = requireString(item.id, `${field}.id`, CORPSE_CLAIM_ITEM_ID_MAX_LENGTH);
  if (id.length === 0) fail(`${field}.id must not be empty`);
  const kind = requireString(item.kind, `${field}.kind`, 16);
  if (!CORPSE_LOOT_KINDS.includes(kind)) {
    fail(`${field}.kind must be one of ${CORPSE_LOOT_KINDS.join(', ')}, got ${JSON.stringify(kind)}`);
  }
  if (kind === 'coin') {
    const amount = requireInteger(item.amount, `${field}.amount`);
    if (amount < 1) fail(`${field}.amount must be >= 1, got ${amount}`);
    if (amount > MAX_CORPSE_COIN_AMOUNT) {
      fail(`${field}.amount may be at most ${MAX_CORPSE_COIN_AMOUNT}, got ${amount}`);
    }
    return { id, kind, amount, guaranteed: Boolean(item.guaranteed), taken: Boolean(item.taken) };
  }
  const itemId = requireString(item.itemId, `${field}.itemId`, ITEM_ID_MAX_LENGTH);
  if (itemId.length === 0) fail(`${field}.itemId must not be empty`);
  return {
    id, kind, itemId, guaranteed: Boolean(item.guaranteed), taken: Boolean(item.taken),
  };
}

function decodeCorpseClaim(claim, field) {
  if (claim === null || typeof claim !== 'object' || Array.isArray(claim)) fail(`${field} must be an object`);
  const heroId = requireString(claim.heroId, `${field}.heroId`);
  if (heroId.length === 0) fail(`${field}.heroId must not be empty`);
  if (!Array.isArray(claim.items)) fail(`${field}.items must be an array`);
  if (claim.items.length > MAX_CORPSE_ITEMS_PER_CLAIM) {
    fail(`${field}.items may contain at most ${MAX_CORPSE_ITEMS_PER_CLAIM} entries`);
  }
  if (claim.items.length === 0) fail(`${field}.items must not be empty`);
  return {
    heroId,
    items: claim.items.map((item, index) => decodeCorpseItem(item, `${field}.items[${index}]`)),
  };
}

function decodeCorpse(corpse, index) {
  const field = `encounter.corpses[${index}]`;
  if (corpse === null || typeof corpse !== 'object' || Array.isArray(corpse)) fail(`${field} must be an object`);
  const id = requireString(corpse.id, `${field}.id`, CORPSE_ID_MAX_LENGTH);
  if (id.length === 0) fail(`${field}.id must not be empty`);
  if (!Array.isArray(corpse.claims)) fail(`${field}.claims must be an array`);
  if (corpse.claims.length > MAX_CORPSE_CLAIMS) {
    fail(`${field}.claims may contain at most ${MAX_CORPSE_CLAIMS} entries`);
  }
  return {
    id,
    x: requireFiniteNumber(corpse.x, `${field}.x`),
    z: requireFiniteNumber(corpse.z, `${field}.z`),
    claims: corpse.claims.map((claim, claimIndex) => decodeCorpseClaim(claim, `${field}.claims[${claimIndex}]`)),
  };
}

function decodeCorpses(corpses) {
  if (corpses === undefined) return [];
  if (!Array.isArray(corpses)) fail('encounter.corpses must be an array');
  if (corpses.length > MAX_WIRE_CORPSES) fail(`encounter.corpses may contain at most ${MAX_WIRE_CORPSES} entries`);
  const ids = new Set();
  return corpses.map((corpse, index) => {
    const decoded = decodeCorpse(corpse, index);
    if (ids.has(decoded.id)) fail(`encounter.corpses contains duplicate id ${JSON.stringify(decoded.id)}`);
    ids.add(decoded.id);
    return decoded;
  });
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
  if (encounter === null || typeof encounter !== 'object' || Array.isArray(encounter)) {
    fail('encounter must be an object');
  }
  const enemies = decodeEnemies(encounter.enemies);
  const decoded = {
    revision: requireInteger(encounter.revision, 'encounter.revision'),
    enemies,
    heroes: decodeHeroes(encounter.heroes),
    rewards: decodeRewards(encounter.rewards),
    loot: decodeLoot(encounter.loot),
    drops: decodeDrops(encounter.drops),
    corpses: decodeCorpses(encounter.corpses),
    village: decodeVillage(encounter.village),
    siege: decodeSiege(encounter.siege),
  };

  // C2 compatibility bridge only. main.js is still a singular-Wolf reader until C3, so decoded
  // client state exposes a derived, NON-ENUMERABLE Wolf reference. It is never present on the wire,
  // never serialized, and never a second mutable authority. C3 removes this once every presenter
  // reader is keyed by enemyId.
  const wolf = enemies.find((enemy) => enemy.kind === 'wolf') ?? null;
  Object.defineProperty(decoded, 'wolf', { enumerable: false, value: wolf });
  return decoded;
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
  enemies: Object.freeze([]),
  heroes: Object.freeze({}),
  rewards: Object.freeze({}),
  loot: Object.freeze({ spawned: false, collected: Object.freeze({}) }),
  drops: Object.freeze([]),
  corpses: Object.freeze([]),
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

export function collectDropMessage(dropId) {
  return { v: PROTOCOL_VERSION, type: 'collect-drop', dropId };
}

export function collectCorpseItemMessage(corpseId, claimItemId) {
  return {
    v: PROTOCOL_VERSION, type: 'collect-corpse-item', corpseId, claimItemId,
  };
}

export function collectCorpseAllMessage(corpseId) {
  return { v: PROTOCOL_VERSION, type: 'collect-corpse-all', corpseId };
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
