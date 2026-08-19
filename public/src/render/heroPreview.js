// The Hero screen's character showcase.
//
// WHAT WAS WRONG. GP1 built the Hero screen's "actual 3D equipped hero preview" by dollying the
// ordinary follow camera in to 2.4 m and letting the live world keep rendering underneath a
// transparent overlay. That is not a showcase, it is a close-up of wherever the child happened to be
// standing, and the failure is not subtle. Captured from the running game at four hostile positions
// (.local/runtime-test/before-*.png, the same instrument that took the after pair):
//
//   at the Workshop's own longhouse    the hero is ENTIRELY invisible -- the camera is inside the wall
//   at the Lantern Tree                the hero is ENTIRELY invisible -- the camera is inside the trunk
//   beside the market villager         an NPC's torso fills the whole frame, hero nowhere in it
//   in the open field                  the hero is visible, but from BEHIND, because the camera
//                                      heading and the hero's own facing are independent
//
// Only the temporary proof marker survived those frames, and only because it had already been given
// depthTest: false for exactly this reason -- see progression/heroScreen.js's history. Darkening a
// vignette, shortening the dolly or hiding one Workshop mesh all fix one screenshot; none of them is
// location-independent, which is the only property that actually matters here.
//
// WHAT THIS IS. A second render PASS in the SAME WebGLRenderer and the same scene (a second WebGL
// context is not available to us -- iOS Safari caps simultaneous contexts and this game ships to real
// iPads). While the Hero screen is open the frame is drawn three times:
//
//   1. the ordinary world pass, with the local hero temporarily moved off CHARACTER so it is not
//      drawn twice;
//   2. renderer.clearDepth(), then a backdrop card -- the world stays faintly visible behind it, so
//      the child is still standing somewhere, but it can never compete with the subject;
//   3. the hero pass, drawn by a dedicated preview camera against a depth buffer that now contains
//      NOTHING. No building, tree, NPC, wolf, cart or ground plane can occlude it, at any position on
//      the map, because none of them are in the depth buffer any more.
//
// This is the viewmodel trick every first-person shooter uses to keep the player's own hands from
// clipping into walls, pointed at a character screen instead. It is the reason the fix is
// location-independent by construction rather than by tuning.
//
// The hero itself is the REAL, LIVE local hero -- not a clone, not a mannequin. Its animation mixer,
// its equipped gear, its materials and its idle pose are whatever gameplay currently has, so the
// showcase can never drift from what a child sees when they close the screen. Nothing here touches
// the rig, the skeleton, the gear anchors or any GLB: the only thing done to the hero is a temporary,
// exactly-restored change to which render layer its objects sit on.

import { HERO_PREVIEW, HERO_PREVIEW_BACKDROP } from './layers.js';

// The hero is 1.500 units tall (camera/follow.js's own measurement, taken off the running game).
export const HERO_HEIGHT_METERS = 1.5;

// A longer lens than gameplay's 42 degrees. Gameplay wants a wide field so a child can see what is
// coming; a character screen wants the opposite -- a portrait lens flattens perspective, so the head
// does not balloon and the feet do not shrink at the 4-5 m this framing sits at.
export const PREVIEW_FOV_DEGREES = 30;

// Barely off level. A steep look-down foreshortens the body and hides the weapon behind the shoulder;
// looking UP reads heroic but puts the camera under the chin at this distance. Raised from 0.10 to
// 0.16 rad (5.7 -> 9.2 deg) after the first captures: the ground pool below is a flat ellipse lying on
// the ground plane, and at 5.7 degrees a flat ellipse is nearly edge-on -- 0.5 m of radius projected
// to under 40 px, which is not a floor, it is a line. At 9.2 degrees the same pool reads as a pool
// and the body is still not foreshortened.
export const PREVIEW_PITCH_RADIANS = 0.16;

// Where the camera stands relative to THE HERO'S OWN FACING -- which is what makes the framing
// predictable. The old dolly inherited `follow.heading`, a number the child sets by dragging and the
// game sets when it aims an establishing shot, so what you saw when you opened Hero was the angle
// between two unrelated values: at spawn, the hero's back.
//
// NEGATIVE is toward the hero's RIGHT. Rotating the hero's forward vector (sin h, cos h) by +yaw
// moves toward its local +X, and for a +Z-forward/+Y-up character in a right-handed frame local +X
// is the character's LEFT. The sword is in the RIGHT hand (character/gear.js's RightHand mount), so
// the camera goes to the sword side: the blade is then the nearest thing to the lens instead of
// something the torso hides.
export const PREVIEW_ORBIT_YAW_RADIANS = -0.52;

