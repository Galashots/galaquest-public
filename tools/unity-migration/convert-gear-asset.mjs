#!/usr/bin/env node
// Convert one GalaQuest gear GLB into a Unity FBX derivative AND record how it was made.
//
// This exists because Checkpoint A added two derivatives (Ironwood Shield, Silverguard Shoulder) with
// whatever Blender happened to be installed, while the existing VisibleArmor derivatives were made
// with a different one. Blender's FBX exporter is deterministic for a given version and NOT guaranteed
// to be byte-identical across versions, so "which Blender" is part of a derivative's identity.
//
// Before volume intake, the rule is: the converter version is pinned, a mismatch is refused by
// default, and every derivative records what actually produced it.
//
// Usage:
//   node tools/unity-migration/convert-gear-asset.mjs \
//     --source public/assets/gear/shield_ironwood.glb \
//     --dest   unity/GalaQuest/Assets/GalaQuest/Gear/SourceAssets/IronwoodShield.fbx \
//     --id     gear.shield.ironwood \
//     [--blender <path>] [--allow-version-drift] [--record-only]
//
//   --record-only recomputes provenance for derivatives that already exist without re-running Blender.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The Blender the GalaQuest Unity derivative lane is pinned to.
 *
 * This matches unity/.../Migration/VisibleArmorProvenance.json, so a rebuild of the accepted
 * VisibleArmor derivatives reproduces their recorded bytes. Changing it is an Owner decision, not a
 * side effect of whatever is installed on a workstation.
 */
export const PINNED_BLENDER_VERSION = '4.5.13';

export const CONVERSION_SCRIPT = 'tools/blender/convert_glb_to_fbx.py';

export const PROVENANCE_PATH =
  'unity/GalaQuest/Assets/GalaQuest/Gear/GearDerivativeProvenance.json';

/** Options the conversion script applies; recorded because they change the derivative bytes. */
export const CONVERSION_OPTIONS = Object.freeze({
  axisForward: '-Z',
  axisUp: 'Y',
  applyUnitScale: true,
  embedTextures: true,
  pathMode: 'COPY',
  retarget: false,
  materialRepair: false,
});

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function blenderVersion(blenderPath) {
  const output = execFileSync(blenderPath, ['--version'], { encoding: 'utf8' });
  return output.split('\n')[0].replace(/^Blender\s+/, '').trim();
}

function arg(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

function loadProvenance() {
  if (!existsSync(PROVENANCE_PATH)) {
    return {
      schema: 'galaquest.unity-gear-derivative-provenance',
      schemaVersion: 1,
      // No timestamp: identical inputs must produce an identical file.
      pinnedBlenderVersion: PINNED_BLENDER_VERSION,
      conversionScript: CONVERSION_SCRIPT,
      conversionOptions: CONVERSION_OPTIONS,
      records: [],
    };
  }
  return JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8'));
}

export function upsertRecord(provenance, record) {
  const records = provenance.records.filter((entry) => entry.semanticId !== record.semanticId);
  records.push(record);
  records.sort((a, b) => a.semanticId.localeCompare(b.semanticId));
  provenance.records = records;
  return provenance;
}

function main(argv) {
  const source = arg(argv, '--source');
  const dest = arg(argv, '--dest');
  const semanticId = arg(argv, '--id');
  const blenderPath = arg(argv, '--blender', process.env.GALAQUEST_BLENDER ?? 'blender');
  const allowDrift = argv.includes('--allow-version-drift');
  const recordOnly = argv.includes('--record-only');

  if (!source || !dest || !semanticId) {
    process.stderr.write('--source, --dest and --id are all required.\n');
    process.exit(2);
  }
  if (!existsSync(source)) {
    process.stderr.write(`Source missing: ${source}\n`);
    process.exit(2);
  }

  let actualVersion = 'unknown';
  try {
    actualVersion = blenderVersion(blenderPath);
  } catch (error) {
    if (!recordOnly) {
      process.stderr.write(`Could not run Blender at "${blenderPath}": ${error.message}\n`);
      process.exit(2);
    }
  }

  const drift = !actualVersion.startsWith(PINNED_BLENDER_VERSION);
  if (drift && !allowDrift) {
    process.stderr.write(
      `Blender version drift refused.\n`
      + `  pinned:    ${PINNED_BLENDER_VERSION}\n`
      + `  installed: ${actualVersion}\n\n`
      + `A derivative built by a different Blender is not byte-comparable to the accepted ones.\n`
      + `Install the pinned version, or pass --allow-version-drift to record the drift explicitly.\n`,
    );
    process.exit(1);
  }

  if (!recordOnly) {
    mkdirSync(dirname(dest), { recursive: true });
    execFileSync(
      blenderPath,
      ['--background', '--factory-startup', '--python', CONVERSION_SCRIPT, '--', source, dest, semanticId],
      { stdio: 'inherit' },
    );
  }

  if (!existsSync(dest)) {
    process.stderr.write(`Derivative missing after conversion: ${dest}\n`);
    process.exit(1);
  }

  // The conversion writes sibling texture files next to the FBX.
  const textureCandidates = [dest.replace(/\.fbx$/i, '.texture-0.jpg')];
  const derivativeFiles = [
    { path: dest, kind: 'model', sha256: sha256(dest), sizeBytes: statSync(dest).size },
    ...textureCandidates.filter(existsSync).map((path) => ({
      path,
      kind: 'source-material-texture',
      sha256: sha256(path),
      sizeBytes: statSync(path).size,
    })),
  ];

  const record = {
    semanticId,
    displayName: basename(dest, '.fbx'),
    sourceRepoPath: source,
    sourceSha256: sha256(source),
    sourceSizeBytes: statSync(source).size,
    conversionTool: 'Blender',
    conversionToolVersion: actualVersion,
    pinnedBlenderVersion: PINNED_BLENDER_VERSION,
    versionDrift: drift,
    conversionScript: CONVERSION_SCRIPT,
    conversionOptions: CONVERSION_OPTIONS,
    derivativeRepoPath: dest,
    derivativeFiles,
  };

  const provenance = upsertRecord(loadProvenance(), record);
  mkdirSync(dirname(PROVENANCE_PATH), { recursive: true });
  writeFileSync(PROVENANCE_PATH, `${JSON.stringify(provenance, null, 2)}\n`);

  process.stdout.write(
    `Recorded ${semanticId} in ${PROVENANCE_PATH} `
    + `(Blender ${actualVersion}${drift ? ' — DRIFT from pinned ' + PINNED_BLENDER_VERSION : ''}).\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
