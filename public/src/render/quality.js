export const QUALITY_WINDOW_FRAMES = 120;
export const BAD_WINDOW_LIMIT = 2;
export const GOOD_WINDOW_LIMIT = 4;
export const BAD_P90_MS = 16.7;
export const GOOD_P90_MS = 12.0;

// Frame *cost* is only half the picture, and it is the half that flatters a struggling device. A
// GPU-bound iPad -- the likely way this game dies -- spends its time outside JS, so cost stays tiny
// while rendered frames arrive further and further apart. This project has already shipped exactly
// that shape of bug: a 60fps cap presenting ~40fps while the HUD reported 0.32ms mean cost. So a
// window is also bad when too many gaps between rendered frames are too long.
//
// Must match the renderer's cap, or the ladder polices a frame rate the renderer is not targeting;
// quality.test.mjs pins it against renderer.js's MAX_FPS rather than restating the number here.
export const TARGET_FRAME_INTERVAL_MS = 1000 / 60;
// 1.6x, not 2x: a frame that lands 1.6 intervals late has already missed its vsync, and waiting for
// a clean doubling would miss the jittery-but-late case entirely. At 60fps this is 26.7ms.
export const MISSED_FRAME_DELTA_FACTOR = 1.6;
// Exclusive: 5% of a 120-frame window is 6 frames, and 6 is tolerated. More than that is not.
export const MISSED_FRAME_FRACTION_LIMIT = 0.05;

export const QUALITY_LEVELS = [
  { name: 'high', resolutionScale: 1 },
  { name: 'medium', resolutionScale: 0.8 },
  { name: 'low', resolutionScale: 0.65 },
];

function p90(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)];
}

export function createQualityLadder(options = {}) {
  const levels = options.levels ?? QUALITY_LEVELS;
  const windowSize = options.windowSize ?? QUALITY_WINDOW_FRAMES;
  const badWindowLimit = options.badWindowLimit ?? BAD_WINDOW_LIMIT;
  const goodWindowLimit = options.goodWindowLimit ?? GOOD_WINDOW_LIMIT;
  const badP90Ms = options.badP90Ms ?? BAD_P90_MS;
  const goodP90Ms = options.goodP90Ms ?? GOOD_P90_MS;
  const onLevelChange = options.onLevelChange ?? (() => {});
  const frameIntervalMs = options.frameIntervalMs ?? TARGET_FRAME_INTERVAL_MS;
  const missedDeltaMs = frameIntervalMs * (options.missedDeltaFactor ?? MISSED_FRAME_DELTA_FACTOR);
  const missedFractionLimit = options.missedFractionLimit ?? MISSED_FRAME_FRACTION_LIMIT;
  const costs = [];
  let longGaps = 0;
  let measuredGaps = 0;
  let levelIndex = 0;
  let consecutiveBadWindows = 0;
  let consecutiveGoodWindows = 0;

  function finishWindow() {
    const windowP90Ms = p90(costs);
    // Fraction of the gaps we could actually measure, not of the frame count: the first frame of a
    // session has no predecessor, so counting it as on-time would quietly dilute the very first
    // window's misses.
    const missedFraction = measuredGaps === 0 ? 0 : longGaps / measuredGaps;
    costs.length = 0;
    longGaps = 0;
    measuredGaps = 0;
    const bad = windowP90Ms > badP90Ms || missedFraction > missedFractionLimit;
    // Missed frames block stepping up as well as forcing a step down. Otherwise a GPU-bound device
    // with cheap JS would satisfy the "sustained headroom" rule and climb straight back into the
    // stutter it just escaped. Deliberate, and not specified either way by the brief.
    const good = windowP90Ms < goodP90Ms && missedFraction <= missedFractionLimit;
    consecutiveBadWindows = bad ? consecutiveBadWindows + 1 : 0;
    consecutiveGoodWindows = good ? consecutiveGoodWindows + 1 : 0;

    let transition = null;
    if (consecutiveBadWindows >= badWindowLimit && levelIndex < levels.length - 1) {
      levelIndex += 1;
      consecutiveBadWindows = 0;
      consecutiveGoodWindows = 0;
      transition = 'down';
    } else if (consecutiveGoodWindows >= goodWindowLimit && levelIndex > 0) {
      levelIndex -= 1;
      consecutiveGoodWindows = 0;
      consecutiveBadWindows = 0;
      transition = 'up';
    }

    const result = {
      bad,
      good,
      missedFraction,
      p90Ms: windowP90Ms,
      transition,
      level: levels[levelIndex],
      levelIndex,
    };
    if (transition) onLevelChange(result);
    return result;
  }

  return {
    // `deltaMs` is the wall-clock gap since the previous *rendered* frame. Omit it and the frame is
    // treated as on-time, which keeps callers that only have a cost working unchanged.
    recordFrame(costMs, deltaMs) {
      costs.push(costMs);
      if (Number.isFinite(deltaMs) && deltaMs > 0) {
        measuredGaps += 1;
        if (deltaMs > missedDeltaMs) longGaps += 1;
      }
      return costs.length === windowSize ? finishWindow() : null;
    },
    // `deltas` may be a single number applied to every frame, or a per-frame array.
    recordWindow(windowCosts, deltas) {
      let result = null;
      for (const [index, cost] of windowCosts.entries()) {
        const delta = Array.isArray(deltas) ? deltas[index] : deltas;
        result = this.recordFrame(cost, delta);
      }
      return result;
    },
    get level() {
      return levels[levelIndex];
    },
    // longGaps/measuredGaps are the in-progress window, so a harness can read the live miss rate
    // without waiting 120 frames for a window to close.
    get state() {
      return {
        consecutiveBadWindows,
        consecutiveGoodWindows,
        levelIndex,
        longGaps,
        measuredGaps,
        missedDeltaMs,
      };
    },
  };
}
