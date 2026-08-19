// The pure half of the SR1 Sol review bridge (tools/sol-review/worker.mjs, protocol.mjs). No git, no
// filesystem, no Drive here on purpose -- the fast unit suite stays hermetic and network-free, same
// as every other test in this directory. tools/sol-review/worker.mjs itself is exercised by actually
// running it against the real sol-review-control branch (see that branch's own README.md); this file
// only pins the schema-interpretation and seen-tracking logic it depends on.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validate, alreadySeen, withSeen } from '../tools/sol-review/protocol.mjs';

// The schema beside the trusted worker is authoritative. Tests read that exact file so CI cannot
// go green against a hand-copied contract that the live bridge rejects.
const SCHEMA = JSON.parse(readFileSync(
  new URL('../tools/sol-review/request.schema.json', import.meta.url),
  'utf8',
));
const TUNING_OVERRIDE_SCHEMA = SCHEMA.else.then.properties.request.properties.tuningOverride;

const VALID_STUDIO_STATE = {
  protocolVersion: 1,
  sessionId: 'SOL-STUDIO-STATE-SMOKE',
  seq: 1,
  mode: 'studioState',
  ref: 'main',
  request: {},
};

const VALID_STUDIO_CAPTURE = {
  protocolVersion: 1,
  sessionId: 'SOL-STUDIO-SMOKE',
  seq: 1,
  mode: 'studioCapture',
  ref: 'main',
  request: {
    character: 'hero',
    animation: 'idle',
    views: [{ scale: 'inspection', bearing: 'front' }, { scale: 'gameplay', bearing: 'three-quarter' }],
  },
};

const VALID_PING = {
  protocolVersion: 1,
  sessionId: 'SOL-BRIDGE-SMOKE',
  seq: 1,
  mode: 'ping',
  request: {},
};

test('a well-formed ping request validates cleanly', () => {
  assert.deepEqual(validate(SCHEMA, VALID_PING), []);
});

test('a well-formed ping request with an optional ref still validates cleanly', () => {
  assert.deepEqual(validate(SCHEMA, { ...VALID_PING, ref: 'main' }), []);
});

test('sabotage: validate is not vacuously true -- garbage input actually produces errors', () => {
  assert.ok(validate(SCHEMA, { nonsense: true }).length > 0);
});

test('rejects an unknown top-level field', () => {
  const errors = validate(SCHEMA, { ...VALID_PING, op: 'shell' });
  assert.ok(errors.some((e) => e.includes('unknown field "op"')));
});

test('rejects a missing required field', () => {
  const { sessionId, ...withoutSessionId } = VALID_PING;
  const errors = validate(SCHEMA, withoutSessionId);
  assert.ok(errors.some((e) => e.includes('missing required field "sessionId"')));
});

test('rejects the wrong protocolVersion', () => {
  const errors = validate(SCHEMA, { ...VALID_PING, protocolVersion: 2 });
  assert.ok(errors.some((e) => e.includes('expected const 1')));
});

test('rejects a mode outside the closed enum -- this is how "unknown operation" is enforced', () => {
  const errors = validate(SCHEMA, { ...VALID_PING, mode: 'shellExec' });
  assert.ok(errors.some((e) => e.includes('is not one of')));
});

test('rejects a sessionId outside the safe charset (path-traversal defence)', () => {
  const errors = validate(SCHEMA, { ...VALID_PING, sessionId: '../../etc/passwd' });
  assert.ok(errors.some((e) => e.includes('does not match')));
});

test('rejects a non-integer seq', () => {
  const errors = validate(SCHEMA, { ...VALID_PING, seq: 1.5 });
  assert.ok(errors.some((e) => e.includes('expected an integer')));
});

test('rejects seq below the minimum', () => {
  const errors = validate(SCHEMA, { ...VALID_PING, seq: 0 });
  assert.ok(errors.some((e) => e.includes('below minimum 1')));
});

test('rejects a non-empty request object for ping -- ping carries no fields', () => {
  const errors = validate(SCHEMA, { ...VALID_PING, request: { op: 'moveStick' } });
  assert.ok(errors.some((e) => e.includes('max is 0')));
});