// How tall the hero stands as a fraction of the viewport, per orientation. Not a guess at "big
// enough": both are derived from the space index.html's own two media queries actually leave.
//
//   PORTRAIT (768x1024). Header y 12..52, slots row y 72..142, owned strip top ~844, item card top
//   ~930. The clear band is y 142..844, 702 px tall. 0.52 of the viewport is 532 px -- 76% of the
//   band, leaving a real margin at both ends rather than tucking the hair under the slots.
//   LANDSCAPE (1024x768). Slots take a column at x 12..82, the strip and card a column at x 868..1012,
//   the header the top 52 px. The clear band is x 95..915 and nearly the full height, so the subject
//   can be bigger: 0.60 of 768 is 461 px against a ~660 px usable height.
export const PORTRAIT_HERO_SCREEN_FRACTION = 0.52;
export const LANDSCAPE_HERO_SCREEN_FRACTION = 0.60;

// Where the hero's mid-height sits vertically, as a signed fraction of viewport height away from
// dead centre (positive = higher). Portrait's bottom dock (strip + card, ~180 px) is deeper than its
// top dock (~142 px), so the clear band's own centre is ~19 px above the screen's; landscape's only
// intrusion is the header, so its band centre is a few px below. Both are small on purpose -- this
// nudges the composition into the hole the UI leaves, it does not reframe it.
export const PORTRAIT_VERTICAL_BIAS = 0.02;
export const LANDSCAPE_VERTICAL_BIAS = -0.01;

const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * Pure. Viewport in, camera framing out -- no three.js, no DOM, unit tested directly.
 *
 * `distanceMeters` is solved from the wanted on-screen height rather than picked: an object of height
 * h centred in a perspective frustum covers h / (2 d tan(fov/2)) of the frame, so the distance that
 * makes the hero exactly `heroScreenFraction` tall is h / (2 f tan(fov/2)).
 *
 * `lookHeightMeters` is the point on the hero the camera aims at. Raising it pushes the subject DOWN
 * the frame, so the vertical bias is SUBTRACTED, scaled by the frustum's own world height at the
 * hero's distance (which is just h / f -- the distance cancels).
 */
export function heroPreviewFraming(viewportWidth, viewportHeight, options = {}) {
  const fovDegrees = options.fovDegrees ?? PREVIEW_FOV_DEGREES;
  const heroHeight = options.heroHeightMeters ?? HERO_HEIGHT_METERS;
  const portrait = !(viewportWidth > viewportHeight);
  const heroScreenFraction = portrait ? PORTRAIT_HERO_SCREEN_FRACTION : LANDSCAPE_HERO_SCREEN_FRACTION;
  const verticalBias = portrait ? PORTRAIT_VERTICAL_BIAS : LANDSCAPE_VERTICAL_BIAS;

  const halfFovTangent = Math.tan((fovDegrees * DEGREES_TO_RADIANS) / 2);
  const distanceMeters = heroHeight / (2 * heroScreenFraction * halfFovTangent);
  const frustumHeightAtHero = heroHeight / heroScreenFraction;

  return {
    portrait,
    fovDegrees,
    heroScreenFraction,
    distanceMeters,
    pitchRadians: PREVIEW_PITCH_RADIANS,
    lookHeightMeters: heroHeight / 2 - verticalBias * frustumHeightAtHero,
    frustumHeightAtHero,
  };
}

/**
 * Pure. Where the preview camera stands, given the hero's own world position and facing.
 *
 * Returns world coordinates for the camera and for the point it looks at. Split out from the three.js
 * half so the "camera is always in front of the hero, on the sword side" contract is checkable
 * without a GPU.
 */
export function heroPreviewCameraPlacement({
  heroX, heroY, heroZ, heroHeading, distanceMeters, lookHeightMeters, pitchRadians, orbitYawRadians = 0,
}) {
  const yaw = heroHeading + PREVIEW_ORBIT_YAW_RADIANS + orbitYawRadians;
  const horizontal = Math.cos(pitchRadians) * distanceMeters;
  return {
    position: {
      x: heroX + Math.sin(yaw) * horizontal,
      y: heroY + lookHeightMeters + Math.sin(pitchRadians) * distanceMeters,
      z: heroZ + Math.cos(yaw) * horizontal,
    },
    lookAt: { x: heroX, y: heroY + lookHeightMeters, z: heroZ },
  };
}

