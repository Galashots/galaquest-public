// Every harness that navigates to the GAME must go through one address, not build its own.
//
// This exists because a change to what the game needs at boot broke seven-eighths of the suite and
// the repair looked complete while missing the rest.
//
// Stage 1 added the family profile gate: a device with no NAMED hero opens the game by asking what
// the child's hero is called, as a modal over the world with input suspended. Correct for a child,
// and instantly fatal to every harness -- they all clear localStorage before their first navigation
// (GQ-008), so they all arrive as an unnamed hero and land on the question. `?hero=` is the
// product's own answer (the README's "players join by URL"), and putting it on
// `startOwnedServer().url` fixed the harnesses that navigate to that field.
//
// It did not fix the ones that build their own address. drive-ranger and drive-beacon-siege each
// spawn a server on a fixed port and navigate to `${origin}/`, so they never saw the parameter at
// all. Both went from green to red, and the failure said nothing about profiles: an empty speech
// bubble, a fourth heart drawn unfilled, a ranger who would not talk. The world was behind a modal.
//
// The lesson is not "remember to update those two". It is that "navigate to the game" was spelled
// several different ways across 28 files, so a change to what that means could only ever be applied
// by hand, N times, with no way to tell when N was wrong. GQ-007 in its usual form: one rule, many
// implementations. gameUrlFor is the one implementation, and this test is what makes it the only one.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const HARNESS_DIR = join(import.meta.dirname, '..', 'tools', 'runtime-test');

/** Comments legitimately quote the forbidden shapes -- this file's own header does, and so do the
 *  repaired harnesses' explanations of why they were wrong. Scan code only, the same way
 *  test/harness-verdict-semantics.test.mjs does for its own patterns. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const harnesses = readdirSync(HARNESS_DIR).filter((file) => file.endsWith('.mjs'));

/**
 * A navigation to the game's ROOT built by hand rather than taken from the one authority.
 *
 * Matched against the real call shape, `send('Page.navigate', { url: ... })`, NOT `Page.navigate(`.
 * The first draft assumed the latter, matched nothing, and passed against a deliberately reinstated
 * offender -- a guard that cannot fail is worse than no guard, because it reads as coverage.
 *
 * Matches a Page.navigate whose url is a template ending in the bare origin root -- `${origin}/`,
 * `http://127.0.0.1:${port}/` and friends. Deliberately does NOT match:
 *   - `${origin}/favicon.ico`, the deliberate about:blank-ish hop these harnesses use to establish
 *     the origin before clearing its storage (GQ-008);
 *   - `${server.origin}/studio.html`, which is the Character Studio and not the game;
 *   - anything already carrying `hero=`, which is the parameter this rule is about.
 */
const HAND_BUILT_GAME_ROOT = /Page\.navigate'\s*,\s*\{\s*url:\s*`[^`]*\$\{[^}]+\}\/`\s*\}/g;

test('no harness hand-builds the game URL -- they all go through one authority', () => {
  const offenders = [];
  for (const file of harnesses) {
    const code = stripComments(readFileSync(join(HARNESS_DIR, file), 'utf8'));
    for (const match of code.matchAll(HAND_BUILT_GAME_ROOT)) {
      offenders.push(`${file}: ${match[0].replace(/\s+/g, ' ')}`);
    }
  }
  assert.deepEqual(offenders, [],
    'these navigate to a game root they built themselves, so they miss whatever the game needs at '
    + 'boot -- use startOwnedServer().url, or gameUrlFor(origin) when the harness owns its own '
    + `server:\n  ${offenders.join('\n  ')}`);
});

test('gameUrlFor actually carries a named hero, which is the whole reason it exists', async () => {
  const { gameUrlFor } = await import('../tools/runtime-test/owned-server.mjs');
  const url = new URL(gameUrlFor('http://127.0.0.1:5202'));

  assert.equal(url.origin, 'http://127.0.0.1:5202', 'the origin is preserved verbatim');
  assert.equal(url.pathname, '/', 'it is the game root');
  const hero = url.searchParams.get('hero');
  assert.ok(hero && hero.length > 0,
    'without a named hero the game opens its "what is your hero called?" gate over the world');
});

test('a harness that owns its own server can reach the same authority', () => {
  // The two that spawn a server on a fixed port import gameUrlFor rather than re-deriving the
  // address. Pinned by name because they are the two that were actually broken by getting this
  // wrong, and a future edit that quietly drops the import would otherwise only show up as a
  // ranger who will not speak.
  for (const file of ['drive-ranger.mjs', 'drive-beacon-siege.mjs']) {
    const code = stripComments(readFileSync(join(HARNESS_DIR, file), 'utf8'));
    assert.match(code, /import\s*\{[^}]*gameUrlFor[^}]*\}\s*from\s*'\.\/owned-server\.mjs'/,
      `${file} spawns its own server and must still take the game URL from owned-server.mjs`);
    assert.match(code, /gameUrlFor\(/, `${file} imports gameUrlFor but never uses it`);
  }
});

// ── the other half of the same trap: `url` is an ADDRESS, not a prefix ──────────────────────────
//
// `startOwnedServer().url` is the GAME's address and ends in a query string (`/?hero=Harness`), so
// pasting a path onto it does not make a sibling URL -- it makes nonsense. `${server.url}forge.html`
// resolves to `${origin}/?hero=Harnessforge.html`: a request for the site root, which serves
// index.html.
//
// tools/forge-review/review-forge.mjs did exactly that and spent fourteen hours reporting "Forge
// never reached FORGE READY" about a page that was never the Forge. The test above could not see it
// twice over -- it scans only tools/runtime-test/, and it matches addresses ending in `/`, which
// this one does not.
//
// So: no tool anywhere under tools/ may treat a `.url` as a prefix. Build a sibling page from
// `.origin`, which is exactly what it is for.
const TOOL_DIRS = ['runtime-test', 'forge-review'];
const URL_USED_AS_PREFIX = /\$\{[^}]*\burl\}[A-Za-z0-9_./-]/g;

test('no tool pastes a path onto a server url -- that field carries a query string', () => {
  const offenders = [];
  for (const dir of TOOL_DIRS) {
    const base = join(import.meta.dirname, '..', 'tools', dir);
    for (const file of readdirSync(base).filter((name) => name.endsWith('.mjs'))) {
      const code = stripComments(readFileSync(join(base, file), 'utf8'));
      for (const match of code.matchAll(URL_USED_AS_PREFIX)) {
        offenders.push(`${dir}/${file}: ${match[0]}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    'these paste a path onto a URL that ends in a query string, so they request the site root with '
    + `a nonsense query instead of the page they meant -- build it from .origin:\n  ${offenders.join('\n  ')}`);
});

test('the prefix rule goes red on the shape that actually shipped', () => {
  // review-forge.mjs's exact defect, reduced. Without this, a change to the regex could quietly
  // stop matching and the rule above would read as coverage over zero findings.
  assert.equal([...'await page.send(\'Page.navigate\', { url: `${server.url}forge.html` });'
    .matchAll(URL_USED_AS_PREFIX)].length, 1);
  // ...and does not fire on the correct shape, or on a bare url used as an address.
  assert.equal([...'await page.send(\'Page.navigate\', { url: `${server.origin}/forge.html` });'
    .matchAll(URL_USED_AS_PREFIX)].length, 0);
  assert.equal([...'await page.send(\'Page.navigate\', { url: URL_UNDER_TEST });'
    .matchAll(URL_USED_AS_PREFIX)].length, 0);
});