test('the exact known-illegal example from owner-plan.md section 6 is rejected', () => {
  const illegal = { protocolVersion: 1, sessionId: 'X', seq: 1, mode: 'ping', request: { op: 'shell', command: 'rm -rf /' } };
  const errors = validate(SCHEMA, illegal);
  assert.ok(errors.length > 0);
});

test('alreadySeen is false for a session never recorded', () => {
  assert.equal(alreadySeen({}, 'SOL-X', 1), false);
});

test('withSeen then alreadySeen finds exactly the recorded (sessionId, seq) pair', () => {
  const seen = withSeen({}, 'SOL-X', 1);
  assert.equal(alreadySeen(seen, 'SOL-X', 1), true);
});

test('withSeen does not mark a DIFFERENT seq in the same session as seen', () => {
  const seen = withSeen({}, 'SOL-X', 1);
  assert.equal(alreadySeen(seen, 'SOL-X', 2), false);
});

test('withSeen does not mark the same seq in a DIFFERENT session as seen', () => {
  const seen = withSeen({}, 'SOL-X', 1);
  assert.equal(alreadySeen(seen, 'SOL-Y', 1), false);
});

test('withSeen does not mutate the store it was given -- callers can compare before/after', () => {
  const before = {};
  withSeen(before, 'SOL-X', 1);
  assert.deepEqual(before, {});
});

test('withSeen accumulates multiple seqs for the same session rather than overwriting', () => {
  let seen = withSeen({}, 'SOL-X', 1);
  seen = withSeen(seen, 'SOL-X', 2);
  assert.deepEqual(seen['SOL-X'], [1, 2]);
});

test('sabotage: alreadySeen is not a constant -- a genuinely unseen pair reads false after a seen one reads true', () => {
  const seen = withSeen({}, 'SOL-X', 1);
  assert.equal(alreadySeen(seen, 'SOL-X', 1), true);
  assert.equal(alreadySeen(seen, 'SOL-X', 99), false);
});

// ── SR3: studioCapture, and the if/then/else conditional that dispatches on `mode` ────────────────

test('a well-formed studioCapture request validates cleanly', () => {
  assert.deepEqual(validate(SCHEMA, VALID_STUDIO_CAPTURE), []);
});

test('studioCapture with the optional timeSeconds and lightingMode also validates cleanly', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, timeSeconds: 0.5, lightingMode: 'diagnostic' } };
  assert.deepEqual(validate(SCHEMA, req), []);
});

test('sabotage: the SAME request object validates under studioCapture and fails under ping -- proves the if/then/else actually dispatches on mode rather than always taking one branch', () => {
  const asStudioCapture = validate(SCHEMA, VALID_STUDIO_CAPTURE);
  const asPing = validate(SCHEMA, { ...VALID_STUDIO_CAPTURE, mode: 'ping' });
  assert.deepEqual(asStudioCapture, []);
  assert.ok(asPing.length > 0);
});

test('rejects studioCapture with a ping-shaped (empty) request -- the request.character etc are required', () => {
  const errors = validate(SCHEMA, { ...VALID_STUDIO_CAPTURE, request: {} });
  assert.ok(errors.some((e) => e.includes('missing required field "character"')));
});

test('rejects a character other than "hero" -- only hero is implemented in SR2/SR3', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, character: 'keeper' } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('is not one of')));
});

test('rejects an empty views array -- minItems 1', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, views: [] } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('min is 1')));
});

test('rejects a view with an unknown scale', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, views: [{ scale: 'macro', bearing: 'front' }] } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('is not one of')));
});

test('rejects a view missing its bearing field', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, views: [{ scale: 'gameplay' }] } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('missing required field "bearing"')));
});

test('rejects a negative timeSeconds', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, timeSeconds: -1 } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('below minimum 0')));
});

test('accepts a non-integer timeSeconds -- unlike seq, this is a real number', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, timeSeconds: 0.8333 } };
  assert.deepEqual(validate(SCHEMA, req), []);
});

