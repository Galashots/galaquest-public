/**
 * ITEM PORTRAITS, RENDERED FROM THE ITEM.
 *
 *   node tools/assets/render-item-icons.mjs            # render every item that has a mesh
 *   node tools/assets/render-item-icons.mjs --only helmet_silverguard
 *   node tools/assets/render-item-icons.mjs --size 512
 *
 * Port 9224 -- the isolated automation Chrome. NOT 9223, which is the owner's signed-in browser.
 * Spawns and owns its own runtime server, like every other browser tool in this repository.
 *
 * WHY THIS EXISTS.
 *
 * #88 wants "polished, recognizable fantasy item portraits whose identity matches the actual
 * in-game item/model", and it wants them produced through the cheapest suitable art lane rather than
 * by burning implementation tokens or provider credit. Those are two requirements and this tool
 * satisfies exactly one of them: IDENTITY. It renders the same GLB the running game mounts on the
 * hero, so the icon cannot drift from the model -- not because someone was careful, but because
 * there is only one mesh.
 *
 * It does NOT satisfy POLISH, and calling its output a finished WoW-like icon would be a lie about
 * what a clean orthographic render of a low-poly game asset looks like. The output is PROVISIONAL:
 * good enough to build, play, screenshot and reject the whole compare/equip interaction against, and
 * to be replaced by a file drop when the Owner's ChatGPT art lane produces the real illustrations.
 * public/src/progression/itemArt.js says the same thing in the place a future reader will look.
 *
 * FINAL ILLUSTRATED ITEM ART = UNKNOWN / OWNER-CHATGPT ART HANDOFF.
 *
 * WHAT IT DELIBERATELY DOES NOT DO.
 *
 * It does not touch the meshes, the hero, the rig, or any runtime transform. It reads
 * public/assets/gear/*.glb and writes public/assets/items/*.png. It applies NO fit correction: the
 * gear-to-bone transforms in public/src/character/gear.js are how a piece sits ON A HERO, which is a
 * different question from how it should be framed in a 48px square, and reusing them here would tie
 * an icon's composition to a bone offset that exists for another reason entirely.
 *
 * FRAMING IS DERIVED, NOT TUNED PER ITEM. Every icon gets the same camera bearing and the same
 * fill fraction of the frame, computed from the mesh's own bounding sphere. A per-item nudge table
 * would be a second set of numbers to maintain against meshes that can be re-exported at any time,
 * and the whole value of rendering from the asset is that nothing has to be re-derived by hand when
 * the asset changes. If one item frames badly, fix it by changing the shared rule (and re-rendering
 * everything), not by adding an exception.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startOwnedServer } from '../runtime-test/owned-server.mjs';

const CHROME_PORT = 9224;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = resolve(repoRoot, 'public', 'assets', 'items');

/**
 * WHICH ITEM ID MAPS TO WHICH MESH.
 *
 * Hand-written rather than derived from progression/items.js, and the asymmetry is the point: an
 * item id is a GAMEPLAY identity and a GLB is an ASSET, and this repository already ships items that
 * have no mesh of their own. The Starter Sword is the clearest case -- the hero's shipping body mesh
 * carries its blade, so there is no separate starter_sword.glb to render and never was. Deriving
 * this list would therefore have to invent a mesh for it or silently skip it; naming the pairs makes
 * both the mapping and the gap explicit.
 *
 * An item listed here with no file on disk fails loudly. An item NOT listed keeps the inline SVG
 * fallback progression/itemArt.js already carries, which is the honest degradation.
 */
const ITEM_MESHES = Object.freeze([
  { itemId: 'wildwood_blade', url: 'assets/gear/candidates/sword_wildwood_w1a.glb' },
  { itemId: 'shield_ironwood', url: 'assets/gear/shield_ironwood.glb' },
  { itemId: 'helmet_silverguard', url: 'assets/gear/helmet_silverguard.glb' },
  { itemId: 'shoulder_silverguard', url: 'assets/gear/shoulder_silverguard.glb' },
  // The Starter Sword has no standalone mesh (see above). sword_ironwood.glb is the plain
  // arming sword this game already ships, and it is the closest truthful stand-in for "the ordinary
  // sword a child starts with" -- but it is a STAND-IN, not that item's own model, and that is
  // recorded here rather than left for a reader to assume from the filename.
  { itemId: 'starter_sword', url: 'assets/gear/sword_ironwood.glb', standIn: true },
]);

