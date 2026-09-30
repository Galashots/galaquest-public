// The three.js diorama. This module owns the scene graph and all visual
// juice; it never touches game rules directly -- main.js reads game state
// with the rules modules and calls the small sync/pick/play API below.
import * as THREE from '../../vendor/three.module.min.js';
import * as gen from './procgen.js';
import { TweenManager, SparkleBurst } from './juice.js';
import { CreatureModels } from './models.js';
import { addCrack, seatCrack } from './cracks.js';

const PLOT_POSITIONS = [
  new THREE.Vector3(-2, 0, 2.4),
  new THREE.Vector3(0, 0, 2.4),
  new THREE.Vector3(2, 0, 2.4),
];
const EGG_POSITION = new THREE.Vector3(-3.8, 0, 2.4);
const EGG2_POSITION = new THREE.Vector3(-2.85, 0, 3.55);
const EGG3_POSITION = new THREE.Vector3(-1.55, 0, 3.9);
const MARKET_POSITION = new THREE.Vector3(2.6, 0, -2.2);
const MANNEQUIN_POSITION = new THREE.Vector3(4.15, 0, -1.5);
const HERO_POSITION = new THREE.Vector3(0.7, 0, -0.7);
const WATER_CAN_POSITION = new THREE.Vector3(-4.4, 0, 3.8);

/** Recursively disposes geometries + materials on an Object3D subtree, freeing GPU memory before it's discarded (important on memory-constrained iPads). Never disposes shared resources passed in via `keep`. */
function disposeObject3D(root, keep) {
  if (!root) return;
  root.traverse((o) => {
    if (o.geometry && o.geometry !== keep) o.geometry.dispose();
    if (o.material) {
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      materials.forEach((m) => { if (m !== keep) m.dispose(); });
    }
  });
}

/** Removes every child of a group, disposing each one's GPU resources first. */
function clearGroupDisposing(group) {
  while (group.children.length) {
    const child = group.children[group.children.length - 1];
    group.remove(child);
    disposeObject3D(child);
  }
}

export class Diorama {
  constructor(canvas, content) {
    this.canvas = canvas;
    this.content = content;
    this.cropsById = new Map(content.CROPS.map((c) => [c.id, c]));
    this.clock = new THREE.Clock();
    this.tweens = new TweenManager();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // The diorama's props sit at world x from about -3.8 (egg) to +4.15
    // (mannequin). That span was tuned against a 4:3-ish landscape frustum;
    // a narrower portrait aspect shrinks the *horizontal* FOV a lot at a
    // fixed vertical FOV, which otherwise clips the egg and mannequin
    // completely off-screen. resize() dollies the camera back (scaling this
    // reference offset) to keep everything in frame in any orientation.
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this._lookAtTarget = new THREE.Vector3(0, 0.3, -0.4);
    this._cameraOffsetRef = new THREE.Vector3(0, 7.4, 10).sub(this._lookAtTarget);
    this._referenceAspect = 4 / 3;
    this.cameraBase = new THREE.Vector3(0, 7.4, 10);
    this.camera.position.copy(this.cameraBase);
    this.camera.lookAt(this._lookAtTarget);

    this._raycaster = new THREE.Raycaster();
    this._sway = 0;
    this._eggWobbleSpeed = 0;
    this._marketFocus = 0;
    this._marketOpen = false;

    // Cache of the last args each sync* call received, so a context restore
    // (see _onContextRestored) can rebuild the scene and immediately put it
    // back into the correct visual state without main.js having to know.
    this._lastFarm = null;
    this._lastArmor = null;
    this._lastEgg = null;
    this._lastSecondEgg = null;
    this._lastThirdEgg = null;
    this._lastCrest = false;
    this._lastFestival = 0;
    this._growth1 = 1;
    this._danceUntil = 0;
    this._preloadIds = new Set();

    // Outlives _buildScene: a lost context rebuilds the scene from the same
    // loaded templates instead of fetching the models again.
    this.models = new CreatureModels(THREE);

    this._buildScene();

    this._contextLost = false;
    this._onContextLost = (e) => { e.preventDefault(); this._contextLost = true; };
    this._onContextRestored = () => {
      disposeObject3D(this.scene);
      this.tweens = new TweenManager();
      this._buildScene();
      this._contextLost = false;
      if (this._lastFarm) this.syncFarm(this._lastFarm.farmState, this._lastFarm.now);
      if (this._lastArmor) this.syncArmor(this._lastArmor.equippedDefs, this._lastArmor.forSaleDef);
      if (this._lastEgg) this.syncEgg(this._lastEgg);
      if (this._lastSecondEgg) this.syncSecondEgg(this._lastSecondEgg);
      if (this._lastThirdEgg) this.syncThirdEgg(this._lastThirdEgg);
      if (this._lastFestival) this.syncFestival(this._lastFestival);
      if (this._growth1 !== 1) this.syncGrowth(this._growth1);
      if (this.creatureGroup && this._lastCrest) this.syncCrest(true);
    };
    canvas.addEventListener('webglcontextlost', this._onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);
  }

