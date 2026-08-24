// A banner a child cannot read is a banner that has to be able to speak.
//
// keeperSpeech.js makes the whole argument for the speech bubble and it applies unchanged here: the
// stated audience is young children who cannot reliably read, and the banner is where this game
// announces the wolf beaten, the tree alight, the gate found and where to go next. `banner()` now
// hands its text to the same read-aloud latch the bubble uses, so one tap on the speaker button ever
// makes the game read itself out.
//
// What that turns into a testable rule is the SPOKEN form. The screen and the ear want different
// strings for the same fact, and the case that produced this test is real: `LANTERN MARK  2 / 3` is
// right to look at, and `speechSynthesis` says "two slash three". So a banner whose displayed text
// contains a character that reads aloud as a word must pass an explicit third argument.
//
// The scanner below is a real bracket-and-quote scanner rather than a regex, because a regex that
// tries to find the end of an argument list is a regex that will one day be wrong quietly. It is
// exercised against a deliberately bad source at the bottom, so a scanner that has stopped finding
// anything fails instead of reporting a clean bill of health.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const MAIN = join(import.meta.dirname, '..', 'public', 'src', 'main.js');

/** Characters that a screen reader turns into a word. Extend this as they are found, not before. */
const READS_ALOUD_AS_A_WORD = ['/'];

/**
 * Every `banner(...)` call in `source`, as `{ line, args }` where args are raw source strings.
 *
 * Walks brackets, quotes and template literals so an argument containing a comma, a nested call or
 * a `${}` cannot split a call in the wrong place. Skips `function banner(` and comments.
 */
function bannerCalls(source) {
  const calls = [];
  for (let i = 0; i < source.length; i += 1) {
    if (!source.startsWith('banner(', i)) continue;
    // `function banner(` is the definition, and `.banner(` / `xbanner(` are different identifiers.
    const before = source.slice(Math.max(0, i - 9), i);
    if (/[A-Za-z0-9_$.]$/.test(before)) continue;
    if (/function\s+$/.test(before)) continue;
    // Not inside a line comment: the header of this very rule quotes `banner(` in prose.
    const lineStart = source.lastIndexOf('\n', i) + 1;
    if (source.slice(lineStart, i).includes('//')) continue;

    const args = [];
    let depth = 0;
    let current = '';
    let quote = null;
    for (let j = i + 'banner('.length; j < source.length; j += 1) {
      const c = source[j];
      if (quote) {
        current += c;
        if (c === '\\') { current += source[j + 1] ?? ''; j += 1; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; current += c; continue; }
      if ('([{'.includes(c)) { depth += 1; current += c; continue; }
      if (')]}'.includes(c)) {
        if (c === ')' && depth === 0) { args.push(current.trim()); break; }
        depth -= 1; current += c; continue;
      }
      if (c === ',' && depth === 0) { args.push(current.trim()); current = ''; continue; }
      current += c;
    }
    calls.push({ line: source.slice(0, i).split('\n').length, args });
  }
  return calls;
}

function missingSpokenForm(source) {
  return bannerCalls(source)
    .filter(({ args }) => READS_ALOUD_AS_A_WORD.some((ch) => args[0]?.includes(ch)))
    .filter(({ args }) => args.length < 3);
}

test('every banner is found by the scanner, so a clean report means something', () => {
  const calls = bannerCalls(readFileSync(MAIN, 'utf8'));
  // A floor rather than an exact count: this asserts the scanner still works, not that nobody may
  // add a beat. It was 27 call sites when written; a scanner that has broken finds ~0, not 20.
  assert.ok(calls.length >= 20,
    `expected the scanner to find the banner call sites, found ${calls.length}`);
  assert.ok(calls.every(({ args }) => args.length >= 2),
    'every banner call takes at least a text and a duration');
});

test('a banner whose text reads aloud as a word passes an explicit spoken form', () => {
  const violations = missingSpokenForm(readFileSync(MAIN, 'utf8'));
  assert.deepEqual(violations.map((v) => `main.js:${v.line}  ${v.args[0]}`), [],
    'these banners will be read aloud with their punctuation spoken -- pass a third argument '
    + 'saying what a child should HEAR, the way the Lantern Mark counter does');
});

// The link the unit tests either side of this cannot see. keeper-speech.test.mjs proves the latch
// itself -- silent before the tap, speaking after it, never for an empty line -- and the harness
// proves a real tap really unlocks it in a real browser. What neither can see is whether banner()
// hands anything to it at all, because banner() lives inside bootstrap() and there is no seam to
// call it through. So assert it at the only place the fact exists: the source.
test('banner() hands its spoken text to the read-aloud latch', () => {
  const source = readFileSync(MAIN, 'utf8');
  const body = source.slice(source.indexOf('function banner(text, milliseconds'));
  const end = body.indexOf('\n  }');
  assert.ok(end > 0, 'could not find the end of banner() -- this test has gone stale, fix it');
  assert.match(body.slice(0, end), /speakKeeperLineIfUnlocked\(spoken\)/,
    'banner() must offer its text to the read-aloud latch, or every narrative beat in this game is '
    + 'squiggles on a grey bar to a child who cannot read');
});

test('the rule is red-capable: a bad banner is caught', () => {
  const bad = "    banner(`LANTERN MARK  ${n} / ${total}`, 1800);\n";
  assert.equal(missingSpokenForm(bad).length, 1, 'a slash with no spoken form must be flagged');

  const fixed = "    banner(`LANTERN MARK  ${n} / ${total}`, 1800, `Lantern mark, ${n} of ${total}`);\n";
  assert.equal(missingSpokenForm(fixed).length, 0, 'and the spoken form must clear it');

  // A comma inside the displayed text must not be read as an argument separator -- the bug a regex
  // would have. Without the scanner this reads as three arguments and passes while still broken.
  const comma = "    banner('Coins, and shards / too', 3400);\n";
  assert.equal(bannerCalls(comma)[0].args.length, 2, 'a comma inside a string is not a separator');
  assert.equal(missingSpokenForm(comma).length, 1);
});
