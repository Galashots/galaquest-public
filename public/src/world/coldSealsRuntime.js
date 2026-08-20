// public/src/world/coldSealsRuntime.js
//
// G2 runtime glue. The rest of this repo keeps combat rules, scene presentation and input separate;
// this file does the same thing for the small vertical slice between "the Beacon is cold" and the
// later Warden fight. It reads only the already-published runtime surface main.js exposes to tests
// (player pose + authoritative/published swing state), and owns no network state. That makes G2 a
// reversible session beat like gateFound/trail lights; G3 is where shared boss authority begins.

import { ATTACK_REACH, SWING_CONTACT_SECONDS, isWithinStrike } from '../combat/encounter.js';
import { createGlowSprite, setGlowStrength } from '../render/glow.js';
import { WORLD, setLayer } from '../render/layers.js';
import { beaconParts, BEACON_GLOW_COLOR } from './oldBeacon.js';
import { OLD_BEACON } from './zones/village.js';
import {
  COLD_SEAL_COUNT,
  buildColdSeals,
  coldSealsBroken,
  noColdSealsBroken,
  strikeColdSeals,
} from './coldSeals.js';

export const COLD_SEAL_EXTRA_REACH_METERS = 0.36;
export const COLD_SEAL_OBJECTIVE_DONE = '⚠️ Stay sharp — something answered';

export function coldSealObjective(brokenCount, total = COLD_SEAL_COUNT) {
  const remaining = Math.max(0, total - brokenCount);
  if (remaining === 0) return COLD_SEAL_OBJECTIVE_DONE;
  if (remaining === 1) return '❄️ Break the last Cold Seal';
  return `❄️ Break ${remaining} Cold Seals`;
}

function createBeaconAnswerGlow(scene) {
  const cressetY = beaconParts().cressetAt[1];
  const glow = createGlowSprite(BEACON_GLOW_COLOR, 2.25, 'shock');
  glow.name = 'beacon-cold-seal-response';
  setLayer(glow, WORLD);
  glow.position.set(OLD_BEACON.at[0], cressetY, OLD_BEACON.at[1]);
  setGlowStrength(glow, 0);
  scene.add(glow);

  let seconds = -1;
  let strength = 0;
  return {
    react(brokenCount) {
      seconds = 0;
      // Each lock makes the tower answer harder. Still cold-cyan: this is escalation, not victory.
      strength = Math.min(1, 0.42 + brokenCount * 0.17);
      setGlowStrength(glow, strength);
      glow.scale.setScalar(2.25);
    },
    update(deltaSeconds, reducedMotion) {
      if (seconds < 0) return;
      seconds += deltaSeconds;
      if (reducedMotion) {
        seconds = -1;
        setGlowStrength(glow, 0);
        return;
      }
      const t = Math.min(1, seconds / 0.82);
      const ring = Math.sin(Math.PI * t);
      glow.scale.setScalar(2.25 * (1 + ring * 1.5));
      setGlowStrength(glow, strength * (1 - t));
      if (t >= 1) seconds = -1;
    },
  };
}

function createSealHud() {
  const game = document.querySelector('#game');
  const objective = document.querySelector('#quest-objective');
  if (!game || !objective) return { paint() {}, announce() {}, observe() {} };

  const strip = document.createElement('div');
  strip.id = 'cold-seal-progress';
  strip.setAttribute('aria-hidden', 'true');
  strip.style.cssText = [
    'position:absolute', 'left:50%', 'top:4.35rem', 'transform:translateX(-50%)',
    'display:flex', 'gap:.38rem', 'padding:.32rem .55rem', 'border-radius:999px',
    'background:rgb(12 20 31 / 76%)', 'border:1px solid rgb(169 232 255 / 32%)',
    'box-shadow:0 0 1.2rem rgb(110 202 235 / 12%)', 'pointer-events:none',
    'opacity:0', 'transition:opacity 160ms ease-out', 'z-index:8',
  ].join(';');
  const pips = [];
  for (let i = 0; i < COLD_SEAL_COUNT; i += 1) {
    const pip = document.createElement('span');
    pip.textContent = '◆';
    pip.style.cssText = [
      'font:800 1rem/1 system-ui,sans-serif', 'color:#a9e8ff',
      'text-shadow:0 0 .6rem rgb(169 232 255 / 90%)',
      'transition:transform 180ms ease-out,opacity 180ms ease-out,filter 180ms ease-out',
    ].join(';');
    strip.appendChild(pip);
    pips.push(pip);
  }
  game.appendChild(strip);

  const toast = document.createElement('div');
  toast.id = 'cold-seal-toast';
  toast.style.cssText = [
    'position:absolute', 'left:50%', 'top:7.1rem', 'transform:translate(-50%,-8px) scale(.96)',
    'padding:.62rem .9rem', 'border-radius:.6rem', 'white-space:nowrap',
    'background:linear-gradient(180deg,rgb(32 52 70 / 94%),rgb(12 22 34 / 94%))',
    'border:1px solid rgb(169 232 255 / 52%)', 'box-shadow:0 0 1.4rem rgb(93 194 233 / 28%)',
    'color:#e8f8ff', 'font:900 .86rem/1 system-ui,sans-serif', 'letter-spacing:.08em',
    'pointer-events:none', 'opacity:0', 'transition:opacity 130ms ease-out,transform 180ms ease-out',
    'z-index:9',
  ].join(';');
  game.appendChild(toast);
  let toastTimer = 0;

  function paint(brokenCount, active) {
    strip.style.opacity = active ? '1' : '0';
    for (let i = 0; i < pips.length; i += 1) {
      const broken = i < brokenCount;
      pips[i].style.opacity = broken ? '.18' : '1';
      pips[i].style.filter = broken ? 'grayscale(1)' : 'none';
      pips[i].style.transform = broken ? 'scale(.72) rotate(45deg)' : 'scale(1)';
    }
  }

  function announce(text, final = false) {
    clearTimeout(toastTimer);
    toast.textContent = text;
    toast.style.borderColor = final ? 'rgb(203 231 255 / 72%)' : 'rgb(169 232 255 / 52%)';
    toast.style.opacity = '1';
    toast.style.transform = 'translate(-50%,0) scale(1)';
    toastTimer = window.setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translate(-50%,-8px) scale(.96)';
    }, final ? 2200 : 1300);
  }

  // main.js quite correctly owns the ordinary quest chip and repaints it every frame. G2 is kept
  // isolated in this module so the big orchestration file does not absorb another one-off branch;
  // a MutationObserver changes ONLY the post-arrival Beacon line, immediately after main paints it.
  // Nothing before beaconFound is touched, and disconnecting this module returns the old G1 ending.
  function observe(readState) {
    let painting = false;
    const repaint = () => {
      if (painting) return;
      const state = readState();
      if (!state.active) return;
      const wanted = coldSealObjective(state.brokenCount);
      if (objective.textContent === wanted) return;
      painting = true;
      objective.textContent = wanted;
      objective.dataset.shown = 'true';
      painting = false;
    };
    const observer = new MutationObserver(repaint);
    observer.observe(objective, { childList: true, subtree: true, characterData: true });
    repaint();
  }

  return { paint, announce, observe };
}

