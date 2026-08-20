// public/src/ui/bossBar.js
//
// The BEACON WARDEN's health bar: the one piece of HUD whose whole job is to say "this is not
// another wolf". A wolf's hp lives on the wolf (its spark dims); a boss's hp lives at the top of
// the screen, named, because a named bar over a fight is the oldest signal games have for THIS IS
// AN EVENT -- combat/feedback.js's own header cites the same convention for depleting bars.
//
// Split exactly the way progression/heroScreen.js and village/boardScreen.js are split, and for the
// reasons their headers give: bossBarState is pure (no DOM, unit tested directly in plain node --
// test/boss-bar.test.mjs), createBossBar is the DOM half, exercised only through the browser and a
// runtime harness. One difference from those two, on purpose: they QUERY hand-written index.html
// markup, because their markup is a full screen of chrome worth reading in the page source. This
// bar is three elements nobody will ever hand-edit, so the factory BUILDS them -- main.js calls
// createBossBar(document) once, appends .element into #game, and feeds update(bossBarState(...))
// each frame, which is still the same "pure logic decides, main.js wires" contract. The CSS travels
// in this file for the same reason the markup does (one file owns the whole component; deleting it
// orphans nothing in index.html) -- ensureBossBarStyle installs it once, guarded by id.

import { BEACON_GLOW_COLOR } from '../world/oldBeacon.js';

// The bar's ONE accent is the Beacon's own cold halo colour (oldBeacon.js's BEACON_GLOW_COLOR,
// 0x9fd0e8) -- reused rather than re-guessed, the same single-source discipline heroScreen.js's
// swatch takes from WILDWOOD_COLOR. The kinship is the point: the Warden is the Beacon's cold made
// into a thing you can fight, so its bar glows in the light a child has already stood in front of
// and wondered about. Derived to a CSS string here, not defined a second time.
const ACCENT_CSS = `#${BEACON_GLOW_COLOR.toString(16).padStart(6, '0')}`;

export const BOSS_NAME = 'BEACON WARDEN';

// Gone in these two modes, visible in every other one. 'dormant' is before the story starts;
// 'dead' is after it ends -- a bar for a beaten boss hanging around is the game forgetting to stop
// talking. Everything between ('waking', any fighting phase, 'dying') shows the bar: liberal on
// purpose, because the Warden's own module names its middle modes and this file must not keep a
// second list that could drift from it. A nullish/non-string mode (no warden published yet) hides.
const HIDDEN_MODES = new Set(['dormant', 'dead']);

/**
 * Pure. Turns the Warden's published { mode, hp, maxHp, phase } into everything the DOM binder
 * below needs to paint a frame -- no querySelector, no three.js, testable with plain node --test.
 *
 * fraction is always a real number in [0, 1], whatever it is handed: hp above maxHp clamps to full,
 * negative hp to empty, and a missing/zero/absurd maxHp reads empty rather than NaN -- the same
 * "always a safe fallback, never a blank card" discipline heroScreenViewModel keeps for a stale
 * selection. phase clamps to 1..3 (the arc's three phases); junk reads as phase 1, never as an
 * unstyled attribute.
 */
export function bossBarState({ mode, hp, maxHp, phase } = {}) {
  const visible = typeof mode === 'string' && mode.length > 0 && !HIDDEN_MODES.has(mode);
  const safeMax = Number.isFinite(maxHp) && maxHp > 0 ? maxHp : 0;
  const safeHp = Number.isFinite(hp) ? hp : 0;
  const fraction = safeMax === 0 ? 0 : Math.max(0, Math.min(1, safeHp / safeMax));
  const safePhase = Number.isFinite(phase) ? Math.max(1, Math.min(3, Math.round(phase))) : 1;
  return {
    visible,
    name: BOSS_NAME,
    fraction,
    phase: safePhase,
    // 'waking' is the entrance beat -- the CSS slide/fade below keys off data-entering only in the
    // sense that data-shown flipping true IS the entrance; entering is published so main.js (and a
    // future harness) can tell "just arrived" from "mid-fight" without re-deriving mode.
    entering: mode === 'waking',
    // Defeat is a fact about MODE, not about hp -- a dying Warden with a stale full hp snapshot is
    // still dying (test/boss-bar.test.mjs's sabotage case pins this).
    defeated: mode === 'dying' || mode === 'dead',
  };
}

