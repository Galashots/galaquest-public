// The three.js diorama. This module owns the scene graph and all visual
// juice; it never touches game rules directly -- main.js reads game state
// with the rules modules and calls the small sync/pick/play API below.
import * as THREE from '../../vendor/three.module.min.js';
import * as gen from './procgen.js';
import { TweenManager, SparkleBurst } from './juice.js';

const PLOT_POSITIONS = [
  new THREE.Vector3(-2, 0, 2.4),
  new THREE.Vector3(0, 0, 2.4),
  new THREE.Vector3(2, 0, 2.4),
];
const EGG_POSITION = new THREE.Vector3(-3.8, 0, 2.4);
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
    this.scene.add(this.eggGroup);
    this.eggVisible = true;

    this.creatureGroup = null; // built on hatch
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
      gen.addCrackDecal(THREE, this.eggGroup, i);
      this.sparkles.spawn(this.eggGroup.position.clone().add(new THREE.Vector3(0, 0.6, 0)), '#fff3b0', 10);
    }
    this._eggWobbleSpeed = 3 + eggState.cracks * 1.6;

    const shell = this.eggGroup.userData.shell;
    if (eggState.elementHint) {
      const hint = this.content.CROPS.find((c) => c.element === eggState.elementHint);
      const glowColor = hint ? hint.color : '#ffd54f';
      shell.material.emissive = new THREE.Color(glowColor);
      shell.material.emissiveIntensity = 0.35;
    }

    if (eggState.hatched && this.eggVisible) {
      this.eggVisible = false;
      this.eggGroup.visible = false;
      this.sparkles.spawn(this.eggGroup.position.clone().add(new THREE.Vector3(0, 0.6, 0)), '#ffd54f', 28);
      const creatureDef = this.content.CREATURES.find((c) => c.id === eggState.hatchedCreatureId);
      if (creatureDef) {
        this.creatureGroup = gen.buildCreature(THREE, creatureDef);
        this.creatureGroup.position.copy(this.eggGroup.position);
        this.creatureGroup.scale.setScalar(0.01);
        this.creatureGroup.traverse((o) => { o.userData.pickType = 'creature'; });
        this.scene.add(this.creatureGroup);
        this.tweens.add({
          target: this.creatureGroup.scale, prop: null, from: 0, to: 1, duration: 0.5,
          onUpdate: (v) => this.creatureGroup.scale.setScalar(v),
        });
      }
    } else if (!eggState.hatched && !this.eggVisible) {
      // A fresh save reloaded pre-hatch after a hatch happened in a previous
      // session isn't expected, but keep this defensive for symmetry.
      this.eggVisible = true;
      this.eggGroup.visible = true;
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
      case 'creature':
        return this.creatureGroup
          ? this.creatureGroup.position.clone().add(new THREE.Vector3(0, 0.3, 0))
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

    // Hatched creature idle hop.
    if (this.creatureGroup) {
      this.creatureGroup.position.y = Math.abs(Math.sin(this._sway * 3)) * 0.15;
      this.creatureGroup.rotation.y = Math.sin(this._sway * 0.7) * 0.4;
    }

    this.tweens.update();
    this.sparkles.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