function runtimeHeroSwing(runtime) {
  const local = runtime.encounterState?.()?.hero?.swingSeconds;
  if (Number.isFinite(local)) return local;
  const published = runtime.netState?.()?.serverSelf?.swingSeconds;
  return Number.isFinite(published) ? published : -1;
}

function waitForRuntime() {
  return new Promise((resolve) => {
    const look = () => {
      const runtime = window.__galaQuestRuntime;
      const trail = runtime?.zoneTrailState?.();
      if (runtime?.scene && runtime?.player && trail?.beaconBuilt === true) resolve(runtime);
      else requestAnimationFrame(look);
    };
    look();
  });
}

/** Install once. Imported from world/quest.js only in a browser; node tests keep quest.js pure. */
export async function installColdSealsRuntime() {
  if (typeof window === 'undefined' || window.__gqColdSealsInstalled === true) return;
  window.__gqColdSealsInstalled = true;
  const runtime = await waitForRuntime();
  const presenter = buildColdSeals(runtime.scene, OLD_BEACON);
  const answer = createBeaconAnswerGlow(runtime.scene);
  const hud = createSealHud();
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  let broken = noColdSealsBroken(presenter.count);
  let previousSwing = -1;
  let previousSeconds = performance.now() / 1000;

  const read = () => {
    const trail = runtime.zoneTrailState?.() ?? {};
    const brokenCount = coldSealsBroken(broken);
    return {
      active: trail.beaconFound === true,
      total: presenter.count,
      broken: [...broken],
      brokenCount,
      remaining: presenter.count - brokenCount,
      complete: brokenCount === presenter.count,
      visualBrokenCount: presenter.visualBrokenCount(),
      specs: presenter.specs.map((spec) => ({ id: spec.id, at: [...spec.at] })),
    };
  };
  runtime.coldSealsState = read;
  hud.observe(read);

  function frame(nowMs) {
    const now = nowMs / 1000;
    const deltaSeconds = Math.min(0.1, Math.max(0, now - previousSeconds));
    previousSeconds = now;

    const trail = runtime.zoneTrailState?.() ?? {};
    const swingNow = runtimeHeroSwing(runtime);
    const bladeLanded = previousSwing >= 0 && previousSwing < SWING_CONTACT_SECONDS
      && swingNow >= SWING_CONTACT_SECONDS;
    previousSwing = swingNow;

    if (bladeLanded && trail.beaconFound === true && coldSealsBroken(broken) < presenter.count) {
      const strike = strikeColdSeals(broken, presenter.specs, (seal) => isWithinStrike(
        { x: runtime.player.position.x, z: runtime.player.position.z },
        runtime.player.heading,
        { x: seal.at[0], z: seal.at[1] },
        ATTACK_REACH + COLD_SEAL_EXTRA_REACH_METERS,
      ));
      if (strike.struck.length > 0) {
        broken = strike.broken;
        const index = strike.struck[0];
        presenter.break(index);
        const count = coldSealsBroken(broken);
        answer.react(count);
        if (count === presenter.count) hud.announce('SOMETHING ANSWERED', true);
        else hud.announce(`COLD SEAL SHATTERED  ${count} / ${presenter.count}`);
      }
    }

    presenter.update(reducedMotion ? COLD_SEAL_BREAK_SECONDS : deltaSeconds);
    answer.update(deltaSeconds, reducedMotion);
    const state = read();
    hud.paint(state.brokenCount, state.active && !state.complete);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
