// Tiny generated-tone WebAudio "blip" system. No audio files. The
// AudioContext is created lazily and resumed on the very first tap, which is
// required for sound to play at all on iOS Safari.

let ctx = null;
let muted = false;

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = value;
}

export function toggleMuted() {
  muted = !muted;
  return muted;
}

/** Call this from the first pointerdown/touchstart handler in the app. */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function blip({ freq = 440, duration = 0.12, type = 'sine', gain = 0.18, slideTo = null }) {
  if (muted || !ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration + 0.02);
}

function chord(freqs, opts) {
  freqs.forEach((freq, i) => setTimeout(() => blip({ ...opts, freq }), i * 60));
}

export const sfx = {
  tap: () => blip({ freq: 520, duration: 0.06, type: 'square', gain: 0.1 }),
  plant: () => blip({ freq: 300, duration: 0.16, type: 'triangle', gain: 0.15, slideTo: 500 }),
  harvest: () => blip({ freq: 700, duration: 0.14, type: 'sine', gain: 0.16, slideTo: 900 }),
  coin: () => chord([880, 1180], { duration: 0.14, type: 'square', gain: 0.12 }),
  crack: () => blip({ freq: 200, duration: 0.1, type: 'sawtooth', gain: 0.14, slideTo: 120 }),
  hatch: () => chord([440, 660, 880, 1100], { duration: 0.22, type: 'sine', gain: 0.18 }),
  equip: () => chord([520, 780], { duration: 0.16, type: 'triangle', gain: 0.15 }),
  denied: () => blip({ freq: 180, duration: 0.15, type: 'square', gain: 0.12, slideTo: 140 }),
  open: () => blip({ freq: 400, duration: 0.1, type: 'sine', gain: 0.12, slideTo: 550 }),
};
