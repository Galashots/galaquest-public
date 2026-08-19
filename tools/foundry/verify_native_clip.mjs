#!/usr/bin/env node
/**
 * Is this animation GLB genuinely NATIVE to the body we intend to ship?
 *
 *   node tools/foundry/verify_native_clip.mjs --body <accepted-body.glb> --clip <candidate.glb> ...
 *
 * WHY THIS EXISTS. Phase C1 planned to graft Keeper v1's `idle` and `wave` onto Keeper v2. The two
 * share all 24 joint names, the same parent hierarchy AND the same joint order -- and are still
 * different skeletons. Meshy animation GLBs carry a translation track on every joint, and a joint's
 * local translation IS its bone, so binding v1's clip to v2 re-proportioned v2 every frame: forearms
 * +45%, feet +51%, shoulders halved. `merge_clips.mjs` now refuses that at merge time. This runs
 * EARLIER, at acceptance time, on a file that just arrived from the owner, and it checks the things
 * merge_clips cannot: the full joint set and order, not only the nodes one clip happens to drive.
 *
 * The point is that "it came back from Meshy for this character" is a claim, not a fact. A clip
 * generated against a re-rig, or against a different model, arrives looking exactly like a good one.
 *
 * Exits 0 when every candidate is native to the body, 1 otherwise.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const JSON_CHUNK = 0x4e4f534a;

// A bone length may differ by this fraction and still count as the same rig. Meshy round-trips a
// rest pose through float32 more than once, so exact equality is too strict; every same-rig pair
// measured in this repo came in at 0.000%, and every different-rig pair at over 20%.
const REST_TOLERANCE = 0.001;
const ANGLE_TOLERANCE_DEG = 0.5;

function readGlbJson(path) {
  const bytes = readFileSync(path);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    if (bytes.readUInt32LE(offset + 4) === JSON_CHUNK) {
      return JSON.parse(bytes.subarray(offset + 8, offset + 8 + length).toString('utf8'));
    }
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  throw new Error(`${path}: no JSON chunk`);
}

/** Joint list in skin order, each with its parent's NAME and its rest TRS. */
export function rigOf(json) {
  if (!json.skins?.length) throw new Error('no skin');
  const parentOf = new Map();
  json.nodes.forEach((n, i) => { for (const c of n.children ?? []) parentOf.set(c, i); });
  return json.skins[0].joints.map((index) => {
    const node = json.nodes[index];
    const parent = parentOf.get(index);
    return {
      name: node.name,
      parent: parent === undefined ? null : json.nodes[parent].name,
      translation: node.translation ?? [0, 0, 0],
      rotation: node.rotation ?? [0, 0, 0, 1],
    };
  });
}

/**
 * The two questions this tool can be asked, which are NOT the same question.
 *
 * `strict` -- "did this file come off the very same rig?" A reordered joint array is real evidence
 * that something was re-rigged or re-exported by another program, and for an incoming vendor file
 * that is exactly the signal we want to fail on.
 *
 * `donor` -- "can this file's animation be lifted onto that body?" Here joint order is noise.
 * three.js binds animation tracks by node NAME (`PropertyBinding`), and `merge_clips.mjs` remaps
 * channels by node name into the pristine target, so the donor's own skin ordering never reaches the
 * shipped asset. Blender's glTF exporter reorders the array on a no-op round trip while leaving the
 * rest skeleton intact to 0.003% -- measured on Keeper v2 in phase AP1 -- and failing that is a
 * false negative that would block authoring our own clips for no mechanical reason.
 *
 * EVERYTHING ELSE IS A HARD FAIL IN BOTH MODES. Missing or extra joints, a changed parent, a
 * different rest bone length, a different rest rotation. Those are the differences that actually
 * re-proportion a character, and the Keeper v1 -> v2 graft this tool was built to stop fails on rest
 * bone length, not on order -- so donor mode does not weaken it by even one joint.
 */
export const MODES = Object.freeze(['strict', 'donor']);

/** Difference kinds, tagged so a caller can decide severity instead of parsing English. */
export const ORDER = 'order';

/**
 * Every way the candidate's rig differs from the body's, as `{ kind, message }`.
 *
 * `kind` is `'order'` for a joint-array permutation and `'rest'` for everything else. Only the
 * former is mode-dependent; splitting it any finer would invite a future mode that downgrades
 * something load-bearing.
 */