test('rejects an unknown field inside a view object -- additionalProperties false is per-item, not just top-level', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, views: [{ scale: 'gameplay', bearing: 'front', zoom: 2 }] } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('unknown field "zoom"')));
});

// ── SR4: studioState, the third if/then/else branch keyed on `mode` ────────────────────────────────

test('a well-formed studioState request validates cleanly', () => {
  assert.deepEqual(validate(SCHEMA, VALID_STUDIO_STATE), []);
});

test('rejects a non-empty request object for studioState -- it is read-only discovery, like ping', () => {
  const errors = validate(SCHEMA, { ...VALID_STUDIO_STATE, request: { character: 'hero' } });
  assert.ok(errors.some((e) => e.includes('max is 0')));
});

test('sabotage: the SAME empty request validates under studioState and ping, but studioState is rejected under studioCapture -- proves the third branch actually dispatches on mode', () => {
  const asStudioState = validate(SCHEMA, VALID_STUDIO_STATE);
  const asStudioCapture = validate(SCHEMA, { ...VALID_STUDIO_STATE, mode: 'studioCapture' });
  assert.deepEqual(asStudioState, []);
  assert.ok(asStudioCapture.some((e) => e.includes('missing required field "character"')));
});

test('rejects mode "studioState" is still enforced by the closed enum, not a typo left open', () => {
  const errors = validate(SCHEMA, { ...VALID_STUDIO_STATE, mode: 'studioStates' });
  assert.ok(errors.some((e) => e.includes('is not one of')));
});

// ── SR4: studioCapture's optional loadout field (the locked comparison primitive) ──────────────────

test('studioCapture with loadout "candidate-with-lantern" validates cleanly -- loadout is optional', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, loadout: 'candidate-with-lantern' } };
  assert.deepEqual(validate(SCHEMA, req), []);
});

test('studioCapture without a loadout field still validates cleanly -- defaults live in the worker, not the schema', () => {
  assert.deepEqual(validate(SCHEMA, VALID_STUDIO_CAPTURE), []);
  assert.ok(!('loadout' in VALID_STUDIO_CAPTURE.request));
});

// Wave 1A (armour-progression-doctrine.md section 6), added after SR5 ACCEPTED.
test('studioCapture with loadout "candidate-wildwood-blade" validates cleanly', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, loadout: 'candidate-wildwood-blade' } };
  assert.deepEqual(validate(SCHEMA, req), []);
});

test('rejects a loadout value outside the closed enum -- no arbitrary candidate GLB/transform is accepted here', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, loadout: 'sword_silverguard_v3' } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('is not one of')));
});

// ── SR4 closeout fix: studioCapture's optional viewportPreset field ────────────────────────────────
// Sol's audit finding: studioState advertised 'portrait'/'landscape' as supported viewport presets
// while the worker only ever executed portrait. The schema addition below is the allow-listed request
// side of the fix; tools/sol-review/worker.mjs's bootStudioPage() is the execution side.

test('studioCapture with viewportPreset "landscape" validates cleanly', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, viewportPreset: 'landscape' } };
  assert.deepEqual(validate(SCHEMA, req), []);
});

test('studioCapture without a viewportPreset field still validates cleanly -- the default lives in the worker, not the schema', () => {
  assert.deepEqual(validate(SCHEMA, VALID_STUDIO_CAPTURE), []);
  assert.ok(!('viewportPreset' in VALID_STUDIO_CAPTURE.request));
});

test('rejects a viewportPreset value outside the closed two-preset enum -- no generalized viewport system', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, viewportPreset: 'square' } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('is not one of')));
});

// ── SR5: studioCapture's optional overlay/includeMeasurements fields ───────────────────────────────

test('studioCapture with overlay "grip" validates cleanly', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, overlay: 'grip' } };
  assert.deepEqual(validate(SCHEMA, req), []);
});

test('studioCapture with overlay "shield" and includeMeasurements true validates cleanly', () => {
  const req = {
    ...VALID_STUDIO_CAPTURE,
    request: { ...VALID_STUDIO_CAPTURE.request, overlay: 'shield', includeMeasurements: true },
  };
  assert.deepEqual(validate(SCHEMA, req), []);
});

