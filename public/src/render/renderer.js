import * as THREE from '../../vendor/three.module.min.js';

export const MAX_FPS = 60;

// A vsync arrives one interval after the last one, give or take floating-point noise, so comparing
// against the interval exactly makes the limiter reject frames it meant to keep. Measured on the
// unslacked version: at a true 60Hz it rendered 398 of 600 vsyncs (~40fps), and on a 120Hz ProMotion
// panel 204 of 600 (~41fps) -- the 60fps *cap* was costing a third of the frames on both. One
// millisecond of slack is smaller than any real vsync interval, so it cannot let an extra frame
// through at 120Hz, and it comfortably absorbs the jitter at 60Hz.
export const FRAME_SLACK_MS = 1;

export function createFrameLimiter(maxFps = MAX_FPS) {
  const frameInterval = 1000 / maxFps;
  let lastFrameAt = -Infinity;

  return {
    shouldRender(timestamp) {
      if (timestamp - lastFrameAt < frameInterval - FRAME_SLACK_MS) return false;
      lastFrameAt = timestamp;
      return true;
    },
    reset() {
      lastFrameAt = -Infinity;
    },
    intervalMs: frameInterval,
  };
}

export function createRenderer(canvas, hooks = {}) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    canvas,
    powerPreference: 'high-performance',
  });
  const frameLimiter = createFrameLimiter();
  let contextLost = false;
  let width = 1;
  let height = 1;

  function setResolutionScale(scale = 1) {
    const devicePixelRatio = window.devicePixelRatio || 1;
    renderer.setPixelRatio(Math.min(devicePixelRatio * scale, 2));
  }

  function resize(nextWidth = window.innerWidth, nextHeight = window.innerHeight) {
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    renderer.setSize(width, height, false);
  }

  const onContextLost = (event) => {
    event.preventDefault();
    contextLost = true;
    hooks.onContextLost?.();
  };
  const onContextRestored = () => {
    contextLost = false;
    setResolutionScale();
    resize(width, height);
    frameLimiter.reset();
    hooks.onContextRestored?.();
  };

  canvas.addEventListener('webglcontextlost', onContextLost, false);
  canvas.addEventListener('webglcontextrestored', onContextRestored, false);
  setResolutionScale();

  return {
    renderer,
    frameLimiter,
    resize,
    setResolutionScale,
    get contextLost() {
      return contextLost;
    },
    get size() {
      return { width, height };
    },
  };
}
