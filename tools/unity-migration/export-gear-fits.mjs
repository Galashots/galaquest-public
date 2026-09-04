#!/usr/bin/env node
// Export Unity-authored gear fits into one deterministic, reviewable manifest.
//
// DIRECTION MATTERS. This exports Unity -> reference, not reference -> Unity.
//
// The Three.js path in public/src/character/gear.js still ships the game today, so its
// restRelativeToHeroRoot values remain the RUNTIME authority for the Three.js client and are not
// rewritten here. What this tool does is make the Unity-authored fit -- the one the Owner actually
// dragged into place against the Head Fit Proxy -- exportable, diffable and bound to a source SHA, so
// there is one authored truth and one derived representation rather than two hand-edited ones.
//
// It deliberately does NOT synthesise gear.js quaternions. Converting a socket-local Unity transform
// back into Armature-relative Three.js space is exactly the coordinate tax this migration is trying to
// stop paying, and doing it silently would hide which layer a future defect lives in. When the Three.js
// client is retired, this manifest is what the Unity definitions hand forward.
//
// Usage:
//   node tools/unity-migration/export-gear-fits.mjs [--out <path>] [--check]

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFINITIONS_DIR = 'unity/GalaQuest/Assets/GalaQuest/Gear/Definitions';
const DEFAULT_OUT = 'docs/foundry/gear/unity_gear_fits.json';

const FIT_CLASS_NAMES = ['RigidGeneric', 'Headgear', 'Handheld', 'Shoulder'];
const ANATOMY_NAMES = [
  'hair', 'ears', 'beard', 'torso', 'upper-arms', 'lower-arms', 'hands', 'hips-legs', 'feet',
];

function scalar(source, key) {
  const match = source.match(new RegExp(`^\\s{2}${key}:\\s*(.*)$`, 'm'));
  return match ? match[1].trim() : null;
}

function vector(source, key) {
  const match = source.match(
    new RegExp(`^\\s{2}${key}:\\s*\\{x:\\s*([-\\d.eE]+),\\s*y:\\s*([-\\d.eE]+),\\s*z:\\s*([-\\d.eE]+)\\}`, 'm'),
  );
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function anatomyList(source) {
  // Unity serialises a small enum array compactly as little-endian hex on one line
  // (hidesAnatomy: 0000000001000000 is [0, 1] -> hair, ears), and as a YAML block list otherwise.
  // Both forms are read here; only handling the block form silently drops every declared coverage.
  const packed = source.match(/^ {2}hidesAnatomy:\s*([0-9a-f]+)\s*$/m);
  if (packed) {
    const hex = packed[1];
    const values = [];
    for (let i = 0; i + 8 <= hex.length; i += 8) {
      const word = hex.slice(i, i + 8);
      const littleEndian = (word.match(/../g) ?? []).reverse().join('');
      values.push(Number.parseInt(littleEndian, 16));
    }
    return values.map((value) => ANATOMY_NAMES[value] ?? `unknown-${value}`);
  }

  const block = source.match(/^ {2}hidesAnatomy:\s*$((?:\n {2}- .*)*)/m);
  if (!block) return [];
  return [...block[1].matchAll(/- (\d+)/g)]
    .map((entry) => ANATOMY_NAMES[Number(entry[1])] ?? `unknown-${entry[1]}`);
}

export function parseGearDefinition(source, fileName) {
  const semanticId = scalar(source, 'semanticId');
  if (!semanticId) throw new Error(`${fileName}: no semanticId`);

  const fitClassIndex = Number(scalar(source, 'fitClass') ?? '0');

  return {
    semanticId,
    displayName: scalar(source, 'displayName') ?? semanticId,
    socketId: scalar(source, 'socketId') ?? '',
    fitClass: FIT_CLASS_NAMES[fitClassIndex] ?? `unknown-${fitClassIndex}`,
    socketLocalFit: {
      position: vector(source, 'localPosition') ?? [0, 0, 0],
      eulerAngles: vector(source, 'localEulerAngles') ?? [0, 0, 0],
      scale: vector(source, 'localScale') ?? [1, 1, 1],
      mirrorX: scalar(source, 'mirrorX') === '1',
    },
    hidesAnatomy: anatomyList(source),
    sourceRepoPath: scalar(source, 'sourceRepoPath') ?? '',
  };
}

export function buildManifest(definitionsDir = DEFINITIONS_DIR) {
  if (!existsSync(definitionsDir)) {
    throw new Error(`Gear definitions directory missing: ${definitionsDir}`);
  }

  const items = readdirSync(definitionsDir)
    .filter((name) => name.endsWith('.asset') && name.startsWith('Gear_'))
    .sort()
    .map((name) => parseGearDefinition(readFileSync(join(definitionsDir, name), 'utf8'), name));

  return {
    schema: 'galaquest.unity-gear-fits',
    schemaVersion: 1,
    // Deliberately no timestamp: the same definitions must export byte-identically.
    authoringSurface: 'Unity 6000.3.23f1 Gear Workbench',
    authoringSpace:
      'Unity left-handed Y-up metres, expressed relative to the named GQ_HERO_V1 socket Transform',
    referenceRuntime: {
      path: 'public/src/character/gear.js',
      note:
        'Three.js remains the shipping client during migration and keeps its own '
        + 'restRelativeToHeroRoot values. This manifest is the Unity-authored source of truth for '
        + 'future gear; it is not automatically converted into gear.js numbers.',
    },
    items,
  };
}

function main(argv) {
  const outIndex = argv.indexOf('--out');
  const out = outIndex >= 0 ? argv[outIndex + 1] : DEFAULT_OUT;
  const check = argv.includes('--check');

  const manifest = buildManifest();
  const json = `${JSON.stringify(manifest, null, 2)}\n`;

  if (check) {
    const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
    if (current !== json) {
      process.stderr.write(`${out} is stale; re-run without --check.\n`);
      process.exit(1);
    }
    process.stdout.write(`${out} is up to date (${manifest.items.length} item(s)).\n`);
    return;
  }

  writeFileSync(out, json);
  process.stdout.write(`Wrote ${out} with ${manifest.items.length} item(s).\n`);
}

// pathToFileURL, not a hand-built file:// string: on Windows a manual prefix yields file://C:/...
// while import.meta.url is file:///C:/..., so the guard silently never fires and the tool exits 0
// having done nothing at all.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
