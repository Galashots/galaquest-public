#!/usr/bin/env node
/**
 * Lift animation clips out of one GLB and append them to another.
 *
 *   node tools/foundry/merge_clips.mjs \
 *     --into public/assets/hero/hero_lod1_ironwood_atlas.glb \
 *     --out  tmp/hero_with_clips.glb \
 *     --from "tmp/pack/Combat_Stance_withSkin.glb=combat_stance"
 *
 * Repeat --from per clip. The value is `<path>[#<source clip name>]=<new clip name>`. Without the
 * `#` selector the source must contain exactly one animation, which every file in a Meshy per-motion
 * pack does. With it, the named clip is lifted out of a source that carries several -- e.g. a
 * previously shipped character whose clips this tool merged in earlier:
 *
 *   --from "public/assets/world/keeper.glb#idle=idle"
 *
 * The selector matches by name and requires exactly one hit, never an index, for the same reason
 * channels are remapped by node name below: glTF puts no meaning in animation order.
 *
 * WHY THIS EXISTS. the owner's animation pack ships each clip inside its own ~24 MB GLB, and all but a few
 * kilobytes of that is the base rig's body and textures -- geometry the game already has, in a file
 * the game already loads. Shipping six of them would multiply the hero's payload by seven to gain
 * four clips. This takes the animation and leaves the rest behind.
 *
 * WHY IT IS SAFE TO DO AT ALL, which is a measured claim and not a hopeful one. The shipped hero and
 * the pack were generated from the same Meshy base biped, so their skeletons are not merely similar:
 * same 24 joint names, identical parent hierarchy, rest-pose bone lengths equal to four decimal
 * places on every bone, and identical rest-pose rotation on every joint. That is what makes
 * translation and scale tracks reusable as authored. Reusing clips normally forces you down to
 * rotation-only for exactly this reason, and had the rest poses differed, the tracks would have bound
 * happily by name and then torn the character apart.
 *
 * THAT PRECONDITION IS NOW CHECKED, NOT ASSUMED (Phase C1, 2026-08-15). It failed the first time it
 * was leaned on: Lantern Keeper v1 and v2 have the same 24 joint names, the same parent hierarchy and
 * the same joint ORDER, and grafting v1's `idle` onto v2 drove v2's forearms 45% long, its feet 51%
 * long and its shoulders to half length -- because a Meshy clip carries a translation track on every
 * joint, and a joint's local translation IS its bone. Same names is not the same skeleton. See
 * `assertRestPosesMatch` below and docs/MISTAKES.md.
 *
 * CHANNELS ARE REMAPPED BY NODE NAME, never by index. glTF animation channels target nodes by index,
 * and the pack orders its joints differently from the hero -- LeftHand is joint 15 in both, but the
 * head and right-arm blocks are swapped. Copying indices across would drive the wrong bones with a
 * perfectly valid-looking file. A source node whose name is absent from the target is a hard error
 * rather than a dropped channel, because a silently partial clip is the kind of defect that reads as
 * "the animation looks a bit off" for a week.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const GLB_MAGIC = 0x46546c67;

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readGlb(path) {
  const bytes = readFileSync(path);
  if (bytes.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${path}: not a GLB`);
  let offset = 12;
  let json = null;
  let bin = Buffer.alloc(0);
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === JSON_CHUNK) json = JSON.parse(body.toString('utf8'));
    else if (type === BIN_CHUNK) bin = Buffer.from(body);
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error(`${path}: no JSON chunk`);
  return { json, bin };
}

function writeGlb(path, { json, bin }) {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  // glTF requires each chunk length to be a multiple of 4. JSON pads with spaces so it stays
  // parseable; BIN pads with zeros.
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);
  const total = 12 + 8 + jsonChunk.length + (binChunk.length ? 8 + binChunk.length : 0);

  const out = Buffer.alloc(total);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.writeUInt32LE(JSON_CHUNK, 16);
  jsonChunk.copy(out, 20);
  if (binChunk.length) {
    const at = 20 + jsonChunk.length;
    out.writeUInt32LE(binChunk.length, at);
    out.writeUInt32LE(BIN_CHUNK, at + 4);
    binChunk.copy(out, at + 8);
  }
  writeFileSync(path, out);
  return out.length;
}

/** The bytes one accessor actually occupies, resolved through its bufferView. */
function accessorBytes(source, accessorIndex) {
  const accessor = source.json.accessors[accessorIndex];
  if (accessor.sparse) throw new Error(`accessor ${accessorIndex} is sparse; not supported`);
  const view = source.json.bufferViews[accessor.bufferView];
  if (view.byteStride !== undefined && view.byteStride !== 0) {
    // Animation samplers are tightly packed in every exporter worth using. If one is not, slicing a
    // contiguous range would interleave someone else's data into the clip.
    throw new Error(`accessor ${accessorIndex} sits in an interleaved bufferView (byteStride ${view.byteStride})`);
  }
  const elementSize = COMPONENT_BYTES[accessor.componentType] * TYPE_COMPONENTS[accessor.type];
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  return {
    accessor,
    bytes: source.bin.subarray(start, start + accessor.count * elementSize),
    elementSize,
  };
}

