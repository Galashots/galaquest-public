/**
 * What does this clip's standing pose actually do, measured against how a human stands?
 *
 *   node tools/foundry/pose_anatomy.mjs <file.glb> [clipName ...]
 *   node tools/foundry/pose_anatomy.mjs <file.glb> [clipName ...] --json --time 0.5
 *   node tools/foundry/pose_anatomy.mjs <file.glb> [clipName ...] --json --sweep [--samples 12]
 *
 * Reads the GLB's own JSON chunk and runs forward kinematics on the skin's joints. Never imports it
 * (AGENTS.md: Blender's importer fabricates geometry that is not in the file).
 *
 * The axes are DERIVED from the skeleton, not assumed: up from Hips->Head, lateral from
 * RightUpLeg->LeftUpLeg, forward from their cross product with its sign checked against the toes,
 * which actually point forwards. Assuming "-Z is forward because glTF says so" is how a correct
 * measurement gets reported on an inverted axis.
 *
 * Every quantity below is one a life-drawing tutor or a gait lab would recognise, because the point
 * is to compare our characters against humans rather than against our own conventions.
 *
 * --json / --sweep / --time (owner-plan.md section 19, added for CSB SR4): the SAME functions below
 * (measure, axesFromRest, spineDistribution, rigMeasurements) back both the human-readable report and
 * the JSON one -- this is exposure of one existing anatomy authority, not a second, competing
 * definition, per the plan's own instruction ("Character Studio should expose this information rather
 * than create a competing anatomy definition"). Two content modes, orthogonal to the text/JSON switch:
 *   --time <seconds>  exact-time measurement -- one frame, no sweep.
 *   --sweep           whole-clip extrema -- SAMPLES (default 12, override with --samples) evenly-timed
 *                      frames plus their per-field min/max/mean, same sampling the text report already
 *                      does. This is also the default content when --json is given without --time.
 * Per owner-plan.md section 19: no global Euler gate is computed (there is no combined pass/fail
 * across axes), and left/right asymmetry is reported as a number, never turned into a boolean.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEG = 180 / Math.PI;

export function readGlb(path) {
  const buf = readFileSync(path);
  const chunks = [];
  let offset = 12;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    chunks.push({ type, body: buf.subarray(offset + 8, offset + 8 + len) });
    offset += 8 + len + ((4 - (len % 4)) % 4);
  }
  const json = JSON.parse(new TextDecoder().decode(chunks.find((c) => c.type === 0x4e4f534a).body));
  const bin = chunks.find((c) => c.type === 0x004e4942)?.body ?? Buffer.alloc(0);
  return { json, bin };
}

const COMPONENT = { 5126: [Float32Array, 4], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4] };
const COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(glb, index) {
  const acc = glb.json.accessors[index];
  const view = glb.json.bufferViews[acc.bufferView];
  const [Ctor, size] = COMPONENT[acc.componentType];
  const n = COUNT[acc.type];
  const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const raw = new Ctor(glb.bin.buffer.slice(
    glb.bin.byteOffset + start,
    glb.bin.byteOffset + start + acc.count * n * size,
  ));
  const out = [];
  for (let i = 0; i < acc.count; i += 1) out.push(Array.from(raw.subarray(i * n, i * n + n)));
  return out;
}

const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qrot = (q, v) => {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a) => Math.hypot(...a);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) * DEG;

export function skeleton(glb) {
  const parentOf = new Map();
  glb.json.nodes.forEach((n, i) => { for (const c of n.children ?? []) parentOf.set(c, i); });
  const byName = new Map();
  glb.json.nodes.forEach((n, i) => { if (n.name) byName.set(n.name, i); });
  return { json: glb.json, parentOf, byName, joints: glb.json.skins[0].joints };
}

export function forward(skel, override = new Map()) {
  const world = new Map();
  const solve = (i) => {
    if (world.has(i)) return world.get(i);
    const n = skel.json.nodes[i];
    const o = override.get(i) ?? {};
    const t = o.t ?? n.translation ?? [0, 0, 0];
    const r = o.r ?? n.rotation ?? [0, 0, 0, 1];
    const s = o.s ?? n.scale ?? [1, 1, 1];
    const p = skel.parentOf.get(i);
    const base = p === undefined ? { pos: [0, 0, 0], rot: [0, 0, 0, 1], scl: [1, 1, 1] } : solve(p);
    const rotated = qrot(base.rot, [t[0] * base.scl[0], t[1] * base.scl[1], t[2] * base.scl[2]]);
    const me = {
      pos: [base.pos[0] + rotated[0], base.pos[1] + rotated[1], base.pos[2] + rotated[2]],
      rot: qmul(base.rot, r),
      scl: [base.scl[0] * s[0], base.scl[1] * s[1], base.scl[2] * s[2]],
    };
    world.set(i, me);
    return me;
  };
  skel.json.nodes.forEach((_, i) => solve(i));
  return world;
}

export function poseAt(glb, skel, clipName, time) {
  const anim = glb.json.animations.find((a) => a.name === clipName);
  if (!anim) throw new Error(`no clip "${clipName}" (has: ${glb.json.animations.map((a) => a.name).join(', ')})`);
  const out = new Map();
  for (const ch of anim.channels) {
    const sampler = anim.samplers[ch.sampler];
    const times = readAccessor(glb, sampler.input).map((v) => v[0]);
    const values = readAccessor(glb, sampler.output);
    let k = 0;
    while (k + 1 < times.length && times[k + 1] <= time) k += 1;
    const entry = out.get(ch.target.node) ?? {};
    entry[{ translation: 't', rotation: 'r', scale: 's' }[ch.target.path]] = values[k];
    out.set(ch.target.node, entry);
  }
  return out;
}

/** Signed angle of `v` above the horizontal plane, measured about the lateral axis. */
const elevation = (v, up) => Math.asin(Math.max(-1, Math.min(1, dot(norm(v), up)))) * DEG;