const argv = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const SIZE = Number(argValue('--size', '256'));
const ONLY = argValue('--only', null);

// ── A MINIMAL CDP CLIENT ────────────────────────────────────────────────────────────────────────
//
// Local to this tool, matching tools/runtime-test's standing preference: the harnesses next door
// each carry their own, because what they drive is genuinely different and only the server plumbing
// was ever shared (owned-server.mjs's own header states that trade).

function connect(wsUrl) {
  const u = new URL(wsUrl);
  return new Promise((resolveConn, rejectConn) => {
    const sock = createConnection({ host: u.hostname, port: Number(u.port) }, () => {
      sock.write(
        `GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\n`
        + `Connection: Upgrade\r\nSec-WebSocket-Key: ${Buffer.from('galaquest-icons').toString('base64')}\r\n`
        + 'Sec-WebSocket-Version: 13\r\n\r\n',
      );
    });
    let handshaken = false;
    let buf = Buffer.alloc(0);
    let nextId = 1;
    const pending = new Map();

    sock.on('error', rejectConn);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshaken) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx < 0) return;
        handshaken = true;
        buf = buf.subarray(idx + 4);
        resolveConn({
          send(method, params) {
            const id = nextId += 1;
            const payload = Buffer.from(JSON.stringify({ id, method, params }));
            const mask = Buffer.from([9, 8, 7, 6]);
            const head = [0x81];
            if (payload.length < 126) head.push(0x80 | payload.length);
            else if (payload.length < 65536) head.push(0x80 | 126, payload.length >> 8, payload.length & 255);
            else head.push(0x80 | 127, 0, 0, 0, 0, (payload.length >> 24) & 255, (payload.length >> 16) & 255,
              (payload.length >> 8) & 255, payload.length & 255);
            sock.write(Buffer.concat([
              Buffer.from(head), mask, Buffer.from(payload.map((b, i) => b ^ mask[i % 4])),
            ]));
            return new Promise((res, rej) => pending.set(id, { res, rej }));
          },
          close() { sock.end(); },
        });
      }
      // Frames from the server are never masked.
      for (;;) {
        if (buf.length < 2) return;
        const len0 = buf[1] & 127;
        let off = 2;
        let len = len0;
        if (len0 === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len0 === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const text = buf.subarray(off, off + len).toString();
        buf = buf.subarray(off + len);
        let msg;
        try { msg = JSON.parse(text); } catch { continue; }
        const waiter = msg.id != null && pending.get(msg.id);
        if (!waiter) continue;
        pending.delete(msg.id);
        if (msg.error) waiter.rej(new Error(`${msg.error.message} (${msg.error.code})`));
        else waiter.res(msg.result);
      }
    });
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'page threw');
  }
  return result.result.value;
}