// The backdrop card's own gradient, painted once into a small canvas. Deep and cool at the rim,
// barely-there in the middle: the world behind stays legible as "you are still somewhere" without
// ever competing with the subject's silhouette. rgb(12 20 31) is the same ink index.html's own HERO
// chrome is built from, so the card and the pills read as one screen.
const BACKDROP_TEXTURE_SIZE = 256;
// Opacities raised across the board after the first after-captures were looked at: at 0.42 in the
// centre the village behind the hero was still fully legible, and at the NPC cluster a cottage roof
// ran straight under his feet so he read as standing ON a rooftop. The world is meant to be a place
// he is standing IN, not a scene competing with him.
const BACKDROP_STOPS = Object.freeze([
  Object.freeze([0.00, 'rgba(12, 20, 31, 0.56)']),
  Object.freeze([0.40, 'rgba(10, 17, 27, 0.75)']),
  Object.freeze([0.72, 'rgba(6, 11, 19, 0.92)']),
  Object.freeze([1.00, 'rgba(3, 6, 11, 0.99)']),
]);
// Far enough in front of the lens that the card is never inside the near plane, near enough that the
// quad stays small. Its size is solved from the frustum at this exact distance, below.
const BACKDROP_DISTANCE_METERS = 2;

// THE GROUND POOL. A soft ellipse of warm light lying on the ground at the hero's feet.
//
// The first after-captures had him reading as a sticker pasted on a dark card -- correct, unoccluded,
// and unmoored. The ordinary fix is a contact SHADOW, and it does not work here: the backdrop card is
// already near-black under his feet, so a dark shadow on a dark card is nothing at all. A pool of
// LIGHT is the inverse and it is also what a character-select screen actually does -- he is standing
// in the spotlight, which is the whole premise of the screen. Gold because rgb(242 179 61) is this
// repo's own "warm gold = reward/ownership" colour, already carried by #hero-button, the slot rings
// and the EQUIPPED tag.
const GROUND_POOL_RADIUS_METERS = 1.05;
const GROUND_POOL_COLOR = 0xf2b33d;
const GROUND_POOL_OPACITY = 0.42;
const GROUND_POOL_TEXTURE_SIZE = 128;
const GROUND_POOL_STOPS = Object.freeze([
  Object.freeze([0.00, 'rgba(255, 255, 255, 0.85)']),
  Object.freeze([0.35, 'rgba(255, 255, 255, 0.45)']),
  Object.freeze([0.70, 'rgba(255, 255, 255, 0.12)']),
  Object.freeze([1.00, 'rgba(255, 255, 255, 0.00)']),
]);

function createRadialTexture(THREE, size, stops) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const half = size / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  for (const [stop, color] of stops) gradient.addColorStop(stop, color);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// The showcase light rig, in CAMERA space. Parenting the lights to the preview camera rather than to
// the world is the other half of "location-independent": the hero is lit identically standing in the
// lit plaza, under the dark canopy or out in the wilderness at any heading, because the key, the fill
// and the two kickers are always in the same place relative to the lens.
//
// Offsets are relative to where the hero stands, which in camera space is (0, 0, -distance): +X is
// screen-right, +Y up, -Z into the screen.
const KEY_OFFSET = Object.freeze({ x: -1.7, y: 2.1, z: 2.2 });
const FILL_OFFSET = Object.freeze({ x: 2.0, y: 0.5, z: 1.8 });
const KICKER_LEFT_OFFSET = Object.freeze({ x: -2.3, y: 1.5, z: -1.9 });
const KICKER_RIGHT_OFFSET = Object.freeze({ x: 2.3, y: 1.3, z: -1.9 });
const LIGHT_TARGET_HEIGHT_OFFSET = 0.1;