/**
 * The model's own axes, derived ONCE from the rest pose and then held fixed.
 *
 * Deriving them per frame is what makes a measurement lie about itself: taking `up` from Hips->Head
 * on the posed skeleton means "how far is the head in front of the hips" is a dot product with a
 * vector the head is parallel to by construction, and it reports 0.00 forever. The rest pose is the
 * authority for which way is up, and a pose is then measured AGAINST it.
 */
export function axesFromRest(skel) {
  const world = forward(skel);
  const P = (name) => world.get(skel.byName.get(name)).pos;
  const spine = sub(P('Head'), P('LeftFoot'));
  // The world axis the standing figure is tallest along, rather than an assumption about glTF's Y.
  const axis = [0, 1, 2].reduce((best, i) => (Math.abs(spine[i]) > Math.abs(spine[best]) ? i : best), 0);
  const up = [0, 0, 0];
  up[axis] = Math.sign(spine[axis]) || 1;

  let lateral = sub(P('LeftUpLeg'), P('RightUpLeg'));            // points to the character's LEFT
  lateral = norm(sub(lateral, scale(up, dot(lateral, up))));      // flatten into the horizontal
  let fwd = norm(cross(up, lateral));
  // Sign check against something that genuinely points forwards: the toes.
  const toe = sub(P('LeftToeBase'), P('LeftFoot'));
  if (dot(fwd, toe) < 0) fwd = scale(fwd, -1);
  // ...then CHECK that against a second, independent authority that has nothing to do with feet.
  // `headfront` is the Meshy biped's face marker. If the two disagree, the basis is wrong and every
  // angle below would be confidently reported on the wrong axis.
  const face = sub(P('headfront'), P('Head'));
  const faceAgrees = dot(norm(face), fwd);

  return {
    up,
    lateral,
    fwd,
    faceAgrees,
    height: Math.abs(dot(sub(P('Head'), P('LeftFoot')), up)),
  };
}

