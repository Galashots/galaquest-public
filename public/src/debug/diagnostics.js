export const FRAME_BUDGET_MS = 16.7;

export function createFrameSampler(capacity = 40) {
  const costs = [];

  return {
    record(costMs) {
      costs.push(costMs);
      if (costs.length > capacity) costs.shift();
    },
    stats() {
      if (costs.length === 0) {
        return { count: 0, meanMs: 0, p90Ms: 0, worstMs: 0, overBudget: 0 };
      }
      const sorted = [...costs].sort((a, b) => a - b);
      const p90Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1);
      const meanMs = costs.reduce((total, cost) => total + cost, 0) / costs.length;
      return {
        count: costs.length,
        meanMs,
        p90Ms: sorted[p90Index],
        worstMs: sorted[sorted.length - 1],
        overBudget: costs.filter((cost) => cost > FRAME_BUDGET_MS).length,
      };
    },
    reset() {
      costs.length = 0;
    },
  };
}

function gpuString(renderer) {
  const gl = renderer.getContext();
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  return debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER) || 'unknown GPU';
}

export function createDiagnostics(renderer, element) {
  const sampler = createFrameSampler();
  const gpu = gpuString(renderer);

  function read() {
    const stats = sampler.stats();
    const canvas = renderer.domElement;
    return {
      cssResolution: `${canvas.clientWidth}×${canvas.clientHeight}`,
      devicePixelRatio: window.devicePixelRatio || 1,
      drawCalls: renderer.info.render.calls,
      frameBudgetMs: FRAME_BUDGET_MS,
      gpu,
      ...stats,
    };
  }

  function update(loading = null, quality = 'high') {
    const values = read();
    const state = loading ? `loading ${loading}…` : 'ready';
    const frame = values.count === 0
      ? 'frame cost — ms/frame of 16.7 (warming)'
      : `frame cost ${values.meanMs.toFixed(2)} ms/frame of ${values.frameBudgetMs.toFixed(1)} (p90 ${values.p90Ms.toFixed(2)})`;
    element.textContent = [
      state,
      `quality ${quality}`,
      `GPU ${values.gpu}`,
      `CSS ${values.cssResolution} · DPR ${values.devicePixelRatio.toFixed(2)}`,
      frame,
      `draw calls ${values.drawCalls}`,
    ].join('\n');
  }

  return {
    recordFrame(costMs) {
      sampler.record(costMs);
    },
    read,
    update,
    sampler,
  };
}