/** Append raw bytes to the target BIN, 4-byte aligned, and return the new bufferView index. */
function appendBufferView(target, bytes) {
  const pad = (4 - (target.bin.length % 4)) % 4;
  if (pad) target.bin = Buffer.concat([target.bin, Buffer.alloc(pad, 0)]);
  const byteOffset = target.bin.length;
  target.bin = Buffer.concat([target.bin, bytes]);
  target.json.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length });
  return target.json.bufferViews.length - 1;
}

function copyAccessor(target, source, accessorIndex, { rebaseTimesBy = 0 } = {}) {
  const { accessor, bytes } = accessorBytes(source, accessorIndex);
  let payload = bytes;
  let min = accessor.min;
  let max = accessor.max;

  if (rebaseTimesBy !== 0) {
    // Shift every keyframe time so the clip starts at t=0. Copy first -- `bytes` is a view onto the
    // source BIN, and writing through it would corrupt the file we are reading from.
    payload = Buffer.from(bytes);
    for (let i = 0; i < accessor.count; i += 1) {
      payload.writeFloatLE(payload.readFloatLE(i * 4) - rebaseTimesBy, i * 4);
    }
    min = min ? [min[0] - rebaseTimesBy] : min;
    max = max ? [max[0] - rebaseTimesBy] : max;
  }

  const bufferView = appendBufferView(target, payload);
  target.json.accessors.push({
    bufferView,
    componentType: accessor.componentType,
    count: accessor.count,
    type: accessor.type,
    ...(min ? { min } : {}),
    ...(max ? { max } : {}),
    ...(accessor.normalized ? { normalized: true } : {}),
  });
  return target.json.accessors.length - 1;
}

/**
 * The header's safety argument, checked instead of assumed: for every node this clip drives, the
 * source's rest pose and the target's rest pose must agree.
 *
 * A joint's local translation is its offset from its parent -- i.e. the bone. A Meshy clip carries a
 * translation track on every joint, so binding it to a target whose bones are different LENGTHS does
 * not re-pose that target, it re-proportions it, every frame. Rotation tracks are applied in the
 * parent's frame and act on that offset, so a different rest ROTATION lands the same track as a
 * different pose. Both are checked; neither is visible in a joint-name or hierarchy comparison, which
 * is what made the Keeper graft look viable right up until it was rendered.
 */
