#!/usr/bin/env node
/**
 * Validate the SHIPPING GLB with a reader that is not Blender.
 *
 *   node tools/foundry/verify-glb.mjs --glb <file.glb> --build-report <file.json> --manifest <file.json>
 *   node tools/foundry/verify-glb.mjs --self-test --glb ... --build-report ... --manifest ...
 *
 * Why this exists next to the gate harness rather than inside it: every gate in `gates.py` runs against
 * a `.blend` in Blender's memory. G22 in particular claims "all materials round-trip to glTF" by looking
 * at Blender node types — it does not open the exported file. So the artifact the game actually loads
 * was, until this script, checked by nothing at all. A mesh can pass all 27 gates and still ship a GLB
 * with a fifth skin influence in JOINTS_1, a joint index past the end of the skin, or an atlas that got
 * re-encoded on the way out.
 *
 * Two things are checked that only a second reader can check:
 *
 *  1. The file parses at all outside Blender.
 *  2. It survives a ROUND TRIP — read, write, read again, and every accessor's numbers are unchanged.
 *     A file that only Blender's own reader understands would pass step 1 and fail this.
 *
 * The rest compare the file against the build's own written claims (`build_report.json`,
 * `topology_template.json`) rather than against constants repeated here. A validator holding its own
 * copy of the expected numbers drifts from the build silently; one that reads the build's claim fails
 * the moment the build and the artifact disagree.
 *
 * `--self-test` proves each check can fail, by mutating the real document one way per check and
 * asserting that check flips. Same principle as `prove_gates.py`: a check nothing can break is not a
 * check. Collateral failures are recorded rather than pretended away — removing a UV set breaks the
 * attribute check and the atlas check together, because a mesh with no UVs has nothing to sample.
 */

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const REPO = resolve(HERE, '..', '..');

// @gltf-transform/core 4.4.2 is already pinned and installed in tools/teardown. Resolving it from there
// rather than adding a second copy: two installs of the same library are two versions waiting to drift,
// and this machine takes about six minutes per npm registry lookup.
const TEARDOWN = join(REPO, 'tools', 'teardown');
let core;
try {
  const require = createRequire(pathToFileURL(join(TEARDOWN, 'package.json')).href);
  core = await import(pathToFileURL(require.resolve('@gltf-transform/core')).href);
} catch (err) {
  console.error(
    '@gltf-transform/core could not be resolved from tools/teardown.\n'
    + 'Run `npm install` in tools/teardown first — the version is pinned there at 4.4.2.\n'
    + `Underlying error: ${err.message}`,
  );
  process.exit(2);
}
const { NodeIO } = core;

const require = createRequire(import.meta.url);
const { decodePng } = require('../decision-lab/measure-silhouette.mjs');

// Same rule as G20 in gates.py. Repeated deliberately: this script must be able to run against a GLB
// with no .blend and no Blender present.
const NAME_OK = /^[A-Za-z][A-Za-z0-9_]*$/;
const MAX_INFLUENCES = 4;
const WEIGHT_TOLERANCE = 1e-3;
const MAX_ATLAS_PX = 1024;

// ── arguments ─────────────────────────────────────────────────────────────────────────────────────

function arg(name, required = true) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) {
    if (!required) return null;
    console.error('usage: node tools/foundry/verify-glb.mjs --glb <f> --build-report <f> --manifest <f> '
      + '[--out <f>] [--self-test]');
    process.exit(2);
  }
  return process.argv[i + 1];
}

const glbPath = arg('glb');
const reportPath = arg('build-report');
const manifestPath = arg('manifest');
const outPath = arg('out', false);
const selfTest = process.argv.includes('--self-test');

// ── reading the document ──────────────────────────────────────────────────────────────────────────

const io = new NodeIO();
const glbBytes = readFileSync(glbPath);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

/** Every primitive in the file, with its owning mesh, so an error can say where it is. */
function primitives(doc) {
  return doc.getRoot().listMeshes().flatMap(
    (mesh) => mesh.listPrimitives().map((prim) => ({ mesh, prim })),
  );
}