const KEY_COLOR = 0xfff3dc;
const KEY_INTENSITY = 2.6;
const FILL_COLOR = 0x9fc4e8;
const FILL_INTENSITY = 1.0;
const AMBIENT_COLOR = 0xb9c8dc;
const AMBIENT_INTENSITY = 0.85;
// The two kickers carry the EQUIPPED WEAPON'S OWN COLOUR (progression/heroScreen.js's swatchHexFor,
// the same source the item card and the owned strip read). This is what replaces GP1-C2's temporary
// floating octahedron: tapping EQUIP still visibly changes the 3D preview -- the light around the
// hero turns Wildwood green -- but it does it with a rim light instead of a debug shape parked over
// his chest. Same causal contract, and it belongs in a reward screen.
// Raised from 2.2 after looking at a Blade-equipped capture: at 2.2 the accent was present but had
// to be hunted for against a 2.6 key. 3.4 makes the colour change something a child notices
// without turning the showcase into a light show.
const KICKER_INTENSITY = 3.4;

/**
 * @param scene   the ONE scene. The preview camera, its light rig and its backdrop card are added to
 *                it; they are invisible to the world camera because they live on layers it does not
 *                enable.
 * @param THREE   the vendored module, passed in the same way progression/heroScreen.js's own marker
 *                took it -- keeps this file importable by a node test that never touches WebGL.
 */
