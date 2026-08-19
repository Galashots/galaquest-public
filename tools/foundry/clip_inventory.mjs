#!/usr/bin/env node
/**
 * Report what a GLB's animations actually contain: names, measured durations, and -- critically --
 * exactly which nodes each clip does and does not drive.
 *
 *   node tools/foundry/clip_inventory.mjs public/assets/hero/hero.glb
 *   node tools/foundry/clip_inventory.mjs public/assets/hero/*.glb public/assets/enemies/wolf.glb
 *
 * Why this exists: a clip name and a nominal duration tell you nothing about coverage. Runtime code
 * (public/src/character/locomotion.js) layers a procedural spine breath on top of whatever the active
 * clip leaves behind each frame, and the whole safety of that depends on knowing, per bone, whether
 * the clip is going to overwrite it or leave it alone. A bone with no channel in a clip is a bone a
 * procedural system can silently accumulate error into; a bone WITH a channel gets rewritten from the
 * clip every time the mixer evaluates it, whatever a procedural system does to it in between. That
 * distinction is invisible from clip names or triangle counts and is only visible by reading the
 * channel list, so that is what this reports -- measured against the shipped file, not assumed from a
 * comment or a memory of how the rig used to be exported.
 *
 * Why read the GLB's own JSON chunk rather than load it through three.js: GLTFLoader needs a browser
 * (fetch, an Image/Canvas path for textures, sometimes a DOM). A plain Node script has none of that,
 * and more importantly this tool exists to see exactly what the FILE declares, unfiltered by a
 * loader's own defaults or silent fallbacks -- the same reason shell_classify.py and rig_axes.py read
 * the GLB directly instead of trusting Blender's importer.
 *
 * Why duration comes from accessor min/max and not from decoding the keyframe buffer: glTF has no
 * per-animation duration field. The number the game actually uses is three.js's own
 * AnimationClip.resetDuration(), which is `max over all tracks of that track's LAST keyframe time`.
 * glTF requires sampler input times to be strictly increasing, so a track's last time equals its
 * accessor's declared max -- which the format already carries as accessor.max, no buffer decode
 * needed. Reading that field is exactly reading the number three.js would compute, not an
 * approximation of it.
 */

import { readFileSync } from 'node:fs';

// ── reading the container ────────────────────────────────────────────────────────────────────────

const JSON_CHUNK_MAGIC = 0x4e4f534a; // ASCII "JSON", read little-endian, as glTF's chunk header stores it.

/** The document only -- nothing here needs the BIN chunk, since every measurement reads accessor
 *  metadata (min/max, count) rather than the keyframe/vertex data those accessors point at. */
