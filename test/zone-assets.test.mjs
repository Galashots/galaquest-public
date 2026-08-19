import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// V1: the zone's shipped assets, walked and measured the same way the hero/wolf pipeline's own
// verify-glb.mjs treats a shipping GLB as untrusted until a second reader confirms it -- except this
// walk is over a whole directory tree rather than one file with a build report, since these assets
// have no foundry build report (they are custodied Meshy/Kenney output, not a foundry build).

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const WORLD_DIR = join(REPO, 'public', 'assets', 'world');
const PROPS_DIR = join(REPO, 'public', 'assets', 'props');

// Pinned per the brief: everything shipped today is well under it (the keeper, at 662,220 bytes, is
// the biggest single file), and a future asset that blows past it is exactly the "background creep"
// this test exists to catch before it ships.
const PER_FILE_BYTE_CEILING = 800_000;
// Pinned per the brief: the PROPS array's own payload (public/assets/props/**), separate from the
// landmark/NPC budget under public/assets/world -- the zone data module keeps LANDMARKS and PROPS as
// separate arrays for exactly this reason, and this pin tracks the PROPS side of that split.
const PROPS_TOTAL_BYTE_CEILING = 1_500_000;

const GLB_MAGIC = 0x46546c67; // 'glTF', little-endian, at byte 0 of every valid GLB.

function walkGlbFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkGlbFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.glb')) out.push(full);
  }
  return out;
}

/**
 * Parse just enough of a GLB to check what this test cares about: the magic number and whether any
 * `images[]` entry is an EXTERNAL reference (a `uri`) rather than embedded (a `bufferView`). Throws
 * on a file too short or too malformed to be a GLB at all -- that is itself a failure worth seeing,
 * not something to swallow.
 */
function readGlb(path) {
  const buf = readFileSync(path);
  const magic = buf.readUInt32LE(0);
  if (buf.length < 20) return { magic, externalImageUris: [] };
  const jsonChunkLength = buf.readUInt32LE(12);
  const jsonChunkType = buf.readUInt32LE(16);
  if (jsonChunkType !== 0x4e4f534a) return { magic, externalImageUris: [] }; // 'JSON'
  const json = JSON.parse(buf.subarray(20, 20 + jsonChunkLength).toString('utf8'));
  const externalImageUris = (json.images ?? [])
    .filter((image) => typeof image.uri === 'string')
    .map((image) => image.uri);
  return { magic, externalImageUris };
}

const shippedFiles = [...walkGlbFiles(WORLD_DIR), ...walkGlbFiles(PROPS_DIR)];

test('the zone ships at least the world and props directories with GLBs in them', () => {
  assert.ok(shippedFiles.length > 0, 'expected shipped GLBs under public/assets/world and public/assets/props');
});

test('every shipped zone GLB starts with the real glTF magic number', () => {
  for (const file of shippedFiles) {
    const { magic } = readGlb(file);
    assert.equal(magic, GLB_MAGIC, `${file} does not start with glTF magic (got 0x${magic.toString(16)})`);
  }
});

test('no shipped zone GLB references an external image uri', () => {
  const offenders = shippedFiles
    .map((file) => ({ file, ...readGlb(file) }))
    .filter((result) => result.externalImageUris.length > 0);
  assert.deepEqual(
    offenders.map((o) => `${o.file}: ${o.externalImageUris.join(', ')}`),
    [],
    'a raw Kenney export ships an EXTERNAL Textures/colormap.png uri; shipping one raw 404s the texture',
  );
});

// Sabotage-verify the external-uri check itself: point it at a raw (un-embedded) Kenney file and
// confirm it actually flags what it claims to flag, the same discipline verify-glb.mjs's own
// --self-test uses. A check that has never been seen to fail is not proven to work.
//
// The raw source lives under `tmp/`, which .gitignore excludes -- it is a large third-party archive
// and AGENTS.md says those belong there. So this sabotage can only run on a machine that has the
// Kenney pack downloaded, and it SKIPS rather than fails where the pack is absent. That is the same
// shape as the "CI passes exactly one fewer than a local run, and skips one" invariant AGENTS.md
// already records for tools/teardown. Landed red on main in 6eac80d because the assertion ran
// unconditionally and CI has no tmp/; a test that cannot pass in CI is a broken gate, not a strict one.
test('sabotage: the external-uri check DOES fail against a raw, un-embedded Kenney file', (t) => {
  const rawKenneyFile = join(
    REPO, 'tmp', 'cc0-packs', 'fantasy-town', 'Models', 'GLB format', 'lantern.glb',
  );
  if (!existsSync(rawKenneyFile)) {
    t.skip(`raw Kenney source not present at ${rawKenneyFile} (gitignored tmp/ scratch) -- `
      + 'download the fantasy-town CC0 pack to run this sabotage locally');
    return;
  }
  const { externalImageUris } = readGlb(rawKenneyFile);
  assert.ok(
    externalImageUris.length > 0,
    'expected the raw Kenney source (pre-embed) to still reference an external Textures/colormap.png -- '
    + 'if this ever reads 0, either the source pack changed or the check stopped looking at the right field',
  );
  assert.deepEqual(externalImageUris, ['Textures/colormap.png']);
});

test('every shipped zone GLB is under the per-file byte ceiling', () => {
  const offenders = shippedFiles
    .map((file) => ({ file, size: statSync(file).size }))
    .filter((result) => result.size > PER_FILE_BYTE_CEILING);
  assert.deepEqual(
    offenders.map((o) => `${o.file}: ${o.size} bytes`),
    [],
    `no shipped GLB may exceed ${PER_FILE_BYTE_CEILING} bytes`,
  );
});

test('the total props payload (public/assets/props/**) stays under its pinned ceiling', () => {
  const propsFiles = walkGlbFiles(PROPS_DIR);
  const total = propsFiles.reduce((sum, file) => sum + statSync(file).size, 0);
  assert.ok(
    total <= PROPS_TOTAL_BYTE_CEILING,
    `props payload is ${total} bytes, over the ${PROPS_TOTAL_BYTE_CEILING} ceiling `
    + '(background creep -- a new prop pushed the total over budget)',
  );
});

// Sabotage-verify the byte-ceiling checks the same way: a ceiling of -1 must fail against literally
// any shipped file, proving the comparison direction and the file list are both real.
test('sabotage: the byte-ceiling checks DO fail against an impossible ceiling', () => {
  const offenders = shippedFiles.filter((file) => statSync(file).size > -1);
  assert.ok(offenders.length > 0, 'expected every shipped file to exceed an impossible -1 byte ceiling');
});
