import {
  REVIEW_TYPES,
  buildReviewPacket,
  chatHandoffText,
  reviewPacketFilename,
} from './reviewPacket.js';

const REPOSITORY = 'Galashots/galaquest-public';
const DRAW_TOOLS = new Set(['pen', 'circle', 'arrow']);
const STROKE = '#ffd45c';

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function pointerPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp01((event.clientX - rect.left) / Math.max(1, rect.width)),
    y: clamp01((event.clientY - rect.top) / Math.max(1, rect.height)),
  };
}

function pointPx(point, width, height) {
  return [point.x * width, point.y * height];
}

function drawArrowHead(ctx, from, to) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const size = 12;
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - Math.cos(angle - Math.PI / 6) * size, to[1] - Math.sin(angle - Math.PI / 6) * size);
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - Math.cos(angle + Math.PI / 6) * size, to[1] - Math.sin(angle + Math.PI / 6) * size);
  ctx.stroke();
}

export function drawAnnotation(ctx, annotation, width, height) {
  ctx.save();
  ctx.strokeStyle = STROKE;
  ctx.fillStyle = STROKE;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgb(0 0 0 / 70%)';
  ctx.shadowBlur = 3;

  if (annotation.tool === 'pen' && annotation.points?.length) {
    const [first, ...rest] = annotation.points;
    const start = pointPx(first, width, height);
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    for (const point of rest) {
      const next = pointPx(point, width, height);
      ctx.lineTo(next[0], next[1]);
    }
    ctx.stroke();
  } else if (annotation.tool === 'circle' && annotation.start && annotation.end) {
    const start = pointPx(annotation.start, width, height);
    const end = pointPx(annotation.end, width, height);
    const cx = (start[0] + end[0]) / 2;
    const cy = (start[1] + end[1]) / 2;
    const rx = Math.max(2, Math.abs(end[0] - start[0]) / 2);
    const ry = Math.max(2, Math.abs(end[1] - start[1]) / 2);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (annotation.tool === 'arrow' && annotation.start && annotation.end) {
    const start = pointPx(annotation.start, width, height);
    const end = pointPx(annotation.end, width, height);
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.lineTo(end[0], end[1]);
    ctx.stroke();
    drawArrowHead(ctx, start, end);
  }
  ctx.restore();
}

async function imageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('could not decode Studio capture'));
    image.src = dataUrl;
  });
}