  /** Builds (or, after a lost WebGL context, rebuilds) the whole scene graph. */
  _buildScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#bdeeff');
    // Far enough that dollying the camera back for a narrow portrait aspect
    // doesn't wash out the whole diorama in haze.
    this.scene.fog = new THREE.Fog('#bdeeff', 20, 42);

    this._setupLighting();
    this.sparkles = new SparkleBurst(this.scene, THREE);

    this.scene.add(gen.buildIsland(THREE));

    this.plotGroups = [];
    this.cropMeshes = [];
    this.plotStates = []; // { cropId, ready } mirrored for animation only
    PLOT_POSITIONS.forEach((pos, i) => {
      const plot = gen.buildPlot(THREE);
      plot.position.copy(pos);
      plot.traverse((o) => { o.userData.pickType = 'plot'; o.userData.plotIndex = i; });
      this.scene.add(plot);
      this.plotGroups.push(plot);
      this.cropMeshes.push(null);
      this.plotStates.push({ cropId: null, ready: false, watered: false });
    });

    this.wateringCan = gen.buildWateringCan(THREE);
    this.wateringCan.position.copy(WATER_CAN_POSITION);
    this.wateringCan.visible = false;
    this.scene.add(this.wateringCan);

    this.seedSack = gen.buildSeedSack(THREE);
    this.seedSack.position.set(4.3, 0, 2.4);
    this.seedSack.visible = false;
    this.seedSack.traverse((o) => { o.userData.pickType = 'seedSack'; });
    this.scene.add(this.seedSack);

    const stall = gen.buildMarketStall(THREE);
    stall.position.copy(MARKET_POSITION);
    stall.traverse((o) => { o.userData.pickType = 'market'; });
    this.scene.add(stall);

    const { group: mannequinGroup, slots: mannequinSlots } = gen.buildMannequin(THREE);
    mannequinGroup.position.copy(MANNEQUIN_POSITION);
    mannequinGroup.rotation.y = -0.4;
    mannequinGroup.traverse((o) => { o.userData.pickType = 'mannequin'; });
    this.scene.add(mannequinGroup);
    this.mannequinSlots = mannequinSlots;
    this.mannequinArmorId = null;

    const { group: heroGroup, slots: heroSlots } = gen.buildHero(THREE);
    heroGroup.position.copy(HERO_POSITION);
    heroGroup.rotation.y = 0.5;
    this.scene.add(heroGroup);
    this.heroGroup = heroGroup;
    this.heroSlots = heroSlots;
    this.heroEquipped = {};

    this.eggGroup = gen.buildEgg(THREE);
    this.eggGroup.position.copy(EGG_POSITION);
    this.eggGroup.traverse((o) => { o.userData.pickType = 'egg'; });
    this.eggGroup.userData.surfaces = [this.eggGroup.userData.shell];
    this.eggGroup.userData.glow = [this.eggGroup.userData.shell.material];
    this.scene.add(this.eggGroup);
    this._upgradeEgg(this.eggGroup);
    this.eggVisible = true;

