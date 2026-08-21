export const BODY_REGION_ATTRIBUTE = '_gq_region';
export const TRIANGLE_REGION_USER_DATA = 'gqAnatomyTriangleRegions';

export const BODY_REGION_CODES = Object.freeze({
  core: 0,
  hair: 1,
  ears: 2,
  beard: 3,
  torso: 4,
  'upper-arms': 5,
  'lower-arms': 6,
  hands: 7,
  'hips-legs': 8,
  feet: 9,
});

const REGION_NAME_BY_CODE = new Map(
  Object.entries(BODY_REGION_CODES).map(([name, code]) => [code, name]),
);

const variantCache = new WeakMap();

export function normalizeHiddenRegions(hiddenRegions = []) {
  const names = [...new Set(hiddenRegions)];
  for (const name of names) {
    if (!(name in BODY_REGION_CODES)) throw new Error(`unknown anatomy region "${name}"`);
    if (name === 'core') throw new Error('core anatomy cannot be hidden by equipment');
  }
  return names.sort((a, b) => BODY_REGION_CODES[a] - BODY_REGION_CODES[b]);
}

export function anatomyCoverageKey(hiddenRegions = []) {
  return normalizeHiddenRegions(hiddenRegions).join('+') || 'none';
}

function attributeFor(geometry) {
  return geometry.getAttribute?.(BODY_REGION_ATTRIBUTE)
    ?? geometry.attributes?.[BODY_REGION_ATTRIBUTE]
    ?? null;
}

function regionCodeAt(attribute, vertexIndex) {
  const value = typeof attribute.getX === 'function'
    ? attribute.getX(vertexIndex)
    : attribute.array?.[vertexIndex * (attribute.itemSize ?? 1)];
  if (!Number.isFinite(value)) throw new Error(`missing anatomy region at vertex ${vertexIndex}`);
  const code = Math.round(value);
  if (Math.abs(value - code) > 1e-5 || !REGION_NAME_BY_CODE.has(code)) {
    throw new Error(`invalid anatomy region code ${value} at vertex ${vertexIndex}`);
  }
  return code;
}

function sourceIndices(geometry) {
  const indexed = geometry.getIndex?.() ?? geometry.index ?? null;
  if (indexed?.array) return indexed.array;
  const position = geometry.getAttribute?.('position') ?? geometry.attributes?.position;
  const count = position?.count ?? 0;
  if (!Number.isInteger(count) || count <= 0) throw new Error('anatomy occlusion requires position vertices');
  return Array.from({ length: count }, (_, index) => index);
}

function safeCloneBounds(value) {
  return value && typeof value.clone === 'function' ? value.clone() : value ?? null;
}

function validateTriangleRegionMap(sourceGeometry, triangleRegions) {
  if (!triangleRegions || typeof triangleRegions !== 'object' || Array.isArray(triangleRegions)) {
    throw new Error('triangle anatomy regions must be an object keyed by semantic region name');
  }
  const indices = sourceIndices(sourceGeometry);
  if (indices.length % 3 !== 0) throw new Error(`triangle index count ${indices.length} is not divisible by 3`);
  const triangleCount = indices.length / 3;
  const ownerByTriangle = new Map();

  for (const [region, faces] of Object.entries(triangleRegions)) {
    if (!(region in BODY_REGION_CODES)) throw new Error(`unknown anatomy region "${region}" in triangle sidecar`);
    if (!Array.isArray(faces) && !ArrayBuffer.isView(faces)) {
      throw new Error(`triangle anatomy region "${region}" must be an array of face indices`);
    }
    for (const rawFace of faces) {
      const face = Number(rawFace);
      if (!Number.isInteger(face) || face < 0 || face >= triangleCount) {
        throw new Error(`triangle anatomy region "${region}" contains invalid face ${rawFace}; expected 0..${triangleCount - 1}`);
      }
      const prior = ownerByTriangle.get(face);
      if (prior && prior !== region) {
        throw new Error(`triangle ${face} belongs to both anatomy regions "${prior}" and "${region}"`);
      }
      ownerByTriangle.set(face, region);
    }
  }
  return { indices, triangleCount };
}

/**
 * Attach a supervised per-triangle semantic map to one exact source geometry.
 *
 * This is the first-proof bridge for the current Hero, whose shipping GLB predates `_GQ_REGION`.
 * It keeps the runtime contract semantic and face-indexed (never bounds-based). The Blender lane can
 * later bake the same single-valued regions into the preferred face-corner attribute without
 * changing callers or equipment declarations.
 */
export function attachTriangleAnatomyRegions(sourceGeometry, triangleRegions, sourceMetadata = null) {
  const { triangleCount } = validateTriangleRegionMap(sourceGeometry, triangleRegions);
  sourceGeometry.userData = {
    ...(sourceGeometry.userData ?? {}),
    [TRIANGLE_REGION_USER_DATA]: {
      regions: triangleRegions,
      source: sourceMetadata,
      triangleCount,
    },
  };
  // Attaching a different supervised map to the same geometry must never return a stale variant.
  variantCache.delete(sourceGeometry);
  return sourceGeometry;
}

function triangleSidecarFor(geometry) {
  return geometry.userData?.[TRIANGLE_REGION_USER_DATA] ?? null;
}

