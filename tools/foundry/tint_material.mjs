#!/usr/bin/env node
// Patches a GLB's material[0].pbrMetallicRoughness.baseColorFactor in place -- a plain JSON-chunk
// edit, no Blender, no re-export, no touch to geometry or the embedded texture bytes. This is the
// smallest stable mechanism for a palette shift on a shared-atlas Kenney piece (brief's own menu:
// "asset-level palette adjustment, or a data-driven material tint... do not add a bespoke shader
// system") -- baseColorFactor is a real glTF field every renderer already multiplies the sampled
// texture colour by, so this is not a hack layered on top of the format.
//
// node tools/foundry/tint_material.mjs <in.glb> <out.glb> <r> <g> <b> [a]
import { readFileSync, writeFileSync } from 'node:fs';

const [inPath, outPath, rArg, gArg, bArg, aArg] = process.argv.slice(2);
if (!inPath || !outPath || rArg == null || gArg == null || bArg == null) {
  console.error('usage: tint_material.mjs <in.glb> <out.glb> <r> <g> <b> [a]');
  process.exit(1);
}
const factor = [Number(rArg), Number(gArg), Number(bArg), aArg == null ? 1 : Number(aArg)];
if (factor.some((n) => !Number.isFinite(n) || n < 0 || n > 1)) {
  throw new Error(`baseColorFactor components must be finite numbers in [0,1]: ${factor}`);
}

const buf = readFileSync(inPath);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
if (dv.getUint32(0, true) !== 0x46546c67) throw new Error(`${inPath}: not a GLB (bad magic)`);

let off = 12;
let jsonStart = -1;
let jsonLength = 0;
let binChunk = null;
while (off < buf.byteLength) {
  const len = dv.getUint32(off, true);
  const type = dv.getUint32(off + 4, true);
  if (type === 0x4e4f534a) { jsonStart = off + 8; jsonLength = len; }
  if (type === 0x004e4942) binChunk = buf.subarray(off + 8, off + 8 + len);
  off += 8 + len + ((4 - (len % 4)) % 4);
}
if (jsonStart < 0) throw new Error(`${inPath}: no JSON chunk found`);

const json = JSON.parse(buf.subarray(jsonStart, jsonStart + jsonLength).toString('utf8'));
if (!json.materials?.length) throw new Error(`${inPath}: no materials[] to tint`);
for (const material of json.materials) {
  material.pbrMetallicRoughness ??= {};
  material.pbrMetallicRoughness.baseColorFactor = factor;
}

let jsonText = JSON.stringify(json);
// GLB chunks must be 4-byte aligned; the JSON chunk pads with ASCII spaces (0x20) per the spec.
while (jsonText.length % 4 !== 0) jsonText += ' ';
const jsonBytes = Buffer.from(jsonText, 'utf8');

const chunks = [jsonBytes];
const chunkHeaders = [{ length: jsonBytes.length, type: 0x4e4f534a }];
if (binChunk) {
  chunks.push(binChunk);
  chunkHeaders.push({ length: binChunk.length, type: 0x004e4942 });
}

const totalLength = 12 + chunkHeaders.reduce((sum, c) => sum + 8 + c.length, 0);
const out = Buffer.alloc(totalLength);
out.writeUInt32LE(0x46546c67, 0); // magic 'glTF'
out.writeUInt32LE(2, 4); // version
out.writeUInt32LE(totalLength, 8);
let writeOff = 12;
for (let i = 0; i < chunks.length; i += 1) {
  out.writeUInt32LE(chunkHeaders[i].length, writeOff);
  out.writeUInt32LE(chunkHeaders[i].type, writeOff + 4);
  chunks[i].copy(out, writeOff + 8);
  writeOff += 8 + chunkHeaders[i].length;
}

writeFileSync(outPath, out);
console.log(`WROTE ${outPath} (${out.length} bytes), baseColorFactor -> [${factor.join(', ')}] on ${json.materials.length} material(s)`);
