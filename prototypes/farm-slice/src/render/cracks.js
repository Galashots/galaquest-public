// Egg cracks: each crack is one thin zigzag strip drawn on the shell like a
// sticker. Every point of the strip is placed on the visible shell (the
// procedural sphere or the sculpted egg alike), so a crack follows the egg's
// curve, reads as one line, and never sticks out past the egg's outline.
// Pure three.js with no renderer, so a node test can measure the seating.

const COLOR = '#4a3526';
const WIDTH = 0.026;
// How far the strip floats off the shell; polygonOffset wins the rest of the depth tie.
export const CRACK_LIFT = 0.003;
// The zigzag's corners, bottom to top, as (sideways, up) around the crack's centre.
const ZIGZAG = [[0.012, -0.14], [-0.03, -0.05], [0.028, 0.04], [-0.012, 0.13]];
// Points per zigzag leg, so the strip bends with the shell between corners.
const STEPS = 4;
// Where an unseated crack stands (no shell to lay it on): upright at this radius.
const FALLBACK_RADIUS = 0.31;

/** The crack's bearing around the egg (radians from +z) and the height of its centre. */
export function crackBearing(index) { return (index / 4) * Math.PI * 2 + 0.4; }
export function crackHeight(index) { return 0.55 + index * 0.03; }

/** The strip's two edges as (sideways, up) pairs, one pair per point along the zigzag. */
function stripEdges() {
  const line = [];
  for (let leg = 1; leg < ZIGZAG.length; leg++) {
    const [x0, y0] = ZIGZAG[leg - 1];
    const [x1, y1] = ZIGZAG[leg];
    for (let step = leg === 1 ? 0 : 1; step <= STEPS; step++) {
      const t = step / STEPS;
      line.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  }
  const edges = [];
  line.forEach(([x, y], i) => {
    // Across the line, averaged over the neighbours so the corners join.
    const [ax, ay] = line[Math.max(0, i - 1)];
    const [bx, by] = line[Math.min(line.length - 1, i + 1)];
    const length = Math.hypot(bx - ax, by - ay);
    const across = [(by - ay) / length * (WIDTH / 2), -(bx - ax) / length * (WIDTH / 2)];
    edges.push([x - across[0], y - across[1]], [x + across[0], y + across[1]]);
  });
  return edges;
}

function crackAxes(THREE, bearing) {
  const out = new THREE.Vector3(Math.sin(bearing), 0, Math.cos(bearing));
  return { out, side: new THREE.Vector3(out.z, 0, -out.x) };
}

/**
 * Crack `index` as a strip mesh in the egg group's own space, standing upright
 * on its bearing until seatCrack lays it on a shell.
 */
export function buildCrack(THREE, index) {
  const edges = stripEdges();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edges.length * 3), 3));
  const indices = [];
  for (let a = 0; a + 3 < edges.length; a += 2) indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({
    color: COLOR, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  });
  const crack = new THREE.Mesh(geometry, material);
  crack.name = 'crack';
  crack.userData.bearing = crackBearing(index);
  crack.userData.height = crackHeight(index);
  crack.userData.edges = edges;

  const { out, side } = crackAxes(THREE, crack.userData.bearing);
  const position = geometry.attributes.position;
  edges.forEach(([s, u], i) => {
    const p = out.clone().multiplyScalar(FALLBACK_RADIUS).addScaledVector(side, s).setY(crack.userData.height + u);
    position.setXYZ(i, p.x, p.y, p.z);
  });
  geometry.computeBoundingSphere();
  return crack;
}

/**
 * Lays the crack on the egg's visible shell (`eggGroup.userData.surfaces`): each
 * strip point is carried toward the egg's axis until it meets the shell, then
 * lifted a hair off it along the surface normal. Keeps the previous layout and
 * returns false if any point misses the shell.
 */
export function seatCrack(THREE, eggGroup, crack, raycaster = new THREE.Raycaster()) {
  const surfaces = eggGroup.userData.surfaces;
  if (!surfaces?.length) return false;
  eggGroup.updateMatrixWorld(true);
  const toLocal = eggGroup.matrixWorld.clone().invert();
  const normalToLocal = new THREE.Matrix3().getNormalMatrix(toLocal);
  const { bearing, height, edges } = crack.userData;
  const { out, side } = crackAxes(THREE, bearing);

  const seated = [];
  for (const [s, u] of edges) {
    const axis = side.clone().multiplyScalar(s).setY(height + u);
    const origin = eggGroup.localToWorld(axis.clone().addScaledVector(out, 3));
    const target = eggGroup.localToWorld(axis.clone());
    raycaster.set(origin, target.sub(origin).normalize());
    const hit = raycaster.intersectObjects(surfaces, false)[0];
    if (!hit?.face) return false;
    const normal = hit.face.normal.clone()
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
      .applyMatrix3(normalToLocal).normalize();
    if (normal.dot(out) < 0) normal.negate();
    seated.push(hit.point.applyMatrix4(toLocal).addScaledVector(normal, CRACK_LIFT));
  }

  const position = crack.geometry.attributes.position;
  seated.forEach((p, i) => position.setXYZ(i, p.x, p.y, p.z));
  position.needsUpdate = true;
  crack.geometry.computeBoundingSphere();
  return true;
}

/** Adds crack `index` to the egg and seats it on the shell. */
export function addCrack(THREE, eggGroup, index, raycaster) {
  const crack = buildCrack(THREE, index);
  eggGroup.add(crack);
  eggGroup.userData.cracks.push(crack);
  seatCrack(THREE, eggGroup, crack, raycaster);
  return crack;
}