/**
 * Build a one-draw geometry variant by changing only the triangle index buffer.
 *
 * Vertex/skin/UV buffers stay shared with the source geometry, so hiding anatomy does not duplicate
 * the expensive skinned payload and does not consume another draw call. Preferred shipping assets
 * carry the authored `_GQ_REGION` face-corner attribute. The current Hero can also carry a validated
 * supervised per-triangle sidecar during the first proof; both representations have identical
 * equipment semantics and produce the same one-draw index-buffer variant.
 */
export function buildAnatomyOccludedGeometry(sourceGeometry, hiddenRegions = []) {
  const hiddenNames = normalizeHiddenRegions(hiddenRegions);
  if (hiddenNames.length === 0) return sourceGeometry;

  const attribute = attributeFor(sourceGeometry);
  const sidecar = triangleSidecarFor(sourceGeometry);
  if (!attribute && !sidecar) {
    throw new Error(`hero geometry is missing ${BODY_REGION_ATTRIBUTE} and a supervised triangle anatomy map; author semantic anatomy regions before applying equipment coverage`);
  }
  if ((sourceGeometry.groups?.length ?? 0) > 1) {
    throw new Error('anatomy occlusion currently requires a one-draw source geometry');
  }

  const indices = sourceIndices(sourceGeometry);
  if (indices.length % 3 !== 0) throw new Error(`triangle index count ${indices.length} is not divisible by 3`);
  const hiddenTriangleCounts = Object.fromEntries(hiddenNames.map((name) => [name, 0]));
  const kept = [];

  if (attribute) {
    const hiddenCodes = new Set(hiddenNames.map((name) => BODY_REGION_CODES[name]));
    for (let offset = 0; offset < indices.length; offset += 3) {
      const a = Number(indices[offset]);
      const b = Number(indices[offset + 1]);
      const c = Number(indices[offset + 2]);
      const ra = regionCodeAt(attribute, a);
      const rb = regionCodeAt(attribute, b);
      const rc = regionCodeAt(attribute, c);
      if (ra !== rb || rb !== rc) {
        throw new Error(
          `triangle ${offset / 3} mixes anatomy regions ${REGION_NAME_BY_CODE.get(ra)}, ${REGION_NAME_BY_CODE.get(rb)}, ${REGION_NAME_BY_CODE.get(rc)}; author ${BODY_REGION_ATTRIBUTE} on Blender face corners`,
        );
      }
      if (hiddenCodes.has(ra)) {
        hiddenTriangleCounts[REGION_NAME_BY_CODE.get(ra)] += 1;
        continue;
      }
      kept.push(a, b, c);
    }
  } else {
    validateTriangleRegionMap(sourceGeometry, sidecar.regions);
    const hiddenFaces = new Set();
    for (const name of hiddenNames) {
      const faces = sidecar.regions[name] ?? [];
      hiddenTriangleCounts[name] = faces.length;
      for (const face of faces) hiddenFaces.add(Number(face));
    }
    for (let face = 0, offset = 0; offset < indices.length; face += 1, offset += 3) {
      if (hiddenFaces.has(face)) continue;
      kept.push(Number(indices[offset]), Number(indices[offset + 1]), Number(indices[offset + 2]));
    }
  }

  const Geometry = sourceGeometry.constructor;
  const variant = new Geometry();
  for (const [name, attributeValue] of Object.entries(sourceGeometry.attributes ?? {})) {
    variant.setAttribute(name, attributeValue);
  }
  variant.morphAttributes = sourceGeometry.morphAttributes ?? {};
  variant.morphTargetsRelative = Boolean(sourceGeometry.morphTargetsRelative);
  variant.setIndex(kept);

  if ((sourceGeometry.groups?.length ?? 0) === 1 && typeof variant.addGroup === 'function') {
    variant.addGroup(0, kept.length, sourceGeometry.groups[0].materialIndex ?? 0);
  }
  if (typeof variant.setDrawRange === 'function') variant.setDrawRange(0, kept.length);

  variant.name = `${sourceGeometry.name || 'hero'}__coverage_${anatomyCoverageKey(hiddenNames)}`;
  variant.boundingBox = safeCloneBounds(sourceGeometry.boundingBox);
  variant.boundingSphere = safeCloneBounds(sourceGeometry.boundingSphere);
  variant.userData = {
    ...(sourceGeometry.userData ?? {}),
    gqAnatomyCoverage: {
      hidden: [...hiddenNames],
      hiddenTriangleCounts,
      regionSource: attribute ? 'attribute' : 'triangle-sidecar',
      sourceTriangleCount: indices.length / 3,
      visibleTriangleCount: kept.length / 3,
    },
  };
  return variant;
}

/** Cache one lightweight index-buffer variant per source geometry + semantic coverage set. */
export function geometryForAnatomyCoverage(sourceGeometry, hiddenRegions = []) {
  const coverage = anatomyCoverageKey(hiddenRegions);
  if (coverage === 'none') return sourceGeometry;
  const sourceKind = attributeFor(sourceGeometry) ? 'attribute'
    : triangleSidecarFor(sourceGeometry) ? 'triangle-sidecar'
      : 'missing';
  const key = `${sourceKind}:${coverage}`;
  let byCoverage = variantCache.get(sourceGeometry);
  if (!byCoverage) {
    byCoverage = new Map();
    variantCache.set(sourceGeometry, byCoverage);
  }
  if (!byCoverage.has(key)) byCoverage.set(key, buildAnatomyOccludedGeometry(sourceGeometry, hiddenRegions));
  return byCoverage.get(key);
}
