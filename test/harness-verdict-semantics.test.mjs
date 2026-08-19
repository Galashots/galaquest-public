// A gating runtime harness must never print PASS for a predicate that actually failed.
//
// What this exists to stop, verbatim from full-playtest-matrix run 32145588997 on the integration
// lane, where drive-two-clients printed:
//
//   PASS  walking client A through the wolf never jumps more than 2x MIN_BODY_SEPARATION in one
//         frame — largest frame-to-frame step 5.651m against a 2.000m budget, over 3 samples
//
// 5.651 > 2.000. It read as PASS only because the assertion had been written as
// `check(name, hostedHeadless || predicate, detail)`, so the user agent — not the measurement —
// decided the verdict. That is not a weaker gate, it is a false statement, and anyone comparing a
// baseline run against an integration run reads the suppression as a repair.
//
// The rule these tests enforce:
//   PASS  = the asserted predicate actually passed.
//   FAIL  = a gating predicate actually failed.
//   DIAG  = the environment cannot authoritatively judge this measurement. Neither pass nor fail,
//           always prints what the predicate really did, never counts toward failures.
//
// Environment-conditioned *diagnostics* stay allowed and useful. Environment-conditioned *truth
// substitution inside a gating check* does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const HARNESS_DIR = join(import.meta.dirname, '..', 'tools', 'runtime-test');

/** Comments legitimately quote the forbidden pattern (this file's own header does). Scan code. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every `check(` / `diagnostic(` call site, as source text, balanced to its closing paren. */
function callSites(code, fnName) {
  const sites = [];
  const needle = `${fnName}(`;
  let from = 0;
  for (;;) {
    const start = code.indexOf(needle, from);
    if (start === -1) break;
    const before = code[start - 1];
    // Skip `function check(` and property/method accesses like `.check(`.
    if (before === '.' || /[A-Za-z0-9_$]/.test(before ?? '')) { from = start + needle.length; continue; }
    let depth = 0;
    let i = start + needle.length - 1;
    for (; i < code.length; i += 1) {
      if (code[i] === '(') depth += 1;
      else if (code[i] === ')') { depth -= 1; if (depth === 0) break; }
    }
    sites.push(code.slice(start, i + 1));
    from = i + 1;
  }
  return sites;
}

// A bypass is an environment probe used as a disjunct — the shape that makes a predicate
// unconditionally true. `!hostedHeadless` passed as an `authoritative:` field is the sanctioned form
// and is deliberately not matched.
// An environment probe adjacent to a `||` inside a gating predicate. The `[^|&]{0,40}` window keeps
// it to the same disjunct, so an unrelated `a || b` elsewhere in a long call does not match. The
// sanctioned `{ authoritative: !hostedHeadless }` form carries no `||` and is deliberately not
// matched — the sabotage tests below pin both directions.
const BYPASS = /(?:hostedHeadless|HeadlessChrome)[^|&]{0,40}\|\||\|\|[^|&]{0,40}(?:hostedHeadless|HeadlessChrome)/;

/**
 * Renaming the probe must not defeat the scanner. Any identifier assigned from a HeadlessChrome
 * test is an alias for it, and is treated exactly the same way.
 *
 *   const hosted = await page.eval("navigator.userAgent.includes('HeadlessChrome')");
 *   check('x', hosted || predicate, 'd');            // must still be caught
 */
function bypassFor(code) {
  const aliases = new Set(['hostedHeadless', 'HeadlessChrome']);
  for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^;\n]*HeadlessChrome/g)) {
    aliases.add(m[1]);
  }
  // Also treat a field carrying the probe (`final.hostedHeadless`, `state.hosted`) as an alias.
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*[^,;\n]*HeadlessChrome/g)) aliases.add(m[1]);
  const names = [...aliases].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(?:${names})[^|&]{0,40}\\|\\||\\|\\|[^|&]{0,40}(?:${names})`);
}

/** `X ? true : Y` substitutes truth for a predicate no matter what X is. */
const TERNARY_TRUE = /\?\s*true\s*:/;

const harnesses = readdirSync(HARNESS_DIR)
  .filter((f) => f.endsWith('.mjs'))
  .filter((f) => /^(drive|play|fit|review)-/.test(f));

test('gating harnesses exist to scan', () => {
  assert.ok(harnesses.length >= 15, `expected the harness fleet, found ${harnesses.length}`);
});

test('no gating check() has its predicate short-circuited by an environment probe', () => {
  const offenders = [];
  for (const file of harnesses) {
    const code = stripComments(readFileSync(join(HARNESS_DIR, file), 'utf8'));
    const bypass = bypassFor(code);
    for (const site of callSites(code, 'check')) {
      if (bypass.test(site)) offenders.push(`${file}: ${site.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
  assert.deepEqual(offenders, [],
    'a gating check() must not be made true by the user agent — use diagnostic() instead:\n'
    + offenders.join('\n'));
});

