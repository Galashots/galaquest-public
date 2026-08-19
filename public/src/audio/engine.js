// The thin Web Audio adapter (Phase C ruling 2): owns the AudioContext, unlock() on a user gesture,
// play(recipeName), and audioDebug() for runtime observability (ruling 6). Turns recipes.js's PURE
// data into actual sound. Unlike recipes.js, this file is never imported by a node test for its
// Web Audio behaviour directly -- audio-engine.test.mjs drives it through an INJECTED context
// factory instead, which is exactly what makes that possible without a browser.
//
// The one rule everything here bends around: NEVER throw. A missing AudioContext, a construction
// failure, a suspended context, an unknown recipe name -- every one of those degrades to silence
// rather than breaking the frame loop that calls play(). A silent fight is a smaller failure than a
// frozen one (the same principle combat/feedback.js states for its own defensive branch).

import { RECIPES } from './recipes.js';

// Real default: window.AudioContext (Safari/older WebKit: webkitAudioContext). Referencing `window`
// only happens when this function actually RUNS (i.e. inside unlock(), guarded by its own
// try/catch) -- not at module load, so importing this file under plain node (no `window` at all,
// as in this repo's tests) never throws.
function defaultCreateContext() {
  return new (window.AudioContext ?? window.webkitAudioContext)();
}

// A short burst of white noise as an AudioBuffer -- ctx.createBufferSource() plays a buffer, it
// does not synthesize noise itself the way createOscillator() synthesizes a tone, so a buffer of
// random samples is the noise recipe steps' actual sound source.
function createNoiseBuffer(context, durationSeconds) {
  const sampleRate = context.sampleRate ?? 44100;
  const length = Math.max(1, Math.round(sampleRate * durationSeconds));
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

// One step's gain envelope: silent, ramp up to gainPeak, ramp back to silent -- applied identically
// to tone and noise steps since both are just "a node with a gain envelope" once scheduled. A quick
// 10% attack keeps the ramp itself inaudible as a click while still reaching gainPeak well inside
// even the shortest (0.05s) recipe step.
function scheduleEnvelope(gainNode, startTime, durationSeconds, gainPeak) {
  const attackTime = startTime + durationSeconds * 0.1;
  const endTime = startTime + durationSeconds;
  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(gainPeak, attackTime);
  gainNode.gain.linearRampToValueAtTime(0, endTime);
}

function scheduleTone(context, now, step) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const startTime = now + step.startSeconds;
  const endTime = startTime + step.durationSeconds;
  oscillator.frequency.setValueAtTime(step.frequencyStart, startTime);
  oscillator.frequency.linearRampToValueAtTime(step.frequencyEnd, endTime);
  scheduleEnvelope(gain, startTime, step.durationSeconds, step.gainPeak);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(startTime);
  oscillator.stop(endTime);
}

function scheduleNoise(context, now, step) {
  const source = context.createBufferSource();
  const gain = context.createGain();
  const startTime = now + step.startSeconds;
  source.buffer = createNoiseBuffer(context, step.durationSeconds);
  scheduleEnvelope(gain, startTime, step.durationSeconds, step.gainPeak);
  source.connect(gain).connect(context.destination);
  source.start(startTime);
}

/**
 * Build the audio engine. `createContext` is injectable (test seam) and defaults to a real
 * AudioContext factory. Construction itself never touches the factory -- the context is only ever
 * created lazily, inside unlock(), on the user gesture the design rulings require.
 */
export function createAudioEngine({ createContext = defaultCreateContext } = {}) {
  let context = null;
  const triggered = {};

  function contextState() {
    if (!context) return 'none';
    return context.state === 'running' ? 'running' : 'suspended';
  }

  // Creates the context once, ever -- repeated calls (every pointerdown after the first) resume an
  // already-suspended context rather than constructing a second one. Never throws: a factory that
  // throws or returns null/undefined just leaves `context` null, so contextState() stays 'none' and
  // every play() after it stays a silent no-op.
  function unlock() {
    try {
      if (!context) {
        const created = createContext();
        if (!created) return;
        context = created;
      }
      // Already running: nothing to do, and resume() is not free -- skip it so repeat gestures
      // after a successful unlock (main.js keeps listening until it sees 'running') are cheap.
      if (context.state === 'running') return;
      // resume() is Promise-based and can reject asynchronously, which the try/catch below cannot
      // catch (it only covers synchronous throws) -- swallow it here so a blocked resume() never
      // surfaces as an unhandled rejection. The caller retries on the next gesture regardless.
      context.resume?.()?.catch(() => {});
    } catch {
      // Construction or resume failed -- stay silent rather than propagate. `context` may be left
      // set to a partially-unusable object here only if resume() threw AFTER creation succeeded;
      // play() below is wrapped in its own try/catch for exactly that case.
    }
  }

  // Schedules recipeName's steps against the unlocked context. Never throws: no context (not yet
  // unlocked, or unlock() failed) and an unrecognised recipe name are both silent no-ops, and any
  // failure partway through scheduling is caught whole -- a half-scheduled sound is not counted as
  // triggered, since triggered records sounds that actually made it onto the context.
  function play(recipeName) {
    if (!context) return;
    const steps = RECIPES[recipeName];
    if (!steps) return;
    try {
      const now = context.currentTime ?? 0;
      for (const step of steps) {
        if (step.type === 'tone') scheduleTone(context, now, step);
        else if (step.type === 'noise') scheduleNoise(context, now, step);
      }
      triggered[recipeName] = (triggered[recipeName] ?? 0) + 1;
    } catch {
      // Degrade to silence -- see the file-level comment. Nothing already scheduled on the context
      // is rolled back (Web Audio has no such facility), but the count is not incremented for a
      // step sequence that did not fully schedule.
    }
  }

  function audioDebug() {
    return { contextState: contextState(), triggered: { ...triggered } };
  }

  return { unlock, play, audioDebug };
}
