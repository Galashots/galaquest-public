/**
 * window.__galaQuestStudio -- the typed, narrow Studio API (CSB, SR3; owner-plan.md section 16).
 *
 * This is the ONLY surface tools/sol-review/worker.mjs's studioCapture drives -- no DOM guessing, no
 * button coordinates (owner-plan.md section 44). SR3's own scope was deliberately small: "Sol
 * requests exact Hero + Idle + sword/shield + views and reviews the Drive output." SR4 added the
 * loadout comparison primitive; SR5 adds Grip/Shield Inspector + Fit Envelope measurement and overlay
 * methods (see the private engineering archive). Gear swapping (a
 * general candidate-GLB loadout, as opposed to the two fixed states SR4 supports) remains out of
 * scope.
 *
 * Every method that changes state returns nothing; callers read the new truth back from getState()
 * rather than trusting a return value that could drift from what actually rendered -- the exact
 * "screenshot proves it, a return value does not" discipline this repo already applies everywhere
 * else (AGENTS.md: visual claims come from the running game).
 */
import { HERO_URL } from '../character/hero.js';

export function installStudioApi(studioScene) {
  const STUDIO_VERSION = 'galaquest-character-studio/1';
  let currentView = { scale: 'inspection', bearing: 'three-quarter' };

  const api = {
    version: STUDIO_VERSION,

    loadCharacter(name) {
      if (name !== 'hero') throw new Error(`loadCharacter: only "hero" is supported in SR2/SR3, got "${name}"`);
      // Already loaded at boot (createStudioScene) -- SR2/SR3 scope is one character, always
      // present, per the brief. Accepted as a no-op rather than rejected so a caller that always
      // calls loadCharacter('hero') first (matching the eventual multi-character API) does not have
      // to special-case this phase.
    },

    setAnimation(clipName) {
      studioScene.setAnimation(clipName);
    },

    setAnimationTime(seconds) {
      studioScene.setAnimationTime(seconds);
    },

    setAnimationPlaying(playing) {
      studioScene.setAnimationPlaying(playing);
    },

    setView(scale, bearing) {
      studioScene.frame(scale, bearing);
      currentView = { scale, bearing };
    },

    setViewport(width, height) {
      const canvas = document.querySelector('#studio-canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      studioScene.resize(width, height);
    },

    setLightingMode(mode) {
      studioScene.setLightingMode(mode);
    },

    // SR4 locked comparison primitive -- see scene.js's own header comment. Only the loadout varies;
    // camera/viewport/animation time/lighting/character are whatever the caller already locked via
    // the other methods on this same object.
    setLoadout(name) {
      return studioScene.setLoadout(name);
    },

    // SR5 (owner-plan.md sections 21-23): Grip Inspector, Shield Inspector, Fit Envelope. Every
    // measurement is a number a caller can also see drawn as the matching overlay -- see
    // gearInspectors.js's own header for why the overlay and the JSON never drift apart.
    setOverlay(name) {
      studioScene.setOverlay(name);
    },

    getGripMeasurement() {
      return studioScene.getGripMeasurement();
    },

    getShieldMeasurement() {
      return studioScene.getShieldMeasurement();
    },

    getFitEnvelope(clipNames, samples) {
      return studioScene.getFitEnvelope(clipNames, samples);
    },

    // SR5 closeout: the non-destructive typed tuning override (owner-plan.md). `override` is
    // `{ positionDelta?, rotationDeltaDeg?, scaleDelta? }` or omitted/null to reset `target` back to
    // its pristine shipping mount -- see gearInspectors.js's own header for bounds/composition.
    setTuningOverride(target, override) {
      return studioScene.setTuningOverride(target, override);
    },

    getState() {
      const canvas = document.querySelector('#studio-canvas');
      return {
        studioVersion: STUDIO_VERSION,
        character: 'hero',
        assetPath: HERO_URL,
        clipName: studioScene.currentClipName,
        availableClips: studioScene.clipNames(),
        animationTimeSeconds: studioScene.currentTime,
        playing: studioScene.playing,
        view: currentView,
        // "authoritative" is the load-bearing field a caller must check before treating a capture
        // as an approval-quality shot -- the owner's explicit ruling (2026-08-16): game lighting is the
        // Studio default and acceptance authority, diagnostic lighting must stay separately
        // labelled and non-authoritative. Never inferred from the string alone by a downstream
        // consumer -- stated here directly.
        lightingMode: studioScene.lightingMode,
        lightingAuthoritative: studioScene.lightingMode === 'game',
        viewport: { width: canvas.width, height: canvas.height },
        // SR4 locked comparison primitive: which is which must never be inferred from a filename or
        // left to guessing -- a candidate must never masquerade as shipping (armour-progression-
        // doctrine.md section 5.1). `loadoutIsShipping` is the load-bearing boolean a caller checks.
        loadout: studioScene.loadout,
        loadoutIsShipping: studioScene.loadout === 'shipping',
        // SR5: which inspector overlay (if any) is currently drawn in the scene, so a capture's
        // metadata states what a screenshot shows rather than leaving it to be inferred visually.
        overlay: studioScene.overlay,
      };
    },
  };

  window.__galaQuestStudio = api;
  return api;
}