function readGlbJson(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 20) throw new Error(`${path}: shorter than a GLB header plus one chunk header`);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a binary glTF container (bad magic)`);
  if (bytes.readUInt32LE(4) !== 2) throw new Error(`${path}: glTF version ${bytes.readUInt32LE(4)}, expected 2`);

  const jsonLength = bytes.readUInt32LE(12);
  const jsonMagic = bytes.readUInt32LE(16);
  if (jsonMagic !== JSON_CHUNK_MAGIC) {
    throw new Error(`${path}: first chunk is not JSON (spec requires it to be)`);
  }
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
}

// ── measurements over the document ───────────────────────────────────────────────────────────────

function nodeNames(document) {
  return (document.nodes ?? []).map((node, index) => node.name ?? `<node ${index}>`);
}

/** One entry per skin: its joints' names, in skin (not node-index) order. Almost every file here has
 *  exactly one skin, but nothing about the format guarantees that, so the general case is handled. */
function skinsOf(document, names) {
  return (document.skins ?? []).map((skin, index) => ({
    index,
    name: skin.name ?? `<skin ${index}>`,
    jointNames: skin.joints.map((nodeIndex) => names[nodeIndex] ?? `<node ${nodeIndex}>`),
  }));
}

/**
 * Everything one animation channel needs to resolve to a name and a fact, without touching the BIN
 * chunk: which node it targets, which TRS path, and the [min,max] time range of its own sampler.
 */
function describeClip(document, names, animation) {
  const perNode = new Map(); // node name -> Set of TRS paths driven on it by this clip
  let startTime = Infinity;
  let endTime = -Infinity;

  for (const channel of animation.channels) {
    const nodeName = names[channel.target.node] ?? `<node ${channel.target.node}>`;
    const sampler = animation.samplers[channel.sampler];
    const inputAccessor = document.accessors[sampler.input];
    if (!inputAccessor?.min || !inputAccessor?.max) {
      // Every animation-input accessor produced by every exporter seen in this repo carries min/max.
      // Reporting a wrong duration because one was missing would be worse than refusing to guess it.
      throw new Error(
        `clip '${animation.name}': sampler input accessor ${sampler.input} for node '${nodeName}' `
        + 'has no min/max; cannot measure its time range without decoding the BIN chunk',
      );
    }
    startTime = Math.min(startTime, inputAccessor.min[0]);
    endTime = Math.max(endTime, inputAccessor.max[0]);

    const paths = perNode.get(nodeName) ?? new Set();
    paths.add(channel.target.path);
    perNode.set(nodeName, paths);
  }

  return {
    name: animation.name,
    channelCount: animation.channels.length,
    startTime,
    duration: endTime, // see file header: this equals three.js's AnimationClip.duration
    drivenNodes: perNode,
  };
}

// ── report ────────────────────────────────────────────────────────────────────────────────────────

/** Collapse a clip's per-node path sets into signature groups, so a rig where every bone carries the
 *  same three paths prints as one line instead of one repetitive line per bone. Real exceptions --
 *  a bone with only a subset of paths -- still get their own group and are not hidden by the average. */
function groupBySignature(drivenNodes) {
  const groups = new Map(); // "path,path,..." -> [node names]
  for (const [node, paths] of drivenNodes) {
    const signature = [...paths].sort().join(', ');
    const list = groups.get(signature) ?? [];
    list.push(node);
    groups.set(signature, list);
  }
  return groups;
}

function report(path) {
  const document = readGlbJson(path);
  const names = nodeNames(document);
  const skins = skinsOf(document, names);
  const animations = document.animations ?? [];

  console.log(`\n${path}`);
  console.log(`  ${names.length} node(s), ${skins.length} skin(s), ${animations.length} animation(s)`);

  const allJointNames = new Set(skins.flatMap((skin) => skin.jointNames));
  for (const skin of skins) {
    console.log(`  skin '${skin.name}': ${skin.jointNames.length} joint(s)`);
    console.log(`    ${skin.jointNames.join(', ')}`);
  }
  const nonJointNodes = names.filter((name) => !allJointNames.has(name));
  if (nonJointNodes.length) {
    console.log(`  ${nonJointNodes.length} node(s) outside any skin (containers, gear anchors, etc.): `
      + `${nonJointNodes.join(', ')}`);
  }

  if (animations.length === 0) {
    console.log('  no animations in this file');
    return;
  }

  for (const animation of animations) {
    const clip = describeClip(document, names, animation);
    const drivenCount = clip.drivenNodes.size;
    console.log(`\n  clip '${clip.name}'`);
    console.log(`    duration           ${clip.duration.toFixed(4)}s`
      + (Math.abs(clip.startTime) > 1e-6 ? `  (first keyframe at ${clip.startTime.toFixed(4)}s, not 0)` : ''));
    console.log(`    channels           ${clip.channelCount}`);
    console.log(`    nodes driven       ${drivenCount} of ${names.length} total nodes`);

    const signatures = groupBySignature(clip.drivenNodes);
    for (const [signature, nodeList] of signatures) {
      const label = nodeList.length === drivenCount ? 'all driven nodes' : `${nodeList.length} node(s)`;
      console.log(`      ${label} carry [${signature}]: ${nodeList.sort().join(', ')}`);
    }

    if (allJointNames.size) {
      const undriven = [...allJointNames].filter((joint) => !clip.drivenNodes.has(joint));
      if (undriven.length) {
        console.log(`    JOINTS NOT DRIVEN BY THIS CLIP (${undriven.length}): ${undriven.sort().join(', ')}`);
        console.log('      a procedural system touching any of these will not be overwritten by this clip.');
      } else {
        console.log('    every joint in the skin is driven by this clip.');
      }
    }
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('usage: node tools/foundry/clip_inventory.mjs <file.glb> [more.glb ...]');
  process.exit(2);
}

let failed = false;
for (const path of paths) {
  try {
    report(path);
  } catch (err) {
    failed = true;
    console.error(`\n${path}: FAILED -- ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
