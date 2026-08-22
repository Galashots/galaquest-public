import * as THREE from '../vendor/three.module.min.js';
import { createFollowCamera } from './camera/follow.js';
import { worldDirectionForInput } from './camera/rotation.js';
import { loadHero } from './character/hero.js';
import {
  createLocomotionController,
  groundSpeedForInput,
  locomotionModeForSpeed,
} from './character/locomotion.js';
import {
  canAttack,
  canHeroAttack,
  createEncounterState,
  requestAttack,
  // GP1-C5: the hero's own down time, so the "you are coming back" bar finishes exactly when he
  // stands up. Imported rather than restated -- a bar that promises 2s while the rules take 3 is
  // worse than no bar, and this is precisely the "one number, one home" case GQ-007 names.
  RESPAWN_SECONDS,
  stepEncounter,
} from './combat/encounter.js';
import { createEncounterFeedback, heartsForHp } from './combat/feedback.js';
import { createAudioEngine } from './audio/engine.js';
import {
  CART_JOLT_RECIPE_NAME,
  COIN_PICKUP_RECIPE_NAME,
  KEEPER_GREETING_RECIPE_NAME,
  RELIGHT_RECIPE_NAME,
  SHARD_PICKUP_RECIPE_NAME,
  WORKSHOP_BUILD_RECIPE_NAME,
  BEACON_ARRIVAL_RECIPE_NAME,
  soundForEvent,
} from './audio/recipes.js';
import {
  attachBeltLantern,
  attachWildwoodBladeCandidate,
  BELT_LANTERN_URL,
  WILDWOOD_BLADE_CANDIDATE_URL,
} from './character/gear.js';
import { SHIPPING_SWORD_MESH_ID, weaponMeshIdFor, weaponVisibility, WILDWOOD_BLADE_CANDIDATE_ID }
  from './character/weaponLoadout.js';
import { MARKS_TO_UNLOCK } from './rewards/marks.js';
import {
  OFFLINE_HERO_ID,
  createLifeIdMinter,
  createOfflineProgress,
} from './rewards/offlineProgress.js';
import { DEFAULT_EQUIPPED_WEAPON_ID, DEFAULT_OWNED_ITEM_IDS, swingDamageFor } from './progression/items.js';
import { canEquip, equippedWeaponIdFromRewards, ownedItemIdsFromRewards } from './progression/state.js';
import { createHeroScreen, heroScreenViewModel, swatchHexFor } from './progression/heroScreen.js';
import { createVillageBoardScreen, villageBoardViewModel } from './village/boardScreen.js';
import { remainingVillageSupplies } from './village/economy.js';
import { pipsForMarks } from './rewards/hud.js';
import { REWARD_EVENT_TYPES, createRewardFeedback, soundForRewardEvent } from './rewards/feedback.js';
import { createMarkSparks } from './rewards/markSpark.js';
import { createImpactBursts } from './render/impactBurst.js';
import { loadGLB } from './world/assets.js';
import { createWolfPresenter, loadWolf, WOLF_SPARK_HEIGHT_METERS } from './enemies/wolf.js';
import { createSwingAnimator } from './character/swing.js';
import { createClipSwingAnimator } from './character/swingClip.js';
import { createReactionAnimator } from './character/reactClips.js';
import {
  ATTACK_REACH,
  HERO_MAX_HP,
  HERO_MAX_HP_CEILING,
  SWING_CONTACT_SECONDS,
  SWING_SECONDS,
  isWithinStrike,
  separateFromWolf,
} from './combat/encounter.js';
import { createAttackInput } from './input/attackButton.js';
import { createKeyboardInput } from './input/keyboard.js';
import { pointerModeFor } from './input/pointerMode.js';
import { createTouchInput } from './input/touch.js';
import { createCameraGesture } from './input/cameraGesture.js';
import { createDiagnostics } from './debug/diagnostics.js';
import { createNetClient } from './net/client.js';
import { createProfileStore } from './progression/profiles.js';
import { createProfileGate, profileGateViewModel } from './progression/profileGate.js';
import { foldFacts } from './progression/facts.js';
import { createRemotePlayers } from './net/remotes.js';
import { CHARACTER, WORLD } from './render/layers.js';
import { createHeroPreview } from './render/heroPreview.js';
import { createRimLight } from './render/rimLight.js';
import { createRenderer } from './render/renderer.js';
import { ndcToOverlayPixels } from './render/screenProjection.js';
import { createQualityLadder } from './render/quality.js';
import { applySky } from './render/sky.js';
import { createGround } from './world/ground.js';
import {
  KEEPER_WAVE_RADIUS_METERS,
  RELIGHT_TRIGGER_RADIUS_METERS,
  distance,
  headingToward,
  isTreeLandmark,
  lanternUnlockedFromRewards,
  loadZone,
} from './world/zoneLoader.js';
import { KEEPER_NAME, keeperSpeechState, speakKeeperLine } from './world/keeperSpeech.js';
import { ROWAN_NAME, rowanOwesBlade, rowanSpeechState } from './world/rowanSpeech.js';
import {
  RANGER_NAME, rangerIsHere, rangerOwesCharm, rangerSpeechState,
} from './world/rangerSpeech.js';
import { questObjectiveFor } from './world/quest.js';
import { destinationFor } from './world/destinations.js';
import { edgeIndicatorFor } from './ui/offscreenPointer.js';
import { createRescueWatch } from './ui/guidanceRescue.js';
import {
  BRAMBLE_EXTRA_REACH_METERS,
  bramblesCut,
  nearStandingBramble,
  nearestPointOnBramble,
  noBramblesCut,
  noTrailLightsLit,
  reachedCamp,
  strikeBrambles,
  trailLightsLit,
  wakeTrailLights,
} from './world/trail.js';
import { clampToWorldX, clampToWorldZ } from './world/bounds.js';
import {
  CART_LOOT_TABLE,
  COIN_KIND,
  PICKUP_COLLECT_RADIUS_METERS,
  SHARD_KIND,
  pickupWorldPosition,
} from './world/cartLoot.js';
import { createCartReaction, createLootPickups } from './world/lootPickups.js';
import { createWorkshopReaction } from './world/workshop.js';
// ── G2..G5: the Beacon arc ──────────────────────────────────────────────────────────────────────
//
// The rules, offline-capable and identical to the ones the server runs (world/beaconSiege.js), plus
// the three presenters and the two payoff surfaces. Same shape every system in this file already
// uses: pure rules imported here, presenters built by the zone loader, this file only wires them.
import {
  WARDEN_MAX_HP,
  addSiegeHero,
  canSiegeHeroAttack,
  createSiegeState,
  requestSiegeAttack,
  stepSiege,
} from './world/beaconSiege.js';
import {
  BLACKTHORN_BLOWS_TO_TEAR,
  createHollowState,
  nearBarrier,
  nearestPointOnBarrier,
  openChest,
  strikeBarrier,
} from './world/blackthornHollow.js';
import { bossBarState, createBossBar } from './ui/bossBar.js';
import { createUnlockCard, unlockCardState } from './ui/unlockCard.js';
import { SIEGE_EVENT_RECIPE_MAP, soundForSiegeEvent } from './audio/siegeRecipes.js';
import { WILDWOOD_BLADE_ID, damageFor, itemDef } from './progression/items.js';
import { predictionStep } from './net/prediction.js';
import * as VILLAGE from './world/zones/village.js';

// Defensive fallbacks for the online mirror, for the one frame (if any) where netStatus has
// already flipped to 'online' but onEncounter has not yet run -- see net/client.js: setStatus is
// called before onEncounter inside the same synchronous 'welcome' handler, so in practice this
// window never survives to a rendered frame. Kept anyway so a mirror read never throws.
const EMPTY_SERVER_ENCOUNTER = Object.freeze({
  revision: 0,
  wolf: Object.freeze({ x: 0, z: 0, heading: 0, hp: 0, mode: 'idle', targetId: null }),
  heroes: Object.freeze({}),
});
// The wire's hero shape (protocol.js decodeHeroes): only the four fields a client needs to
// predict its own attack button and render hearts. Matches createPartyEncounterState's freshHero
// on those same four fields.
const DEFAULT_HERO_VIEW = Object.freeze({ hp: HERO_MAX_HP, swingSeconds: -1, cooldown: 0, downSeconds: -1 });
// Shared with net/gameServer.mjs through the zone data both sides import (Phase R2, GQ-007). These
// used to be two hand-written copies of `{ x: 2.5, z: 8 }` kept equal by a human noticing, because
// gameServer.mjs is server-only and cannot be imported here -- the fix was not to import the server,
// it was to give both sides the same PURE data module to read. Used to boot the offline fallback
// below and to give the online mirror a real spawn to carry (see the frame loop's
// `netStatus === 'online'` branch and its comment).
const { WOLF_SPAWN, WOLF_SPAWNS, HERO_SPAWN } = VILLAGE;

// Phase D, offline fallback (brief D4): rewards/marks.js's foldEvents attributes a mark to whoever
// landed the hit, read off event.heroId -- but the OFFLINE solo path's events (combat/encounter.js's
// stripHeroId, the same shape createEncounter()'s old stateful surface always produced) never carry
// one, since there has only ever been exactly one hero to mean. This fixed id is stamped on before
// folding, purely locally, so the offline loop works with no server at all; it is never sent
// anywhere and never confused with a real playerId (net/gameServer.mjs's ids are `p<n>`). It DOES
// now appear inside durable mark ids (`mark:offline-hero:<lifeId>`), which is deliberate: it names
// which hero earned the mark, and offline there is exactly one. rewards/offlineProgress.js owns the
// constant so the id in the journal and the id stamped before folding cannot drift apart.
// What a device journals under when it could not mint a durable profile id (no crypto, and the
// fallback minting path also unavailable). Never sent as the wire's guestId -- see durableProfileId
// -- because a constant on the wire would collapse every such device onto one save server-side.
const SESSION_ONLY_PROFILE_ID = 'p-session-only';

// Roughly a hero's chest, so the arrow aims at a person rather than at the ground under them. The
// hero measures 1.479 m; a destination is a place on the map and has no height of its own.
const POINTER_TARGET_HEIGHT_METERS = 1.0;

const canvas = document.querySelector('#game-canvas');
const status = document.querySelector('#runtime-status');
const perfHud = document.querySelector('#perf-hud');
const attackButtonElement = document.querySelector('#attack-button');

// Y/Task F2: debug-only HUD, off by default -- see index.html's #perf-hud[data-debug] comment for
// why. Read once at startup, not reactively: this is a boot-time opt-in for a runtime-test harness's
// own navigation, not a setting a child ever toggles mid-session.
perfHud.dataset.debug = new URLSearchParams(location.search).get('debug') === '1' ? 'true' : 'false';
// #runtime-status carries the same telemetry problem and therefore the same switch, read from the
// same param in the same place -- two elements, one decision, rather than two decisions that have
// to be kept agreeing. Its fault states override this in CSS; see index.html's rule.
status.dataset.debug = perfHud.dataset.debug;

// WHICH CONTROLS THIS DEVICE GETS. Read once at startup for the same reason the debug switch is:
// a device does not grow a touchscreen mid-session, and re-deciding this on a resize would make the
// stick appear and vanish under a thumb that is already on it. input/pointerMode.js owns the rule
// and records why it is deliberately biased towards keeping the stick.
document.querySelector('#game').dataset.pointer = pointerModeFor(navigator.maxTouchPoints);