export function measure(skel, world, axes) {
  const P = (name) => {
    const i = skel.byName.get(name);
    if (i === undefined) throw new Error(`no joint named ${name}`);
    return world.get(i).pos;
  };
  const { up, lateral, fwd, height } = axes;
  const pct = (v) => (v / height) * 100;

  // ── the two obliquities, and whether they oppose (contrapposto) ───────────────────────────────
  const pelvis = elevation(sub(P('LeftUpLeg'), P('RightUpLeg')), up);   // + = left hip higher
  const shoulders = elevation(sub(P('LeftArm'), P('RightArm')), up);    // + = left shoulder higher

  // ── arms ─────────────────────────────────────────────────────────────────────────────────────
  const arm = (side) => {
    const upper = sub(P(`${side}ForeArm`), P(`${side}Arm`));
    const lower = sub(P(`${side}Hand`), P(`${side}ForeArm`));
    return {
      abduction: angleBetween(upper, scale(up, -1)),   // 0 = hanging straight down the side
      elbow: angleBetween(upper, lower),                // 0 = locked straight, 90 = right angle
    };
  };

  // ── feet ─────────────────────────────────────────────────────────────────────────────────────
  const turnOut = (side) => {
    const v = sub(P(`${side}ToeBase`), P(`${side}Foot`));
    const flat = norm(sub(v, scale(up, dot(v, up))));
    const outward = side === 'Left' ? lateral : scale(lateral, -1);
    return Math.atan2(dot(flat, outward), dot(flat, fwd)) * DEG;   // + = toes point outward
  };
  const stanceWidth = Math.abs(dot(sub(P('LeftFoot'), P('RightFoot')), lateral));
  const hipWidth = Math.abs(dot(sub(P('LeftUpLeg'), P('RightUpLeg')), lateral));
  const heelDrop = dot(sub(P('LeftFoot'), P('RightFoot')), up);

  // ── how mirrored is the whole figure? ────────────────────────────────────────────────────────
  // Reflect every left joint through the sagittal plane and see how far it lands from its right
  // twin. A pose a shop-window mannequin could hold scores ~0.
  const centre = P('Hips');
  let residual = 0;
  let pairs = 0;
  for (const name of ['UpLeg', 'Leg', 'Foot', 'ToeBase', 'Shoulder', 'Arm', 'ForeArm', 'Hand']) {
    const l = P(`Left${name}`);
    const r = P(`Right${name}`);
    const rel = sub(l, centre);
    const mirrored = sub(rel, scale(lateral, 2 * dot(rel, lateral)));
    residual += len(sub(mirrored, sub(r, centre)));
    pairs += 1;
  }

  return {
    pelvisTilt: pelvis,
    shoulderTilt: shoulders,
    contrapposto: Math.sign(pelvis) !== Math.sign(shoulders) && Math.abs(pelvis) > 1 && Math.abs(shoulders) > 1,
    leftArm: arm('Left'),
    rightArm: arm('Right'),
    leftTurnOut: turnOut('Left'),
    rightTurnOut: turnOut('Right'),
    stanceOverHip: stanceWidth / (hipWidth || 1),
    heelDropPct: pct(heelDrop),
    mirrorResidualPct: pct(residual / pairs),
    headOverHipsPct: pct(dot(sub(P('Head'), P('Hips')), fwd)),
    hipsHeightPct: pct(dot(sub(P('Hips'), P('LeftFoot')), up)),
  };
}

/**
 * Where does the trunk actually bend?
 *
 * A human trunk is two RIGID masses -- the ribcage and the pelvis -- separated by a short soft span,
 * roughly 12th rib to iliac crest. Nothing bends at "the waist" as a point. Rotation is shared out
 * along the spine, and axial twist is mostly THORACIC: the lumbar spine contributes only about 5-13
 * degrees of rotation in total, while the thorax gives around 35.
 *
 * So the failure mode to catch is a chain that puts most of its rotation into ONE joint: the torso
 * then spins on a peg at the belt, the robe pinches at that ring, and the character reads as a doll
 * whose top half twists. This reports each spine joint's share so that is a number, not an opinion.
 */
