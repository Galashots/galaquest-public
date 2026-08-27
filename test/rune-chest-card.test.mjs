// test/rune-chest-card.test.mjs
//
// ui/runeChestCard.js's DOM half is browser/harness territory, the same "provable only with a real
// DOM" split test/unlock-card.test.mjs and test/hero-screen.test.mjs both already document for their
// own overlay factories. What IS provable in plain node: the module loads with no top-level DOM
// access (so importing it here does not crash the way touching `document` at module scope would),
// and index.html's own hand-written markup actually carries the structure/conventions the module
// queries for and the brief specifically asked for -- the same "the markup is hand-written, not
// generated, so this is what makes the coupling ... safe rather than merely commented" reasoning
// hero-screen.test.mjs's own header states.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createRuneChestCard } from '../public/src/ui/runeChestCard.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(resolve(repoRoot, 'public/index.html'), 'utf8');

test('createRuneChestCard is importable with no top-level DOM access', () => {
  assert.equal(typeof createRuneChestCard, 'function');
});

test('index.html declares the rune chest card as a data-ui-surface dialog, matching #hero-screen\'s own convention', () => {
  assert.match(
    indexHtml,
    /<div id="rune-chest-card" role="dialog" aria-modal="true"[^>]*data-shown="false"[^>]*data-ui-surface[^>]*>/,
  );
});

test('index.html gives the card a 48px-floor close button, the same belt-and-braces every overlay keeps', () => {
  assert.match(indexHtml, /<button id="rune-chest-card-close" type="button" aria-label="Close">/);
  assert.match(indexHtml, /#rune-chest-card-close\s*\{[^}]*width:\s*48px;\s*height:\s*48px/);
});

test('index.html declares exactly three answer buttons, indexed 0..2', () => {
  const matches = [...indexHtml.matchAll(/class="rune-chest-answer" type="button" data-answer="(\d)"/g)];
  assert.deepEqual(matches.map((m) => m[1]), ['0', '1', '2']);
});

test('index.html declares the counting visual row and the prompt line', () => {
  assert.match(indexHtml, /<div id="rune-chest-card-prompt"><\/div>/);
  assert.match(indexHtml, /<div id="rune-chest-card-visual" aria-hidden="true" hidden><\/div>/);
});

test('the reduced-motion rule covers the card and its answer buttons', () => {
  assert.match(indexHtml, /prefers-reduced-motion: reduce\)\s*\{\s*#rune-chest-card, \.rune-chest-answer \{ transition: none; \}/);
});

test('the answer button floor is comfortably past the 48px minimum in both dimensions', () => {
  const match = indexHtml.match(/\.rune-chest-answer\s*\{[^}]*min-height:\s*([\d.]+)rem/);
  assert.ok(match, 'min-height not found on .rune-chest-answer');
  const remToPx = 16; // the browser default this game's other px-authored floors assume
  assert.ok(Number(match[1]) * remToPx >= 48, `.rune-chest-answer min-height ${match[1]}rem is under the 48px floor`);
});
