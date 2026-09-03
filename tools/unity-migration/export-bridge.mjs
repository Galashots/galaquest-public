#!/usr/bin/env node

/**
 * Export the small, source-owned contract surface needed by the Unity migration proof.
 *
 * This is deliberately a data exporter, not a second gameplay implementation. The movement law is
 * loaded from the exact current public JS module as an ES module. The asset identities are looked up
 * in the current public registry, while hashes and GLB structure are recomputed from the files.
 *
 * The originating SHA is an explicit input to make provenance reproducible after this exporter is
 * committed. The exporter refuses to proceed if the checked-out authority files differ from that
 * commit, so the SHA cannot become a decorative label.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA = 'galaquest.unity-migration-bridge';
const SCHEMA_VERSION = 1;
const BRIDGE_VERSION = '0.1.0';
const REPOSITORY = 'Galashots/galaquest-public';
const SPEED_PATH = 'public/src/character/speed.js';
const REGISTRY_PATH = 'docs/asset-production/asset-registry-v1.json';
const ASSET_PATHS = [
  'public/assets/gear/sword_ironwood.glb',
  'public/assets/world/keeper.glb',
];
const SPEED_EXPORTS = ['WALK_SPEED', 'RUN_SPEED', 'RUN_THRESHOLD', 'RUN_DEFLECTION'];

const COORDINATE_FIXTURE = {
  source: {
    position: [1.25, -2, 3.5],
    rotationQuaternion: [0, 0.3826834323650898, 0, 0.9238795325112867],
    scale: [1.2, 0.75, 2.5],
  },
  destination: {
    position: [1.25, -2, -3.5],
    rotationQuaternion: [0, 0.3826834323650898, 0, -0.9238795325112867],
    scale: [1.2, 0.75, 2.5],
  },
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function sourceSha256(path) {
  return sha256(readFileSync(resolve(ROOT, path)));
}

function assertSourceMatchesCommit(path, sourceSha) {
  const absolute = resolve(ROOT, path);
  if (!existsSync(absolute)) throw new Error(`missing source authority: ${path}`);
  const expectedBlob = git(['rev-parse', `${sourceSha}:${path}`]);
  const actualBlob = git(['hash-object', '--', path]);
  if (expectedBlob !== actualBlob) {
    throw new Error(`${path} differs from originating commit ${sourceSha}`);
  }
}

function readGlbJson(path) {
  const bytes = readFileSync(resolve(ROOT, path));
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) {
    throw new Error(`${path}: not a GLB`);
  }
  if (bytes.readUInt32LE(4) !== 2) throw new Error(`${path}: expected glTF 2`);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

function inspectGlb(path) {
  const json = readGlbJson(path);
  const primitives = (json.meshes ?? []).reduce(
    (sum, mesh) => sum + (mesh.primitives?.length ?? 0),
    0,
  );
  const animations = json.animations ?? [];
  const skins = json.skins ?? [];
  return {
    meshCount: json.meshes?.length ?? 0,
    primitiveCount: primitives,
    materialCount: json.materials?.length ?? 0,
    nodeCount: json.nodes?.length ?? 0,
    skinCount: skins.length,
    jointCount: skins.reduce((sum, skin) => sum + (skin.joints?.length ?? 0), 0),
    animationClipCount: animations.length,
    hasSkin: skins.length > 0,
    hasAnimation: animations.length > 0,
  };
}

function importSourceModule(path) {
  // The public runtime intentionally has no package.json and speed.js is pure. Import the exact
  // source bytes through a data-module URL instead of regex-parsing or copying its constants.
  const source = readFileSync(resolve(ROOT, path), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function readRegistry() {
  const registry = JSON.parse(readFileSync(resolve(ROOT, REGISTRY_PATH), 'utf8'));
  const records = registry.assets ?? registry.records ?? [];
  if (!Array.isArray(records)) throw new Error(`${REGISTRY_PATH}: assets is not an array`);
  return records;
}

function registryAssetFor(path, records) {
  const matches = records.filter((record) => record.source?.path === path);
  if (matches.length !== 1) {
    throw new Error(`${REGISTRY_PATH}: expected one asset record for ${path}, found ${matches.length}`);
  }
  return matches[0];
}

async function movementContract(sourceSha) {
  assertSourceMatchesCommit(SPEED_PATH, sourceSha);
  const source = await importSourceModule(SPEED_PATH);
  const values = {};
  for (const name of SPEED_EXPORTS) {
    if (typeof source[name] !== 'number' || !Number.isFinite(source[name])) {
      throw new Error(`${SPEED_PATH}: missing finite exported number ${name}`);
    }
    values[name] = source[name];
  }
  return {
    semanticId: 'movement.speed-law',
    sourcePath: SPEED_PATH,
    sourceSha256: sourceSha256(SPEED_PATH),
    values,
  };
}

function assetRecord(path, sourceSha, records) {
  assertSourceMatchesCommit(path, sourceSha);
  const registryRecord = registryAssetFor(path, records);
  const bytes = readFileSync(resolve(ROOT, path));
  const facts = inspectGlb(path);
  const role = facts.hasSkin || facts.hasAnimation ? 'rigged-animated-character' : 'static-asset';
  return {
    semanticId: registryRecord.asset_id,
    displayName: registryRecord.display_name,
    role,
    sourcePath: path,
    sourceSha256: sha256(bytes),
    sourceSizeBytes: bytes.length,
    structure: facts,
    registryAuthority: REGISTRY_PATH,
  };
}

function assertSha(sourceSha) {
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error(`originating SHA must be a full lowercase Git SHA: ${sourceSha}`);
  }
  git(['cat-file', '-e', `${sourceSha}^{commit}`]);
}

export async function buildManifest({ sourceSha = git(['rev-parse', 'HEAD']) } = {}) {
  assertSha(sourceSha);
  assertSourceMatchesCommit(REGISTRY_PATH, sourceSha);
  const records = readRegistry();
  const movement = await movementContract(sourceSha);
  const assets = ASSET_PATHS.map((path) => assetRecord(path, sourceSha, records));
  return {
    schema: SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    bridgeVersion: BRIDGE_VERSION,
    originatingGitSha: sourceSha,
    sourceRepository: REPOSITORY,
    sourceCoordinateSystem: {
      name: 'Three.js/glTF',
      handedness: 'right-handed',
      upAxis: 'Y',
      forwardAxis: '-Z',
      units: 'meters',
    },
    destinationCoordinateSystem: {
      name: 'Unity',
      handedness: 'left-handed',
      upAxis: 'Y',
      forwardAxis: '+Z',
      units: 'meters',
    },
    unitConvention: '1 meter in Three.js/glTF becomes 1 Unity unit',
    contracts: { movement },
    assets,
    coordinateFixture: COORDINATE_FIXTURE,
  };
}

export function deterministicJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseArgs(args) {
  const options = { out: 'unity/GalaQuest/Assets/GalaQuest/Migration/BridgeManifest.json' };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--out') options.out = args[++index];
    else if (args[index] === '--source-sha') options.sourceSha = args[++index];
    else throw new Error(`unknown option ${args[index]}`);
  }
  if (!options.out) throw new Error('--out needs a path');
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const manifest = await buildManifest({ sourceSha: options.sourceSha });
    const output = resolve(ROOT, options.out);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, deterministicJson(manifest));
    console.log(`Migration Bridge ${BRIDGE_VERSION} wrote ${relative(ROOT, output)}`);
    console.log(`originatingGitSha=${manifest.originatingGitSha}`);
  } catch (error) {
    console.error(`Migration Bridge export failed: ${error.message}`);
    process.exitCode = 1;
  }
}
