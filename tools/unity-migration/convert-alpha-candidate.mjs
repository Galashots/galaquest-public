#!/usr/bin/env node
// One source-specific native review derivative; not a generic importer or promotion tool.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '../..');
const SOURCE = join(ROOT, 'public/assets/enemies/wolf.glb');
const RECIPE = join(ROOT, 'tools/blender/convert_glb_to_fbx.py');
const SOURCE_HASH = '1f0e0504de4b540693727ba9fd50cdb02cd96b26c38a1eb5f7dcf6f8b647f13f';
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
let stage;
try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--blender', '--out'].includes(args[i]) || !args[i + 1] || options[args[i]])
      throw new Error('Use --blender <pinned executable> [--out .local/path]');
    options[args[i]] = args[i + 1];
  }
  if (!options['--blender']) throw new Error('Explicit pinned Blender executable required');
  const out = resolve(ROOT, options['--out'] ?? '.local/m2/alpha-native');
  const rel = relative(join(ROOT, '.local'), out);
  if (!rel || rel.startsWith('..') || /^[A-Za-z]:/.test(rel)) throw new Error('Output must be inside owned .local custody');
  if (existsSync(out)) throw new Error('Preserve the existing candidate; choose a fresh output path');
  if (hash(SOURCE) !== SOURCE_HASH) throw new Error('Expected the exact immutable Wolf source');
  const version = execFileSync(options['--blender'], ['--version'], { encoding: 'utf8', timeout: 30000 });
  if (!/^Blender 4\.5\.13(?:\s|$)/.test(version)) throw new Error('Blender 4.5.13 is required');
  mkdirSync(dirname(out), { recursive: true });
  stage = mkdtempSync(join(dirname(out), 'alpha-convert-'));
  const output = execFileSync(options['--blender'], ['--background', '--factory-startup',
    '--python-exit-code', '42', '--python', RECIPE, '--', SOURCE, join(stage, 'Alpha.fbx'), 'enemy.wolf'],
    { cwd: ROOT, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(join(stage, 'conversion.log'), output);
  if (hash(SOURCE) !== SOURCE_HASH) throw new Error('Source changed during conversion');
  const names = readdirSync(stage).filter(name => name === 'Alpha.fbx' || name.startsWith('Alpha.texture-')).sort();
  if (!names.includes('Alpha.fbx') || !names.includes('Alpha.texture-0.jpg'))
    throw new Error('Expected FBX and the source base-colour texture');
  const receipt = { schema: 'galaquest.alpha-native-candidate/1', sourceSha256: SOURCE_HASH,
    fbxSha256: hash(join(stage, 'Alpha.fbx')), recipeSha256: hash(RECIPE),
    converterSha256: hash(SELF), blenderVersion: '4.5.13', productionPromotion: false,
    files: names.map(name => ({ name, bytes: readFileSync(join(stage, name)).length, sha256: hash(join(stage, name)) })) };
  writeFileSync(join(stage, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  renameSync(stage, out); stage = null;
  console.log(JSON.stringify({ output: out, receipt: join(out, 'receipt.json'), productionPromotion: false }));
} catch (error) {
  // A failed converter may leave partial bytes. Preserve this owned diagnostic directory,
  // but never stamp those bytes with a success receipt or overwrite an earlier candidate.
  if (stage) writeFileSync(join(stage, 'FAILED.txt'), String(error.stack ?? error));
  console.error(`${error.message}${stage ? `; unqualified diagnostics retained at ${stage}` : ''}`);
  process.exitCode = 1;
}