async function composeAnnotatedImage(baseDataUrl, annotationCanvas, width, height) {
  const image = await imageFromDataUrl(baseDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, width, height);
  ctx.drawImage(annotationCanvas, 0, 0, annotationCanvas.width, annotationCanvas.height, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

function downloadJson(packet) {
  const blob = new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = reviewPacketFilename(packet);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function sourceFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref') || 'main';
  const querySha = params.get('sourceSha');
  return {
    repository: REPOSITORY,
    ref,
    sha: /^[0-9a-f]{40}$/i.test(querySha ?? '') ? querySha.toLowerCase() : null,
    studioUrl: window.location.href,
  };
}

async function resolveSource(source) {
  if (source.sha) return source;
  try {
    const response = await fetch(`https://api.github.com/repos/${source.repository}/commits/${encodeURIComponent(source.ref)}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`GitHub ${response.status}`);
    const payload = await response.json();
    if (!/^[0-9a-f]{40}$/i.test(payload.sha ?? '')) throw new Error('GitHub returned no commit SHA');
    return { ...source, sha: payload.sha.toLowerCase() };
  } catch (error) {
    console.warn('[studio-review] source SHA could not be resolved; packet remains ref-bound', error);
    return source;
  }
}

async function captureStudioFrameDataUrl(studioCanvas) {
  // scene.js registers its render-loop callback before Review Mode can be opened. Registering this
  // callback later means the next frame renders first, then we copy the WebGL buffer before the
  // browser composites/clears it (the renderer does not use preserveDrawingBuffer).
  await new Promise((resolve) => requestAnimationFrame(resolve));
  return studioCanvas.toDataURL('image/png');
}

function reviewContextSignature(state) {
  return JSON.stringify({
    loadout: state.loadout,
    clipName: state.clipName,
    animationTimeSeconds: state.animationTimeSeconds,
    view: state.view,
    lightingMode: state.lightingMode,
    overlay: state.overlay,
    viewport: state.viewport,
  });
}

export function installReviewAnnotations({ api, studioCanvas }) {
  const overlay = document.querySelector('#annotation-canvas');
  const reviewPanel = document.querySelector('#review-panel');
  const openButton = document.querySelector('#review-open');
  const closeButton = document.querySelector('#review-close');
  const typeSelect = document.querySelector('#review-type');
  const titleInput = document.querySelector('#review-title');
  const noteInput = document.querySelector('#review-note');
  const reviewStatus = document.querySelector('#review-status');
  const sourceLink = document.querySelector('#review-source-link');
  const exportButton = document.querySelector('#review-export');
  const undoButton = document.querySelector('#review-undo');
  const clearButton = document.querySelector('#review-clear');
  const toolButtons = [...document.querySelectorAll('[data-review-tool]')];

  for (const { id, label } of REVIEW_TYPES) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    typeSelect.appendChild(option);
  }
  typeSelect.value = 'fit-rule';

  let active = false;
  let tool = 'circle';
  let annotations = [];
  let draft = null;
  let drawingPointer = null;
  let source = sourceFromQuery();
  let sourceResolvePromise = null;
  let lastPacket = null;
  let frozenState = null;
  let contextInvalid = false;
  let annotationContextSignature = null;

  function sourceLabel() {
    return source.sha ? `${source.ref} @ ${source.sha.slice(0, 10)}` : `${source.ref} @ unbound`;
  }

  function refreshSourceLink() {
    sourceLink.textContent = sourceLabel();
    sourceLink.href = source.sha
      ? `https://github.com/${source.repository}/commit/${source.sha}`
      : `https://github.com/${source.repository}/tree/${encodeURIComponent(source.ref)}`;
  }
  refreshSourceLink();

  async function ensureSource() {
    if (source.sha) return source;
    sourceResolvePromise ??= resolveSource(source).then((resolved) => {
      source = resolved;
      refreshSourceLink();
      return resolved;
    });
    return sourceResolvePromise;
  }

  const ctx = overlay.getContext('2d');
  let cssWidth = 1;
  let cssHeight = 1;
  let dpr = 1;

  function resizeOverlay() {
    const rect = studioCanvas.getBoundingClientRect();
    cssWidth = Math.max(1, rect.width);
    cssHeight = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    overlay.width = Math.round(cssWidth * dpr);
    overlay.height = Math.round(cssHeight * dpr);
    overlay.style.width = `${cssWidth}px`;
    overlay.style.height = `${cssHeight}px`;
    if (active && frozenState) {
      const viewport = frozenState.viewport ?? {};
      if (studioCanvas.width !== viewport.width || studioCanvas.height !== viewport.height) {
        contextInvalid = true;
        reviewStatus.textContent = 'viewport changed — close and reopen Review Mode before exporting';
      }
    }
    render();
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    for (const annotation of annotations) drawAnnotation(ctx, annotation, cssWidth, cssHeight);
    if (draft) drawAnnotation(ctx, draft, cssWidth, cssHeight);
  }

  function setTool(nextTool) {
    if (!DRAW_TOOLS.has(nextTool)) throw new Error(`unknown annotation tool "${nextTool}"`);
    tool = nextTool;
    for (const button of toolButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.reviewTool === tool));
    }
  }
  setTool(tool);

  function open() {
    if (active) return;
    active = true;
    openButton.disabled = true;
    reviewPanel.hidden = false;
    document.body.classList.add('review-mode');
    api.setAnimationPlaying(false);
    frozenState = structuredClone(api.getState());
    const nextSignature = reviewContextSignature(frozenState);
    const clearedForRebind = Boolean(annotations.length && annotationContextSignature && annotationContextSignature !== nextSignature);
    if (clearedForRebind) {
      annotations = [];
      draft = null;
    }
    annotationContextSignature = nextSignature;
    contextInvalid = false;
    resizeOverlay();
    ensureSource();
    reviewStatus.textContent = clearedForRebind
      ? 'view changed — old marks cleared before this review was re-bound'
      : 'context locked — draw on the character, add the owner note, then export for ChatGPT';
  }

  function close() {
    active = false;
    draft = null;
    drawingPointer = null;
    frozenState = null;
    contextInvalid = false;
    reviewPanel.hidden = true;
    openButton.disabled = false;
    document.body.classList.remove('review-mode');
    render();
  }

  function normalizedAnnotation(annotation) {
    return structuredClone(annotation);
  }

  function addAnnotation(annotation) {
    if (!DRAW_TOOLS.has(annotation?.tool)) throw new Error('annotation must use pen, circle, or arrow');
    annotations.push(normalizedAnnotation(annotation));
    render();
  }

  function onPointerDown(event) {
    if (!active || drawingPointer !== null) return;
    drawingPointer = event.pointerId;
    overlay.setPointerCapture?.(event.pointerId);
    const start = pointerPoint(event, overlay);
    draft = tool === 'pen'
      ? { tool, points: [start] }
      : { tool, start, end: start };
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!active || event.pointerId !== drawingPointer || !draft) return;
    const point = pointerPoint(event, overlay);
    if (draft.tool === 'pen') draft.points.push(point);
    else draft.end = point;
    render();
    event.preventDefault();
  }

  function finishPointer(event) {
    if (event.pointerId !== drawingPointer || !draft) return;
    const point = pointerPoint(event, overlay);
    if (draft.tool === 'pen') draft.points.push(point);
    else draft.end = point;
    annotations.push(normalizedAnnotation(draft));
    draft = null;
    drawingPointer = null;
    render();
    event.preventDefault();
  }

  overlay.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('pointermove', onPointerMove);
  overlay.addEventListener('pointerup', finishPointer);
  overlay.addEventListener('pointercancel', finishPointer);

  openButton.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  for (const button of toolButtons) {
    button.addEventListener('click', () => setTool(button.dataset.reviewTool));
  }
  undoButton.addEventListener('click', () => {
    annotations.pop();
    render();
  });
  clearButton.addEventListener('click', () => {
    annotations = [];
    draft = null;
    render();
  });

  async function buildPacket({ includeImage = true } = {}) {
    if (!active || !frozenState) throw new Error('open Review Mode before building a review packet');
    if (contextInvalid) throw new Error('Studio state changed after Review Mode was opened; close and reopen to re-bind the annotations');
    const boundSource = await ensureSource();
    const state = frozenState;
    let imageDataUrl = null;
    if (includeImage) {
      const baseDataUrl = await captureStudioFrameDataUrl(studioCanvas);
      imageDataUrl = await composeAnnotatedImage(baseDataUrl, overlay, studioCanvas.width, studioCanvas.height);
    }
    return buildReviewPacket({
      source: boundSource,
      studioState: state,
      reviewType: typeSelect.value,
      title: titleInput.value,
      note: noteInput.value,
      annotations,
      imageDataUrl,
    });
  }

  async function exportPacket({ download = true } = {}) {
    exportButton.disabled = true;
    reviewStatus.textContent = 'capturing exact Studio state…';
    try {
      const packet = await buildPacket({ includeImage: true });
      lastPacket = packet;
      if (download) downloadJson(packet);
      const handoff = chatHandoffText(packet);
      try {
        await navigator.clipboard.writeText(handoff);
        reviewStatus.textContent = `${reviewPacketFilename(packet)} downloaded; ChatGPT handoff copied`;
      } catch {
        reviewStatus.textContent = `${reviewPacketFilename(packet)} downloaded; upload it in ChatGPT and say “ingest this review”`;
      }
      return packet;
    } finally {
      exportButton.disabled = false;
    }
  }
  exportButton.addEventListener('click', () => exportPacket().catch((error) => {
    console.error('[studio-review] export failed', error);
    reviewStatus.textContent = `export failed: ${error.message}`;
  }));

  api.onStateChange(() => {
    if (!active || !frozenState) return;
    const current = api.getState();
    if (reviewContextSignature(current) !== reviewContextSignature(frozenState)) {
      contextInvalid = true;
      reviewStatus.textContent = 'Studio state changed — close and reopen Review Mode before exporting';
    }
  });

  window.addEventListener('resize', resizeOverlay);
  new ResizeObserver(resizeOverlay).observe(studioCanvas);
  resizeOverlay();

  const reviewApi = {
    version: 'galaquest-review-annotations/1',
    open,
    close,
    setTool,
    addAnnotation,
    clear() {
      annotations = [];
      draft = null;
      render();
    },
    undo() {
      annotations.pop();
      render();
    },
    async buildPacket(options) {
      return buildPacket(options);
    },
    async exportPacket(options) {
      return exportPacket(options);
    },
    getState() {
      return {
        active,
        tool,
        annotations: structuredClone(annotations),
        source: structuredClone(source),
        contextInvalid,
        frozenStudioState: frozenState ? structuredClone(frozenState) : null,
        lastPacketId: lastPacket?.reviewId ?? null,
      };
    },
  };
  window.__galaQuestReview = reviewApi;
  return reviewApi;
}
