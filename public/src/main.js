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
  canSpecialAttack,
  canHeroSpecialAttack,
  createEncounterState,
  requestAttack,
  requestSpecialAttack,
  // GP1-C5: the hero's own down time, so the "you are coming back" bar finishes exactly when he
  // stands up. Imported rather than restated -- a bar that promises 2s while the rules take 3 is
  // worse than no bar, and this is precisely the "one number, one home" case GQ-007 names.
  RESPAWN_SECONDS,
  stepEncounter,
  requestSoloHeroHeal,
} from './combat/encounter.js';
import {
  SPECIAL_ATTACK_NAME,
  SPECIAL_ATTACK_SECONDS,
  SPECIAL_ATTACK_UNLOCK_LEVEL,
  canUseSpecialAttackAtPosition,
  isOutsideSpecialArena,
} from './combat/specialAttack.js';
import { createEncounterFeedback, healthReadout, isOutOfCombatRegenRise } from './combat/feedback.js';
import { ENEMY_KINDS, killXpForKind } from './combat/enemyStats.js';
import { createAudioEngine } from './audio/engine.js';
import {
  CART_JOLT_RECIPE_NAME,
  COIN_PICKUP_RECIPE_NAME,
  GEAR_PICKUP_RECIPE_NAME,
  HEART_PICKUP_RECIPE_NAME,
  KEEPER_GREETING_RECIPE_NAME,
  LEVEL_UP_RECIPE_NAME,
  RELIGHT_RECIPE_NAME,
  SHARD_PICKUP_RECIPE_NAME,
  WORKSHOP_BUILD_RECIPE_NAME,
  BEACON_ARRIVAL_RECIPE_NAME,
  RUNE_CHEST_BRILLIANT_RECIPE_NAME,
  RUNE_CHEST_OPEN_RECIPE_NAME,
  soundForEvent,
} from './audio/recipes.js';
import {
  attachBeltLantern,
  attachSilverguardHelmet,
  attachSilverguardShoulder,
  attachWildwoodBladeCandidate,
  BELT_LANTERN_URL,
  RIGID_BELT_LANTERN,
  RIGID_SILVERGUARD_HELMET,
  SILVERGUARD_HELMET_HIDES_ANATOMY,
  SILVERGUARD_HELMET_URL,
  SILVERGUARD_SHOULDER_URL,
  WILDWOOD_BLADE_CANDIDATE_URL,
  silverguardShoulderAnchorId,
} from './character/gear.js';
import { SHIPPING_SWORD_MESH_ID, weaponMeshIdFor, weaponVisibility, WILDWOOD_BLADE_CANDIDATE_ID }
  from './character/weaponLoadout.js';
import { MARKS_TO_UNLOCK } from './rewards/marks.js';
import {
  OFFLINE_HERO_ID,
  createLifeIdMinter,
  createOfflineProgress,
} from './rewards/offlineProgress.js';
import { xpToastText } from './rewards/xpToastView.js';
import {
  DEFAULT_EQUIPPED_ITEM_IDS,
  DEFAULT_EQUIPPED_WEAPON_ID,
  DEFAULT_OWNED_ITEM_IDS,
  SHOULDERS_SLOT,
  SHOULDER_SILVERGUARD_ID,
  swingDamageFor,
} from './progression/items.js';
import {
  canEquip,
  equippedItemIdsFromRewards,
  equippedWeaponIdFromRewards,
  ownedItemIdsFromRewards,
} from './progression/state.js';
// P2: how strong this hero actually is, and whether a level a presenter is about to show deserves a
// ceremony. Both live in progression/ so the offline fallback here and net/gameServer.mjs's online
// fight resolve ONE law -- see that module's own header on why there must not be two.
import { damageReductionPercentForEquipment, levelUpTransition, resolveHeroStats } from './progression/heroStats.js';
import { cumulativeXpForLevel } from './progression/levels.js';
import { formatPower, levelUpSummary, powerChange, powerFor } from './progression/power.js';
import { prefersReducedMotion } from './render/motionPreference.js';
import { createHeroScreen, heroScreenViewModel, swatchFor, swatchHexFor } from './progression/heroScreen.js';
// #88's equip feedback. equipOutcome is the pure receipt of a swap (what left the slot, what POWER
// did) and flyGearIcon is the movement that makes it legible -- kept apart for the usual reason:
// the numbers are testable without a browser and the animation is not.
import { equipOutcome } from './progression/gearCompare.js';
import { itemIconSvgFor, itemIconUrlFor } from './progression/itemArt.js';
import { flyGearIcon } from './ui/gearFlight.js';
import { createVillageBoardScreen, villageBoardViewModel } from './village/boardScreen.js';
import { remainingVillageSupplies } from './village/economy.js';
import { pipsForMarks } from './rewards/hud.js';
import { REWARD_EVENT_TYPES, createRewardFeedback, soundForRewardEvent } from './rewards/feedback.js';
import { createMarkSparks } from './rewards/markSpark.js';
import { createImpactBursts } from './render/impactBurst.js';
import { loadGLB } from './world/assets.js';
import { createWolfPresenter, loadWolfFactory, WOLF_SCALE, WOLF_SPARK_HEIGHT_METERS } from './enemies/wolf.js';
import { createEnemyPresenterRegistry } from './enemies/presenterRegistry.js';
import { presentationForKind } from './enemies/enemyKindPresentation.js';
import {
  createEnemyNameplateLayer,
  ENEMY_NAMEPLATE_MAX_DISTANCE,
  ENEMY_NAMEPLATE_SAFE_WIDTH,
  clampNameplateProjection,
  nameplateProjectionIsSafe,
} from './enemies/nameplate.js';
import { createGlowSprite, setGlowStrength } from './render/glow.js';
import {
  COIN_DROP_KIND,
  DROP_COLLECT_RADIUS_METERS,
  GEAR_DROP_KIND,
  HEART_DROP_KIND,
  HEART_HEAL_HP,
  createEnemyDropsState,
  requestCollectEnemyDrop,
  requestEnemyDrop,
  stepEnemyDrops,
} from './world/enemyDrops.js';
import { createEnemyDropsPresenter } from './world/enemyDropsPresenter.js';
// #87: the CLIENT half of personal corpse loot. world/corpseLoot.js's own law and
// net/gameServerCore.mjs's own corpsesSnapshot are unchanged by this file -- this only reads what the
// server already put on the wire (see corpseLootPresenter.js's own header for why that reading is
// still where per-player isolation is provable client-side, twice over).
import {
  corpseLootPanelViewModel,
  corpsesToGlowFor,
  dismissLootPanelForCombat,
  nearestLootableCorpse,
  newlyTakenItems,
} from './world/corpseLootPresenter.js';
import { CORPSE_COIN_KIND } from './world/corpseLoot.js';
import { createCorpseLootGlowPresenter } from './world/corpseLootGlowPresenter.js';
import {
  createCorpseLootInteract, createCorpseLootPanel, createCorpseLootToastLayer,
} from './ui/corpseLootPanel.js';
import {
  coinMultiplierForStreak, createStreakState, registerKill as registerStreakKill, stepStreak,
  streakStillActive,
} from './progression/streaks.js';
import { streakMeterView } from './progression/streakView.js';
// THE HIDDEN LEARNING LAYER: every 8th kill this hero personally lands spawns a rune chest. Pure
// rules live in progression/runeChests.js (this module's own header explains why it is CLIENT-LOCAL
// and offline-first rather than following R1's server-authoritative kill drops); the mesh is
// world/runeChestPresenter.js and the question card is ui/runeChestCard.js.
import {
  CHEST_COLLECT_RADIUS_METERS,
  closeRuneChest,
  createRuneChestState,
  heroInCombat,
  judgeRuneChestAnswer,
  openRuneChest,
  pickChestSpawnPoint,
  registerRuneChestKill,
  rewardXpForRuneChestAnswer,
  runeChestXpEventId,
} from './progression/runeChests.js';
import { createRuneChestPresenter } from './world/runeChestPresenter.js';
import { createRuneChestCard } from './ui/runeChestCard.js';
import { createPrototypeCompanionPresenter, loadPrototypeCompanion } from './companions/prototypeCompanion.js';
import { createSwingAnimator } from './character/swing.js';
import { createClipSwingAnimator } from './character/swingClip.js';
import { createReactionAnimator } from './character/reactClips.js';
// The same function the chooser draws its cards with, so the chip and the card cannot disagree
// about which animal a child is. progression/heroAvatars.js is the one place that decides.
import { avatarForProfile } from './progression/heroAvatars.js';
import {
  ATTACK_REACH,
  HERO_MAX_HP,
  SWING_CONTACT_SECONDS,
  SWING_SECONDS,
  WOLF_AGGRO_RANGE,
  WOLF_BITE_RANGE,
  isWithinStrike,
  separateFromEnemies,
} from './combat/encounter.js';
import { createAttackInput } from './input/attackButton.js';
import { createKeyboardInput } from './input/keyboard.js';
import { pointerModeFor } from './input/pointerMode.js';
import { firstHurtCoachingLine } from './ui/coaching.js';
import { createTouchInput } from './input/touch.js';
import { createCameraGesture } from './input/cameraGesture.js';
import { createDiagnostics } from './debug/diagnostics.js';
import { createNetClient } from './net/client.js';
import { createProfileStore } from './progression/profiles.js';
import { createProfileGate, profileGateViewModel } from './progression/profileGate.js';
import { foldFacts } from './progression/facts.js';
import { createRemotePlayers } from './net/remotes.js';
import { CHARACTER, WORLD, setLayer } from './render/layers.js';
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
import {
  KEEPER_NAME, keeperSpeechState, speakKeeperLine, speakKeeperLineIfUnlocked,
} from './world/keeperSpeech.js';
import { ROWAN_NAME, rowanOwesBlade, rowanSpeechState } from './world/rowanSpeech.js';
import {
  RANGER_NAME, rangerIsHere, rangerOwesCharm, rangerSanctuaryHolds, rangerSpeechState,
} from './world/rangerSpeech.js';
import { questObjectiveFor } from './world/quest.js';
import { destinationFor, nearestPlaceTo } from './world/destinations.js';
import { createRescueWatch, targetKeyFor } from './ui/guidanceRescue.js';
import { DEFAULT_RANGE_METERS, minimapPlacement, minimapPolyline } from './ui/minimap.js';
import { formatGuideMeters, guideArrowFor } from './render/guideArrow.js';
import { createGuidePath } from './render/guidePath.js';
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
// G3 follow-up: the Beacon's own collision -- see that module's header for why this has to be the
// SAME pure function net/gameServerCore.mjs runs, not merely the same rule.
import { resolveObstacleCollisions, worldObstacles } from './world/obstacles.js';
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
  separateFromWarden,
  stepSiege,
} from './world/beaconSiege.js';
// The overhead boss bar rides above the Warden's own actual height, imported rather than guessed --
// the same "one number, one owner" rule WARDEN_MAX_HP above already keeps (GQ-007).
import { WARDEN_HEIGHT_METERS } from './enemies/warden.js';
import {
  BLACKTHORN_BLOWS_TO_TEAR,
  createHollowState,
  nearBarrier,
  nearestPointOnBarrier,
  openChest,
  strikeBarrier,
} from './world/blackthornHollow.js';
import { BOSS_BAR_SAFE_HEIGHT, BOSS_BAR_SAFE_WIDTH, bossBarState, createBossBar } from './ui/bossBar.js';
import { createUnlockCard, unlockCardState } from './ui/unlockCard.js';
import { SIEGE_EVENT_RECIPE_MAP, soundForSiegeEvent } from './audio/siegeRecipes.js';
import { HELMET_SILVERGUARD_ID, HELMET_SLOT, WILDWOOD_BLADE_ID, damageFor, itemDef } from './progression/items.js';
import { predictionStep } from './net/prediction.js';
import * as VILLAGE from './world/zones/village.js';

// Computed once: the Village's own blockers (world/obstacles.js) never move mid-session, so
// re-deriving them from zone data every frame would be pure waste.
const WORLD_OBSTACLES = worldObstacles();

// Defensive fallbacks for the online mirror, for the one frame (if any) where netStatus has
// already flipped to 'online' but onEncounter has not yet run -- see net/client.js: setStatus is
// called before onEncounter inside the same synchronous 'welcome' handler, so in practice this
// window never survives to a rendered frame. Kept anyway so a mirror read never throws.
const EMPTY_SERVER_ENCOUNTER = Object.freeze({
  revision: 0,
  enemies: Object.freeze([]),
  heroes: Object.freeze({}),
});
// The wire's hero shape (protocol.js decodeHeroes): only the four fields a client needs to
// predict its own attack button and render health. Matches createPartyEncounterState's freshHero
// on those same four fields.
const DEFAULT_HERO_VIEW = Object.freeze({
  hp: HERO_MAX_HP, swingSeconds: -1, cooldown: 0, downSeconds: -1, protectionSeconds: 0,
  specialSeconds: -1, specialCooldown: 0,
});
// Shared with net/gameServer.mjs through the zone data both sides import (Phase R2, GQ-007). These
// used to be two hand-written copies of `{ x: 2.5, z: 8 }` kept equal by a human noticing, because
// gameServer.mjs is server-only and cannot be imported here -- the fix was not to import the server,
// it was to give both sides the same PURE data module to read. Used to boot the offline fallback
// below and to give the online mirror a real spawn to carry (see the frame loop's
// `netStatus === 'online'` branch and its comment).
const {
  ENEMY_POPULATION, HERO_SPAWN, RECOVERY_SANCTUARY, WOLF_SPAWN, WOLF_SPAWNS,
} = VILLAGE;
const ENEMY_DEFINITIONS = new Map(ENEMY_POPULATION.map((enemy) => [enemy.enemyId, enemy]));

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

// R1: the Alpha Wolf's own glowing eyes -- measured directly off wolf.glb's own bind-pose bone chain
// (Armature -> Hips -> chest -> head -> headend), not guessed. See the enemy presenter's own comment
// on these for the full method and the honest caveat about no live in-game confirmation being
// possible in this sandbox.
const ALPHA_EYE_LOCAL_LEFT = Object.freeze([0.03, 0.707, 0.697]);
const ALPHA_EYE_LOCAL_RIGHT = Object.freeze([-0.03, 0.707, 0.697]);
const ALPHA_EYE_SIZE_METERS = 0.05;

const canvas = document.querySelector('#game-canvas');
const status = document.querySelector('#runtime-status');
const perfHud = document.querySelector('#perf-hud');
const attackButtonElement = document.querySelector('#attack-button');
const specialButtonElement = document.querySelector('#special-button');

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
const POINTER_MODE = pointerModeFor(navigator.maxTouchPoints);
document.querySelector('#game').dataset.pointer = POINTER_MODE;

// ── KILL iOS DOUBLE-TAP ZOOM ─────────────────────────────────────────────────────────────────────
//
// The playtest's report: kids get trapped by double-tap zoom, worse in STANDALONE (Add-to-Home-
// Screen) mode, where there is no browser chrome -- no address bar, no pinch-to-reset affordance --
// to rescue them. index.html's own viewport meta (maximum-scale=1, user-scalable=no) is the primary
// fix and stops the platform from ever entering a zoomed state; these two are belt-and-braces for
// gestures a browser can still try to read as zoom intent even with scaling disabled.
//
// dblclick fires for a fast double-tap the same way it does for a real mouse double-click, and
// preventing its default suppresses whatever residual zoom/selection behaviour rides along with it
// WITHOUT touching the two ordinary click events underneath -- a button double-tapped this way still
// receives both clicks. Global and unconditional: there is no click-through case where the page
// benefits from a double-tap doing anything special.
document.addEventListener('dblclick', (event) => event.preventDefault());