export function rigComparison(bodyRig, clipRig) {
  const problems = [];
  const bodyNames = bodyRig.map((j) => j.name);
  const clipNames = clipRig.map((j) => j.name);

  const missing = bodyNames.filter((n) => !clipNames.includes(n));
  const extra = clipNames.filter((n) => !bodyNames.includes(n));
  if (missing.length) problems.push({ kind: 'rest', message: `joints missing from the clip: ${missing.join(', ')}` });
  if (extra.length) problems.push({ kind: 'rest', message: `joints the body does not have: ${extra.join(', ')}` });
  if (missing.length || extra.length) return problems; // order and rest comparisons are meaningless now

  for (let i = 0; i < bodyNames.length; i += 1) {
    if (bodyNames[i] !== clipNames[i]) {
      problems.push({
        kind: ORDER,
        message: `joint order differs at index ${i}: body has ${bodyNames[i]}, clip has ${clipNames[i]}`,
      });
      break; // one is enough; listing 24 reorderings helps nobody
    }
  }

  const clipByName = new Map(clipRig.map((j) => [j.name, j]));
  for (const joint of bodyRig) {
    const twin = clipByName.get(joint.name);
    if (twin.parent !== joint.parent) {
      problems.push({
        kind: 'rest',
        message: `${joint.name}: parent is ${twin.parent ?? 'none'} in the clip, ${joint.parent ?? 'none'} in the body`,
      });
      continue;
    }
    const a = Math.hypot(...joint.translation);
    const b = Math.hypot(...twin.translation);
    if (Math.max(a, b) > 1e-9 && Math.abs(a - b) > REST_TOLERANCE * Math.max(a, b)) {
      problems.push({
        kind: 'rest',
        message: `${joint.name}: rest bone is ${a.toFixed(4)} on the body and ${b.toFixed(4)} in the clip`
          + ` (x${(b / (a || 1e-9)).toFixed(2)}) -- a translation track would re-proportion the body`,
      });
      continue;
    }
    const [q, r] = [joint.rotation, twin.rotation];
    const d = Math.min(1, Math.abs(q[0] * r[0] + q[1] * r[1] + q[2] * r[2] + q[3] * r[3]));
    const degrees = 2 * Math.acos(d) * (180 / Math.PI);
    if (degrees > ANGLE_TOLERANCE_DEG) {
      problems.push({ kind: 'rest', message: `${joint.name}: rest rotation differs by ${degrees.toFixed(2)} degrees` });
    }
  }
  return problems;
}

/**
 * Split a comparison into what fails and what is merely worth saying, for a given mode.
 *
 * Note `warnings` is always empty in strict mode by construction: strict has nothing it forgives.
 */
export function verdict(problems, mode = 'strict') {
  if (!MODES.includes(mode)) throw new Error(`unknown mode ${mode} -- expected one of ${MODES.join(', ')}`);
  const forgiven = mode === 'donor' ? (p) => p.kind === ORDER : () => false;
  const failures = problems.filter((p) => !forgiven(p));
  const warnings = problems.filter(forgiven);
  return { ok: failures.length === 0, failures, warnings };
}

/**
 * The original string-list view, kept because it is the shape callers and tests already use, and
 * because a strict comparison is still the right default for anything arriving from outside.
 */
export function rigDifferences(bodyRig, clipRig) {
  return rigComparison(bodyRig, clipRig).map((p) => p.message);
}

// Run the CLI only when this file IS the entry point, so `test/` can import the two pure functions
// above. Compared by filename rather than by URL: on Windows `process.argv[1]` is a backslash path
// and `import.meta.url` is a `file:///C:/...` URL, and the two never compare equal.
if (process.argv[1]?.endsWith('verify_native_clip.mjs')) {
  const args = process.argv.slice(2);
  const bodyPath = args[args.indexOf('--body') + 1];
  const clipPaths = args.reduce((list, arg, i) => (arg === '--clip' ? [...list, args[i + 1]] : list), []);
  // Strict by default, deliberately. A file arriving from a vendor is asked the harder question
  // unless the operator says otherwise, so forgetting the flag can never let a re-rig through.
  const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'strict';
  if (!bodyPath || !clipPaths.length || !MODES.includes(mode)) {
    console.error('usage: verify_native_clip.mjs --body <body.glb> --clip <candidate.glb> [--clip ...]'
      + `\n                              [--mode ${MODES.join('|')}]   (default strict)`
      + '\n\n  strict  did this file come off the very same rig?  (joint order matters)'
      + '\n  donor   can its animation be lifted onto that body?  (joint order does not)');
    process.exit(2);
  }

  const bodyJson = readGlbJson(bodyPath);
  const bodyRig = rigOf(bodyJson);
  console.log(`body  ${basename(bodyPath)} -- ${bodyRig.length} joints    mode: ${mode}`);

  let failures = 0;
  for (const clipPath of clipPaths) {
    const json = readGlbJson(clipPath);
    const { ok, failures: fails, warnings } = verdict(rigComparison(bodyRig, rigOf(json)), mode);
    const clips = (json.animations ?? []).map((a) => a.name);
    console.log(`\nclip  ${basename(clipPath)}`);
    console.log(`  animations: ${clips.length ? clips.join(', ') : '(none -- this file carries no clip)'}`);
    if (!clips.length) { failures += 1; console.log('  FAIL  nothing to merge'); continue; }

    for (const w of warnings) {
      console.log(`  WARN  ${w.message}`);
      console.log('        forgiven in donor mode: merge_clips.mjs remaps channels by node name, so the');
      console.log('        donor\'s own joint ordering never reaches the shipped body.');
    }
    if (!ok) {
      failures += 1;
      console.log(`  FAIL  not ${mode === 'donor' ? 'compatible with' : 'native to'} this body -- ${fails.length} difference(s):`);
      for (const p of fails.slice(0, 8)) console.log(`          ${p.message}`);
      if (fails.length > 8) console.log(`          ... and ${fails.length - 8} more`);
    } else if (mode === 'donor') {
      console.log(`  PASS  same joint set, same hierarchy, same rest pose${warnings.length ? ' (order differs, see above)' : ', same order'}`);
    } else {
      console.log('  PASS  same joint set, same order, same hierarchy, same rest pose');
    }
  }

  const noun = mode === 'donor' ? 'usable as a donor' : 'native';
  console.log(`\n${failures ? `${failures} of ${clipPaths.length} candidate(s) FAILED` : `all ${clipPaths.length} candidate(s) are ${noun}`}`);
  process.exit(failures ? 1 : 0);
}