export function spineDistribution(skel, glb, clipName, samples) {
  const CHAIN = ['Hips', 'Spine', 'Spine01', 'Spine02', 'neck', 'Head'];
  const present = CHAIN.filter((n) => skel.byName.has(n));
  const restOf = new Map(present.map((n) => [n, skel.json.nodes[skel.byName.get(n)].rotation ?? [0, 0, 0, 1]]));
  const totals = new Map(present.map((n) => [n, 0]));
  let frames = 0;

  for (const t of samples) {
    const pose = poseAt(glb, skel, clipName, t);
    for (const name of present) {
      const node = skel.byName.get(name);
      const q = pose.get(node)?.r ?? restOf.get(name);
      const r = restOf.get(name);
      // Angle between the animated local rotation and this joint's own rest rotation.
      const d = Math.min(1, Math.abs(q[0] * r[0] + q[1] * r[1] + q[2] * r[2] + q[3] * r[3]));
      totals.set(name, totals.get(name) + 2 * Math.acos(d) * DEG);
    }
    frames += 1;
  }

  const rows = present.map((n) => ({ name: n, deg: totals.get(n) / frames }));
  const sum = rows.reduce((a, b) => a + b.deg, 0) || 1;
  return rows.map((r) => ({ ...r, share: (r.deg / sum) * 100 }));
}

/**
 * The SKELETON check, which is separate from the pose check and runs first.
 *
 * A pose can only be as good as the rig under it. Human limb-segment ratios are near-constant across
 * body sizes -- the femur and tibia are close to equal, and the forearm is about four fifths of the
 * upper arm -- so they survive stylisation. That is the point: we may exaggerate PROPORTION (chunky
 * heads-tall for a kid game) but we may not break ARTICULATION. A rig whose forearm is longer than
 * its upper arm, or whose left and right differ, will read as wrong no matter how good the clip is.
 */
/** Bind-pose world position of a joint, from the skin's inverse bind matrix: the translation of
 *  inverse(IBM), i.e. -A^-1 t for the column-major upper 3x3 A and translation t. This is the
 *  AUTHORITY for a rig's rest. Node TRS is only a convenient copy of it, and in an animated GLB it
 *  can hold frame 0 of some clip instead. */
function bindPositions(glb, skel) {
  const skin = glb.json.skins[0];
  if (skin.inverseBindMatrices === undefined) return null;
  const mats = readAccessor(glb, skin.inverseBindMatrices);
  const out = new Map();
  skin.joints.forEach((node, i) => {
    const m = mats[i];
    const A = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]];
    const t = [m[12], m[13], m[14]];
    const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
      - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
      + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    const cof = (r, c) => {
      const i2 = [0, 1, 2].filter((x) => x !== r);
      const j2 = [0, 1, 2].filter((x) => x !== c);
      return ((A[j2[0]][i2[0]] * A[j2[1]][i2[1]] - A[j2[0]][i2[1]] * A[j2[1]][i2[0]])
        * ((r + c) % 2 ? -1 : 1)) / det;
    };
    out.set(skel.json.nodes[node].name,
      [0, 1, 2].map((r) => -(cof(r, 0) * t[0] + cof(r, 1) * t[1] + cof(r, 2) * t[2])));
  });
  return out;
}

/**
 * The pure data behind the SKELETON check -- extracted so --json can expose exactly what the console
 * report prints, not a second computation of it. See rigReport() below for the text rendering.
 */