// ── THE PAGE-SIDE RENDERER ──────────────────────────────────────────────────────────────────────
//
// Installed once, then called per item. Written as a string because it runs in the page, not here.
//
// THE THREE DECISIONS WORTH ARGUING ABOUT, stated so a future reader can disagree with the reason
// rather than the number:
//
//   1. ORTHOGRAPHIC, not perspective. An icon is a catalogue illustration, and perspective foreshort-
//      ening makes the near end of a sword read as a different weapon at 48px than at 256px. Ortho
//      keeps a silhouette scale-stable, which is what an inventory grid needs.
//   2. ONE SHARED BEARING for everything: a three-quarter view from slightly above. Straight-on
//      flattens a helmet to an oval and a shield to a disc; a hard profile hides a shield's face
//      entirely. The same bearing for every item is also what makes a row of them read as a SET.
//   3. LIT, not flat. Two directional lights plus a low ambient, so the low-poly facets that carry
//      these meshes' whole read survive. A flat-shaded silhouette is a shape, not an item.
//
// The background stays transparent because the frame is the UI's job (#88: rarity lives in the
// border), and a baked-in backdrop would fight every frame colour it is later placed inside.
const PAGE_SOURCE = `
window.__iconRenderer = (async () => {
  const THREE = await import('/vendor/three.module.min.js');
  const { GLTFLoader } = await import('/vendor/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;

  return async function renderIcon(url, size) {
    renderer.setSize(size, size, false);
    const scene = new THREE.Scene();

    const gltf = await loader.loadAsync(url);
    const model = gltf.scene;

    // A bounding SPHERE, not a box: the camera orbits, and a box's half-extent along one axis says
    // nothing about how wide the same mesh reads from a three-quarter bearing. A sphere is the only
    // measure that is bearing-independent, which is what lets one framing rule serve every item.
    const box = new THREE.Box3().setFromObject(model);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (!isFinite(sphere.radius) || sphere.radius <= 0) throw new Error('mesh has no measurable extent: ' + url);

    // Re-centre on the sphere, so framing does not depend on where the exporter put the origin --
    // a pivot at a helmet's chin strap rather than its centre is common and would otherwise push
    // the item off-frame.
    model.position.sub(sphere.center);
    scene.add(model);

    // 0.82 of the half-frame: enough margin that a rarity border can sit around the art without
    // clipping the silhouette, and that a rotated bounding sphere's corners stay inside.
    const half = sphere.radius / 0.82;
    const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, sphere.radius * 40);

    // The shared bearing: 35 degrees around, 22 degrees up.
    const yaw = THREE.MathUtils.degToRad(35);
    const pitch = THREE.MathUtils.degToRad(22);
    const distance = sphere.radius * 8;
    camera.position.set(
      Math.sin(yaw) * Math.cos(pitch) * distance,
      Math.sin(pitch) * distance,
      Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    camera.lookAt(0, 0, 0);

    const key = new THREE.DirectionalLight(0xfff2dc, 2.6);
    key.position.set(1.1, 1.6, 1.4);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.1);
    rim.position.set(-1.3, 0.4, -1.0);
    scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.55));

    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL('image/png');

    scene.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value && value.isTexture) value.dispose();
        }
        material.dispose();
      }
    });

    return dataUrl;
  };
})();
`;

async function main() {
  const server = await startOwnedServer();
  let cdp = null;
  try {
    const targets = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/new?${encodeURIComponent(server.url)}`, {
      method: 'PUT',
    }).then((r) => r.json());
    cdp = await connect(targets.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable', {});
    await cdp.send('Page.enable', {});

    // Wait for the document to be able to run a module import at all.
    for (let i = 0; i < 100; i += 1) {
      const ready = await evaluate(cdp, 'document.readyState');
      if (ready === 'complete' || ready === 'interactive') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    await evaluate(cdp, PAGE_SOURCE);
    await evaluate(cdp, 'window.__iconRenderer.then(() => true)');

    mkdirSync(OUT_DIR, { recursive: true });
    const wanted = ONLY ? ITEM_MESHES.filter((m) => m.itemId === ONLY) : ITEM_MESHES;
    if (wanted.length === 0) throw new Error(`--only ${ONLY} matches no item in ITEM_MESHES`);

    for (const mesh of wanted) {
      const expression = `window.__iconRenderer.then((render) => render(${JSON.stringify(`/${mesh.url}`)}, ${SIZE}))`;
      const dataUrl = await evaluate(cdp, expression);
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
        throw new Error(`render returned no PNG for ${mesh.itemId}`);
      }
      const out = resolve(OUT_DIR, `${mesh.itemId}.png`);
      writeFileSync(out, Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
      const bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64').length;
      console.log(`${mesh.itemId.padEnd(22)} ${String(bytes).padStart(7)} B  <- ${mesh.url}${mesh.standIn ? '  (STAND-IN MESH)' : ''}`);
    }
    console.log(`\n${wanted.length} icon(s) -> public/assets/items/ at ${SIZE}x${SIZE}`);
    console.log('PROVISIONAL. Final illustrated item art = UNKNOWN / Owner-ChatGPT art handoff.');
  } finally {
    if (cdp) cdp.close();
    server.kill();
  }
}

await main();
