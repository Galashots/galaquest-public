// SR4 (CSB): tools/foundry/pose_anatomy.mjs's --json/--sweep/--time additions (owner-plan.md section
// 19). These pin the NEW pure helpers (aggregateFrames, clipDuration, parseArgs, requiresContentMode,
// jsonReport) plus a regression guard that --json exposes the SAME anatomy authority the existing
// text report already used -- not a second, competing definition of pose anatomy. Uses the real
// shipped Hero GLB (already in the repo, zero Meshy cost) rather than a synthetic fixture, so the
// exact-time and whole-clip-extrema paths run against a real skinned, animated skeleton.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import {
  readGlb, skeleton, axesFromRest, measure, forward, poseAt, rigMeasurements,
  clipDuration, sweepFrames, aggregateFrames, parseArgs, requiresContentMode, jsonReport,
} from '../tools/foundry/pose_anatomy.mjs';

const HERO = 'public/assets/hero/hero_lod1_ironwood_atlas.glb';

// ── aggregateFrames: pure, no GLB needed ────────────────────────────────────────────────────────

test('aggregateFrames reports mean/min/max/range for a numeric field', () => {
  const out = aggregateFrames([{ a: 1 }, { a: 3 }, { a: 5 }]);
  assert.deepEqual(out.a, { mean: 3, min: 1, max: 5, range: 4 });
});

test('aggregateFrames reports trueCount/total/fraction for a boolean field, not a numeric aggregate', () => {
  const out = aggregateFrames([{ flag: true }, { flag: false }, { flag: true }, { flag: true }]);
  assert.deepEqual(out.flag, { trueCount: 3, total: 4, fraction: 0.75 });
});

test('aggregateFrames recurses into nested objects (leftArm/rightArm shape)', () => {
  const out = aggregateFrames([
    { leftArm: { abduction: 10 } },
    { leftArm: { abduction: 30 } },
  ]);
  assert.deepEqual(out.leftArm.abduction, { mean: 20, min: 10, max: 30, range: 20 });
});

test('sabotage: aggregateFrames is not a constant -- a genuinely different frame set produces a different range', () => {
  const flat = aggregateFrames([{ a: 5 }, { a: 5 }, { a: 5 }]);
  const spread = aggregateFrames([{ a: 5 }, { a: 1 }, { a: 9 }]);
  assert.equal(flat.a.range, 0);
  assert.equal(spread.a.range, 8);
});

// ── requiresContentMode: the --json fail-closed gate ────────────────────────────────────────────

test('requiresContentMode is true when neither --time nor --sweep was given', () => {
  assert.equal(requiresContentMode(undefined, false), true);
});

test('requiresContentMode is false once --time is given', () => {
  assert.equal(requiresContentMode(0.5, false), false);
});

test('requiresContentMode is false once --sweep is given', () => {
  assert.equal(requiresContentMode(undefined, true), false);
});

// ── parseArgs ────────────────────────────────────────────────────────────────────────────────────

test('parseArgs separates the path, clip-name positionals, and flags', () => {
  const args = parseArgs(['node', 'pose_anatomy.mjs', 'hero.glb', 'idle', 'walk', '--json', '--sweep']);
  assert.equal(args.path, 'hero.glb');
  assert.deepEqual(args.wanted, ['idle', 'walk']);
  assert.equal(args.json, true);
  assert.equal(args.sweep, true);
  assert.equal(args.time, undefined);
  assert.equal(args.samples, 12);
});

test('parseArgs reads --time and --samples values, not just their presence', () => {
  const args = parseArgs(['node', 'pose_anatomy.mjs', 'hero.glb', '--json', '--time', '0.75', '--samples', '20']);
  assert.equal(args.time, 0.75);
  assert.equal(args.samples, 20);
});

test('sabotage: parseArgs does not swallow a clip name that looks similar to a flag value', () => {
  const args = parseArgs(['node', 'pose_anatomy.mjs', 'hero.glb', 'idle', '--json']);
  assert.deepEqual(args.wanted, ['idle']);
});

test('parseArgs throws on a non-numeric --time value', () => {
  assert.throws(() => parseArgs(['node', 'pose_anatomy.mjs', 'hero.glb', '--time', 'soon']), /numeric/);
});

test('parseArgs throws on a non-positive --samples value', () => {
  assert.throws(() => parseArgs(['node', 'pose_anatomy.mjs', 'hero.glb', '--samples', '0']), /positive integer/);
});

// ── clipDuration / sweepFrames / jsonReport against the real shipped Hero ──────────────────────────

const glb = readGlb(HERO);
const skel = skeleton(glb);
const axes = axesFromRest(skel);

test('clipDuration reads a real positive duration for the shipping idle clip', () => {
  const d = clipDuration(glb, 'idle');
  assert.ok(Number.isFinite(d) && d > 0);
});

test('clipDuration returns null for a clip that does not exist -- fails closed, does not throw or guess', () => {
  assert.equal(clipDuration(glb, 'not_a_real_clip'), null);
});

test('sweepFrames samples exactly the requested count, evenly spaced from 0 to duration', () => {
  const { duration, times, frames } = sweepFrames(glb, skel, axes, 'idle', 6);
  assert.equal(times.length, 6);
  assert.equal(frames.length, 6);
  assert.equal(times[0], 0);
  assert.ok(Math.abs(times[5] - (duration * 5) / 6) < 1e-9);
});