function assertRestPosesMatch(target, source, clip, sourcePath) {
  const BONE_TOLERANCE = 0.01; // 1% -- the header's claim is "equal to four decimal places"
  const ANGLE_TOLERANCE_DEG = 1;
  const offenders = [];
  const ratios = [];
  const seen = new Set();

  for (const channel of clip.channels) {
    const node = source.json.nodes[channel.target.node];
    if (!node?.name || seen.has(node.name)) continue;
    seen.add(node.name);
    const twin = target.json.nodes.find((n) => n.name === node.name);
    if (!twin) continue; // the missing-node check below reports this far better than we could here

    const a = node.translation ?? [0, 0, 0];
    const b = twin.translation ?? [0, 0, 0];
    const la = Math.hypot(...a);
    const lb = Math.hypot(...b);
    if (Math.max(la, lb) > 1e-6) {
      const ratio = lb > 1e-9 ? la / lb : Infinity;
      ratios.push(ratio);
      if (Math.abs(la - lb) > BONE_TOLERANCE * Math.max(la, lb)) {
        offenders.push(`${node.name}: bone ${lb.toFixed(4)} in target vs ${la.toFixed(4)} in source`
          + ` (x${Number.isFinite(ratio) ? ratio.toFixed(2) : 'inf'})`);
        continue;
      }
    }

    const qa = node.rotation ?? [0, 0, 0, 1];
    const qb = twin.rotation ?? [0, 0, 0, 1];
    const dot = Math.min(1, Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]));
    const degrees = 2 * Math.acos(dot) * 180 / Math.PI;
    if (degrees > ANGLE_TOLERANCE_DEG) {
      offenders.push(`${node.name}: rest rotation differs by ${degrees.toFixed(2)} degrees`);
    }
  }

  if (!offenders.length) return;
  const sorted = [...ratios].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)];
  const uniform = sorted.length > 1 && sorted[0] > 0
    && (sorted[sorted.length - 1] - sorted[0]) / sorted[sorted.length - 1] < 0.01;
  throw new Error(
    `${sourcePath}: rest pose does not match the target on ${offenders.length} of ${seen.size} driven `
    + `nodes, so this clip's tracks would re-proportion the target rather than pose it.\n`
    + offenders.slice(0, 8).map((line) => `    ${line}`).join('\n')
    + (offenders.length > 8 ? `\n    ... and ${offenders.length - 8} more` : '')
    + (uniform
      ? `\n  Every bone differs by the same factor (~${median.toFixed(3)}): this is a pure unit/scale`
        + ' difference, and rescaling the source is the fix.'
      : `\n  The differences are NOT a single scale factor (median x${(median ?? 1).toFixed(2)}): these`
        + ' are different skeletons that happen to share joint names. Matching names, hierarchy and'
        + ' joint order do not make a clip transferable.'),
  );
}

function mergeClip(target, sourcePath, newName, sourceClipName = null) {
  const source = readGlb(sourcePath);
  const animations = source.json.animations || [];
  let clip;
  if (sourceClipName === null) {
    // The original contract, unchanged: a single-clip source needs no disambiguation, which is every
    // file in a Meshy per-motion pack.
    if (animations.length !== 1) {
      throw new Error(
        `${sourcePath}: expected exactly 1 animation, found ${animations.length} `
        + `(${animations.map((a) => a.name).join(', ')}). Name the one you want with `
        + `--from "${sourcePath}#<clipName>=${newName}".`,
      );
    }
    [clip] = animations;
  } else {
    // Added for Phase C1: a source that already carries several clips -- e.g. a previously shipped
    // character, whose animations were themselves merged in by this tool. Selected by NAME and
    // required to match exactly one, never by index: glTF puts no meaning in animation order, and a
    // silently-wrong clip is the failure mode this tool's channel remapping already refuses to
    // accept for nodes (see the header's note on remapping by node name rather than index).
    const matches = animations.filter((a) => a.name === sourceClipName);
    if (matches.length !== 1) {
      throw new Error(
        `${sourcePath}: expected exactly 1 animation named "${sourceClipName}", found ${matches.length} `
        + `(available: ${animations.map((a) => a.name).join(', ') || 'none'})`,
      );
    }
    [clip] = matches;
  }

  assertRestPosesMatch(target, source, clip, sourcePath);

  const targetIndexByName = new Map();
  target.json.nodes.forEach((node, index) => { if (node.name) targetIndexByName.set(node.name, index); });

  // A clip whose first keyframe is not at t=0 holds its opening pose for that long every time it
  // plays. Right_Hand_Sword_Slash starts at 0.0333s, which is two frames of a sword that has not
  // begun to move yet at the front of every swing.
  let earliest = Infinity;
  for (const sampler of clip.samplers) {
    const input = source.json.accessors[sampler.input];
    if (input.min) earliest = Math.min(earliest, input.min[0]);
  }
  const rebase = Number.isFinite(earliest) && earliest > 0 ? earliest : 0;

  const samplerMap = new Map();
  for (const [index, sampler] of clip.samplers.entries()) {
    samplerMap.set(index, {
      input: copyAccessor(target, source, sampler.input, { rebaseTimesBy: rebase }),
      output: copyAccessor(target, source, sampler.output),
      interpolation: sampler.interpolation || 'LINEAR',
    });
  }

  const channels = [];
  const missing = new Set();
  for (const channel of clip.channels) {
    const sourceNode = source.json.nodes[channel.target.node];
    const targetIndex = targetIndexByName.get(sourceNode?.name);
    if (targetIndex === undefined) { missing.add(sourceNode?.name ?? `#${channel.target.node}`); continue; }
    channels.push({
      sampler: channel.sampler,
      target: { node: targetIndex, path: channel.target.path },
    });
  }
  if (missing.size) {
    throw new Error(`${sourcePath}: target has no node named ${[...missing].join(', ')}`);
  }

  const samplers = [];
  const reindex = new Map();
  for (const [oldIndex, resolved] of samplerMap) {
    reindex.set(oldIndex, samplers.length);
    samplers.push({ input: resolved.input, output: resolved.output, interpolation: resolved.interpolation });
  }
  for (const channel of channels) channel.sampler = reindex.get(channel.sampler);

  target.json.animations = target.json.animations || [];
  target.json.animations.push({ name: newName, channels, samplers });

  return {
    name: newName,
    from: clip.name,
    channels: channels.length,
    nodes: new Set(channels.map((c) => c.target.node)).size,
    rebasedBy: rebase,
  };
}

