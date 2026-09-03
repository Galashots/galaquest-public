#!/usr/bin/env node

/**
 * Convert the two selected source assets with a discoverable/configurable Blender executable and
 * write relative-path provenance. No provider calls or Unity packages are involved.
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSourceGlb } from './source-glb.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BRIDGE_MANIFEST = 'unity/GalaQuest/Assets/GalaQuest/Migration/BridgeManifest.json';
const CONVERTER = 'tools/blender/convert_glb_to_fbx.py';
const OUTPUT_DIRECTORY = 'unity/GalaQuest/Assets/GalaQuest/Migration/SourceAssets/Deterministic';
const PROVENANCE_PATH = 'unity/GalaQuest/Assets/GalaQuest/Migration/Provenance/asset-provenance.json';

const OUTPUT_NAMES = new Map([
  ['gear.sword.ironwood', 'IronwoodSword.fbx'],
  ['world.keeper', 'LanternKeeper.fbx'],
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--blender') options.blender = args[++index];
    else if (args[index] === '--source-sha') options.sourceSha = args[++index];
    else if (args[index] === '--out-dir') options.outDir = args[++index];
    else if (args[index] === '--provenance') options.provenance = args[++index];
    else throw new Error(`unknown option ${args[index]}`);
  }
  return options;
}

function resolveBlender(explicit) {
  const candidates = [explicit, process.env.GALAQUEST_BLENDER, 'blender'].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === 'blender') {
      const lookup = spawnSync('where.exe', ['blender'], { cwd: ROOT, encoding: 'utf8' });
      if (lookup.status === 0) {
        const path = lookup.stdout.split(/\r?\n/).find(Boolean);
        if (path) return resolve(path.trim());
      }
      continue;
    }
    if (existsSync(resolve(candidate))) return resolve(candidate);
  }
  throw new Error('Blender was not found; use --blender or GALAQUEST_BLENDER to provide an executable.');
}

function blenderVersion(blender) {
  const result = spawnSync(blender, ['--version'], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Blender version check failed: ${result.stderr || result.stdout}`);
  const firstLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith('Blender ')) ?? '';
  if (!firstLine) throw new Error(`Blender version output was unexpected: ${result.stdout}`);
  return firstLine.replace(/^Blender\s+/, '').trim();
}

function readBridge() {
  const bridge = JSON.parse(readFileSync(resolve(ROOT, BRIDGE_MANIFEST), 'utf8'));
  if (bridge.schema !== 'galaquest.unity-migration-bridge' || bridge.schemaVersion !== 1) {
    throw new Error(`${BRIDGE_MANIFEST}: incompatible bridge schema`);
  }
  if (!Array.isArray(bridge.assets) || bridge.assets.length !== 2) {
    throw new Error(`${BRIDGE_MANIFEST}: expected exactly two selected assets`);
  }
  return bridge;
}

function convertOne({ blender, sourceSha, sourceAsset, outDir }) {
  const destinationName = OUTPUT_NAMES.get(sourceAsset.semanticId);
  if (!destinationName) throw new Error(`no controlled FBX destination for ${sourceAsset.semanticId}`);
  const source = resolve(ROOT, sourceAsset.sourcePath);
  const destination = resolve(ROOT, outDir, destinationName);
  if (!existsSync(source)) throw new Error(`missing source asset: ${sourceAsset.sourcePath}`);
  const sourceBytes = readFileSync(source);
  const actualSourceHash = sha256(sourceBytes);
  if (actualSourceHash !== sourceAsset.sourceSha256) {
    throw new Error(`${sourceAsset.sourcePath}: source hash differs from bridge manifest`);
  }
  const sourceInspection = inspectSourceGlb(source);
  if (sourceInspection.meshCount !== sourceAsset.structure.meshCount ||
      sourceInspection.primitiveCount !== sourceAsset.structure.primitiveCount ||
      sourceInspection.materialCount !== sourceAsset.structure.materialCount ||
      sourceInspection.nodeCount !== sourceAsset.structure.nodeCount ||
      sourceInspection.skinCount !== sourceAsset.structure.skinCount ||
      sourceInspection.jointCount !== sourceAsset.structure.jointCount ||
      sourceInspection.animations.length !== sourceAsset.structure.animationClipCount) {
    throw new Error(`${sourceAsset.sourcePath}: current source structure differs from the bridge manifest`);
  }

  const command = [
    'blender', '--background', '--factory-startup', '--python', CONVERTER, '--',
    sourceAsset.sourcePath, relative(ROOT, destination).replaceAll('\\', '/'), sourceAsset.semanticId,
  ];
  // Blender's native FBX writer does not replace an existing Windows file reliably. The
  // destination is a generated derivative, so clear only this exact prior derivative before
  // each run; source GLBs are never touched.
  rmSync(destination, { force: true });
  const result = spawnSync(blender, command.slice(1), { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' });
  if (result.error) throw new Error(`${sourceAsset.semanticId}: Blender conversion could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${sourceAsset.semanticId}: Blender conversion failed (${result.status})`);
  if (!existsSync(destination)) throw new Error(`${sourceAsset.semanticId}: Blender exited without writing ${relative(ROOT, destination)}`);

  const derivativeBytes = readFileSync(destination);
  return {
    semanticId: sourceAsset.semanticId,
    displayName: sourceAsset.displayName,
    role: sourceAsset.role,
    sourceGitSha: sourceSha,
    sourceRepoPath: sourceAsset.sourcePath,
    sourceSha256: actualSourceHash,
    sourceSizeBytes: sourceBytes.length,
    conversionTool: 'Blender',
    conversionToolVersion: null,
    conversionScript: CONVERTER,
    conversionCommand: command,
    conversionOptions: {
      axisForward: '-Z',
      axisUp: 'Y',
      applyUnitScale: true,
      bakeAnimations: sourceAsset.structure.hasSkin && sourceAsset.structure.hasAnimation,
      embedTextures: true,
      retarget: false,
      materialRepair: false,
    },
    sourceInspection,
    derivativeRepoPath: relative(ROOT, destination).replaceAll('\\', '/'),
    derivativeSha256: sha256(derivativeBytes),
    derivativeSizeBytes: derivativeBytes.length,
    conversionDate: new Date().toISOString(),
  };
}

export function runConversion(options = {}) {
  const bridge = readBridge();
  const blender = resolveBlender(options.blender);
  const version = blenderVersion(blender);
  if (version !== '4.5.13 LTS') throw new Error(`expected Blender 4.5.13 LTS, got ${version}`);
  const sourceSha = options.sourceSha ?? bridge.originatingGitSha;
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error(`invalid source Git SHA: ${sourceSha}`);
  git(['cat-file', '-e', `${sourceSha}^{commit}`]);
  const outDir = options.outDir ?? OUTPUT_DIRECTORY;
  const provenancePath = options.provenance ?? PROVENANCE_PATH;
  mkdirSync(resolve(ROOT, outDir), { recursive: true });
  const records = bridge.assets.map((sourceAsset) => convertOne({ blender, sourceSha, sourceAsset, outDir }));
  for (const record of records) record.conversionToolVersion = version;
  const provenance = {
    schema: 'galaquest.unity-migration-asset-provenance',
    schemaVersion: 1,
    sourceRepository: bridge.sourceRepository,
    sourceGitSha: sourceSha,
    conversionTool: 'Blender',
    conversionToolVersion: version,
    records,
  };
  const outputPath = resolve(ROOT, provenancePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(provenance, null, 2)}\n`);
  return { blender, version, provenancePath, records };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = runConversion(parseArgs(process.argv.slice(2)));
    console.log(`Converted ${result.records.length} assets with ${result.version}`);
    console.log(`provenance=${result.provenancePath}`);
  } catch (error) {
    console.error(`Unity migration asset conversion failed: ${error.message}`);
    process.exitCode = 1;
  }
}