export function createHeroPreview(scene, THREE) {
  const camera = new THREE.PerspectiveCamera(PREVIEW_FOV_DEGREES, 1, 0.1, 100);
  camera.name = 'hero-preview-camera';
  camera.layers.set(HERO_PREVIEW);
  scene.add(camera);

  const rig = new THREE.Group();
  rig.name = 'hero-preview-light-rig';
  camera.add(rig);

  function addLight(light, offset, name) {
    light.name = name;
    light.layers.set(HERO_PREVIEW);
    light.position.set(offset.x, offset.y, offset.z);
    light.target.layers.set(HERO_PREVIEW);
    light.target.position.set(0, LIGHT_TARGET_HEIGHT_OFFSET, 0);
    rig.add(light, light.target);
    return light;
  }

  const ambient = new THREE.AmbientLight(AMBIENT_COLOR, AMBIENT_INTENSITY);
  ambient.name = 'hero-preview-ambient';
  ambient.layers.set(HERO_PREVIEW);
  rig.add(ambient);
  const key = addLight(new THREE.DirectionalLight(KEY_COLOR, KEY_INTENSITY), KEY_OFFSET, 'hero-preview-key');
  const fill = addLight(new THREE.DirectionalLight(FILL_COLOR, FILL_INTENSITY), FILL_OFFSET, 'hero-preview-fill');
  const kickerLeft = addLight(
    new THREE.DirectionalLight(0xffffff, KICKER_INTENSITY), KICKER_LEFT_OFFSET, 'hero-preview-kicker-left',
  );
  const kickerRight = addLight(
    new THREE.DirectionalLight(0xffffff, KICKER_INTENSITY), KICKER_RIGHT_OFFSET, 'hero-preview-kicker-right',
  );

  const backdropTexture = createRadialTexture(THREE, BACKDROP_TEXTURE_SIZE, BACKDROP_STOPS);
  const backdropMaterial = new THREE.MeshBasicMaterial({
    map: backdropTexture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), backdropMaterial);
  backdrop.name = 'hero-preview-backdrop';
  backdrop.layers.set(HERO_PREVIEW_BACKDROP);
  backdrop.position.set(0, 0, -BACKDROP_DISTANCE_METERS);
  // Drawn FIRST inside the backdrop pass; the ground pool below is renderOrder 1 so it lands on top
  // of the card rather than under it. Both are transparent, and three.js sorts the transparent list by
  // renderOrder before anything else, so this ordering is the sort key and not a coincidence of depth.
  backdrop.renderOrder = 0;
  camera.add(backdrop);

  // The pool lives in WORLD space (it has to sit on the ground the hero is actually standing on), but
  // it belongs to the BACKDROP pass -- drawn after the card and before the hero, so the hero's shoes
  // are painted over it and he stands IN it rather than behind it.
  const groundPoolTexture = createRadialTexture(THREE, GROUND_POOL_TEXTURE_SIZE, GROUND_POOL_STOPS);
  const groundPoolMaterial = new THREE.MeshBasicMaterial({
    map: groundPoolTexture,
    color: GROUND_POOL_COLOR,
    opacity: GROUND_POOL_OPACITY,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
  const groundPool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundPoolMaterial);
  groundPool.name = 'hero-preview-ground-pool';
  groundPool.layers.set(HERO_PREVIEW_BACKDROP);
  groundPool.rotation.x = -Math.PI / 2;
  groundPool.scale.set(GROUND_POOL_RADIUS_METERS * 2, GROUND_POOL_RADIUS_METERS * 2, 1);
  groundPool.renderOrder = 1;
  scene.add(groundPool);

  // Every object's ORIGINAL layer mask, so close() puts back exactly what was there rather than
  // assuming "the hero is all CHARACTER". It is not: character/hero.js sets CHARACTER on the GLB at
  // load, but the belt lantern (character/gear.js's attachBeltLantern) is a separately-loaded root
  // mounted later and sits on WORLD. A blanket re-set would silently move it.
  const savedLayerMasks = new Map();
  let active = false;
  let previewedRoot = null;
  let orbitYawRadians = 0;
  let accentHex = null;
  const framing = { distanceMeters: 0, lookHeightMeters: 0, portrait: true, fovDegrees: PREVIEW_FOV_DEGREES };

  function claim(root) {
    root.traverse((object) => {
      if (!savedLayerMasks.has(object)) savedLayerMasks.set(object, object.layers.mask);
      object.layers.set(HERO_PREVIEW);
    });
  }

  function release() {
    for (const [object, mask] of savedLayerMasks) object.layers.mask = mask;
    savedLayerMasks.clear();
  }

  function sizeBackdrop(aspect) {
    const height = 2 * Math.tan((PREVIEW_FOV_DEGREES * DEGREES_TO_RADIANS) / 2) * BACKDROP_DISTANCE_METERS;
    // 6% of margin so a fractional viewport or a rounded pixel ratio can never expose a hairline of
    // un-dimmed world at the frame edge.
    backdrop.scale.set(height * Math.max(aspect, 0.0001) * 1.06, height * 1.06, 1);
  }

  return {
    camera,

    isActive() { return active; },

    /**
     * Open/close. `heroRoot` is main.js's own `runtime.hero` -- the live local hero, nothing cloned.
     * Closing restores every touched layer mask exactly, so gameplay rendering resumes unchanged.
     */
    setActive(next, heroRoot = null) {
      if (active === next) return;
      active = next;
      if (active) {
        previewedRoot = heroRoot;
        // A fresh open always starts at the authored 3/4, never at whatever the last drag left --
        // "the framing does not jump somewhere stupid" has to be true on the FIRST frame too.
        orbitYawRadians = 0;
        if (previewedRoot) claim(previewedRoot);
      } else {
        release();
        previewedRoot = null;
      }
    },

    /** Drag-to-turn, routed here by main.js while the screen is open. Yaw only, deliberately: a
     *  pitch a child can drag is a pitch a child can leave pointing at the sky. */
    orbit(yawDelta) {
      orbitYawRadians += yawDelta;
    },

    /**
     * Called every frame the screen is open, BEFORE the render passes.
     * @param heroRoot        the live hero (re-claimed each frame, so gear mounted while the screen
     *                        is open -- the belt lantern, a future weapon swap -- joins the preview)
     * @param accentColorHex  numeric hex of the equipped weapon's swatch, for the two kickers
     * @param width,height    the renderer's own drawing-buffer size, for aspect and orientation
     */
    update({ heroRoot, accentColorHex, width, height }) {
      if (!active) return;
      if (heroRoot && heroRoot !== previewedRoot) {
        previewedRoot = heroRoot;
      }
      if (previewedRoot) claim(previewedRoot);

      const aspect = Math.max(width, 1) / Math.max(height, 1);
      const next = heroPreviewFraming(width, height);
      framing.distanceMeters = next.distanceMeters;
      framing.lookHeightMeters = next.lookHeightMeters;
      framing.portrait = next.portrait;
      framing.fovDegrees = next.fovDegrees;

      if (camera.aspect !== aspect || camera.fov !== next.fovDegrees) {
        camera.aspect = aspect;
        camera.fov = next.fovDegrees;
        camera.updateProjectionMatrix();
      }
      sizeBackdrop(aspect);

      const hero = previewedRoot;
      const placement = heroPreviewCameraPlacement({
        heroX: hero ? hero.position.x : 0,
        heroY: hero ? hero.position.y : 0,
        heroZ: hero ? hero.position.z : 0,
        heroHeading: hero ? hero.rotation.y : 0,
        distanceMeters: next.distanceMeters,
        lookHeightMeters: next.lookHeightMeters,
        pitchRadians: next.pitchRadians,
        orbitYawRadians,
      });
      camera.position.set(placement.position.x, placement.position.y, placement.position.z);
      camera.lookAt(placement.lookAt.x, placement.lookAt.y, placement.lookAt.z);
      // A hair above the ground the hero stands on. Depth testing is off for this pass anyway, so the
      // offset is only there to keep it off the exact same plane as anything the world drew.
      if (hero) groundPool.position.set(hero.position.x, hero.position.y + 0.02, hero.position.z);
      // The rig hangs off the camera, so its lights are already in the right place -- but the light
      // targets need the hero's distance, which changes with orientation.
      rig.position.set(0, 0, -next.distanceMeters);

      if (typeof accentColorHex === 'number' && accentColorHex !== accentHex) {
        accentHex = accentColorHex;
        kickerLeft.color.setHex(accentColorHex);
        kickerRight.color.setHex(accentColorHex);
      }
    },

    /**
     * Draw the showcase over the frame the world pass just left in the colour buffer.
     *
     * scene.background is nulled for the duration: render/sky.js's gradient is an equirect texture,
     * and three.js draws a background as a full-screen box at the START of every render() call --
     * with autoClear off it does not clear, but it would still repaint the whole frame and take the
     * dimmed world backdrop with it. scene.fog is left alone: FOG_NEAR is 30 m and this camera stands
     * ~5 m from its subject, so the hero is on the near side of the haze either way.
     */
    render(renderer, sceneToRender) {
      if (!active) return;
      const savedAutoClear = renderer.autoClear;
      const savedBackground = sceneToRender.background;
      renderer.autoClear = false;
      sceneToRender.background = null;
      // The one line that makes this location-independent: after it, the depth buffer holds no
      // building, tree, NPC or ground at all, so nothing in the world can be in front of the hero.
      renderer.clearDepth();
      camera.layers.set(HERO_PREVIEW_BACKDROP);
      renderer.render(sceneToRender, camera);
      camera.layers.set(HERO_PREVIEW);
      renderer.render(sceneToRender, camera);
      sceneToRender.background = savedBackground;
      renderer.autoClear = savedAutoClear;
    },

    /**
     * "Observable without seeing it", the same rule every other runtime accessor in main.js follows.
     * `heroFrame` is the live hero's own bounds projected through the preview camera into normalized
     * screen space (0..1, y down) -- so a harness can structurally reject a preview that framed the
     * hero off-screen or at the size of a postage stamp, WITHOUT that ever being allowed to stand in
     * for looking at the capture.
     */
    debugState() {
      const state = {
        active,
        accentHex: accentHex === null ? null : `#${accentHex.toString(16).padStart(6, '0')}`,
        portrait: framing.portrait,
        distanceMeters: framing.distanceMeters,
        lookHeightMeters: framing.lookHeightMeters,
        fovDegrees: framing.fovDegrees,
        orbitYawRadians,
        heroOnPreviewLayer: null,
        heroFrame: null,
      };
      if (!active || !previewedRoot) return state;

      let onLayer = 0;
      let total = 0;
      previewedRoot.traverse((object) => {
        total += 1;
        if (object.layers.mask === (1 << HERO_PREVIEW)) onLayer += 1;
      });
      state.heroOnPreviewLayer = { onLayer, total };

      const box = new THREE.Box3().setFromObject(previewedRoot);
      if (box.isEmpty()) return state;
      camera.updateMatrixWorld();
      const corner = new THREE.Vector3();
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      for (let i = 0; i < 8; i += 1) {
        corner.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).project(camera);
        const x = (corner.x + 1) / 2;
        const y = (1 - corner.y) / 2;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      state.heroFrame = {
        left: minX, right: maxX, top: minY, bottom: maxY,
        width: maxX - minX, height: maxY - minY,
        centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2,
      };
      return state;
    },

    dispose() {
      release();
      camera.remove(backdrop, rig);
      scene.remove(camera, groundPool);
      backdrop.geometry.dispose();
      backdropMaterial.dispose();
      backdropTexture.dispose();
      groundPool.geometry.dispose();
      groundPoolMaterial.dispose();
      groundPoolTexture.dispose();
      for (const light of [ambient, key, fill, kickerLeft, kickerRight]) light.dispose?.();
    },
  };
}
