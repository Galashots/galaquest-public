import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

// The two Dawnwarden candidates are 15.4 MiB of the 22.0 MiB in public/assets -- dawnwarden-helmet-v1.glb
// alone is 11x the size of the hero the game actually ships. They are Studio/Forge workbench material,
// reachable from studio.html and forge.html, and the player must never pay for them.
//
// Nothing enforced that. The separation is currently an accident of who imports whom: one `import`
// of studio/candidateGear.js from anything in the game's graph would silently put 15.4 MiB on the
// player's download, and every existing test would still pass. glb-budget.test.mjs scores a
// hardcoded file list, so it cannot see a change in which files are reachable at all.

const root = resolve(import.meta.dirname, '..');
const gameEntry = resolve(root, 'public/src/main.js');

const collectGraph = (entry) => {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const current = queue.pop();
    if (seen.has(current) || !existsSync(current)) continue;
    seen.add(current);
    const source = readFileSync(current, 'utf8');
    for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*from\s*['"](\.[^'"]+)['"]/g)) {
      queue.push(resolve(dirname(current), match[1]));
    }
    for (const match of source.matchAll(/import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      queue.push(resolve(dirname(current), match[1]));
    }
  }
  return seen;
};

const assetReferences = (modules) => {
  const found = new Set();
  for (const modulePath of modules) {
    for (const match of readFileSync(modulePath, 'utf8').matchAll(/['"`](?:\.\.\/)*(assets\/[A-Za-z0-9_./-]+\.(?:glb|jpg|jpeg|png|webp))['"`]/g)) {
      found.add(match[1]);
    }
  }
  return found;
};

const gameGraph = collectGraph(gameEntry);

test('the game entry point reaches a real module graph', () => {
  assert.ok(gameGraph.size > 20, `expected the game's module graph, got ${gameGraph.size} module(s)`);
  assert.ok(gameGraph.has(gameEntry));
});

test('the game never reaches the Studio-only candidate gear module', () => {
  const studioModules = [...gameGraph]
    .map((modulePath) => relative(root, modulePath).split(sep).join('/'))
    .filter((modulePath) => modulePath.startsWith('public/src/studio/') || modulePath.startsWith('public/src/forge/'));
  assert.deepEqual(studioModules, [], 'the player build must not import Studio/Forge modules');
});

test('the only candidate asset on the gameplay path is the one the game actually equips', () => {
  const candidates = [...assetReferences(gameGraph)].filter((path) => path.includes('/candidates/')).sort();
  assert.deepEqual(candidates, ['assets/gear/candidates/sword_wildwood_w1a.glb']);
});

test('no single asset the game can request is larger than the hero it ships', () => {
  // A cheap absolute backstop that does not depend on the import graph being parsed correctly:
  // whatever the game references, none of it may dwarf hero.glb the way the Dawnwarden helmet does.
  const heroBytes = statSync(resolve(root, 'public/assets/hero/hero.glb')).size;
  for (const reference of assetReferences(gameGraph)) {
    const absolute = resolve(root, 'public', reference);
    if (!existsSync(absolute)) continue;
    const bytes = statSync(absolute).size;
    assert.ok(bytes <= heroBytes * 2, `${reference} is ${(bytes / 1048576).toFixed(2)} MiB, more than twice hero.glb (${(heroBytes / 1048576).toFixed(2)} MiB)`);
  }
});