test('studioCapture without overlay/includeMeasurements still validates cleanly -- both optional, defaults live in the worker', () => {
  assert.deepEqual(validate(SCHEMA, VALID_STUDIO_CAPTURE), []);
  assert.ok(!('overlay' in VALID_STUDIO_CAPTURE.request));
  assert.ok(!('includeMeasurements' in VALID_STUDIO_CAPTURE.request));
});

test('rejects an overlay value outside the closed three-value enum', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, overlay: 'weapon-trail' } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('is not one of')));
});

test('rejects a non-boolean includeMeasurements', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, includeMeasurements: 'yes' } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('expected a boolean')));
});

// SR5 closeout: includeMeasurements is the FIRST field in this schema ever typed `boolean`, and
// samples is the FIRST ever to declare a `maximum` -- both keywords turned out to be silently
// unenforced by protocol.mjs's own interpreter (a `type: 'boolean'` schema fell through every
// branch as a no-op, and only `minimum` was ever checked for integer/number). Fixed directly in
// protocol.mjs rather than worked around here, since that interpreter is the actual security
// boundary this schema is supposed to enforce (README.md's "Security rule").
test('regression: validate() itself enforces type "boolean", not just this schema copy', () => {
  const errors = validate({ type: 'boolean' }, 'not a boolean');
  assert.ok(errors.some((e) => e.includes('expected a boolean')));
  assert.deepEqual(validate({ type: 'boolean' }, true), []);
});

test('regression: validate() itself enforces a numeric "maximum", not just "minimum"', () => {
  const errors = validate({ type: 'integer', minimum: 1, maximum: 10 }, 11);
  assert.ok(errors.some((e) => e.includes('above maximum 10')));
  assert.deepEqual(validate({ type: 'integer', minimum: 1, maximum: 10 }, 10), []);
});

// ── SR5: studioFitEnvelope, the fourth if/then/else branch keyed on `mode` ─────────────────────────

const VALID_STUDIO_FIT_ENVELOPE = {
  protocolVersion: 1,
  sessionId: 'SOL-FIT-SMOKE',
  seq: 1,
  mode: 'studioFitEnvelope',
  ref: 'main',
  request: { clips: ['idle', 'walk', 'run'] },
};

test('a well-formed studioFitEnvelope request validates cleanly', () => {
  assert.deepEqual(validate(SCHEMA, VALID_STUDIO_FIT_ENVELOPE), []);
});

test('studioFitEnvelope with optional samples and loadout validates cleanly', () => {
  const req = {
    ...VALID_STUDIO_FIT_ENVELOPE,
    request: { ...VALID_STUDIO_FIT_ENVELOPE.request, samples: 12, loadout: 'candidate-with-lantern' },
  };
  assert.deepEqual(validate(SCHEMA, req), []);
});

test('rejects studioFitEnvelope with no clips field -- clips is required', () => {
  const errors = validate(SCHEMA, { ...VALID_STUDIO_FIT_ENVELOPE, request: {} });
  assert.ok(errors.some((e) => e.includes('missing required field "clips"')));
});

test('rejects studioFitEnvelope with an empty clips array -- minItems 1', () => {
  const req = { ...VALID_STUDIO_FIT_ENVELOPE, request: { clips: [] } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('min is 1')));
});

test('rejects studioFitEnvelope with more than 8 clips -- maxItems 8', () => {
  const req = { ...VALID_STUDIO_FIT_ENVELOPE, request: { clips: Array(9).fill('idle') } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('max is 8')));
});

test('rejects a samples value below the minimum or above the maximum', () => {
  const tooLow = validate(SCHEMA, { ...VALID_STUDIO_FIT_ENVELOPE, request: { clips: ['idle'], samples: 0 } });
  const tooHigh = validate(SCHEMA, { ...VALID_STUDIO_FIT_ENVELOPE, request: { clips: ['idle'], samples: 61 } });
  assert.ok(tooLow.some((e) => e.includes('below minimum 1')));
  assert.ok(tooHigh.some((e) => e.includes('above maximum 60')));
});

