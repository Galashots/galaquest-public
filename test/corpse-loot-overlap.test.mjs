// #119: the temporary corpse LOOT prompt and the banner that prints the quest tracker's own
// `LANTERN MARK  X / Y` announcement must never compete for the same readable/tappable screen area.
//
// #87 anchored the prompt to index.html's #banner band -- both `top: 68%`, both centred -- so the
// moment a wolf kill credited a mark (the same instant a lootable corpse is on the ground) the two
// pills printed on top of each other.
//
// This is the mechanical half of the fix: it resolves both bands to pixels at the two reference
// viewports the runtime harnesses drive and fails if they intersect. It reads the real stylesheet and
// the real markup, not a hand-fed fixture, the same discipline test/tap-targets.test.mjs keeps.
// Running-game pixels remain the Owner's acceptance surface; this only rejects the regression before
// a push.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { CORPSE_LOOT_PANEL_CSS } from '../public/src/ui/corpseLootPanel.js';

const ROOT_FONT_PX = 16;
// The two device classes tools/runtime-test/drive-e2-enemy.mjs drives: portrait 390x844 and the same
// phone rotated. Both anchors are percentages of the containing block's height, so the bug class is
// viewport-height dependent and one orientation is not enough to prove the bands stay apart.
const REFERENCE_VIEWPORTS = [
  { name: 'portrait 390x844', width: 390, height: 844 },
  { name: 'landscape 844x390', width: 844, height: 390 },
];

const INDEX_HTML = readFileSync(join(import.meta.dirname, '..', 'public', 'index.html'), 'utf8');

/** The declaration block for one exact selector ("#foo {"), or a loud failure -- a scan that stops
 *  matching must never quietly pass over an empty rule. */
function ruleBody(css, selector) {
  const marker = `${selector} {`;
  const at = css.indexOf(marker);
  assert.ok(at >= 0, `no CSS rule for ${selector}`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  assert.ok(close > open, `unterminated CSS rule for ${selector}`);
  return css.slice(open + 1, close);
}

function declaration(body, property) {
  const match = new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body);
  assert.ok(match, `no ${property} declaration in: ${body.trim()}`);
  return match[1].trim();
}

/** A top expression is either "NN%" or "calc(NN% - Nrem)". The second is the fixed-band stack this
 *  test exists to prove; any other shape is new geometry the test cannot reason about, so it fails
 *  loudly rather than guessing. */
function topPx(top, viewportHeight) {
  const bare = /^([\d.]+)%$/.exec(top);
  if (bare) return (Number(bare[1]) / 100) * viewportHeight;
  const stacked = /^calc\(\s*([\d.]+)%\s*-\s*([\d.]+)rem\s*\)$/.exec(top);
  if (stacked) return (Number(stacked[1]) / 100) * viewportHeight - Number(stacked[2]) * ROOT_FONT_PX;
  assert.fail(`unrecognised top expression: ${top}`);
}

/** Vertical box height from the rule's own padding, min-height, border and font. Neither pill can be
 *  grown by its text: both are `white-space: nowrap`, so min-height/font is the whole story. */
function verticalBoxPx(body) {
  const verticalPaddingPx = parseFloat(declaration(body, 'padding').split(/\s+/)[0]) * ROOT_FONT_PX;
  const borderMatch = /(?<![-\w])border:\s*([\d.]+)px/.exec(body);
  const borderPx = borderMatch ? Number(borderMatch[1]) : 0;
  const minHeightMatch = /(?<![-\w])min-height:\s*([\d.]+)px/.exec(body);
  const minHeightPx = minHeightMatch ? Number(minHeightMatch[1]) : 0;
  const font = declaration(body, 'font');
  const size = /(\d+(?:\.\d+)?)rem\/(\d+(?:\.\d+)?)/.exec(font);
  assert.ok(size, `could not read a rem/line-height font from: ${font}`);
  const linePx = Number(size[1]) * ROOT_FONT_PX * Number(size[2]);
  return Math.max(linePx, minHeightPx) + 2 * verticalPaddingPx + 2 * borderPx;
}

const LOOT_PROMPT = ruleBody(CORPSE_LOOT_PANEL_CSS, '#corpse-loot-interact');
const BANNER = ruleBody(INDEX_HTML, '#banner');
const LOOT_TOP = declaration(LOOT_PROMPT, 'top');
const BANNER_TOP = declaration(BANNER, 'top');
const LOOT_HEIGHT_PX = verticalBoxPx(LOOT_PROMPT);
const BANNER_HEIGHT_PX = verticalBoxPx(BANNER);

test('the corpse LOOT prompt keeps a band clear of the #banner Lantern Mark tracker (#119)', () => {
  for (const viewport of REFERENCE_VIEWPORTS) {
    const lootTop = topPx(LOOT_TOP, viewport.height);
    const bannerTop = topPx(BANNER_TOP, viewport.height);
    const loot = { top: lootTop, bottom: lootTop + LOOT_HEIGHT_PX };
    const banner = { top: bannerTop, bottom: bannerTop + BANNER_HEIGHT_PX };
    assert.ok(
      loot.bottom <= banner.top || banner.bottom <= loot.top,
      `${viewport.name}: LOOT band ${loot.top.toFixed(1)}..${loot.bottom.toFixed(1)} intersects the `
      + `LANTERN MARK band ${banner.top.toFixed(1)}..${banner.bottom.toFixed(1)}`,
    );
  }
});

test('the LOOT band stays anchored to the banner line, so moving the banner cannot silently re-create the overlap (#119)', () => {
  // The prompt's own comment claims it lifts off the banner's anchor. If the banner is ever moved
  // without the prompt, the geometric test above would still pass on the OLD anchor while the two
  // surfaces drift back into each other -- this is the coupling that stops that.
  assert.ok(
    LOOT_TOP.includes(BANNER_TOP),
    `LOOT top ${LOOT_TOP} is no longer anchored to the banner's own ${BANNER_TOP}`,
  );
});