/** Dequantised per-vertex skin influences: [{joint, weight}, …] for each vertex, zeroes dropped. */
function influences(prim) {
  const joints = prim.getAttribute('JOINTS_0');
  const weights = prim.getAttribute('WEIGHTS_0');
  if (!joints || !weights) return [];
  const count = joints.getCount();
  const out = [];
  for (let v = 0; v < count; v++) {
    const j = joints.getElement(v, [0, 0, 0, 0]);
    const w = weights.getElement(v, [0, 0, 0, 0]);
    out.push(j.map((joint, k) => ({ joint, weight: w[k] })).filter((inf) => inf.weight > 0));
  }
  return out;
}

/** All accessor arrays in document order, which is what a round trip has to preserve. */
function accessorData(doc) {
  return doc.getRoot().listAccessors().map((a) => ({
    name: a.getName(),
    type: a.getType(),
    componentType: a.getComponentType(),
    array: a.getArray(),
  }));
}

// ── the checks ────────────────────────────────────────────────────────────────────────────────────
//
// Each is a pure function of the context, returning {pass, detail, …}. Pure so that --self-test can
// mutate the context and re-run one check without rebuilding anything.

const CHECKS = [
  {
    id: 'R1',
    what: 'the GLB parses outside Blender',
    run: ({ doc }) => {
      const root = doc.getRoot();
      return {
        pass: root.listMeshes().length > 0,
        detail: `${root.listMeshes().length} meshes, ${root.listNodes().length} nodes, `
          + `${root.listSkins().length} skins, ${root.listMaterials().length} materials`,
      };
    },
  },
  {
    id: 'R2',
    what: 'read → write → read leaves every accessor unchanged',
    why: 'A file only Blender can read would parse here and still fail this.',
    run: ({ doc, roundTripped }) => {
      const before = accessorData(doc);
      const after = accessorData(roundTripped);
      if (before.length !== after.length) {
        return { pass: false, detail: `${before.length} accessors in, ${after.length} out` };
      }
      for (let i = 0; i < before.length; i++) {
        const a = before[i];
        const b = after[i];
        if (a.type !== b.type || a.componentType !== b.componentType) {
          return { pass: false, detail: `accessor ${i} (${a.name}) changed type: ${a.type}/${a.componentType} → ${b.type}/${b.componentType}` };
        }
        if (a.array.length !== b.array.length) {
          return { pass: false, detail: `accessor ${i} (${a.name}) changed length: ${a.array.length} → ${b.array.length}` };
        }
        for (let k = 0; k < a.array.length; k++) {
          if (a.array[k] !== b.array[k]) {
            return {
              pass: false,
              detail: `accessor ${i} (${a.name}) element ${k}: ${a.array[k]} → ${b.array[k]}`,
            };
          }
        }
      }
      const elements = before.reduce((s, a) => s + a.array.length, 0);
      return { pass: true, detail: `${before.length} accessors, ${elements} numbers, all identical` };
    },
  },
  {
    id: 'R3',
    what: 'exactly one skin, and every joint that actually deforms is a DEF_ bone',
    why: 'An exporter may include control bones as joints. What matters is which joints carry weight.',
    run: ({ doc, report: rep }) => {
      const skins = doc.getRoot().listSkins();
      if (skins.length !== 1) return { pass: false, detail: `${skins.length} skins, expected exactly 1` };
      const joints = skins[0].listJoints();
      const weighted = new Set();
      for (const { prim } of primitives(doc)) {
        for (const per of influences(prim)) for (const inf of per) weighted.add(inf.joint);
      }
      const names = [...weighted].sort((a, b) => a - b).map((i) => joints[i]?.getName() ?? `<index ${i} past the end of the skin>`);
      const notDef = names.filter((n) => !n.startsWith('DEF_'));
      const expected = rep.mesh.deformBones;
      const problems = [];
      if (weighted.size !== expected) {
        problems.push(`${weighted.size} joints carry weight, the build reports ${expected} deform bones`);
      }
      if (notDef.length) problems.push(`weighted joints without a DEF_ prefix: ${notDef.join(', ')}`);
      return {
        pass: problems.length === 0,
        detail: problems.length ? problems.join('; ')
          : `${joints.length} joints in the skin, ${weighted.size} carry weight, all DEF_`,
        weightedJoints: names,
      };
    },
  },
  {
    id: 'R4',
    what: 'no JOINTS_1 / WEIGHTS_1',
    why: 'Three.js reads skin indices into a Vector4. A second set is dropped silently, so a mesh that '
      + 'needs one animates wrongly in the game and correctly in every viewer that reads it.',
    run: ({ doc }) => {
      const extra = [];
      for (const { mesh, prim } of primitives(doc)) {
        for (const semantic of prim.listSemantics()) {
          if (/^(JOINTS|WEIGHTS)_[1-9]/.test(semantic)) extra.push(`${mesh.getName()}.${semantic}`);
        }
      }
      return {
        pass: extra.length === 0,
        detail: extra.length ? `a fifth influence is present as ${extra.join(', ')}` : 'one influence set only',
      };
    },
  },
  {
    id: 'R5',
    what: 'exported weights are normalised and within the influence cap',
    why: 'Blender normalises before quantising. This checks what the file says, after quantising.',
    run: ({ doc }) => {
      let worstSumError = 0;
      let worstSumAt = -1;
      let maxInfluences = 0;
      let overCap = 0;
      for (const { prim } of primitives(doc)) {
        influences(prim).forEach((per, v) => {
          const sum = per.reduce((s, inf) => s + inf.weight, 0);
          const err = Math.abs(sum - 1);
          if (err > worstSumError) { worstSumError = err; worstSumAt = v; }
          if (per.length > maxInfluences) maxInfluences = per.length;
          if (per.length > MAX_INFLUENCES) overCap++;
        });
      }
      const pass = worstSumError <= WEIGHT_TOLERANCE && overCap === 0;
      return {
        pass,
        detail: `worst weight sum error ${worstSumError.toExponential(2)} at vertex ${worstSumAt} `
          + `(tolerance ${WEIGHT_TOLERANCE}); max ${maxInfluences} influences, cap ${MAX_INFLUENCES}`
          + (overCap ? `; ${overCap} vertices over the cap` : ''),
        maxInfluences,
      };
    },
  },
  {
    id: 'R6',
    what: 'every joint index points inside the skin',
    why: 'An index past the end is undefined behaviour: some readers clamp, some render nothing.',
    run: ({ doc }) => {
      const jointCount = doc.getRoot().listSkins()[0]?.listJoints().length ?? 0;
      const bad = [];
      for (const { prim } of primitives(doc)) {
        influences(prim).forEach((per, v) => {
          for (const inf of per) if (inf.joint >= jointCount || inf.joint < 0) bad.push({ vertex: v, joint: inf.joint });
        });
      }
      return {
        pass: bad.length === 0,
        detail: bad.length
          ? `${bad.length} out-of-range indices, first ${JSON.stringify(bad[0])}, skin has ${jointCount} joints`
          : `all indices inside [0, ${jointCount})`,
      };
    },
  },
  {
    id: 'R7',
    what: 'POSITION, NORMAL and TEXCOORD_0 on every primitive, mode TRIANGLES, UVs inside [0,1]',
    run: ({ doc }) => {
      const problems = [];
      for (const { mesh, prim } of primitives(doc)) {
        for (const semantic of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
          if (!prim.getAttribute(semantic)) problems.push(`${mesh.getName()} has no ${semantic}`);
        }
        if (prim.getMode() !== 4) problems.push(`${mesh.getName()} mode is ${prim.getMode()}, expected 4 (TRIANGLES)`);
        const uv = prim.getAttribute('TEXCOORD_0');
        if (uv) {
          const a = uv.getArray();
          const lo = Math.min(...a);
          const hi = Math.max(...a);
          if (lo < -1e-6 || hi > 1 + 1e-6) problems.push(`${mesh.getName()} UVs span [${lo.toFixed(4)}, ${hi.toFixed(4)}], outside the atlas`);
        }
      }
      return {
        pass: problems.length === 0,
        detail: problems.length ? problems.join('; ') : `${primitives(doc).length} primitives, all complete`,
      };
    },
  },
  {
    id: 'R8',
    what: 'the triangle count is exactly twice the quad count the build reports',
    why: 'glTF has no quads. Two triangles per quad and nothing else is what proves the export '
      + 'triangulated a pure-quad mesh rather than applying a modifier on the way out (G23).',
    run: ({ doc, report: rep }) => {
      let tris = 0;
      for (const { prim } of primitives(doc)) {
        const indices = prim.getIndices();
        const count = indices ? indices.getCount() : prim.getAttribute('POSITION').getCount();
        if (count % 3) return { pass: false, detail: `index count ${count} is not a multiple of 3` };
        tris += count / 3;
      }
      const expected = rep.mesh.quads * 2 + rep.mesh.triangles;
      return {
        pass: tris === expected,
        detail: `${tris} triangles in the file, ${expected} expected from `
          + `${rep.mesh.quads} quads + ${rep.mesh.triangles} triangles`,
      };
    },
  },
  {
    id: 'R9',
    what: 'the vertex count did not shrink on export',
    why: 'It is allowed to GROW: a glTF vertex carries one normal and one UV, so the exporter splits '
      + 'vertices along seams. Shrinking would mean geometry was merged away, which nothing else notices.',
    run: ({ doc, report: rep }) => {
      const exported = primitives(doc)
        .reduce((s, { prim }) => s + prim.getAttribute('POSITION').getCount(), 0);
      const authored = rep.mesh.verts;
      return {
        pass: exported >= authored,
        detail: `${exported} exported against ${authored} authored `
          + `(${((exported / authored - 1) * 100).toFixed(1)}% split at seams)`,
      };
    },
  },
  {
    id: 'R10',
    what: 'one material, one image, within the atlas budget',
    run: ({ doc }) => {
      const materials = doc.getRoot().listMaterials();
      const textures = doc.getRoot().listTextures();
      const problems = [];
      if (materials.length !== 1) problems.push(`${materials.length} materials, expected 1`);
      if (textures.length !== 1) problems.push(`${textures.length} images, expected 1`);
      const sizes = [];
      for (const tex of textures) {
        const image = tex.getImage();
        if (!image) { problems.push(`texture ${tex.getName()} carries no image data`); continue; }
        const { width, height } = decodePng(Buffer.from(image));
        sizes.push(`${width}x${height}`);
        if (Math.max(width, height) > MAX_ATLAS_PX) {
          problems.push(`image ${tex.getName()} is ${width}x${height}, over the ${MAX_ATLAS_PX} budget`);
        }
      }
      return {
        pass: problems.length === 0,
        detail: problems.length ? problems.join('; ')
          : `1 material, 1 image ${sizes.join('')}, within ${MAX_ATLAS_PX}px`,
      };
    },
  },
  {
    id: 'R11',
    what: 'every name in the file is export-safe',
    why: 'Same rule as G20, applied to the file rather than to the .blend.',
    run: ({ doc }) => {
      const root = doc.getRoot();
      const named = [
        ...root.listNodes(), ...root.listMeshes(), ...root.listMaterials(),
        ...root.listSkins(), ...root.listAnimations(),
      ];
      const bad = named.map((o) => o.getName()).filter((n) => n && !NAME_OK.test(n));
      return {
        pass: bad.length === 0,
        detail: bad.length ? `${bad.length} unsafe: ${bad.slice(0, 8).join(', ')}` : `${named.length} names, all safe`,
      };
    },
  },
  {
    id: 'R12',
    what: 'no morph targets',
    why: 'G26 says vertex order is still free to change, which is only true while nothing depends on it.',
    run: ({ doc }) => {
      const withTargets = primitives(doc)
        .filter(({ prim }) => prim.listTargets().length > 0).length;
      return {
        pass: withTargets === 0,
        detail: withTargets ? `${withTargets} primitives carry morph targets` : 'none',
      };
    },
  },
  {
    id: 'R13',
    what: 'the shipped file is Y-up, the locked height landed on Y, and X is still symmetric',
    why: 'The project authors in +Z up; glTF is +Y up and the exporter rotates. This is the only check '
      + 'that the conversion happened and that 3.84 survived it.\n'
      + '             The first version of this check asked whether Y was the LARGEST extent, and failed '
      + 'a correct file: in a T-pose the arm span is 3.2 against a height of 2.28, so the largest extent '
      + 'is X. Three exact properties replace that guess.',
    run: ({ doc, manifest: man }) => {
      const locked = man.lockedHeadsTallHairIncluded;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const { prim } of primitives(doc)) {
        const pos = prim.getAttribute('POSITION');
        for (let v = 0; v < pos.getCount(); v++) {
          const p = pos.getElement(v, [0, 0, 0]);
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], p[k]);
            max[k] = Math.max(max[k], p[k]);
          }
        }
      }
      // float32 storage, so the comparisons are to single precision and not tighter.
      const heightErr = Math.abs(max[1] - locked);
      const symmetryErr = Math.abs(max[0] + min[0]);
      const problems = [];
      if (heightErr >= 1e-5) problems.push(`max Y is ${max[1].toFixed(6)}, not the locked ${locked}`);
      if (min[1] < 0) problems.push(`min Y is ${min[1].toFixed(6)}, below the ground plane`);
      if (symmetryErr >= 1e-5) problems.push(`X spans ${min[0].toFixed(6)}..${max[0].toFixed(6)}, not symmetric about 0`);
      if (Math.abs(max[2] - locked) < 1e-5 || Math.abs(max[0] - locked) < 1e-5) {
        problems.push('the locked height also appears on another axis, so which one is up is ambiguous');
      }
      return {
        pass: problems.length === 0,
        detail: problems.length ? problems.join('; ')
          : `min [${min.map((v) => v.toFixed(4))}] max [${max.map((v) => v.toFixed(4))}]: height on Y `
            + `to ${heightErr.toExponential(2)}, X symmetric to ${symmetryErr.toExponential(2)}`,
      };
    },
  },
  {
    id: 'R14',
    what: 'the GLB on disk is the one the build hashed',
    why: 'Cheap, and it stops this whole script from validating a file the build never produced — the '
      + 'same stale-artifact trap that the missing --python-exit-code caused in the Blender steps.',
    run: ({ glbBytes: bytes, report: rep }) => {
      const sha = createHash('sha256').update(bytes).digest('hex');
      const claimed = rep.determinismHashes.glbSha256;
      return {
        pass: sha === claimed,
        detail: sha === claimed ? `sha256 ${sha.slice(0, 16)}… matches build_report.json`
          : `sha256 ${sha.slice(0, 16)}… but the build reports ${claimed.slice(0, 16)}…`,
      };
    },
  },
];

