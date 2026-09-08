// Swept point vs expanded rectangles. Expansion supplies the hero's body clearance;
// sweeping the whole step prevents thin-wall tunnelling during delayed frames.
export function resolvePlanarPosition(position, bounds, solids, clearance) {
  const p = {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, position.x)),
    z: Math.max(bounds.minZ, Math.min(bounds.maxZ, position.z)),
  };
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const solid of solids) {
      const r = expanded(solid, clearance);
      if (!(p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ)) continue;
      const distances = [
        r.minX >= bounds.minX ? p.x - r.minX : Infinity,
        r.maxX <= bounds.maxX ? r.maxX - p.x : Infinity,
        r.minZ >= bounds.minZ ? p.z - r.minZ : Infinity,
        r.maxZ <= bounds.maxZ ? r.maxZ - p.z : Infinity,
      ];
      const side = distances.indexOf(Math.min(...distances));
      if (side === 0) p.x = r.minX;
      else if (side === 1) p.x = r.maxX;
      else if (side === 2) p.z = r.minZ;
      else p.z = r.maxZ;
      changed = true;
    }
    if (!changed) break;
  }
  return p;
}

export function movePlanarPosition(from, to, bounds, solids, clearance) {
  const p = resolvePlanarPosition(from, bounds, solids, clearance);
  let dx = to.x - from.x;
  let dz = to.z - from.z;
  for (let contact = 0; contact < 3 && (dx !== 0 || dz !== 0); contact++) {
    let first = null;
    for (const solid of solids) {
      const hit = sweep(p, dx, dz, expanded(solid, clearance));
      if (hit && (!first || hit.time < first.time)) first = hit;
    }
    if (!first) { p.x += dx; p.z += dz; break; }
    p.x += dx * first.time;
    p.z += dz * first.time;
    // Snap the contacted coordinate to the face to avoid floating-point re-entry.
    if (first.blockX) p.x = first.faceX;
    if (first.blockZ) p.z = first.faceZ;
    dx = first.blockX ? 0 : dx * (1 - first.time);
    dz = first.blockZ ? 0 : dz * (1 - first.time);
  }
  return resolvePlanarPosition(p, bounds, solids, clearance);
}

function expanded(r, clearance) {
  return { minX: r.minX - clearance, maxX: r.maxX + clearance,
    minZ: r.minZ - clearance, maxZ: r.maxZ + clearance };
}

function sweep(p, dx, dz, r) {
  // A path along a face is free to slide. Only paths entering the interior collide.
  if (dx === 0 && (p.x <= r.minX || p.x >= r.maxX)) return null;
  if (dz === 0 && (p.z <= r.minZ || p.z >= r.maxZ)) return null;
  const x1 = dx === 0 ? -Infinity : ((dx > 0 ? r.minX : r.maxX) - p.x) / dx;
  const x2 = dx === 0 ? Infinity : ((dx > 0 ? r.maxX : r.minX) - p.x) / dx;
  const z1 = dz === 0 ? -Infinity : ((dz > 0 ? r.minZ : r.maxZ) - p.z) / dz;
  const z2 = dz === 0 ? Infinity : ((dz > 0 ? r.maxZ : r.minZ) - p.z) / dz;
  const time = Math.max(x1, z1);
  const exit = Math.min(x2, z2);
  if (time < 0 || time > 1 || exit <= time) return null;
  return { time, blockX: x1 >= z1, blockZ: z1 >= x1,
    faceX: dx > 0 ? r.minX : r.maxX, faceZ: dz > 0 ? r.minZ : r.maxZ };
}