export function rigMeasurements(skel, glb) {
  const world = forward(skel);
  const bind = bindPositions(glb, skel);
  const P = (n) => (skel.byName.has(n) ? world.get(skel.byName.get(n)).pos : null);
  // Measure off the bind pose where it exists, and cross-check the node TRS against it. They agreed
  // exactly on every character we ship (2026-08-14) -- but "they agreed last time" is not a reason
  // to stop checking, and a disagreement means the node pose is a baked animation frame.
  const spanNode = (a, b) => (P(a) && P(b) ? len(sub(P(a), P(b))) : NaN);
  const spanBind = (a, b) => (bind?.has(a) && bind?.has(b) ? len(sub(bind.get(a), bind.get(b))) : NaN);
  const span = (a, b) => (bind ? spanBind(a, b) : spanNode(a, b));
  // The two sources live in different unit scales (node TRS is rig-local, bind is post-armature),
  // so the check is that their ratio is CONSTANT across bones -- a uniformly scaled copy. A varying
  // ratio means the node pose is a baked animation frame, not the rest pose.
  let drift = 0;
  if (bind) {
    const factors = [];
    for (const [x, y] of [['LeftArm', 'LeftForeArm'], ['RightArm', 'RightForeArm'],
      ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'], ['Spine', 'Spine01']]) {
      const n = spanNode(x, y);
      const b = spanBind(x, y);
      if (Number.isFinite(n) && Number.isFinite(b) && b > 1e-9) factors.push(n / b);
    }
    if (factors.length > 1) {
      drift = (Math.max(...factors) - Math.min(...factors)) / Math.max(...factors) * 100;
    }
  }
  const { height } = axesFromRest(skel);

  const headLength = span('Head', 'head_end');
  // Label order matches the arithmetic: ratio = b / a, so the label reads "b : a". Getting this
  // backwards is how a mathematically correct wrong fix gets made.
  const rows = [
    ['forearm : upper arm', span('LeftArm', 'LeftForeArm'), span('LeftForeArm', 'LeftHand'), 0.79, 0.15],
    ['shin : thigh', span('LeftUpLeg', 'LeftLeg'), span('LeftLeg', 'LeftFoot'), 1.0, 0.15],
  ].map(([label, a, b, ideal, tol]) => {
    const ratio = b / a;
    return { label, ratio, ideal, ok: Math.abs(ratio - ideal) <= tol };
  });

  // Left/right bone-length symmetry, REPORTED not graded. Bilateral asymmetry is normal in humans
  // and right-biased, and published length differences are large enough that no honest pass/fail
  // line can be drawn here -- an earlier version of this tool asserted "<2%" and that number was
  // invented. What matters for us is mechanical, not perceptual: a mirrored clip lands differently
  // on each side, and gear anchored to each hand sits at a different distance from its shoulder.
  let worstAsym = { pct: 0, bone: '' };
  for (const [parent, child] of [['UpLeg', 'Leg'], ['Leg', 'Foot'], ['Arm', 'ForeArm'], ['ForeArm', 'Hand']]) {
    const l = span(`Left${parent}`, `Left${child}`);
    const r = span(`Right${parent}`, `Right${child}`);
    const pct = (Math.abs(l - r) / Math.max(l, r)) * 100;
    if (pct > worstAsym.pct) worstAsym = { pct, bone: `${parent}->${child}` };
  }

  return {
    bindAvailable: Boolean(bind),
    nodeBindDriftPct: bind ? drift : null,
    headSpanProxy: height / headLength,
    limbRatios: rows,
    // REPORTED not graded -- no `ok`/pass-fail field. Owner-plan.md section 19: "do not turn normal
    // left/right asymmetry into an automatic failure."
    worstAsymmetry: worstAsym,
    lumbarJointPresent: skel.byName.has('Spine'),
  };
}

function rigReport(skel, glb) {
  const m = rigMeasurements(skel, glb);
  console.log(`  SKELETON (${m.bindAvailable ? 'from the skin\'s inverse bind matrices' : 'node TRS -- NO inverseBindMatrices'}):`);
  if (m.bindAvailable) {
    console.log(`    node TRS agrees with bind  ${m.nodeBindDriftPct.toFixed(3)}% spread across bones`
      + `   ${m.nodeBindDriftPct < 0.5 ? 'OK' : '*** node pose is a baked animation frame, not the rest pose ***'}`);
  }
  // A SKELETAL proxy: Head joint to head_end, over Head joint to foot. Neither span is the artist's
  // crown-to-chin head or true stature, so this is comparable between OUR characters and to nothing
  // else. Do not set it against the ~7.5 heads-tall drawing canon; they are different measurements.
  console.log(`    head-span proxy           ${m.headSpanProxy.toFixed(2)}`
    + `   (skeletal, comparable only across our own rigs -- NOT the artist's heads-tall)`);
  for (const r of m.limbRatios) {
    console.log(`    ${r.label.padEnd(25)} ${r.ratio.toFixed(3)}   human ~${r.ideal.toFixed(2)}`
      + `   ${r.ok ? 'OK' : '*** OUTSIDE HUMAN RANGE ***'}`);
  }
  console.log(`    left/right bone difference  worst ${m.worstAsymmetry.pct.toFixed(2)}% on ${m.worstAsymmetry.bone}`
    + `   (reported, not graded -- see the note in this file)`);
  console.log(`    lumbar joint present      ${m.lumbarJointPresent ? 'yes (Spine)' : '*** NO LOWER-BACK JOINT: the trunk cannot bend ***'}`);
  console.log('');
}

// ── shared clip helpers (text and JSON reports both call these -- one authority) ───────────────────
export function clipDuration(glb, clipName) {
  const anim = glb.json.animations.find((a) => a.name === clipName);
  if (!anim) return null;
  let duration = 0;
  for (const s of anim.samplers) {
    const input = glb.json.accessors[s.input];
    if (input.max) duration = Math.max(duration, input.max[0]);
  }
  return duration;
}

/** SAMPLES evenly-timed measure() frames across the clip, same sampling scheme the text report has
 *  always used ((duration * i) / SAMPLES). Returns the times and the raw measure() frames separately
 *  so a caller can tag/aggregate them however it needs, rather than baking one shape in here. */
export function sweepFrames(glb, skel, axes, clipName, samples) {
  const duration = clipDuration(glb, clipName);
  const times = Array.from({ length: samples }, (_, i) => (duration * i) / samples);
  const frames = times.map((t) => measure(skel, forward(skel, poseAt(glb, skel, clipName, t)), axes));
  return { duration, times, frames };
}

/**
 * Whole-clip extrema (owner-plan.md section 19): walks a measure()-shaped frame recursively and
 * replaces each leaf with its aggregate across all frames -- {mean, min, max, range} for a number,
 * {trueCount, total, fraction} for a boolean (contrapposto). No new anatomy definition: this only
 * summarizes values measure() already computed.
 */
export function aggregateFrames(frames) {
  const out = {};
  for (const key of Object.keys(frames[0])) {
    const values = frames.map((f) => f[key]);
    if (typeof values[0] === 'boolean') {
      const trueCount = values.filter(Boolean).length;
      out[key] = { trueCount, total: values.length, fraction: trueCount / values.length };
    } else if (typeof values[0] === 'object' && values[0] !== null) {
      out[key] = aggregateFrames(values);
    } else {
      out[key] = {
        mean: values.reduce((a, b) => a + b, 0) / values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        range: Math.max(...values) - Math.min(...values),
      };
    }
  }
  return out;
}

/** --json requires an explicit content mode -- fail closed rather than silently pick one. */
export function requiresContentMode(time, sweep) {
  return time === undefined && !sweep;
}

export function parseArgs(argv) {
  const [, , path, ...rest] = argv;
  const wanted = [];
  let json = false;
  let sweep = false;
  let time;
  let samples = 12;
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--json') { json = true; } else if (a === '--sweep') {
      sweep = true;
    } else if (a === '--time') {
      const v = Number(rest[i + 1]);
      if (!Number.isFinite(v)) throw new Error('--time requires a numeric seconds value');
      time = v; i += 1;
    } else if (a === '--samples') {
      const v = Number(rest[i + 1]);
      if (!Number.isInteger(v) || v < 1) throw new Error('--samples requires a positive integer');
      samples = v; i += 1;
    } else {
      wanted.push(a);
    }
  }
  return {
    path, wanted, json, sweep, time, samples,
  };
}