// PLACEMENT, stated per the layout ledger index.html's own comments keep. Top-centre, under the
// device safe area (env(safe-area-inset-top) -- viewport-fit=cover is already set in index.html's
// meta, so notched iPads really do hand us that inset). Checked against everything main.js already
// paints before choosing it: the top-centre band is actually EMPTY -- #hero-health/#lantern-marks/
// #quest-objective own the top-LEFT column, #village-board-button/#hero-button/#loot-hud own the
// top-RIGHT, #keeper-speech sits centred but down at 9rem, and #banner (the element most likely to
// be assumed top-centre) lives at top: 68%, moved there by capture evidence long before this file
// existed. So a banner and this bar coexist by construction: one at 68%, one under the notch, and
// the width cap (calc(100% - 16rem)) keeps the bar clear of both top corners on the narrowest
// supported frame (768px portrait: 768 - 256 = 512px available, the 22rem cap uses 352 of it).
// It also never covers the playfield centre: the whole component is under 3.5rem tall and pinned
// to the top edge.
export const BOSS_BAR_CSS = `
      #boss-bar {
        position: absolute; top: calc(env(safe-area-inset-top, 0px) + 0.6rem); left: 50%;
        width: min(22rem, calc(100% - 16rem));
        display: flex; flex-direction: column; align-items: center; gap: 0.3rem;
        opacity: 0; transform: translate(-50%, -0.7rem);
        transition: opacity 260ms ease-out, transform 260ms ease-out;
        pointer-events: none; touch-action: none;
        --boss-accent: ${ACCENT_CSS};
      }
      #boss-bar[data-shown="true"] { opacity: 1; transform: translate(-50%, 0); }
      /* Phases 2 and 3 thaw the accent a subtle step warmer and brighter each -- the cold cyan
         drifting toward (never reaching) the lanterns' warm family, because the fight's end is the
         Beacon igniting. Hue does a job here but is not the only signal: the fill's own length is
         what a child actually reads. */
      #boss-bar[data-phase="2"] { --boss-accent: #aaddd2; }
      #boss-bar[data-phase="3"] { --boss-accent: #c8e8c9; }
      /* Dying: the glow goes out of it -- the same neutral grey heroScreen.js uses for an unknown
         swatch, so the bar visibly stops being the Beacon's colour the moment the Warden stops. */
      #boss-bar[data-defeated="true"] { --boss-accent: #8a97a6; }
      /* The nameplate: one short line in the accent, dark-pill family like every other HUD readout
         (see #hero-health et al.) so it reads against open sky. */
      #boss-bar-name {
        padding: 0.18rem 0.9rem; border-radius: 999px;
        background: rgb(12 20 31 / 82%); color: var(--boss-accent);
        font: 800 0.92rem/1.2 system-ui, sans-serif; letter-spacing: 0.14em; white-space: nowrap;
        text-shadow: 0 0 10px rgb(159 208 232 / 45%);
      }
      /* Chunky on purpose: this bar is read at gameplay distance by a child mid-fight, not studied.
         Same scaleX-fill trick as #hero-down-bar (composited, never re-laid-out per frame). */
      #boss-bar-track {
        width: 100%; height: 0.85rem; border-radius: 999px;
        background: rgb(12 20 31 / 82%); border: 2px solid rgb(255 255 255 / 35%);
        overflow: hidden;
      }
      #boss-bar-fill {
        height: 100%; border-radius: 999px;
        background: var(--boss-accent);
        box-shadow: 0 0 0.5rem var(--boss-accent);
        transform: scaleX(1); transform-origin: left center;
        transition: transform 160ms ease-out, background-color 240ms ease-out;
      }
      /* Reduced motion: no entrance slide, no eased drain -- states land instantly, the same
         blanket rule index.html's own prefers-reduced-motion block applies to its HUD. */
      @media (prefers-reduced-motion: reduce) {
        #boss-bar, #boss-bar-fill { transition: none; }
      }
`;

const STYLE_ID = 'boss-bar-style';

function ensureBossBarStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = BOSS_BAR_CSS;
  doc.head.appendChild(style);
}

/**
 * The DOM half. Builds the bar once, returns { element, update } -- main.js appends element into
 * #game (late in the container, so it paints over the canvas like every other HUD layer) and calls
 * update(bossBarState(warden)) each frame. update is cheap: four dataset writes, one transform,
 * one textContent that only changes if the name does.
 */
export function createBossBar(doc) {
  ensureBossBarStyle(doc);

  const element = doc.createElement('div');
  element.id = 'boss-bar';
  // role=status, aria-live polite: "the BEACON WARDEN has appeared" is state a screen reader user
  // needs once (the nameplate text arriving announces it); the per-frame hp drain lives in a
  // transform, not text, so it never spams the live region.
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.dataset.shown = 'false';
  element.dataset.phase = '1';
  element.dataset.entering = 'false';
  element.dataset.defeated = 'false';

  const nameEl = doc.createElement('div');
  nameEl.id = 'boss-bar-name';

  const trackEl = doc.createElement('div');
  trackEl.id = 'boss-bar-track';
  trackEl.setAttribute('aria-hidden', 'true');
  const fillEl = doc.createElement('div');
  fillEl.id = 'boss-bar-fill';
  trackEl.appendChild(fillEl);

  element.appendChild(nameEl);
  element.appendChild(trackEl);

  function update(state) {
    element.dataset.shown = String(state.visible);
    element.dataset.phase = String(state.phase);
    element.dataset.entering = String(state.entering);
    element.dataset.defeated = String(state.defeated);
    // Only announce the name while there is a Warden to name -- an emptied live region on hide is
    // what lets the NEXT appearance announce again.
    const nextName = state.visible ? state.name : '';
    if (nameEl.textContent !== nextName) nameEl.textContent = nextName;
    fillEl.style.transform = `scaleX(${state.fraction})`;
  }

  return { element, update };
}