test('no gating check() substitutes literal truth for its predicate via a ternary', () => {
  const offenders = [];
  for (const file of harnesses) {
    const code = stripComments(readFileSync(join(HARNESS_DIR, file), 'utf8'));
    for (const site of callSites(code, 'check')) {
      if (TERNARY_TRUE.test(site)) offenders.push(`${file}: ${site.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
  assert.deepEqual(offenders, [],
    'a gating check() must not be handed `cond ? true : …` — that is truth substitution:\n'
    + offenders.join('\n'));
});

test('an aggregate summary never counts DIAG as a passed check', () => {
  const offenders = [];
  for (const file of harnesses) {
    const code = stripComments(readFileSync(join(HARNESS_DIR, file), 'utf8'));
    if (!/function diagnostic\s*\(/.test(code)) continue;
    // `results.length - failures` treats every not-judged result as a pass. drive-touch printed
    // "26/26 checks passed" while three predicates had actually been VIOLATED.
    if (/results\.length\s*-\s*failures/.test(code)) offenders.push(`${file}: results.length - failures`);
    if (!/r\.passed\s*===\s*true/.test(code)) offenders.push(`${file}: summary does not count real passes explicitly`);
    if (!/outcome\s*===\s*'DIAG'/.test(code)) offenders.push(`${file}: summary does not count DIAG separately`);
  }
  assert.deepEqual(offenders, [],
    'a harness that can emit DIAG must report PASS/FAIL/DIAG separately:\n' + offenders.join('\n'));
});

test('DIAG does not affect exit status — exit is driven by failures alone', () => {
  for (const file of harnesses) {
    const code = stripComments(readFileSync(join(HARNESS_DIR, file), 'utf8'));
    if (!/function diagnostic\s*\(/.test(code)) continue;
    const exits = [...code.matchAll(/process\.exit\(([^)]*)\)/g)].map((m) => m[1]);
    assert.ok(exits.length > 0, `${file}: expected an explicit process.exit`);
    for (const arg of exits) {
      assert.doesNotMatch(arg, /DIAG|outcome/,
        `${file}: exit status must not consider DIAG — got process.exit(${arg})`);
    }
    // A bare `process.exit(1)` is the fail-closed path (missing input, harness crash) and must stay.
    // What matters is that the FINAL verdict is driven by `failures` alone, never by DIAG counts.
    assert.ok(exits.some((arg) => /failures/.test(arg)),
      `${file}: the final exit must be driven by failures — got ${exits.map((a) => `process.exit(${a})`).join(', ')}`);
  }
});

test('any harness that probes the environment also defines the three-state diagnostic() helper', () => {
  const missing = [];
  for (const file of harnesses) {
    const code = stripComments(readFileSync(join(HARNESS_DIR, file), 'utf8'));
    if (!/hostedHeadless|HeadlessChrome/.test(code)) continue;
    if (!/function diagnostic\s*\(/.test(code)) missing.push(file);
  }
  assert.deepEqual(missing, [],
    `these harnesses probe the environment but have no diagnostic() to report a NOT-JUDGED outcome: ${missing.join(', ')}`);
});

test('diagnostic() never counts toward failures, and never prints PASS when not authoritative', () => {
  for (const file of harnesses) {
    const code = stripComments(readFileSync(join(HARNESS_DIR, file), 'utf8'));
    const decl = code.match(/function diagnostic\s*\([\s\S]*?\n\}/);
    if (!decl) continue;
    const body = decl[0];
    assert.match(body, /authoritative/, `${file}: diagnostic() must branch on an authoritative flag`);
    assert.match(body, /DIAG/, `${file}: diagnostic() must emit a DIAG outcome`);
    assert.doesNotMatch(body, /failures\s*\+=/,
      `${file}: diagnostic() must not increment failures — a not-judged measurement is not a failure`);
  }
});

// Sabotage: prove the detector is not vacuous. If these fail, every test above is decoration.
test('sabotage: the bypass detector really catches the shapes it is meant to catch', () => {
  const bad = [
    "check('x', hostedHeadless || maxJump <= 2, 'detail');",
    "check('x', predicate || hostedHeadless, 'detail');",
    "check('x', final.hostedHeadless || lagSeen, 'detail');",
    "check('x', navigator.userAgent.includes('HeadlessChrome') || ok, 'd');",
  ];
  for (const source of bad) {
    const [site] = callSites(source, 'check');
    assert.ok(site, `could not parse the call site out of: ${source}`);
    assert.ok(BYPASS.test(site), `detector missed a real bypass: ${source}`);
  }
});

test('sabotage: renaming the probe through an alias does not defeat the scanner', () => {
  const aliased = [
    "const hosted = await page.eval(\"navigator.userAgent.includes('HeadlessChrome')\");\ncheck('x', hosted || maxJump <= 2, 'd');",
    "let slowBox = ua.includes('HeadlessChrome');\ncheck('x', predicate || slowBox, 'd');",
  ];
  for (const source of aliased) {
    const bypass = bypassFor(source);
    const sites = callSites(source, 'check');
    assert.ok(sites.length > 0, `could not parse a call site from: ${source}`);
    assert.ok(sites.some((s) => bypass.test(s)), `alias defeated the scanner: ${source}`);
  }
});

test('sabotage: ternary truth substitution is caught', () => {
  const [site] = callSites("check('x', hostedHeadless ? true : maxJump <= 2, 'd');", 'check');
  assert.ok(TERNARY_TRUE.test(site), 'ternary truth substitution slipped through');
});

test('sabotage: the detector does not fire on the sanctioned diagnostic() form', () => {
  const good = [
    "diagnostic('x', maxJump <= 2, 'detail', { authoritative: !hostedHeadless, reason: 'r' });",
    "check('x', selfDrift <= 0.3, 'drift');",
    "check('x', a || b, 'ordinary disjunction is fine');",
  ];
  for (const source of good) {
    for (const site of callSites(source, 'check')) {
      assert.ok(!BYPASS.test(site), `detector produced a false positive on: ${source}`);
    }
  }
});

test('sabotage: comment text quoting the forbidden pattern does not trip the scanner', () => {
  const source = [
    '// check(name, hostedHeadless || predicate, detail) is the shape this forbids',
    '/* check("x", hostedHeadless || y, "d") */',
    "check('x', realPredicate, 'detail');",
  ].join('\n');
  for (const site of callSites(stripComments(source), 'check')) {
    assert.ok(!BYPASS.test(site), 'comments must not be scanned as code');
  }
});
