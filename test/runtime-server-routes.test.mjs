// What the static server answers, which until now nothing checked.
//
// `createRuntimeServer` serves the whole game to a child's tablet and had no test file. That is not
// a gap worth an essay, but it is one worth closing while adding a route to it: the properties below
// -- refusing to serve outside `public/`, telling 404 and 403 apart, answering HEAD -- are all
// already implemented and all already load-bearing, and none of them would fail visibly if a future
// edit dropped them. A path-traversal guard that silently stops guarding is the worst kind.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { createRuntimeServer } from '../server.mjs';

/** Run the real server on an ephemeral port for the duration of one body. */
async function serving(body) {
  const server = createRuntimeServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await body(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('a request for a favicon is a plain 404, which is a decision rather than an oversight', async () => {
  // THE SERVER DELIBERATELY DOES NOT SERVE ONE, and this records why so nobody "fixes" it twice.
  //
  // A browser asks for /favicon.ico by itself on any document that does not declare an icon.
  // index.html declares an empty data-URI one, so the game page is quiet; every other page on this
  // origin -- a vendored module opened directly, a harness waypoint -- still triggers the request
  // and logs a cosmetic 404. The repo's answer to that is an allow-list in the harness that can see
  // it (COSMETIC_404_PATTERNS, in three files now), NOT a route.
  //
  // I added a route and it cost five harnesses in one commit. drive-village-board,
  // drive-beacon-siege, drive-cart-loot, drive-hero-screen and drive-profile-gate all NAVIGATE to
  // this URL on purpose -- it is their same-origin blank page for setting localStorage on before the
  // real load, which is what GQ-016's clear-before-pin needs somewhere to stand on. Answering 204
  // told the browser to stay where it was and the waypoint never arrived.
  //
  // So this asserts the 404, deliberately, as the contract those five depend on.
  await serving(async (origin) => {
    const response = await fetch(`${origin}/favicon.ico`);
    assert.equal(response.status, 404,
      'five harnesses navigate here; changing what this answers is changing their waypoint');
    const body = await response.text();
    assert.ok(body.length > 0, 'and it must be a page you can actually land on, not an empty reply');
  });
});

test('a real file still comes back with the content type that makes it runnable', async () => {
  // The counter-check to the route above: adding an early return is how you accidentally shadow
  // everything after it. A module served as text/plain does not execute, and the game is modules.
  await serving(async (origin) => {
    const response = await fetch(`${origin}/vendor/three.module.min.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /javascript/);
  });
});

test('the root is the game', async () => {
  await serving(async (origin) => {
    const response = await fetch(`${origin}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await response.text(), /<canvas|<div id="game"/);
  });
});

test('nothing outside public/ is reachable, however the path is spelled', async () => {
  // Reachable from any browser on the network the tablet is on. `..` segments are the obvious
  // attempt; the percent-encoded form is the one a normalise-then-check implementation misses,
  // because the decode happens after the check.
  await serving(async (origin) => {
    for (const path of ['/../server.mjs', '/..%2Fserver.mjs', '/%2e%2e/server.mjs', '/a/../../server.mjs']) {
      const response = await fetch(`${origin}${path}`);
      assert.ok(response.status === 403 || response.status === 404,
        `${path} answered ${response.status}`);
      assert.doesNotMatch(await response.text(), /createRuntimeServer/,
        `${path} served the server's own source`);
    }
  });
});

test('a missing file is 404 and a broken one would be 500, which are not the same news', async () => {
  await serving(async (origin) => {
    assert.equal((await fetch(`${origin}/no-such-thing.js`)).status, 404);
  });
});

test('HEAD answers with the headers and no body, because that is what HEAD is', async () => {
  await serving(async (origin) => {
    const response = await fetch(`${origin}/index.html`, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.ok(Number(response.headers.get('content-length')) > 0, 'the length is still told');
    assert.equal(await response.text(), '');
  });
});

test('a write to a read-only server is refused rather than ignored', async () => {
  await serving(async (origin) => {
    const response = await fetch(`${origin}/index.html`, { method: 'PUT', body: 'x' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  });
});

test('nothing is cached, which is why an edit shows up on the tablet without a hard reload', async () => {
  await serving(async (origin) => {
    assert.equal((await fetch(`${origin}/index.html`)).headers.get('cache-control'), 'no-store');
    // Not the favicon: that path is a 404 by design (see above), and a 404 carries the error
    // handler's headers rather than the static handler's. A missing file is not a cached file.
    assert.equal((await fetch(`${origin}/vendor/three.module.min.js`)).headers.get('cache-control'), 'no-store');
  });
});

// The three.js farm game (docs/product/PRODUCT_VISION.md, Platform) is mounted at /farm/ so the hosted
// playtest instance serves it to an iPad. Same guarantees as the root: the page, runnable modules,
// and no way out of its own directory.

test('/farm/ is the farm game, and its modules come back runnable', async () => {
  await serving(async (origin) => {
    const page = await fetch(`${origin}/farm/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    // Markers only the farm page has. `./src/main.js` alone would not do: public/index.html loads a
    // module by that same relative path, so a mount pointed at public/ would still match it.
    const html = await page.text();
    assert.match(html, /<title>Hatch &amp; Harvest<\/title>/, 'the farm page, not the legacy game');
    assert.match(html, /id="scene-canvas"/);
    const module = await fetch(`${origin}/farm/src/main.js`);
    assert.equal(module.status, 200);
    assert.match(module.headers.get('content-type') ?? '', /javascript/);
    assert.match(await module.text(), /\.\/render\/diorama\.js/, "the farm game's own entry module");
  });
});

test('/farm without a slash redirects, because the page loads ./src/main.js relative to it', async () => {
  // Served in place, `./src/main.js` would resolve to /src/main.js at the site root and the game
  // would load nothing.
  await serving(async (origin) => {
    // Temporary on purpose: browsers cache a 301 indefinitely, which would pin the mount's shape.
    const response = await fetch(`${origin}/farm`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/farm/');
  });
});

test('nothing outside the farm directory is reachable through /farm/', async () => {
  // Percent-encoded separators survive URL parsing and are decoded by the mount, so these are the
  // spellings that actually reach the containment check; a refusal must be 403, never a fall
  // through to public/.
  await serving(async (origin) => {
    for (const path of ['/farm/..%2Fserve.mjs', '/farm/..%2F..%2Fserver.mjs', '/farm/..%2F..%2Fpublic%2Findex.html']) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 403, `${path} answered ${response.status}`);
      assert.doesNotMatch(await response.text(), /createRuntimeServer|<canvas/, `${path} escaped the mount`);
    }
  });
});