/** One JSON object: exact-time measurement OR whole-clip extrema, per clip, built from the SAME
 *  measure()/rigMeasurements()/spineDistribution() authority the text report renders -- this is
 *  exposure, not a competing anatomy definition (owner-plan.md section 19). */
export function jsonReport(path, glb, skel, axes, clips, { time, samples }) {
  const rest = measure(skel, forward(skel), axes);
  const result = {
    path,
    axes: {
      up: axes.up, lateral: axes.lateral, fwd: axes.fwd, faceAgrees: axes.faceAgrees, height: axes.height,
    },
    rest,
    rig: rigMeasurements(skel, glb),
    clips: {},
  };
  for (const clipName of clips) {
    const duration = clipDuration(glb, clipName);
    if (duration === null) { result.clips[clipName] = { present: false }; continue; }
    if (time !== undefined) {
      const measurement = measure(skel, forward(skel, poseAt(glb, skel, clipName, time)), axes);
      const spine = spineDistribution(skel, glb, clipName, [time]);
      result.clips[clipName] = {
        present: true, mode: 'time', t: time, duration, measurement, spine,
      };
    } else {
      const { times, frames } = sweepFrames(glb, skel, axes, clipName, samples);
      result.clips[clipName] = {
        present: true,
        mode: 'sweep',
        samples: times.length,
        duration,
        frames: times.map((t, i) => ({ t, ...frames[i] })),
        extrema: aggregateFrames(frames),
        spine: spineDistribution(skel, glb, clipName, times),
      };
    }
  }
  return result;
}

