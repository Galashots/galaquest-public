#!/usr/bin/env node

/** Build provenance for the two visible-armor proof derivatives from live source bytes. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSourceGlb } from './source-glb.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BLENDER_VERSION = '4.5.13 LTS';
const CONVERTER = 'tools/blender/convert_glb_to_fbx.py';
const OUT = 'unity/GalaQuest/Assets/GalaQuest/Migration/VisibleArmorProvenance.json';

const sha256 = file => createHash('sha256').update(readFileSync(resolve(ROOT, file))).digest('hex');
const size = file => readFileSync(resolve(ROOT, file)).length;
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

const records = [
  {
    semanticId: 'hero.player.base',
    displayName: 'GalaQuest Hero',
    role: 'skinned-character',
    sourceRepoPath: 'public/assets/hero/hero_lod1_ironwood_atlas.glb',
    derivativeRepoPath: 'unity/GalaQuest/Assets/GalaQuest/Migration/SourceAssets/VisibleArmor/Hero.fbx',
    derivativeTexturePath: 'unity/GalaQuest/Assets/GalaQuest/Migration/SourceAssets/VisibleArmor/Hero.texture-0.jpg',
    conversionCommand: ['blender', '--background', '--factory-startup', '--python', CONVERTER, '--',
      'public/assets/hero/hero_lod1_ironwood_atlas.glb',
      'unity/GalaQuest/Assets/GalaQuest/Migration/SourceAssets/VisibleArmor/Hero.fbx',
      'hero.player.base'],
  },
  {
    semanticId: 'gear.helmet.silverguard',
    displayName: 'Silverguard Helmet',
    role: 'static-gear',
    sourceRepoPath: 'public/assets/gear/helmet_silverguard.glb',
    derivativeRepoPath: 'unity/GalaQuest/Assets/GalaQuest/Migration/SourceAssets/VisibleArmor/SilverguardHelmet.fbx',
    derivativeTexturePath: 'unity/GalaQuest/Assets/GalaQuest/Migration/SourceAssets/VisibleArmor/SilverguardHelmet.texture-0.jpg',
    conversionCommand: ['blender', '--background', '--factory-startup', '--python', CONVERTER, '--',
      'public/assets/gear/helmet_silverguard.glb',
      'unity/GalaQuest/Assets/GalaQuest/Migration/SourceAssets/VisibleArmor/SilverguardHelmet.fbx',
      'gear.helmet.silverguard'],
  },
];

const sourceGitSha = git(['rev-parse', 'HEAD']);
const output = {
  schema: 'galaquest.unity-visible-armor-provenance',
  schemaVersion: 1,
  sourceRepository: 'Galashots/galaquest-public',
  sourceGitSha,
  conversionTool: 'Blender',
  conversionToolVersion: BLENDER_VERSION,
  conversionScript: CONVERTER,
  conversionOptions: {
    axisForward: '-Z',
    axisUp: 'Y',
    applyUnitScale: true,
    embedTextures: true,
    pathMode: 'COPY',
    stableMediaRoot: 'C:/GalaQuestMigrationSource',
    retarget: false,
    materialRepair: false,
  },
  records: records.map(record => ({
    semanticId: record.semanticId,
    displayName: record.displayName,
    role: record.role,
    sourceRepoPath: record.sourceRepoPath,
    sourceSha256: sha256(record.sourceRepoPath),
    sourceSizeBytes: size(record.sourceRepoPath),
    sourceInspection: inspectSourceGlb(resolve(ROOT, record.sourceRepoPath)),
    conversionCommand: record.conversionCommand,
    derivativeRepoPath: record.derivativeRepoPath,
    derivativeSha256: sha256(record.derivativeRepoPath),
    derivativeSizeBytes: size(record.derivativeRepoPath),
    derivativeFiles: [{
      path: record.derivativeTexturePath,
      kind: 'source-material-texture',
      sha256: sha256(record.derivativeTexturePath),
      sizeBytes: size(record.derivativeTexturePath),
    }],
  })),
};

writeFileSync(resolve(ROOT, OUT), `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${resolve(ROOT, OUT)} for ${sourceGitSha}`);
