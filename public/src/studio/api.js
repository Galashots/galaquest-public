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
import { loadoutDescriptor } from './loadoutDescriptors.js';

export function installStudioApi(studioScene) {
  const STUDIO_VERSION = 'galaquest-character-studio/1';
  let currentView = { scale: 'inspection', bearing: 'three-quarter' };

  // A1: every mutating method notifies when it lands, so studio.html's controls re-read getState()
  // and can never go stale relative to what actually rendered -- the same defect class the lighting
  // label already guards against (a worker driving this API bypasses every click handler; before
  // this, a worker's setLoadout('candidate-wildwood-blade') left the on-screen menu claiming
  // "shipping", which is exactly the candidate-masquerading-as-shipping outcome doctrine 5.1 bans).
  // Caught by looking at the review-studio.mjs captures, not assumed safe.
  const stateListeners = new Set();
  function notifyStateChange() {
    for (const listener of stateListeners) listener();
  }

  const api = {
    version: STUDIO_VERSION,

    /** UI-sync hook (not part of the Sol protocol surface): fires after any state-changing method
     *  completes. Listeners read the new truth from getState() -- nothing is passed. */
    onStateChange(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },

    loadCharacter(name) {
      if (name !== 'hero') throw new Error(`loadCharacter: only "hero" is supported in SR2/SR3, got "${name}"`);
      // Already loaded at boot (createStudioScene) -- SR2/SR3 scope is one character, always
      // present, per the brief. Accepted as a no-op rather than rejected so a caller that always
      // calls loadCharacter('hero') first (matching the eventual multi-character API) does not have
      // to special-case this phase.
    },

    setAnimation(clipName) {
      studioScene.setAnimation(clipName);
      notifyStateChange();
    },

    setAnimationTime(seconds) {
      studioScene.setAnimationTime(seconds);
      notifyStateChange();
    },

    setAnimationPlaying(playing) {
      studioScene.setAnimationPlaying(playing);
      notifyStateChange();
    },

    setView(scale, bearing) {
      studioScene.frame(scale, bearing);
      currentView = { scale, bearing };
      notifyStateChange();
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
      notifyStateChange();
    },

    // SR4 locked comparison primitive -- see scene.js's own header comment. Only the loadout varies;
    // camera/viewport/animation time/lighting/character are whatever the caller already locked via
    // the other methods on this same object.
    setLoadout(name) {
      // Async (a first selection may still be downloading its GLB): notify only when the switch has
      // actually LANDED, so a listener reading getState() sees the new loadout's real gear anchors
      // rather than a half-applied state. A rejected switch notifies nothing -- state did not move.
      const applied = Promise.resolve(studioScene.setLoadout(name));
      applied.then(notifyStateChange, () => {});
      return applied;
    },

    // SR5 (owner-plan.md sections 21-23): Grip Inspector, Shield Inspector, Fit Envelope. Every
    // measurement is a number a caller can also see drawn as the matching overlay -- see
    // gearInspectors.js's own header for why the overlay and the JSON never drift apart.
    setOverlay(name) {
      studioScene.setOverlay(name);
      notifyStateChange();
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
      // A1: the semantic half of "what is actually being reviewed". `descriptor` is the loadout's
      // declared meaning (loadoutDescriptors.js); `gear` is the LIVE scene-graph truth (which
      // anchors exist and are visible right now, scene.js's gearVisibility). Published separately
      // on purpose: a consumer that compares them can catch the scene disagreeing with the
      // vocabulary, which a single merged field would hide.
      const descriptor = loadoutDescriptor(studioScene.loadout);
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
        // A1 semantic review state (see the comment above): stable identifiers for the next task's
        // Owner Fit and for capture metadata -- never file paths, never label text.
        loadoutLabel: descriptor?.label ?? null,
        loadoutClassification: descriptor?.classification ?? null,
        reviewTarget: descriptor?.reviewTarget ?? null,
        gear: studioScene.gearVisibility(),
        // SR5: which inspector overlay (if any) is currently drawn in the scene, so a capture's
        // metadata states what a screenshot shows rather than leaving it to be inferred visually.
        overlay: studioScene.overlay,
      };
    },
  };

  window.__galaQuestStudio = api;
  return api;
}
