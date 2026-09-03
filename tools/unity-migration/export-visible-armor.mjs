#!/usr/bin/env node

/** Export the single existing Silverguard fit into a Unity-readable, source-bound manifest. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readGlbJson } from './source-glb.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HERO_MODULE = 'public/src/character/hero.js';
const GEAR_MODULE = 'public/src/character/gear.js';
const FIT_PATH = 'docs/foundry/gear/tier3_fit.json';
const MEASURED_PATH = 'docs/foundry/gear/tier3_fit_measured.json';
const DEFAULT_OUT = 'unity/GalaQuest/Assets/GalaQuest/Migration/VisibleArmorManifest.json';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(resolve(ROOT, path));
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

function assertSourceMatchesCommit(path, sourceSha) {
  const expected = git(['rev-parse', `${sourceSha}:${path}`]);
  const actual = git(['hash-object', '--', path]);
  if (expected !== actual) throw new Error(`${path} differs from originating commit ${sourceSha}`);
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--source-sha') options.sourceSha = args[++index];
    else if (args[index] === '--out') options.out = args[++index];
    else throw new Error(`unknown option ${args[index]}`);
  }
  return options;
}

async function sourceAuthority() {
  const hero = await import(pathToFileURL(resolve(ROOT, HERO_MODULE)).href);
  const gear = await import(pathToFileURL(resolve(ROOT, GEAR_MODULE)).href);
  return { hero, gear };
}

export async function buildVisibleArmorManifest({ sourceSha = git(['rev-parse', 'HEAD']) } = {}) {
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error(`invalid source Git SHA: ${sourceSha}`);
  git(['cat-file', '-e', `${sourceSha}^{commit}`]);
  for (const path of [HERO_MODULE, GEAR_MODULE, FIT_PATH, MEASURED_PATH]) assertSourceMatchesCommit(path, sourceSha);

  const { hero, gear } = await sourceAuthority();
  const heroPath = `public/${hero.HERO_URL}`;
  const helmetPath = gear.SILVERGUARD_HELMET_URL.startsWith('public/')
    ? gear.SILVERGUARD_HELMET_URL
    : `public/${gear.SILVERGUARD_HELMET_URL}`;
  const fitDocument = JSON.parse(read(FIT_PATH));
  const measuredDocument = JSON.parse(read(MEASURED_PATH));
  const foundryRecord = fitDocument.items?.find(item => item.glb === helmetPath && item.bone === gear.SILVERGUARD_HELMET_BONE_NAME);
  const measuredRecord = measuredDocument.items?.find(item => item.name === 'helmet' && item.bone === gear.SILVERGUARD_HELMET_BONE_NAME);
  if (!foundryRecord || !measuredRecord) throw new Error('Silverguard Helmet fit record was not found in the live Foundry authorities.');
  const heroDocument = readGlbJson(resolve(ROOT, heroPath));
  const rigRoot = heroDocument.nodes?.find(node => node.name === 'Armature');
  if (!rigRoot?.scale || rigRoot.scale.length !== 3) throw new Error('Hero GLB Armature root scale is missing from the source file.');
  const sourceHead = await sourceNodeWorldTransform(heroDocument, heroDocument.nodes.findIndex(node => node.name === gear.SILVERGUARD_HELMET_BONE_NAME));

  const runtimeFit = gear.RIGID_SILVERGUARD_HELMET;
  if (runtimeFit.id !== gear.SILVERGUARD_HELMET_ID || runtimeFit.boneName !== gear.SILVERGUARD_HELMET_BONE_NAME) {
    throw new Error('Silverguard Helmet runtime authority is internally inconsistent.');
  }

  return {
    schema: 'galaquest.unity-visible-armor-proof',
    schemaVersion: 1,
    originatingGitSha: sourceSha,
    sourceRepository: 'Galashots/galaquest-public',
    sourceCoordinateSystem: 'Three.js/glTF right-handed Y-up; Hero root-relative metres',
    destinationCoordinateSystem: 'Unity left-handed Y-up; root-relative metres',
    unitConvention: 'metres',
    hero: {
      semanticId: 'hero.player.base',
      sourcePath: heroPath,
      sourceSha256: sha256(read(heroPath)),
      sourceSizeBytes: read(heroPath).length,
    },
    gear: {
      semanticId: runtimeFit.id,
      sourcePath: helmetPath,
      sourceSha256: sha256(read(helmetPath)),
      sourceSizeBytes: read(helmetPath).length,
    },
    fitAuthority: {
      runtimeSourcePath: GEAR_MODULE,
      runtimeSourceSha256: sha256(read(GEAR_MODULE)),
      semanticId: runtimeFit.id,
      boneName: runtimeFit.boneName,
      sourceRigRootName: rigRoot.name,
      sourceRigRootScale: rigRoot.scale,
      sourceHeadPosition: sourceHead.position,
      sourceHeadQuaternion: sourceHead.quaternion,
      restRelativeToHeroRoot: runtimeFit.restRelativeToHeroRoot,
      foundrySourcePath: FIT_PATH,
      foundrySourceSha256: sha256(read(FIT_PATH)),
      foundryRecord,
      measuredSourcePath: MEASURED_PATH,
      measuredSourceSha256: sha256(read(MEASURED_PATH)),
    },
  };
}

async function sourceThree() {
  return import(pathToFileURL(resolve(ROOT, 'public/vendor/three.module.min.js')).href);
}

async function sourceNodeWorldTransform(document, index) {
  if (index < 0) throw new Error('Hero GLB Head node is missing from the source file.');
  const THREE = await sourceThree();
  const parents = new Map();
  for (const node of document.nodes ?? []) for (const child of node.children ?? []) parents.set(child, document.nodes.indexOf(node));
  const world = nodeIndex => {
    const node = document.nodes[nodeIndex];
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...(node.translation ?? [0, 0, 0])),
      new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
      new THREE.Vector3(...(node.scale ?? [1, 1, 1])));
    const parent = parents.get(nodeIndex);
    return parent == null ? local : world(parent).multiply(local);
  };
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  world(index).decompose(position, quaternion, scale);
  return { position: position.toArray(), quaternion: quaternion.toArray(), scale: scale.toArray() };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const manifest = await buildVisibleArmorManifest({ sourceSha: options.sourceSha });
    const output = resolve(ROOT, options.out ?? DEFAULT_OUT);
    writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Wrote ${output}`);
  } catch (error) {
    console.error(`Visible armor manifest export failed: ${error.message}`);
    process.exitCode = 1;
  }
}