async function bootstrap() {
  const scene = new THREE.Scene();
  // Gradient sky + distance haze, both from render/sky.js. This was one flat colour and no fog,
  // which left the top 40% of a portrait frame empty and let a player standing in the wilderness
  // see the 28x28 ground plane END, with open sky under the edge of the world.
  applySky(scene);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.layers.enable(WORLD);
  camera.layers.enable(CHARACTER);
  camera.position.set(2.8, 1.8, 3.8);
  camera.lookAt(0, 0.7, 0);

  const runtimeRenderer = createRenderer(canvas, {
    onContextLost: () => { status.dataset.fault = 'true'; status.textContent = 'rendering paused — WebGL context lost'; },
    onContextRestored: () => { status.dataset.fault = 'false'; status.textContent = 'WebGL restored — hero standing'; },
  });
  const quality = createQualityLadder({
    onLevelChange: ({ level }) => {
      runtimeRenderer.setResolutionScale(level.resolutionScale);
      runtimeRenderer.resize();
    },
  });
  const diagnostics = createDiagnostics(runtimeRenderer.renderer, perfHud);
  let loadingLabel = 'hero';

  const world = createGround();
  scene.add(world);
  const rimLight = createRimLight();
  scene.add(rimLight.light, rimLight.target);

  // Phase V: the village zone, additive over the placeholder ground the same way the wolf is
  // additive over the hero -- loadZone() returns immediately with a live `counts` object (mutated
  // as each landmark/prop/the keeper settles) so a harness can poll `zoneDebug()` without waiting
  // on the whole zone, and a `ready` promise for the one consumer (the keeper's proximity
  // flourish) that needs the loaded result itself.
  const zone = loadZone(scene, VILLAGE);
  let zoneKeeper = null;
  // W2: the Lantern Tree's own relight presenter, null until the landmark's GLB settles (same
  // "await ready, degrade to null until then" shape zoneKeeper already uses).
  let zoneTree = null;
  // The three villagers, same shape again: null until the keeper's rig lands, because they are
  // clones of it.
  let zoneVillagers = null;
  // The Dark Trail's dormant lamps, in the same order VILLAGE.TRAIL_LIGHTS lists them -- so an index
  // from world/trail.js addresses the right one. Empty until the props settle, which is why the
  // trail tick below checks its length rather than assuming.
  let zoneTrailLights = [];
  // G1: the Old Beacon road's own lamps, in the order VILLAGE.BEACON_ROAD_LIGHTS lists them, and the
  // Beacon's own presenter -- both null/empty until the zone settles, the same degrade-to-nothing
  // shape every presenter above uses.
  let zoneBeaconRoadLights = [];
  let zoneOldBeacon = null;
  let zoneBeaconWaystones = null;
  // G2..G5: the arc's four presenters, all null/empty until the zone settles -- the same
  // degrade-to-nothing shape every presenter above uses. A missing one costs the beat it draws and
  // nothing else: the rules still run, the objective still counts down, the fight is still winnable.
  let zoneColdSeals = [];
  let zoneWarden = null;
  let zoneBlackthorn = null;
  let zoneHollow = null;
  let zoneBrambles = [];
  // Rowan, at the camp -- same "null until the keeper's rig lands" shape as the villagers, since
  // they are cloned off the same load.
  let zoneRowan = null;
  let zoneRanger = null;
  // GP2: the cart's own physical-acknowledgement presenter, null until its mesh exists. Not part of
  // loadZone()'s own `result` (only the keeper/tree/villagers/trailLights/brambles/rowan are handed
  // back there) -- found instead by NAME, the same way every prop instance is already addressable
  // (zoneLoader.js's loadProp names every clone `prop-${prop.model}`), so this needs no change to
  // zoneLoader.js's own return shape for one more consumer.
  let cartReaction = null;
  // GP3: the Workshop's own presenter, same "found by name, not part of loadZone()'s own result"
  // shape as cartReaction just above, and for the identical reason -- world/zones/village.js's
  // WORKSHOP_PROP is an ordinary PROPS entry, already in the scene the instant zone.ready resolves.
  let zoneWorkshop = null;
  zone.ready.then((result) => {
    zoneKeeper = result.keeper;
    zoneTree = result.tree;
    zoneVillagers = result.villagers;
    zoneTrailLights = result.trailLights ?? [];
    zoneBeaconRoadLights = result.beaconRoadLights ?? [];
    zoneBrambles = result.brambles ?? [];
    zoneOldBeacon = result.oldBeacon ?? null;
    zoneBeaconWaystones = result.beaconWaystones ?? null;
    zoneColdSeals = result.coldSeals ?? [];
    zoneWarden = result.warden ?? null;
    zoneBlackthorn = result.blackthorn ?? null;
    zoneHollow = result.hollow ?? null;
    zoneRowan = result.rowan;
    zoneRanger = result.ranger;
    const cartMesh = scene.getObjectByName(`prop-${VILLAGE.CART_PROP.model}`) ?? null;
    if (!cartMesh) {
      console.warn('[runtime] GP2: the cart prop was not found by name -- the jolt reaction is dust-only');
    }
    cartReaction = createCartReaction(scene, cartMesh);
    const workshopMesh = scene.getObjectByName(`prop-${VILLAGE.WORKSHOP_PROP.model}`) ?? null;
    if (!workshopMesh) {
      console.warn('[runtime] GP3: the Workshop prop was not found by name -- the dressing has no home');
    }
    zoneWorkshop = createWorkshopReaction(scene, workshopMesh);
  }).catch((error) => {
    console.warn('[runtime] village zone failed to finish loading', error);
  });
  const [KEEPER_X, KEEPER_Z] = VILLAGE.SPAWNS.keeper;
  const [ROWAN_X, ROWAN_Z] = VILLAGE.ROWAN.at;
  const [RANGER_X, RANGER_Z] = VILLAGE.RANGER.at;
  const [TREE_X, TREE_Z] = VILLAGE.LANDMARKS.find(isTreeLandmark)?.at ?? VILLAGE.SPAWNS.keeper;
  // The relight is a one-shot per session, and which of its two paths runs depends on whether this
  // client ever saw the tree dark -- see the frame loop's own comment where these are read.
  let sawTreeDark = false;
  let relightSpent = false;
  // The finished quest's breadcrumb: once the tree burns, the last two lanterns of the relight
  // stand at the north treeline and the quest log points at them. Walking between them is the
  // discovery, announced once per session -- there is no persistence behind this on purpose, it is
  // a "you found it" beat and not a reward that has to survive a reload.
  const [GATE_X, GATE_Z] = VILLAGE.WILDWOOD_GATE.at;
  let gateFound = false;
  // THE TREE->GATE HANDOFF. The second child playtest lost them right here: the objective chip
  // already flips to "follow the lit path north" the instant the tree lights (world/quest.js), but
  // the only thing that ever SAID it out loud was Aldric's proximity speech bubble -- gated to
  // KEEPER_WAVE_RADIUS_METERS (2 m) around a man standing 3.8 m from the tree. A child who stays at
  // the tree to watch it, which is what the ceremony is FOR, never walks back into that circle.
  // Fired once, off `isTreeLit()` turning true rather than a duplicated timer -- that is already the
  // exact frame the ceremony finishes (zoneLoader.js's tree presenter only sets `lit` at the end of
  // its update loop), and it is also the instant an already-unlocked returning guest's tree lights
  // with no ceremony at all, so one check covers both paths for free.
  let gateCallGiven = false;
  // ── the Dark Trail (Chapter 2) ───────────────────────────────────────────────────────────────
  //
  // Session-only, like gateFound and for the same reason: waking a light is a "you did this" beat,
  // not a possession. A child who comes back tomorrow gets to do it again, which is the right answer
  // for the one moment in this game where the reward IS the experience of the light arriving.
  //
  // Per-CLIENT and not on the server, deliberately. Two brothers each wake the lights for
  // themselves, so neither can walk into a trail somebody else already finished -- and it needs no
  // protocol change to say so. What they share is the world they are standing in, which is the part
  // that makes "come and see this" work.
  let trailLit = noTrailLightsLit(VILLAGE.TRAIL_LIGHTS.length);
  // G1: the Old Beacon road's own lamps, kept as a SECOND array against a SECOND coordinate
  // list rather than appended to trailLit -- see zones/village.js's TRAIL_LIGHTS/BEACON_ROAD_LIGHTS
  // split for why the two chains cannot share one list, and zoneLoader.js for the matching split on
  // the scene side. Same rule, same wake radius, same pure wakeTrailLights(): a second stretch of
  // the same road, not a second mechanic.
  let beaconRoadLit = noTrailLightsLit(VILLAGE.BEACON_ROAD_LIGHTS.length);
  let trailWoken = false;
  let campFound = false;
  // Rowan answers "who left this camp?" -- session-only, the same reasoning campFound above gives:
  // a "you did this" beat, not a possession, so a child who comes back tomorrow gets to meet them
  // again. Latched from rowanSpeech.visible below the same way questGiven latches from the Keeper's.
  let rowanMet = false;
  // The cart Rowan sends a child to search. Gated on rowanMet at the trigger site (not here) so the
  // beats land in the order Rowan's own line puts them: meet Rowan, THEN search the cart.
  let cartSearched = false;
  // G1: has this player stood at the Old Beacon. SESSION-LOCAL AND PER CLIENT, exactly like
  // gateFound, campFound, rowanMet and trailLit above it, and the choice is deliberate rather than
  // inherited: this is a "you did this" discovery beat, not a possession. Two brothers each get to
  // find it for themselves, a child who comes back tomorrow gets the arrival again, and it needs no
  // protocol change to say so. The one thing in this chain that IS server-authoritative -- the cart's
  // physical loot -- is server-authoritative because it can only be taken once; arriving somewhere
  // can be done by everybody.
  let beaconFound = false;
  // ── G2..G5: the Beacon arc's own state ────────────────────────────────────────────────────────
  //
  // THE SIEGE IS SHARED AND THE DISCOVERIES ARE NOT, and that split is the whole co-op design.
  //
  // `siegeState` is the offline fallback's own copy of the rules, advanced locally exactly the way
  // `encounterState` is -- and overwritten every online frame by the server's published block, the
  // same mirror-or-step shape the wolf already uses. Two children hitting one Warden need one health
  // bar, and that can only come from the server; a child with no server still gets the whole fight.
  let siegeState = createSiegeState({
    arena: VILLAGE.BEACON_ARENA,
    sealsAt: VILLAGE.COLD_SEALS,
    wardenAt: VILLAGE.BEACON_WARDEN.at,
    heroIds: [OFFLINE_HERO_ID],
  });
  let nextSiegeCommandId = 1;
  // ── THE BLACKTHORN AND ITS CHEST, and exactly how permanent each half is ──────────────────────
  //
  // Session-local and per client, DELIBERATELY, and the distinction is worth stating plainly because
  // "permanently open" is easy to claim and easy to get wrong:
  //
  //   the ROUTE is a "you did this" beat. Cutting the way in with a sword you earned is the whole
  //   point of the reward, and a brother who arrives tomorrow should get to cut his own way in
  //   rather than walking through a hole somebody else made. Within a session it never closes --
  //   which is the sense in which it is permanent, the same sense the trail's own bramble is.
  //
  //   the REWARD is durable and server-side (net/rewardStore.mjs's per-guest hollow cache). What a
  //   child OWNS survives everything; what a child DID is theirs to do.
  //
  // The chest's lid here is only the physical acknowledgement of that durable award, which is why
  // re-opening it after a reload costs nothing and pays nothing -- the shards are already banked.
  let hollowState = createHollowState();
  let hollowFound = false;
  let lodgeFound = false;
  // Presentation edges, all diffed rather than chased -- the same "diff the published state, do not
  // chase a transient event" discipline the cart jolt and the Workshop ceremony already use, and the
  // reason it matters here is that the siege's events ride 10 Hz snapshots while these have to be
  // right on every frame.
  let sealsSeen = VILLAGE.COLD_SEALS.map(() => ({ blows: 0, burst: false }));
  let wardenModeSeen = 'dormant';
  let beaconLitSeen = false;
  let bladeOwnedSeen = null;
  // ARC 2, and the same null-means-not-known-yet shape bladeOwnedSeen uses above and for the same
  // reason: a returning child who already brought Wren the satchel yesterday adopts that answer
  // silently on their first frame rather than being handed the moment again on every page load.
  let satchelCarriedSeen = null;
  let charmOwnedSeen = null;
  // Both asks throttled rather than one-shot, exactly like bladeRequestedAt/hollowRequestedAt.
  let satchelRequestedAt = 0;
  let charmRequestedAt = 0;
  // Whether this client has ever seen the Beacon cold. Same `sawTreeDark`/`sawWorkshopUnowned` edge
  // guard, for the identical reason: a child who connects to a world where the Beacon is already
  // burning must not be shown the ignition ceremony for a victory they never watched.
  let sawBeaconCold = false;
  // The claim is asked for at most once every half second while standing in front of Rowan, the same
  // throttle-not-a-one-shot shape the loot requests use -- and for the same reason: the first ask
  // can legitimately race the server's own view of where the hero is standing.
  let bladeRequestedAt = -Infinity;
  const BLADE_REQUEST_RETRY_MS = 500;
  let hollowRequestedAt = -Infinity;
  // GP2: whether the server has told this client the cart's own loot burst already happened, and the
  // local, DELIBERATELY LAGGED HUD totals -- see the frame loop's own comment on why these are not
  // simply `ownRewards.coins`/`.shards` read live. Seeded once from the authoritative value the first
  // frame it is known (a returning guest's own past haul must appear immediately, no flight to watch
  // for currency collected in a previous session), then only ever advanced by a pickup's own
  // attraction flight completing THIS session.
  let lootWasSpawned = false;
  // The same "only play the ceremony if this client actually watched it happen" guard sawTreeDark
  // gives the relight: a client that connects AFTER the cart was already searched must not replay the
  // jolt/dust/sound for a burst it never saw begin -- the pickups it can still see and collect are
  // real either way, only the one-time acknowledgement is gated.
  let sawCartUnspawned = false;
  // GP3: the same "have we seen the false state" edge-tracker cartReaction's own sawCartUnspawned
  // and the relight's own sawTreeDark already use -- a client connecting AFTER the Workshop was
  // already bought must not replay the transformation ceremony for something it never watched
  // happen. sawWorkshopUnowned only ever becomes true once this client has actually observed
  // workshopOwned === false; workshopWasOwned is the plain previous-frame value the edge itself is
  // read off, the same two-variable shape loot.spawned's own trigger below already uses.
  let sawWorkshopUnowned = false;
  let workshopWasOwned = false;
  // The purchase ARMS the local ceremony; the first frame the Workshop is actually on this player's
  // screen fires it -- see workshop.js's "the ceremony waits for its audience". Bought from the cart
  // clearing, 42 m up the trail, the build otherwise played to nobody.
  let workshopCeremonyPending = false;
  // GP3-C1 replaces the old once-ever proximity auto-open (see git history) with a deliberate,
  // reusable interaction -- #workshop-interact only becomes tappable, never opens anything itself.
  // Tracked here (not just read off the DOM) so renderWorkshopInteract can skip touching the element
  // on frames where nothing changed, the same discipline renderQuestObjective/renderNpcSpeech below
  // already use.
  let workshopInteractShown = false;
  let coinsDisplayed = 0;
  let shardsDisplayed = 0;
  let lootHudSeeded = false;
  // GP3: which of THIS hero's own collected pickups have already had their arrival visually land.
  // Section 5's own rule ("other connected client... may synchronize... without inventing a fake
  // local flight") means a background change to the shared total (a sibling's own collect, or a
  // Workshop purchase) should sync onto this HUD immediately, with none of GP2's causal delay --
  // but only once nothing of THIS hero's own is still mid-flight, or that would reveal this hero's
  // own not-yet-landed pickup early (the exact bug GP2's original delay exists to prevent). See the
  // frame loop's own comment where this Set is read.
  const revealedPickupIds = new Set();
  // The sequence's own closing beat, fired once the whole shared haul is gone (by anyone -- this is
  // about the AUTHORED MOMENT finishing, not about what this one hero personally carries home).
  let lootHookShown = false;
  // GP2: when this client last asked the server to collect each pickup, keyed by pickup id -- throttled
  // to once per LOOT_REQUEST_RETRY_MS while in reach, not every frame (the same "do not spam a request"
  // restraint sendAttack's own button-gating already applies to swings), but NOT a one-shot-forever gate.
  // A one-shot Set was the first version of this and it undercounted the real haul: a hero merely
  // passing near a pickup en route to a DIFFERENT one can trigger a request while still a hair outside
  // PICKUP_COLLECT_RADIUS_METERS by the time the SERVER'S OWN (authoritative, and by then slightly
  // later) position check runs -- a real race, not a bug in the check itself, since the hero keeps
  // moving during the round trip. The server correctly refuses that request, but a Set that never
  // forgets having asked then permanently stops asking again, even once the hero is standing right on
  // top of the pickup. Measured in tools/runtime-test/drive-cart-loot.mjs: a hero 0.07m from a pickup
  // still would not collect it, because an earlier, farther-away brush-past had already spent its one
  // request.
  const lootRequestedAt = new Map();
  const LOOT_REQUEST_RETRY_MS = 500;
  // The "nothing has happened" shape offline (and before the first snapshot online) collapses to --
  // same role EMPTY_ENCOUNTER plays in protocol.js, just local to this file since main.js is the only
  // consumer that ever needs a stand-in loot block.
  const EMPTY_LOOT = Object.freeze({ spawned: false, collected: Object.freeze({}) });
  // Same role, for GP3's village block -- there is no offline fallback for Village Supplies (see
  // net/gameServer.mjs's applyVillageUpgradePurchase: an ephemeral/disconnected session has no
  // durable identity to spend against), so this is what the Board reads whenever the wire has not
  // said otherwise yet.
  const EMPTY_VILLAGE = Object.freeze({ coins: 0, shards: 0, workshopOwned: false });
  // Blows landed on each black bramble, and the swing clock's value on the previous frame -- the
  // blade is judged to land on the frame that clock CROSSES contact, so the previous value is the
  // whole of the state that needs keeping.
  let brambleBlows = noBramblesCut(VILLAGE.BRAMBLES.length);
  let swingPrevious = -1;
  // Whether Keeper Aldric has actually said his piece this session. Session-only on purpose, like
  // gateFound above: it decides which of two instructions the chip shows, and a returning child with
  // marks already on the books is past it either way (see world/quest.js).
  let questGiven = false;
  // The opening hail: Aldric calls across the plaza a beat after the world settles, so the first
  // thing that happens in the game is a person, not a wait. 1.4 s is long enough for the props to
  // have popped in and the camera to have settled, short enough that nobody has started walking the
  // wrong way yet.
  const KEEPER_HAIL_DELAY_SECONDS = 1.4;
  let keeperHailed = false;
  let secondsSinceZoneReady = 0;
  // Whether an NPC's line is on screen right now (either of them -- one shared bubble), so the
  // greeting sounds once per approach and not once per frame for as long as a child stands next to
  // someone.
  let npcSpeaking = false;

  // Phase C: the audio engine is created at boot but stays silent until unlock() runs on the first
  // pointerdown below (ruling 4) -- iOS Safari will not play audio before a user gesture, and
  // engine.js's own play() is a no-op with no context to schedule against until then.
  const audio = createAudioEngine();
  // Ruling 4: the FIRST pointerdown anywhere unlocks audio, not only a tap on ATTACK -- a child's
  // first touch is usually the movement stick. A single gesture is not guaranteed to leave the
  // context running (resume() can reject or simply not settle in time), so this keeps listening
  // and retrying on every subsequent gesture until audioDebug() reports 'running', then stops --
  // engine.js's own unlock() is idempotent and skips redundant work once already running, so this
  // is belt and braces rather than the only guard.
  function tryUnlockAudio() {
    audio.unlock();
    if (audio.audioDebug().contextState === 'running') {
      window.removeEventListener('pointerdown', tryUnlockAudio);
    }
  }
  window.addEventListener('pointerdown', tryUnlockAudio, { passive: true });

  const keyboard = createKeyboardInput();
  const gameSurface = document.querySelector('#game');
  const touch = createTouchInput(
    gameSurface,
    document.querySelector('#touch-stick'),
    document.querySelector('#touch-stick-knob'),
  );
  const attack = createAttackInput(attackButtonElement);
  // THE OPENING SHOT. The camera used to default to heading 0 -- looking due north, up the empty
  // lane toward the wolf. A child's very first frame was a green field, five unlit lamp posts, and
  // the Keeper cropped in half at the bottom-right corner because the camera stood almost on top of
  // him (keeper-01-the-very-first-frame.png, before this change). The village, the Lantern Tree and
  // the man with the quest were all behind the camera.
  //
  // It now opens looking at the Lantern Tree, which is the whole premise: the child sees the dark
  // tree, the cottages around it and the Keeper beside it in the first frame, before touching
  // anything. Derived from the two placements rather than written as an angle, so moving either the
  // spawn or the tree re-aims the shot instead of silently pointing it at nothing.
  const follow = createFollowCamera(camera, {
    heading: headingToward(HERO_SPAWN.x, HERO_SPAWN.z, TREE_X, TREE_Z),
  });
  // GP1-C3: the Hero screen's showcase pass. Created HERE, before the gesture, because the gesture is
  // handed a camera it can turn, and while the Hero screen is open that is the PREVIEW's turntable,
  // not the world's follow camera -- see the adapter below.
  const heroPreview = createHeroPreview(scene, THREE);
  // Drag-to-turn, routed. While the Hero screen is open every gesture goes to the preview's own yaw
  // and the world camera is not touched AT ALL -- which is also what makes "closing Hero restores the
  // normal game camera" true by construction rather than by saving and restoring three numbers (the
  // old dolly did exactly that, and a restore is a thing that can be got wrong; not moving is not).
  // Yaw only: pitch and zoom are dropped rather than forwarded, because a preview a child can pitch
  // is a preview a child can leave aimed at the sky with no way back except closing the screen.
  const cameraTarget = {
    get heading() { return follow.heading; },
    get pitch() { return follow.pitch; },
    get distance() { return follow.distance; },
    orbit(yawDelta, pitchDelta) {
      if (heroPreview.isActive()) heroPreview.orbit(yawDelta);
      else follow.orbit(yawDelta, pitchDelta);
    },
    setDistance(next) { if (!heroPreview.isActive()) follow.setDistance(next); },
    zoomBy(factor) { if (!heroPreview.isActive()) follow.zoomBy(factor); },
  };
  // Camera gesture goes on after the thumb controls so they can veto pointers that belong to them.
  // Both are checked: without the attack half, a thumb that taps ATTACK also drags the camera, and
  // the view lurches on every swing.
  const cameraGesture = createCameraGesture(gameSurface, cameraTarget, {
    isStickPointer: (event) => touch.ownsPointer(event) || attack.ownsPointer(event),
  });

  // GP1: the Hero screen's "actual 3D equipped hero preview" (plan section 8) is the running game
  // itself -- the REAL live hero with whatever it is actually wearing -- rather than a second
  // three.js scene/renderer. A second WebGL context was considered and rejected: iOS Safari enforces
  // a small ceiling on simultaneous contexts and this game already targets real iPads, so a permanent
  // second context for an occasional overlay is a real risk for a cosmetic gain.
  //
  // GP1-C3 replaced HOW that hero is presented. It used to be "dolly `follow` in to 2.4 m and let the
  // world keep rendering underneath a transparent overlay", and that was measured broken from four
  // hostile positions in the running game -- at the Workshop and at the Lantern Tree the hero was
  // ENTIRELY invisible, the camera being inside a wall and inside a trunk respectively. It is now a
  // dedicated render pass over a cleared depth buffer (render/heroPreview.js's own header carries the
  // full before/after). Nothing dollies, so there is no saved camera to restore.
  // Equip has no session-only fallback any more. It used to keep one -- a plain `let` holding the
  // offline choice -- and that variable WAS the bug: a child who equipped a sword with no server was
  // holding the starter sword again after a refresh, because the only record of the choice was a
  // binding in this closure. The choice is now journalled the moment it is made (see onEquip below)
  // and read back from `profileState`, so offline and online differ in who ADJUDICATES, not in
  // whether the child's own decision survives.
  // Which weapon is highlighted in the owned-item strip, independent of which is actually equipped --
  // null until the child taps one, at which point heroScreenViewModel's own fallback (unowned/null
  // resolves to the equipped item) stops applying.
  let selectedHeroItemId = null;
  const touchStickElement = document.querySelector('#touch-stick');
  // GP3: forward-declared so Hero screen's own onOpenChange (defined next) can close the Village
  // Board when it opens -- the two full-screen overlays are mutually exclusive, and this is the
  // earlier-created one, so it is the one that needs a reference to the not-yet-created other. Safe
  // before assignment: onOpenChange is a callback, not run until a real click, by which point
  // villageBoard below has long since been assigned.
  let villageBoard = null;
  const heroScreen = createHeroScreen({
    onSelect: (itemId) => { selectedHeroItemId = itemId; },
    onEquip: (itemId) => {
      if (!canEquip(itemId)) return;
      // ONE act, ONE identity. The device mints the fact -- eventId and durable revision together --
      // at the moment the child chose, journals it, and then tells the server about that same fact
      // rather than asking the server to invent a second one. Both copies therefore carry the same
      // name and the same place in the order, which is what makes holding two copies a union rather
      // than a disagreement (docs/MISTAKES.md GQ-014).
      //
      // Journalled BEFORE it is sent, and sent only when there is a server: a child who equips a
      // sword with no network has equipped a sword. The send is how the server finds out, not how it
      // becomes true -- and if it never gets sent, the reconnect path below delivers it.
      const fact = profiles.mintEquipFact(profileId, itemId);
      refreshProfileState();
      if (netStatus === 'online') net.sendEquip(itemId, fact ?? undefined);
      selectedHeroItemId = itemId;
    },
    // Suspends the movement/attack thumbs (visually and for real -- pointer-events: none makes them
    // unable to originate a touch, so input/touch.js's own ownsPointer() gate never has to know Hero
    // screen exists) and hands the hero to render/heroPreview.js's showcase pass -- see input gating
    // below for the frame-loop half of this (movement/attack are also force-zeroed there, not just
    // visually hidden, so a keyboard tester or a stray event cannot move the hero while this is
    // open). The WORLD camera is deliberately left exactly where the child put it, so there is no
    // heading/pitch/distance to restore and no way for a restore to be got wrong.
    onOpenChange: (open) => {
      // GP3: opening Hero closes the Village Board first, if it was open -- see villageBoard's own
      // onOpenChange for the symmetric direction. Two full-screen overlays open at once would fight
      // over the same suspended-input/hidden-HUD attributes.
      if (open) villageBoard?.close();
      touchStickElement.dataset.suspended = String(open);
      attackButtonElement.dataset.suspended = String(open);
      // index.html's own [data-hero-screen-open] rules hide keeper-speech/quest-objective while
      // this is open -- found by looking at a real capture where the slots row and Aldric's speech
      // bubble collided at spawn, which is exactly where a child is standing the first time they'd
      // plausibly open this screen.
      gameSurface.dataset.heroScreenOpen = String(open);
      // GP1-C3: the whole 3D half of open/close is this one line. The preview takes the LIVE hero
      // (runtime.hero, not a clone), moves it onto its own render layer for as long as the screen is
      // up, and puts every layer mask back exactly on close.
      //
      // An earlier attempt at the backdrop problem, kept here because it is the trap: "hide the WORLD
      // render layer for a clean backdrop" does not work, because render/layers.js's CHARACTER layer
      // covers the wolf, remote players, the Keeper and the villagers as well as the local hero (see
      // enemies/wolf.js, net/remotes.js), not "world vs. this one hero" -- dropping WORLD left those
      // floating with no ground under them. What was missing was a layer meaning THIS hero and a pass
      // of its own to draw it in; both now exist.
      heroPreview.setActive(open, runtime.hero);
    },
  });
  // Section 7's own causal sequence: "immediate confirmation -> attention returns to 3D world ->
  // Workshop visibly transforms". Long enough that the Board's own BUILT confirmation is legible for
  // a beat first, short enough that this reads as one continuous sequence rather than a second wait.
  const WORKSHOP_BOARD_AUTOCLOSE_MS = 900;
  // GP3: the Village Board. Which node (if any) is drilled into -- null until a child taps one, the
  // same "presenter holds no selection state of its own" split selectedHeroItemId already draws for
  // the Hero screen's own strip.
  let selectedVillageNodeId = null;
  villageBoard = createVillageBoardScreen({
    onSelectNode: (nodeId) => { selectedVillageNodeId = nodeId; },
    onPurchase: (upgradeId) => {
      // No offline fallback, unlike onEquip above -- Village Supplies is server-authoritative shared
      // state with nothing local to spend against (net/gameServer.mjs's applyVillageUpgradePurchase
      // has no ephemeral path either; see its own comment). A tap while offline is silently a no-op,
      // the same posture sendCollectLoot's own online-only guard already takes for physical loot.
      if (netStatus === 'online') net.sendVillageUpgradePurchase(upgradeId);
    },
    // Same shape as Hero screen's own onOpenChange, and the same reasons for each line -- see that
    // callback's comments for touch-stick/attack-button suspension and the mutual-exclusion note.
    // No camera dolly here: the Board is a control surface, not a 3D preview (section 4's own "the
    // actual 3D Village is the reward, not this screen"), so there is nothing to hand the follow
    // camera to or restore.
    onOpenChange: (open) => {
      if (open) heroScreen.close();
      touchStickElement.dataset.suspended = String(open);
      attackButtonElement.dataset.suspended = String(open);
      gameSurface.dataset.villageBoardOpen = String(open);
    },
  });
  const player = {
    groundSpeed: 0,
    heading: 0,
    position: new THREE.Vector3(),
  };
  let locomotion = null;
  let remotes = null;
  let wolfPresenter = null;
  let swing = null;
  let reactions = null;
  follow.update(player.position);

  // Local rules, run only offline (Phase B, Task B4: online the server runs stepParty and this
  // object is overwritten every frame by a mirror of what it publishes -- see the frame loop
  // below). Kept exactly as before for the offline fallback (ruling 8): a child with no server
  // still gets the same fight this always was. Spawned ahead of the hero's start so a child walks
  // INTO the fight. 8.4m out, deliberately outside the wolf's 6m aggro range. Spawned inside it,
  // the wolf charges the instant the page loads and a young player is in a fight before they
  // have found the stick.
  // Held as published state and advanced through the seam, not as an object with methods that own
  // hidden mutable fields. Everything downstream -- the swing, the wolf presenter, the hearts, the
  // status line -- reads THIS, and none of them reach into the rules, whether it holds the local
  // step's result or the server's mirror. That is what made the move to a server-owned fight a
  // change of who calls stepParty rather than a rewrite of every reader.
  let encounterState = createEncounterState({ wolfSpawn: WOLF_SPAWN, wolfSpawns: WOLF_SPAWNS, heroSpawn: HERO_SPAWN });
  let nextCommandId = 1;
  // Online-only mirror of the server's last published encounter block (party-shaped: { revision,
  // wolf, heroes }), set from net client's onEncounter. canHeroAttack needs this exact shape --
  // heroes keyed by id -- which is why it is kept separate from `encounterState` above rather than
  // merged into it; `encounterState` itself is overwritten every online frame with the { wolf,
  // hero } view every existing consumer already reads (see the frame loop).
  let serverEncounter = null;
  // Events queued between frames by onEncounter (snapshots arrive at 10 Hz, independent of the
  // 60fps frame loop) and drained once per frame, the same shape the offline path builds locally.
  let pendingServerEvents = [];
  // Presentation-only local clock for the swing clip while online (Design ruling 3): started the
  // instant ATTACK is pressed and accepted, so the sword moves before the round trip confirms it,
  // then handed off to the server's own hero.swingSeconds (mirrored below) the moment it catches
  // up. Never read by canHeroAttack or anything that decides combat truth -- only by the one
  // swing?.update() call in the frame loop.
  let predictedSwingSeconds = -1;

  // G3/G4: the two payoff surfaces. Appended to #game after everything else so they paint over the
  // HUD -- see ui/bossBar.js and ui/unlockCard.js, which own their own markup and CSS.
  const bossBar = createBossBar(document);
  const unlockCard = createUnlockCard(document);
  gameSurface.appendChild(bossBar.element);
  gameSurface.appendChild(unlockCard.element);

  const bannerElement = document.querySelector('#banner');
  let bannerTimer = null;
  function banner(text, milliseconds) {
    bannerElement.textContent = text;
    bannerElement.dataset.shown = 'true';
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => { bannerElement.dataset.shown = 'false'; }, milliseconds);
  }

  // Hearts, not the status line's "you Nhp": see combat/feedback.js for the reference research
  // behind that choice. heartsForHp() is the only part of this worth unit testing; wiring its result
  // onto three fixed spans is not.
  const heartElements = Array.from(document.querySelectorAll('#hero-health .heart'));
  const heartsElement = document.querySelector('#hero-health');
  // How many hearts THIS body has, remembered between renders. Every renderHearts caller in the
  // frame loop knows an hp and most of them do not know a ceiling (a 'hero-healed' event carries
  // `remaining` and nothing else), so the ceiling is latched here from the one place that does know
  // it -- the published hero -- rather than threaded through every call site.
  let heartCeiling = HERO_MAX_HP;
  // What the bar is currently SHOWING, so the per-frame read in the loop repaints on a change rather
  // than rewriting four dataset attributes sixty times a second.
  let heartsShown = { hp: HERO_MAX_HP, maxHp: HERO_MAX_HP };
  function renderHearts(hp, maxHp = heartCeiling) {
    heartCeiling = Math.max(1, Math.min(HERO_MAX_HP_CEILING, Math.round(maxHp)));
    const filled = heartsForHp(hp, heartCeiling);
    heartElements.forEach((heart, index) => {
      // Pips this body has not earned are HIDDEN rather than drawn empty. An empty pip is this HUD's
      // word for "you have lost a heart", so painting a fourth empty one on a three-heart child
      // would tell them they are hurt at full health -- and the fourth simply appearing is exactly
      // how Wren's charm announces itself.
      heart.hidden = index >= heartCeiling;
      heart.dataset.filled = String(filled[index] ?? false);
    });
  }

  // The heal's own signal -- see the #hero-health[data-healing] rule in index.html. Same
  // hold-then-release shape as flashHeroHurt below; the CSS owns the fade.
  let heartPopTimer = null;
  function popHearts() {
    heartsElement.dataset.healing = 'true';
    window.clearTimeout(heartPopTimer);
    heartPopTimer = window.setTimeout(() => { delete heartsElement.dataset.healing; }, 200);
  }

  // Floating damage numbers. Until now a landed hit was only visible as the wolf's own spark
  // dimming one notch -- readable if you already know to look for it, invisible to a child watching
  // the swing land. Positioned by projecting the wolf's world position through the CURRENT camera
  // once, at the moment it pops, rather than tracked every frame for its own short life: 900ms is
  // short enough that a fixed spawn point still reads as "the hit landed there", and tracking it
  // would mean carrying a live reference into a frame loop for an effect that owes the DOM nothing
  // else, the same reasoning popHearts() above already follows.
  const damageNumbersElement = document.querySelector('#damage-numbers');
  const DAMAGE_NUMBER_LIFETIME_MS = 900;
  function popDamageNumber(worldX, worldY, worldZ, amount) {
    const projected = new THREE.Vector3(worldX, worldY, worldZ).project(camera);
    // Behind the camera: painting a number for a hit nobody's frame could show is worse than
    // skipping it -- three.js does not clip project() itself, so this is the caller's job.
    if (projected.z > 1) return;
    const rect = gameSurface.getBoundingClientRect();
    const { x, y } = ndcToOverlayPixels(projected.x, projected.y, rect.width, rect.height);
    const el = document.createElement('div');
    el.className = 'damage-number';
    el.textContent = `-${amount}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    damageNumbersElement.appendChild(el);
    // A frame between the insert and the class that starts the rise, or the browser coalesces both
    // style states into one and the number appears already risen instead of animating there --
    // the same reason a CSS transition never fires on an element's own first paint.
    window.requestAnimationFrame(() => { el.dataset.rise = 'true'; });
    window.setTimeout(() => { el.remove(); }, DAMAGE_NUMBER_LIFETIME_MS);
  }

  // Phase D (D4): three lantern-mark pips by the hearts, filling as marks arrive. Same read-only,
  // re-render-from-current-value pattern as renderHearts above -- pipsForMarks() is the only part of
  // this worth unit testing (test/rewards-hud.test.mjs); wiring its result onto three fixed spans is
  // not, the same reasoning renderHearts' own comment gives.
  const lanternPipElements = Array.from(document.querySelectorAll('#lantern-marks .mark'));
  const lanternMarksElement = document.querySelector('#lantern-marks');
  // Matches the mark-ignite / mark-pill-lift keyframes in index.html. One number, because the
  // attribute is what the animation hangs on and clearing it early cuts the animation off -- the
  // same mistake the miss pulse made against its own ring.
  const MARK_IGNITE_MS = 700;
  function renderLanternPips(marks) {
    const filled = pipsForMarks(marks);
    lanternPipElements.forEach((pip, index) => { pip.dataset.filled = String(filled[index] ?? false); });
  }

  // GP1-C6: HOW MANY MARKS THE CHILD HAS ACTUALLY BEEN SHOWN, which is not the same number as how
  // many the server says they have -- for about a second after each kill.
  //
  // The mark is awarded the instant the wolf dies, and the pip used to fill on that same frame, which
  // put it underneath the kill's own gold payoff. Two things happened at once and the smaller one, in
  // a corner, lost. So the pip now waits for the mark's own light to finish flying to the boy, and
  // lights when it arrives -- kill beat, then reward beat, which is the sequencing this lane exists
  // for. Exactly the discipline world/lootPickups.js already uses for a pickup that has not landed.
  //
  // `null` until the first frame that knows anything, so a RELOAD adopts whatever is already on the
  // books and shows it immediately: there is no light in flight to wait for, and a returning child
  // must not watch their earned marks appear one at a time.
  // Marks whose light has been launched and has not landed yet. The HUD shows everything the server
  // has credited MINUS these, so a mark appears exactly when its light reaches the boy.
  //
  // Counted rather than inferred from "is a spark alive right now", which was the first attempt and
  // was quietly wrong: reward events are dispatched further down this same frame function than the
  // pip render is, so on the frame a kill credits a mark the render ran FIRST, saw nothing in flight,
  // decided nobody was going to deliver it and filled the pip immediately -- and then the arrival a
  // second later counted it a second time. The capture said LANTERN MARK 2 / 3 next to one lit pip.
  // Incrementing in the same statement that launches the light means the two cannot disagree
  // whatever order the frame runs in.
  //
  // No timeout to clean this up, on purpose: sparkFlight has a fixed duration and update() reports
  // every completion, so the only way a launched light never lands is the frame loop stopping, and
  // then nobody is looking at the HUD anyway.
  let marksInTheAir = 0;
  let authoritativeMarksThisFrame = 0;
  function markProgressToShow(authoritativeMarks) {
    authoritativeMarksThisFrame = authoritativeMarks;
    return Math.max(0, authoritativeMarks - marksInTheAir);
  }

  // The reward beat itself, fired the frame the light lands. Everything it does is presentation: the
  // mark was already earned, already counted and already persisted a second ago.
  let markIgniteTimer = null;
  function celebrateMarkArrival(totalMarks) {
    banner(`LANTERN MARK  ${totalMarks} / ${MARKS_TO_UNLOCK}`, 1800);
    const pip = lanternPipElements[Math.min(totalMarks, lanternPipElements.length) - 1];
    // Re-triggering a CSS animation needs the attribute to actually leave and come back, which needs
    // a frame in between -- the same reason popDamageNumber waits a frame before starting its rise.
    if (pip) delete pip.dataset.justLit;
    delete lanternMarksElement.dataset.justLit;
    window.requestAnimationFrame(() => {
      if (pip) pip.dataset.justLit = 'true';
      lanternMarksElement.dataset.justLit = 'true';
    });
    window.clearTimeout(markIgniteTimer);
    markIgniteTimer = window.setTimeout(() => {
      if (pip) delete pip.dataset.justLit;
      delete lanternMarksElement.dataset.justLit;
    }, MARK_IGNITE_MS);
  }

  // GP2: the coin/shard HUD, re-rendered from whatever coinsDisplayed/shardsDisplayed currently hold
  // -- the same "read-only, paint from the current value" pattern renderHearts/renderLanternPips
  // already use. Deliberately NOT reading ownRewards.coins/.shards directly (see the frame loop's own
  // comment): those two module-level numbers are what stays gated behind a pickup's own arrival.
  const coinCountElement = document.querySelector('#coin-count');
  const shardCountElement = document.querySelector('#shard-count');
  const coinCountWrapElement = document.querySelector('#loot-hud [data-kind="coin"]');
  const shardCountWrapElement = document.querySelector('#loot-hud [data-kind="shard"]');
  function renderLootHud() {
    coinCountElement.textContent = String(coinsDisplayed);
    shardCountElement.textContent = String(shardsDisplayed);
  }
  // The brief pop the CSS keyframe plays on arrival -- a fresh data-popped="true" per pickup, cleared
  // after the animation's own duration, the same setTimeout-driven flash flashHeroHurt already uses,
  // so two pickups of the same kind landing close together each get their own pop rather than the
  // second one doing nothing because the attribute was already "true".
  const LOOT_POP_MS = 280;
  let coinPopTimer = null;
  let shardPopTimer = null;
  function popLootHud(kind) {
    const element = kind === COIN_KIND ? coinCountWrapElement : shardCountWrapElement;
    element.dataset.popped = 'false';
    window.requestAnimationFrame(() => { element.dataset.popped = 'true'; });
    const clear = () => { element.dataset.popped = 'false'; };
    if (kind === COIN_KIND) { window.clearTimeout(coinPopTimer); coinPopTimer = window.setTimeout(clear, LOOT_POP_MS); }
    else { window.clearTimeout(shardPopTimer); shardPopTimer = window.setTimeout(clear, LOOT_POP_MS); }
  }

  // W1, extended for Rowan: the ONE speech bubble, shared between the two NPCs (they stand tens of
  // metres apart and can never both be in range at once -- see the frame loop's own npcSpeech pick).
  // Text, name and shown/hidden are all driven every frame by keeperSpeechState/rowanSpeechState --
  // this function only paints whatever it was handed, the same read-only "render from current
  // value" pattern renderHearts/renderLanternPips use. The name row used to be set once at boot to
  // KEEPER_NAME; now it has to change with whoever is actually speaking.
  const keeperSpeechElement = document.querySelector('#keeper-speech');
  const keeperSpeechTextElement = document.querySelector('#keeper-speech-text');
  const keeperSpeechNameElement = document.querySelector('#keeper-speech-name');
  const keeperSpeechSpeakElement = document.querySelector('#keeper-speech-speak');
  let npcSpeechLine = null;
  let npcSpeechName = null;

  // The standing objective, same render-from-current-value discipline as the hearts and the pips.
  const questObjectiveElement = document.querySelector('#quest-objective');
  let questObjectiveLine = null;
  function renderQuestObjective(line) {
    if (line === questObjectiveLine) return;
    questObjectiveLine = line;
    questObjectiveElement.dataset.shown = String(line !== null);
    if (line !== null) questObjectiveElement.textContent = line;
  }
  // WHICH WAY TO TURN. The chip says what to do; this says where it is.
  //
  // Measured before it was written: from the spawn the Keeper is on screen at NDC (0.37, 0.25), and
  // one 200px thumb-drag -- 69 degrees -- puts him at NDC x 1.5 with the chip still reading "Talk to
  // Keeper Aldric" and nothing at all indicating which way he went.
  //
  // The DOM half of a pure/DOM split: ui/offscreenPointer.js decides where the arrow goes and which
  // way it faces and is unit tested; this does the projection, which needs a camera and therefore a
  // browser, and is proved by a harness instead.
  const objectivePointerElement = document.querySelector('#objective-pointer');
  const objectivePointerArrowElement = document.querySelector('#objective-pointer-arrow');
  const pointerTarget = new THREE.Vector3();
  const pointerForward = new THREE.Vector3();
  function renderObjectivePointer(objective, context) {
    const place = destinationFor(objective, context);
    if (!place) {
      // No objective, no place for it, or a dynamic place the caller could not supply. All three are
      // the same answer to "where do I point", which is: nowhere, so say nothing.
      objectivePointerElement.dataset.shown = 'false';
      return { pointing: false };
    }

    // BEHIND THE CAMERA IS COMPUTED, NOT INFERRED, and this is the whole reason offscreenPointer.js
    // takes it as an argument. project() performs the perspective divide without clipping, so a
    // point behind the camera comes back mirrored through the origin -- a plausible on-screen
    // coordinate pointing exactly the wrong way. The sign of the depth along the camera's forward
    // axis is the only thing that distinguishes them.
    pointerTarget.set(place.x, POINTER_TARGET_HEIGHT_METERS, place.z);
    pointerForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const behindCamera = pointerTarget.clone().sub(camera.position).dot(pointerForward) < 0;

    pointerTarget.project(camera);
    const indicator = edgeIndicatorFor({
      ndcX: pointerTarget.x,
      ndcY: pointerTarget.y,
      behindCamera,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    });

    // An arrow over a thing the child can already see is noise, and noise is how a child learns to
    // stop looking at the screen.
    objectivePointerElement.dataset.shown = String(!indicator.onScreen);
    if (indicator.onScreen) return { pointing: false };
    objectivePointerElement.style.transform = `translate(${indicator.x}px, ${indicator.y}px)`;
    objectivePointerArrowElement.style.transform = `rotate(${indicator.angle}rad)`;
    // Reported so the rescue offer can stay quiet while the errand is already in frame: see the
    // call site. A caller that only wants the arrow drawn can ignore this.
    return { pointing: true };
  }
  // OFFERING HELP, and mostly not offering it. The arrow only helps a child who looks at it.
  //
  // ui/guidanceRescue.js decides when one has stopped getting CLOSER -- not when they have stopped
  // moving, and not when they are heading away. Both of those are wrong in opposite directions: a
  // child rounding a house walks away for four seconds and is fine, and a child circling two metres
  // from the Keeper never gets far away and is completely stuck.
  //
  // `rescueTarget` is held here rather than read in the handler because the objective is recomputed
  // per frame inside the loop and a click arrives between frames. Storing the PLACE rather than the
  // objective means the tap cannot aim at an errand that has since changed.
  const guidanceRescueElement = document.querySelector('#guidance-rescue');
  const rescueWatch = createRescueWatch();
  let rescueTarget = null;
  function renderRescueOffer(offering) {
    guidanceRescueElement.dataset.shown = String(offering === true);
  }
  guidanceRescueElement.addEventListener('click', () => {
    // Turn to face it. Not walk to it, and not a camera that turns by itself: camera/follow.js says
    // the player owns the camera, so this is the one frame in the game where the game aims it, and
    // only because a child asked it to.
    if (rescueTarget) {
      follow.setHeading(headingToward(player.position.x, player.position.z, rescueTarget.x, rescueTarget.z));
    }
    // Accepting quiets the watch until real progress, not until a timer expires. A child who has
    // just been shown where to go and is now walking there must not be asked again on the way.
    rescueWatch.accept();
    renderRescueOffer(false);
  });
  function renderNpcSpeech(next) {
    keeperSpeechElement.dataset.shown = String(next.visible);
    if (next.line !== npcSpeechLine) {
      npcSpeechLine = next.line;
      keeperSpeechTextElement.textContent = next.line ?? '';
    }
    if (next.name !== npcSpeechName) {
      npcSpeechName = next.name;
      keeperSpeechNameElement.textContent = next.name ?? '';
    }
  }
  // Stops the tap from also reaching #game's own cameraGesture listener (which has no other veto
  // for this button -- see index.html's comment on this element) before wiring the real action: the
  // tap itself is the iOS user gesture that unlocks speechSynthesis, so speak() runs directly inside
  // this handler, not deferred to a later frame.
  keeperSpeechSpeakElement.addEventListener('pointerdown', (event) => event.stopPropagation());
  keeperSpeechSpeakElement.addEventListener('click', () => speakKeeperLine(npcSpeechLine));

  // GP3-C1: the Workshop's own deliberate interaction -- reuses the existing Hero/Gear screen
  // verbatim (heroScreen.open(), the exact call #hero-button's own click handler already makes
  // inside progression/heroScreen.js), so this needs no new screen, no crafting UI, nothing GP9
  // owns. Same stopPropagation discipline as #keeper-speech-speak, for the same reason: without it a
  // tap here also reaches #game's own cameraGesture listener underneath.
  const workshopInteractElement = document.querySelector('#workshop-interact');
  workshopInteractElement.addEventListener('pointerdown', (event) => event.stopPropagation());
  workshopInteractElement.addEventListener('click', () => heroScreen.open());
  function renderWorkshopInteract(shown) {
    if (shown === workshopInteractShown) return;
    workshopInteractShown = shown;
    workshopInteractElement.dataset.shown = String(shown);
  }

  // Offline fallback (brief D4): the SAME pure fold the server runs (rewards/marks.js), run locally
  // against OFFLINE_HERO_ID-stamped events, so the mark-per-kill loop works with no server at all.
  //
  // It used to be session-only, and this file argued that was honest rather than a defect. Director
  // correction 4 retired that: a same-device family save must recover a child's progression whether
  // or not a server was ever reachable, and Lantern Marks are named in the list. What a child earns
  // on a tablet with no network is now journalled like everything else -- see rewards/offlineProgress.js,
  // which also owns the reason the durable id could not just be the fold's own life index.
  // Created below, immediately after the profile store it journals into -- see the offline
  // progress block there. Declared here only so this section still reads in the order the loop
  // runs in; a `let` rather than a const because the construction genuinely happens later.
  let offlineProgress = null;

  // Belt-lantern mount state (brief D4). `lanternMounted` only ever flips true after a REAL attach
  // succeeds; a missing asset or an unloaded hero must not latch it, or a legitimately-unlocked
  // guest who reconnects before the hero mesh has finished loading would never get a retry.
  // `lanternAssetMissingLogged` is separate and DOES latch on the first 404, specifically so a
  // missing asset logs once and then stays quiet rather than warning every frame forever -- the
  // asset lands on its own track (orchestrator, Meshy) and code must not nag about it.
  let lanternMounted = false;
  let lanternMountInFlight = false;
  let lanternAssetMissingLogged = false;
  // GP1-C4: WHICH SWORD IS IN HIS HAND. Same three-variable lazy-mount shape as the belt lantern
  // directly below, and for the same reasons -- `wildwoodBladeMount` only latches after a REAL attach
  // succeeds, `inFlight` stops a second load racing the first, and the missing-asset warning latches
  // so a candidate that has not shipped is asked for ONCE. That last latch is load-bearing, not
  // cosmetic: without it a 404 leaves `inFlight` cleared and the mount still null, so the retry
  // re-fires on the very next frame and the game spends the rest of the session issuing a failing
  // fetch at 60 Hz. Warning once while refetching forever would be the worst of both.
  //
  // The shipping sword's own mount record comes straight off loadHero()'s attachRigidTier2Gear return
  // (studio/scene.js finds it the identical way for its own loadout swap) rather than being re-derived
  // from the scene graph -- one place decides what an anchor is called, and it is not this file.
  let shippingSwordMount = null;
  let wildwoodBladeMount = null;
  let wildwoodMountInFlight = false;
  let wildwoodAssetMissing = false;
  // The id this rule LAST ACTED ON, recorded rather than re-derived. equippedWeaponMeshState() below
  // needs it, and the frame loop's own `ownRewards`/`currentEquippedWeaponId` are loop-locals it
  // cannot see -- but a second copy of "online ? server rewards : offline id" living in the accessor
  // would be a second answer to the same question, free to drift from the one that actually decided
  // which anchor is visible. A harness reading a DIFFERENT id than the game used is worse than no
  // accessor at all: it would report agreement between a card and a sword that never agreed.
  let equippedWeaponIdThisFrame = DEFAULT_EQUIPPED_WEAPON_ID;
  function ensureEquippedWeaponMesh(equippedItemId) {
    equippedWeaponIdThisFrame = equippedItemId;
    if (!runtime.hero) return;
    if (weaponMeshIdFor(equippedItemId) === WILDWOOD_BLADE_CANDIDATE_ID
      && wildwoodBladeMount === null && !wildwoodMountInFlight && !wildwoodAssetMissing) {
      wildwoodMountInFlight = true;
      loadGLB(WILDWOOD_BLADE_CANDIDATE_URL).then((gltf) => {
        wildwoodMountInFlight = false;
        if (gltf.userData?.loadError) {
          if (!wildwoodAssetMissing) {
            wildwoodAssetMissing = true;
            console.warn(
              `[progression] ${WILDWOOD_BLADE_CANDIDATE_URL} is missing -- equipping the Blade still `
              + 'works and still reads DAMAGE 2; he keeps holding the Ironwood sword until the asset lands.',
            );
          }
          return;
        }
        // Mounted hidden. Which anchor is visible is decided ONLY by weaponVisibility below, every
        // frame, so there is no path where an arriving asset shows itself before the rule agrees.
        wildwoodBladeMount = attachWildwoodBladeCandidate(runtime.hero, gltf.scene);
        wildwoodBladeMount.anchor.visible = false;
      }).catch((error) => {
        wildwoodMountInFlight = false;
        console.warn('[progression] failed to mount the Wildwood Blade:', error);
      });
    }
    const visible = weaponVisibility({ equippedItemId, candidateMounted: wildwoodBladeMount !== null });
    if (shippingSwordMount) shippingSwordMount.anchor.visible = visible.shipping;
    if (wildwoodBladeMount) wildwoodBladeMount.anchor.visible = visible.candidate;
  }

  function ensureLanternMounted(shouldBeUnlocked) {
    if (!shouldBeUnlocked || lanternMounted || lanternMountInFlight || !runtime.hero) return;
    lanternMountInFlight = true;
    loadGLB(BELT_LANTERN_URL).then((gltf) => {
      lanternMountInFlight = false;
      if (gltf.userData?.loadError) {
        if (!lanternAssetMissingLogged) {
          lanternAssetMissingLogged = true;
          console.warn(
            `[rewards] ${BELT_LANTERN_URL} is missing -- marks and the unlock state still work; `
            + 'the belt stays bare until the asset lands.',
          );
        }
        return;
      }
      attachBeltLantern(runtime.hero, gltf.scene);
      lanternMounted = true;
    }).catch((error) => {
      lanternMountInFlight = false;
      console.warn('[rewards] failed to mount the belt lantern:', error);
    });
  }

  // Phase D (D6): "observable without hearing it" (see audioDebug's own comment on runtime, below)
  // applied to reward events -- mark-earned/lantern-unlocked carry no sound and no banner for the
  // former, so a harness has no OTHER way to confirm the event itself was heard and dispatched
  // rather than merely inferring it from the derived pip count, which could be right for the wrong
  // reason. Append-only for the session; runtime.rewardEvents() hands back a copy.
  const rewardEventLog = [];

  // The visible half of a Lantern Mark: a warm spark that lifts off the beaten wolf and flies to
  // the hero's belt. See rewards/markSpark.js.
  const markSparks = createMarkSparks(scene);
  // GP1-C5: the thing that appears where a blow lands -- a hard shockwave ring for a hit, a wide
  // soft bloom for a kill. See render/impactBurst.js for why the wolf's own material flash could
  // not carry that job on its own.
  const impactBursts = createImpactBursts(scene);

  // GP2's own physical loot -- built immediately (unlike cartReaction above, this needs no loaded
  // GLB, only CART_SEARCH.at, which is plain data) but stays invisible until world/cartLoot.js's own
  // `spawned` flag says the cart has actually been searched; see lootPickups.js's own header.
  const lootPickups = createLootPickups(scene, VILLAGE.CART_SEARCH.at);

  // Who is playing, and the device's own durable copy of what they have earned. Created before the
  // socket because the profile id IS what identifies this child on the wire: it travels in the
  // guestId field (it is minted in that alphabet on purpose), so the server needs no change and
  // PROTOCOL_VERSION stays where it is. A device that has only the old gq-guest-id migrates on this
  // first read, reusing that string verbatim as the profile id, so every reward row already on the
  // server stays attached without a backfill.
  const profiles = createProfileStore();
  // A hero named in the URL wins over whatever this device last had active. `.../?hero=Sam` is
  // Sam's link -- the README's own "players join by URL" model, applied to a shared tablet -- and
  // following it must put Sam's save on screen rather than the last child's. Done BEFORE the id is
  // read, because it can change which profile is active. Unusable or unhonourable names return null
  // and fall through to the ordinary gate.
  try {
    const wanted = new URLSearchParams(window.location.search).get('hero');
    if (wanted) profiles.adoptNamedHero(wanted);
  } catch (error) {
    console.warn('[profiles] could not read the hero from the URL:', error?.message ?? error);
  }
  // The DURABLE id, or null when a device could not mint one at all. Only this may go on the wire:
  // it is what ties a child to their rows in the server's store.
  const durableProfileId = profiles.activeProfileId();
  // What this session JOURNALS under. Falls back to a session-only id so a device that could not
  // mint a durable one still plays a coherent session -- equip, marks and inventory all work, they
  // simply are not there next time. Deliberately NOT sent as the guestId: a fixed fallback id on the
  // wire would make every such device share one save on the server.
  const profileId = durableProfileId ?? SESSION_ONLY_PROFILE_ID;
  const profileName = profiles.activeProfile()?.displayName ?? 'player';

  /**
   * This device's own folded copy of the active profile's durable state.
   *
   * A CACHE of the journal and never a second authority -- every write path recomputes it from
   * storage rather than mutating it in place, so the two cannot drift. That distinction is the whole
   * GQ-014 lesson: a number kept alongside the record it is derived from eventually disagrees with
   * it. It exists only because the frame loop reads the equipped weapon every frame and folding a
   * JSON journal sixty times a second would be real work for a value that changes when a child taps
   * a button.
   *
   * Shaped exactly like the wire's own rewards block (progression/facts.js's foldFacts says why), so
   * the offline and online branches below feed one renderer rather than two.
   */
  let profileState = foldFacts([], {
    equippedWeaponId: DEFAULT_EQUIPPED_WEAPON_ID,
    ownedItemIds: DEFAULT_OWNED_ITEM_IDS,
  });

  function refreshProfileState() {
    profileState = profiles.stateFor(profileId);
    return profileState;
  }
  refreshProfileState();

  // The offline reward loop, built HERE because it journals into the profile above and reads the
  // durable count back to decide the lantern -- so it cannot exist before the profile does. It was
  // first written further up, beside the frame-loop code that drives it, and that was a temporal
  // dead zone: `profiles` is not initialised until this point and the page failed to boot with
  // "Cannot access 'profiles' before initialization". Nothing under test/ loads main.js, so the
  // unit suite could not see it; the browser found it on the first load.
  offlineProgress = createOfflineProgress({
    profiles,
    profileId,
    // Unique across page loads, not merely within one. See createLifeIdMinter: on the LAN http the
    // tablets actually use, crypto.randomUUID is absent, and a counter there would recompute an id
    // the journal already holds and silently swallow the first kill after every refresh.
    mintLifeId: createLifeIdMinter(),
  });

  // ── WHO IS PLAYING ───────────────────────────────────────────────────────────────────────────
  //
  // A shared tablet with per-child saves needs a place to say which child this is. Everything under
  // progression/ already keeps two siblings apart; without this the answer was decided silently by
  // whatever localStorage happened to hold, which is fine for one child and wrong for two.
  //
  // SWITCHING RELOADS THE PAGE, deliberately. The profile id IS the wire's guestId and it is read
  // once at bootstrap, so changing it mid-session would mean re-joining under a new identity while
  // a fully built world, an open socket, a prediction buffer and a frame loop all still hold the old
  // one. A reload is the only way to be certain nothing keeps a stale half of the previous child --
  // and it costs a second on a game with no build step. It also gets the ceremony question right for
  // free: the new session HYDRATES from the journal rather than replaying, so a sibling who already
  // lit the lantern does not watch it be unlocked again (docs/MISTAKES.md, "Hydration restores
  // state; it must not replay the ceremony that created it").
  //
  // Renaming does NOT reload: the id never moves, so nothing about the session is stale. That
  // asymmetry is the id/name split made visible -- see progression/profiles.js's renameProfile.
  const profileChipElement = document.querySelector('#profile-chip');

  function heroesForGate() {
    // Each sibling's own folded state, so the cards can say how far each has got. Read here rather
    // than in the view model because deriving it means touching storage, and that half is pure.
    return profiles.listProfiles().map((profile) => ({
      id: profile.id,
      displayName: profile.displayName,
      ...profiles.stateFor(profile.id),
    }));
  }

  function gateView() {
    return profileGateViewModel({
      heroes: heroesForGate(),
      activeProfileId: profileId,
      // Asked once, on a device whose only hero has never been given a name. A returning child gets
      // the chooser; a brand-new one gets the question, because a list of one is not a choice.
      namingFirstHero: profiles.listProfiles().length <= 1
        && profiles.activeProfile()?.onboarding?.named !== true,
    });
  }

  function paintProfileChip() {
    if (profileChipElement) {
      profileChipElement.textContent = profiles.activeProfile()?.displayName ?? 'Hero';
    }
  }

  function switchToProfile(profileId_) {
    profiles.selectProfile(profileId_);
    // Reload WITHOUT the `hero` parameter, and this is not tidiness -- it is the difference between
    // the switch working and silently not happening. `?hero=Sam` is adopted on every boot, so a
    // plain reload would re-select Sam and undo the choice the child just made. The gate would look
    // like it did nothing, forever, for anyone who followed a named link.
    //
    // Only `hero` is dropped; anything else in the query is somebody's and stays.
    let target = null;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('hero');
      target = url.toString();
    } catch {
      target = null;
    }
    if (target && target !== window.location.href) window.location.replace(target);
    else window.location.reload();
  }

  const profileGate = createProfileGate({
    onSelect: (id) => {
      // Choosing the hero already playing is not a switch; closing is the honest response to it, and
      // reloading would make a child who tapped their own card watch the game restart for nothing.
      if (id === profileId) {
        profiles.setFlags(id, { onboarding: { named: true } });
        profileGate.close();
        return;
      }
      switchToProfile(id);
    },
    onCreate: (displayName) => {
      try {
        const created = profiles.createProfile(displayName);
        profiles.setFlags(created.id, { onboarding: { named: true } });
        switchToProfile(created.id);
      } catch (error) {
        // The only real cause is the MAX_PROFILES cap, which the gate already refuses to offer a
        // button for -- so reaching here means the view and the store disagreed. Re-render from the
        // store, which is the side that is right.
        console.warn('[profiles] could not create a hero:', error?.message ?? error);
        profileGate.render(gateView());
      }
    },
    onRename: (id, displayName) => {
      profiles.renameProfile(id, displayName);
      // Named, so the gate stops asking. Recorded against the profile rather than in a variable
      // here for the obvious reason: the question must not come back on the next page load.
      profiles.setFlags(id, { onboarding: { named: true } });
      paintProfileChip();
      profileGate.render(gateView());
      profileGate.close();
    },
    onDelete: (id) => {
      profiles.deleteProfile(id);
      // Deleting the hero currently playing leaves this session holding an id with no profile and no
      // journal behind it, which is not a state to keep rendering from -- reload into whoever is
      // left, or into the naming question if that was the last one.
      if (id === profileId) {
        window.location.reload();
        return;
      }
      profileGate.render(gateView());
    },
    onOpenChange: (open) => {
      // The same input-suspend contract the other two overlays have. Movement and attack must not
      // be drivable behind a screen that is asking whose game this is.
      touchStickElement.dataset.suspended = String(open);
      attackButtonElement.dataset.suspended = String(open);
      // And the same HUD-hiding attribute, for a reason a capture made obvious: a dimmed backdrop
      // still leaves the hearts and the objective looking tappable, and behind a modal they are not.
      gameSurface.dataset.profileGateOpen = String(open);
      if (open) {
        heroScreen.close();
        villageBoard?.close();
      }
    },
  });

  paintProfileChip();
  profileChipElement?.addEventListener('click', () => {
    profileGate.render(gateView());
    profileGate.open();
  });

  // A brand-new hero is asked their name before anything else. Not gated on the socket or the
  // world: the question is answerable while the village is still loading, and a child staring at a
  // half-built village with no idea what to do is the failure this whole checkpoint is about.
  if (gateView().mode === 'naming') {
    profileGate.render(gateView());
    profileGate.open();
  }

  /**
   * Write a durable fact into this device's own journal as it is announced.
   *
   * The server is still the one that DECIDES a mark was earned -- this only keeps a second copy of
   * the decision, under the same id the server used, so a family's progress does not live solely in
   * a database that can be wiped or replaced (progression/facts.js's union law is what makes two
   * copies safe rather than ambiguous). Events that predate the id riding the wire simply carry no
   * eventId and are skipped: a fact with no stable name cannot be deduplicated, and guessing one
   * would be worse than not recording it.
   */
  function journalDurableFact(event) {
    if (typeof event?.eventId !== 'string') return;
    profiles.recordFacts(profileId, [{
      eventId: event.eventId,
      type: event.type,
      // Carried when the event has one. A gear-owned fact is worthless without knowing WHICH gear,
      // and dropping it here would journal an item the fold cannot name.
      ...(typeof event.value === 'string' ? { value: event.value } : {}),
    }]);
    // The cache is derived, so it is recomputed rather than incremented -- see profileState. An
    // offline mark has already refreshed it by this point; an ONLINE one has not, and without this
    // a child who plays online and then loses the network would drop back to a stale count.
    refreshProfileState();
  }

  // Phase D (D4): mark-earned/lantern-unlocked are never raised by combat/encounter.js, so they can
  // never enter createEncounterFeedback's table (see rewards/feedback.js's header for why that is a
  // hard boundary, not an oversight) -- this is their own dispatcher, same discipline.
  const onRewardEvent = createRewardFeedback({
    // Pips are re-rendered directly from the current mark count every frame below, the same way
    // hearts are re-rendered from event.remaining above; nothing extra needed per-event.
    // The banner AND the spark are what tell the child a wolf was worth something -- the pip alone
    // is 1.1rem of dot in a corner they are not looking at while a wolf is biting them. The spark
    // lifts off wherever the wolf went down (its last published position, read here rather than at
    // dispatch time so it is the position the child just watched it die at) and flies to the belt.
    'mark-earned'(event) {
      rewardEventLog.push(event);
      // GP1-C6: NO BANNER HERE ANY MORE. This fires on the same frame as wolf-defeated, so the two
      // announcements used to overwrite each other -- "The wolf is beaten!" appeared and was replaced
      // by "Lantern Mark!" before it could be read, and both landed under the kill's own gold burst.
      // The reward now speaks when its light arrives, about a second later, with the frame to itself.
      // See celebrateMarkArrival.
      marksInTheAir += 1;
      markSparks?.launch({ x: encounterState.wolf.x, z: encounterState.wolf.z });
    },
    // Says what to DO, not what changed state. "Lantern unlocked!" was accurate and useless: it
    // fires out at the wolf, 18 m from the tree, and the child's next question is "now what".
    'lantern-unlocked'(event) {
      rewardEventLog.push(event);
      banner('All three marks! Take them home.', 3200);
    },
    // Currency: DURABILITY ONLY, no ceremony. The pickup's own burst, sound and loot-HUD count
    // already told the child what happened, and every one of those is diffed off the rewards block
    // as before. These handlers exist so the fact is journalled under the store's own id by the
    // dispatch loop below -- a count cannot be journalled, only a named fact can. They are present
    // rather than absent because createRewardFeedback throws at construction for a missing handler,
    // which is the guarantee that a new reward type cannot be half-added.
    'coin-earned'(event) { rewardEventLog.push(event); },
    'shard-earned'(event) { rewardEventLog.push(event); },
    // Gear, satchel and charm: durability only, for the same reason as currency. Each already has
    // its own ceremony fired by DIFFING the rewards block -- the Blade's unlock card, the satchel
    // lift, Wren's fourth heart -- and those diffs are what make a beat survive a reconnect without
    // replaying, so nothing here may fire one. What these add is the NAMED fact, journalled by the
    // dispatch loop under the id the store wrote it with.
    'gear-owned'(event) { rewardEventLog.push(event); },
    'satchel-taken'(event) { rewardEventLog.push(event); },
    'charm-earned'(event) { rewardEventLog.push(event); },
  });

  // The gap that mattered most: previously a bitten hero got no feedback at all. See
  // combat/feedback.js for the "damage vignette" reference; the fade-out lives in index.html's CSS
  // transition on #hero-hurt-flash, so this only needs to hold it open for a beat before releasing it.
  const heroHurtFlashElement = document.querySelector('#hero-hurt-flash');
  let heroHurtTimer = null;
  function flashHeroHurt() {
    heroHurtFlashElement.dataset.shown = 'true';
    window.clearTimeout(heroHurtTimer);
    heroHurtTimer = window.setTimeout(() => { heroHurtFlashElement.dataset.shown = 'false'; }, 90);
  }

  // GP1-C5: going down is a STATE the whole screen enters, not a line of text. See #hero-down-veil
  // in index.html for why it is deliberately not the red the hurt flash uses, and why the bar is the
  // half that stops a dark screen from reading as a crash.
  const heroDownVeilElement = document.querySelector('#hero-down-veil');
  heroDownVeilElement.style.setProperty('--hero-down-seconds', `${RESPAWN_SECONDS}s`);
  function showHeroDown(down) {
    heroDownVeilElement.dataset.shown = String(down);
  }

  // A whiff pulses the attack button instead of touching the wolf at all -- see combat/feedback.js.
  let missPulseTimer = null;
  function pulseMiss() {
    attackButtonElement.dataset.feedback = 'miss';
    window.clearTimeout(missPulseTimer);
    // Matches the miss-ring keyframe duration in index.html: the attribute is what the animation
    // hangs on, so clearing it early (it was 160, against a 320ms ring) cut the ring off halfway out
    // and left the pulse looking like a flicker rather than a throw. 420 now, with the ring holding
    // full strength for the first 45% of it -- see that keyframe's own comment.
    missPulseTimer = window.setTimeout(() => { delete attackButtonElement.dataset.feedback; }, 420);
  }

  // One place where a rule event becomes something a young player can see. Kept separate from the
  // rules on purpose: encounter.js must stay importable by a node server with no DOM. Built with
  // createEncounterFeedback() so a new event type raised by encounter.js throws here at startup
  // instead of being silently dropped the way every event but three used to be -- see
  // combat/feedback.js and feedback.test.mjs.
  const onEncounterEvent = createEncounterFeedback({
    // The arm swing already playing is the feedback for a swing starting; nothing else needed yet.
    swing() {},
    'swing-missed'() { pulseMiss(); },
    // Going down mid-swing already produces the hurt flash and the "You went down" banner from the
    // same frame's hero-hurt/hero-down events. The dropped swing needs no extra signal of its own;
    // it is declared here because the dispatcher requires every event to be accounted for, and that
    // requirement is the point -- it is how this event announced itself instead of vanishing.
    'swing-dropped'() {},
    'wolf-hit'(event) {
      wolfPresenter?.flashHit();
      // GP1-C5: the ring, at the same point on the wolf the damage number is already anchored to, so
      // the three signals for one blow (flash, ring, number) all land in the same place instead of
      // scattering the child's eye across the frame.
      impactBursts.burst({
        x: encounterState.wolf.x, y: WOLF_SPARK_HEIGHT_METERS, z: encounterState.wolf.z, kind: 'hit',
      });
      // event.damage, not a hardcoded 1 -- see WOLF_DAMAGE_PER_HIT's own comment in encounter.js.
      popDamageNumber(encounterState.wolf.x, WOLF_SPARK_HEIGHT_METERS, encounterState.wolf.z, event.damage);
    },
    // GP1-C5: the kill is a COMPOSITION, and the pieces were always here -- they just never added up
    // to one moment. Same frame: the defeat flash turns the wolf the colour of the light it stole
    // (not the white a plain hit uses), a ring of that same light blows outward far wider and slower
    // than a hit's, the wolf's own spark goes out, and the death clip starts. A beat later
    // mark-earned launches that light to the boy's belt and says so. Nothing here is new machinery;
    // what changed is that a kill no longer looks like the hit before it.
    'wolf-defeated'() {
      wolfPresenter?.flashDefeated();
      impactBursts.burst({
        x: encounterState.wolf.x, y: WOLF_SPARK_HEIGHT_METERS, z: encounterState.wolf.z, kind: 'kill',
      });
      banner('The wolf is beaten!', 1800);
    },
    // The flinch is gated on the swing state at dispatch time: the owner's precedence rule (2026-08-13)
    // is that attack wins and a hit only shows when the testers are not attacking. reactClips.js
    // refuses the trigger itself (and is null until the rig actually ships hit/death clips), so
    // the flash and hearts here remain the guaranteed feedback either way.
    'hero-hurt'(event) {
      flashHeroHurt();
      renderHearts(event.remaining);
      reactions?.triggerHit({ swinging: swing?.isSwinging() === true });
    },
    // The wolf's jaws visibly close on nothing; that already reads without extra feedback.
    'bite-missed'() {},
    // The banner says it; the veil and the filling bar are what a child who is not reading gets.
    'hero-down'() { showHeroDown(true); banner('You went down…', 1600); },
    'hero-respawned'() { showHeroDown(false); renderHearts(heartCeiling); banner('Back on your feet', 1200); },
    // Beating a wolf gives a heart back. No banner: wolf-defeated's "The wolf is beaten!" is already
    // on screen from the same frame, and a second banner would replace it mid-read. The hearts row
    // popping IS the message, and it points at exactly the thing that changed.
    'hero-healed'(event) { renderHearts(event.remaining); popHearts(); },
    // the owner's ruling, 2026-08-13: WOLF_RESPAWN_SECONDS after a kill, the wolf is back. No presenter
    // consumer yet -- wolfPresenter?.update() already reads wolf.mode/hp off encounterState every
    // frame and draws whatever it finds, so the wolf reappearing needs no push here. Declared
    // (rather than left off the table) for the same reason every other event is: the dispatcher
    // throws at startup on a gap instead of silently dropping an event during a fight.
    'wolf-respawned'() {},
  });
  // Paint from the encounter's own starting hp rather than trusting the markup's default -- the
  // markup only needs to be right until this line runs.
  renderHearts(encounterState.hero.hp);
  renderLanternPips(0);

  // Party events (Task B1) carry heroId; a solo consumer table like onEncounterEvent's above
  // expects the old heroId-less shape. wolf-hit/wolf-defeated apply "regardless of who landed
  // them" (B4 brief) -- every hero's presenter should flinch or celebrate together -- and
  // bite-missed never carries a heroId at all (nobody was hit), so it is inherently everyone's.
  // wolf-respawned is the same shape as bite-missed (encounter.js pushes it with no heroId --
  // nobody in particular caused a respawn), so it belongs in this set for the same reason.
  // Everything else (swing, swing-missed, swing-dropped, hero-hurt, hero-down, hero-respawned) is
  // filtered to the local hero: a sibling's swing must not flash this child's own hurt vignette.
  const GLOBAL_ENCOUNTER_EVENT_TYPES = new Set(['wolf-hit', 'wolf-defeated', 'bite-missed', 'wolf-respawned']);

  // G2/G3: which drained server events belong to the Beacon siege rather than to the wolf.
  //
  // They ride the SAME snapshot array (net/gameServer.mjs pushes both fights' events into one
  // pending list, in the order they happened), so they have to be separated here before the wolf's
  // own dispatcher sees them -- combat/feedback.js's table is pinned by test to exactly the events
  // combat/encounter.js raises, so handing it a `seal-burst` would be a console error every time a
  // child hit a seal.
  //
  // hero-down / hero-respawned / hero-healed are DELIBERATELY ABSENT from this set even though the
  // siege raises them too: they mean exactly the same thing in both fights (this hero's hearts), the
  // wolf's dispatcher already does exactly the right thing with them, and a hero has one set of
  // hearts whichever fight knocked them over.
  const SIEGE_EVENT_TYPES = new Set([
    'seal-cracked', 'seal-burst', 'warden-woke', 'warden-hit', 'warden-defeated', 'warden-hurt-hero',
    'warden-phase', 'beacon-ignited', 'siege-reset',
    'siege-swing', 'siege-swing-missed', 'siege-swing-dropped',
  ]);
  // Filled at the drain below, read once per frame by the siege block in the trail section -- the
  // same queue-between-frames shape pendingServerEvents itself uses, and for the same reason: the
  // drain happens inside the hero guard and the siege block deliberately runs outside it.
  let pendingSiegeEvents = [];
  // Events raised by the siege that are ALSO the hero's own (the three named above), collected here
  // so the trail section can hand them back to the wolf's dispatcher rather than dropping them.
  const isOwnSiegeEvent = (event, ownHeroId) => event.heroId === undefined || event.heroId === ownHeroId;
  function stripHeroId(event) {
    if (!('heroId' in event)) return event;
    const { heroId, ...rest } = event;
    return rest;
  }

  // Multiplayer is additive: the socket is never awaited, and every failure path leaves a playable
  // single-player game. A child on a phone with no server still gets a hero that walks.
  let netStatus = 'offline';
  let lastReconcile = { drift: 0, snapped: false };
  /**
   * The reconnect contract, run on EVERY welcome rather than only the first -- a reconnect is a
   * fresh join, and whatever the device missed while it was away arrives here.
   *
   * Two halves, in this order, and the order is the point:
   *
   * 1. Ingest. progression/profiles.js journals every fact the server knows and settles each one's
   *    revision durably before deriving. Local progression must not mint above history it has not
   *    written down yet, or a new choice gets numbered beneath an old one it was told about in this
   *    very message (docs/MISTAKES.md GQ-014).
   *
   * 2. Restore what the server has not got. A child who played offline holds marks, gear and a
   *    weapon the server never saw; it is about to publish a rewards block saying otherwise and
   *    silently take them back. The ORIGINAL facts are sent, identities and revisions intact, so the
   *    server records what the child actually did at the moment they did it -- and because every
   *    fact carries its own id, a resend is an INSERT OR IGNORE no-op rather than a second earning.
   *
   *    The whole missing set rather than just the equip, and that is not thoroughness for its own
   *    sake: net/gameServer.mjs refuses an equip for a weapon the guest does not own, so against a
   *    store that has lost this profile, sending the choice without the ownership it depends on is
   *    rejected and the hero snaps back to a weapon the child stopped holding. The two have to
   *    arrive together, which is why this is one message and not a sequence of them.
   */
  function ingestWelcome(message) {
    const serverFacts = Array.isArray(message?.profileFacts) ? message.profileFacts : [];
    profileState = profiles.ingestServerFacts(profileId, serverFacts);

    // Everything this device holds that the server does not. Empty on an ordinary reconnect to a
    // store that still knows this child, so the common case sends nothing at all.
    const knownToServer = new Set(serverFacts.map((fact) => fact.eventId));
    const missing = profiles.journalFor(profileId).filter((fact) => !knownToServer.has(fact.eventId));
    // Only worth sending when this device HAS a durable identity. Without one the server treats the
    // connection as ephemeral and refuses the restore outright -- correctly, it has no profile to
    // restore into -- so an unguarded send would push the device's whole journal on every single
    // reconnect, forever, to be thrown away every time. Harmless per message and wasteful in the
    // exact situation that produces it: a device whose storage is failing, reconnecting repeatedly.
    if (durableProfileId && missing.length > 0) net.sendRestoreProfile(missing);
  }

  const net = createNetClient({
    name: profileName,
    // Only a DURABLE id goes on the wire -- see profileId's own comment for why the session-only
    // fallback must not.
    guestId: durableProfileId ?? undefined,
    onStatus: (next) => { netStatus = next; },
    onWelcome: (message) => ingestWelcome(message),
    onLeave: (id) => remotes?.remove(id),
    // Snapshots arrive at 10 Hz on their own schedule, independent of the frame loop, so the
    // block is captured here and the events queued; the frame loop mirrors/drains both once per
    // frame (Task B4) rather than reacting mid-frame to a message event.
    onEncounter: (encounter, events) => {
      serverEncounter = encounter;
      if (events.length > 0) pendingServerEvents.push(...events);
    },
  });

  const runtime = {
    scene,
    camera,
    follow,
    keyboard,
    touch,
    cameraGesture,
    locomotion: () => locomotion,
    // The published state, not a handle on the rules. A harness that could call requestAttack() on
    // this object could drive the fight down a path no child can reach; reading state cannot.
    encounterState: () => encounterState,
    wolf: () => wolfPresenter,
    net,
    remotes: () => remotes,
    netState: () => ({
      status: netStatus,
      selfId: net.selfId,
      remoteCount: remotes?.count ?? 0,
      remotes: remotes?.describe() ?? [],
      serverSelf: net.serverSelf,
      snapshots: net.snapshotCount,
      drift: lastReconcile.drift,
      snapped: lastReconcile.snapped,
      url: net.url,
    }),
    player,
    renderer: runtimeRenderer.renderer,
    rimLight,
    diagnostics,
    quality,
    scene,
    world,
    hero: null,
    contextLost: () => runtimeRenderer.contextLost,
    // Ruling 6: the same "observable without hearing it" pattern encounterState() already gives
    // harness probes for combat truth, now for sound.
    audioDebug: () => audio.audioDebug(),
    // Phase D (D6): the same "published state, not a handle on the rules" pattern encounterState()
    // uses -- online, the wire's own encounter.rewards (net/protocol.js decodeRewards); offline, the
    // local D1 fold's own two numbers, keyed the same shape so a harness can read one property path
    // regardless of mode. lanternMounted() is a plain boolean, not derived from the scene graph, so
    // a harness does not need to know gear.js's node-naming convention to ask "did it mount".
    rewards: () => (netStatus === 'online'
      ? (serverEncounter?.rewards ?? {})
      : { [OFFLINE_HERO_ID]: profileState }),
    lanternMounted: () => lanternMounted,
    // GP1: "observable without seeing it" once more (see zoneKeeperState's own comment for the
    // pattern) -- a harness can confirm the Hero screen actually opened/closed and read what it is
    // currently showing, without screenshotting to prove a boolean.
    heroScreenOpen: () => heroScreen.isOpen(),
    heroScreenEquippedWeaponId: () => equippedWeaponIdFromRewards(netStatus === 'online'
      ? (net.selfId !== null ? serverEncounter?.rewards?.[net.selfId] : null)
      : profileState),
    // GP1-C3: the showcase pass's own state -- whether it is drawing, which accent the equipped
    // weapon put on its kickers, the framing it solved for this viewport, and the live hero's bounds
    // PROJECTED THROUGH THE PREVIEW CAMERA into normalized screen space. Same "observable without
    // seeing it" pattern as every other accessor here, with one deliberate limit: a harness may use
    // heroFrame to REJECT a preview that framed the hero off-screen or at postage-stamp size, and may
    // never use it to accept one. Accepting a character showcase is a thing you do by looking at the
    // capture (AGENTS.md, "Playtests are mandatory").
    heroPreviewState: () => heroPreview.debugState(),
    // GP1-C4: which sword is actually in his hand, and which one the equipped item ASKED for. Both,
    // separately, on the same read -- if they ever disagree a harness sees a hero holding one weapon
    // while the card promises another, which is the exact defect this closes. Same "observable
    // without seeing it" pattern as every other accessor here; the mesh itself is still judged by
    // opening the capture.
    equippedWeaponMeshState: () => {
      const equippedItemId = equippedWeaponIdThisFrame;
      const anchorState = (mount) => (mount
        ? { mounted: true, visible: mount.anchor.visible === true }
        : { mounted: false, visible: false });
      const shipping = anchorState(shippingSwordMount);
      const candidate = anchorState(wildwoodBladeMount);
      return {
        equippedItemId,
        wantedMeshId: weaponMeshIdFor(equippedItemId),
        shipping,
        candidate,
        // The invariant, computed here so a harness sampling this every rendered frame can assert on
        // one number: it must be 1, always. Two swords in one fist, or an empty hand mid-download,
        // are the two ways this can go wrong and they are the same check.
        visibleSwords: Number(shipping.visible) + Number(candidate.visible),
      };
    },
    // GP2: the server's own loot block, read the identical way the frame loop itself reads it --
    // "observable without seeing it" once more, so a harness can assert spawned/collected directly
    // rather than inferring the world state from a screenshot.
    lootState: () => (netStatus === 'online' && serverEncounter?.loot ? serverEncounter.loot : EMPTY_LOOT),
    // GP3: same "observable without seeing it" pattern as lootState just above, for the Village
    // Board -- a harness can assert coins/shards/workshopOwned and which node is currently drilled
    // into directly, rather than reading pixels out of a capture.
    villageState: () => (netStatus === 'online' && serverEncounter?.village ? serverEncounter.village : EMPTY_VILLAGE),
    villageBoardOpen: () => villageBoard.isOpen(),
    villageBoardSelectedNodeId: () => selectedVillageNodeId,
    // The DISPLAYED (deliberately lagged) HUD totals, distinct from lootState()'s authoritative
    // collected map -- a harness proving "the HUD does not update before the pickup arrives" needs
    // to read exactly this number, not the server's own (already-credited) rewards.coins/.shards.
    lootHudDisplayed: () => ({ coins: coinsDisplayed, shards: shardsDisplayed }),
    // Same "observable without seeing it" pattern as audioDebug()/zoneTreeState(): a harness can
    // confirm a mark's spark actually launched rather than inferring it from a screenshot taken at
    // a guessed moment (the exact defect that photographed a corpse while every check passed).
    markSparksInFlight: () => markSparks.liveCount(),
    // GP1-C5: whether the screen is currently in the knocked-out state, so a harness can assert
    // the state exists rather than inferring it from a banner that has already faded.
    heroDownShown: () => heroDownVeilElement.dataset.shown === 'true',
    // GP1-C5: how many impact rings are on screen this instant, so a harness can prove a blow
    // produced a visible event rather than only that the rules said it landed.
    impactBurstsLive: () => impactBursts.liveCount(),
    guestId: () => net.guestId,
    // A copy, not the live array -- a harness must not be able to mutate this session's own record
    // of what it heard.
    rewardEvents: () => rewardEventLog.slice(),
    // Phase V (V3): "requested/loaded/failed" for a harness to poll until the zone has finished
    // loading, without a handle on the scene graph itself.
    zoneDebug: () => ({ ...zone.counts }),
    // Phase V (V3): "observable without hearing it" (see audioDebug's own comment) applied to the
    // keeper's proximity flourish -- a harness can confirm `wave` actually fired instead of only
    // inferring it from a screenshot taken at a guessed moment.
    zoneKeeperState: () => (zoneKeeper
      ? {
        waving: zoneKeeper.isWaving(),
        opacity: zoneKeeper.opacity(),
        // Is the "talk to me" marker up? Same "observable without seeing it" rule as the rest of
        // this object: a harness must be able to prove the marker went out when he gave the quest,
        // rather than squinting at two screenshots.
        questMarker: zoneKeeper.hasQuestMarker(),
        // Sol's 7-step regression (2026-08-16): the greeting latch's whole point is that `talking`
        // and `waving` trade off in a specific order (wave beats talk temporarily, wave completes,
        // talk resumes) -- proving that from outside needs both booleans on the same read, not just
        // one.
        talking: zoneKeeper.isTalking(),
      }
      : null),
    // W2: the same "observable without hearing it" pattern for the relight -- a harness can confirm
    // the tree's lit state directly instead of only inferring it from a screenshot's pixel colours.
    zoneTreeState: () => (zoneTree ? { lit: zoneTree.isTreeLit() } : null),
    // GP3: same pattern again, for the Workshop -- a harness can confirm the transformation actually
    // fired directly instead of only inferring it from a screenshot's pixel colours.
    zoneWorkshopState: () => (zoneWorkshop
      ? { built: zoneWorkshop.isBuilt(), transforming: zoneWorkshop.isTransforming(), ceremonyPending: workshopCeremonyPending }
      : null),
    // GP3-C1: "observable without seeing it" once more -- a harness can assert the deliberate
    // interaction prompt is actually tappable (or actually hidden) directly, rather than inferring it
    // from a screenshot or from the DOM's own data-shown attribute.
    workshopInteractAvailable: () => workshopInteractShown,
    // Same pattern once more, for the villagers: how many stood up, and how far each has turned off
    // their resting heading right now -- so a harness can prove the village is ALIVE rather than
    // three statues, without reading pixels out of two screenshots taken seconds apart.
    zoneVillagerState: () => (zoneVillagers
      ? { count: zoneVillagers.count, headingOffsets: zoneVillagers.headingOffsets() }
      : null),
    // The Dark Trail, same pattern again. `lit` is the rules layer's own array and `loaded` is how
    // many lamps the scene actually built, and they are reported SEPARATELY on purpose: if the two
    // ever disagree, a harness sees a trail that thinks it is lit standing over lamps that are dark.
    zoneTrailState: () => ({
      loaded: zoneTrailLights.length,
      lit: [...trailLit],
      // G1: the second chain, reported the same way and for the same reason -- `beaconRoadLoaded` is
      // how many lamps the SCENE built and `beaconRoadLit` is what the rules layer believes, so a
      // harness can see the two disagree instead of only seeing one of them.
      beaconRoadLoaded: zoneBeaconRoadLights.length,
      beaconRoadLit: [...beaconRoadLit],
      // The Wildwood Gate's own latch, reported beside the rest of the chain rather than left as the
      // one beat a harness cannot see. It gates the objective chip ahead of everything Chapter 2
      // says (world/quest.js checks it before the trail at all), so a run that walks PAST the arch
      // reads a perfectly correct "follow the lit path north" and has no way to discover why.
      gateFound,
      campFound,
      rowanMet,
      cartSearched,
      beaconFound,
      // Whether the Beacon's own presenter exists at all, and whether its arrival stir is running --
      // "observable without seeing it", the same pattern zoneWorkshopState gives the Workshop.
      beaconBuilt: zoneOldBeacon !== null,
      // The marker stones on the way up, counted rather than assumed: they are the one part of the
      // route with no state of its own, so "did they get built at all" is the only question about
      // them a harness can ask without reading pixels.
      waystonesBuilt: zoneBeaconWaystones?.count ?? 0,
      beaconStirring: zoneOldBeacon?.isStirring() ?? false,
      beaconGlow: zoneOldBeacon?.glowStrength() ?? null,
      // "Is it on screen RIGHT NOW", from the live camera -- the seam that makes "a child can see the
      // Beacon before they touch it" something a harness can disagree with, instead of something a
      // screenshot has to be squinted at for. The predicate itself lives in world/oldBeacon.js so it
      // is also testable with no browser at all.
      beaconSight: zoneOldBeacon?.sight(camera, player.position) ?? null,
      brambleBlows: [...brambleBlows],
      bramblesCut: bramblesCut(brambleBlows),
      // Whether the SCENE agrees the tangle is gone, reported separately from the rules layer's
      // blow count for the same reason `loaded` is reported separately from `lit`: if these two ever
      // disagree, a harness sees a bramble the rules think is cut still standing in the trail.
      bramblesGone: zoneBrambles.filter((bramble) => bramble.isGone()).length,
    }),
    // G2..G5: "observable without seeing it" once more, for the whole Beacon arc -- so a harness can
    // prove a seal broke, the Warden woke, the Beacon caught and the blackthorn opened, rather than
    // inferring any of it from a screenshot taken at a guessed moment. The RULES layer and the SCENE
    // are reported separately for the same reason zoneTrailState reports `lit` and `loaded` apart:
    // if the two ever disagree, a harness sees a Beacon the rules think is burning standing over a
    // cold cresset.
    // ARC 2: is Wren in the world, is she carrying anything of ours yet, and how many hearts does
    // this body actually have. Reported as OBSERVABLE facts rather than as the flags behind them --
    // `rangerHere` is whether the mesh is drawn, not whether the Beacon is lit, which is the
    // distinction docs/MISTAKES.md GQ-013 is about.
    // The guidance rescue's own reading, for the same reason every zone exposes one: a harness has
    // to be able to ask why the offer did or did not appear, and "it did not" is not an answer.
    guidanceRescueState: () => ({
      ...rescueWatch.debugState(),
      targetX: rescueTarget?.x ?? null,
      targetZ: rescueTarget?.z ?? null,
    }),
    zoneRangerState: () => ({
      rangerHere: zoneRanger?.isHere() === true,
      rangerBuilt: zoneRanger !== null,
      satchelCarried: satchelCarriedSeen === true,
      charmOwned: charmOwnedSeen === true,
      hearts: heartsShown.hp,
      heartCeiling: heartsShown.maxHp,
    }),
    zoneSiegeState: () => ({
      seals: siegeState.seals.map((seal) => ({ blows: seal.blows, burst: seal.burst })),
      sealsBuilt: zoneColdSeals.length,
      sealsGone: zoneColdSeals.filter((seal) => seal.isGone()).length,
      warden: {
        mode: siegeState.warden.mode,
        hp: siegeState.warden.hp,
        phase: siegeState.warden.phase,
        x: siegeState.warden.x,
        z: siegeState.warden.z,
      },
      wardenBuilt: zoneWarden !== null,
      beaconLit: siegeState.beaconLit,
      beaconLitInScene: zoneOldBeacon?.isLit() ?? false,
      // NOT THE SAME QUESTION as beaconLitInScene, and the difference cost a shipped payoff: the
      // Beacon reported itself lit for a whole release while the fire was hidden inside the basket.
      // This is how tall the flame actually stands right now, in metres, so a harness can ask
      // whether there is anything to SEE rather than whether a flag is set.
      beaconFireHeight: zoneOldBeacon?.fireHeightMeters() ?? 0,
      bladeOwned: bladeOwnedSeen === true,
      blackthornBlows: hollowState.barrierBlows,
      blackthornTorn: hollowState.barrierTorn,
      blackthornGone: zoneBlackthorn?.isGone() ?? false,
      hollowFound,
      lodgeFound,
      chestOpened: hollowState.chestOpened,
    }),
  };
  window.__galaQuestRuntime = runtime;

  const resize = () => {
    runtimeRenderer.resize();
    camera.aspect = runtimeRenderer.size.width / runtimeRenderer.size.height;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize, { passive: true });
  // iOS Safari changes the usable viewport without always firing a window resize: the URL bar
  // collapses on scroll, and orientationchange can land before the new innerWidth is readable. Both
  // routes drive the same resize(), so the worst case is a redundant call.
  window.visualViewport?.addEventListener('resize', resize, { passive: true });
  // Two frames, not one: on iOS the metrics immediately after this event are still the old ones.
  window.addEventListener('orientationchange', () => {
    resize();
    window.requestAnimationFrame(() => window.requestAnimationFrame(resize));
  }, { passive: true });
  // Once at boot, because no resize event fires on a plain page load. Without this the camera keeps
  // its constructor aspect of 1 until the first rotation or window change -- measured as a 0.46x
  // horizontal squeeze of the whole scene on a 390x844 phone, and ~1.78x stretch at 1280x720.
  resize();

  let previousTimestamp = null;
  // Frame time the prediction owes the hero but was not allowed to spend in one bite. See
  // net/prediction.js -- without this, every frame over 100 ms silently walked the client's hero
  // less far than the server walked its own, and reconciliation snapped him forward to catch up.
  let predictionBacklogSeconds = 0;
  // Whether the previous frame had a thumb on the stick. A frame gap that elapsed while the hero
  // stood still is not time either simulation walked -- see predictionStep's `wasMoving`.
  let predictionWasMoving = false;
  const frame = (timestamp) => {
    window.requestAnimationFrame(frame);
    if (runtimeRenderer.contextLost) {
      diagnostics.update('WebGL context lost', quality.level.name);
      return;
    }
    if (!runtimeRenderer.frameLimiter.shouldRender(timestamp)) return;

    const frameStart = performance.now();

    // Raw gap since the previous *rendered* frame, for the quality ladder. Deliberately not the
    // clamped deltaSeconds below: that clamp exists so a hitch cannot teleport the hero, and it would
    // also flatten a 500ms stall into 100ms for the one measurement that needs to see it whole.
    const frameDeltaMs = previousTimestamp === null ? null : timestamp - previousTimestamp;
    const deltaSeconds = previousTimestamp === null
      ? 0
      : Math.min((timestamp - previousTimestamp) / 1000, 0.1);
    previousTimestamp = timestamp;

    // GP1: the Hero screen is a non-blocking overlay (the multiplayer world keeps simulating behind
    // it, same as Keeper speech), but LOCAL input has to stop while it is open -- checked once here
    // and reused below, rather than letting each of movement/attack independently poll isOpen().
    const heroScreenOpen = heroScreen.isOpen();
    // GP3: the Village Board is the second (and, by construction, mutually exclusive -- see its own
    // onOpenChange) full-screen overlay that owns input the same way Hero screen does.
    const villageBoardOpen = villageBoard.isOpen();
    // Either overlay open suspends the same movement/attack input -- checked once here and reused
    // below, the same "checked once, not polled per-system" reasoning heroScreenOpen's own comment
    // already gives, just widened to cover both screens now that there are two.
    const anyOverlayOpen = heroScreenOpen || villageBoardOpen;
    // Read every frame regardless of open/closed -- cheap (a property read, no DOM/three.js work),
    // and the showcase pass needs the current equipped id the frame the screen OPENS, so it can pick
    // up mid-frame whatever the DOM render below just set rather than painting one frame stale.
    // Offline this is the device's own journal, folded -- the same shape the wire's rewards block
    // has, which is what lets one renderer read either. It carries real owned items too, so an
    // offline child's Hero screen shows what they have actually earned rather than the starter set.
    const ownRewards = netStatus === 'online'
      ? (net.selfId !== null ? serverEncounter?.rewards?.[net.selfId] : null)
      : profileState;
    const currentEquippedWeaponId = equippedWeaponIdFromRewards(ownRewards);
    if (heroScreenOpen) {
      heroScreen.render(heroScreenViewModel({
        equippedWeaponId: currentEquippedWeaponId,
        ownedItemIds: ownedItemIdsFromRewards(ownRewards),
        selectedItemId: selectedHeroItemId,
      }));
    }
    // GP1-C3: the showcase pass's per-frame input. No-ops entirely while the screen is closed, and
    // re-reads the live hero every frame so gear mounted mid-screen joins the preview rather than
    // being left behind on CHARACTER. The accent is the equipped weapon's OWN swatch -- the same
    // number the item card and the owned strip paint with -- which is what makes tapping EQUIP a
    // visible change in 3D and not only in the DOM.
    // GP1-C4: the sword he is actually holding, decided from the SAME equipped id the Hero screen's
    // card and the preview's accent read, so the DOM, the showcase and the world can never disagree
    // about which weapon this is. Runs whether the screen is open or closed -- the swap has to be
    // true in ordinary gameplay too, not only while a child is looking at the menu.
    ensureEquippedWeaponMesh(currentEquippedWeaponId);
    heroPreview.update({
      heroRoot: runtime.hero,
      accentColorHex: swatchHexFor(currentEquippedWeaponId),
      width: runtimeRenderer.size.width,
      height: runtimeRenderer.size.height,
    });

    // touch.read()/keyboard.read() are plain snapshot reads with no drain/consume semantics (unlike
    // the attack takeAttack() calls below, which DO have to run every frame regardless) -- safe to
    // skip outright while an overlay owns input, not merely safe to zero afterwards. The stick is
    // also visually suspended (pointer-events: none) at the same moment, so it cannot have an active
    // pointer here anyway; this is what makes that true for keyboard too.
    const touchInput = anyOverlayOpen ? { active: false, run: false, screen: { x: 0, y: 0 } } : touch.read();
    const input = anyOverlayOpen ? touchInput : (touchInput.active ? touchInput : keyboard.read());
    const inputMagnitude = Math.hypot(input.screen.x, input.screen.y);
    player.groundSpeed = groundSpeedForInput(inputMagnitude, input.run);
    // One direction, used for both the local integration and the wire, so the server can never be
    // told a different heading from the one the hero is walking.
    const worldDirection = worldDirectionForInput(input.screen, follow.heading);
    // Movement gets its OWN time budget, not the animation delta above: a slow frame must not lose
    // distance the server already walked (net/prediction.js), while the mixer and the offline rules
    // keep the plain clamped delta they have always used.
    const movement = predictionStep({
      // frameDeltaMs, not `timestamp - previousTimestamp`: previousTimestamp was already advanced
      // above, and frameDeltaMs is deliberately the UNCLAMPED gap -- which is exactly what a
      // catch-up budget has to be measured from.
      rawDeltaSeconds: frameDeltaMs === null ? 0 : frameDeltaMs / 1000,
      backlogSeconds: predictionBacklogSeconds,
      moving: inputMagnitude > 0,
      wasMoving: predictionWasMoving,
    });
    predictionBacklogSeconds = movement.backlogSeconds;
    predictionWasMoving = inputMagnitude > 0;
    if (inputMagnitude > 0) {
      // Clamped to the SAME walkable bounds net/gameServer.mjs enforces (world/bounds.js). Without
      // this the prediction walks off the rim while authority stays pinned to it, and the growing
      // disagreement rubber-bands and then teleports the hero -- measured in the running game.
      player.position.x = clampToWorldX(player.position.x + worldDirection.x * player.groundSpeed * movement.deltaSeconds);
      player.position.z = clampToWorldZ(player.position.z + worldDirection.z * player.groundSpeed * movement.deltaSeconds);
      player.heading = Math.atan2(worldDirection.x, worldDirection.z);
    }
    // Intent out. The client throttles to 15 Hz and sends a release immediately.
    net.setIntent(worldDirection.x, worldDirection.z, inputMagnitude, input.run);
    // Pull the local prediction back towards the server's version of us. The local hero stays
    // locally predicted -- it must respond to a thumb without waiting for a round trip -- so this
    // only corrects the accumulated difference.
    lastReconcile = net.reconcile(player.position);

    // Online: the fight is the server's (Task B4). Mirror the last published block onto
    // encounterState -- hearts, the swing, the wolf presenter, the status line all read `wolf` and
    // `hero` off it, none of them needing to know whether they are reading a local step's result or
    // the server's. Offline: encounterState is still advanced by the local rules further down,
    // unchanged (ruling 8).
    //
    // The mirror carries a COMPLETE encounter state, not just { wolf, hero } -- root-caused
    // 2026-08-13 (the private engineering archive, test/offline-handover.test.mjs): the
    // moment netStatus first leaves 'online', the offline branch below calls
    // stepEncounter/requestAttack directly on this same `encounterState`, and encounter.js's
    // publish()/publishParty() unconditionally read state.wolfSpawn.x/state.heroSpawn.x
    // (encounter.js:289, :618). A two-key mirror left those undefined, so `.x` threw every frame,
    // forever, with no try/catch around this requestAnimationFrame callback -- freezing the whole
    // render loop, not just combat. wolfSpawn/heroSpawn/revision/lastCommandId are filled in here so
    // this object is a valid state on its own terms the instant the socket drops, not only a view
    // for the online-only readers below. biteCooldown/biteLanded/swingLanded never ride the wire
    // (protocol.js: "Internal-only fields ... never leave the server"), so they default the same way
    // a fresh createEncounterState() does; the real fields from the server override them.
    if (netStatus === 'online') {
      const published = serverEncounter ?? EMPTY_SERVER_ENCOUNTER;
      const ownHeroId = net.selfId;
      const ownHero = (ownHeroId !== null && published.heroes[ownHeroId]) || DEFAULT_HERO_VIEW;
      encounterState = {
        revision: published.revision,
        lastCommandId: null,
        wolfSpawn: WOLF_SPAWN,
        // The patrol never rides the wire (the client does not need to know where the NEXT wolf will
        // be -- it is told where this one IS). Seeded from the zone so that if the socket drops
        // mid-quest, the offline rules that take over keep moving the wolf around the same three
        // spots instead of pinning it to the first one for the rest of the session.
        wolfSpawns: WOLF_SPAWNS,
        heroSpawn: HERO_SPAWN,
        wolf: { biteCooldown: 0, biteLanded: false, modeSeconds: 0, ...published.wolf },
        hero: { swingLanded: false, ...ownHero },
      };
    }

    // HEARTS FROM THE BODY, diffed, once per frame, online and off.
    //
    // Every other renderHearts call in this file is EVENT-driven, which was correct while a hero's
    // ceiling was a constant: 'hero-healed' carries `remaining` and nothing else, and nothing else
    // was needed. Wren's charm moves the ceiling with no combat event at all -- it is a durable row
    // arriving on the next snapshot's rewards block -- so a fourth heart would otherwise appear only
    // on the child's next heal, kill or death. Reading the published body and repainting when either
    // number moves costs one comparison a frame and makes the bar unconditionally honest; the event
    // handlers keep their real jobs, which are the POP and the flash, not the truth.
    const heartsNow = encounterState.hero;
    const heartsMax = heartsNow.maxHp ?? HERO_MAX_HP;
    if (heartsNow.hp !== heartsShown.hp || heartsMax !== heartsShown.maxHp) {
      heartsShown = { hp: heartsNow.hp, maxHp: heartsMax };
      renderHearts(heartsShown.hp, heartsShown.maxHp);
    }

    // Stop the hero walking through the wolf. Applied after movement and reconciliation so it is the
    // last word on where the hero stands, and before the hero is drawn, so no frame ever shows the
    // two bodies overlapping. Online, the server already does this (Design ruling 6, Task B3's
    // `simulation.step()`) and net.reconcile() above is what pulls this client's own prediction
    // back to agree with it -- applying the local push again here would double-correct against a
    // wolf position this same tick's snapshot may already have moved.
    if (netStatus !== 'online') {
      const separated = separateFromWolf(player.position, encounterState.wolf);
      player.position.x = separated.x;
      player.position.z = separated.z;
    }

    // GP3: Village Supplies, read once per frame and shared by every consumer below -- the Board's
    // own render, the loot HUD's now-shared totals, and the Workshop's own build trigger. Computed
    // HERE, outside the `if (runtime.hero)` guard just below, for the identical reason
    // rewardsForRelight/lanternUnlockedNow already are (see that pair's own comment further down):
    // the Board, the Workshop ceremony, and the loot-collect request all still have to work the
    // moment the zone has loaded even before the hero mesh itself has. A first version declared this
    // inside the hero guard and threw "village is not defined" on every single frame the instant
    // control reached the Board-render/Workshop-trigger code below it -- unit tests never caught it
    // because main.js's own frame loop is browser-only and none of them exercise it; only a real
    // browser run (tools/runtime-test/drive-village-board.mjs) surfaced it. No offline fallback
    // (EMPTY_VILLAGE's own comment): there is nothing durable to read without a server.
    const village = netStatus === 'online' && serverEncounter?.village ? serverEncounter.village : EMPTY_VILLAGE;

    if (runtime.hero) {
      runtime.hero.position.copy(player.position);
      runtime.hero.rotation.y = player.heading;
      // A DOWNED HERO DOES NOT WALK, and this line is why his death animation is visible at all.
      //
      // "You went down" used to be a banner and a screen flash while the hero stood there upright
      // with his sword out for the whole two-second respawn. The death clip WAS playing -- measured
      // over CDP, his head really did drop from 1.05m to 0.10m -- and then snapped back upright on
      // exactly the frame the clip finished. A finished action stops writing; it does not hold. The
      // wolf's corpse stays down only because nothing else writes the wolf's pose, and here
      // locomotion was rewriting a full idle pose every single frame underneath it.
      //
      // So while he is down, locomotion is not called at all: the reaction animator is the only
      // thing posing him, and clampWhenFinished means what it says.
      const heroIsDown = (encounterState.hero?.downSeconds ?? -1) >= 0;
      if (!heroIsDown) locomotion?.update(deltaSeconds, player.groundSpeed);
      // Remotes are drawn from interpolated snapshots, not predicted: we have no idea what another
      // child's thumb is doing, and guessing would walk them through scenery.
      remotes?.update(net.sampleRemotes(), deltaSeconds);
      // Read the mode from the speed the locomotion controller is given, not from the run flag, so
      // the status line cannot disagree with the clip actually playing.
      // Read from the controller, not from the speed alone: standing now plays a real idle clip on
      // a rig that has one and still holds a walk frame on a rig that does not, and the status line
      // must never claim the one while the other is on screen.
      const standing = locomotion?.getState();
      const own = player.groundSpeed === 0
        ? `hero ${standing?.activeMode === 'idle' ? 'idle' : 'idle — walk frame held'}`
        : `hero ${locomotionModeForSpeed(player.groundSpeed) === 'run' ? 'running' : 'walking'} at `
          + `${player.groundSpeed.toFixed(2)} m/s`;
      const others = netStatus === 'online'
        ? `players ${(remotes?.count ?? 0) + 1}`
        : netStatus;

      // Both controls are drained every frame, not just the active one: a child can have a thumb on
      // the stick and still tap ATTACK, and a desktop tester can do both too. Draining only the
      // "active" input would silently swallow one of them.
      // Drained into locals first. Written as `a() || b()` the second call short-circuits away, and a
      // keyboard press made in the same frame as a button tap would survive to fire a frame later.
      // Both calls still run every frame regardless of anyOverlayOpen -- draining is not optional,
      // see the comment two lines up -- but forced false while either overlay is open, the same
      // "suspend the ACTION, not the bookkeeping" rule the input block above applies to movement.
      // Without this a spacebar press (the attack button itself is visually suspended and cannot
      // originate a touch) would still swing the sword with an overlay open.
      const tappedAttack = attack.takeAttack() && !anyOverlayOpen;
      const pressedAttack = keyboard.takeAttack() && !anyOverlayOpen;
      // Two commands, in the order a player produces them: the button press, then the clock. Events
      // from both are collected and dispatched together below, which is the order this loop has
      // always used -- the presenters are updated to the newest state first, then told what changed.
      const events = [];
      if (netStatus === 'online') {
        // Combat commands are server-applied, presentation is client-predicted (Design ruling 3).
        // No local stepEncounter/requestAttack/separateFromWolf here at all -- HP, wolf mode,
        // hearts, banners and events all come exclusively from the mirror set up above.
        const ownHeroId = net.selfId;
        const canSwing = ownHeroId !== null && serverEncounter !== null
          && canHeroAttack(serverEncounter, ownHeroId);
        attack.setReady(canSwing);
        if ((tappedAttack || pressedAttack) && canSwing) {
          net.sendAttack();
          // Presentation only: the clip starts on the button press, not on the server's ack, so a
          // thumb sees the sword move immediately. Handed off to the server's own swingSeconds (in
          // `hero` below) below the moment it confirms.
          predictedSwingSeconds = 0;
        } else if (predictedSwingSeconds >= 0) {
          predictedSwingSeconds += deltaSeconds;
        }
        // Events ride snapshots at 10 Hz (ruling 7), queued by onEncounter between frames and
        // drained here, filtered to this hero and mapped back to the solo shape onEncounterEvent's
        // table expects.
        const drained = pendingServerEvents.splice(0, pendingServerEvents.length);
        for (const event of drained) {
          // The siege's own events go to the siege's own table (see SIEGE_EVENT_TYPES). Filtered to
          // this hero the same way the wolf's are, EXCEPT the ones that are nobody's in particular
          // (a seal bursting, the Beacon catching, the Warden waking): those are world events, and
          // every child standing there should hear them, exactly like `wolf-defeated`.
          if (SIEGE_EVENT_TYPES.has(event.type)) {
            if (isOwnSiegeEvent(event, ownHeroId)) pendingSiegeEvents.push(stripHeroId(event));
            continue;
          }
          if (GLOBAL_ENCOUNTER_EVENT_TYPES.has(event.type) || event.heroId === ownHeroId) {
            events.push(stripHeroId(event));
          }
        }
      } else {
        if (tappedAttack || pressedAttack) {
          const asked = requestAttack(encounterState, nextCommandId++);
          encounterState = asked.state;
          events.push(...asked.events);
        }
        attack.setReady(canAttack(encounterState));

        // The fight runs off the same predicted position the hero is drawn at, so a swing lands where
        // the child sees themselves standing rather than where the server last heard from them.
        const stepped = stepEncounter(encounterState, {
          commandId: nextCommandId++,
          deltaSeconds,
          heroPosition: player.position,
          heroHeading: player.heading,
          // The same id the barrier and the mounted mesh are already decided by, so a child who
          // loses the socket keeps the sword they earned -- online and off, one answer to "what am
          // I holding" (see equippedWeaponIdThisFrame's own comment on why it is recorded, not
          // re-derived). Resolved to a number on this side of the seam, exactly as
          // net/gameServer.mjs does for the online fight.
          heroWeaponDamage: swingDamageFor(equippedWeaponIdThisFrame),
        });
        encounterState = stepped.state;
        events.push(...stepped.events);

        // Offline fallback reward loop (brief D4): the same D1 fold net/gameServer.mjs runs online,
        // run here against the solo hero's own (heroId-less) events -- see rewards/offlineProgress.js
        // for the stamping, the durable id, and why the two cannot be done separately.
        // Each raised event carries the durable eventId it was recorded under, so the dispatcher's
        // journalDurableFact writes the same named fact an online mark writes rather than a
        // nameless one -- which is what lets the two origins merge instead of double-count.
        const earned = offlineProgress.recordKills(stepped.events);
        if (earned.length > 0) {
          refreshProfileState();
          events.push(...earned);
        }
      }

      // The current guest's own marks/unlock state, read fresh every frame the same way `wolf`/
      // `hero` below are: online, the server (via encounter.rewards, D3) is the source of truth;
      // offline, it is the local fold just above. Neither branch accumulates a THIRD copy of this
      // state -- pips and the lantern mount always read whichever of these two is live right now.
      const ownRewards = netStatus === 'online'
        ? (net.selfId !== null ? serverEncounter?.rewards?.[net.selfId] : null)
        : profileState;
      renderLanternPips(markProgressToShow(ownRewards?.marks ?? 0));
      ensureLanternMounted(ownRewards?.lanternUnlocked === true);

      // ── G4: THE UNLOCK CEREMONY ─────────────────────────────────────────────────────────────
      //
      // Fired by DIFFING owned items rather than off an event, the same cart-jolt discipline the
      // rest of this file uses -- the grant is durable, so the honest question is "does this hero own
      // it now when they did not a frame ago", and that question is also true after a reconnect
      // without replaying anything (bladeOwnedSeen starts null and simply adopts the first answer).
      //
      // NO AUTO-EQUIP. Ownership and equipment stay separate on purpose: "I got this" and then "I am
      // putting it on" are two beats, and the second is the child's to take.
      const ownsBladeNow = ownedItemIdsFromRewards(ownRewards).includes(WILDWOOD_BLADE_ID);
      if (bladeOwnedSeen === null) {
        // First frame we know anything: adopt it silently. A returning child who already earned the
        // Blade yesterday must not be handed the ceremony again on every page load.
        bladeOwnedSeen = ownsBladeNow;
      } else if (ownsBladeNow && !bladeOwnedSeen) {
        bladeOwnedSeen = true;
        unlockCard.show(unlockCardState({
          itemName: itemDef(WILDWOOD_BLADE_ID)?.name ?? 'Wildwood Blade',
          // Honest about what it replaces: compared against whatever is actually EQUIPPED right
          // now, read off the same id the hero's own hand is drawn from (GQ-007).
          fromDamage: damageFor(currentEquippedWeaponId),
          toDamage: damageFor(WILDWOOD_BLADE_ID),
        }));
        audio.play('blade-unlock');
      }

      // ── ARC 2: THE SATCHEL AND THE CHARM, adopted the same way ──────────────────────────────
      //
      // Both diffed off the published rewards rather than off events, for the identical reason the
      // Blade is: they are durable per-guest latches, so "does this hero have it now when they did
      // not a frame ago" is the honest question, and it stays true across a reconnect without
      // replaying anything.
      const carriesSatchelNow = ownRewards?.satchelCarried === true;
      if (satchelCarriedSeen === null) {
        satchelCarriedSeen = carriesSatchelNow;
      } else if (carriesSatchelNow && !satchelCarriedSeen) {
        satchelCarriedSeen = true;
        // No unlock card. A satchel is not gear and this is not a reward -- it is a thing you picked
        // up off the ground that belongs to somebody else. The banner says exactly that much and no
        // more, and leaves the child to work out who (see world/rangerSpeech.js on why the beat only
        // works unassembled).
        banner('You lift a ranger’s satchel.', 2800);
      }
      const holdsCharmNow = ownRewards?.charmOwned === true;
      if (charmOwnedSeen === null) {
        charmOwnedSeen = holdsCharmNow;
      } else if (holdsCharmNow && !charmOwnedSeen) {
        charmOwnedSeen = true;
        // The fourth heart paints ITSELF: the new ceiling rides the same snapshot and the per-frame
        // hearts read above repaints the bar. This is only the sentence and the flourish.
        banner('Wren gives you her charm.', 3000);
        popHearts();
      }

      // GP2/GP3: seed the displayed HUD totals from the authoritative value ONCE, the first frame it
      // is known -- a returning guest's own past haul (or a fresh guest's honest zero) has to appear
      // immediately, with nothing to fly in and watch arrive. Every count AFTER this seed only ever
      // advances via a pickup's own attraction flight completing, or a background sync once nothing
      // of this hero's own is still in flight (below) -- that gap is GP2's own "HUD totals must not
      // update before the pickup reaches its collection endpoint" rule, made real rather than merely
      // intended, now extended to Village Supplies' own shared remaining balance (GP3 brief section
      // 5) instead of this hero's own personal collected total.
      if (!lootHudSeeded && netStatus === 'online' && ownRewards) {
        const remaining = remainingVillageSupplies(village.coins, village.shards, village.workshopOwned);
        coinsDisplayed = remaining.coins;
        shardsDisplayed = remaining.shards;
        lootHudSeeded = true;
        renderLootHud();
      }

      // The published state, read once and shared by every consumer below. Nothing here calls back
      // into the rules -- online or offline, `encounterState` is just data by this point.
      const { wolf, hero } = encounterState;
      // The server's own swingSeconds (mirrored into `hero` above) takes over the instant it
      // confirms, or the prediction times out on its own clock -- either way nothing downstream of
      // this line ever decides whether a swing lands; that stays server truth online.
      if (netStatus === 'online' && (hero.swingSeconds >= 0 || predictedSwingSeconds >= SWING_SECONDS)) {
        predictedSwingSeconds = -1;
      }
      const swingSecondsForClip = netStatus === 'online' && hero.swingSeconds < 0 && predictedSwingSeconds >= 0
        ? predictedSwingSeconds
        : hero.swingSeconds;
      // Between locomotion (the base pose) and the swing (the top priority): reactions write over
      // the stride, and an active swing writes over a reaction, which is the mechanical half of
      // the owner's attack-takes-precedence rule -- reactClips.js's trigger gate is the other half.
      //
      // EXCEPT while the hero is down. swingClip.js's action.stop() (via three.js's own
      // saveOriginalState/restoreOriginalState pair -- see test/swing-arbitration.test.mjs) restores
      // the pose the skeleton held at the instant the swing STARTED, which is stale the moment a hero
      // dies mid-swing. Locomotion papers over that restore one frame later in the ordinary case;
      // while down, locomotion is skipped entirely (heroIsDown above), so nothing does. Running swing
      // FIRST when down means any stale restore lands before reactions writes the death pose, so
      // death's write is the one that survives the frame -- "death visually supersedes swing" without
      // touching swingClip.js itself.
      if (heroIsDown) {
        swing?.update(swingSecondsForClip, SWING_SECONDS, deltaSeconds);
        reactions?.update(deltaSeconds, hero);
      } else {
        reactions?.update(deltaSeconds, hero);
        // AFTER locomotion.update(), which is what writes the walk pose. The swing is an offset on
        // top of that pose, so running it first would be overwritten the same frame.
        swing?.update(swingSecondsForClip, SWING_SECONDS, deltaSeconds);
      }
      wolfPresenter?.update(deltaSeconds, wolf);
      // The single event-dispatch point (ruling 5): both the online (server-mirrored) and offline
      // (locally stepped) paths above funnel their events through this one loop, which is exactly
      // why sound attaches here and nowhere else -- no reaching into encounterState, only the
      // events already flowing through. soundForEvent's table decides every event explicitly (six
      // mapped, three silent by name), so a null recipe name is expected, not a gap.
      //
      // mark-earned/lantern-unlocked are split off to their own table (rewards/feedback.js) rather
      // than joining onEncounterEvent's: they are never raised by combat/encounter.js, so they can
      // never be members of ENCOUNTER_EVENT_TYPES (feedback.test.mjs pins that list to a regex scan
      // of encounter.js's own source) without either editing the guarded combat/ directory or
      // breaking that guard's own regression test. Same "every event accounted for, sound decided
      // explicitly" discipline, just addressed through its own two small tables.
      for (const event of events) {
        // Journalled HERE rather than inside the two reward handlers that used to do it, so the
        // device keeps a copy of every durable fact it is told about rather than of the two types
        // somebody remembered to wire. journalDurableFact ignores anything with no stable id, and
        // recordFacts refuses anything that is not a profile fact, so widening the call cannot
        // journal something it should not -- and a new durable event type stops needing a second
        // edit here to be remembered.
        journalDurableFact(event);
        if (REWARD_EVENT_TYPES.includes(event.type)) {
          const rewardRecipeName = soundForRewardEvent(event.type);
          if (rewardRecipeName) audio.play(rewardRecipeName);
          onRewardEvent(event);
          continue;
        }
        const recipeName = soundForEvent(event.type);
        if (recipeName) audio.play(recipeName);
        onEncounterEvent(event);
      }

      const fight = wolf.mode === 'dead'
        ? 'wolf down'
        : `wolf ${wolf.hp}hp · you ${Math.max(0, hero.hp)}hp`;
      status.textContent = `${own} · ${fight} · ${others}`;
    }
    // The keeper's proximity flourish reads local AND remote hero positions (brief V2: "any hero
    // (local or remote published position)"), so it runs here rather than inside the `if
    // (runtime.hero)` block above -- a sibling child standing next to the keeper must trigger the
    // wave even on a client whose own hero has not finished loading yet.
    if (zoneKeeper) {
      const heroPositions = [{ x: player.position.x, z: player.position.z }];
      for (const remote of remotes?.describe() ?? []) heroPositions.push({ x: remote.x, z: remote.z });
      // The occlusion fade is always about THIS client's own camera and own hero, never a remote's:
      // a sibling walking behind the Keeper on the other iPad must not make him go see-through here.
      zoneKeeper.update(deltaSeconds, heroPositions, {
        camera: camera.position,
        hero: player.position,
      });
      // Rowan watches the same way, no occlusion fade -- they stand alone in a clearing, not on the
      // road the follow camera has to swing through.
      zoneRowan?.update(deltaSeconds, heroPositions);
      zoneRanger?.update(deltaSeconds, heroPositions);
    }
    // The villagers breathe and look around whether or not anyone is near them -- that is the whole
    // point of them, and a village that only comes alive once you are standing in it is a village
    // you had no reason to walk into.
    zoneVillagers?.update(deltaSeconds);
    // W1/W2: the keeper's line and the tree's relight both read the SAME two sources the pips and
    // the belt lantern already read above (welcome state via serverEncounter.rewards, or the local
    // D1 fold offline) -- computed here, outside the `if (runtime.hero)` guard, because both must
    // still work the moment the zone has loaded even before the hero mesh itself has (matching the
    // keeper's own wave, just above). lanternUnlockedFromRewards is the one pure function that
    // decides "lit or not" from that shape; see zoneLoader.js.
    const rewardsForRelight = netStatus === 'online'
      ? (net.selfId !== null ? serverEncounter?.rewards?.[net.selfId] : null)
      : profileState;
    const lanternUnlockedNow = lanternUnlockedFromRewards(rewardsForRelight);
    // GP3: the Village Board's own render, reusing lanternUnlockedNow just computed above rather
    // than re-deriving a second "is the tree lit" answer -- see village/boardScreen.js's own
    // villageBoardViewModel comment for why the Lantern Tree node is fed this exact flag. village
    // has no offline fallback (EMPTY_VILLAGE's own comment): a disconnected session sees zero/
    // unowned, which is honest -- there is nothing durable to read.
    if (villageBoardOpen) {
      villageBoard.render(villageBoardViewModel({
        village,
        lanternUnlocked: lanternUnlockedNow,
        selectedNodeId: selectedVillageNodeId,
        // G6: the world reacts where a child can SEE it react. The Beacon burns twenty metres up
        // a road they may not walk again for a week; the Board is in the village they live in.
        beaconLit: siegeState.beaconLit,
      }));
    }
    // "Do we actually KNOW this hero's marks yet" -- which is not the same question as "is
    // rewardsForRelight non-null". While the socket is still opening, netStatus is 'connecting' and
    // the expression above quietly falls through to the OFFLINE fold, which is a real object
    // reading zero marks and no lantern. Boot therefore looked exactly like "this player watched
    // the tree be dark", for every player, every load -- so a returning guest whose tree should
    // have been lit on arrival got armed for the earned ceremony instead. Measured, not reasoned
    // about: drive-relight.mjs's "the tree is LIT, driven purely by welcome state" went red.
    //
    // 'connecting' is the one status that means "no answer yet" (net/client.js sets it before the
    // socket opens and replaces it with 'online' on welcome or 'offline' on failure), so a genuine
    // no-server session still counts its own local fold as the truth immediately.
    const rewardsKnown = netStatus === 'online'
      ? rewardsForRelight != null
      : netStatus === 'offline';
    // W2 as shipped was one line -- `setTreeLit(unlocked)` -- and it fired the instant the third
    // mark landed, which is at the wolf, 18 m from the tree, with the camera behind the hero. The
    // whole quest's payoff happened off screen. Three states now, not two:
    //
    //   - rewards not known yet (pre-welcome): do nothing at all. Treating "no rewards yet" as "not
    //     unlocked" would arm the ceremony for a returning guest and hold their tree dark until they
    //     walked to it, which is not what they earned and would break drive-relight's own
    //     "lit from welcome state alone" check.
    //   - unlocked BEFORE this client ever saw it dark: light it instantly, no ceremony. A relight
    //     that plays on every page load stops being a moment.
    //   - went dark -> unlocked while playing: hold it, point the child home, and play the full
    //     beat when they are back in the plaza with the tree in front of them.
    //
    // `relightSpent` is only ever set inside the `zoneTree` guard, and that placement is
    // load-bearing rather than tidy: the first version latched it outside, and the welcome message
    // routinely lands BEFORE the tree's own GLB has finished loading. A returning, already-unlocked
    // guest therefore spent the one-shot on a null tree and then stood in front of a dark one for
    // the rest of the session. Caught by drive-relight.mjs's "the tree is LIT, driven purely by
    // welcome state" check going 13/14, not by reading this back.
    if (rewardsKnown && !relightSpent) {
      if (!lanternUnlockedNow) {
        sawTreeDark = true;
        zoneTree?.setTreeLit(false);
      } else if (zoneTree) {
        if (!sawTreeDark) {
          zoneTree.setTreeLit(true);
          relightSpent = true;
        } else if (distance(player.position.x, player.position.z, TREE_X, TREE_Z)
          <= RELIGHT_TRIGGER_RADIUS_METERS) {
          zoneTree.beginRelight();
          zoneKeeper?.celebrate();
          // Played directly rather than through an event table: the ceremony is a client-side
          // presentation beat with no encounter or reward event behind it. audio/recipes.js's
          // DIRECTLY_PLAYED_RECIPES names it, so the "no unused recipes" test stays a real test.
          audio.play(RELIGHT_RECIPE_NAME);
          banner('The Lantern Tree is alight!', 3200);
          relightSpent = true;
        }
      }
    }
    zoneTree?.update(deltaSeconds);
    // THE CALL NORTH. Not proximity-gated, unlike the speech bubble Aldric's full line lives in --
    // a child watching the ceremony is standing at the tree, not next to him, and that is correct,
    // not a bug to route around. A SHORT banner and not his full three-sentence line: #banner is
    // `white-space: nowrap` for a reason -- built for "The Lantern Tree is alight!"-length text,
    // and KEEPER_LINE_UNLOCKED ran off both edges of a 768px frame when tried here (looked at,
    // gate-call-02-banner-fired.png). Echoes the chip's own already-vetted "follow the lit path
    // north" rather than inventing new words for a young player to parse.
    if (!gateCallGiven && !gateFound && (zoneTree?.isTreeLit() ?? false)) {
      gateCallGiven = true;
      zoneKeeper?.celebrate();
      audio.play(KEEPER_GREETING_RECIPE_NAME);
      banner('Aldric: follow the lit path north!', 3600);
    }
    // Flown toward the hero's CURRENT position, not the one he stood at when the wolf died, so a
    // child who keeps walking is still caught up with.
    // GP1-C6: the light landing IS the reward moment. See celebrateMarkArrival.
    const marksArrived = markSparks.update(deltaSeconds, player.position);
    if (marksArrived > 0) {
      marksInTheAir = Math.max(0, marksInTheAir - marksArrived);
      // The count the child is now looking at, derived the same way the pips are rather than kept as
      // a third running total -- the banner and the pips cannot say different numbers.
      celebrateMarkArrival(Math.max(0, authoritativeMarksThisFrame - marksInTheAir));
    }
    impactBursts.update(deltaSeconds);
    const keeperSpeech = keeperSpeechState({
      heroX: player.position.x,
      heroZ: player.position.z,
      keeperX: KEEPER_X,
      keeperZ: KEEPER_Z,
      radiusMeters: KEEPER_WAVE_RADIUS_METERS,
      lanternUnlocked: lanternUnlockedNow,
      // The Keeper counts your marks now. Same rewards object the pips read, so what he says and
      // what the HUD shows can never disagree.
      marks: rewardsForRelight?.marks ?? 0,
      // He stops sending a finished hero north once they have actually been.
      gateFound,
    });
    // Same radius idea as the Keeper's own (brief W1: "the same proximity the wave uses") -- there is
    // no wave to reuse for Rowan, but "close enough to talk to" is the same distance either way.
    const rowanSpeech = rowanSpeechState({
      heroX: player.position.x,
      heroZ: player.position.z,
      rowanX: ROWAN_X,
      rowanZ: ROWAN_Z,
      radiusMeters: KEEPER_WAVE_RADIUS_METERS,
      cartSearched,
      beaconFound,
      // G4: Rowan recognises the lit Beacon and keeps his word. `beaconLit` is the shared world
      // fact; `bladeOwned` is this child's own, so two brothers each hear the grant for themselves.
      beaconLit: siegeState.beaconLit,
      bladeOwned: bladeOwnedSeen === true,
    });
    // ONE bubble, shared: they stand tens of metres apart (the village plaza and the trail's own
    // camp) and can never both be in range at once, so there is no real priority decision here, only
    // a way to pick one shape when neither is visible.
    // ── ARC 2: WREN, WHO CAME BECAUSE OF THE FIRE ────────────────────────────────────────────
    //
    // Read every frame off the PUBLISHED world fact rather than latched on an edge. That is what
    // makes her right for a late joiner: a brother who connects an hour after the Beacon was lit
    // gets `beaconLit` true on his very first snapshot, and arrive() is idempotent, so he simply
    // finds a stranger already standing in his village -- no ceremony replayed for something that
    // happened before he was there.
    if (rangerIsHere(siegeState.beaconLit)) zoneRanger?.arrive();
    const rangerSpeech = rangerSpeechState({
      heroX: player.position.x,
      heroZ: player.position.z,
      rangerX: RANGER_X,
      rangerZ: RANGER_Z,
      radiusMeters: KEEPER_WAVE_RADIUS_METERS,
      satchelCarried: satchelCarriedSeen === true,
      charmOwned: charmOwnedSeen === true,
    });
    const npcSpeech = keeperSpeech.visible
      ? { visible: true, line: keeperSpeech.line, name: KEEPER_NAME }
      : rowanSpeech.visible
        ? { visible: true, line: rowanSpeech.line, name: ROWAN_NAME }
        // Wren joins the same chain, and the same "can never both be in range" argument holds for a
        // third speaker: she stands five metres from the hero spawn and eleven from the Keeper,
        // which is outside both radii. Gated on isHere() as well as on the speech state so a
        // hidden woman can never talk out of an empty patch of grass.
        : rangerSpeech.visible && zoneRanger?.isHere() === true
          ? { visible: true, line: rangerSpeech.line, name: RANGER_NAME }
          : { visible: false, line: null, name: null };
    renderNpcSpeech(npcSpeech);
    // AP2-A: the Keeper talks while his OWN line is on screen (setTalking gracefully no-ops on a rig
    // shipped without a 'talk' clip -- same optional-clip contract as wave/turn). Keyed on
    // keeperSpeech specifically, not the shared npcSpeech bubble above -- Rowan's line being visible
    // must not make the Keeper start talking from across the map.
    zoneKeeper?.setTalking(keeperSpeech.visible);
    // A soft two-note greeting on the EDGE into range, not every frame inside it. Walking up to
    // somebody who then talks at you in complete silence is the difference between a character and a
    // sign; firing it continuously would be the difference between a character and an alarm.
    if (npcSpeech.visible && !npcSpeaking) audio.play(KEEPER_GREETING_RECIPE_NAME);
    npcSpeaking = npcSpeech.visible;
    // Rowan has been met the moment their own line is first shown -- same "latched, not read live"
    // reasoning questGiven follows just below, so the beat does not un-happen when the child steps
    // back out of range.
    if (rowanSpeech.visible) rowanMet = true;
    // He has told you, so the objective chip can stop telling you first. Latched rather than read
    // live, so the instruction does not vanish again the moment the child steps out of his radius.
    if (keeperSpeech.visible) questGiven = true;
    // And the "!" over his head goes out with it. Shown only while he is the thing to do: a child
    // who has already been told, or who came back tomorrow with two marks on record, is not sent to
    // queue at an old man again. Keyed on the same latch the objective chip reads, so the floating
    // marker and the words in the corner can never disagree about whether he still wants you.
    const keeperWantsYou = !questGiven && (rewardsForRelight?.marks ?? 0) === 0;
    zoneKeeper?.setQuestMarker(keeperWantsYou);

    // THE VILLAGE NOTICES YOU ARRIVE.
    //
    // A child wakes up at the edge of the plaza with the whole village in front of them and, until
    // this, absolutely nothing happened until they had walked eighteen metres and stood inside a
    // six-metre circle around an old man. The first thing the game ever did was wait.
    //
    // Now, a beat after the world has finished loading, Aldric waves and calls across the plaza.
    // It is the same wave clip he already has and the same two-note greeting he already plays -- no
    // new mechanism, no cutscene, no camera takeover -- but it turns the opening from "you are
    // standing in a diorama" into "somebody over there wants you", which is the entire reason to
    // walk in. Once per session, and only while he still has the quest to give.
    if (zoneKeeper && keeperWantsYou && !keeperHailed) {
      secondsSinceZoneReady += deltaSeconds;
      if (secondsSinceZoneReady >= KEEPER_HAIL_DELAY_SECONDS) {
        keeperHailed = true;
        zoneKeeper.celebrate();
        audio.play(KEEPER_GREETING_RECIPE_NAME);
        banner('Keeper Aldric is waving you over!', 3200);
      }
    }
    // Keyed on the TREE, not on the unlock: between earning the third mark and walking home those
    // two disagree on purpose, and that window is exactly when the child most needs telling.
    const treeLitNow = zoneTree?.isTreeLit() ?? false;
    if (treeLitNow && !gateFound
      && distance(player.position.x, player.position.z, GATE_X, GATE_Z) <= VILLAGE.WILDWOOD_GATE.radiusMeters) {
      gateFound = true;
      banner('You found the Wildwood Gate!', 3000);
    }

    // THE DARK TRAIL. Carrying the lantern earned in Chapter 1 is what wakes the old lights -- see
    // world/trail.js. Gated on the tree being lit as well as the unlock, so the whole of Chapter 2
    // cannot start while a child is still being told to take the light home.
    // THE FRAME THE BLADE LANDS, computed once for everything the sword can hit.
    //
    // Hoisted above the Dark Trail's own gate because it now feeds THREE consumers -- the bramble
    // (inside that gate), the cold seals and the blackthorn (outside it, at the Beacon, which a
    // child can be standing at with a zone whose trail lamps never loaded). Detected by watching
    // the published swing clock CROSS contact rather than by hooking the attack button: online the
    // swing is the SERVER's, and this client only ever learns about it through
    // `encounterState.hero.swingSeconds`. Reading the same field in every mode is what stops any of
    // these becoming things that only work offline.
    const swingNow = encounterState.hero?.swingSeconds ?? -1;
    const bladeLanded = swingPrevious >= 0 && swingPrevious < SWING_CONTACT_SECONDS
      && swingNow >= SWING_CONTACT_SECONDS;
    swingPrevious = swingNow;

    if (treeLitNow && zoneTrailLights.length > 0) {
      const step = wakeTrailLights(
        trailLit, VILLAGE.TRAIL_LIGHTS, player.position.x, player.position.z,
        lanternUnlockedFromRewards(rewardsForRelight),
      );
      if (step.lit !== trailLit) {
        trailLit = step.lit;
        for (const index of step.woken) zoneTrailLights[index]?.setLit(true);
        audio.play(RELIGHT_RECIPE_NAME);
        // Once, on the first one, and it says what just happened rather than what to do -- the chip
        // underneath is already saying what to do, and a child who has seen a lamp light up in front
        // of them does not need to be told a lamp lit up.
        if (!trailWoken) {
          trailWoken = true;
          banner('Your lantern wakes the old lights!', 3400);
        }
      }
      // THE BLACK BRAMBLE. The sword's second job: a thing in the world that changes when you hit
      // it. Resolved on the frame the BLADE lands, not the frame the button is pressed -- the same
      // SWING_CONTACT_SECONDS the wolf is judged on -- so cutting a bramble and hitting a wolf feel
      // like the same action, because they are.
      //
      // Detected by watching the published swing clock cross contact, rather than by hooking the
      // attack button: online, the swing is the SERVER's, and this client only ever learns about it
      // through `encounterState.hero.swingSeconds`. Reading the same field in both modes means the
      // bramble cannot become a thing that only cuts offline.
      if (bladeLanded && zoneBrambles.length > 0) {
        const strike = strikeBrambles(brambleBlows, VILLAGE.BRAMBLES, (bramble) => {
          // Aimed at the nearest point ON the tangle, not at its centre. A five-metre hedge is
          // hittable anywhere along it, and measuring the swing's ARC against its midpoint would
          // make standing at one end and facing the part in front of you count as a sideways miss.
          const [x, z] = nearestPointOnBramble(bramble, player.position.x, player.position.z);
          return isWithinStrike(
            { x: player.position.x, z: player.position.z },
            player.heading,
            { x, z },
            ATTACK_REACH + BRAMBLE_EXTRA_REACH_METERS,
          );
        });
        if (strike.blows !== brambleBlows) {
          brambleBlows = strike.blows;
          for (const index of strike.struck) {
            zoneBrambles[index]?.hit(brambleBlows[index], strike.broken.includes(index));
          }
          // The wolf's own two sounds, reused rather than given the bramble a third pair: a blow
          // landing is a blow landing, and the point of this feature is that the sword does the
          // same thing to the world that it does to an animal.
          const recipe = soundForEvent(strike.broken.length > 0 ? 'wolf-defeated' : 'wolf-hit');
          if (recipe) audio.play(recipe);
          if (strike.broken.length > 0) banner('The bramble falls away!', 2600);
        }
      }
      for (const bramble of zoneBrambles) bramble.update(deltaSeconds);

      // G1: THE OLD BEACON ROAD'S OWN LAMPS. The same pure rule against the second list -- the
      // lantern goes on being the tool for the whole of the new stretch instead of expiring at the
      // camp. No banner: `trailWoken` above already spent the one-time "your lantern wakes the old
      // lights" beat, and saying it twice would turn a discovery into a notification.
      if (zoneBeaconRoadLights.length > 0) {
        const beaconStep = wakeTrailLights(
          beaconRoadLit, VILLAGE.BEACON_ROAD_LIGHTS, player.position.x, player.position.z,
          lanternUnlockedFromRewards(rewardsForRelight),
        );
        if (beaconStep.lit !== beaconRoadLit) {
          beaconRoadLit = beaconStep.lit;
          for (const index of beaconStep.woken) zoneBeaconRoadLights[index]?.setLit(true);
          audio.play(RELIGHT_RECIPE_NAME);
        }
      }

      if (!campFound && reachedCamp(VILLAGE.CAMP, player.position.x, player.position.z)) {
        campFound = true;
        banner('Somebody left here in a hurry…', 4000);
      }

      // G1: ARRIVING AT THE OLD BEACON. reachedCamp() is the generic "is the hero inside this
      // `{ at, radiusMeters }`" read (world/trail.js), the same one CART_SEARCH and
      // WORKSHOP_INTERACT already borrow -- one definition of "you got here", four users.
      //
      // Deliberately NOT gated on cartSearched, unlike the cart's own trigger being gated on
      // rowanMet. The cart is an object Rowan tells you about, so its beat only makes sense in their
      // order; the Beacon is a PLACE, and a child who walked all the way to it has found it whatever
      // else they skipped. The objective chip agrees (world/quest.js reads beaconFound first).
      // THE CART ROWAN SENDS YOU TO. Gated on rowanMet, not just proximity -- reachedCamp is
      // generic (world/trail.js) and CART_SEARCH is just another `{ at, radiusMeters }` to it, but
      // the beat only makes sense in the order Rowan's own line puts it: meet them, THEN search.
      if (campFound && rowanMet && !cartSearched
        && reachedCamp(VILLAGE.CART_SEARCH, player.position.x, player.position.z)) {
        cartSearched = true;
        banner('The cart holds tools and a map.', 3000);
        // GP2: tell the server too, online only. No offline fallback for physical loot -- it is a
        // one-time shared-world bonus, not core moment-to-moment play the way combat is, and the
        // banner above already covers offline play honestly (the plan's own pre-GP2 text). Reuses
        // this SAME trigger rather than a second copy of it, so "the narrative beat fires" and "the
        // server is told" can never drift out of step with each other.
        if (netStatus === 'online') net.sendSearchCart();
      }

      // GP2: the server's own loot state, diffed every frame -- see world/cartLoot.js's header for
      // why this is a diff and not a chase after a transient event, and world/lootPickups.js's own
      // header for why the burst/attraction/despawn sequence lives there and not inline here.
      const loot = netStatus === 'online' && serverEncounter?.loot ? serverEncounter.loot : EMPTY_LOOT;

      // GP3: has this Workshop just been bought? -- the cart-jolt idiom (this file's own
      // sawCartUnspawned/lootWasSpawned pair, just below): a session-local edge-tracking boolean,
      // diffed against the shared authoritative flag, firing the world-transform trigger once on the
      // false->true edge THIS CLIENT ACTUALLY WATCHED, the same "one shared moment, everyone sees it
      // from their own snapshot" contract the cart jolt and zoneLoader.js's treeLitTransition both
      // already give their own one-time world acknowledgements.
      //
      // GP3-C1 closeout addition: villageKnown mirrors rewardsKnown's own gate above (see that
      // constant's comment) -- serverEncounter.village can lag netStatus flipping 'online' by a frame
      // or two, and `village` folds to EMPTY_VILLAGE (workshopOwned: false) during that gap. Reading
      // that fold as a real "unowned" observation would arm EVERY late-joining or reconnecting client
      // to replay the full ceremony (audio + pop-in) for a purchase it never watched happen -- found
      // by tracing this edge-tracker's own logic against a restart-viewer tab rather than by a failing
      // check, the identical failure mode rewardsKnown's own comment already documents for the tree.
      // Gating workshopWasOwned's own update on villageKnown too closes the second half of the same
      // gap: an UNGATED late-joiner whose first known state is already-built must get the workshop
      // group made visible some other way, since trigger()'s ceremony path only ever fires on a
      // locally-witnessed false->true edge -- workshop.js's own trigger(true) is that other way.
      const villageKnown = netStatus === 'online' ? serverEncounter?.village != null : netStatus === 'offline';
      if (villageKnown) {
        if (!village.workshopOwned) {
          sawWorkshopUnowned = true;
        } else if (!workshopWasOwned) {
          if (sawWorkshopUnowned) {
            // Armed here, fired below, the first frame the Workshop is in front of this player. A
            // child standing at the door sees it start the instant the Board clears, exactly as when
            // this line triggered it directly; a child who tapped UPGRADE up at the cart sees it go
            // up as they walk back into the village, instead of arriving to find it already there.
            workshopCeremonyPending = true;
            // If this client's own Board happens to be open right now (the buyer's own screen, or a
            // sibling's Board that was open on some other node when the purchase landed), it dismisses
            // itself a beat later so the transforming Workshop is the very next thing this child sees
            // -- not a second manual tap required to get there.
            if (villageBoard.isOpen()) {
              window.setTimeout(() => villageBoard.close(), WORKSHOP_BOARD_AUTOCLOSE_MS);
            }
          } else {
            // A late joiner / a reconnect after someone else bought it: show the built Workshop
            // instantly, no ceremony -- the same "unlocked before this client ever saw it dark, light
            // it instantly" rule the Lantern Tree's own rewardsKnown branch already applies.
            zoneWorkshop?.trigger(true);
          }
        }
        workshopWasOwned = village.workshopOwned;
      }
      if (workshopCeremonyPending && zoneWorkshop != null && zoneWorkshop.hasAudience(camera, player.position)) {
        workshopCeremonyPending = false;
        zoneWorkshop.trigger();
        audio.play(WORKSHOP_BUILD_RECIPE_NAME);
      }
      zoneWorkshop?.update(deltaSeconds);

      // GP3-C1 (replaces GP3-4's old once-ever proximity auto-open, per Sol's closeout review): the
      // Workshop's own location is a DELIBERATE, REUSABLE interaction, not a walk-through trigger.
      // #workshop-interact only becomes tappable -- it never opens Hero/Gear on its own -- once the
      // Workshop is owned, its build ceremony has actually finished (zoneWorkshop.isTransforming(),
      // not a guessed millisecond delay: see workshop.js's own isTransforming comment), the hero is in
      // WORKSHOP_INTERACT range, and neither full-screen overlay already owns the input. Gating on
      // isTransforming() rather than time is what actually removes the reported Board/Hero crossfade
      // at the root: the Board already auto-closes at WORKSHOP_BOARD_AUTOCLOSE_MS (900ms), well before
      // the build's own WORKSHOP_BUILD_SECONDS (2.05s) finishes, so by the time this ever reads true
      // the Board is already gone -- no overlap is possible by construction, not by timing luck.
      // (Was POP_IN_SECONDS, 1.4s, when the ceremony was a single pop of an already-finished object.
      // The margin only grew when it became a staged build, but the number here was a stale claim
      // about another file either way -- GQ-002.)
      const workshopInteractAvailable = village.workshopOwned && zoneWorkshop != null
        && zoneWorkshop.isBuilt() && !zoneWorkshop.isTransforming()
        && !heroScreen.isOpen() && !villageBoard.isOpen()
        && reachedCamp(VILLAGE.WORKSHOP_INTERACT, player.position.x, player.position.z);
      renderWorkshopInteract(workshopInteractAvailable);

      // The cart's own cheap physical acknowledgement, once, the instant a snapshot first says the
      // cart is searched -- fires identically for every connected client off the SAME edge, regardless
      // of which player's own search caused it, the same "one shared moment, everyone sees it from
      // their own snapshot" contract zoneLoader.js's treeLitTransition already gives the Lantern Tree.
      if (netStatus === 'online' && !loot.spawned) sawCartUnspawned = true;
      if (loot.spawned && !lootWasSpawned && sawCartUnspawned) {
        cartReaction?.trigger();
        audio.play(CART_JOLT_RECIPE_NAME);
      }
      lootWasSpawned = loot.spawned;
      cartReaction?.update(deltaSeconds);

      // Bursts, sits, and (for whichever pickups THIS hero has reached) attracts and arrives. Returns
      // only the pickups whose attraction flight completed on this exact frame -- everything else
      // (still bursting, still resting, someone else's pickup despawning) is silent by design.
      const lootArrivals = lootPickups.update(deltaSeconds, loot, net.selfId, player.position);
      for (const arrival of lootArrivals) {
        revealedPickupIds.add(arrival.id);
        if (arrival.kind === COIN_KIND) {
          coinsDisplayed += 1;
          audio.play(COIN_PICKUP_RECIPE_NAME);
          popLootHud(COIN_KIND);
        } else {
          shardsDisplayed += 1;
          audio.play(SHARD_PICKUP_RECIPE_NAME);
          popLootHud(SHARD_KIND);
        }
      }
      // GP3 brief section 5: once this hero's own pickups are all either not-yet-collected-by-them
      // or already visually arrived (i.e. nothing of theirs is currently mid-flight), it is safe to
      // silently sync the displayed totals straight to the shared authoritative remaining balance --
      // a sibling's own collect, or a Workshop purchase, becomes visible immediately, with no fake
      // local flight invented for either. Skipped only while something of THIS hero's own is still
      // in flight: syncing then would reveal that hero's own not-yet-landed pickup early, exactly
      // the bug GP2's original arrival-gated delay exists to prevent.
      const somethingOfMineInFlight = CART_LOOT_TABLE.some(
        (pickup) => loot.collected[pickup.id] === net.selfId && !revealedPickupIds.has(pickup.id),
      );
      let backgroundSynced = false;
      if (!somethingOfMineInFlight && lootHudSeeded) {
        const remaining = remainingVillageSupplies(village.coins, village.shards, village.workshopOwned);
        if (remaining.coins !== coinsDisplayed || remaining.shards !== shardsDisplayed) {
          coinsDisplayed = remaining.coins;
          shardsDisplayed = remaining.shards;
          backgroundSynced = true;
        }
      }
      if (lootArrivals.length > 0 || backgroundSynced) renderLootHud();

      // The required sequence's own closing beat -- "leave with a reason to care about what the
      // resources are for" (the acceptance test's own words). Fired once the whole authored haul is
      // gone, not on this hero's own first pickup: the moment being closed out is the CART's, shared
      // by whoever is present when the last piece of it is collected, the same "one shared moment"
      // treatment the cart-jolt trigger above already gives the burst itself. GP3 (the Workshop) is
      // deliberately not named -- it does not exist as a mechanic yet, and this line only has to be
      // true today, not promise a feature nobody can act on.
      if (loot.spawned && !lootHookShown && Object.keys(loot.collected).length >= CART_LOOT_TABLE.length) {
        lootHookShown = true;
        banner('Coins and Wildwood Shards. Rowan will know what to do with these.', 3400);
      }

      // Ask the server to collect whatever is in reach and not yet gone -- throttled per pickup (see
      // lootRequestedAt's own comment), not every frame. The server re-checks reach, ownership and
      // "already gone" itself (world/cartLoot.js's requestCollectLoot); this is only "do not bother
      // asking for something obviously out of reach", and retries a refused ask rather than giving up
      // on it forever.
      if (loot.spawned && netStatus === 'online') {
        for (const pickup of CART_LOOT_TABLE) {
          if (loot.collected[pickup.id] != null) continue;
          const lastRequestedAt = lootRequestedAt.get(pickup.id);
          if (lastRequestedAt != null && frameStart - lastRequestedAt < LOOT_REQUEST_RETRY_MS) continue;
          const at = pickupWorldPosition(pickup, VILLAGE.CART_SEARCH.at);
          const distance = Math.hypot(player.position.x - at.x, player.position.z - at.z);
          if (distance <= PICKUP_COLLECT_RADIUS_METERS) {
            lootRequestedAt.set(pickup.id, frameStart);
            net.sendCollectLoot(pickup.id);
          }
        }
      }
    }

    // ── G2/G3: THE SIEGE ────────────────────────────────────────────────────────────────────
    //
    // Online the server owns it and this mirrors the published block; offline the same pure rules
    // run locally. Identical shape to the wolf's own mirror-or-step above, and for the identical
    // reason: everything downstream (the seals, the Warden's pose, the boss bar, the objective)
    // reads ONE object and never asks which mode produced it.
    //
    // `siegeSwingLanded` is the same published-clock read the bramble above uses (see its comment
    // on why this is watched rather than hooked off the button): the frame the hero's swing clock
    // CROSSES contact is the frame a seal or the Warden is struck, online and offline alike.
    // Online, these were separated out of the snapshot drain above; offline they are produced
    // right here by the local rules. Either way the dispatch below is the same code.
    const siegeEvents = pendingSiegeEvents;
    pendingSiegeEvents = [];
    const siegeSwingLanded = bladeLanded;
    if (netStatus === 'online') {
      const published = serverEncounter?.siege ?? null;
      if (published) {
        // Only the shared truth is taken from the wire. The hero clocks stay whatever the local
        // copy holds -- there is one hero with one set of hearts and the encounter block already
        // carries them (see net/gameServer.mjs's siegeSnapshot for the same rule stated there).
        siegeState = {
          ...siegeState,
          seals: published.seals,
          warden: { ...siegeState.warden, ...published.warden },
          beaconLit: published.beaconLit,
        };
      }
    } else {
      // The offline fight. Its events are dispatched HERE rather than joining the encounter's own
      // `events` array: that array is scoped to the `if (runtime.hero)` block further up, and this
      // whole trail section deliberately runs outside it so the world keeps working while the hero
      // mesh is still loading.
      const ownSiegeHeroId = OFFLINE_HERO_ID;
      if (siegeSwingLanded) {
        const asked = requestSiegeAttack(siegeState, ownSiegeHeroId, nextSiegeCommandId++);
        siegeState = asked.state;
        siegeEvents.push(...asked.events);
      }
      const steppedSiege = stepSiege(siegeState, {
        deltaSeconds,
        heroes: {
          [ownSiegeHeroId]: {
            position: { x: player.position.x, z: player.position.z },
            heading: player.heading,
            weaponDamage: swingDamageFor(equippedWeaponIdThisFrame),
          },
        },
      });
      siegeState = steppedSiege.state;
      siegeEvents.push(...steppedSiege.events);
    }

    // Online, the siege's events ride the same snapshots the wolf's do and are drained into
    // `pendingServerEvents` -- but that drain happens inside the `if (runtime.hero)` block above
    // and is filtered against combat/feedback.js's table, which knows nothing about seals. So the
    // siege's own events are separated out there and handed here, where their table lives.
    for (const event of siegeEvents) {
      const recipeName = soundForSiegeEvent(event.type);
      if (recipeName) audio.play(recipeName);
      if (event.type === 'warden-woke') banner('Something is standing up.', 3000);
      else if (event.type === 'warden-defeated') banner('The Beacon Warden falls!', 3000);
      else if (event.type === 'warden-hurt-hero') { flashHeroHurt(); renderHearts(event.remaining); }
      else if (event.type === 'hero-down') { showHeroDown(true); banner('You went down…', 1600); }
      else if (event.type === 'hero-respawned') { showHeroDown(false); renderHearts(heartCeiling); }
      else if (event.type === 'hero-healed') { renderHearts(event.remaining); popHearts(); }
      else if (event.type === 'siege-swing-missed') pulseMiss();
    }

    // THE SEALS, diffed. A presenter is told what it looks like now, never what happened -- so a
    // client that missed a snapshot still catches up, and a reload lands on the right silhouette.
    for (let index = 0; index < zoneColdSeals.length; index += 1) {
      const seal = siegeState.seals[index];
      if (!seal) continue;
      const seen = sealsSeen[index];
      if (seal.blows === seen.blows && seal.burst === seen.burst) continue;
      // The burst's own sound escalates across the three (audio/siegeRecipes.js): first, second,
      // third, where the third carries the low answer. Indexed by HOW MANY ARE NOW GONE rather
      // than by which seal it was, so breaking them in any order still escalates.
      if (seal.burst && !seen.burst) {
        const goneNow = siegeState.seals.filter((candidate) => candidate.burst).length;
        audio.play(`seal-burst-${Math.min(3, Math.max(1, goneNow))}`);
      } else if (seal.blows > seen.blows) {
        audio.play('seal-crack');
      }
      sealsSeen[index] = { blows: seal.blows, burst: seal.burst };
      zoneColdSeals[index]?.setBlows(seal.blows, seal.burst);
    }
    for (const seal of zoneColdSeals) seal.update(deltaSeconds);

    // THE WARDEN. Its pose is driven entirely by (mode, modeSeconds, phase) -- see
    // enemies/warden.js -- so this hands over three numbers and lets the presenter draw.
    const warden = siegeState.warden;
    zoneWarden?.setPosition(warden.x, warden.z);
    zoneWarden?.setHeading(warden.heading);
    zoneWarden?.setMode(warden.mode, warden.modeSeconds, warden.phase);
    zoneWarden?.update(deltaSeconds);
    // The attacks announce themselves on the MODE EDGE rather than off a drained event: a wind-up
    // whose sound arrived with the next snapshot would land after the arms had already moved.
    if (warden.mode !== wardenModeSeen) {
      if (warden.mode === 'overhead') audio.play('maul-windup');
      else if (warden.mode === 'sweep') audio.play('warden-sweep');
      else if (warden.mode === 'pulse') audio.play('cold-pulse');
      wardenModeSeen = warden.mode;
    }
    bossBar.update(bossBarState({
      mode: warden.mode, hp: warden.hp, maxHp: WARDEN_MAX_HP, phase: warden.phase,
    }));

    // ── G3 PAYOFF: THE BEACON LIGHTS ────────────────────────────────────────────────────────
    //
    // The world remembers. Gated on having SEEN it cold, the same rule the Lantern Tree's own
    // relight and the Workshop's build already follow -- a child who joins a world where the
    // Beacon is already burning gets a lit Beacon, not somebody else's ceremony.
    if (!siegeState.beaconLit) sawBeaconCold = true;
    if (siegeState.beaconLit && !beaconLitSeen) {
      beaconLitSeen = true;
      zoneOldBeacon?.ignite();
      if (sawBeaconCold) {
        audio.play('beacon-ignite');
        banner('The Old Beacon is burning!', 3600);
      }
    }

    if (!beaconFound && reachedCamp(VILLAGE.OLD_BEACON, player.position.x, player.position.z)) {
      beaconFound = true;
      // Says what the place IS, and stops. Not "you woke it", not "defend it" -- nothing here can
      // be woken or defended yet, and the chip underneath carries the "something is wrong" half.
      banner('You found the Old Beacon!', 3400);
      audio.play(BEACON_ARRIVAL_RECIPE_NAME);
      // The world's own answer: the dead cresset stirs once and falls back. No audience check
      // needed (world/oldBeacon.js explains why) -- the trigger IS this player standing in front
      // of it.
      zoneOldBeacon?.stir();
    }
    zoneOldBeacon?.update(deltaSeconds);

    // ── G5: THE BLACKTHORN, AND WHAT THE BLADE IS FOR ───────────────────────────────────────
    //
    // The one place in the game where WHICH WEAPON YOU ARE HOLDING changes what the world does.
    // Same contact discipline as the bramble above -- nearest point on the span, the bramble's own
    // extra reach -- because it is the same verb; the only difference is that the wall answers
    // differently depending on the sword, and that difference is the entire point of the reward.
    if (siegeSwingLanded && zoneBlackthorn && !hollowState.barrierTorn) {
      const [barrierX, barrierZ] = nearestPointOnBarrier(
        VILLAGE.BLACKTHORN, player.position.x, player.position.z,
      );
      const inReach = isWithinStrike(
        { x: player.position.x, z: player.position.z },
        player.heading,
        { x: barrierX, z: barrierZ },
        ATTACK_REACH + BRAMBLE_EXTRA_REACH_METERS,
      );
      if (inReach) {
        const struck = strikeBarrier(hollowState, equippedWeaponIdThisFrame);
        hollowState = struck.state;
        for (const event of struck.events) {
          const recipeName = soundForSiegeEvent(event.type);
          if (recipeName) audio.play(recipeName);
          if (event.type === 'blackthorn-tough') {
            zoneBlackthorn.shudder();
            // Says WHY, once it is worth saying. Not a failure message -- nothing was lost and
            // nothing is broken; the wall is simply not something this sword can answer.
            banner('Too tough for this blade.', 2200);
          } else if (event.type === 'blackthorn-torn') {
            zoneBlackthorn.tear();
            banner('The blackthorn tears open!', 3000);
          }
        }
      }
    }
    zoneBlackthorn?.update(deltaSeconds);
    zoneHollow?.update(deltaSeconds);

    // INSIDE. A discovery beat, per client and session-only like every other arrival in this file.
    if (!hollowFound && zoneBlackthorn?.isGone() === true
      && reachedCamp(VILLAGE.HOLLOW, player.position.x, player.position.z)) {
      hollowFound = true;
      banner('Blackthorn Hollow', 2600);
    }

    // ── ARC 2: THE END OF THE OLD ROAD ──────────────────────────────────────────────────────
    //
    // The same per-client, session-only discovery shape every other arrival in this file uses. It is
    // deliberately NOT gated on the blackthorn being cut, and that is not laziness: nothing in this
    // game collides, so a child who walks round the tangle has still walked the road, and refusing
    // them the banner for taking the wrong line would be the game arguing with something it can
    // plainly see them doing. The tangle's job is to make them WANT the Blade, not to be a wall.
    if (!lodgeFound && reachedCamp(VILLAGE.LODGE, player.position.x, player.position.z)) {
      lodgeFound = true;
      // Names the place and claims nothing else -- the same rule the Beacon's own arrival banner
      // follows. Whether anybody is home is a thing the child can see for themselves: the lantern at
      // its gable is not lit.
      banner('The Ranger Lodge', 3000);
    }
    // The chest. Its lid is local presentation; its contents are a durable, server-authoritative
    // award, so the ask is throttled exactly the way a loot pickup's is (see lootRequestedAt).
    if (hollowFound && !hollowState.chestOpened
      && reachedCamp({ at: VILLAGE.HOLLOW.chestAt, radiusMeters: 1.8 }, player.position.x, player.position.z)) {
      const opened = openChest(hollowState);
      hollowState = opened.state;
      for (const event of opened.events) {
        const recipeName = soundForSiegeEvent(event.type);
        if (recipeName) audio.play(recipeName);
      }
      zoneHollow?.open();
      banner('A ranger left something here.', 3200);
      if (netStatus === 'online' && frameStart - hollowRequestedAt >= LOOT_REQUEST_RETRY_MS) {
        hollowRequestedAt = frameStart;
        net.sendClaimHollow();
      }
    }

    // ── ARC 2: THE SATCHEL, LIFTED ──────────────────────────────────────────────────────────
    //
    // The CLUE, not the chest. They are 2.2 m apart in the same pocket, and picking the satchel up
    // has to be its own crossing of its own ground rather than something that happens for free
    // because a lid opened nearby -- the satchel is the beat, and a beat you get without walking to
    // it is not a beat. Throttled rather than one-shot, exactly like the chest above and for the
    // same reason: the first ask can legitimately race the server's own view of where this hero is.
    if (hollowFound && satchelCarriedSeen === false && netStatus === 'online'
      && reachedCamp({ at: VILLAGE.HOLLOW.clueAt, radiusMeters: 1.8 }, player.position.x, player.position.z)
      && frameStart - satchelRequestedAt >= LOOT_REQUEST_RETRY_MS) {
      satchelRequestedAt = frameStart;
      net.sendClaimSatchel();
    }

    // ── G4: "THE BLADE IS YOURS" ────────────────────────────────────────────────────────────
    //
    // Rowan's oldest promise, collected. The CONDITION is world/rowanSpeech.js's own
    // rowanOwesBlade -- the identical function net/gameServer.mjs re-checks before granting
    // anything, so this client can never offer something the server would refuse.
    //
    // Asked for rather than granted: ownership is durable and per guest, and only the server can
    // write it. Throttled, not one-shot, for the same reason the loot requests are -- the first
    // ask can legitimately race the server's own view of where this hero is standing.
    if (netStatus === 'online' && bladeOwnedSeen === false
      && rowanOwesBlade({
        inRange: reachedCamp(VILLAGE.ROWAN_CLAIM, player.position.x, player.position.z),
        beaconLit: siegeState.beaconLit,
        bladeOwned: false,
      })
      && frameStart - bladeRequestedAt >= BLADE_REQUEST_RETRY_MS) {
      bladeRequestedAt = frameStart;
      net.sendClaimBlade();
    }

    // ── ARC 2: "TAKE THIS" ──────────────────────────────────────────────────────────────────
    //
    // Wren's own claim, and the CONDITION is world/rangerSpeech.js's rangerOwesCharm -- the
    // identical function net/gameServer.mjs re-checks before granting anything, so this client can
    // never offer something the server would refuse. Same throttle, same reasoning and the same
    // shape as the Blade directly above; only what is being asked for is different.
    if (netStatus === 'online' && charmOwnedSeen === false
      && rangerOwesCharm({
        inRange: reachedCamp(VILLAGE.RANGER_CLAIM, player.position.x, player.position.z),
        beaconLit: siegeState.beaconLit,
        satchelCarried: satchelCarriedSeen === true,
        charmOwned: charmOwnedSeen === true,
      })
      && frameStart - charmRequestedAt >= LOOT_REQUEST_RETRY_MS) {
      charmRequestedAt = frameStart;
      net.sendClaimCharm();
    }


    // ONE objective, read once, rendered two ways. The chip shows its words and the pointer shows
    // where it is -- and because they are the same value rather than two calls, the arrow can never
    // point at a different errand from the one named above it. That is the whole reason an objective
    // became a thing with a NAME instead of a sentence.
    //
    // The optional chain keeps the null branch working: questObjectiveFor returns null before there
    // are any rewards to reason about, and both renderers treat null as "show nothing".
    const currentObjective = questObjectiveFor(
      rewardsKnown ? rewardsForRelight : null, treeLitNow, gateFound, questGiven,
      {
        lights: VILLAGE.TRAIL_LIGHTS.length,
        lit: trailLightsLit(trailLit),
        campFound,
        rowanMet,
        cartSearched,
        beaconFound,
        atBramble: nearStandingBramble(brambleBlows, VILLAGE.BRAMBLES, player.position.x, player.position.z),
      },
      // G2..G5: the arc's own state, read the same way the trail's is -- one object of plain
      // booleans and counts, so world/quest.js stays a pure function of what is true right now.
      {
        sealsLeft: siegeState.seals.filter((seal) => !seal.burst).length,
        wardenMode: siegeState.warden.mode,
        beaconLit: siegeState.beaconLit,
        bladeOwned: bladeOwnedSeen === true,
        blackthornTorn: hollowState.barrierTorn,
        hollowFound,
        lodgeFound,
      },
    );
    renderQuestObjective(currentObjective?.text ?? null);
    // The two dynamic destinations -- the next dark light, the next unbroken seal -- are not supplied
    // yet, so those objectives draw no arrow rather than a wrong one. destinationFor returns null for
    // a place the caller could not name, which is the same answer as "this one has nowhere", and the
    // pointer treats both as nothing to say. Wiring them is its own slice.
    const pointer = renderObjectivePointer(currentObjective, {});
    // NaN when the errand has no place -- "cut the bramble" is the thing in front of you and has no
    // coordinate to be far from. The watch treats that as nothing to measure rather than as a child
    // standing still, so a placeless stretch cannot accumulate a stuck clock.
    rescueTarget = destinationFor(currentObjective, {});
    renderRescueOffer(rescueWatch.update({
      distanceMeters: rescueTarget
        ? Math.hypot(player.position.x - rescueTarget.x, player.position.z - rescueTarget.z)
        : NaN,
      objectiveId: currentObjective?.id ?? null,
      // THE RAW DELTA, not the clamped one. `deltaSeconds` above is clamped to 0.1 so a hitch
      // cannot teleport the hero -- a physics bound. Patience is wall-clock: a child staring at an
      // unchanging screen for twelve seconds has been staring for twelve seconds whether the device
      // manages sixty frames a second or two. Feeding the physics clamp here made the clock run at
      // 40% of real time on a starved device, measured, and the offer simply never arrived.
      // guidanceRescue.js applies its own bound for the backgrounded-tab case.
      deltaSeconds: frameDeltaMs === null ? 0 : frameDeltaMs / 1000,
    }).offering
      // ONLY WHEN TURNING WOULD HELP. Tapping this aims the camera at the errand and does nothing
      // else, so offering it while the errand is already in frame offers a button that cannot change
      // anything. A control that does nothing when pressed teaches a child to stop pressing things,
      // which is the opposite of what a rescue is for. The clock keeps running underneath -- a child
      // who is stuck while looking straight at the thing is still stuck, and the moment they turn
      // away the offer is there immediately rather than twelve seconds later.
      && pointer.pointing === true);
    follow.update(player.position);
    rimLight.update(player.position);
    runtimeRenderer.renderer.render(scene, camera);
    // GP1-C3: drawn OVER the world pass, against a depth buffer this call clears first. No-op unless
    // the Hero screen is open. See render/heroPreview.js for why that ordering is the whole fix.
    heroPreview.render(runtimeRenderer.renderer, scene);
    const frameCostMs = performance.now() - frameStart;
    quality.recordFrame(frameCostMs, frameDeltaMs);
    diagnostics.recordFrame(frameCostMs);
    diagnostics.update(loadingLabel, quality.level.name);
  };
  window.requestAnimationFrame(frame);

  const hero = await loadHero();
  loadingLabel = null;
  scene.add(hero.root);
  runtime.hero = hero.root;
  // GP1-C4: the shipping sword's anchor, so ensureEquippedWeaponMesh can hide it when the Blade is
  // the equipped weapon. Nullable on purpose -- a failed hero load leaves rigidGear empty, and a
  // missing sword must not throw on a frame loop that is otherwise still playable.
  shippingSwordMount = hero.rigidGear?.find((item) => item.id === SHIPPING_SWORD_MESH_ID) ?? null;
  // AP2-A shipped raw Idle_11 with the settle off (createLocomotionController's own doc comment).
  // window.__DEBUG_FORCE_IDLE_SETTLE__ exists only so a future idle-candidate review can reuse
  // review-hero-idle11.mjs's raw-vs-settled A/B without editing this file -- deliberately opt-IN
  // (must be explicitly set to true), so an unset/forgotten global can never silently re-enable a
  // correction Sol ruled off. Undefined in every real session, so this changes nothing shipped.
  locomotion = createLocomotionController(hero.root, hero.animations, {
    applyIdleSettle: window.__DEBUG_FORCE_IDLE_SETTLE__ === true,
  });
  // Prefer the real clip; fall back to the procedural arc only if the hero ships without one. The
  // choice is made here rather than hidden inside a module so that a hero export that quietly loses
  // its attack clip degrades to a visible stand-in instead of to a hero who does not move his arm.
  swing = createClipSwingAnimator(hero.root, hero.animations) ?? createSwingAnimator(hero.root);
  // Null only if the rig ships neither clip. The shipped hero carries both (`hit`/`death`,
  // encounter.js's STAGGER_SECONDS/DEATH_SECONDS are pinned against their real durations in
  // test/clip-inventory.test.mjs), so this stays live in every real session; degrading to the
  // hurt flash and banners alone is the fallback for a future export that loses one, not today.
  reactions = createReactionAnimator(hero.root, hero.animations);
  // Remote heroes clone this same loaded asset, so the pool cannot exist before it has arrived. Until
  // then sampleRemotes() is simply never drawn -- snapshots still buffer, so nobody is missed.
  remotes = createRemotePlayers(scene, hero);
  status.dataset.fault = hero.failed ? 'true' : 'false';
  status.textContent = hero.failed ? 'hero load failed — placeholder shown' : 'hero standing';

  // The wolf is loaded after the hero and never awaited alongside it. A missing or broken wolf must
  // leave a walkable world rather than an empty screen -- the same rule the socket follows.
  try {
    const wolf = await loadWolf();
    if (!wolf.failed) {
      scene.add(wolf.root);
      wolfPresenter = createWolfPresenter(wolf.root, wolf.animations);
    } else {
      console.warn('[runtime] wolf load failed — world is playable without it');
    }
  } catch (error) {
    console.warn('[runtime] wolf load threw — world is playable without it', error);
  }
}

bootstrap().catch((error) => {
  console.error('[runtime] bootstrap failed', error);
  status.dataset.fault = 'true';
  status.textContent = 'runtime failed — see console';
});