// STANDALONE ONLY, and stronger: a capture-phase touchend guard that swallows the SECOND of two taps
// landing inside 300ms on a NON-interactive target -- which is the touch that actually triggers the
// browser's native double-tap-zoom, ahead of dblclick ever firing. `navigator.standalone` is Safari's
// own (non-standard, iOS-only) flag for exactly this mode; `display-mode: standalone` is the same
// state everywhere else PWAs report it.
//
// Scoped to non-interactive targets ONLY, and this is not a style choice -- preventDefault on
// touchend cancels the synthetic click that would otherwise follow it. This is precisely why the
// touch stick's own double-tap guard was removed on 2026-08-11 (input/touch.js's own comment): it
// dropped a real re-grab, measured 42ms apart, because it discarded input rather than only zoom.
// A button, input, link, label, or anything inside [data-thumb-surface] (the stick/attack button) or
// [data-ui-surface] (an overlay's own chrome) is left alone here -- those already carry their own
// touch-action rule (index.html) and their click has to survive a fast double-tap, e.g. mashing
// ATTACK or double-tapping a Hero screen item.
const STANDALONE_DISPLAY_MODE = Boolean(
  window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true,
);
if (STANDALONE_DISPLAY_MODE) {
  const DOUBLE_TAP_GUARD_INTERACTIVE_SELECTOR = 'button, input, textarea, select, a, label, '
    + '[data-thumb-surface], [data-ui-surface]';
  const DOUBLE_TAP_GUARD_WINDOW_MS = 300;
  let lastNonInteractiveTouchEndAt = 0;
  document.addEventListener('touchend', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(DOUBLE_TAP_GUARD_INTERACTIVE_SELECTOR)) return;
    const now = Date.now();
    if (now - lastNonInteractiveTouchEndAt <= DOUBLE_TAP_GUARD_WINDOW_MS) event.preventDefault();
    lastNonInteractiveTouchEndAt = now;
  }, { capture: true, passive: false });
}

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
  // ALWAYS-ON WAYFINDING, part one of two. The playtest finding this exists for: "need much clearer
  // arrows and dotted paths on where to go next... they should basically always be there." A pooled
  // sprite trail in world space, driven every frame by the same destinationFor() answer that already
  // aims the edge arrow below -- see render/guidePath.js's own header for why it is world space and
  // not a HUD overlay, and why a straight line is the right amount of pathfinding for a flat plane.
  const guidePath = createGuidePath(scene);

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
  // G1-C3: the first earned armour, the same null-means-not-known-yet latch the Blade uses. A child
  // who earned the Helmet in an earlier session adopts "owned" silently on their first frame; only a
  // genuine false->true within a live session fires the acquisition card. Ownership, not equipment:
  // the Helmet arrives owned-but-off, and putting it on is the card's Equip beat, never automatic.
  let helmetOwnedSeen = null;
  let shoulderOwnedSeen = null;
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
  const specialAttack = createAttackInput(specialButtonElement);
  const specialButtonStateElement = document.querySelector('#special-button-state');
  function renderSpecialButton(hero, level, ready) {
    const unlocked = level >= SPECIAL_ATTACK_UNLOCK_LEVEL;
    specialButtonElement.dataset.unlocked = String(unlocked);
    if (!unlocked) specialButtonStateElement.textContent = `LV ${SPECIAL_ATTACK_UNLOCK_LEVEL}`;
    else if ((hero.specialSeconds ?? -1) >= 0) specialButtonStateElement.textContent = 'FIRING';
    else if ((hero.specialCooldown ?? 0) > 0) specialButtonStateElement.textContent = `${Math.ceil(hero.specialCooldown)}s`;
    else specialButtonStateElement.textContent = ready ? 'READY' : 'WAIT';
    specialButtonElement.setAttribute('aria-label', unlocked
      ? `${SPECIAL_ATTACK_NAME} ${specialButtonStateElement.textContent}`
      : `${SPECIAL_ATTACK_NAME}, unlocks at level ${SPECIAL_ATTACK_UNLOCK_LEVEL}`);
  }
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
  // Companion taps are a narrow pointer seam layered after the existing stick/attack/camera seams.
  // A short, stationary pointer-up on the canvas can ask the companion presenter to react; thumb
  // pointers and camera drags are explicitly left to their existing owners.
  const companionTapPointers = new Map();
  gameSurface.addEventListener('pointerdown', (event) => {
    const targetElement = event.target instanceof Element ? event.target : null;
    const targetLayer = targetElement?.closest('#unlock-card-layer, #hero-screen, #village-board-screen, #rune-chest-card');
    const targetIsVisibleOverlay = targetLayer?.dataset.shown === 'true';
    if (targetElement?.closest('button, [data-thumb-surface]') || targetIsVisibleOverlay
      || touch.ownsPointer(event) || attack.ownsPointer(event)) return;
    companionTapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }, { passive: true });
  gameSurface.addEventListener('pointerup', (event) => {
    const start = companionTapPointers.get(event.pointerId);
    companionTapPointers.delete(event.pointerId);
    const targetElement = event.target instanceof Element ? event.target : null;
    const targetLayer = targetElement?.closest('#unlock-card-layer, #hero-screen, #village-board-screen, #rune-chest-card');
    const targetIsVisibleOverlay = targetLayer?.dataset.shown === 'true';
    if (!start || targetElement?.closest('button, [data-thumb-surface]') || targetIsVisibleOverlay
      || heroScreen.isOpen() || villageBoard.isOpen() || runeChestCard.isOpen()) return;
    if (touch.ownsPointer(event) || attack.ownsPointer(event)) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) return;
    if (companionPresenter?.hitTest(event.clientX, event.clientY, canvas, camera)) {
      companionPresenter.triggerHappyReaction();
    }
  }, { passive: true });
  gameSurface.addEventListener('pointercancel', (event) => {
    companionTapPointers.delete(event.pointerId);
  }, { passive: true });

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
  // Equip one item durably. ONE act, ONE identity: the device mints the fact -- eventId and durable
  // revision together -- at the moment the child chose, journals it, and then tells the server about
  // that same fact rather than asking the server to invent a second one. Both copies therefore carry
  // the same name and the same place in the order, which is what makes holding two copies a union
  // rather than a disagreement (docs/MISTAKES.md GQ-014).
  //
  // Journalled BEFORE it is sent, and sent only when there is a server: a child who equips with no
  // network has equipped. The send is how the server finds out, not how it becomes true -- and if it
  // never gets sent, the reconnect path below delivers it. Shared by the Hero screen's EQUIP button
  // and G1-C3's acquisition-card EQUIP NOW, so the two beats mint one kind of fact, not two.
  function equipHeroItem(itemId) {
    if (!canEquip(itemId)) return;
    const fact = profiles.mintEquipFact(profileId, itemId);
    refreshProfileState();
    if (netStatus === 'online') net.sendEquip(itemId, fact ?? undefined);
  }
  // ── #41 / #88: THE POWER MOMENT ON EQUIP ──────────────────────────────────────────────────────
  //
  // "Major equipment upgrades should show a clear before -> delta -> after POWER moment" (#41), and
  // #88 asks for the change to be obvious rather than inferred. This is that moment, drawn ON the
  // Hero screen's own identity panel -- the place a child is already looking when they equip -- and
  // NOT as a new full-screen modal.
  //
  // THE CEREMONY COLLISION RULE, honoured rather than mentioned. PROGRESSION_CONTRACT_V0: "Hero
  // level-up remains the strongest routine celebration. Do not stack a gear modal over a level-up
  // ceremony." Two things follow, and both are implemented here:
  //
  //   1. This is not a modal at all. It takes no pointer events, blocks nothing, and disappears on
  //      its own -- so equipping never interrupts play, which is also the contract's "routine loot
  //      must not turn progression into menu interruption".
  //   2. If the level-up ceremony is currently up, this stays silent. The child gets one loud beat,
  //      and it is the bigger one. The equip still HAPPENED and the identity panel's POWER still
  //      updates on the next frame -- what is suppressed is the second celebration, not the fact.
  const heroPowerBurstElement = document.querySelector('#hero-power-burst');
  const POWER_BURST_MS = 1500;
  let powerBurstTimer = null;

  function showEquipPowerBurst(power) {
    if (!heroPowerBurstElement || !power) return;
    // A swap that moved nothing has nothing to announce. Silence is the honest output, and a "+0"
    // flying off a hero's POWER is a celebration of nothing.
    if (power.delta === 0) return;
    // Queried here rather than closed over: the level-up ceremony's own element is declared far
    // below this point, and a `const` referenced before its declaration is a ReferenceError that
    // optional chaining does not save you from. Once per equip is not a cost worth a forward
    // declaration for.
    if (document.querySelector('#level-up')?.dataset.shown === 'true') return;

    heroPowerBurstElement.textContent = power.deltaText;
    heroPowerBurstElement.dataset.direction = power.delta > 0 ? 'up' : 'down';
    // The attribute has to actually leave and come back for the CSS animation to re-trigger, which
    // needs a frame in between -- the same reason celebrateLevelUp waits one.
    delete heroPowerBurstElement.dataset.shown;
    window.requestAnimationFrame(() => { heroPowerBurstElement.dataset.shown = 'true'; });
    window.clearTimeout(powerBurstTimer);
    powerBurstTimer = window.setTimeout(() => {
      delete heroPowerBurstElement.dataset.shown;
    }, POWER_BURST_MS);
  }

  const heroScreen = createHeroScreen({
    onSelect: (itemId) => { selectedHeroItemId = itemId; },
    // #88's SECOND tap. The durable swap is unchanged -- equipHeroItem mints exactly the fact it
    // always did -- and everything added here is feedback about a change that has already happened.
    // That ordering matters: the animation must never be the thing that makes an equip true, or a
    // child who taps while the screen is closing owns nothing.
    onEquip: (itemId, context = {}) => {
      // Read the loadout BEFORE the swap, because that is the only moment "what am I replacing" is
      // still answerable. heroStatsThisFrame is the same resolved hero the fight is being fed, so
      // the POWER this moment celebrates is the POWER the combat model agrees with.
      const before = heroStatsThisFrame;
      const equippedBefore = before?.equippedItemIds ?? {};
      const outcome = equipOutcome({ itemId, equippedItemIdsBefore: equippedBefore, stats: before });

      equipHeroItem(itemId);
      selectedHeroItemId = itemId;

      if (!outcome) return;
      flyGearIcon({
        sourceElement: context.sourceElement ?? null,
        slotElement: context.slotElement ?? heroScreen.slotElement(outcome.slot),
        art: {
          iconUrl: itemIconUrlFor(itemId),
          iconSvg: itemIconSvgFor(itemId),
          accent: swatchFor(itemId),
        },
        // Null on a first fill, and deliberately so: inventing a return flight for an item that was
        // never in the slot would tell a child something false about what they own.
        replacedArt: outcome.replacedItemId === null ? null : {
          iconUrl: itemIconUrlFor(outcome.replacedItemId),
          iconSvg: itemIconSvgFor(outcome.replacedItemId),
          accent: swatchFor(outcome.replacedItemId),
        },
      });
      showEquipPowerBurst(outcome.power);
      audio.play('blade-unlock');
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
      specialButtonElement.dataset.suspended = String(open);
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
      specialButtonElement.dataset.suspended = String(open);
      gameSurface.dataset.villageBoardOpen = String(open);
    },
  });
  // THE HIDDEN LEARNING LAYER: the rune chest's own question card. Same suspend-input shape Hero and
  // the Village Board both take (touch/attack suspended, the other two closed first) -- the brief's
  // own "suspend movement like other overlays" -- but no camera dolly and no HUD-hiding data attribute
  // beyond the shared `anyOverlayOpen` gate below: this is a five-second modal beat over whatever the
  // world already looks like, not a screen a child dwells inside.
  const runeChestCard = createRuneChestCard({
    onAnswer: (answerIndex) => onRuneChestAnswer(answerIndex),
    onOpenChange: (open) => {
      if (open) { heroScreen.close(); villageBoard?.close(); }
      touchStickElement.dataset.suspended = String(open);
      attackButtonElement.dataset.suspended = String(open);
      specialButtonElement.dataset.suspended = String(open);
      // Suppressed the instant the card closes (answered OR dismissed) so a hero still standing
      // inside CHEST_COLLECT_RADIUS_METERS does not have the card instantly reopen under their own
      // thumb -- see runeChestCardSuppressed's own declaration comment for the guard this drives.
      if (!open) runeChestCardSuppressed = true;
    },
  });
  const player = {
    groundSpeed: 0,
    heading: 0,
    position: new THREE.Vector3(),
  };
  let locomotion = null;
  let remotes = null;
  let wolfVisualFactory = null;
  const enemyPresenters = createEnemyPresenterRegistry({
    createPresenter(enemy) {
      // R1: every density-package kind (ember-wolf, frost-wolf, alpha-wolf) reuses the SAME shipped
      // wolf.glb -- no new GLBs were authored for it -- so any kind the rules table recognises gets a
      // presenter; an unrecognised kind still returns null rather than drawing a default body.
      if (!ENEMY_KINDS.includes(enemy.kind)) return null;
      // bootstrap loads the shared Wolf source after the render loop is already live. `undefined`
      // means "supported, not ready yet" to the registry, so the same stable id is retried next
      // frame rather than being replaced with a placeholder authority.
      if (wolfVisualFactory === null) return undefined;
      if (wolfVisualFactory.failed) return null;

      const visual = wolfVisualFactory.create();
      visual.root.name = `wolf:${enemy.enemyId}`;

      // THE KIND'S OWN APPEARANCE, read from the one table wolf.js is deliberately blind to
      // (enemies/enemyKindPresentation.js) -- scale and tint, applied here rather than inside wolf.js
      // so the shared Wolf presenter never has to know a density push exists. wolf.js's own
      // prepareWolfRoot already clones every material per instance for exactly this reason (so one
      // Wolf's hit flash cannot bleed onto another's), which is what makes multiplying `.color` here
      // safe: it never touches a material another enemy or the local hero shares.
      const appearance = presentationForKind(enemy.kind);
      visual.root.scale.multiplyScalar(appearance.scaleMultiplier);
      if (appearance.tintColor !== 0xffffff) {
        const tint = new THREE.Color(appearance.tintColor);
        visual.root.traverse((object) => {
          if (!object.isMesh) return;
          for (const material of [].concat(object.material)) material?.color?.multiply(tint);
        });
      }

      // THE ALPHA'S OWN EYES. Positions are measured, not guessed, off wolf.glb's own bind-pose bone
      // chain (Armature -> Hips -> chest -> head -> headend), the same "look before you derive"
      // discipline every hand-fit gear anchor in character/gear.js already follows -- interpolated
      // 35% of the way from the head joint toward the nose tip, in the same pre-WOLF_SCALE,
      // root-relative space WOLF_SPARK_HEIGHT_METERS/WOLF_SCALE already uses for the lantern spark on
      // this same body. No WebGL in this sandbox to confirm the placement in the running game (this
      // repo's own hard rule); a future capture showing the eyes adrift is the real acceptance test.
      const eyeSprites = [];
      if (appearance.glowEyes) {
        for (const local of [ALPHA_EYE_LOCAL_LEFT, ALPHA_EYE_LOCAL_RIGHT]) {
          const eye = createGlowSprite(appearance.eyeColor, ALPHA_EYE_SIZE_METERS / WOLF_SCALE);
          eye.name = 'alpha-wolf-eye';
          eye.position.set(local[0], local[1], local[2]);
          setLayer(eye, CHARACTER);
          setGlowStrength(eye, 1);
          visual.root.add(eye);
          eyeSprites.push(eye);
        }
      }

      scene.add(visual.root);
      const wolfPresenter = createWolfPresenter(visual.root, visual.animations);
      const materials = new Set();
      visual.root.traverse((object) => {
        if (!object.isMesh) return;
        for (const material of [].concat(object.material)) if (material) materials.add(material);
      });
      return {
        update: (deltaSeconds, state) => wolfPresenter.update(deltaSeconds, state),
        flashHit: () => wolfPresenter.flashHit(),
        flashDefeated: () => wolfPresenter.flashDefeated(),
        flashSeen: () => wolfPresenter.flashSeen(),
        getState: () => wolfPresenter.getState(),
        mixer: wolfPresenter.mixer,
        dispose() {
          wolfPresenter.dispose();
          scene.remove(visual.root);
          for (const material of materials) material.dispose?.();
          for (const eye of eyeSprites) eye.material.dispose?.();
        },
      };
    },
  });
  let companionPresenter = null;
  let companionReactionElement = null;
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
  // hidden mutable fields. Everything downstream -- the swing, enemy presenters, the health bar, the
  // status line -- reads THIS, and none of them reach into the rules, whether it holds the local
  // step's result or the server's mirror. That is what made the move to a server-owned fight a
  // change of who calls stepParty rather than a rewrite of every reader.
  let encounterState = createEncounterState({
    enemies: ENEMY_POPULATION,
    heroSpawn: HERO_SPAWN,
    recoverySanctuary: RECOVERY_SANCTUARY,
  });

  // R1: kill drops and the streak meter. `dropsState` is the OFFLINE-ONLY authority -- online, drops
  // live entirely on the server (serverEncounter.drops) and this client only ever renders/collects
  // them, the same "the server owns physical truth" split the cart's own loot already keeps. The
  // presenter itself is shared by both modes: it only ever reads whatever drops array it is handed.
  let dropsState = createEnemyDropsState();
  const dropsPresenter = createEnemyDropsPresenter(scene);
  // #87: personal corpse loot's own physical presenter -- server-authoritative only (there is no
  // offline corpse-loot state, see net client's own sendCollectCorpseItem/All comment), so this only
  // ever reads serverEncounter.corpses. `previousCorpses` starts null rather than [] on purpose:
  // world/corpseLootPresenter.js's own newlyTakenItems treats null/undefined as "no baseline yet" and
  // suppresses arrivals, so a hero who reconnects onto an already-resolved claim never gets a
  // retroactive toast for gear they took last session. That guard has to be re-armed every time this
  // hero goes offline, not only at bootstrap: an IN-PAGE reconnect (net/client.js's own
  // reconnectTimer) never reloads this module, so a snapshot taken right before the blip would
  // otherwise sit here as a stale baseline keyed to the old, now-dead heroId. The corpse-loot loop
  // below resets it back to null the instant this hero is not online, so the first snapshot after any
  // reconnect is always treated as a fresh "no baseline yet" welcome, exactly like bootstrap.
  const corpseGlowPresenter = createCorpseLootGlowPresenter(scene);
  let previousCorpses = null;
  // This hero's own body as of the last snapshot, for the combat-dismissal diff below. Re-armed to
  // null wherever previousCorpses is, and for the identical reason: a reconnect mints a fresh heroId,
  // and a stale body kept across that blip would compare two different heroes' hit points.
  let previousSelfBody = null;
  let heroButtonLootPulseTimer = null;
  // Offline-only: world/enemyDrops.js's own lifeId is deliberately non-durable ("used only to keep
  // this kill's drop ids distinct... never persisted or checked for durable idempotency"), so a
  // fresh minter local to drops is correct -- it does not need to correlate with the mark/XP minter's
  // own durable ids at all, only to never repeat within this session.
  const mintDropLifeId = createLifeIdMinter();
  // Same throttled-retry shape LOOT_REQUEST_RETRY_MS/lootRequestedAt already give cart pickups (see
  // that pair's own comment for why a one-shot Set undercounts a hero merely passing near a drop).
  const dropRequestedAt = new Map();
  const DROP_REQUEST_RETRY_MS = 500;
  // The kill-streak meter's own rolling state, mirrored CLIENT-SIDE off observed wolf-defeated events
  // (progression/streaks.js's own header: pure, caller-clocked). The server keeps its own per-player
  // streak to size coin drops and never puts it on the wire, so this is a mirror rather than a read
  // of authority -- and it has to mirror the SAME kills the server counts, because the meter draws
  // the very coin multiplier the server will pay (see the wolf-defeated dispatch below for the
  // measured two-child divergence that made this explicit). It counts exactly the kills this hero
  // personally finished; only the 30 s decay CLOCK is approximate, because this side steps it by
  // frame delta and the server by tick delta, so a kill landing within a few hundred milliseconds of
  // STREAK_WINDOW_SECONDS can still read one tier out for one kill. A page reload also starts the
  // mirror at zero while the server holds its streak until the socket closes.
  let streakState = createStreakState();

  // THE HIDDEN LEARNING LAYER: rune chests. CLIENT-LOCAL AND OFFLINE-FIRST -- unlike dropsState just
  // above, this is not mirrored from a server at all, online or off (progression/runeChests.js's own
  // header explains why: a chest is a per-child learning beat, never shared/adjudicated world state).
  // Driven identically in both netStatus branches off the SAME myKillEnemyIds gate the XP toast
  // already uses, further down in this loop.
  let runeChestState = createRuneChestState();
  const runeChestPresenter = createRuneChestPresenter(scene);
  // Set the instant registerRuneChestKill reports a threshold crossed with no chest already standing;
  // cleared the instant a legal spot is actually found (see the placement attempt further down the
  // frame loop). Staying `true` across a frame or two is expected and harmless -- it only means the
  // hero happened to be standing somewhere pickChestSpawnPoint's own isAllowed refused every candidate
  // it tried (inside the Beacon arena, say), and the next frame's fresh rng draws simply try again
  // from wherever the hero has since walked to.
  let runeChestSpawnDue = false;
  // A fresh minter local to chests, the identical "never persisted, only never repeats this session"
  // discipline mintDropLifeId just above takes for the identical reason: runeChests.js's own openRune
  // Chest header is explicit that a chest's id is never checked for durable idempotency beyond naming
  // the one xp-earned fact it eventually pays (runeChestXpEventId).
  const mintChestId = createLifeIdMinter();
  // Guards against an instant re-open the SAME session the card was closed on: set true the instant
  // runeChestCard's own onOpenChange fires closed, cleared the instant the hero actually LEAVES
  // CHEST_COLLECT_RADIUS_METERS -- see the proximity check further down. Without this a dismissed
  // card (the brief's own "a kid can just walk away... dismissing leaves the chest for later") would
  // reopen on the very next frame, because the hero is by definition still standing inside the radius
  // that opened it the first time. Harmless no-op after an ANSWER too (the chest is null by then, so
  // the proximity check that reads this never even finds a chest to gate).
  let runeChestCardSuppressed = false;

  // A metre of clearance past the arena's/sanctuary's own radius, so a chest never spawns hugging
  // the boundary line either -- the brief's own "never spawn a chest inside the beacon arena or the
  // sanctuary" read generously rather than to the exact metre. World-knowledge lives HERE, not in
  // progression/runeChests.js (that module's own pickChestSpawnPoint header: "a pure progression/
  // rule has no business duplicating" world/bounds.js or world/zones/village.js), which is what keeps
  // this the one place the exclusion rule can ever disagree with itself.
  const RUNE_CHEST_EXCLUSION_MARGIN_METERS = 1;
  function runeChestSpotAllowed(x, z) {
    if (clampToWorldX(x) !== x || clampToWorldZ(z) !== z) return false;
    const [arenaX, arenaZ] = VILLAGE.BEACON_ARENA.at;
    if (Math.hypot(x - arenaX, z - arenaZ) < VILLAGE.BEACON_ARENA.radiusMeters + RUNE_CHEST_EXCLUSION_MARGIN_METERS) {
      return false;
    }
    if (Math.hypot(x - RECOVERY_SANCTUARY.at.x, z - RECOVERY_SANCTUARY.at.z)
      < RECOVERY_SANCTUARY.radiusMeters + RUNE_CHEST_EXCLUSION_MARGIN_METERS) {
      return false;
    }
    return true;
  }

  function enemyById(enemyId) {
    if (typeof enemyId !== 'string') return null;
    return encounterState.enemies.find((enemy) => enemy.enemyId === enemyId) ?? null;
  }

  // Runtime-test compatibility keeps the old singular Wolf presenter meaningful after E2 made
  // ordinary enemies a collection. A fixture with one Wolf may use any id; a multi-Wolf world
  // must name the opening authored identity rather than falling back to collection order.
  function openingEnemyOfKind(kind, preferredEnemyId = 'wolf-1') {
    const matches = encounterState.enemies.filter((enemy) => enemy.kind === kind);
    if (matches.length === 1) return matches[0];
    const preferred = matches.filter((enemy) => enemy.enemyId === preferredEnemyId);
    return preferred.length === 1 ? preferred[0] : null;
  }

  function mirrorPublishedEnemy(enemy) {
    // Patrol cursors are simulation-private and intentionally do not ride the wire. The current
    // shipped kind is Wolf, so reconnect-to-offline preserves the exact authored Wolf patrol the
    // legacy singular mirror used. A future kind with no authored client patrol remains where the
    // server last published it rather than borrowing Wolf geography.
    const authored = ENEMY_DEFINITIONS.get(enemy.enemyId);
    const patrol = authored?.patrol?.map((point) => ({ x: point.x, z: point.z }))
      ?? (enemy.kind === 'wolf'
        ? WOLF_SPAWNS.map((point) => ({ x: point.x, z: point.z }))
        : [{ x: enemy.x, z: enemy.z }]);
    const { targetId, ...published } = enemy;
    return {
      ...published,
      patrol,
      home: authored?.home ? { x: authored.home.x, z: authored.home.z } : { x: enemy.x, z: enemy.z },
      homeAuthored: authored?.home !== undefined,
      leashRadius: authored?.leashRadius,
      spawnIndex: 0,
      biteCooldown: 0,
      biteLanded: false,
    };
  }

  let nextCommandId = 1;
  // Online-only mirror of the server's last published encounter block (party-shaped: { revision,
  // enemies, heroes }), set from net client's onEncounter. canHeroAttack needs this exact shape --
  // heroes keyed by id -- which is why it is kept separate from `encounterState` above rather than
  // merged into it; `encounterState` itself is overwritten every online frame with a collection-
  // shaped solo view for the existing local hero consumers (see the frame loop).
  let serverEncounter = null;
  // The server's respawn event is a durable proof edge, not a render-frame sample. Keep the last
  // protection value carried by that authoritative event so slow hosted polling can prove that the
  // sanctuary rule happened even if the two-second countdown has already elapsed by the next read.
  let authoritativeRecoveryProtectionSeconds = 0;
  let authoritativeDownObserved = false;
  // Events queued between frames by onEncounter (snapshots arrive at 10 Hz, independent of the
  // 60fps frame loop) and drained once per frame, the same shape the offline path builds locally.
  let pendingServerEvents = [];
  // Presentation-only local clock for the swing clip while online (Design ruling 3): started the
  // instant ATTACK is pressed and accepted, so the sword moves before the round trip confirms it,
  // then handed off to the server's own hero.swingSeconds (mirrored below) the moment it catches
  // up. Never read by canHeroAttack or anything that decides combat truth -- only by the one
  // swing?.update() call in the frame loop.
  let predictedSwingSeconds = -1;
  // What the swing ANIMATION is being driven by on the frame just drawn -- see swingSecondsForClip
  // below, which is this same number. Held here so it can be published: a harness reading only
  // encounterState().hero.swingSeconds sees the AUTHORITATIVE swing, which is -1 for the whole
  // round trip after a tap, and the hero is visibly winding up during that. Measured hosted at
  // 9732a1a: the capture named `swing-windup` was rejected as "not during a swing" on a read taken
  // 530ms into an arc, because the server had not confirmed it yet on a runner painting every 401ms.
  let swingSecondsShown = -1;

  // G3/G4: the two payoff surfaces. Appended to #game after everything else so they paint over the
  // HUD -- see ui/bossBar.js and ui/unlockCard.js, which own their own markup and CSS.
  const bossBar = createBossBar(document);
  const unlockCard = createUnlockCard(document);
  gameSurface.appendChild(bossBar.element);
  gameSurface.appendChild(unlockCard.element);

  // #87: the corpse loot prompt/panel/toast. Same "appended after everything else so it paints over
  // the HUD" placement as bossBar/unlockCard just above.
  const corpseLootPanel = createCorpseLootPanel(document, {
    onCollectItem: (claimItemId) => {
      const corpseId = corpseLootPanel.currentCorpseId();
      if (corpseId) net.sendCollectCorpseItem(corpseId, claimItemId);
    },
    onCollectAll: () => {
      const corpseId = corpseLootPanel.currentCorpseId();
      if (corpseId) net.sendCollectCorpseAll(corpseId);
    },
  });
  // The corpse this hero is currently close enough to open -- set every frame by the loot loop below,
  // read back only when the prompt is actually tapped (main.js's own onOpen callback), the same
  // "compute every frame, act only on the click" split #workshop-interact's own renderWorkshopInteract
  // keeps against heroScreen.open().
  let promptCorpseId = null;
  const corpseLootInteract = createCorpseLootInteract(document, {
    onOpen: () => {
      if (!promptCorpseId || !serverEncounter?.corpses) return;
      const corpse = serverEncounter.corpses.find((c) => c.id === promptCorpseId);
      if (!corpse || net.selfId == null) return;
      corpseLootPanel.show(corpse.id, corpseLootPanelViewModel(corpse, net.selfId));
    },
  });
  const corpseLootToastLayer = createCorpseLootToastLayer(document);
  gameSurface.appendChild(corpseLootInteract.element);
  gameSurface.appendChild(corpseLootPanel.element);
  gameSurface.appendChild(corpseLootToastLayer.element);

  const bannerElement = document.querySelector('#banner');
  let bannerTimer = null;
  // THE OTHER HALF OF THE NARRATIVE, AND IT WAS SILENT.
  //
  // keeperSpeech.js makes the argument in full for the speech bubble: a child who cannot read was
  // being handed sentences, and the whole of this game's story reached its stated audience only if a
  // pre-reader found a 44px grey circle and guessed what it was for. That fix landed on the bubble
  // and stopped there. The banner is the OTHER surface the game tells its story on -- the wolf
  // beaten, the tree alight, the gate found, where to go next, all 28 of them -- and every one was
  // squiggles on a grey bar to the player this game is for.
  //
  // Same latch, deliberately: nothing here speaks to a child who never asked. `unlocked` is set by a
  // real tap on the bubble's speaker button, which is both iOS's price for making a sound at all and
  // the child's own signal that they want to be read to. One tap, ever, and the game starts reading
  // itself out -- bubble and banner together, because a child does not know they are two systems.
  //
  // It CANCELS whatever is mid-sentence, which is defaultSpeak's existing law and worth stating
  // rather than discovering: "the line on screen and the line being read have to be the same line".
  // A banner is the most recent thing the game chose to say, so it wins, and a Keeper line it cuts
  // off is still on screen with its speaker button still there to replay it.
  //
  // `spoken` exists because the screen and the ear want different strings for the same fact:
  // "LANTERN MARK  2 / 3" is right to look at and reads aloud as "two slash three".
  function banner(text, milliseconds, spoken = text) {
    bannerElement.textContent = text;
    bannerElement.dataset.shown = 'true';
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => { bannerElement.dataset.shown = 'false'; }, milliseconds);
    speakKeeperLineIfUnlocked(spoken);
  }

  // A bar and a number, not the status line's "you Nhp": see combat/feedback.js for the reference
  // research behind that choice and for why P2's per-level max HP is what retired the pip row.
  // healthReadout() is the only part of this worth unit testing; wiring its result onto three spans
  // is not.
  const healthElement = document.querySelector('#hero-health');
  const healthFillElement = document.querySelector('#hero-health .health-fill');
  const healthCurrentElement = document.querySelector('#health-current');
  const healthMaxElement = document.querySelector('#health-max');
  // How big THIS body is, remembered between renders. Every renderHealth caller in the frame loop
  // knows an hp and most of them do not know a max (a 'hero-healed' event carries `remaining` and
  // nothing else), so the max is latched here from the one place that does know it -- the published
  // hero -- rather than threaded through every call site.
  let healthMax = HERO_MAX_HP;
  // What the readout is currently SHOWING, so the per-frame read in the loop repaints on a change
  // rather than rewriting the same three nodes sixty times a second.
  let healthShown = { hp: HERO_MAX_HP, maxHp: HERO_MAX_HP };
  // Below this share of the body the bar changes colour -- see #hero-health[data-low] in index.html
  // for why that is a second channel rather than decoration. A third, matching the promise both
  // fights already make: three wolf bites, or three Warden blows, is a fresh hero's whole body, so
  // "one mistake left" and "the bar has gone orange" are the same moment by construction.
  const HEALTH_LOW_FRACTION = 1 / 3;
  // ── The teaching latches ────────────────────────────────────────────────────────────────────
  // Three things a child learns ONCE and must never be taught again: that the Keeper gave them a
  // quest, that they can move, that they can swing. All three are declared here and HYDRATED from
  // the active profile further down, once durableProfileId exists -- not at the declaration, because
  // that runs long before the profile store is read and a hydrate up here would be reading a
  // variable that does not exist yet. This branch has already shipped one temporal dead zone.
  let combatCoached = false;
  let movementTaught = false;
  function renderHealth(hp, maxHp = healthMax) {
    const readout = healthReadout(hp, maxHp);
    healthMax = readout.max;
    // Percentage width rather than a transform: the track has `overflow: hidden` and a rounded end,
    // and a scaled child would squash its own corner radius as it shrank.
    healthFillElement.style.width = `${readout.fraction * 100}%`;
    healthCurrentElement.textContent = String(readout.current);
    healthMaxElement.textContent = String(readout.max);
    // Strictly below, so a hero sitting exactly on the threshold is not already being warned.
    healthElement.dataset.low = String(readout.fraction < HEALTH_LOW_FRACTION);
  }

  // The heal's own signal -- see the #hero-health[data-healing] rule in index.html. Same
  // hold-then-release shape as flashHeroHurt below; the CSS owns the fade.
  let healthPopTimer = null;
  function popHealth() {
    healthElement.dataset.healing = 'true';
    window.clearTimeout(healthPopTimer);
    healthPopTimer = window.setTimeout(() => { delete healthElement.dataset.healing; }, 200);
  }

  // R1: out-of-combat regen's own cue -- a slow LOOPING shimmer rather than a one-shot pop, so it
  // never reads as the same event a real heal already announces. See combat/feedback.js's own
  // isOutOfCombatRegenRise for how the frame loop tells the two apart, and index.html's own
  // #hero-health[data-regen] rule for the animation itself. Held open for a beat past the last
  // observed regen tick (rather than cleared the instant one frame shows no rise) so the shimmer
  // does not flicker between individual ~0.25s regen ticks.
  let healthRegenTimer = null;
  const REGEN_SHIMMER_HOLD_MS = 700;
  function pulseRegen() {
    healthElement.dataset.regen = 'true';
    window.clearTimeout(healthRegenTimer);
    healthRegenTimer = window.setTimeout(() => { delete healthElement.dataset.regen; }, REGEN_SHIMMER_HOLD_MS);
  }

  // Floating damage numbers. Until now a landed hit was only visible as the wolf's own spark
  // dimming one notch -- readable if you already know to look for it, invisible to a child watching
  // the swing land. Positioned by projecting the wolf's world position through the CURRENT camera
  // once, at the moment it pops, rather than tracked every frame for its own short life: 900ms is
  // short enough that a fixed spawn point still reads as "the hit landed there", and tracking it
  // would mean carrying a live reference into a frame loop for an effect that owes the DOM nothing
  // else, the same reasoning popHealth() above already follows.
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

  // R1: the kill's own "+20 XP" toast. Same projection/rise/lifetime plumbing as popDamageNumber
  // (riding the SAME #damage-numbers overlay -- both are floating combat text, and a second
  // container would just be a second copy of this exact mechanism), but its own CSS class so the
  // colour reads as a reward rather than a hit (see index.html's .xp-toast, deliberately cool where
  // .damage-number is warm gold).
  function popXpToast(worldX, worldY, worldZ, amount) {
    const projected = new THREE.Vector3(worldX, worldY, worldZ).project(camera);
    if (projected.z > 1) return;
    const rect = gameSurface.getBoundingClientRect();
    const { x, y } = ndcToOverlayPixels(projected.x, projected.y, rect.width, rect.height);
    const el = document.createElement('div');
    el.className = 'xp-toast';
    el.textContent = xpToastText(amount);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    damageNumbersElement.appendChild(el);
    window.requestAnimationFrame(() => { el.dataset.rise = 'true'; });
    window.setTimeout(() => { el.remove(); }, DAMAGE_NUMBER_LIFETIME_MS);
  }

  // R1: THE STREAK METER. See index.html's own CSS comment for the ring/pulse mechanics; this is
  // only the DOM wiring, painted from progression/streakView.js's pure view-model every frame.
  const streakMeterElement = document.querySelector('#streak-meter');
  const streakRingElement = streakMeterElement?.querySelector('.streak-ring') ?? null;
  const streakCountElement = streakMeterElement?.querySelector('.streak-count') ?? null;
  const streakLabelElement = streakMeterElement?.querySelector('.streak-label') ?? null;
  let streakPulseTimer = null;
  function renderStreakMeter(view) {
    if (!streakMeterElement) return;
    const shown = view !== null;
    streakMeterElement.dataset.shown = String(shown);
    if (!shown) return;
    streakMeterElement.dataset.tier = view.multiplier >= 3 ? '3' : view.multiplier >= 2 ? '2' : '1';
    streakRingElement?.style.setProperty('--streak-fraction', String(view.ringFraction));
    if (streakCountElement) streakCountElement.textContent = view.countText;
    if (streakLabelElement) streakLabelElement.textContent = view.tierLabel;
  }
  /** One pulse per kill, a bigger one on the frame a tier is actually crossed -- see index.html's
   *  own streak-pulse/streak-pulse-tier keyframes. */
  function pulseStreakMeter(view) {
    if (!streakMeterElement) return;
    delete streakMeterElement.dataset.pulse;
    window.clearTimeout(streakPulseTimer);
    // A frame between clearing and re-setting the attribute, the same reason popDamageNumber's own
    // rise needs one -- re-triggering a CSS animation on the SAME attribute value needs a paint in
    // between, or the browser coalesces both states and the pulse never plays a second time in a row.
    window.requestAnimationFrame(() => {
      streakMeterElement.dataset.pulse = (view.justReachedTier2 || view.justReachedTier3) ? 'tier' : 'true';
      streakPulseTimer = window.setTimeout(() => { delete streakMeterElement.dataset.pulse; }, 500);
    });
  }

  const enemyNameplates = createEnemyNameplateLayer({
    container: document.querySelector('#enemy-nameplates'),
  });
  function projectEnemyNameplate(enemy) {
    const distance = Math.hypot(player.position.x - enemy.x, player.position.z - enemy.z);
    if (distance > ENEMY_NAMEPLATE_MAX_DISTANCE) return null;
    // Anchor the bar to the body as DRAWN, not to the authoritative point the drawn body is easing
    // toward (enemies/wolf.js's drawn-state easing) -- otherwise the nameplate leads its own wolf by
    // up to a snapshot. The distance cap above deliberately stays on authority: whether a bar shows
    // at all is a range rule, and range rules read the same state combat does.
    const drawnAnchor = enemyPresenters.get(enemy.enemyId)?.drawnPosition?.() ?? enemy;
    const projected = new THREE.Vector3(drawnAnchor.x, 1.65, drawnAnchor.z).project(camera);
    if (projected.z < -1 || projected.z > 1) return null;
    const rect = gameSurface.getBoundingClientRect();
    const projectedPixels = ndcToOverlayPixels(projected.x, projected.y, rect.width, rect.height);
    if (projectedPixels.x < -80 || projectedPixels.x > rect.width + 80
      || projectedPixels.y < -80 || projectedPixels.y > rect.height + 40) return null;
    // Projected labels yield to the controls and child-facing prompts already occupying the screen.
    // Read live DOM rectangles in the same game-surface coordinate system instead of maintaining a
    // second portrait/landscape layout table that could drift from CSS.
    const reservedRects = [
      '#touch-stick', '#attack-button', '#hero-health', '#hero-progress', '#lantern-marks',
      '#quest-objective', '#keeper-speech', '#banner', '#loot-hud', '#streak-meter', '#minimap', '#objective-pointer',
    ].flatMap((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [];
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return [];
      const box = element.getBoundingClientRect();
      return [{
        left: box.left - rect.left,
        top: box.top - rect.top,
        right: box.right - rect.left,
        bottom: box.bottom - rect.top,
      }];
    });
    const clamped = clampNameplateProjection(projectedPixels, rect);
    const centre = rect.width / 2;
    const direction = clamped.x < centre ? 1 : -1;
    const halfLabelWidth = ENEMY_NAMEPLATE_SAFE_WIDTH / 2;
    const safeX = Array.from({ length: Math.ceil(rect.width / 2 / 12) + 1 }, (_, index) => (
      Math.max(halfLabelWidth, Math.min(rect.width - halfLabelWidth, clamped.x + direction * index * 12))
    )).find((candidate) => nameplateProjectionIsSafe({ x: candidate, y: clamped.y }, reservedRects));
    if (safeX === undefined) return null;
    return { visible: true, x: safeX, y: clamped.y };
  }

  // THE WARDEN'S OWN OVERHEAD BAR. Same pipeline projectEnemyNameplate uses one function up --
  // world position through the live camera, ndcToOverlayPixels into the game surface's own pixel
  // space, clamp inside the viewport, dodge the HUD -- because this IS that same overhead
  // convention, not a second one invented for the one enemy that gets a name on a card. No distance
  // cap the way an ordinary enemy's nameplate has one (ENEMY_NAMEPLATE_MAX_DISTANCE): there is only
  // ever one Warden, the arena he stands in is small, and a bar that vanished a few metres out would
  // make the fight's own readout flicker exactly when a child steps back to dodge.
  function projectBossBar(warden) {
    const projected = new THREE.Vector3(warden.x, WARDEN_HEIGHT_METERS + 0.32, warden.z).project(camera);
    // Behind the camera (z > 1): never draw. Nothing here checks z < -1 the way the ordinary
    // nameplate does -- that branch guards against a camera INSIDE the enemy's own body, which
    // cannot happen at the Warden's 2.6 m height and the follow camera's own distance.
    if (projected.z > 1) return null;
    const rect = gameSurface.getBoundingClientRect();
    const projectedPixels = ndcToOverlayPixels(projected.x, projected.y, rect.width, rect.height);
    if (projectedPixels.x < -160 || projectedPixels.x > rect.width + 160
      || projectedPixels.y < -100 || projectedPixels.y > rect.height + 60) return null;
    const reservedRects = [
      '#touch-stick', '#attack-button', '#hero-health', '#hero-progress', '#lantern-marks',
      '#quest-objective', '#keeper-speech', '#banner', '#loot-hud', '#streak-meter', '#minimap', '#objective-pointer',
    ].flatMap((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [];
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return [];
      const box = element.getBoundingClientRect();
      return [{
        left: box.left - rect.left,
        top: box.top - rect.top,
        right: box.right - rect.left,
        bottom: box.bottom - rect.top,
      }];
    });
    const clamped = clampNameplateProjection(
      projectedPixels, rect, { width: BOSS_BAR_SAFE_WIDTH, height: BOSS_BAR_SAFE_HEIGHT },
    );
    // Unlike the ordinary nameplate's own search-outward-for-a-safe-x dance, the boss bar just lifts
    // straight up out of whatever it would overlap: there is exactly one of these on screen at once,
    // so there is no neighbour to dodge sideways INTO, and rising above the obstruction keeps it
    // reading as "attached to the Warden's own head" rather than teleporting off to one side of him.
    let y = clamped.y;
    for (let lift = 0; lift < 6; lift += 1) {
      if (nameplateProjectionIsSafe(
        { x: clamped.x, y }, reservedRects, { width: BOSS_BAR_SAFE_WIDTH, height: BOSS_BAR_SAFE_HEIGHT },
      )) break;
      y -= BOSS_BAR_SAFE_HEIGHT * 0.6;
    }
    if (y < -100) return null;
    return { x: clamped.x, y };
  }

  // Phase D (D4): three lantern-mark pips under the health readout, filling as marks arrive. Same read-only,
  // re-render-from-current-value pattern as renderHealth above -- pipsForMarks() is the only part of
  // this worth unit testing (test/rewards-hud.test.mjs); wiring its result onto three fixed spans is
  // not, the same reasoning renderHealth's own comment gives.
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
    banner(`LANTERN MARK  ${totalMarks} / ${MARKS_TO_UNLOCK}`, 1800,
      `Lantern mark, ${totalMarks} of ${MARKS_TO_UNLOCK}`);
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

  // ── LEVEL, THE METER, AND POWER ───────────────────────────────────────────────────────────────
  //
  // Same read-only, paint-from-the-current-value pattern as renderHealth and renderLanternPips. Every
  // number comes from the one resolved stats object the fight is being fed, so the pill cannot print
  // a hero the combat rules have not agreed to.
  const heroProgressElement = document.querySelector('#hero-progress');
  const heroLevelElement = document.querySelector('#hero-level');
  const xpFillElement = document.querySelector('#hero-xp .xp-fill');
  const xpTextElement = document.querySelector('#hero-xp-text');
  const heroPowerElement = document.querySelector('#hero-power-value');
  // WHAT THE PILL IS CURRENTLY SHOWING, so the per-frame call below repaints on a CHANGE rather than
  // rewriting four text nodes and a width sixty times a second. The same diff renderHealth keeps, and
  // for a reason that turned out not to be theoretical: the first version wrote unconditionally, and
  // on a 12x-throttled hosted runner -- where drive-ranger's sanctuary phase measures ~3.3 fps -- four
  // gratuitous style recalculations per frame is real time taken out of a frame budget that is
  // already the thing every positional check in this repo is fighting. A HUD that costs nothing when
  // nothing has changed is the convention this file already had; this was the line that broke it.
  let progressShown = null;
  function renderHeroProgress({ level, xpIntoLevel, xpForLevel, power }) {
    const key = `${level}|${xpIntoLevel}|${xpForLevel}|${power}`;
    if (key === progressShown) return;
    progressShown = key;
    heroLevelElement.textContent = String(level);
    xpFillElement.style.width = `${(xpForLevel > 0 ? xpIntoLevel / xpForLevel : 0) * 100}%`;
    xpTextElement.textContent = `${xpIntoLevel} / ${xpForLevel}`;
    heroPowerElement.textContent = formatPower(power);
  }

  // ── THE LEVEL-UP CEREMONY ─────────────────────────────────────────────────────────────────────
  //
  // WHEN it fires is progression/heroStats.js's levelUpTransition, proved without a browser. WHAT it
  // says is progression/power.js's levelUpSummary, proved the same way. This is only the painting and
  // the clock -- which is the split every other presenter in this file keeps.
  //
  // It was a `banner()` for exactly one run of tools/runtime-test/drive-first-level-up.mjs, and that
  // run is the reason it is not one now: wolf-defeated, the third Lantern Mark and the unlock all
  // fire on the same frame, each banner replacing the last, and the capture of the child's first
  // level shows a toast reading "LANTERN MARK 3 / 3". The strongest routine progression celebration
  // in the game cannot be a queue slot that three other beats are also using.
  const levelUpElement = document.querySelector('#level-up');
  const levelUpLevelElement = document.querySelector('#level-up-level-value');
  const levelUpHpElement = document.querySelector('#level-up-hp');
  const levelUpDamageElement = document.querySelector('#level-up-damage');
  const levelUpPowerBeforeElement = document.querySelector('#level-up-power-before');
  const levelUpPowerDeltaElement = document.querySelector('#level-up-power-delta');
  const levelUpPowerAfterElement = document.querySelector('#level-up-power-after');
  // Long enough to read four numbers at a child's pace, short enough that it is gone before the next
  // thing happens. The Lantern's own banner holds 3200ms; this outlasts it deliberately, because it
  // is the bigger beat and the two now coexist rather than competing for one slot.
  const LEVEL_UP_SHOWN_MS = 4200;
  // HOW LONG THE METER IS HELD FULL BEFORE IT ROLLS OVER.
  //
  // The brief: "the XP meter must visibly complete and roll into the new level rather than teleporting
  // to an unrelated number". Without this it cannot -- the Lantern awards exactly one level's worth,
  // so the honest reading goes from 0/100 straight to 0/150 and the meter is never seen full at all.
  // So the whole progress row is HELD at the level the child just finished, with its meter at 100%,
  // for a beat; then it rolls. Nothing about the fight is held: the bigger body is already real and
  // the health bar is already drawing it, which is the other half of the same moment.
  //
  // Kept under reduced motion. It is sequencing, not movement -- the reduced-motion rule in
  // index.html removes the animations and leaves the order of events intact, because "less motion" is
  // a request about how things move, not about what a child is told.
  const XP_ROLL_MS = 700;
  let levelUpCount = 0;
  let levelUpTimer = null;
  let levelUpLiftTimer = null;
  // The progress readout frozen mid-rollover, or null. See XP_ROLL_MS.
  let progressHold = null;

  function celebrateLevelUp(fromLevel, toLevel, before, after) {
    levelUpCount += 1;
    const summary = levelUpSummary({ level: toLevel, before, after });

    // Hold the meter full at the level they just finished, then let the ordinary per-frame render
    // take over at the new one.
    progressHold = {
      level: fromLevel,
      xpIntoLevel: before.levelState.xpForLevel,
      xpForLevel: before.levelState.xpForLevel,
      power: summary.power.before,
      until: performance.now() + XP_ROLL_MS,
    };
    // Re-triggering a CSS animation needs the attribute to actually leave and come back, which needs
    // a frame in between -- the same reason celebrateMarkArrival waits one.
    delete heroProgressElement.dataset.levelled;
    window.requestAnimationFrame(() => { heroProgressElement.dataset.levelled = 'true'; });
    window.clearTimeout(levelUpLiftTimer);
    levelUpLiftTimer = window.setTimeout(() => {
      delete heroProgressElement.dataset.levelled;
    }, XP_ROLL_MS + 900);

    levelUpLevelElement.textContent = String(summary.level);
    levelUpHpElement.textContent = summary.maxHpGainText;
    levelUpDamageElement.textContent = summary.damageGainText;
    levelUpPowerBeforeElement.textContent = summary.power.beforeText;
    levelUpPowerDeltaElement.textContent = summary.power.deltaText;
    levelUpPowerAfterElement.textContent = summary.power.afterText;
    levelUpElement.dataset.shown = 'true';
    window.clearTimeout(levelUpTimer);
    levelUpTimer = window.setTimeout(() => { levelUpElement.dataset.shown = 'false'; }, LEVEL_UP_SHOWN_MS);

    // Read aloud on the same terms every other line in the game is: only once the child has asked to
    // be read to. The numbers are spoken as words rather than as the on-screen arrows, which read
    // aloud as punctuation.
    speakKeeperLineIfUnlocked(`Level up! You are level ${summary.level}. `
      + `${summary.maxHpGainText} max health, ${summary.damageGainText} damage. `
      + `Power ${summary.power.afterText}.`);
    // Its own sound, not the Lantern's. The two fire seconds apart on this very path, so borrowing
    // unlock-flourish would have made the biggest beat in the game sound like the one before it.
    audio.play(LEVEL_UP_RECIPE_NAME);
  }

  // GP2: the coin/shard HUD, re-rendered from whatever coinsDisplayed/shardsDisplayed currently hold
  // -- the same "read-only, paint from the current value" pattern renderHealth/renderLanternPips
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
  // value" pattern renderHealth/renderLanternPips use. The name row used to be set once at boot to
  // KEEPER_NAME; now it has to change with whoever is actually speaking.
  const keeperSpeechElement = document.querySelector('#keeper-speech');
  const keeperSpeechTextElement = document.querySelector('#keeper-speech-text');
  const keeperSpeechNameElement = document.querySelector('#keeper-speech-name');
  const keeperSpeechSpeakElement = document.querySelector('#keeper-speech-speak');
  let npcSpeechLine = null;
  let npcSpeechName = null;

  // The standing objective, same render-from-current-value discipline as the health readout and the pips.
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
  // THE TWO PLACES ONLY THE RUNNING GAME KNOWS. "The next dark light" is not a fixed coordinate --
  // it is whichever is nearest and still out, which depends on where the child is standing and on
  // what they have already done. destinations.js cannot know either, so it asks.
  //
  // GETTERS, so nothing is computed for an objective that does not want it: destinationFor reads at
  // most one of these per frame, and building both lists every frame to throw one away is work a
  // starved device cannot spare. Built ONCE, out here rather than in the frame loop, for the same
  // reason -- the getters close over the live bindings, so a hoisted object still reads this frame's
  // state while allocating nothing per frame.
  //
  // The trail's positions and its lit flags are parallel arrays and so are the seals', which is why
  // this filters by index. That join is sound by construction: trailLit is built as
  // noTrailLightsLit(TRAIL_LIGHTS.length) and sealsSeen as COLD_SEALS.map(...).
  const pointerContext = {
    get nearestUnlitLight() {
      return nearestPlaceTo(
        VILLAGE.TRAIL_LIGHTS
          .filter((_, index) => trailLit[index] !== true)
          .map(([x, z]) => ({ x, z })),
        player.position.x, player.position.z,
      );
    },
    get nearestUnbrokenSeal() {
      return nearestPlaceTo(
        VILLAGE.COLD_SEALS
          .filter((_, index) => siegeState.seals[index]?.burst !== true)
          .map(([x, z]) => ({ x, z })),
        player.position.x, player.position.z,
      );
    },
  };
  const objectivePointerElement = document.querySelector('#objective-pointer');
  const objectivePointerArrowElement = document.querySelector('#objective-pointer-arrow');
  const objectivePointerDistanceElement = document.querySelector('#objective-pointer-distance');
  const objectiveMarkerElement = document.querySelector('#objective-marker');
  const pointerTarget = new THREE.Vector3();
  const pointerForward = new THREE.Vector3();
  /** Both HUD elements off, reported through the one exit every "say nothing" case funnels through --
   *  so the edge arrow and the on-screen marker can never disagree about whether anything is
   *  currently being pointed at (one shown, the other left stale from a previous frame). */
  function hideObjectiveGuidance() {
    objectivePointerElement.dataset.shown = 'false';
    objectiveMarkerElement.dataset.shown = 'false';
    return { pointing: false };
  }
  /**
   * ALWAYS-ON WAYFINDING, part two of two (part one is the ground trail: render/guidePath.js). This
   * used to hide itself the instant the target scrolled on screen, which was correct for an ARROW --
   * a thing pointing at something already visible is noise -- but left the on-screen case with
   * nothing at all, which is the gap the playtest finding names: a child looking straight at the
   * right street lantern among four identical dark ones had no way to confirm it was the one. Now the
   * arrow and a soft bouncing marker are two views of ONE decision (render/guideArrow.js's `mode`),
   * so exactly one of them is ever showing.
   *
   * @param objective the current quest objective, or null.
   * @param context   the caller-supplied dynamic-destination lookups destinationFor needs (the next
   *                  dark light, the next cold seal).
   * @param suspended true while a full-screen overlay owns the screen, or while an NPC speech beat
   *                  already has the child standing at the right spot -- both moments an arrow or a
   *                  marker would be either invisible under a modal or telling a child something
   *                  their own speech bubble is already telling them.
   */
  function renderObjectivePointer(objective, context, suspended) {
    const place = destinationFor(objective, context);
    if (suspended || !place) {
      // No objective, no place for it, a dynamic place the caller could not supply, or a moment this
      // is deliberately quiet for. `place` still comes back so a caller that only needs the
      // COORDINATE (the rescue watch, the minimap, the ground trail) does not have to ask
      // destinationFor a second time -- ONE resolve of "where is it", read three ways.
      return { ...hideObjectiveGuidance(), place };
    }

    // BEHIND THE CAMERA IS COMPUTED, NOT INFERRED, and this is the whole reason offscreenPointer.js
    // (which render/guideArrow.js wraps) takes it as an argument. project() performs the perspective
    // divide without clipping, so a point behind the camera comes back mirrored through the origin --
    // a plausible on-screen coordinate pointing exactly the wrong way. The sign of the depth along
    // the camera's forward axis is the only thing that distinguishes them.
    pointerTarget.set(place.x, POINTER_TARGET_HEIGHT_METERS, place.z);
    pointerForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    // The dot product written out rather than `pointerTarget.clone().sub(...).dot(...)`. The clone
    // allocated a Vector3 on EVERY FRAME of a game that has to run on a tablet, which is exactly the
    // kind of steady garbage that shows up as stutter rather than as a bug. Three multiplies.
    const behindCamera =
      (place.x - camera.position.x) * pointerForward.x
      + (POINTER_TARGET_HEIGHT_METERS - camera.position.y) * pointerForward.y
      + (place.z - camera.position.z) * pointerForward.z < 0;

    pointerTarget.project(camera);
    const guide = guideArrowFor({
      hasTarget: true,
      ndcX: pointerTarget.x,
      ndcY: pointerTarget.y,
      behindCamera,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      heroX: player.position.x,
      heroZ: player.position.z,
      targetX: place.x,
      targetZ: place.z,
    });

    objectivePointerElement.dataset.shown = String(guide.mode === 'edge');
    objectiveMarkerElement.dataset.shown = String(guide.mode === 'onscreen');
    if (guide.mode === 'edge') {
      objectivePointerElement.style.transform = `translate(${guide.x}px, ${guide.y}px)`;
      objectivePointerArrowElement.style.transform = `rotate(${guide.angle}rad)`;
      // "23m", not "23.4m" -- render/guideArrow.js's own formatter owns the rounding so the chip and
      // this readout can never disagree about what counts as close.
      objectivePointerDistanceElement.textContent = formatGuideMeters(guide.meters);
    } else if (guide.mode === 'onscreen') {
      // The marker floats a fixed pixel offset above the target's own projected point -- see
      // #objective-marker-glyph's CSS for the lift and the bounce; this only has to place the anchor.
      objectiveMarkerElement.style.transform = `translate(${guide.x}px, ${guide.y}px)`;
    }
    // Reported so the rescue offer can stay quiet while the errand is already in frame: see the
    // call site. A caller that only wants the arrow drawn can ignore this.
    return { pointing: guide.mode === 'edge', place };
  }
  // THE DIAL. Hero at the centre, camera forward pointing up; ui/minimap.js owns the maths and the
  // reasoning, including why it is camera-up rather than north-up and why it is not enemy radar.
  //
  // REDRAWN AT MOST TWELVE TIMES A SECOND, not every frame. A map is not an animation: at a walk of
  // 1.4 m/s a child covers 12 cm between redraws on a 22 m dial, which is a third of a pixel. Sixty
  // redraws a second would spend the difference on nothing, and this is a tablet game whose frame
  // budget is already the thing that decides whether the opening fight is winnable.
  const MINIMAP_REDRAW_INTERVAL_MS = 1000 / 12;
  const minimapCanvas = document.querySelector('#minimap');
  const minimapCtx = minimapCanvas.getContext('2d');
  const minimapRadiusPx = minimapCanvas.width / 2;
  let minimapDrawnAt = 0;
  function renderMinimap(now, objectivePlace) {
    if (now - minimapDrawnAt < MINIMAP_REDRAW_INTERVAL_MS) return;
    minimapDrawnAt = now;
    const shared = {
      heroX: player.position.x,
      heroZ: player.position.z,
      heading: follow.heading,
      rangeMeters: DEFAULT_RANGE_METERS,
      radiusPx: minimapRadiusPx,
    };
    const size = minimapCanvas.width;
    minimapCtx.clearRect(0, 0, size, size);

    // THE ROAD. Drawn as one path with out-of-range vertices kept in their true positions rather
    // than pinned to the rim -- a road whose far ends are all on the rim stops being a road and
    // becomes a starburst. The circular clip is what keeps it inside the dial.
    minimapCtx.save();
    minimapCtx.beginPath();
    minimapCtx.arc(minimapRadiusPx, minimapRadiusPx, minimapRadiusPx, 0, Math.PI * 2);
    minimapCtx.clip();
    const road = minimapPolyline(VILLAGE.ROAD.points, shared);
    minimapCtx.beginPath();
    road.forEach((point, index) => {
      if (index === 0) minimapCtx.moveTo(point.x, point.y);
      else minimapCtx.lineTo(point.x, point.y);
    });
    minimapCtx.strokeStyle = 'rgba(214, 178, 122, 0.85)';
    minimapCtx.lineWidth = 7;
    minimapCtx.lineJoin = 'round';
    minimapCtx.lineCap = 'round';
    minimapCtx.stroke();
    minimapCtx.restore();

    // THE ERRAND, pinned to the rim when it is beyond the range -- the opposite rule to the road,
    // and for the same reason the off-screen pointer exists: a marker that vanishes at the range
    // boundary makes the dial go blank exactly when a child most needs to know which way to go.
    if (objectivePlace) {
      const marker = minimapPlacement({ ...shared, worldX: objectivePlace.x, worldZ: objectivePlace.z });
      minimapCtx.beginPath();
      minimapCtx.arc(marker.x, marker.y, marker.withinRange ? 9 : 7, 0, Math.PI * 2);
      minimapCtx.fillStyle = '#f2b33d';
      minimapCtx.fill();
    }

    // THE CHILD, always dead centre, always pointing up. The triangle is what makes "up is where you
    // are facing" legible without a word of explanation.
    minimapCtx.save();
    minimapCtx.translate(minimapRadiusPx, minimapRadiusPx);
    minimapCtx.beginPath();
    minimapCtx.moveTo(0, -11);
    minimapCtx.lineTo(8, 8);
    minimapCtx.lineTo(0, 3);
    minimapCtx.lineTo(-8, 8);
    minimapCtx.closePath();
    minimapCtx.fillStyle = '#ffffff';
    minimapCtx.fill();
    minimapCtx.restore();
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
      // AND READ IT, once the child has asked to be read to. Refused until the speaker button has
      // been tapped once -- see keeperSpeech.js for why that tap is both iOS's price for making a
      // sound at all and the child's own signal. Fired here, on the line CHANGING, so walking back
      // to a speaker mid-quest reads the new count rather than repeating the old sentence.
      speakKeeperLineIfUnlocked(next.line);
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
  // G1-C3: the Silverguard Helmet, mounted the same lazy three-variable way. `helmetMount` latches
  // only after a REAL attach (so a missing asset or an unloaded hero retries rather than sticking),
  // `inFlight` stops a second load racing the first, and `assetMissing` latches on the first 404 so
  // the warning fires once. Unlike the belt lantern's one-way unlock, a helmet EQUIPS AND UNEQUIPS,
  // so the anchor is mounted once and then shown/hidden every frame from the equipped state -- the
  // Blade's mount-once-then-toggle-visibility shape, not the lantern's mount-and-latch one. The
  // helmet is loaded independently (assets/gear/helmet_silverguard.glb), never baked into the hero
  // atlas, exactly like the lantern.
  let helmetMount = null;
  let helmetMountInFlight = false;
  let helmetAssetMissing = false;
  // R1: the Silverguard Shoulders, mounted the same lazy way as the helmet but as TWO anchors --
  // shoulder_silverguard.glb loaded once (loadGLB caches by URL) and attached twice, mirrored, the
  // same "one glb, worn twice" arrangement test/glb-budget.test.mjs's own Tier 3 fixture prices.
  let shoulderMountLeft = null;
  let shoulderMountRight = null;
  let shoulderMountInFlight = false;
  let shoulderAssetMissing = false;
  // The loaded Hero's anatomy-coverage surface (character/hero.js's heroAnatomyApi), captured at hero
  // load so the helmet toggle can hide the hair and ears WHILE the helmet is on and show them again
  // when it comes off. runtime.hero is the Object3D root and cannot do this; the API object can, and
  // it is the same one net/remotes.js is handed for the sibling clones.
  let localHeroAnatomy = null;
  // The id this rule LAST ACTED ON, recorded rather than re-derived. equippedWeaponMeshState() below
  // needs it, and the frame loop's own `ownRewards`/`currentEquippedWeaponId` are loop-locals it
  // cannot see -- but a second copy of "online ? server rewards : offline id" living in the accessor
  // would be a second answer to the same question, free to drift from the one that actually decided
  // which anchor is visible. A harness reading a DIFFERENT id than the game used is worse than no
  // accessor at all: it would report agreement between a card and a sword that never agreed.
  let equippedWeaponIdThisFrame = DEFAULT_EQUIPPED_WEAPON_ID;
  // P2: this frame's resolved Hero stats -- `{ level, levelState, maxHp, heroDamage }` -- recorded
  // for exactly the reason the equipped id above is. Both offline fights, the level-up watch and the
  // runtime accessor all need them, and a second "online ? server rewards : journal" branch would be
  // a second answer to one question, free to drift from the one the fight actually used.
  //
  // Seeded with a Level-1 starter hero rather than left null, so a frame that runs before the first
  // rewards block has arrived fights the fight every child starts with instead of throwing.
  let heroStatsThisFrame = resolveHeroStats();
  // THE LEVEL THIS SESSION HAS ALREADY SHOWN THE CHILD. `null` until the first frame that knows
  // anything, which is the hydration case: a returning Level-2 child must not watch themselves reach
  // Level 2 again on every page load. Same `xxxSeen === null` shape charmOwnedSeen and bladeOwnedSeen
  // already use, and progression/heroStats.js's levelUpTransition owns the actual rule so it can be
  // proved without a browser.
  let heroLevelSeen = null;
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

  /**
   * Mount a piece of gear on a REMOTE hero's clone, for net/remotes.js.
   *
   * The local hero's mounts above are lazy on purpose -- an asset is fetched only when THIS child
   * earns the thing -- which means the ordinary situation at the moment a sibling earns one is that
   * this client has never had a reason to load it. Without this the wire would say "Blade" or
   * "lantern" and every other screen would still draw the old body: the defect with an extra step.
   *
   * `loadGLB` caches by URL, so a dozen siblings and this hero cost one download between them. The
   * gltf.scene is cloned per mount: an Object3D has one parent, and attaching the cached one to a
   * second hero would silently take it off the first.
   *
   * The asset-missing flags are SHARED with the local hero's mounts deliberately. Each is one fact
   * about one file, and two flags for it would be two answers to "is this asset here" -- one of
   * which would keep warning after the other had given up.
   *
   * Returns the anchor, never makes it visible: net/remotes.js decides that from the same rules the
   * local hero is drawn by, and nothing else is allowed to show a piece of gear.
   */
  async function mountGearOnRemote(clonedRoot, gearId) {
    if (gearId === WILDWOOD_BLADE_CANDIDATE_ID) {
      if (wildwoodAssetMissing) return null;
      const gltf = await loadGLB(WILDWOOD_BLADE_CANDIDATE_URL);
      if (gltf.userData?.loadError) {
        if (!wildwoodAssetMissing) {
          wildwoodAssetMissing = true;
          console.warn(
            `[progression] ${WILDWOOD_BLADE_CANDIDATE_URL} is missing -- a sibling holding the Blade `
            + 'is drawn with the Ironwood sword until the asset lands.',
          );
        }
        return null;
      }
      return attachWildwoodBladeCandidate(clonedRoot, gltf.scene.clone(true)).anchor;
    }
    if (gearId === RIGID_BELT_LANTERN.id) {
      if (lanternAssetMissingLogged) return null;
      const gltf = await loadGLB(BELT_LANTERN_URL);
      if (gltf.userData?.loadError) {
        if (!lanternAssetMissingLogged) {
          lanternAssetMissingLogged = true;
          console.warn(
            `[rewards] ${BELT_LANTERN_URL} is missing -- a sibling who has earned the lantern is `
            + 'drawn with a bare belt until the asset lands.',
          );
        }
        return null;
      }
      return attachBeltLantern(clonedRoot, gltf.scene.clone(true)).anchor;
    }
    if (gearId === RIGID_SILVERGUARD_HELMET.id) {
      if (helmetAssetMissing) return null;
      const gltf = await loadGLB(SILVERGUARD_HELMET_URL);
      if (gltf.userData?.loadError) {
        if (!helmetAssetMissing) {
          helmetAssetMissing = true;
          console.warn(
            `[progression] ${SILVERGUARD_HELMET_URL} is missing -- a sibling wearing the Helmet is `
            + 'drawn bare-headed until the asset lands.',
          );
        }
        return null;
      }
      return attachSilverguardHelmet(clonedRoot, gltf.scene.clone(true)).anchor;
    }
    // R1: the Silverguard Shoulders, one call per side -- net/remotes.js's own ensureRemoteShoulders
    // asks for `shoulder_silverguard_left`/`shoulder_silverguard_right` (silverguardShoulderAnchorId),
    // never the bare catalogue id, because ONE owned/equipped item mounts as TWO anchors here. Both
    // ids load the SAME URL (loadGLB caches by it, so a dozen siblings and this hero cost one
    // download between them) and share the one asset-missing flag, the identical "one fact about one
    // file" reasoning every other branch in this function already follows.
    if (gearId === silverguardShoulderAnchorId('left') || gearId === silverguardShoulderAnchorId('right')) {
      if (shoulderAssetMissing) return null;
      const gltf = await loadGLB(SILVERGUARD_SHOULDER_URL);
      if (gltf.userData?.loadError) {
        if (!shoulderAssetMissing) {
          shoulderAssetMissing = true;
          console.warn(
            `[progression] ${SILVERGUARD_SHOULDER_URL} is missing -- a sibling wearing the Shoulders `
            + 'is drawn bare-shouldered until the asset lands.',
          );
        }
        return null;
      }
      const side = gearId === silverguardShoulderAnchorId('left') ? 'left' : 'right';
      return attachSilverguardShoulder(clonedRoot, gltf.scene.clone(true), side).anchor;
    }
    return null;
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

  // The hair and ears vanish UNDER the helmet and reappear when it comes off, tracking the visible
  // helmet and nothing else -- occlusion without a helmet on screen would just be a bald hero. Guarded
  // so it only rebuilds the body geometry when the coverage actually changes (setAnatomyCoverage swaps
  // the mesh's geometry, cheap but not free), and order-independently because setAnatomyCoverage
  // normalises/sorts what it stores. Reads through localHeroAnatomy, the same API object that degrades
  // to no occlusion on an anatomy-drifted hero rather than throwing (character/hero.js).
  function setHelmetAnatomyCoverage(hidden) {
    if (!localHeroAnatomy) return;
    const want = hidden ? SILVERGUARD_HELMET_HIDES_ANATOMY : [];
    const current = localHeroAnatomy.anatomyCoverage;
    if (current.length === want.length && want.every((region) => current.includes(region))) return;
    localHeroAnatomy.setAnatomyCoverage(want);
  }

  // G1-C3: mount the Silverguard Helmet lazily the first time THIS child equips it, then show or hide
  // it every frame from the equipped state. The mount lands hidden and the per-frame call below reveals
  // it, so there is never a frame where the helmet is drawn before the coverage that hides the hair
  // under it -- worst case one 16ms frame of bare-headed hero with a helmet a beat late, never a helmet
  // floating over uncovered hair. `ensureHelmetMounted` runs every frame (beside ensureEquippedWeaponMesh),
  // which is what makes the reveal and the unequip toggle work.
  function ensureHelmetMounted(shouldBeEquipped) {
    if (!runtime.hero) return;
    if (shouldBeEquipped && helmetMount === null && !helmetMountInFlight && !helmetAssetMissing) {
      helmetMountInFlight = true;
      loadGLB(SILVERGUARD_HELMET_URL).then((gltf) => {
        helmetMountInFlight = false;
        if (gltf.userData?.loadError) {
          if (!helmetAssetMissing) {
            helmetAssetMissing = true;
            console.warn(
              `[progression] ${SILVERGUARD_HELMET_URL} is missing -- equipping the Helmet still works `
              + 'and still reads its defence; he goes bare-headed until the asset lands.',
            );
          }
          return;
        }
        // Mounted hidden; the lines below (next frame) decide visibility and coverage together.
        helmetMount = attachSilverguardHelmet(runtime.hero, gltf.scene);
        helmetMount.anchor.visible = false;
      }).catch((error) => {
        helmetMountInFlight = false;
        console.warn('[progression] failed to mount the Silverguard Helmet:', error);
      });
    }
    const worn = shouldBeEquipped && helmetMount !== null;
    if (helmetMount) helmetMount.anchor.visible = worn;
    setHelmetAnatomyCoverage(worn);
  }

  // R1: the Silverguard Shoulders, mounted and toggled the same lazy way as the Helmet -- one load
  // request covers BOTH anchors (loadGLB's own URL cache means a single fetch, cloned per side), and
  // both anchors land hidden so there is never a frame where a pauldron is drawn before the equipped
  // check agrees. No anatomy occlusion: unlike the Helmet, the shoulders sit over the collar/upper
  // arm, nowhere near the hair/ear regions the Helmet's own coverage exists to hide.
  function ensureShouldersMounted(shouldBeEquipped) {
    if (!runtime.hero) return;
    if (shouldBeEquipped && shoulderMountLeft === null && !shoulderMountInFlight && !shoulderAssetMissing) {
      shoulderMountInFlight = true;
      loadGLB(SILVERGUARD_SHOULDER_URL).then((gltf) => {
        shoulderMountInFlight = false;
        if (gltf.userData?.loadError) {
          if (!shoulderAssetMissing) {
            shoulderAssetMissing = true;
            console.warn(
              `[progression] ${SILVERGUARD_SHOULDER_URL} is missing -- equipping the Shoulders still `
              + 'works and still reads its defence; he goes bare-shouldered until the asset lands.',
            );
          }
          return;
        }
        // Two independent clones of the one loaded scene -- an Object3D has one parent, so the same
        // root cannot be attached to both arms at once (character/gear.js's own header on this exact
        // point, for the belt lantern).
        shoulderMountLeft = attachSilverguardShoulder(runtime.hero, gltf.scene.clone(true), 'left');
        shoulderMountRight = attachSilverguardShoulder(runtime.hero, gltf.scene.clone(true), 'right');
        shoulderMountLeft.anchor.visible = false;
        shoulderMountRight.anchor.visible = false;
      }).catch((error) => {
        shoulderMountInFlight = false;
        console.warn('[progression] failed to mount the Silverguard Shoulders:', error);
      });
    }
    const worn = shouldBeEquipped && shoulderMountLeft !== null;
    if (shoulderMountLeft) shoulderMountLeft.anchor.visible = worn;
    if (shoulderMountRight) shoulderMountRight.anchor.visible = worn;
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

  // WHAT THIS CHILD HAS ALREADY BEEN TAUGHT, read back from their own profile.
  //
  // The store has carried onboarding.{questGiven, movementTaught, attackTaught} since it was
  // written; nothing has ever set them but `named`. So every latch reset on every reload: a child
  // who came back tomorrow was a stranger who had never met the Keeper, and any hint keyed on these
  // would have fired again at somebody who already knew. Durable teaching state is the difference
  // between a save file and a session.
  const taught = profiles.activeProfile()?.onboarding ?? {};
  questGiven = taught.questGiven === true;
  movementTaught = taught.movementTaught === true;
  combatCoached = taught.attackTaught === true;

  /** Write a latch down the first time it flips. No-op without a durable profile: a session-only
   *  device still plays a coherent session, it simply has nowhere to remember into (see profileId
   *  above), and silently doing nothing is the honest behaviour rather than inventing a home. */
  function rememberTeaching(flags) {
    if (!durableProfileId) return;
    profiles.setFlags(durableProfileId, { onboarding: flags });
  }

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
    equippedItemIds: DEFAULT_EQUIPPED_ITEM_IDS,
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
      // THE STORED ANIMAL, CARRIED THROUGH. It was missing, and because this object is built field
      // by field rather than spread, nothing said so: `hero.avatar` was simply undefined and
      // avatarForProfile fell through to its id-derived fallback for EVERY card. The stored value
      // was written correctly and then never read, so a new sibling's animal was decided by their
      // random uuid rather than by what was free -- which is the collision the allocator was fixed
      // to prevent, arriving one layer further out.
      //
      // It hid because the id-derived answer is a legitimate-looking animal: six of them, so two
      // profiles agree about one time in six, and the browser check that was supposed to catch this
      // asked "are they different" and passed on luck four runs in a row.
      avatar: profile.avatar,
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
      // THE ANIMAL, then the name. This chip used to be the name alone, and its own CSS comment gave
      // the reason -- "the child's own hero name is the most recognisable thing that could sit
      // there". That was true when it was written and stopped being true the day the chooser grew
      // animals, which exist precisely because a child who cannot read does not recognise their
      // name. The rationale outlived the decision it was reasoning about, and nobody went back to
      // it: the one screen a child spends all their time on was the one that still said "who you
      // are" in letters. The name stays beside it for the adult in the room, exactly as on a card.
      const active = profiles.activeProfile();
      const avatar = active ? avatarForProfile(active) : null;
      profileChipElement.replaceChildren();
      if (avatar) {
        // NOT .profile-card-face (GQ-020): this is not a card, and everything that counts cards by
        // their faces would count this one.
        const face = document.createElement('span');
        face.className = 'profile-chip-face';
        face.textContent = avatar.emoji;
        face.style.background = avatar.colour;
        face.setAttribute('role', 'img');
        face.setAttribute('aria-label', avatar.name);
        profileChipElement.append(face);
      }
      const label = document.createElement('span');
      label.className = 'profile-chip-name';
      label.textContent = active?.displayName ?? 'Hero';
      profileChipElement.append(label);
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
      specialButtonElement.dataset.suspended = String(open);
      // And the same HUD-hiding attribute, for a reason a capture made obvious: a dimmed backdrop
      // still leaves the health readout and the objective looking tappable, and behind a modal they are not.
      gameSurface.dataset.profileGateOpen = String(open);
      if (open) {
        heroScreen.close();
        villageBoard?.close();
        runeChestCard?.close();
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

  // ── TASK 6: A SECOND, UNMISSABLE WAY OUT OF EVERY FULL-SCREEN OVERLAY ───────────────────────────
  //
  // The playtest's real failure: a child stuck on the Hero screen or the Village Board with no way
  // out but killing the app. cameraGesture.js's own veto (isInteractiveUiTarget) is the root-cause
  // fix -- it stops a wobbly tap on the X from also dragging the camera/preview underneath it -- but
  // a five-year-old does not reliably find a 48px X in the first place even when it works perfectly.
  // These two are the belt: Escape, and a tap on the panel's own dimmed/click-through backdrop, both
  // do exactly what the X does, for every overlay that has one.
  const profileGateElement = document.querySelector('#profile-gate');
  const profileGateCloseElement = document.querySelector('#profile-gate-close');
  const runeChestCardElement = document.querySelector('#rune-chest-card');

  // BACKDROP TAP, Hero screen and Village Board. Both are deliberately click-through on their own
  // container (index.html's own comment on #hero-screen) so a drag on the empty middle still turns
  // the camera/Hero-preview turntable -- so "tap the backdrop closes it" cannot be a plain click
  // listener on the panel the way an ordinary modal would do it; pointer-events: none means the panel
  // never receives that event at all. It is measured the same way the companion-tap seam above tells
  // a tap from a drag: a short (<12px), stationary pointer that started and ended on the game surface
  // itself, while that overlay was open, and that never touched the overlay's own chrome (which
  // already has its own buttons and must not also close the screen out from under a child using
  // them).
  const overlayBackdropTapPointers = new Map();
  gameSurface.addEventListener('pointerdown', (event) => {
    if (!heroScreen.isOpen() && !villageBoard.isOpen()) return;
    const targetElement = event.target instanceof Element ? event.target : null;
    if (targetElement?.closest('button, input, textarea, select, a, label, [data-ui-surface]')) return;
    overlayBackdropTapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }, { passive: true });
  gameSurface.addEventListener('pointerup', (event) => {
    const start = overlayBackdropTapPointers.get(event.pointerId);
    overlayBackdropTapPointers.delete(event.pointerId);
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) return;
    if (heroScreen.isOpen()) heroScreen.close();
    else if (villageBoard.isOpen()) villageBoard.close();
  }, { passive: true });
  gameSurface.addEventListener('pointercancel', (event) => {
    overlayBackdropTapPointers.delete(event.pointerId);
  }, { passive: true });

  // BACKDROP TAP, the profile gate. Unlike the two above, the gate is opaque and pointer-events:
  // auto across its WHOLE area while shown (profileGate.js's own header: "a question that has to be
  // answered... a half-visible village behind it invites a child to try to tap the village"), so its
  // backdrop DOES receive a real click -- the ordinary modal pattern, gated on event.target being the
  // backdrop element itself so a click that bubbled up from the panel or a card does not also close
  // it. Never fires during first-run naming: gated on the close button's own shown state, which is
  // the SAME rule that already hides the X there -- see profileGate.js's own comment for why that
  // one question has no dismiss ("a dismissable question a child cannot answer any other way is a
  // dead end").
  profileGateElement?.addEventListener('click', (event) => {
    if (event.target !== profileGateElement) return;
    if (profileGateCloseElement?.dataset.shown !== 'true') return;
    profileGate.close();
  });

  // BACKDROP TAP, the rune chest card. Same OPAQUE/pointer-events-auto-while-shown shape the profile
  // gate is (index.html's own CSS comment on #rune-chest-card), so it takes the identical plain-click
  // pattern rather than #hero-screen/#village-board-screen's drag-distance one -- and unlike the
  // gate, this ALWAYS has its own way out (the ✕ is never hidden the way the gate's first-run naming
  // hides its own), so there is no "is dismiss even allowed right now" guard to repeat here. A tap on
  // the backdrop dismisses WITHOUT judging an answer -- runeChestCard.close() never fires onAnswer.
  runeChestCardElement?.addEventListener('click', (event) => {
    if (event.target !== runeChestCardElement) return;
    runeChestCard.close();
  });

  // ESCAPE. Whichever one full-screen overlay is open -- they are mutually exclusive by construction,
  // each one's own onOpenChange above closes the others -- the same key that closes every other
  // dialog on the web closes it too. Every desktop and debugging session has this key; a real iPad's
  // on-screen keyboard does not, which is exactly why this is belt-and-braces rather than the whole
  // fix.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (heroScreen.isOpen()) { heroScreen.close(); return; }
    if (villageBoard.isOpen()) { villageBoard.close(); return; }
    if (runeChestCard.isOpen()) { runeChestCard.close(); return; }
    if (profileGate.isOpen() && profileGateCloseElement?.dataset.shown === 'true') profileGate.close();
  });

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
  // Counted rather than inferred, so "does this actually happen" is answerable from a harness rather
  // than from reading the server. A guard against a case that never occurs is dead weight pretending
  // to be a fix.
  let rewardsAlreadyKnown = 0;
  function journalDurableFact(event) {
    // No stable id means it cannot be deduplicated, so this device cannot tell a replay from a first
    // sighting. Reported as news, which is exactly today's behaviour for such an event -- the
    // conservative answer, because suppressing a ceremony we are unsure about is a silent loss and
    // firing one is a visible duplicate.
    if (typeof event?.eventId !== 'string') return true;
    const { appended } = profiles.recordFacts(profileId, [{
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
    // WHETHER THIS WAS NEWS. recordFacts is idempotent by eventId, so `appended` already answers the
    // only question a ceremony needs to ask: had this device seen this exact fact before? On a
    // reconnect to a wiped server the device teaches its own marks back and the server announces
    // them straight to it, and every one of those arrives here having been journalled long ago.
    if (appended === 0) rewardsAlreadyKnown += 1;
    return appended > 0;
  }

  // Phase D (D4): mark-earned/lantern-unlocked are never raised by combat/encounter.js, so they can
  // never enter createEncounterFeedback's table (see rewards/feedback.js's header for why that is a
  // hard boundary, not an oversight) -- this is their own dispatcher, same discipline.
  const onRewardEvent = createRewardFeedback({
    // Pips are re-rendered directly from the current mark count every frame below, the same way
    // health is re-rendered from event.remaining above; nothing extra needed per-event.
    // The banner AND the spark are what tell the child a wolf was worth something -- the pip alone
    // is 1.1rem of dot in a corner they are not looking at while a wolf is biting them. The spark
    // lifts off wherever the wolf went down (its last published position, read here rather than at
    // dispatch time so it is the position the child just watched it die at) and flies to the belt.
    'mark-earned'(event, { firstTimeSeen }) {
      rewardEventLog.push(event);
      // NOT OWED A SECOND TIME. This handler used to launch a light unconditionally, and on a
      // reconnect to a server that has never heard of this child, the device teaches its marks back
      // and the server announces every one of them -- so two marks earned minutes ago each launched
      // a fresh light from wherever the wolf happens to be standing.
      //
      // Worse than the duplicate ceremony: `marksInTheAir` went up by two, and the pips are drawn as
      // "what the server credits MINUS what is still flying", so the child's lantern row read ZERO
      // while they were holding two marks. Measured in a browser, at the moment of reconnect:
      // `pips 0, server's own keyed entry 2, harness read 2`. Their save was intact and the HUD said
      // they had nothing.
      //
      // This is the rule the rest of this table already states in its own comments -- "those diffs
      // are what make a beat survive a reconnect without replaying, so nothing here may fire one".
      // These two were the handlers not keeping it.
      if (!firstTimeSeen) return;
      // GP1-C6: NO BANNER HERE ANY MORE. This fires on the same frame as wolf-defeated, so the two
      // announcements used to overwrite each other -- "The wolf is beaten!" appeared and was replaced
      // by "Lantern Mark!" before it could be read, and both landed under the kill's own gold burst.
      // The reward now speaks when its light arrives, about a second later, with the frame to itself.
      // See celebrateMarkArrival.
      marksInTheAir += 1;
      // mark-earned does not carry combat identity yet; use the opening authored Wolf by stable
      // identity for this legacy reward presentation. Hit/defeat feedback below is fully
      // enemyId-addressed.
      const source = openingEnemyOfKind('wolf');
      if (source) markSparks?.launch({ x: source.x, z: source.z });
    },
    // Says what to DO, not what changed state. "Lantern unlocked!" was accurate and useless: it
    // fires out at the wolf, 18 m from the tree, and the child's next question is "now what".
    'lantern-unlocked'(event, { firstTimeSeen }) {
      rewardEventLog.push(event);
      // Same rule as the mark above: a returning child must not be told to take their marks home
      // again because the server they just met was told about them.
      if (!firstTimeSeen) return;
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
    // lift, Wren's charm -- and those diffs are what make a beat survive a reconnect without
    // replaying, so nothing here may fire one. What these add is the NAMED fact, journalled by the
    // dispatch loop under the id the store wrote it with.
    'gear-owned'(event) { rewardEventLog.push(event); },
    'gear-equipped'(event) { rewardEventLog.push(event); },
    'satchel-taken'(event) { rewardEventLog.push(event); },
    'charm-earned'(event) { rewardEventLog.push(event); },
    // P2: durability only, on exactly the same footing as the five above. The XP this fact records is
    // what pays for the level-up, and the level-up is fired by DIFFING the folded level in the frame
    // loop -- see the level-up beat there for why a one-shot beat must never hang off an
    // announcement. What this handler adds is the NAMED fact, journalled by the dispatch loop under
    // the id the store wrote it with, so this device keeps its own copy of the hundred XP.
    'xp-earned'(event) { rewardEventLog.push(event); },
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
  let specialPulseTimer = null;
  function pulseMiss() {
    attackButtonElement.dataset.feedback = 'miss';
    window.clearTimeout(missPulseTimer);
    // Matches the miss-ring keyframe duration in index.html: the attribute is what the animation
    // hangs on, so clearing it early (it was 160, against a 320ms ring) cut the ring off halfway out
    // and left the pulse looking like a flicker rather than a throw. 420 now, with the ring holding
    // full strength for the first 45% of it -- see that keyframe's own comment.
    missPulseTimer = window.setTimeout(() => { delete attackButtonElement.dataset.feedback; }, 420);
  }

  function pulseSpecial() {
    specialButtonElement.dataset.feedback = 'hit';
    window.clearTimeout(specialPulseTimer);
    specialPulseTimer = window.setTimeout(() => { delete specialButtonElement.dataset.feedback; }, 620);
  }

  // One place where a rule event becomes something a young player can see. Kept separate from the
  // rules on purpose: encounter.js must stay importable by a node server with no DOM. Built with
  // createEncounterFeedback() so a new event type raised by encounter.js throws here at startup
  // instead of being silently dropped the way every event but three used to be -- see
  // combat/feedback.js and feedback.test.mjs.
  const onEncounterEvent = createEncounterFeedback({
    // The arm swing already playing is the feedback for a swing starting; nothing else needed yet.
    swing() {},
    'special-start'() {
      pulseSpecial();
      banner(`NEW POWER: ${SPECIAL_ATTACK_NAME}!`, 2400, `New power: ${SPECIAL_ATTACK_NAME}.`);
    },
    'swing-missed'() { pulseMiss(); },
    // Going down mid-swing already produces the hurt flash and the "You went down" banner from the
    // same frame's hero-hurt/hero-down events. The dropped swing needs no extra signal of its own;
    // it is declared here because the dispatcher requires every event to be accounted for, and that
    // requirement is the point -- it is how this event announced itself instead of vanishing.
    'swing-dropped'() {},
    'wolf-hit'(event) {
      const enemy = enemyById(event.enemyId);
      enemyPresenters.get(event.enemyId)?.flashHit?.();
      if (!enemy) return;
      // GP1-C5: the ring, at the same point on the identified wolf the damage number is already
      // anchored to, so two enemies can never steal each other's hit flash after a collection reorder.
      impactBursts.burst({
        x: enemy.x, y: WOLF_SPARK_HEIGHT_METERS, z: enemy.z, kind: 'hit',
      });
      // event.damage, not a hardcoded 1 -- see WOLF_DAMAGE_PER_HIT's own comment in encounter.js.
      popDamageNumber(enemy.x, WOLF_SPARK_HEIGHT_METERS, enemy.z, event.damage);
    },
    'special-hit'(event) {
      const enemy = enemyById(event.enemyId);
      enemyPresenters.get(event.enemyId)?.flashHit?.();
      if (!enemy) return;
      impactBursts.burst({
        x: enemy.x, y: WOLF_SPARK_HEIGHT_METERS, z: enemy.z, kind: 'special',
      });
      popDamageNumber(enemy.x, WOLF_SPARK_HEIGHT_METERS, enemy.z, event.damage);
    },
    'special-missed'() { pulseMiss(); },
    // GP1-C5: the kill is a COMPOSITION, and the pieces were always here -- they just never added up
    // to one moment. Same frame: the defeat flash turns the wolf the colour of the light it stole
    // (not the white a plain hit uses), a ring of that same light blows outward far wider and slower
    // than a hit's, the wolf's own spark goes out, and the death clip starts. A beat later
    // mark-earned launches that light to the boy's belt and says so. Nothing here is new machinery;
    // what changed is that a kill no longer looks like the hit before it.
    'wolf-defeated'(event) {
      const enemy = enemyById(event.enemyId);
      enemyPresenters.get(event.enemyId)?.flashDefeated?.();
      if (enemy) {
        impactBursts.burst({
          x: enemy.x, y: WOLF_SPARK_HEIGHT_METERS, z: enemy.z, kind: 'kill',
        });
      }
      banner('The wolf is beaten!', 1800);
    },
    // The flinch is gated on the swing state at dispatch time: the owner's precedence rule (2026-08-13)
    // is that attack wins and a hit only shows when the testers are not attacking. reactClips.js
    // refuses the trigger itself (and is null until the rig actually ships hit/death clips), so
    // the flash and the health bar here remain the guaranteed feedback either way.
    'hero-hurt'(event) {
      flashHeroHurt();
      renderHealth(event.remaining);
      reactions?.triggerHit({ swinging: swing?.isSwinging() === true });
      // THE ONE SENTENCE THE GAME NEVER SAID. Measured against the real rules: a child who freezes
      // and never swings takes 7 knockouts in a minute and never scratches the wolf, while a child
      // who mashes the button kills it in 3.85 seconds. The whole distance between those is whether
      // they found the verb, and nothing -- not the Keeper, not a banner, not a hint -- had ever
      // named it. combat/coaching.js carries the measurement and picks the line for this device.
      //
      // Once, on the FIRST bite. A child who has been told and is now fighting does not need telling
      // again, and a game that repeats itself is a game they stop reading. Held a little longer than
      // an ordinary banner because it is the only instruction in the game.
      if (!combatCoached) {
        combatCoached = true;
        rememberTeaching({ attackTaught: true });
        banner(firstHurtCoachingLine(POINTER_MODE), 3200);
      }
    },
    // The wolf's jaws visibly close on nothing; that already reads without extra feedback.
    'bite-missed'() {},
    // The banner says it; the veil and the filling bar are what a child who is not reading gets.
    'hero-down'() { showHeroDown(true); banner('You went down…', 1600); },
    'hero-respawned'() { showHeroDown(false); renderHealth(healthMax); banner('Back on your feet', 1200); },
    // Beating a wolf gives health back. No banner: wolf-defeated's "The wolf is beaten!" is already
    // on screen from the same frame, and a second banner would replace it mid-read. The health row
    // popping IS the message, and it points at exactly the thing that changed.
    'hero-healed'(event) { renderHealth(event.remaining); popHealth(); },
    // the owner's ruling, 2026-08-13: WOLF_RESPAWN_SECONDS after a kill, the wolf is back. No presenter
    // consumer yet -- the stable-ID presenter registry reads each enemy's mode/hp off encounterState
    // every frame and draws whatever it finds, so a respawn needs no push here. Declared
    // (rather than left off the table) for the same reason every other event is: the dispatcher
    // throws at startup on a gap instead of silently dropping an event during a fight.
    'wolf-respawned'() {},
  });
  // Paint from the encounter's own starting hp rather than trusting the markup's default -- the
  // markup only needs to be right until this line runs.
  renderHealth(encounterState.hero.hp);
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
  // siege raises them too: they mean exactly the same thing in both fights (this hero's health), the
  // wolf's dispatcher already does exactly the right thing with them, and a hero has one set of
  // health whichever fight knocked them over.
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
  let lastReconcile = { drift: 0, snapped: false, corrections: 0 };
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
      for (const event of events) {
        if (event.type === 'hero-down' && event.heroId === net.selfId) {
          authoritativeDownObserved = true;
        }
        if (event.type === 'hero-respawned' && event.heroId === net.selfId
          && Number.isFinite(event.protectionSeconds) && event.protectionSeconds > 0) {
          authoritativeRecoveryProtectionSeconds = event.protectionSeconds;
        }
      }
      if (events.length > 0) pendingServerEvents.push(...events);
    },
  });

  /**
   * THE HIDDEN LEARNING LAYER's own reward path, and the ONE PLACE this file decided XP over coins.
   *
   * The brief's own instruction was to READ THE CODE and pick whichever reward the actual reward
   * infrastructure honestly supports, rather than inventing a new one. Reading it: a coin has no
   * client-initiated grant path AT ALL -- world/enemyDrops.js's own header is explicit that a kill
   * drop's coin only ever exists because the SERVER rolled it (or, offline, because a local roll
   * mirrors that same rule with no server to check it against); there is no
   * `net.sendXCollectedThisCoinIEarnedMyself()` message anywhere in net/client.js, and H1 is exactly
   * the rule that forbids inventing one -- a client-restorable coin-earned fact is REFUSED outright by
   * progression/facts.js's own CLIENT_RESTORE_REFUSED_TYPES (coin-earned/shard-earned), because a coin
   * funds the shared Village economy and a device asserting "I have coins now" with nothing behind it
   * is exactly the shared-currency forgery H1 exists to prevent.
   *
   * XP, by contrast, already has TWO production sources that are durable, personal, and (P2's Lantern
   * aside) MINTED CLIENT-SIDE with no server adjudication behind the roll itself: rewards/killXp.js's
   * own offline fold journals a `kill-xp:offline-hero:...` fact with nothing checking whether that
   * kill really happened, and progression/facts.js's own PROFILE_SCOPED_EVENT_ID_PREFIXES already
   * documents `xp-earned` as a type a profile may restore for itself. So this fact rides the IDENTICAL
   * door: minted locally (runeChestXpEventId), journalled locally (profiles.recordFacts, both online
   * and offline -- see runeChests.js's own header for why there is only one code path here at all),
   * and -- the one extra step a kill's XP does not need, because the SERVER minted that one itself --
   * pushed to the server via the SAME restoreProfileFacts door a reconnect already uses (see
   * ingestWelcome above), so an ALREADY-CONNECTED session sees it folded into the next tick's own
   * rewards block rather than waiting for a future reconnect that might never come this session.
   * sendRestoreProfile is a no-op offline (net/client.js's own online-only guard), which is exactly
   * the fallback this needs: offline, the local journal alone is the whole of "durable" this game has.
   *
   * REWARD SIZED IN XP, NOT COINS, AND THAT TURNS OUT TO BE THE BETTER REWARD ANYWAY: XP feeds the
   * level-up ceremony (progression/heroStats.js's own resolveHeroStats, diffed every frame below), so
   * a rune chest's payoff is not merely "a number went up" but a real chance at the biggest ceremony
   * this game has -- for free, because that ceremony already fires off whatever total XP this profile
   * reports, from whichever source.
   */
  function onRuneChestAnswer(answerIndex) {
    const chest = runeChestState.chest;
    // Defensive only: the card can only be open while a chest stands (main.js's own proximity gate
    // below never shows it otherwise), but this reads a tap event, not a trusted message -- the same
    // "a confused caller gets the safe answer, never a crash" posture judgeRuneChestAnswer itself
    // takes for an out-of-range index.
    if (!chest) return;
    const judged = judgeRuneChestAnswer(chest.question, answerIndex);
    const amount = rewardXpForRuneChestAnswer(judged.correct);
    const fact = { eventId: runeChestXpEventId(profileId, chest.id), type: 'xp-earned', value: String(amount) };
    profiles.recordFacts(profileId, [fact]);
    refreshProfileState();
    // Push it to an already-connected server RIGHT NOW rather than waiting for the next welcome --
    // see this function's own header for why this is safe and why it is necessary.
    if (durableProfileId) net.sendRestoreProfile([fact]);
    popXpToast(chest.x, WOLF_SPARK_HEIGHT_METERS, chest.z, amount);
    if (judged.correct) {
      audio.play(RUNE_CHEST_BRILLIANT_RECIPE_NAME);
      banner('BRILLIANT!', 2200, 'Brilliant!');
    } else {
      // NEVER SHAMING -- the brief's own word. Warm, not a buzzer: the chest opened anyway, and the
      // text says what the answer was rather than merely that this one was wrong.
      audio.play(RUNE_CHEST_OPEN_RECIPE_NAME);
      banner(`Nice try! The answer was ${judged.correctText}`, 2600, `Nice try. The answer was ${judged.correctText}.`);
    }
    runeChestState = closeRuneChest(runeChestState);
  }

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
    // Runtime-test compatibility only: derive the shipped Wolf presenter from stable collection
    // identity, with the single-Wolf fixture fallback kept for older isolated tests.
    wolf: () => {
      const wolf = openingEnemyOfKind('wolf');
      return wolf ? enemyPresenters.get(wolf.enemyId) : null;
    },
    enemyPresenter: (enemyId) => enemyPresenters.get(enemyId),
    enemyPresenters: () => enemyPresenters.describe(),
    // Checkpoint 0's companion is a cosmetic presenter only. The state is read-only evidence for
    // the follow harness; it is never sent through net, combat, rewards, quests, or persistence.
    companion: () => companionPresenter?.getState() ?? null,
    net,
    remotes: () => remotes,
    // R1 runtime-test evidence: the drops the child can currently see, under the SAME
    // online/offline selection rule the frame loop's own collect pass uses (the
    // `netStatus === 'online'` branch over serverEncounter?.drops vs dropsState.drops). Read-only
    // published state, the identical boundary encounterState() draws -- a harness that could spawn
    // or collect a drop through this hook could walk a path no child can.
    dropsOnGround: () => (netStatus === 'online'
      ? (serverEncounter?.drops ?? [])
      : dropsState.drops),
    netState: () => ({
      status: netStatus,
      selfId: net.selfId,
      remoteCount: remotes?.count ?? 0,
      remotes: remotes?.describe() ?? [],
      serverSelf: net.serverSelf,
      snapshots: net.snapshotCount,
      drift: lastReconcile.drift,
      snapped: lastReconcile.snapped,
      // How many snapshots the last reconcile actually consumed. Published so a harness can MEASURE
      // the correction count instead of modelling it from a frame rate it cannot predict -- the
      // modelled version is what play-fight's settle budget had to guess at.
      corrections: lastReconcile.corrections,
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
    // E2 hosted safety proof: expose the last decoded authoritative encounter separately from the
    // client-facing solo projection, so a slow render loop cannot hide a real server protection state.
    authoritativeEncounterState: () => serverEncounter,
    authoritativeDownObserved: () => authoritativeDownObserved,
    authoritativeRecoveryProtectionSeconds: () => authoritativeRecoveryProtectionSeconds,
    /** The swing the ANIMATION is playing, which online is the local prediction until the server
     *  confirms and the server's own number afterwards. Read-only, and published for the same
     *  reason heroDownShown is: a claim about what is on screen has to be answerable from what is
     *  on screen, not from the rules layer that is still a round trip behind it. */
    swingSecondsShown: () => swingSecondsShown,
    specialState: () => {
      const hero = netStatus === 'online' && net.selfId !== null
        ? (serverEncounter?.heroes?.[net.selfId] ?? DEFAULT_HERO_VIEW)
        : encounterState.hero;
      const level = heroStatsThisFrame.level;
      return {
        id: 'wildwood-burst',
        name: SPECIAL_ATTACK_NAME,
        unlockLevel: SPECIAL_ATTACK_UNLOCK_LEVEL,
        unlocked: level >= SPECIAL_ATTACK_UNLOCK_LEVEL,
        ready: level >= SPECIAL_ATTACK_UNLOCK_LEVEL
          && (hero.specialCooldown ?? 0) <= 0
          && (hero.specialSeconds ?? -1) < 0
          && hero.downSeconds < 0,
        cooldown: hero.specialCooldown ?? 0,
        active: (hero.specialSeconds ?? -1) >= 0,
      };
    },
    // GP1-C5: how many impact rings are on screen this instant, so a harness can prove a blow
    // produced a visible event rather than only that the rules said it landed.
    impactBurstsLive: () => impactBursts.liveCount(),
    // The always-on wayfinding trail: how many ground dots are lit right now, so a harness can prove
    // the path actually drew rather than only that an objective with a place was active.
    guidePathDotsLive: () => guidePath.liveCount(),
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
    // ARC 2: is Wren in the world, is she carrying anything of ours yet, and how big is this body
    // actually. Reported as OBSERVABLE facts rather than as the flags behind them --
    // `rangerHere` is whether the mesh is drawn, not whether the Beacon is lit, which is the
    // distinction docs/MISTAKES.md GQ-013 is about.
    // The guidance rescue's own reading, for the same reason every zone exposes one: a harness has
    // to be able to ask why the offer did or did not appear, and "it did not" is not an answer.
    // WHY THE LANTERN ROW LOOKS THE WAY IT DOES. The pips are drawn as "what the child has been
    // credited MINUS what is still flying to them", and when they read zero beside a credited count
    // of two there is no way to tell from outside which half is responsible. Same posture as every
    // other accessor here: readable, not drivable.
    // P2: what this hero actually IS right now, so a harness can ask "did the level reach the fight"
    // rather than inferring it from a screenshot at a guessed moment. Reported as the RESOLVED
    // numbers the fight was handed, not as the facts behind them -- the distinction
    // docs/MISTAKES.md GQ-013 is about -- plus how many level-up beats this SESSION has fired, which
    // is the only way to prove from outside that hydration did not replay one.
    heroProgressState: () => ({
      level: heroStatsThisFrame.level,
      totalXp: heroStatsThisFrame.levelState.totalXp,
      xpIntoLevel: heroStatsThisFrame.levelState.xpIntoLevel,
      xpForLevel: heroStatsThisFrame.levelState.xpForLevel,
      maxHp: heroStatsThisFrame.maxHp,
      heroDamage: heroStatsThisFrame.heroDamage,
      power: powerFor(heroStatsThisFrame),
      levelUpsThisSession: levelUpCount,
      // Whether the ceremony is on screen RIGHT NOW, from the element rather than from a flag beside
      // it -- the same "report the observable, not the intention" discipline every other accessor in
      // this object keeps. A harness asking "did a child see it" must not be answered by a boolean
      // that only says somebody meant them to.
      celebrating: levelUpElement?.dataset.shown === 'true',
      reducedMotion: prefersReducedMotion(),
    }),
    markHudState: () => ({
      marksInTheAir,
      authoritativeMarksThisFrame,
      pipsShown: lanternPipElements.filter((pip) => pip.dataset.filled === 'true').length,
      // How many reward announcements arrived that this device had ALREADY journalled. Non-zero
      // means the server told this child about something they earned before it had ever heard of
      // them -- which is exactly what a reconnect to a wiped database does, and exactly the case a
      // one-shot ceremony must not fire for.
      rewardsAlreadyKnown,
    }),
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
      // THE BODY, as the readout actually shows it. Renamed from hearts/heartCeiling in P2: the
      // fixed pip row is gone and max HP is a Hero STAT now (progression/heroStats.js), so a name
      // that counts hearts would be a harness asking a question the game no longer answers -- and
      // GQ-017 is explicit that the readers under tools/ are part of a type change, not an
      // afterthought.
      hp: healthShown.hp,
      maxHp: healthShown.maxHp,
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
      // The Warden's own head BONE height in world metres. Published because "the presenter exists"
      // and "a child can see it" turned out to be different questions: a 113x scale once put the
      // body 150 m up with wardenBuilt still true and every siege check still green.
      wardenHeadMeters: zoneWarden?.getState().headMeters ?? null,
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
    // THE HIDDEN LEARNING LAYER's own card, the third (and, by the same mutual-exclusion the two
    // above already keep, exclusive) full-screen overlay that owns input the same way.
    const runeChestCardOpen = runeChestCard.isOpen();
    // Either overlay open suspends the same movement/attack input -- checked once here and reused
    // below, the same "checked once, not polled per-system" reasoning heroScreenOpen's own comment
    // already gives, just widened to cover all three screens now that there are three.
    const anyOverlayOpen = heroScreenOpen || villageBoardOpen || runeChestCardOpen;
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
    // The whole equipped-per-slot map, resolved once so the fight below, the helmet mount and the
    // Hero screen all read the same answer rather than three copies of "online ? wire : journal".
    const currentEquippedItemIds = equippedItemIdsFromRewards(ownRewards);
    // HOW STRONG THIS HERO IS, resolved once per frame from whichever authority is live, and read by
    // everything downstream: both offline fights, the Hero screen, the HUD and the level-up watch.
    //
    // Online that authority is the server's rewards block (which folded it from the durable rows);
    // offline it is this device's own journal, folded to the same shape. One resolve() call rather
    // than several, for the reason progression/heroStats.js gives for returning one object: a fight
    // that reads its damage from one place and its body from another is how the online and offline
    // hero end up being different heroes.
    heroStatsThisFrame = resolveHeroStats({
      totalXp: Number.isSafeInteger(ownRewards?.xp) ? ownRewards.xp : 0,
      equippedWeaponId: currentEquippedWeaponId,
      equippedItemIds: currentEquippedItemIds,
      charmOwned: ownRewards?.charmOwned === true,
    });

    // ── THE LEVEL-UP BEAT ──────────────────────────────────────────────────────────────────────
    //
    // Fired off the DIFF, never off the xp-earned announcement, which is the discipline every other
    // one-shot reward beat in this file already keeps and the reason they survive a reconnect. On a
    // reconnect to a server that has never heard of this child, the device teaches its own facts
    // back and the server announces every one of them straight to it -- so a ceremony hung off the
    // announcement would replay a level the child crossed last week. The folded level does not move
    // when a fact the child already had is re-announced, so a beat hung off it cannot.
    const levelBeat = levelUpTransition(heroLevelSeen, heroStatsThisFrame.level);
    heroLevelSeen = levelBeat.to;
    if (levelBeat.celebrate) {
      // The hero they WERE, resolved through the same law as the hero they are -- same weapon, same
      // charm, one level down -- so the ceremony's "+5 MAX HP" and "1,000 -> +400 -> 1,400" are the
      // real difference between two states of this child rather than a remembered snapshot that
      // could have gone stale while the XP was in flight.
      const before = resolveHeroStats({
        totalXp: cumulativeXpForLevel(levelBeat.from),
        equippedWeaponId: currentEquippedWeaponId,
        charmOwned: ownRewards?.charmOwned === true,
      });
      celebrateLevelUp(levelBeat.from, levelBeat.to, before, heroStatsThisFrame);
    }

    // The pill, painted every frame from the same resolved stats -- except while the rollover is
    // holding it at the level the child just finished. See XP_ROLL_MS.
    if (progressHold !== null && performance.now() >= progressHold.until) progressHold = null;
    renderHeroProgress(progressHold ?? {
      level: heroStatsThisFrame.level,
      xpIntoLevel: heroStatsThisFrame.levelState.xpIntoLevel,
      xpForLevel: heroStatsThisFrame.levelState.xpForLevel,
      power: powerFor(heroStatsThisFrame),
    });
    if (heroScreenOpen) {
      heroScreen.render(heroScreenViewModel({
        equippedWeaponId: currentEquippedWeaponId,
        // The whole equipped-per-slot map, so the Shield and Helmet slots read the truth the fight
        // reads -- the same map heroStatsThisFrame was resolved from this frame (G1-C3).
        equippedItemIds: currentEquippedItemIds,
        ownedItemIds: ownedItemIdsFromRewards(ownRewards),
        selectedItemId: selectedHeroItemId,
        // The SAME object the fight is being fed this frame, so the screen cannot print a hero the
        // combat rules have not agreed to.
        stats: heroStatsThisFrame,
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
    // G1-C3: the helmet he is actually wearing, from the SAME equipped map the fight and the Hero
    // screen read, so the world, the DOM and the showcase can never disagree about whether it is on.
    // Runs every frame whether the screen is open or closed -- the armour has to be true in ordinary
    // play, not only while a child is looking at the menu (heroPreview.update below re-reads the live
    // hero, so a helmet mounted here joins the showcase preview on its own).
    ensureHelmetMounted(currentEquippedItemIds[HELMET_SLOT] === HELMET_SILVERGUARD_ID);
    // R1: the shoulders he is actually wearing, from the same equipped map -- the identical "the
    // world, the DOM and the showcase can never disagree" reasoning the helmet's own call gives.
    ensureShouldersMounted(currentEquippedItemIds[SHOULDERS_SLOT] === SHOULDER_SILVERGUARD_ID);
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
    // MOVEMENT IS LEARNED BY DOING IT. There is no movement tutorial to have been shown, so the
    // honest latch is that this child has driven themselves at least once -- which is the thing any
    // future "use the stick" hint would need to know, and the thing that must not un-learn itself on
    // reload. Gated on a real push rather than any non-zero reading, so a resting thumb or a
    // fractional drift does not count as having learned.
    if (!movementTaught && inputMagnitude > 0.25) {
      movementTaught = true;
      rememberTeaching({ movementTaught: true });
    }
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
      // Same reasoning as the clamp two lines up, same shared pure function the server runs
      // (world/obstacles.js) -- applied here, in the PREDICTION step itself, so a child's own thumb
      // never watches the hero walk into the Beacon's stone for even one frame before a reconcile
      // corrects it. Run unconditionally (online and offline both), because unlike an enemy's
      // position -- which only the server truly knows -- the Village's own landmarks never move, so
      // this client already has everything it needs to get the answer right the first time.
      const unstuck = resolveObstacleCollisions(player.position, WORLD_OBSTACLES);
      player.position.x = unstuck.x;
      player.position.z = unstuck.z;
      player.heading = Math.atan2(worldDirection.x, worldDirection.z);
    }
    // Intent out. The client throttles to 15 Hz and sends a release immediately.
    net.setIntent(worldDirection.x, worldDirection.z, inputMagnitude, input.run);
    // Pull the local prediction back towards the server's version of us. The local hero stays
    // locally predicted -- it must respond to a thumb without waiting for a round trip -- so this
    // only corrects the accumulated difference.
    lastReconcile = net.reconcile(player.position);

    // Online: the fight is the server's (Task B4). Mirror the last published block onto
    // encounterState -- health, the swing, enemy presenters, and the status line all read the
    // collection plus `hero` off it, none of them needing to know whether they are reading a local step's result or
    // the server's. Offline: encounterState is still advanced by the local rules further down,
    // unchanged (ruling 8).
    //
    // The mirror carries a COMPLETE collection-shaped encounter state, not just presenter fields -- root-caused
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
        enemies: published.enemies.map(mirrorPublishedEnemy),
        heroSpawn: HERO_SPAWN,
        recoverySanctuary: RECOVERY_SANCTUARY,
        hero: { swingLanded: false, ...ownHero },
      };
    }

    // HEALTH FROM THE BODY, diffed, once per frame, online and off.
    //
    // Every other renderHealth call in this file is EVENT-driven, which was correct while a hero's
    // ceiling was a constant: 'hero-healed' carries `remaining` and nothing else, and nothing else
    // was needed. Wren's charm moves the ceiling with no combat event at all -- it is a durable row
    // arriving on the next snapshot's rewards block -- and since P2 a LEVEL moves it the same
    // silent way -- so a bigger body would otherwise appear only on the child's next heal, kill or
    // death. Reading the published body and repainting when either number moves costs one comparison
    // a frame and makes the bar unconditionally honest; the event handlers keep their real jobs,
    // which are the POP and the flash, not the truth.
    const bodyNow = encounterState.hero;
    const bodyMax = bodyNow.maxHp ?? HERO_MAX_HP;
    if (bodyNow.hp !== healthShown.hp || bodyMax !== healthShown.maxHp) {
      // R1: a rise shaped like out-of-combat regen (never a kill heal or a heart, which both jump by
      // far more than isOutOfCombatRegenRise's own one-point ceiling) gets the shimmer. Read BEFORE
      // healthShown moves, since the predicate compares the two hp values across this exact diff.
      if (isOutOfCombatRegenRise(healthShown.hp, bodyNow.hp)) pulseRegen();
      healthShown = { hp: bodyNow.hp, maxHp: bodyMax };
      renderHealth(healthShown.hp, healthShown.maxHp);
    }

    // Stop the hero walking through the wolf. Applied after movement and reconciliation so it is the
    // last word on where the hero stands, and before the hero is drawn, so no frame ever shows the
    // two bodies overlapping. Online, the server already does this (Design ruling 6, Task B3's
    // `simulation.step()`) and net.reconcile() above is what pulls this client's own prediction
    // back to agree with it -- applying the local push again here would double-correct against a
    // wolf position this same tick's snapshot may already have moved.
    if (netStatus !== 'online') {
      const separated = separateFromEnemies(player.position, encounterState.enemies);
      // #79, offline half: the same Warden body law the server runs every tick, so a child playing
      // alone is pushed out of the boss exactly as a child on a server is. Online it is deliberately
      // skipped with the wolves' own push, for the reason stated above -- the server already did it
      // and reconcile() is what agrees with it.
      const clearOfWarden = separateFromWarden(separated, siegeState.warden);
      player.position.x = clearOfWarden.x;
      player.position.z = clearOfWarden.z;
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
      //
      // The party block rides along because a sibling has a body too. The wire has carried every
      // hero's swingSeconds and downSeconds since the party fight was written -- not just this
      // one's -- and until this argument existed net/remotes.js drew all of them in idle: a child
      // watched their sibling glide around while the wolf lost hp from nowhere, and stand upright
      // through the two seconds they were dead.
      //
      // Read off `serverEncounter` rather than `encounterState`, and that is not incidental. The
      // online rebuild above folds only THIS hero out of the party (`published.heroes[ownHeroId]`
      // -> `hero`), so `encounterState` has no party on it; and giving it one would put the wire's
      // four-field hero shape and the rules' full hero shape under a single name, which is the
      // two-competing-truths problem rather than a convenience. Same `serverEncounter?.x` idiom
      // `village` uses a few lines up.
      //
      // BOTH DELTAS, EXPLICITLY. The clamped one is a movement guard; handing it to a reaction
      // mixer plays every reaction in slow motion by the ratio -- the defect documented at length
      // on the LOCAL hero further down, and the single easiest thing to reintroduce here by
      // passing one number for two jobs.
      //
      // The weapons come off the REWARDS block, which already carries `equippedWeaponId` per hero on
      // every snapshot. The first version of this added `players[].weaponId` to the wire, plumbed it
      // through protocol.js and all three of interpolation.js's sample paths, and only then noticed
      // the fact was already there -- a second source for one truth, which is the shape half this
      // repo's ledger is about. Withdrawn. The one thing the withdrawn version had that this does not
      // is that the sword travelled WITH the interpolated body, so a swap landed on the frame the
      // hand arrived rather than an interpolation delay ahead of it; that is a hundred milliseconds
      // on a once-a-session event, and it is not worth a duplicate wire field. `heroes` above is read
      // the same way, for the far more timing-sensitive knockdown.
      remotes?.update(net.sampleRemotes(), {
        deltaSeconds,
        reactionDeltaSeconds: frameDeltaMs === null ? 0 : frameDeltaMs / 1000,
        heroes: netStatus === 'online' && serverEncounter?.heroes ? serverEncounter.heroes : {},
        rewards: netStatus === 'online' && serverEncounter?.rewards ? serverEncounter.rewards : {},
      });
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
      const tappedSpecial = specialAttack.takeAttack() && !anyOverlayOpen;
      const pressedSpecial = keyboard.takeSpecial() && !anyOverlayOpen;
      const outsideSpecialArena = isOutsideSpecialArena(player.position, VILLAGE.BEACON_ARENA);
      // Two commands, in the order a player produces them: the button press, then the clock. Events
      // from both are collected and dispatched together below, which is the order this loop has
      // always used -- the presenters are updated to the newest state first, then told what changed.
      const events = [];
      // R1: which of THIS frame's kills this hero personally landed the killing blow on -- the XP
      // toast's own gate (see the dispatch loop below). Online, GLOBAL_ENCOUNTER_EVENT_TYPES lets a
      // sibling's wolf-defeated through too (everyone's presenter should flash/celebrate together),
      // and stripHeroId erases who it belonged to before `events` sees it -- so this has to be
      // captured HERE, before the strip, or the toast could not tell "my kill" from "a kill I merely
      // watched". Offline there is only one hero, so every defeat is unconditionally this one's own.
      const myKillEnemyIds = new Set();
      if (netStatus === 'online') {
        // Combat commands are server-applied, presentation is client-predicted (Design ruling 3).
        // No local stepEncounter/requestAttack/separateFromEnemies here at all -- HP, enemy mode,
        // health, banners and events all come exclusively from the mirror set up above.
        const ownHeroId = net.selfId;
        const canSwing = ownHeroId !== null && serverEncounter !== null
          && canHeroAttack(serverEncounter, ownHeroId);
        const canBurst = ownHeroId !== null && serverEncounter !== null
          && outsideSpecialArena
          && canHeroSpecialAttack(serverEncounter, ownHeroId, heroStatsThisFrame.level);
        attack.setReady(canSwing);
        specialAttack.setReady(canBurst);
        renderSpecialButton(encounterState.hero, heroStatsThisFrame.level, canBurst);
        if ((tappedAttack || pressedAttack) && canSwing) {
          net.sendAttack();
          // Presentation only: the clip starts on the button press, not on the server's ack, so a
          // thumb sees the sword move immediately. Handed off to the server's own swingSeconds (in
          // `hero` below) below the moment it confirms.
          predictedSwingSeconds = 0;
        } else if ((tappedSpecial || pressedSpecial) && canBurst) {
          net.sendSpecial();
        } else if (predictedSwingSeconds >= 0) {
          predictedSwingSeconds += deltaSeconds;
        }
        // Events ride snapshots at 10 Hz (ruling 7), queued by onEncounter between frames and
        // drained here, filtered to this hero and mapped back to the solo shape onEncounterEvent's
        // table expects.
        const drained = pendingServerEvents.splice(0, pendingServerEvents.length);
        for (const event of drained) {
          if (event.type === 'hero-respawned' && event.heroId === ownHeroId) {
            player.position.x = HERO_SPAWN.x;
            player.position.z = HERO_SPAWN.z;
            player.heading = 0;
            player.groundSpeed = 0;
          }
          // The siege's own events go to the siege's own table (see SIEGE_EVENT_TYPES). Filtered to
          // this hero the same way the wolf's are, EXCEPT the ones that are nobody's in particular
          // (a seal bursting, the Beacon catching, the Warden waking): those are world events, and
          // every child standing there should hear them, exactly like `wolf-defeated`.
          if (SIEGE_EVENT_TYPES.has(event.type)) {
            if (isOwnSiegeEvent(event, ownHeroId)) pendingSiegeEvents.push(stripHeroId(event));
            continue;
          }
          if (event.type === 'wolf-defeated' && event.heroId === ownHeroId) {
            myKillEnemyIds.add(event.enemyId);
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
        const canBurstBeforeInput = canUseSpecialAttackAtPosition(
          encounterState.hero,
          heroStatsThisFrame.level,
          player.position,
          VILLAGE.BEACON_ARENA,
        );
        if ((tappedSpecial || pressedSpecial) && canBurstBeforeInput) {
          const asked = requestSpecialAttack(encounterState, heroStatsThisFrame.level, nextCommandId++);
          encounterState = asked.state;
          events.push(...asked.events);
        }
        attack.setReady(canAttack(encounterState));
        const canBurst = outsideSpecialArena
          && canSpecialAttack(encounterState, heroStatsThisFrame.level);
        specialAttack.setReady(canBurst);
        renderSpecialButton(encounterState.hero, heroStatsThisFrame.level, canBurst);

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
          // Weapon PLUS what the levels added to the arm, from the one authority both fights use --
          // see heroStatsThisFrame. It was swingDamageFor(equippedWeaponIdThisFrame), which was the
          // weapon alone, and P2 is exactly the change that made that half an answer.
          heroDamage: heroStatsThisFrame.heroDamage,
          // ...and how big this body is. It rides the same command the server's own tick puts it on,
          // so an offline child's level is worth the same max HP an online child's is.
          maxHp: heroStatsThisFrame.maxHp,
          damageReductionPercent: heroStatsThisFrame.damageReductionPercent,
          heroLevel: heroStatsThisFrame.level,
          // THE SAME QUESTION net/gameServer.mjs asks per player, asked here for the offline hero
          // and answered by the same function against the same RANGER_CLAIM radius. A child playing
          // with no socket gets the identical sanctuary; two answers to "may the wolf have this
          // child" would be two things to keep in step, which is the whole of GQ-007.
          heroTargetable: !rangerSanctuaryHolds({
            heroX: player.position.x,
            heroZ: player.position.z,
            rangerX: VILLAGE.RANGER_CLAIM.at[0],
            rangerZ: VILLAGE.RANGER_CLAIM.at[1],
            claimRadiusMeters: VILLAGE.RANGER_CLAIM.radiusMeters,
            beaconLit: siegeState.beaconLit,
          }),
        });
        encounterState = stepped.state;
        events.push(...stepped.events);
        if (stepped.events.some((event) => event.type === 'hero-respawned')) {
          player.position.x = HERO_SPAWN.x;
          player.position.z = HERO_SPAWN.z;
          player.heading = 0;
          player.groundSpeed = 0;
        }

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

        // R1: kill drops, rolled locally with Math.random -- the SAME pure roll
        // (world/enemyDrops.js's own requestEnemyDrop) net/gameServerCore.mjs runs online, so a
        // child with no server gets the identical loop, just unseeded. One roll per wolf-defeated
        // this frame, scattered at that enemy's own last published position.
        for (const event of stepped.events) {
          if (event.type !== 'wolf-defeated') continue;
          // Solo offline: every defeat is this hero's own kill, unconditionally (see myKillEnemyIds'
          // own header comment above).
          myKillEnemyIds.add(event.enemyId);
          const deadEnemy = enemyById(event.enemyId);
          if (!deadEnemy) continue;
          // Approximates the multiplier THIS kill is about to earn -- the streak meter's own
          // registration runs a moment later, in the one dispatch loop every kill (online and off)
          // passes through, so the count is not yet advanced when this roll needs it. A streak still
          // alive continues, so this kill is one more than the count already showing. Offline there
          // is no second authority to disagree with: this same local streak IS what sizes the drop,
          // so a one-frame ordering approximation is the whole of the error (progression/streaks.js's
          // own header).
          const previewStreak = (streakStillActive(streakState) ? streakState.streak : 0) + 1;
          const rolled = requestEnemyDrop(dropsState, {
            enemyId: event.enemyId,
            lifeId: mintDropLifeId(),
            kind: event.kind,
            x: deadEnemy.x,
            z: deadEnemy.z,
            streakMultiplier: coinMultiplierForStreak(previewStreak),
            killerOwnedItemIds: ownedItemIdsFromRewards(profileState),
          }, Math.random);
          dropsState = rolled.state;
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
        const unlocked = unlockCardState({
          itemName: itemDef(WILDWOOD_BLADE_ID)?.name ?? 'Wildwood Blade',
          // Honest about what it replaces: compared against whatever is actually EQUIPPED right
          // now, read off the same id the hero's own hand is drawn from (GQ-007).
          fromDamage: damageFor(currentEquippedWeaponId),
          toDamage: damageFor(WILDWOOD_BLADE_ID),
        });
        unlockCard.show(unlocked);
        // And say it, for the child this card was always least use to. Same latch as the bubble and
        // the banner -- silent until a real tap has asked for it. See unlockCardState for why the
        // spoken wording is not the four strings on the card.
        speakKeeperLineIfUnlocked(unlocked.spoken);
        audio.play('blade-unlock');
      }

      // ── G1-C3: THE HELMET, ACQUIRED ─────────────────────────────────────────────────────────
      //
      // Diffed off owned items exactly as the Blade is -- a durable per-guest latch, adopted silently
      // on the first known frame so a returning child who earned it yesterday is not handed the moment
      // again, and firing only on a genuine false->true within a live session (which is also what a
      // reconnect is NOT: the folded ownership does not move when a fact the child already had is
      // re-announced). The one real difference is the OFFER. A helmet's worth is a POWER move, not a
      // DAMAGE line, so the card carries the resolved before->after POWER of wearing it and asks
      // EQUIP NOW?; ownership and equipment stay two beats, and putting it on is the child's, never
      // automatic. The card reuses ui/unlockCard rather than a second reward-card system, restyled
      // with the Helmet's own swatch and icon.
      const ownsHelmetNow = ownedItemIdsFromRewards(ownRewards).includes(HELMET_SILVERGUARD_ID);
      if (helmetOwnedSeen === null) {
        helmetOwnedSeen = ownsHelmetNow;
      } else if (ownsHelmetNow && !helmetOwnedSeen) {
        helmetOwnedSeen = true;
        // Hold the body and the arm still, move only the defence into the Helmet slot -- the same law
        // the Hero screen's compare card and the fight read, so the ceremony cannot promise a POWER
        // the Gear screen a child opens ten seconds later disagrees with.
        const afterEquipped = { ...currentEquippedItemIds, [HELMET_SLOT]: HELMET_SILVERGUARD_ID };
        const withHelmetPower = powerFor({
          maxHp: heroStatsThisFrame.maxHp,
          heroDamage: heroStatsThisFrame.heroDamage,
          damageReductionPercent: damageReductionPercentForEquipment(afterEquipped),
        });
        const acquired = unlockCardState({
          itemName: itemDef(HELMET_SILVERGUARD_ID)?.name ?? 'Silverguard Helmet',
          power: powerChange(powerFor(heroStatsThisFrame), withHelmetPower),
          prompt: 'EQUIP NOW?',
        });
        unlockCard.show(acquired, {
          accent: swatchFor(HELMET_SILVERGUARD_ID),
          // The catalogued portrait, so this ceremony and the inventory show one item.
          art: { iconUrl: itemIconUrlFor(HELMET_SILVERGUARD_ID), iconSvg: itemIconSvgFor(HELMET_SILVERGUARD_ID) },
          // The second beat, the child's to take. EQUIP NOW mints the same durable equip fact the
          // Hero screen would; LATER leaves it owned-but-off for the owned strip to equip later.
          onEquip: () => equipHeroItem(HELMET_SILVERGUARD_ID),
        });
        speakKeeperLineIfUnlocked(acquired.spoken);
        audio.play('blade-unlock');
      }

      // ── R1: THE SHOULDERS, ACQUIRED ─────────────────────────────────────────────────────────
      //
      // Ownership arrives from a kill drop (world/enemyDrops.js's own gear pool), not a claim
      // ceremony, but the CEREMONY is the identical diff-off-ownership beat the Blade and Helmet
      // already run -- a durable item became owned that was not a frame ago, online or off (the
      // offline fold below journals the same 'gear-owned' fact shape). No new machinery.
      const ownsShouldersNow = ownedItemIdsFromRewards(ownRewards).includes(SHOULDER_SILVERGUARD_ID);
      if (shoulderOwnedSeen === null) {
        shoulderOwnedSeen = ownsShouldersNow;
      } else if (ownsShouldersNow && !shoulderOwnedSeen) {
        shoulderOwnedSeen = true;
        const afterEquipped = { ...currentEquippedItemIds, [SHOULDERS_SLOT]: SHOULDER_SILVERGUARD_ID };
        const withShouldersPower = powerFor({
          maxHp: heroStatsThisFrame.maxHp,
          heroDamage: heroStatsThisFrame.heroDamage,
          damageReductionPercent: damageReductionPercentForEquipment(afterEquipped),
        });
        const acquiredShoulders = unlockCardState({
          itemName: itemDef(SHOULDER_SILVERGUARD_ID)?.name ?? 'Silverguard Shoulders',
          power: powerChange(powerFor(heroStatsThisFrame), withShouldersPower),
          prompt: 'EQUIP NOW?',
        });
        unlockCard.show(acquiredShoulders, {
          accent: swatchFor(SHOULDER_SILVERGUARD_ID),
          // The catalogued portrait, so this ceremony and the inventory show one item.
          art: { iconUrl: itemIconUrlFor(SHOULDER_SILVERGUARD_ID), iconSvg: itemIconSvgFor(SHOULDER_SILVERGUARD_ID) },
          onEquip: () => equipHeroItem(SHOULDER_SILVERGUARD_ID),
        });
        speakKeeperLineIfUnlocked(acquiredShoulders.spoken);
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
        // The bigger body paints ITSELF: the new maximum rides the same snapshot and the per-frame
        // health read above repaints the bar. This is only the sentence and the flourish.
        banner('Wren gives you her charm.', 3000);
        popHealth();
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
      // into the rules -- online or offline, `encounterState` is just data by this point. Enemy
      // identity comes from the collection; the legacy status line follows the opening Wolf.
      const { hero } = encounterState;
      const wolf = openingEnemyOfKind('wolf');
      // The server's own swingSeconds (mirrored into `hero` above) takes over the instant it
      // confirms, or the prediction times out on its own clock -- either way nothing downstream of
      // this line ever decides whether a swing lands; that stays server truth online.
      if (netStatus === 'online' && (hero.swingSeconds >= 0 || predictedSwingSeconds >= SWING_SECONDS)) {
        predictedSwingSeconds = -1;
      }
      const swingSecondsForClip = netStatus === 'online' && hero.swingSeconds < 0 && predictedSwingSeconds >= 0
        ? predictedSwingSeconds
        : hero.swingSeconds;
      const specialSwingSeconds = (hero.specialSeconds ?? -1) >= 0
        ? Math.min(SWING_SECONDS, (hero.specialSeconds / SPECIAL_ATTACK_SECONDS) * SWING_SECONDS)
        : -1;
      const actionSecondsForClip = specialSwingSeconds >= 0 ? specialSwingSeconds : swingSecondsForClip;
      swingSecondsShown = actionSecondsForClip;
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
      // THE RAW DELTA for reactions, not the clamped one -- the same distinction the rescue watch
      // draws further down, and for a related reason. `deltaSeconds` is capped at 0.1 so a hitch
      // cannot teleport the hero; an animation mixer has no such hazard, because advancing a clip
      // further is exactly what more elapsed time should do. Under that cap a device rendering
      // slower than 10fps plays every reaction clip in SLOW MOTION by the ratio, and the death clip
      // is retimed to only just fit its window at full speed.
      //
      // MEASURED, on the GPU-less container this suite runs on, at 3.1fps: the death clip reached
      // 55% of its length in the two seconds the hero is down, so his hips never got below 65% of
      // standing height. What a child saw was a hero drop to one knee and pop straight back up --
      // character/reactClips.js's header describes that exact defect and the rewrite that killed it,
      // and the clamp had quietly brought it back on precisely the cheap tablet this game is for.
      // The arithmetic: the fall needs clipSeconds of mixer time inside RESPAWN_SECONDS of wall
      // clock, so it survives the cap only above 0.1 / DEATH_FALL_FRACTION -- about 5.5fps.
      // Caught by the body-height check in tools/runtime-test/play-fight.mjs, which measures the
      // rendered skeleton rather than asking whether a flag was set.
      const reactionDeltaSeconds = frameDeltaMs === null ? 0 : frameDeltaMs / 1000;
      if (heroIsDown) {
        swing?.update(actionSecondsForClip, SWING_SECONDS, deltaSeconds);
        reactions?.update(reactionDeltaSeconds, hero);
      } else {
        reactions?.update(reactionDeltaSeconds, hero);
        // AFTER locomotion.update(), which is what writes the walk pose. The swing is an offset on
        // top of that pose, so running it first would be overwritten the same frame.
        swing?.update(actionSecondsForClip, SWING_SECONDS, deltaSeconds);
      }
      enemyPresenters.update(deltaSeconds, encounterState.enemies);
      enemyNameplates.update(encounterState.enemies, {
        heroLevel: heroStatsThisFrame.level,
        project: projectEnemyNameplate,
      });
      const companionState = companionPresenter?.update(deltaSeconds, {
        x: player.position.x,
        z: player.position.z,
        heading: player.heading,
      });
      if (companionReactionElement) {
        const reactionVisible = companionState?.reactionActive === true;
        if (reactionVisible) {
          const cuePoint = new THREE.Vector3(companionState.x, 1.15, companionState.z).project(camera);
          const surfaceRect = gameSurface.getBoundingClientRect();
          const cueX = (cuePoint.x * 0.5 + 0.5) * surfaceRect.width;
          const cueY = (-cuePoint.y * 0.5 + 0.5) * surfaceRect.height;
          companionReactionElement.style.left = `${cueX}px`;
          companionReactionElement.style.top = `${cueY}px`;
          companionReactionElement.style.opacity = '1';
          companionReactionElement.style.transform = `translate(-50%, -100%) scale(${0.75 + (1 - companionState.reactionProgress) * 0.35})`;
        } else {
          companionReactionElement.style.opacity = '0';
          companionReactionElement.style.transform = 'translate(-50%, -100%) scale(0.75)';
        }
      }
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
      //
      // R1: the streak meter's own idle clock, advanced every frame regardless of whether anything
      // died THIS frame -- progression/streaks.js's own header is explicit that stepStreak has to run
      // every tick so the meter can read a live "about to expire" state rather than only learning
      // about expiry in arrears, on the next kill.
      streakState = stepStreak(streakState, deltaSeconds);
      for (const event of events) {
        // Journalled HERE rather than inside the two reward handlers that used to do it, so the
        // device keeps a copy of every durable fact it is told about rather than of the two types
        // somebody remembered to wire. journalDurableFact ignores anything with no stable id, and
        // recordFacts refuses anything that is not a profile fact, so widening the call cannot
        // journal something it should not -- and a new durable event type stops needing a second
        // edit here to be remembered.
        const firstTimeSeen = journalDurableFact(event);
        if (REWARD_EVENT_TYPES.includes(event.type)) {
          // SILENT AS WELL AS STILL. A replayed reward that suppressed its light but still played
          // its sparkle would be a beat with no cause -- and on a reconnect carrying three marks it
          // is three of them, in a row, for nothing the child just did.
          const rewardRecipeName = firstTimeSeen ? soundForRewardEvent(event.type) : null;
          if (rewardRecipeName) audio.play(rewardRecipeName);
          onRewardEvent(event, { firstTimeSeen });
          continue;
        }
        const recipeName = soundForEvent(event.type);
        if (recipeName) audio.play(recipeName);
        onEncounterEvent(event);
        // R1: the streak meter, the kill's own XP toast, and the rune chest's own counter. All
        // three are gated on THIS hero's own killing blow (myKillEnemyIds, captured before
        // stripHeroId erased who the event belonged to), so a child never reads a reward -- or a
        // multiplier -- for a fight they did not land the finishing hit on.
        //
        // THE METER USED TO BE PARTY-WIDE, and that was a lie the server would not honour. It draws
        // `x${multiplier}` straight out of coinMultiplierForStreak, which is the very function
        // net/gameServerCore.mjs passes into the drop roll as `streakMultiplier` to size the coins a
        // kill pays -- and the server credits a streak only to `event.heroId`, the hero who actually
        // finished the enemy. `wolf-defeated` is a world event (it is not one of the server's own
        // WOLF_BODY_EVENTS), so both brothers receive both brothers' kills: four kills by one child
        // and one by the other made the second child's HUD read "x2 / ON A ROLL", pulse the tier
        // crossing, and then pay him x1. A meter showing a kill count and a draining ring would have
        // been cosmetic; one showing a payout number is a promise. test/streak-view.test.mjs pins
        // both the arithmetic and this seam.
        //
        // Offline this changes nothing by construction: the offline branch further up adds EVERY
        // wolf-defeated to myKillEnemyIds before any bail-out, because solo every defeat IS this
        // hero's own kill -- so the local streak stays the sole authority exactly as it was.
        //
        // The shared celebration is untouched: the defeat sound and the presenter's own death flash
        // run for everyone present, above this gate, because seeing your brother drop a wolf should
        // still feel like something happened.
        if (event.type === 'wolf-defeated' && myKillEnemyIds.has(event.enemyId)) {
          streakState = registerStreakKill(streakState);
          const view = streakMeterView(streakState);
          if (view) pulseStreakMeter(view);
          const enemy = enemyById(event.enemyId);
          const amount = killXpForKind(event.kind);
          if (enemy && amount !== null) popXpToast(enemy.x, WOLF_SPARK_HEIGHT_METERS, enemy.z, amount);
          // THE HIDDEN LEARNING LAYER's own counter -- the same gate, for the same reason: a rune
          // chest is a per-child beat and crediting a sibling's own kill toward THIS hero's next
          // chest would be exactly the wrong kind of shared state (progression/runeChests.js's own
          // header).
          const chestResult = registerRuneChestKill(runeChestState);
          runeChestState = chestResult.state;
          if (chestResult.chestDue) runeChestSpawnDue = true;
        }
      }
      renderStreakMeter(streakMeterView(streakState));

      // THE HIDDEN LEARNING LAYER: placing a due chest, presenting the standing one, and opening its
      // card on proximity -- all CLIENT-LOCAL and IDENTICAL online and offline (progression/
      // runeChests.js's own header), unlike everything else in this branch's own online/offline split,
      // so none of it is gated on netStatus.
      if (runeChestSpawnDue && runeChestState.chest === null) {
        const spot = pickChestSpawnPoint({
          playerX: player.position.x,
          playerZ: player.position.z,
          rng: Math.random,
          isAllowed: runeChestSpotAllowed,
        });
        // A null spot (every candidate this frame's rng tried landed inside the arena/sanctuary) is
        // not an error -- runeChestSpawnDue simply stays true and the next frame's fresh draws, off
        // wherever the hero has since walked to, try again. See its own declaration comment.
        if (spot) {
          runeChestState = openRuneChest(runeChestState, {
            id: mintChestId(), x: spot.x, z: spot.z, rng: Math.random,
          });
          runeChestSpawnDue = false;
        }
      }
      runeChestPresenter.update(deltaSeconds, runeChestState.chest);
      if (runeChestState.chest && !anyOverlayOpen) {
        const chestDistance = Math.hypot(
          player.position.x - runeChestState.chest.x, player.position.z - runeChestState.chest.z,
        );
        if (chestDistance <= CHEST_COLLECT_RADIUS_METERS) {
          // NEVER MID-FIGHT: the card is a modal that freezes movement and attack input (this
          // frame's own anyOverlayOpen gate), so it waits until no hostile enemy is on the hero --
          // heroInCombat's own comment carries the full trap this closes, including why the BITE
          // range has to be handed over too: an enemy standing on the hero between bites reports
          // mode 'idle', and without a reach clause the card opened straight over a live mauling.
          // Both radii are the rules' own, imported, never restated (GQ-007).
          const inCombat = heroInCombat({
            heroX: player.position.x,
            heroZ: player.position.z,
            enemies: encounterState.enemies,
            noticeRadiusMeters: WOLF_AGGRO_RANGE,
            biteRangeMeters: WOLF_BITE_RANGE,
          });
          if (!runeChestCardSuppressed && !inCombat) runeChestCard.show(runeChestState.chest.question);
        } else {
          // Left the radius: the dismiss guard (if any) is spent -- walking back in re-opens it, the
          // brief's own "dismissing leaves the chest for later" made literal.
          runeChestCardSuppressed = false;
        }
      }

      const fight = !wolf
        ? `you ${Math.max(0, hero.hp)}hp`
        : wolf.mode === 'dead'
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
      // The CLAIM radius, not the Keeper's 2 m wave radius. Wren takes the satchel and gives the
      // charm anywhere inside RANGER_CLAIM.radiusMeters (3 m, adjudicated server-side against the
      // same zone-data number) -- so a child granted the charm at 2.4 m used to be handed a fourth
      // heart by a woman who then said nothing, because her words needed 2 m. drive-ranger.mjs
      // measured exactly that gap ("hero 2.43m from Wren, radius 2m"). One radius for the grant and
      // the words means the thank-you can never be earned from outside its own earshot.
      radiusMeters: VILLAGE.RANGER_CLAIM.radiusMeters,
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
    if (keeperSpeech.visible && !questGiven) {
      questGiven = true;
      rememberTeaching({ questGiven: true });
    }
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

    if (runtime.hero) {
      // R1: kill drops -- coins, hearts and gear scattered where an ordinary enemy fell. Online, the
      // server owns physical truth entirely (serverEncounter.drops) and this client only ages nothing
      // itself; offline, the same pure rules (world/enemyDrops.js's stepEnemyDrops) age and expire
      // this client's own local roll every frame -- the identical "server owns it online, the same
      // pure rules run locally offline" split the siege block just below already uses.
      if (netStatus !== 'online') dropsState = stepEnemyDrops(dropsState, deltaSeconds);
      const drops = netStatus === 'online' && serverEncounter?.drops ? serverEncounter.drops : dropsState.drops;
      // Presenter arrivals only -- still-resting/still-appearing/someone-else's-despawn stay silent,
      // the identical contract world/lootPickups.js's own update() keeps for the cart's pickups.
      //
      // WHICH HERO IS "ME" DEPENDS ON WHICH LOOP IS RUNNING. Online it is the socket's own id;
      // offline there is no socket -- net/client.js holds selfId null before it ever connects and
      // clears it again on disconnect -- while the offline collect below stamps the drop with
      // OFFLINE_HERO_ID. Passing net.selfId unconditionally made a solo child's own drop compare
      // unequal to its collector, so the presenter took the "somebody else collected it" branch:
      // the mesh blinked out with no flight and returned no arrival. Every offline reward below is
      // driven by those arrivals, so the coin never counted, requestSoloHeroHeal never ran, and the
      // gear fact was never journalled -- a child at 8 HP walked onto the heart a Frost Wolf dropped
      // and stayed at 8 HP. Same id on both sides of the comparison, derived from the same constant.
      const collectingHeroId = netStatus === 'online' ? net.selfId : OFFLINE_HERO_ID;
      const dropArrivals = dropsPresenter.update(deltaSeconds, drops, collectingHeroId, player.position);
      let dropsHudDirty = false;
      for (const arrival of dropArrivals) {
        if (arrival.kind === COIN_DROP_KIND) {
          // No offline fallback for durable Village Supplies (see EMPTY_VILLAGE's own comment) -- a
          // kill-drop coin routes through the SAME communal award a cart coin does online
          // (net/gameServerCore.mjs's own applyLootAward), so offline this is a session-local bump
          // only, the same honest "visible difference from the persisted loop" this fallback already
          // carries elsewhere (rewards/offlineProgress.js's own header).
          coinsDisplayed += 1;
          dropsHudDirty = true;
          audio.play(COIN_PICKUP_RECIPE_NAME);
          popLootHud(COIN_KIND);
        } else if (arrival.kind === HEART_DROP_KIND) {
          // Online, the server's own applyHeroHeal already raised a real 'hero-healed' event that
          // reaches THIS hero's dispatch loop the ordinary way (it carries heroId, filtered to
          // ownHeroId) and already pops/renders the health row -- nothing left to do here but the
          // pickup's own sound. Offline, there is no server to have raised it, so this client raises
          // the identical heal itself through requestSoloHeroHeal (the seam encounter.js exports for
          // exactly this), whose own 'hero-healed' event flows through the SAME dispatch loop this
          // frame -- so the pop and the health-row update happen through the one real code path
          // either way, never a second copy of "what a heal does" here.
          if (netStatus !== 'online') {
            // This frame's ONE dispatch loop (the identical single point every other event in this
            // file funnels through) has already run by the time this drop's own attraction flight
            // lands, so its 'hero-healed' event is dispatched directly here rather than pushed into
            // an `events` array nobody will drain again this frame -- onEncounterEvent already does
            // exactly the pop+render a heal needs; no second copy of that logic belongs here.
            const healed = requestSoloHeroHeal(encounterState, HEART_HEAL_HP);
            encounterState = healed.state;
            for (const healEvent of healed.events) onEncounterEvent(healEvent);
          }
          audio.play(HEART_PICKUP_RECIPE_NAME);
        } else if (arrival.kind === GEAR_DROP_KIND) {
          // Online, the server's own grantOwnership already wrote the durable 'gear-owned' fact and
          // announced it on the wire, which the G4/G1-C3-style ownership diff further up (the
          // Blade/Helmet/Shoulders ceremonies) picks up on its own -- nothing extra here either.
          // Offline, this client mints the identical fact shape itself: the same durable type
          // net/gameServerCore.mjs's rewards.grantOwnership writes, journalled locally so the
          // Shoulders ceremony's own ownedItemIdsFromRewards(profileState) diff fires for real.
          if (netStatus !== 'online' && typeof arrival.itemId === 'string') {
            profiles.recordFacts(profileId, [{
              eventId: `gear-owned:offline:${arrival.itemId}:${mintDropLifeId()}`,
              type: 'gear-owned',
              value: arrival.itemId,
            }]);
            refreshProfileState();
          }
          audio.play(GEAR_PICKUP_RECIPE_NAME);
        }
      }
      if (dropsHudDirty) renderLootHud();

      // Ask the server to collect whatever is in reach and not yet gone -- throttled per drop, the
      // identical shape the cart's own lootRequestedAt/LOOT_REQUEST_RETRY_MS give pickups above.
      // Offline there is no server to ask: this client adjudicates its own reach directly against
      // requestCollectEnemyDrop, the same pure function net/gameServerCore.mjs runs online, so the
      // "first request wins, already-collected/out-of-reach is a clean no" rule is identical either
      // way -- only WHO runs it differs.
      for (const drop of drops) {
        if (drop.collectedBy != null) continue;
        const lastRequestedAt = dropRequestedAt.get(drop.id);
        if (lastRequestedAt != null && frameStart - lastRequestedAt < DROP_REQUEST_RETRY_MS) continue;
        const distance = Math.hypot(player.position.x - drop.x, player.position.z - drop.z);
        if (distance > DROP_COLLECT_RADIUS_METERS) continue;
        dropRequestedAt.set(drop.id, frameStart);
        if (netStatus === 'online') {
          net.sendCollectDrop(drop.id);
        } else {
          const collected = requestCollectEnemyDrop(
            dropsState, OFFLINE_HERO_ID, drop.id, { x: player.position.x, z: player.position.z },
          );
          if (collected.accepted) dropsState = collected.state;
        }
      }
    }

    // ── #87: PERSONAL CORPSE LOOT ───────────────────────────────────────────────────────────
    //
    // Server-authoritative only, deliberately: world/corpseLoot.js is a server-side module with no
    // offline mirror (see net client's own sendCollectCorpseItem/All comment for why -- there is no
    // shared world to keep a personal claim in while offline). Everything below reads
    // serverEncounter.corpses and nothing else; this is a presenter, never an awarder -- the actual
    // grant happens on the server the moment it accepts collect-corpse-item/-all
    // (net/gameServerCore.mjs's own applyClaimCorpseItem/applyClaimAllCorpseLoot), and this loop only
    // ever finds out about it on the NEXT snapshot, the same one-way "server owns physical truth,
    // client presents it" split every other reward here already keeps.
    if (runtime.hero && netStatus === 'online' && net.selfId != null) {
      const corpses = serverEncounter?.corpses ?? [];
      const heroId = net.selfId;

      corpseGlowPresenter.update(deltaSeconds, corpsesToGlowFor(heroId, corpses));

      // The single nearest corpse this hero can actually still loot -- offered by the prompt, opened
      // by a tap. Hidden while the panel is already open: a second "LOOT" prompt behind an open panel
      // would be a control a thumb cannot see to avoid.
      const nearest = corpseLootPanel.isOpen()
        ? null : nearestLootableCorpse(heroId, corpses, player.position);
      promptCorpseId = nearest?.id ?? null;
      corpseLootInteract.show(nearest != null);

      // Keep an open panel live against the actual snapshot -- a sibling's simultaneous claim, this
      // hero's own click landing, or the corpse itself finally retiring (every eligible hero resolved)
      // all show up here without the panel needing its own copy of the rule. A corpse that vanished
      // out from under an open panel (fully resolved, or CORPSE_LOOT_EXPIRE_SECONDS ran out while a
      // child was mid-read) closes the panel rather than showing a frozen, wrong list.
      // COMBAT PRE-EMPTS THE MODAL. The panel may stay up while it is safe; the moment the fight
      // actually reaches this hero it has to give the game back. Without this the child is frozen
      // inside a full-screen overlay -- no walking, no swinging -- while the wolf that respawned on
      // this very corpse bites them to death, and is then left holding live TAKE buttons for a body
      // they are now metres away from, every tap silently refused on reach. Measured hosted at
      // 946857f; world/corpseLootPresenter.js's own dismissLootPanelForCombat carries the full
      // argument and the numbers, and states why progression/runeChests.js's heroInCombat is the
      // right PRINCIPLE here but the wrong helper.
      //
      // Dismiss only. The claim is server-side truth and is not touched: nothing is awarded, nothing
      // is equipped, no item is resolved, and every remaining personal item stays exactly as untaken
      // as it was -- so the hero walks back, taps Loot again, and finishes. The panel has no onClose
      // handler at all (see its construction above), which is what makes that free.
      const selfBody = serverEncounter?.heroes?.[heroId] ?? null;
      if (corpseLootPanel.isOpen()) {
        const openCorpseId = corpseLootPanel.currentCorpseId();
        const openCorpse = corpses.find((corpse) => corpse.id === openCorpseId);
        if (dismissLootPanelForCombat(previousSelfBody, selfBody)) corpseLootPanel.close();
        else if (openCorpse) corpseLootPanel.render(openCorpse.id, corpseLootPanelViewModel(openCorpse, heroId));
        else corpseLootPanel.close();
      }
      previousSelfBody = selfBody;

      // The short acquired-item confirmation, plus "visible movement toward the inventory/Hero
      // destination" (#87's own required outcome list) -- fires off a SNAPSHOT DIFF, so it fires
      // identically whether this hero tapped TAKE, tapped Take All, or a resend from a flaky
      // connection landed a beat late; never for an item this hero's client already knew was taken.
      const arrivals = newlyTakenItems(previousCorpses, corpses, heroId);
      if (arrivals.length > 0) {
        const heroButtonRect = document.querySelector('#hero-button')?.getBoundingClientRect();
        const destination = heroButtonRect
          ? { x: heroButtonRect.left + heroButtonRect.width / 2, y: heroButtonRect.top + heroButtonRect.height / 2 }
          : null;
        for (const arrival of arrivals) {
          // #87: a claim now pays COINS as well as gear, and a coin arrival has to reach the HUD the
          // same way a ground coin's own arrival flight does -- by advancing coinsDisplayed and
          // popping the counter. The background Village sync further down cannot do it: it only ever
          // runs for the cart's own pickups, so before this the child collected coins, watched the
          // server credit them, and saw their coin counter sit unchanged. "It went into my inventory"
          // is half of what #87 asks a child to understand, and a number that does not move does not
          // say it.
          if (arrival.kind === CORPSE_COIN_KIND) {
            corpseLootToastLayer.announce(`+ ${arrival.amount} coins`, destination);
            coinsDisplayed += arrival.amount;
            renderLootHud();
            popLootHud(COIN_KIND);
            audio.play(COIN_PICKUP_RECIPE_NAME);
            continue;
          }
          const name = itemDef(arrival.itemId)?.name ?? 'Gear';
          corpseLootToastLayer.announce(`+ ${name}`, destination);
          audio.play(GEAR_PICKUP_RECIPE_NAME);
        }
        const heroButtonElement = document.querySelector('#hero-button');
        if (heroButtonElement) {
          heroButtonElement.dataset.lootPulse = 'true';
          window.clearTimeout(heroButtonLootPulseTimer);
          heroButtonLootPulseTimer = window.setTimeout(() => {
            heroButtonElement.dataset.lootPulse = 'false';
          }, 260);
        }
      }
      previousCorpses = corpses;
    } else {
      corpseGlowPresenter.update(deltaSeconds, []);
      previousSelfBody = null;
      if (promptCorpseId !== null) {
        promptCorpseId = null;
        corpseLootInteract.show(false);
      }
      // Correction: this hero is not online (offline, still connecting, or mid in-page-reconnect
      // between a dropped socket and a fresh 'welcome') -- null out the diff baseline here too, not
      // only at bootstrap. A reconnect mints a NEW heroId (net/gameServerCore.mjs's own addPlayer)
      // and net/gameServerCore.mjs's own reassignCorpseClaims moves any live claim onto it, so a
      // baseline snapshot captured under the OLD heroId can never find that claim again --
      // newlyTakenItems would then see the reassigned claim's already-taken items as a brand new
      // arrival and replay a false "+ Item" toast for gear this hero collected before the blip. Going
      // through this same "no baseline yet" state every time re-arms the exact bootstrap guard the
      // comment above documents, rather than only ever priming it once per page load.
      previousCorpses = null;
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
        // copy holds -- there is one hero with one body and the encounter block already
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
            // The same resolved numbers the wolf fight above is handed, and for the same reason: a
            // child who levels up and walks into the Beacon arena must be the hero they just became.
            heroDamage: heroStatsThisFrame.heroDamage,
            maxHp: heroStatsThisFrame.maxHp,
            damageReductionPercent: heroStatsThisFrame.damageReductionPercent,
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
      else if (event.type === 'warden-hurt-hero') { flashHeroHurt(); renderHealth(event.remaining); }
      else if (event.type === 'hero-down') { showHeroDown(true); banner('You went down…', 1600); }
      else if (event.type === 'hero-respawned') { showHeroDown(false); renderHealth(healthMax); }
      else if (event.type === 'hero-healed') { renderHealth(event.remaining); popHealth(); }
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
    const bossState = bossBarState({
      mode: warden.mode, hp: warden.hp, maxHp: WARDEN_MAX_HP, phase: warden.phase,
    });
    // The projection is genuinely wasted work while the bar would be hidden anyway (dormant, dead,
    // or no warden published yet) -- three.js Vector3.project() and a DOM rect read are not free,
    // and bossBarState already knows the answer without a camera.
    bossBar.update(bossState, bossState.visible ? projectBossBar(warden) : null);

    // ── G3 PAYOFF: THE BEACON LIGHTS ────────────────────────────────────────────────────────
    //
    // The world remembers. Gated on having SEEN it cold, the same rule the Lantern Tree's own
    // relight and the Workshop's build already follow -- a child who joins a world where the
    // Beacon is already burning gets a lit Beacon, not somebody else's ceremony.
    //
    // `beaconLitSeen` is set ONLY inside the `zoneOldBeacon` guard, and that placement is
    // load-bearing rather than tidy -- the exact bug the Lantern Tree's own relight already
    // measured and fixed (see rewardsForRelight/relightSpent's own comment above), now playing out
    // a second time at the Beacon. A snapshot saying beaconLit:true routinely lands before
    // zone.ready has resolved (a second device on a slower connection, a cold asset cache, or
    // simply the two arriving in the wrong order) -- if this had one-shot-spent itself the moment
    // it OBSERVED beaconLit:true, regardless of whether zoneOldBeacon existed yet to act on it, a
    // guest unlucky enough to see that frame before their own Beacon geometry loaded would have the
    // ignition permanently skipped: `beaconLitSeen` stays true forever, so the one call that would
    // ever have lit their Beacon never fires again for the rest of the session. Gating the LATCH
    // itself on `zoneOldBeacon` being present means a slow load simply keeps retrying next frame
    // until the geometry exists to light -- the world was never wrong, only unable to draw it yet.
    if (!siegeState.beaconLit) sawBeaconCold = true;
    if (siegeState.beaconLit && !beaconLitSeen && zoneOldBeacon) {
      beaconLitSeen = true;
      zoneOldBeacon.ignite();
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
    // ALWAYS ON, EXCEPT WHEN IT WOULD BE NOISE. The playtest brief this pass answers to says the
    // guidance should "basically always be there" -- so the arrow/marker and the ground trail are
    // suspended for exactly two reasons and no others: a full-screen overlay owns the screen (the
    // same condition index.html's own CSS already hides #objective-pointer and #minimap for, applied
    // here too because the ground trail is world-space three.js and no stylesheet can hide it), or an
    // NPC speech beat already has the child standing at the right spot -- a bouncing marker over
    // Keeper Aldric's own head while his speech bubble is open would be pointing at something the
    // child is already looking at and is already being told about.
    const suspendGuidance = anyOverlayOpen || npcSpeech.visible;
    const pointer = renderObjectivePointer(currentObjective, pointerContext, suspendGuidance);
    // ONE resolve of "where is the objective", read three ways -- the arrow/marker above, the ground
    // trail below, and the rescue watch's distance further down. `pointer.place` is exactly what
    // renderObjectivePointer itself got from destinationFor; reusing it here keeps this to one
    // branch rather than two hand-kept copies of "where is it" (GQ-011), and it is resolved whether
    // or not the visuals are suspended, so an overlay closing mid-objective has a place to draw at
    // on the very next frame instead of one frame of nothing while it catches up.
    rescueTarget = pointer.place;
    // THE GROUND TRAIL. Hidden by the same `suspendGuidance` flag as the arrow/marker -- see the
    // comment above -- and additionally by guidePath.js's own arrival radius the moment `rescueTarget`
    // is close enough that render/guideArrow.js has already gone quiet about it too (the two files
    // share that number by import, not by two people remembering the same tuning).
    guidePath.update(deltaSeconds, {
      hasTarget: !suspendGuidance && rescueTarget != null,
      heroX: player.position.x,
      heroZ: player.position.z,
      targetX: rescueTarget?.x,
      targetZ: rescueTarget?.z,
    });
    renderMinimap(frameStart, rescueTarget);
    renderRescueOffer(rescueWatch.update({
      distanceMeters: rescueTarget
        ? Math.hypot(player.position.x - rescueTarget.x, player.position.z - rescueTarget.z)
        : NaN,
      objectiveId: currentObjective?.id ?? null,
      // WHICH PLACE, as well as which errand. The objective id is stable across "wake the dark
      // lights" and "N cold seals left" while the place it points at moves from one light to the
      // next, so the id alone cannot tell the watch that the thing it is measuring changed. Without
      // this, a child who walked right up to one light and lit it inherits that one-metre best for
      // the next light thirty metres away, and every correct step toward it reads as being stuck.
      targetKey: targetKeyFor(rescueTarget),
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
  // The coverage surface for the helmet's hair/ear occlusion (G1-C3). Held separately from
  // runtime.hero, which is the Object3D root and has no such method -- this is the hero API object.
  localHeroAnatomy = hero;
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
  remotes = createRemotePlayers(scene, hero, { mountGear: mountGearOnRemote });
  status.dataset.fault = hero.failed ? 'true' : 'false';
  status.textContent = hero.failed ? 'hero load failed — placeholder shown' : 'hero standing';

  // The temporary companion is loaded after the hero and never awaited alongside it. A missing or
  // broken stand-in must leave a walkable world rather than an empty screen.
  try {
    const companion = await loadPrototypeCompanion();
    if (!companion.failed) {
      scene.add(companion.root);
      companionPresenter = createPrototypeCompanionPresenter(companion.root, companion.animations);
      companionPresenter.update(0, {
        x: player.position.x,
        z: player.position.z,
        heading: player.heading,
      });
    } else {
      console.warn('[runtime] prototype companion load failed — continuing without the temporary stand-in');
    }
  } catch (error) {
    console.warn('[runtime] prototype companion load threw — continuing without the temporary stand-in', error);
  }

  // The cue is deliberately one local primitive rather than a new asset or UI system. The presenter
  // supplies the bounce; this DOM heart glyph simply keeps the tap readable at normal gameplay framing.
  companionReactionElement = document.createElement('div');
  companionReactionElement.textContent = '♥';
  companionReactionElement.setAttribute('aria-hidden', 'true');
  Object.assign(companionReactionElement.style, {
    position: 'absolute',
    zIndex: '3',
    pointerEvents: 'none',
    opacity: '0',
    transform: 'translate(-50%, -100%) scale(0.75)',
    color: '#ff7897',
    font: '900 2rem/1 system-ui, sans-serif',
    textShadow: '0 2px 0 rgb(12 20 31 / 88%), 0 0 12px rgb(255 120 151 / 80%)',
    transition: 'opacity 90ms ease-out, transform 120ms ease-out',
  });
  gameSurface.appendChild(companionReactionElement);

  // The Wolf source is loaded once after the hero and companion, then the keyed registry clones a
  // fresh visual per stable enemyId. The default world still contains exactly one wolf-1, so this
  // is visually the same one Wolf; the collection seam simply no longer assumes there can only be
  // one presenter. A missing/broken asset still leaves a walkable world.
  try {
    wolfVisualFactory = await loadWolfFactory();
    if (wolfVisualFactory.failed) {
      console.warn('[runtime] wolf load failed — world is playable without it');
    } else {
      enemyPresenters.update(0, encounterState.enemies);
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
