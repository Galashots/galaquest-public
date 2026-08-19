import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { HERO_URL } from '../public/src/character/hero.js';
import { IDLE_HOLD_TIME } from '../public/src/character/locomotion.js';
import { DEATH_SECONDS, STAGGER_SECONDS } from '../public/src/combat/encounter.js';

// Same 12-byte-header, first-chunk-is-JSON read every other GLB test in this repo uses -- see
// test/gear-attachment.test.mjs. No dependency, no Blender, no three.js: this reads exactly the
// bytes the browser's GLTFLoader parses, not a loader's interpretation of them.
function readGlbJson(path) {
  const bytes = readFileSync(path);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, 'GLB starts with a JSON chunk');
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
}

// Mirrors locomotion.js's own findClip exactly (clip.name.toLowerCase().includes(fragment)), so a
// pass here proves the SAME rule that picks a clip at runtime, not a rule that merely resembles it.
function findByFragment(names, fragment) {
  return names.find((name) => name.toLowerCase().includes(fragment));
}

// duration = the max time value across a clip's own sampler input accessors: what
// tools/foundry/clip_inventory.mjs reports and what three.js's AnimationClip.resetDuration()
// computes at runtime, since glTF requires sampler input times to increase monotonically. See that
// tool's header comment for the full argument; repeated here rather than imported because this file
// checks a handful of specific numbers, not a general report, and duplicating four lines beats
// coupling a test to a CLI script's internals.
function clipDuration(document, clipName) {
  const clip = document.animations.find((animation) => animation.name === clipName);
  assert.ok(clip, `no clip named '${clipName}'`);
  let duration = -Infinity;
  for (const channel of clip.channels) {
    const accessor = document.accessors[clip.samplers[channel.sampler].input];
    duration = Math.max(duration, accessor.max[0]);
  }
  return duration;
}

// encounter.js's header comment states its wolf timings were "matched to the clips wolf.glb
// actually ships, measured rather than guessed" and quotes them rounded to three decimals (e.g.
// "hit 0.667s" for a clip that actually measures 0.6666666...s). The tolerance accepts that
// rounding without accepting a genuinely different clip.
const ROUNDED_TO_MILLIS = 1e-3;

test('the hero GLB that hero.js actually loads ships the six clips the runtime expects', () => {
  // HERO_URL, not hero.glb: hero.glb is a separate, older file kept for test/hero-asset.test.mjs's
  // byte-exact regression pin, but it is not what loadHero() fetches, and nothing previously
  // asserted the clip list of the file the running game actually loads.
  //
  // Was two clips until 2026-08-13, when idle, combat_stance, sword_slash and shield_push were
  // merged in from the owner's animation pack by tools/foundry/merge_clips.mjs. hit and death joined
  // later the same day, downloaded per-motion from the same human-base-body card in the browser
  // (the failed 197MB attempt was the All Added bundle; Current-motion downloads are ~25MB each).
  const document = readGlbJson(`public/${HERO_URL}`);
  const names = document.animations.map((animation) => animation.name).sort();

  assert.deepEqual(names, [
    'Armature|running|baselayer',
    'Armature|walking_man|baselayer',
    'combat_stance',
    'death',
    'hit',
    'idle',
    'shield_push',
    'sword_slash',
  ]);
});

// The runtime finds its clips by SUBSTRING -- locomotion.js's findClip and swingClip.js's
// findSwingClip both use `name.toLowerCase().includes(fragment)` and take the FIRST match. With two
// clips that was safe by inspection. With six it is not: a future clip named "idle_combat" or
// "sword_slash_heavy" would match an existing fragment, and whichever the exporter happened to order
// first would silently become the hero's idle or attack. Nothing would throw and nothing would look
// obviously broken -- it would just be the wrong animation.
test('every clip fragment the runtime looks up matches exactly one clip, not merely at least one', () => {
  const document = readGlbJson(`public/${HERO_URL}`);
  const names = document.animations.map((animation) => animation.name);

  // The fragment, and the file that would silently take the wrong clip if it became ambiguous.
  const fragments = [
    ['walking', 'character/locomotion.js'],
    ['running', 'character/locomotion.js'],
    ['idle', 'character/locomotion.js'],
    ['sword_slash', 'character/swingClip.js'],
    ['hit', 'character/reactClips.js'],
    ['death', 'character/reactClips.js'],
  ];

  for (const [fragment, owner] of fragments) {
    const matches = names.filter((name) => name.toLowerCase().includes(fragment));
    assert.equal(matches.length, 1,
      `'${fragment}' (${owner}) matched ${matches.length} clips: ${matches.join(', ') || 'none'}`);
  }
});

test("locomotion.js's 'walking' and 'running' substring lookups each resolve to a real, distinct clip", () => {
  const document = readGlbJson(`public/${HERO_URL}`);
  const names = document.animations.map((animation) => animation.name);

  const walk = findByFragment(names, 'walking');
  const run = findByFragment(names, 'running');
  assert.ok(walk, "no clip name contains 'walking' -- createLocomotionController would run with no walk action");
  assert.ok(run, "no clip name contains 'running' -- createLocomotionController would run with no run action");
  assert.notEqual(walk, run, 'walk and run must not resolve to the same clip');
});

test('IDLE_HOLD_TIME still falls inside the walking clip it freezes a frame of', () => {
  const document = readGlbJson(`public/${HERO_URL}`);
  const duration = clipDuration(document, 'Armature|walking_man|baselayer');

  // If a re-export ever shortens the walk clip below this, the "standing" pose silently clamps to
  // the clip's last frame instead of the deliberately-chosen arms-swapped pose locomotion.js
  // describes picking (see its comment on IDLE_HOLD_TIME).
  assert.ok(
    IDLE_HOLD_TIME < duration,
    `IDLE_HOLD_TIME ${IDLE_HOLD_TIME} must be inside the walking clip's measured ${duration}s`,
  );
});

test('the wolf GLB still ships the five named clips encounter.js was tuned against', () => {
  const document = readGlbJson('public/assets/enemies/wolf.glb');
  const names = document.animations.map((animation) => animation.name).sort();

  assert.deepEqual(names, ['bite', 'death', 'hit', 'idle', 'walk']);
});

test("encounter.js's STAGGER_SECONDS still matches the shipped 'hit' clip duration", () => {
  const document = readGlbJson('public/assets/enemies/wolf.glb');
  const measured = clipDuration(document, 'hit');

  assert.ok(
    Math.abs(STAGGER_SECONDS - measured) < ROUNDED_TO_MILLIS,
    `STAGGER_SECONDS is ${STAGGER_SECONDS}, the shipped 'hit' clip measures ${measured}`,
  );
});

test("encounter.js's DEATH_SECONDS still matches the shipped 'death' clip duration", () => {
  // wolf.mode goes 'dying' while this timer runs, but the clip that plays for it is named 'death'
  // -- a naming mismatch that whatever code eventually maps mode to clip will have to account for.
  // See the animation-coverage dossier for the full mode-name/clip-name comparison.
  const document = readGlbJson('public/assets/enemies/wolf.glb');
  const measured = clipDuration(document, 'death');

  assert.ok(
    Math.abs(DEATH_SECONDS - measured) < ROUNDED_TO_MILLIS,
    `DEATH_SECONDS is ${DEATH_SECONDS}, the shipped 'death' clip measures ${measured}`,
  );
});