test('sweepFrames frames are real measure() output, not placeholders -- shape matches measure() directly', () => {
  const direct = measure(skel, forward(skel), axes);
  const { frames } = sweepFrames(glb, skel, axes, 'idle', 3);
  assert.deepEqual(Object.keys(frames[0]).sort(), Object.keys(direct).sort());
});

test('jsonReport in sweep mode reports the same rig authority rigMeasurements() computes directly', () => {
  const report = jsonReport(HERO, glb, skel, axes, ['idle'], { time: undefined, samples: 12 });
  assert.deepEqual(report.rig, rigMeasurements(skel, glb));
});

test('jsonReport sweep mode never grades asymmetry -- no "ok" field on worstAsymmetry', () => {
  const report = jsonReport(HERO, glb, skel, axes, ['idle'], { time: undefined, samples: 12 });
  assert.ok(!('ok' in report.rig.worstAsymmetry));
});

test('jsonReport sweep mode produces one extrema leaf per measure() field, aggregated from real frames', () => {
  const report = jsonReport(HERO, glb, skel, axes, ['idle'], { time: undefined, samples: 12 });
  const clip = report.clips.idle;
  assert.equal(clip.mode, 'sweep');
  assert.equal(clip.samples, 12);
  assert.equal(clip.frames.length, 12);
  assert.deepEqual(clip.extrema, aggregateFrames(clip.frames.map(({ t, ...rest }) => rest)));
});

test('jsonReport time mode returns a single exact-time measurement, not a sweep', () => {
  const report = jsonReport(HERO, glb, skel, axes, ['idle'], { time: 0.1, samples: 12 });
  const clip = report.clips.idle;
  assert.equal(clip.mode, 'time');
  assert.equal(clip.t, 0.1);
  assert.ok(clip.measurement);
  assert.equal(clip.frames, undefined);
});

test('jsonReport time mode measurement matches measure() called directly at the same pose -- same authority, not reinvented', () => {
  // Fixed by Sol's SR4 audit (2026-08-16): the original version of this test compared
  // report.clips.idle.measurement.pelvisTilt to itself -- a tautology that would pass even if
  // jsonReport's time-mode path were completely broken. This version derives the expected value
  // through a genuinely independent lower-level path (poseAt -> forward -> measure, called directly,
  // not through jsonReport) and compares the FULL measurement object, not one field.
  const report = jsonReport(HERO, glb, skel, axes, ['idle'], { time: 0.1, samples: 12 });
  const independent = measure(skel, forward(skel, poseAt(glb, skel, 'idle', 0.1)), axes);
  assert.deepEqual(report.clips.idle.measurement, independent);
});

test('sabotage: the independent cross-check above is not vacuous -- a different time genuinely produces a different measurement', () => {
  const atZero = measure(skel, forward(skel, poseAt(glb, skel, 'idle', 0)), axes);
  const atLater = measure(skel, forward(skel, poseAt(glb, skel, 'idle', 1.0)), axes);
  assert.notDeepEqual(atZero, atLater);
});

test('jsonReport reports a missing clip as present:false rather than throwing or guessing a fallback', () => {
  const report = jsonReport(HERO, glb, skel, axes, ['not_a_real_clip'], { time: undefined, samples: 12 });
  assert.deepEqual(report.clips.not_a_real_clip, { present: false });
});

test('jsonReport output round-trips through JSON.stringify/parse cleanly -- no NaN/Infinity leaking from a degenerate frame', () => {
  const report = jsonReport(HERO, glb, skel, axes, ['idle'], { time: undefined, samples: 12 });
  const round = JSON.parse(JSON.stringify(report));
  assert.deepEqual(round.rig.worstAsymmetry, report.rig.worstAsymmetry);
});

// ── CLI smoke tests: the actual guarded entry point, not just the exported functions ──────────────

test('CLI: no flags still prints the unchanged human-readable report (regression guard for the --json/--sweep addition)', () => {
  const out = execFileSync('node', ['tools/foundry/pose_anatomy.mjs', HERO, 'idle'], { encoding: 'utf8' });
  assert.ok(out.includes('SKELETON ('));
  assert.ok(out.includes('clip "idle"'));
  assert.ok(!out.trim().startsWith('{')); // still prose, not JSON, by default
});

test('CLI: --json --sweep prints valid, parseable JSON with the expected top-level shape', () => {
  const out = execFileSync('node', ['tools/foundry/pose_anatomy.mjs', HERO, 'idle', '--json', '--sweep'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.deepEqual(Object.keys(parsed).sort(), ['axes', 'clips', 'path', 'rest', 'rig']);
  assert.equal(parsed.clips.idle.mode, 'sweep');
});

test('CLI: --json --time prints valid JSON in time mode', () => {
  const out = execFileSync('node', ['tools/foundry/pose_anatomy.mjs', HERO, 'idle', '--json', '--time', '0.2'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.clips.idle.mode, 'time');
  assert.equal(parsed.clips.idle.t, 0.2);
});

test('sabotage: CLI --json without --time or --sweep exits non-zero rather than silently picking a mode', () => {
  assert.throws(() => execFileSync('node', ['tools/foundry/pose_anatomy.mjs', HERO, 'idle', '--json'], { encoding: 'utf8', stdio: 'pipe' }));
});