test('rejects an unknown field inside a studioFitEnvelope request', () => {
  const req = { ...VALID_STUDIO_FIT_ENVELOPE, request: { clips: ['idle'], animation: 'idle' } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('unknown field "animation"')));
});

test('sabotage: the SAME empty-clips-shaped request validates under studioFitEnvelope only when clips is actually present -- proves the fourth branch dispatches on mode, not a fallthrough', () => {
  const asFitEnvelope = validate(SCHEMA, VALID_STUDIO_FIT_ENVELOPE);
  const asStudioState = validate(SCHEMA, { ...VALID_STUDIO_FIT_ENVELOPE, mode: 'studioState' });
  assert.deepEqual(asFitEnvelope, []);
  assert.ok(asStudioState.some((e) => e.includes('max is 0')));
});

// ── SR5 closeout: tuningOverride on studioCapture and studioFitEnvelope ────────────────────────────

test('studioCapture with a well-formed tuningOverride validates cleanly', () => {
  const req = {
    ...VALID_STUDIO_CAPTURE,
    request: {
      ...VALID_STUDIO_CAPTURE.request,
      tuningOverride: { target: 'shield', positionDelta: [0.02, 0, -0.03], rotationDeltaDeg: [0, 15, 0] },
    },
  };
  assert.deepEqual(validate(SCHEMA, req), []);
});

test('studioFitEnvelope with a well-formed tuningOverride validates cleanly', () => {
  const req = { ...VALID_STUDIO_FIT_ENVELOPE, request: { ...VALID_STUDIO_FIT_ENVELOPE.request, tuningOverride: { target: 'sword' } } };
  assert.deepEqual(validate(SCHEMA, req), []);
});

test('tuningOverride with only "target" and no deltas validates cleanly -- every delta field is optional', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, tuningOverride: { target: 'sword' } } };
  assert.deepEqual(validate(SCHEMA, req), []);
});

test('rejects a tuningOverride missing "target" -- the one required field', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, tuningOverride: { positionDelta: [0, 0, 0] } } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('missing required field "target"')));
});

test('rejects a tuningOverride.target outside the closed sword|shield enum', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, tuningOverride: { target: 'helmet' } } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('is not one of')));
});

test('rejects a positionDelta component outside the +/-0.3m bound', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, tuningOverride: { target: 'sword', positionDelta: [0.5, 0, 0] } } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('above maximum 0.3')));
});

test('rejects a rotationDeltaDeg component outside the +/-90deg bound', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, tuningOverride: { target: 'sword', rotationDeltaDeg: [0, -200, 0] } } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('below minimum -90')));
});

test('rejects a scaleDelta outside the +/-0.5 bound', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, tuningOverride: { target: 'sword', scaleDelta: 1.2 } } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('above maximum 0.5')));
});

test('rejects a positionDelta with the wrong number of components', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, tuningOverride: { target: 'sword', positionDelta: [0.1, 0.1] } } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('min is 3')));
});

test('rejects an unknown field inside tuningOverride -- additionalProperties false applies here too', () => {
  const req = { ...VALID_STUDIO_CAPTURE, request: { ...VALID_STUDIO_CAPTURE.request, tuningOverride: { target: 'sword', path: '/etc/passwd' } } };
  const errors = validate(SCHEMA, req);
  assert.ok(errors.some((e) => e.includes('unknown field "path"')));
});

test('tuningOverride bounds in this schema mirror gearInspectors.js\'s own TUNING_BOUNDS -- regression guard against the two drifting apart', async () => {
  const { TUNING_BOUNDS } = await import('../public/src/character/gearInspectors.js');
  assert.equal(TUNING_OVERRIDE_SCHEMA.properties.positionDelta.items.maximum, TUNING_BOUNDS.positionDeltaMeters);
  assert.equal(TUNING_OVERRIDE_SCHEMA.properties.rotationDeltaDeg.items.maximum, TUNING_BOUNDS.rotationDeltaDegrees);
  assert.equal(TUNING_OVERRIDE_SCHEMA.properties.scaleDelta.maximum, TUNING_BOUNDS.scaleDelta);
});