// ── running ───────────────────────────────────────────────────────────────────────────────────────

async function context() {
  const doc = await io.readBinary(new Uint8Array(glbBytes));
  const roundTripped = await io.readBinary(await io.writeBinary(doc));
  return { doc, roundTripped, report, manifest, glbBytes };
}

function runAll(ctx) {
  return CHECKS.map((check) => {
    let outcome;
    try {
      outcome = check.run(ctx);
    } catch (err) {
      // A check that throws is a failure, never a skip. Swallowing it here would turn a broken
      // validator into a clean report.
      outcome = { pass: false, detail: `the check itself raised: ${err.message}` };
    }
    return { id: check.id, what: check.what, ...outcome };
  });
}

if (!selfTest) {
  const ctx = await context();
  const results = runAll(ctx);
  for (const r of results) {
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.what}`);
    console.log(`             ${r.detail}`);
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${failed.length === 0 ? 'GLB VALID' : 'GLB INVALID'}: ${results.length - failed.length}/${results.length} checks passed`);
  if (outPath) {
    writeFileSync(outPath, `${JSON.stringify({
      formatVersion: 1,
      glb: glbPath,
      reader: '@gltf-transform/core 4.4.2, resolved from tools/teardown',
      checks: results,
      valid: failed.length === 0,
    }, null, 2)}\n`);
    console.log(`wrote ${outPath}`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

// ── proving each check can fail ───────────────────────────────────────────────────────────────────
//
// One mutation per check, applied to a freshly read copy of the real document. The named check must
// flip from PASS to FAIL. Collateral failures are printed, not hidden: some mutations cannot be
// surgical — a primitive with no UVs breaks the attribute check and the atlas check at once.

const MUTATIONS = [
  {
    target: 'R2',
    why: 'perturb one number AFTER the round trip, which is exactly what the comparison is for',
    apply: (ctx) => {
      const a = ctx.roundTripped.getRoot().listAccessors()[0].getArray();
      a[0] += 1;
    },
  },
  {
    target: 'R3',
    why: 'move every weight off one joint, so nine joints deform where the build claims ten',
    apply: (ctx) => {
      const { prim } = primitives(ctx.doc)[0];
      const joints = prim.getAttribute('JOINTS_0');
      const weights = prim.getAttribute('WEIGHTS_0');
      // Pick the joint with the fewest weighted vertices, so the mutation stays small.
      const tally = new Map();
      influences(prim).forEach((per) => per.forEach((inf) => tally.set(inf.joint, (tally.get(inf.joint) ?? 0) + 1)));
      const victim = [...tally.entries()].sort((a, b) => a[1] - b[1])[0][0];
      for (let v = 0; v < joints.getCount(); v++) {
        const j = joints.getElement(v, [0, 0, 0, 0]);
        const w = weights.getElement(v, [0, 0, 0, 0]);
        const at = j.indexOf(victim);
        if (at < 0 || w[at] === 0) continue;
        const other = w.findIndex((x, k) => k !== at && x > 0);
        if (other < 0) { w[at] = 0; j[at] = j[(at + 1) % 4]; } else { w[other] += w[at]; w[at] = 0; }
        joints.setElement(v, j);
        weights.setElement(v, w);
      }
    },
  },
  {
    target: 'R4',
    why: 'add the fifth influence three.js would drop',
    apply: (ctx) => {
      const { prim } = primitives(ctx.doc)[0];
      const joints = prim.getAttribute('JOINTS_0');
      const weights = prim.getAttribute('WEIGHTS_0');
      prim.setAttribute('JOINTS_1', joints.clone());
      prim.setAttribute('WEIGHTS_1', weights.clone());
    },
  },
  {
    target: 'R5',
    why: 'halve one vertex\'s weights, which is the shape a normalisation bug takes',
    apply: (ctx) => {
      const { prim } = primitives(ctx.doc)[0];
      const weights = prim.getAttribute('WEIGHTS_0');
      const w = weights.getElement(0, [0, 0, 0, 0]);
      weights.setElement(0, w.map((x) => x * 0.5));
    },
  },
  {
    target: 'R6',
    why: 'point one influence past the end of the skin',
    apply: (ctx) => {
      const { prim } = primitives(ctx.doc)[0];
      const joints = prim.getAttribute('JOINTS_0');
      const skin = ctx.doc.getRoot().listSkins()[0];
      const j = joints.getElement(0, [0, 0, 0, 0]);
      j[0] = skin.listJoints().length + 5;
      joints.setElement(0, j);
    },
  },
  {
    target: 'R7',
    why: 'drop the UV set',
    apply: (ctx) => {
      const { prim } = primitives(ctx.doc)[0];
      prim.setAttribute('TEXCOORD_0', null);
    },
  },
  {
    target: 'R8',
    why: 'claim one more quad than was built, so the file and the claim disagree',
    apply: (ctx) => { ctx.report = { ...ctx.report, mesh: { ...ctx.report.mesh, quads: ctx.report.mesh.quads + 1 } }; },
  },
  {
    target: 'R9',
    // Doubling was not enough and the self-test said so: the export splits seams so heavily that
    // 2 x authored is still below the exported count. A quad mesh cannot split past 4 corners per quad,
    // so 8 x authored is above any legitimate split.
    why: 'claim eight times the authored vertices, which is what merged geometry would look like',
    apply: (ctx) => { ctx.report = { ...ctx.report, mesh: { ...ctx.report.mesh, verts: ctx.report.mesh.verts * 8 } }; },
  },
  {
    target: 'R10',
    why: 'add a second material',
    apply: (ctx) => { ctx.doc.createMaterial('Second'); },
  },
  {
    target: 'R11',
    why: 'give a node a name a glTF consumer cannot address',
    apply: (ctx) => { ctx.doc.getRoot().listNodes()[0].setName('hero mesh!'); },
  },
  {
    target: 'R12',
    why: 'attach a morph target',
    apply: (ctx) => {
      const { prim } = primitives(ctx.doc)[0];
      const target = ctx.doc.createPrimitiveTarget()
        .setAttribute('POSITION', prim.getAttribute('POSITION').clone());
      prim.addTarget(target);
    },
  },
  {
    target: 'R13',
    why: 'shift the mesh up, so the locked height no longer lands on 3.84',
    apply: (ctx) => {
      for (const { prim } of primitives(ctx.doc)) {
        const pos = prim.getAttribute('POSITION');
        for (let v = 0; v < pos.getCount(); v++) {
          const p = pos.getElement(v, [0, 0, 0]);
          p[1] += 0.5;
          pos.setElement(v, p);
        }
      }
    },
  },
  {
    target: 'R14',
    why: 'a byte that the build never hashed',
    apply: (ctx) => { ctx.glbBytes = Buffer.concat([ctx.glbBytes, Buffer.from([0])]); },
  },
  {
    target: 'R1',
    why: 'a document with no meshes at all',
    apply: (ctx) => { for (const mesh of ctx.doc.getRoot().listMeshes()) mesh.dispose(); },
  },
];

const baseline = runAll(await context());
const baselineFailed = baseline.filter((r) => !r.pass);
for (const r of baseline) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail}`);
if (baselineFailed.length) {
  console.log(`\nSELF-TEST ABORTED: the real GLB fails ${baselineFailed.map((r) => r.id).join(', ')}, `
    + 'so no mutation can prove anything. Fix the artifact first.');
  process.exit(1);
}
console.log(`\nbaseline: all ${baseline.length} checks pass. Now breaking each one.\n`);

const unproven = new Set(CHECKS.map((c) => c.id));
let mutationFailures = 0;
for (const mutation of MUTATIONS) {
  const ctx = await context();
  mutation.apply(ctx);
  const results = runAll(ctx);
  const targeted = results.find((r) => r.id === mutation.target);
  const collateral = results.filter((r) => !r.pass && r.id !== mutation.target).map((r) => r.id);
  const flipped = targeted && !targeted.pass;
  if (flipped) unproven.delete(mutation.target);
  else mutationFailures++;
  console.log(`  ${flipped ? 'BROKE ' : 'MISSED'}  ${mutation.target}  ${mutation.why}`);
  console.log(`             ${targeted?.detail ?? 'no such check'}`);
  if (collateral.length) console.log(`             collateral: ${collateral.join(', ')}`);
}

console.log('');
if (unproven.size) {
  console.log(`SELF-TEST FAILED: ${[...unproven].join(', ')} survived every mutation, so nothing here `
    + 'shows they can fail.');
  process.exit(1);
}
if (mutationFailures) {
  console.log(`SELF-TEST FAILED: ${mutationFailures} mutations did not break their target.`);
  process.exit(1);
}
console.log(`SELF-TEST PASSED: the real GLB passes all ${CHECKS.length} checks, and each one was broken `
  + `by a mutation (${MUTATIONS.length} mutations).`);
