// test/mistakes-ledger.test.mjs
//
// Makes the docs/MISTAKES.md ratchet mechanical rather than aspirational. Three checks, per the
// ratchet table at the top of that file:
//   1. Every ENFORCED entry names a test file (backtick-quoted, after "Enforced by:") that actually
//      exists in the repo. An ENFORCED claim pointing at a deleted or renamed test is a false claim
//      of enforcement -- exactly the kind of drift docs/MISTAKES.md exists to stop happening to
//      itself.
//   2. Every GQ-NNN id is unique -- never reused, so a citation always resolves to one entry.
//   3. Every RULE entry with Hits >= 3 states a reason it isn't enforced (a "Not enforced because:"
//      line). An unexplained RULE at 3+ hits is itself a finding, per the ratchet table.
//
// This is a text scanner, the same shape as test/no-npm-imports.test.mjs and
// test/combat-purity.test.mjs: walk the source, regex out the structure, fail naming the offending
// entry. It does not (and cannot) check that an entry's prose is *true* -- only that the ledger's
// own bookkeeping is internally consistent.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const ledgerPath = join(repoRoot, 'docs', 'MISTAKES.md');

function parseEntries(source) {
  // Split on lines starting with "### " -- one block per lesson. Drop the preamble before the
  // first entry (the ratchet table and its explanation).
  const blocks = source.split(/\n(?=### )/).filter((b) => b.startsWith('### '));
  return blocks.map((block) => {
    const headerLine = block.slice(0, block.indexOf('\n')).replace(/^###\s*/, '').trim();
    // Match the id anywhere in the prefix before the first em-dash separator, so both "GQ-007 — ..."
    // and "RULE (GQ-022) — ..." header shapes are covered by the uniqueness check below.
    const sep = headerLine.indexOf(' — ');
    const idMatch = (sep === -1 ? headerLine : headerLine.slice(0, sep)).match(/(GQ-\d+)/);
    const status = block.match(/\*\*Status:\*\*\s*(\w+)/)?.[1] ?? null;
    const hits = Number(block.match(/\*\*Hits:\*\*\s*(\d+)/)?.[1] ?? NaN);
    const enforcedBy = block.match(/\*\*Enforced by:\*\*\s*`([^`]+)`/)?.[1] ?? null;
    const hasNotEnforcedReason = /\*\*Not enforced because:\*\*\s*\S/.test(block);
    return { header: headerLine, id: idMatch ? idMatch[1] : null, status, hits, enforcedBy, hasNotEnforcedReason };
  });
}

const source = readFileSync(ledgerPath, 'utf8');
const entries = parseEntries(source);

test('docs/MISTAKES.md has at least one entry (parser sanity)', () => {
  assert.ok(entries.length > 0,
    'parseEntries found nothing in docs/MISTAKES.md -- the parser is broken, not the ledger empty');
});

test('every ENFORCED entry in docs/MISTAKES.md names a test file that exists', () => {
  const violations = [];
  for (const entry of entries) {
    if (entry.status !== 'ENFORCED') continue;
    if (!entry.enforcedBy) {
      violations.push(`${entry.header}: Status is ENFORCED but has no "**Enforced by:** \`...\`" line`);
      continue;
    }
    const testPath = join(repoRoot, entry.enforcedBy);
    if (!existsSync(testPath)) {
      violations.push(`${entry.header}: Enforced by '${entry.enforcedBy}', which does not exist at ${testPath}`);
    }
  }
  assert.deepEqual(violations, [],
    'docs/MISTAKES.md claims enforcement that does not exist:\n  ' + violations.join('\n  '));
});

test('every GQ-NNN id in docs/MISTAKES.md is unique', () => {
  const ids = entries.map((e) => e.id).filter(Boolean);
  const seen = new Map();
  const duplicates = [];
  for (const id of ids) {
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const [id, count] of seen) {
    if (count > 1) duplicates.push(`${id} appears ${count} times`);
  }
  assert.deepEqual(duplicates, [],
    'docs/MISTAKES.md reuses a GQ-NNN id (ids must be stable and never reused):\n  '
    + duplicates.join('\n  '));
});

// The index table near the top of the ledger exists so agents can route in by tag or title instead
// of reading 1500+ lines end to end. It is only trustworthy if it cannot drift: every row must match
// a real entry heading, every entry must have a row, and tags must come from the fixed vocabulary the
// index itself declares.
const INDEX_TAGS = new Set([
  'code', 'tests', 'harness', 'evidence', 'visual', 'gameplay', 'net', 'persistence', 'ci', 'docs',
  'assets',
]);

function parseIndexRows(src) {
  const rows = [];
  const pattern = /^\|\s*(GQ-\d+|—)\s*\|\s*(.+?)\s*\|\s*([a-z, ]+?)\s*\|\s*$/gm;
  for (const match of src.matchAll(pattern)) {
    rows.push({
      ref: match[1],
      title: match[2],
      tags: match[3].split(',').map((t) => t.trim()).filter(Boolean),
    });
  }
  return rows;
}

function entryKey(header) {
  // "GQ-007 — title", "OBSERVED — title", "RULE (GQ-022) — title". Split on the FIRST em-dash
  // separator only: titles may legitimately contain further " — " (GQ-019 does).
  const sep = header.indexOf(' — ');
  const prefix = sep === -1 ? header : header.slice(0, sep);
  const title = sep === -1 ? '' : header.slice(sep + 3).trim();
  const id = prefix.match(/GQ-\d+/)?.[0] ?? '—';
  return `${id} | ${title}`;
}

const indexRows = parseIndexRows(source);

test('the docs/MISTAKES.md index matches the entries exactly, both directions', () => {
  const fromIndex = indexRows.map((r) => `${r.ref} | ${r.title}`).sort();
  const fromEntries = entries.map((e) => entryKey(e.header)).sort();
  const missingRows = fromEntries.filter((k) => !fromIndex.includes(k));
  const staleRows = fromIndex.filter((k) => !fromEntries.includes(k));
  assert.deepEqual({ missingRows, staleRows }, { missingRows: [], staleRows: [] },
    'index and entries disagree (add the row in the same commit as the entry):\n  missing rows: '
    + missingRows.join('\n  missing rows: ') + '\n  stale rows: ' + staleRows.join('\n  stale rows: '));
});

test('every docs/MISTAKES.md index tag comes from the declared vocabulary', () => {
  const violations = [];
  for (const row of indexRows) {
    if (row.tags.length === 0) violations.push(`${row.title}: no tags`);
    for (const tag of row.tags) {
      if (!INDEX_TAGS.has(tag)) violations.push(`${row.title}: unknown tag '${tag}'`);
    }
  }
  assert.deepEqual(violations, [],
    'index tags must stay greppable against the fixed vocabulary:\n  ' + violations.join('\n  '));
});

test('every RULE entry at 3+ hits in docs/MISTAKES.md states why it is not enforced', () => {
  const violations = [];
  for (const entry of entries) {
    if (entry.status !== 'RULE') continue;
    if (!Number.isFinite(entry.hits) || entry.hits < 3) continue;
    if (!entry.hasNotEnforcedReason) {
      violations.push(`${entry.header}: RULE at ${entry.hits} hits has no "**Not enforced because:** ..." line`);
    }
  }
  assert.deepEqual(violations, [],
    'an unexplained RULE at 3+ hits is itself a finding, per the ratchet table:\n  '
    + violations.join('\n  '));
});