    this.creatureGroup = null; // built on hatch
    this.egg2Group = null; // built when Pip's gift is earned
    this.egg2Visible = false;
    this.creatureGroup2 = null; // built on the Leaf-egg hatch
    this.egg3Group = null; // built when the festival prize is earned
    this.egg3Visible = false;
    this.creatureGroup3 = null; // built on the Water-egg hatch
    this.festivalGroups = []; // one group per earned decor stage, additive
    this._crest = null; // Sprout's sun crest adornment, added at 3 feeds
  }

  _setupLighting() {
    const hemi = new THREE.HemisphereLight('#fff7e0', '#7fce5a', 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff2cf', 1.05);
    sun.position.set(4, 8, 5);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#a9d8ff', 0.35);
    fill.position.set(-6, 4, -4);
    this.scene.add(fill);
  }

  resize(width, height) {
    this.renderer.setSize(width, height, false);
    const aspect = width / Math.max(1, height);
    this.camera.aspect = aspect;

    // Dolly back proportionally when the aspect is narrower than the
    // reference so the horizontal FOV (and everything at the sides of the
    // diorama) never shrinks below what landscape shows.
    const scale = aspect < this._referenceAspect ? this._referenceAspect / aspect : 1;
    this.cameraBase = this._lookAtTarget.clone().addScaledVector(this._cameraOffsetRef, scale);
    this.camera.position.copy(this.cameraBase);
    this.camera.lookAt(this._lookAtTarget);

    this.camera.updateProjectionMatrix();
  }

  /** Stops listening for context events and frees every GPU resource. Call when the diorama is being torn down for good. */
  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
    disposeObject3D(this.scene);
    this.renderer.dispose();
  }

  // -- Sync from game state (called by main.js after every state change) --

  syncFarm(farmState, now) {
    this._lastFarm = { farmState, now };
    const cropsById = new Map(this.content.CROPS.map((c) => [c.id, c]));
    farmState.plots.forEach((plot, i) => {
      const prev = this.plotStates[i];
      if (!plot.cropId) {
        if (this.cropMeshes[i]) {
          this.plotGroups[i].remove(this.cropMeshes[i]);
          disposeObject3D(this.cropMeshes[i]);
          this.cropMeshes[i] = null;
        }
        this.plotStates[i] = { cropId: null, ready: false, watered: false };
        return;
      }
      const cropDef = cropsById.get(plot.cropId);
      const elapsed = Math.max(0, now - plot.plantedAt);
      const progress = Math.min(1, elapsed / Math.max(1, cropDef.growSeconds * 1000));
      const ready = progress >= 1;

      if (!this.cropMeshes[i] || prev.cropId !== plot.cropId) {
        if (this.cropMeshes[i]) {
          this.plotGroups[i].remove(this.cropMeshes[i]);
          disposeObject3D(this.cropMeshes[i]);
        }
        const mesh = gen.buildCrop(THREE, cropDef, progress);
        mesh.traverse((o) => { o.userData.pickType = plot.watered || ready ? 'plot' : 'sprout'; o.userData.plotIndex = i; });
        this.plotGroups[i].add(mesh);
        this.cropMeshes[i] = mesh;
      } else {
        // Re-scale the fruit + stem live as it grows, without rebuilding.
        const mesh = this.cropMeshes[i];
        const fruit = mesh.getObjectByName('fruit');
        if (fruit) fruit.scale.setScalar(0.15 + progress * 0.45);
        if (prev.watered !== plot.watered || prev.ready !== ready) {
          mesh.traverse((o) => { o.userData.pickType = plot.watered || ready ? 'plot' : 'sprout'; o.userData.plotIndex = i; });
        }
      }
      this.plotStates[i] = { cropId: plot.cropId, ready, watered: plot.watered };
    });
  }

  syncArmor(equippedDefs, forSaleDef) {
    this._lastArmor = { equippedDefs, forSaleDef };
    for (const slot of Object.keys(this.heroSlots)) {
      const def = equippedDefs[slot];
      const currentId = this.heroEquipped[slot];
      if ((def && def.id) !== currentId) {
        clearGroupDisposing(this.heroSlots[slot]);
        if (def) this.heroSlots[slot].add(gen.buildArmorPiece(THREE, def));
        this.heroEquipped[slot] = def ? def.id : null;
        // The hair mesh would otherwise poke through / hide a helmet.
        if (slot === 'helmet' && this.heroGroup.userData.hair) {
          this.heroGroup.userData.hair.visible = !def;
        }
      }
    }

    const forSaleId = forSaleDef ? forSaleDef.id : null;
    if (forSaleId !== this.mannequinArmorId) {
      Object.values(this.mannequinSlots).forEach((s) => clearGroupDisposing(s));
      if (forSaleDef) this.mannequinSlots[forSaleDef.slot].add(gen.buildArmorPiece(THREE, forSaleDef));
      this.mannequinArmorId = forSaleId;
    }
  }

  syncEgg(eggState) {
    this._lastEgg = eggState;
    const cracksShown = this.eggGroup.userData.cracks.length;
    for (let i = cracksShown; i < eggState.cracks + eggState.hatchTaps; i++) {
      addCrack(THREE, this.eggGroup, i, this._raycaster);
      this.sparkles.spawn(this.eggGroup.position.clone().add(new THREE.Vector3(0, 0.6, 0)), '#fff3b0', 10);
    }
    this._eggWobbleSpeed = 3 + eggState.cracks * 1.6;

    if (eggState.elementHint) this._glowEgg(eggState.elementHint);

    if (eggState.hatched && this.eggVisible) {
      this.eggVisible = false;
      this.eggGroup.visible = false;
      this.sparkles.spawn(this.eggGroup.position.clone().add(new THREE.Vector3(0, 0.6, 0)), '#ffd54f', 28);
      const creatureDef = this.content.CREATURES.find((c) => c.id === eggState.hatchedCreatureId);
      if (creatureDef) {
        this.creatureGroup = this._buildCreature(creatureDef);
        this.creatureGroup.position.copy(this.eggGroup.position);
        this.creatureGroup.scale.setScalar(0.01);
        this.creatureGroup.traverse((o) => { o.userData.pickType = 'creature'; });
        this.scene.add(this.creatureGroup);
        this.tweens.add({
          target: this.creatureGroup.scale, prop: null, from: 0, to: 1, duration: 0.5,
          // Compose with fed-driven growth so a mid-hatch feed cannot lose a stage.
          onUpdate: (v) => this.creatureGroup.scale.setScalar(v * (this._growth1 || 1)),
        });
      }
    } else if (!eggState.hatched && !this.eggVisible) {
      // A fresh save reloaded pre-hatch after a hatch happened in a previous
      // session isn't expected, but keep this defensive for symmetry.
      this.eggVisible = true;
      this.eggGroup.visible = true;
    }
  }

  /** Tints the egg toward the hinted element (procedural shell and sculpted egg alike). */
  _glowEgg(element) {
    const hint = this.content.CROPS.find((c) => c.element === element);
    const glowColor = new THREE.Color(hint ? hint.color : '#ffd54f');
    for (const material of this.eggGroup.userData.glow) {
      material.emissive = glowColor;
      material.emissiveIntensity = 0.35;
    }
  }

  /**
   * Swaps the procedural shell for the sculpted egg once it loads. The group,
   * its picking, wobble and cracks stay; only what they sit on changes.
   */
  _upgradeEgg(eggGroup) {
    const apply = () => {
      const egg = this.models.eggInstance();
      if (!egg || this.eggGroup !== eggGroup || eggGroup.userData.model) return;
      eggGroup.userData.shell.visible = false;
      eggGroup.add(egg);
      egg.traverse((o) => { o.userData.pickType = 'egg'; });
      const meshes = [];
      egg.traverse((o) => { if (o.isMesh) meshes.push(o); });
      eggGroup.userData.model = egg;
      eggGroup.userData.surfaces = meshes;
      eggGroup.userData.glow = meshes.map((m) => m.material);
      eggGroup.userData.cracks.forEach((crack) => seatCrack(THREE, eggGroup, crack, this._raycaster));
      if (this._lastEgg?.elementHint) this._glowEgg(this._lastEgg.elementHint);
    };
    if (this.models.eggInstance()) apply();
    else this.models.loadEgg().then(apply);
  }

  /**
   * Fetches the one creature this egg will hatch into (after the egg itself),
   * so it is ready by the hatch; the rest of the roster is never downloaded.
   */
  preloadCreature(id) {
    // Called every frame; only a new id starts anything.
    if (!id || this._preloadIds.has(id) || !this.models.has(id)) return;
    this._preloadIds.add(id);
    this.models.loadEgg().then(() => this.models.load(id));
  }

  /**
   * The hatched creature: its sculpted model when loaded, else the procedural
   * body, upgraded in place (same group, so tweens and idle motion carry on)
   * the moment a still-loading model arrives.
   */
  _buildCreature(creatureDef, pickType = 'creature') {
    const group = new THREE.Group();
    group.userData.creatureId = creatureDef.id;
    group.userData.pickType = pickType;
    const model = this.models.instance(creatureDef.id, creatureDef.shape);
    group.add(model ?? gen.buildCreature(THREE, creatureDef));
    // Unparented and unscaled here, so the world box is the creature's own height.
    group.userData.height = model ? model.userData.height : new THREE.Box3().setFromObject(group).max.y;
    if (model) group.add(gen.creatureShadow(THREE));
    else if (this.models.has(creatureDef.id)) {
      this.models.load(creatureDef.id).then(() => {
        const upgrade = this.models.instance(creatureDef.id, creatureDef.shape);
        if (!upgrade || (this.creatureGroup !== group && this.creatureGroup2 !== group && this.creatureGroup3 !== group)) return;
        clearGroupDisposing(group);
        group.add(upgrade, gen.creatureShadow(THREE));
        group.userData.height = upgrade.userData.height;
        // No pop here: a pop restores the scale it started from, which could
        // freeze a half-grown creature if this lands during the hatch grow-in.
        group.traverse((o) => { o.userData.pickType = group.userData.pickType; });
        if (this.creatureGroup === group) {
          // The sculpted upgrade replaces the whole subtree, so a bloomed
          // crest must be re-attached rather than assumed to survive.
          this._crest = null;
          if (this._lastCrest) this.syncCrest(true);
        }
        this.sparkles.spawn(group.position.clone().add(new THREE.Vector3(0, 0.6, 0)), '#fff3b0', 12);
      });
    }
    group.traverse((o) => { o.userData.pickType = pickType; });
    return group;
  }

  /**
   * Pip's gift Leaf egg (CONTRACT.md section 5 item 2): a second egg with a
   * visible leaf-green tint beside the first, then a second creature on its
   * ungated hatch. Mirrors syncEgg's show/hide shape but never touches the
   * first egg or creature.
   */
  syncSecondEgg(secondEgg) {
    this._lastSecondEgg = secondEgg;
    if (!secondEgg) {
      if (this.egg2Group) this.egg2Group.visible = false;
      this.egg2Visible = false;
      return;
    }
    if (!secondEgg.hatched) {
      if (!this.egg2Group) {
        this.egg2Group = gen.buildEgg(THREE);
        this.egg2Group.position.copy(EGG2_POSITION);
        this.egg2Group.userData.shell.material.emissive = new THREE.Color('#8bc34a');
        this.egg2Group.userData.shell.material.emissiveIntensity = 0.5;
        this.egg2Group.traverse((o) => { o.userData.pickType = 'egg2'; });
        this.scene.add(this.egg2Group);
      }
      this.egg2Group.visible = true;
      this.egg2Visible = true;
      return;
    }
    if (this.egg2Visible) {
      this.egg2Visible = false;
      if (this.egg2Group) this.egg2Group.visible = false;
      this.sparkles.spawn(EGG2_POSITION.clone().add(new THREE.Vector3(0, 0.6, 0)), '#aed581', 28);
    }
    if (!this.creatureGroup2) {
      const creatureDef = this.content.CREATURES.find((c) => c.id === secondEgg.hatchedCreatureId);
      if (creatureDef) {
        this.creatureGroup2 = this._buildCreature(creatureDef, 'creature2');
        this.creatureGroup2.position.copy(EGG2_POSITION);
        this.creatureGroup2.scale.setScalar(0.01);
        this.scene.add(this.creatureGroup2);
        this.tweens.add({
          target: this.creatureGroup2.scale, prop: null, from: 0, to: 1, duration: 0.5,
          onUpdate: (v) => this.creatureGroup2.scale.setScalar(v),
        });
      }
    }
  }

  /**
   * The festival prize Water egg: a third egg with a visible blue tint
   * beside the others, then a third creature on its ungated hatch. Mirrors
   * syncSecondEgg's show/hide shape but never touches the earlier eggs.
   */
  syncThirdEgg(thirdEgg) {
    this._lastThirdEgg = thirdEgg;
    if (!thirdEgg) {
      if (this.egg3Group) this.egg3Group.visible = false;
      this.egg3Visible = false;
      return;
    }
    if (!thirdEgg.hatched) {
      if (!this.egg3Group) {
        this.egg3Group = gen.buildEgg(THREE);
        this.egg3Group.position.copy(EGG3_POSITION);
        this.egg3Group.userData.shell.material.emissive = new THREE.Color('#4fc3f7');
        this.egg3Group.userData.shell.material.emissiveIntensity = 0.5;
        this.egg3Group.traverse((o) => { o.userData.pickType = 'egg3'; });
        this.scene.add(this.egg3Group);
      }
      this.egg3Group.visible = true;
      this.egg3Visible = true;
      return;
    }
    if (this.egg3Visible) {
      this.egg3Visible = false;
      if (this.egg3Group) this.egg3Group.visible = false;
      this.sparkles.spawn(EGG3_POSITION.clone().add(new THREE.Vector3(0, 0.6, 0)), '#b3e5fc', 28);
    }
    if (!this.creatureGroup3) {
      const creatureDef = this.content.CREATURES.find((c) => c.id === thirdEgg.hatchedCreatureId);
      if (creatureDef) {
        this.creatureGroup3 = this._buildCreature(creatureDef, 'creature3');
        this.creatureGroup3.position.copy(EGG3_POSITION);
        this.creatureGroup3.scale.setScalar(0.01);
        this.scene.add(this.creatureGroup3);
        this.tweens.add({
          target: this.creatureGroup3.scale, prop: null, from: 0, to: 1, duration: 0.5,
          onUpdate: (v) => this.creatureGroup3.scale.setScalar(v),
        });
      }
    }
  }

  /**
   * Garden Festival decor stages, earned by FREE order fills (derived from
   * the saved fill counter, so reloads and context restores rebuild the
   * same party). Additive: newly reached stages pop in with sparkles and
   * earlier stages are never rebuilt or removed.
   */
  syncFestival(stageCount) {
    this._lastFestival = stageCount || 0;
    if (!this.festivalGroups) this.festivalGroups = [];
    const builders = [gen.buildFestivalBunting, gen.buildFestivalPots, gen.buildFestivalLanterns, gen.buildFestivalBanner];
    while (this.festivalGroups.length < Math.min(this._lastFestival, builders.length)) {
      const index = this.festivalGroups.length;
      const stage = builders[index](THREE);
      this.scene.add(stage);
      this.festivalGroups.push(stage);
      const center = new THREE.Box3().setFromObject(stage).getCenter(new THREE.Vector3());
      this.sparkles.spawn(center, '#ffd54f', 18);
      this.tweens.pop(stage, { peak: 1.12, duration: 0.45 });
    }
  }

  /**
   * Fed-driven growth for the first creature (scale only -- the body/rig
   * underneath is never edited). Called every frame; the hatch grow-in
   * tween composes with it, and feed pops restore to it.
   */
  syncGrowth(scale) {
    this._growth1 = scale || 1;
    if (this.creatureGroup) this.creatureGroup.scale.setScalar(this._growth1);
  }

  /**
   * The festival dance: every hatched creature hops high and spins for a
   * few seconds -- unmistakably bigger than the idle hop. Session-only joy,
   * never saved.
   */
  playCelebration(seconds = 6) {
    this._danceUntil = this._sway + seconds;
    for (const group of [this.creatureGroup, this.creatureGroup2, this.creatureGroup3]) {
      if (group) this.sparkles.spawn(group.position.clone().add(new THREE.Vector3(0, 0.8, 0)), '#ffd54f', 14);
    }
  }

  /**
   * Sprout's sun crest adornment (CONTRACT.md section 5 item 1). An added
   * group perched on the creature's head; idempotent across frames, and the
   * body/rig underneath is never edited.
   */
  syncCrest(show) {
    this._lastCrest = !!show;
    if (show && this.creatureGroup && !this._crest) {
      const height = this.creatureGroup.userData.height || 0.5;
      const crest = gen.buildSunCrest(THREE);
      crest.scale.setScalar(THREE.MathUtils.clamp(height / 0.6, 0.9, 1.8));
      crest.position.set(0, height - 0.02, 0);
      crest.traverse((o) => { o.userData.pickType = 'creature'; });
      this.creatureGroup.add(crest);
      this._crest = crest;
      this.sparkles.spawn(this.creatureGroup.position.clone().add(new THREE.Vector3(0, 0.8, 0)), '#ffd54f', 16);
    } else if (!show && this._crest) {
      const parent = this._crest.parent;
      if (parent) parent.remove(this._crest);
      disposeObject3D(this._crest);
      this._crest = null;
    }
  }

  // -- One-shot juice hooks (called right after a successful action) ------

  playPlantPop() {
    this.plotGroups.forEach((g) => this.tweens.pop(g, { peak: 1.08, duration: 0.3 }));
  }

  playHarvestPop(plotIndex, worldPos) {
    this.sparkles.spawn(worldPos || PLOT_POSITIONS[plotIndex].clone().add(new THREE.Vector3(0, 0.6, 0)), '#ffe066', 10);
  }

  playWaterSplash(plotIndex) {
    const start = WATER_CAN_POSITION.clone().add(new THREE.Vector3(0.6, 0.8, 0));
    const end = this.plotGroups[plotIndex].position.clone().add(new THREE.Vector3(0, 0.5, 0));
    for (let i = 0; i < 6; i++) {
      const droplet = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), new THREE.MeshBasicMaterial({ color: '#7ec8ff' }));
      this.scene.add(droplet);
      this.tweens.add({ from: -i * 0.12, to: 1, duration: 0.55,
        onUpdate: (value) => {
          const t = Math.max(0, Math.min(1, value));
          droplet.position.lerpVectors(start, end, t);
          droplet.position.y += Math.sin(Math.PI * t) * 0.6;
          droplet.visible = value >= 0;
        },
        onComplete: () => { this.scene.remove(droplet); droplet.geometry.dispose(); droplet.material.dispose(); },
      });
    }
    this.sparkles.spawn(end, '#7ec8ff', 10);
  }

  playOfferSparkle() {
    this.sparkles.spawn(MARKET_POSITION.clone().add(new THREE.Vector3(0, 1.4, 0)), '#8ee6a3', 16);
  }

  playEquipSparkle() {
    this.tweens.pop(this.heroGroup, { peak: 1.15, duration: 0.4 });
    this.sparkles.spawn(this.heroGroup.position.clone().add(new THREE.Vector3(0, 1.1, 0)), '#fff3b0', 18);
  }

  setWateringCanVisible(visible) { this.wateringCan.visible = !!visible; }

  setMarketOpen(open) { this._marketOpen = !!open; }

  setSeedSackVisible(visible) { this.seedSack.visible = !!visible; }

  playNameHop() {
    if (this.creatureGroup) this.tweens.pop(this.creatureGroup, { peak: 1.3, duration: 0.45 });
  }

  playCreature2Hop() {
    if (this.creatureGroup2) this.tweens.pop(this.creatureGroup2, { peak: 1.3, duration: 0.45 });
  }

  playCreature3Hop() {
    if (this.creatureGroup3) this.tweens.pop(this.creatureGroup3, { peak: 1.3, duration: 0.45 });
  }

  playFeedSparkle() {
    if (!this.creatureGroup) return;
    this.tweens.pop(this.creatureGroup, { peak: 1.3, duration: 0.4 });
    this.sparkles.spawn(this.creatureGroup.position.clone().add(new THREE.Vector3(0, 0.6, 0)), '#ff8fa3', 10);
  }

  // -- Screen-space projection for the goal arrow --------------------------

  worldPositionFor(descriptor) {
    if (!descriptor) return null;
    switch (descriptor.targetKey) {
      case 'plot':
        return this.plotGroups[descriptor.plotIndex ?? 0].position.clone().add(new THREE.Vector3(0, 0.9, 0));
      case 'ripeCrop':
      case 'sprout':
        return this.plotGroups[descriptor.plotIndex ?? 0].position.clone().add(new THREE.Vector3(0, 1.1, 0));
      case 'market':
        return MARKET_POSITION.clone().add(new THREE.Vector3(0, 1.6, 0));
      case 'mannequin':
        return MANNEQUIN_POSITION.clone().add(new THREE.Vector3(0, 2, 0));
      case 'egg':
        return this.eggGroup.position.clone().add(new THREE.Vector3(0, 1, 0));
      case 'egg2':
        return this.creatureGroup2
          ? this.creatureGroup2.position.clone().add(new THREE.Vector3(0, this.creatureGroup2.userData.height + 0.1, 0))
          : EGG2_POSITION.clone().add(new THREE.Vector3(0, 1, 0));
      case 'egg3':
        return this.creatureGroup3
          ? this.creatureGroup3.position.clone().add(new THREE.Vector3(0, this.creatureGroup3.userData.height + 0.1, 0))
          : EGG3_POSITION.clone().add(new THREE.Vector3(0, 1, 0));
      case 'creature':
        // Just above its head, as for the egg: a fixed low offset put the arrow on its face.
        return this.creatureGroup
          ? this.creatureGroup.position.clone().add(new THREE.Vector3(0, this.creatureGroup.userData.height + 0.1, 0))
          : null;
      default:
        return null;
    }
  }

  projectToScreen(worldPos, width, height) {
    const p = worldPos.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * width, y: (-p.y * 0.5 + 0.5) * height };
  }

  // -- Tap picking ----------------------------------------------------------

  pickAt(ndcX, ndcY) {
    this._raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const hits = this._raycaster.intersectObjects(this.scene.children, true);
    for (const hit of hits) {
      // three.js's raycaster does NOT skip individually-invisible meshes or
      // hidden ancestors (e.g. the egg after it hatches and is set
      // .visible = false but stays in the scene) -- so we must check the
      // whole visibility chain ourselves, or a hidden object can "win" the
      // pick over whatever now stands in its place.
      let hidden = false;
      let o = hit.object;
      while (o) {
        if (!o.visible) { hidden = true; break; }
        o = o.parent;
      }
      if (hidden) continue;

      o = hit.object;
      while (o) {
        if (o.userData && o.userData.pickType) {
          return { type: o.userData.pickType, plotIndex: o.userData.plotIndex };
        }
        o = o.parent;
      }
    }
    return null;
  }

  // -- Per-frame update + render --------------------------------------------

  update() {
    if (this._contextLost) return;
    const dt = Math.min(0.1, this.clock.getDelta());
    this._sway += dt;

    // Glide toward Pip's stall while the market is open.
    this._marketFocus += ((this._marketOpen ? 1 : 0) - this._marketFocus) * Math.min(1, dt * 3);
    this.camera.position.x = this.cameraBase.x + this._marketFocus * 1.5 + Math.sin(this._sway * 0.25) * 0.35;
    this.camera.position.y = this.cameraBase.y + Math.sin(this._sway * 0.18) * 0.15;
    this.camera.lookAt(this._lookAtTarget.clone().add(new THREE.Vector3(this._marketFocus * 1.5, 0, 0)));

    if (this.wateringCan.visible) this.wateringCan.position.y = Math.sin(this._sway * 4) * 0.08;
    if (this.seedSack.visible) this.seedSack.userData.bag.material.emissiveIntensity = 0.25 + (Math.sin(this._sway * 3) + 1) * 0.15;

    // Egg wobble, ramping up with crack count.
    if (this.eggVisible) {
      const amp = 0.05 + this._eggWobbleSpeed * 0.01;
      this.eggGroup.rotation.z = Math.sin(this._sway * this._eggWobbleSpeed) * amp;
      this.eggGroup.position.y = EGG_POSITION.y + Math.abs(Math.sin(this._sway * this._eggWobbleSpeed * 0.5)) * 0.04;
    }

    // Idle hero bob.
    this.heroGroup.position.y = HERO_POSITION.y + Math.sin(this._sway * 1.6) * 0.03;

    // Ripe-crop "tap me" bounce; a gentle sway for unwatered sprouts too.
    this.plotStates.forEach((s, i) => {
      const mesh = this.cropMeshes[i];
      if (!mesh) return;
      const fruit = mesh.getObjectByName('fruit');
      if (fruit && s.ready) {
        fruit.rotation.y += dt * 1.2;
        const bob = Math.abs(Math.sin(this._sway * 4 + i)) * 0.08;
        mesh.position.y = bob;
      } else if (s.cropId && !s.watered) {
        mesh.rotation.z = Math.sin(this._sway * 2.5 + i) * 0.08;
        mesh.position.y = 0;
      } else {
        mesh.position.y = 0;
        mesh.rotation.z = 0;
      }
    });

    // Egg-2 wobble while it waits for its taps.
    if (this.egg2Visible && this.egg2Group) {
      this.egg2Group.rotation.z = Math.sin(this._sway * 4) * 0.06;
      this.egg2Group.position.y = EGG2_POSITION.y + Math.abs(Math.sin(this._sway * 2)) * 0.04;
    }

    // Water-egg wobble while it waits for its taps.
    if (this.egg3Visible && this.egg3Group) {
      this.egg3Group.rotation.z = Math.sin(this._sway * 4 + 2) * 0.06;
      this.egg3Group.position.y = EGG3_POSITION.y + Math.abs(Math.sin(this._sway * 2 + 1)) * 0.04;
    }

    // Hatched creature idle hop -- or the festival dance (higher, spinning,
    // unmistakable) while a celebration is running.
    const dancing = this._sway < (this._danceUntil || 0);
    if (this.creatureGroup) {
      if (dancing) {
        this.creatureGroup.position.y = Math.abs(Math.sin(this._sway * 7)) * 0.45;
        this.creatureGroup.rotation.y += dt * 7;
      } else {
        this.creatureGroup.position.y = Math.abs(Math.sin(this._sway * 3)) * 0.15;
        this.creatureGroup.rotation.y = Math.sin(this._sway * 0.7) * 0.4;
      }
    }
    if (this.creatureGroup2) {
      if (dancing) {
        this.creatureGroup2.position.y = EGG2_POSITION.y + Math.abs(Math.sin(this._sway * 7 + 1)) * 0.45;
        this.creatureGroup2.rotation.y += dt * 7;
      } else {
        this.creatureGroup2.position.y = EGG2_POSITION.y + Math.abs(Math.sin(this._sway * 3 + 1)) * 0.15;
        this.creatureGroup2.rotation.y = Math.sin(this._sway * 0.7 + 1) * 0.4;
      }
    }
    if (this.creatureGroup3) {
      if (dancing) {
        this.creatureGroup3.position.y = EGG3_POSITION.y + Math.abs(Math.sin(this._sway * 7 + 2)) * 0.45;
        this.creatureGroup3.rotation.y += dt * 7;
      } else {
        this.creatureGroup3.position.y = EGG3_POSITION.y + Math.abs(Math.sin(this._sway * 3 + 2)) * 0.15;
        this.creatureGroup3.rotation.y = Math.sin(this._sway * 0.7 + 2) * 0.4;
      }
    }

    this.tweens.update();
    this.sparkles.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
