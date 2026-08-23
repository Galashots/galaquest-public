// A parameter a function READS must be a parameter its own doc DECLARES.
//
// GQ-002 hit 7, and the costliest form of it. `profileGateViewModel`'s JSDoc listed its heroes as
// `[{ id, displayName, marks, lanternUnlocked }]`; the function also read `hero.avatar`. main.js
// built its hero objects to match the documented list exactly, so every chooser card fell through
// to an id-derived fallback and the stored animal was written and never read. The caller was not
// careless -- it satisfied the contract as written. The contract was short one field.
//
// The ledger says GQ-002 as a whole is not mechanically enforceable, and that is right: "is this
// prose still true" needs a reader. But THIS sub-case is decidable, because both halves are in the
// source: the keys a function destructures, and the names its own @param block mentions. So it gets
// a check even though its parent rule cannot have one.
//
// DELIBERATELY NARROW. It only looks at exported functions whose parameter is a destructured object
// AND which already carry an @param block -- a function with no doc at all is a different argument,
// and this test takes no view on it. When it was written it found three omissions and zero false
// positives across public/src.

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

/** Every `export function name({ ... })` in a file, with its destructured keys and its JSDoc. */
function destructuringExports(source) {
  const lines = source.split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    const opener = lines[i].match(/^export function (\w+)\(\{\s*(.*)$/);
    if (!opener) continue;

    // The parameter list may run over several lines; stop at whichever close comes first.
    let block = '';
    for (let j = i; j < Math.min(i + 12, lines.length); j += 1) {
      block += lines[j];
      if (lines[j].includes('} = {}') || lines[j].includes('}) {')) break;
    }
    const inner = block.slice(block.indexOf('({') + 2, block.lastIndexOf('}'));
    const keys = inner
      .split(',')
      .map((part) => part.trim().split(/[=:]/)[0].trim())
      // Skip anything that is not a plain identifier: rest elements, nested patterns, fragments left
      // by the crude split above. Over-skipping loses coverage; mis-parsing invents a failure.
      .filter((key) => /^[a-zA-Z_$][\w$]*$/.test(key));
    if (keys.length === 0) continue;

    let doc = '';
    for (let j = i - 1; j >= 0; j -= 1) {
      const trimmed = lines[j].trim();
      if (!trimmed.startsWith('*') && !trimmed.startsWith('/**')) break;
      doc = `${lines[j]}\n${doc}`;
    }
    found.push({ name: opener[1], keys, doc });
  }
  return found;
}

test('every documented function declares the fields it actually destructures', () => {
  const offenders = [];
  for (const file of globSync('public/src/**/*.js')) {
    for (const fn of destructuringExports(readFileSync(file, 'utf8'))) {
      if (!fn.doc.includes('@param')) continue;
      const missing = fn.keys.filter((key) => !fn.doc.includes(key));
      if (missing.length > 0) offenders.push(`${file} ${fn.name}() reads but never declares: ${missing.join(', ')}`);
    }
  }
  assert.deepEqual(offenders, [], `\n${offenders.join('\n')}`);
});

test('the sweep is actually reaching functions, so a green here means something', () => {
  // The guard on the guard. If the parser stops matching -- a formatting change, a move to arrow
  // exports -- the check above goes quietly green over an empty set, which is the failure mode this
  // whole file exists to prevent one directory over.
  let documented = 0;
  let keysChecked = 0;
  for (const file of globSync('public/src/**/*.js')) {
    for (const fn of destructuringExports(readFileSync(file, 'utf8'))) {
      if (!fn.doc.includes('@param')) continue;
      documented += 1;
      keysChecked += fn.keys.length;
    }
  }
  assert.ok(documented >= 5, `only ${documented} documented destructuring exports found; the parser has stopped seeing them`);
  assert.ok(keysChecked >= 15, `only ${keysChecked} parameters swept`);
});

test('sabotage: an undeclared destructured field is really detected', () => {
  // Proves the detector rather than trusting it -- the same discipline the harnesses use, and the
  // reason this file can claim its green means anything.
  const withHole = [
    '/**',
    ' * @param declared  this one is written down',
    ' */',
    'export function example({ declared, undeclared = false }) {',
    '  return declared || undeclared;',
    '}',
  ].join('\n');
  const [fn] = destructuringExports(withHole);
  assert.deepEqual(fn.keys, ['declared', 'undeclared']);
  assert.deepEqual(fn.keys.filter((key) => !fn.doc.includes(key)), ['undeclared']);
});