/** The human-readable report -- unchanged behavior/output from before --json/--sweep existed. */
function textReport(path, glb, skel, axes, clips) {
  console.log(`${path}`);
  console.log('  (+ tilt = character\'s LEFT side higher · abduction 0 = arm hangs at the side ·'
    + ' elbow 0 = locked straight · turn-out + = toes outward)');
  console.log(`  rest pose: up ${JSON.stringify(axes.up)}, forward [${axes.fwd.map((v) => v.toFixed(2))}],`
    + ` lateral [${axes.lateral.map((v) => v.toFixed(2))}]`);
  console.log(`  forward cross-check: the face marker agrees with the toes by ${axes.faceAgrees.toFixed(3)}`
    + ` ${axes.faceAgrees > 0.5 ? '(OK)' : '*** DISAGREE -- every angle below is on a suspect axis ***'}`);
  const rest = measure(skel, forward(skel), axes);
  console.log(`  REST (bind pose, no clip): arm abduction L ${rest.leftArm.abduction.toFixed(1)}° R ${rest.rightArm.abduction.toFixed(1)}°,`
    + ` elbow L ${rest.leftArm.elbow.toFixed(1)}° R ${rest.rightArm.elbow.toFixed(1)}°,`
    + ` turn-out L ${rest.leftTurnOut.toFixed(1)}° R ${rest.rightTurnOut.toFixed(1)}°,`
    + ` mirror residual ${rest.mirrorResidualPct.toFixed(2)}%`);
  console.log('  (turn-out is also shown below as a DELTA from this rest value: the rig\'s own ankle->ball'
    + ' bone is not the foot\'s long axis, so only the change is trustworthy.)\n');
  rigReport(skel, glb);

  for (const clipName of clips) {
    const anim = glb.json.animations.find((a) => a.name === clipName);
    if (!anim) { console.log(`  ${clipName}: absent`); continue; }
    const SAMPLES = 12;
    const { duration, times, frames } = sweepFrames(glb, skel, axes, clipName, SAMPLES);
    const at = (fn) => frames.map(fn);
    const range = (values) => Math.max(...values) - Math.min(...values);
    const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

    console.log(`  clip "${clipName}"  ${duration.toFixed(3)}s, ${SAMPLES} samples`);
    console.log(`    pelvis tilt        ${mean(at((x) => x.pelvisTilt)).toFixed(1).padStart(6)}°   (range ${range(at((x) => x.pelvisTilt)).toFixed(1)}°)`);
    console.log(`    shoulder tilt      ${mean(at((x) => x.shoulderTilt)).toFixed(1).padStart(6)}°   (range ${range(at((x) => x.shoulderTilt)).toFixed(1)}°)`);
    console.log(`    contrapposto       ${frames.filter((x) => x.contrapposto).length}/${SAMPLES} samples counter-tilted`);
    console.log(`    arm abduction    L ${mean(at((x) => x.leftArm.abduction)).toFixed(1).padStart(6)}°  R ${mean(at((x) => x.rightArm.abduction)).toFixed(1).padStart(6)}°`);
    console.log(`    elbow flexion    L ${mean(at((x) => x.leftArm.elbow)).toFixed(1).padStart(6)}°  R ${mean(at((x) => x.rightArm.elbow)).toFixed(1).padStart(6)}°`);
    console.log(`    foot turn-out    L ${(mean(at((x) => x.leftTurnOut)) - rest.leftTurnOut).toFixed(1).padStart(6)}°  R ${(mean(at((x) => x.rightTurnOut)) - rest.rightTurnOut).toFixed(1).padStart(6)}°   (change from rest)`);
    console.log(`    stance / hip width ${mean(at((x) => x.stanceOverHip)).toFixed(2).padStart(6)}    heel height diff ${mean(at((x) => x.heelDropPct)).toFixed(2)}% of height`);
    console.log(`    mirror residual    ${mean(at((x) => x.mirrorResidualPct)).toFixed(2).padStart(6)}% of height   (0 = perfectly symmetric)`);
    console.log(`    head fwd of hips   ${mean(at((x) => x.headOverHipsPct)).toFixed(2).padStart(6)}% of height`);
    console.log(`    hips height        ${mean(at((x) => x.hipsHeightPct)).toFixed(1).padStart(6)}% of height   (range over clip ${range(at((x) => x.hipsHeightPct)).toFixed(2)}%)`);
    const spine = spineDistribution(skel, glb, clipName, times);
    const worst = spine.reduce((a, b) => (b.share > a.share ? b : a));
    console.log(`    trunk rotation shared along the spine chain:`);
    for (const r of spine) {
      const bar = '#'.repeat(Math.round(r.share / 3));
      console.log(`      ${r.name.padEnd(8)} ${r.deg.toFixed(1).padStart(6)}°  ${r.share.toFixed(1).padStart(5)}%  ${bar}`);
    }
    console.log(`      -> ${worst.name} carries ${worst.share.toFixed(1)}% of it`
      + `${worst.share > 50 ? '  *** HINGE: the trunk is pivoting on one joint ***' : ''}`);
    console.log('');
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const {
    path, wanted, json, sweep, time, samples,
  } = args;
  if (!path) {
    console.error('usage: node tools/foundry/pose_anatomy.mjs <file.glb> [clipName ...] [--json] [--time <seconds>] [--sweep] [--samples <n>]');
    process.exit(2);
  }
  if (json && requiresContentMode(time, sweep)) {
    console.error('--json requires either --time <seconds> or --sweep');
    process.exit(2);
  }

  const glb = readGlb(path);
  const skel = skeleton(glb);
  const axes = axesFromRest(skel);
  const clips = wanted.length ? wanted : glb.json.animations.map((a) => a.name);

  if (json) {
    console.log(JSON.stringify(jsonReport(path, glb, skel, axes, clips, { time, samples }), null, 2));
  } else {
    textReport(path, glb, skel, axes, clips);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