// ── cli ─────────────────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function flag(name) {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1];
}
const intoPath = flag('--into');
const outPath = flag('--out');
const sources = args.reduce((list, arg, index) => {
  if (arg === '--from') list.push(args[index + 1]);
  return list;
}, []);

if (!intoPath || !outPath || sources.length === 0) {
  console.error('usage: merge_clips.mjs --into <target.glb> --out <output.glb> --from "<source.glb>=<name>" ...');
  process.exit(2);
}

const target = readGlb(intoPath);
const before = readFileSync(intoPath).length;
const existing = (target.json.animations || []).map((a) => a.name);
console.log(`${intoPath}`);
console.log(`  ${before.toLocaleString()} bytes, animations already present: ${existing.join(', ') || '(none)'}`);

const merged = [];
for (const spec of sources) {
  const split = spec.lastIndexOf('=');
  if (split === -1) throw new Error(`--from needs <path>[#<sourceClip>]=<name>, got "${spec}"`);
  const left = spec.slice(0, split);
  const newName = spec.slice(split + 1);
  // `#` separates an optional source-clip selector from the path. Split on the LAST one, for the same
  // reason `=` is: a path is allowed to contain the character, a clip name is the tail.
  const hash = left.lastIndexOf('#');
  const sourcePath = hash === -1 ? left : left.slice(0, hash);
  const sourceClipName = hash === -1 ? null : left.slice(hash + 1);
  merged.push(mergeClip(target, sourcePath, newName, sourceClipName));
}

target.json.buffers[0].byteLength = target.bin.length;
const after = writeGlb(outPath, target);

console.log(`\nmerged ${merged.length} clip(s):`);
for (const clip of merged) {
  const rebased = clip.rebasedBy > 0 ? `, rebased to t=0 (was ${clip.rebasedBy.toFixed(4)}s)` : '';
  console.log(`  ${clip.name.padEnd(16)} from "${clip.from}" -- ${clip.channels} channels over ${clip.nodes} nodes${rebased}`);
}
console.log(`\n${outPath}`);
console.log(`  ${after.toLocaleString()} bytes  (+${(after - before).toLocaleString()}, `
  + `${((after / before - 1) * 100).toFixed(1)}% larger)`);
console.log(`  animations now: ${target.json.animations.map((a) => a.name).join(', ')}`);
