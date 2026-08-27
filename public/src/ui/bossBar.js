// public/src/ui/bossBar.js
//
// The BEACON WARDEN's health bar: the one piece of HUD whose whole job is to say "this is not
// another wolf". A wolf's hp lives on the wolf (its spark dims); the Warden's own name and health
// live OVER HIS HEAD, exactly where every other enemy's does -- see enemies/nameplate.js, the
// ordinary-enemy version of the same idea. It used to float at the top of the screen instead, and a
// real playtest called that out directly: "consistent with other enemies" means above him, not
// pinned to the notch. One readout, one place a child's eyes are already pointed mid-swing.
//
// Split exactly the way progression/heroScreen.js and village/boardScreen.js are split, and for the
// reasons their headers give: bossBarState is pure (no DOM, unit tested directly in plain node --
// test/boss-bar.test.mjs), createBossBar is the DOM half, exercised only through the browser and a
// runtime harness. One difference from those two, on purpose: they QUERY hand-written index.html
// markup, because their markup is a full screen of chrome worth reading in the page source. This
// bar is a handful of elements nobody will ever hand-edit, so the factory BUILDS them -- main.js
// calls createBossBar(document) once, appends .element into #game, and feeds
// update(bossBarState(...), projected) each frame, which is still the same "pure logic decides,
// main.js wires" contract. `projected` is the SAME screen-space idiom enemies/nameplate.js's own
// project() callback and render/screenProjection.js's ndcToOverlayPixels already establish -- world
// position in, overlay pixels out, `null` for "do not draw this frame" (behind the camera, or the
// Warden simply is not published yet) -- so the boss bar is not a second, competing overhead
// convention, it is the SAME one, scaled up for the one enemy in the game that gets a name on its
// own card. The CSS travels in this file for the same reason the markup does (one file owns the
// whole component; deleting it orphans nothing in index.html) -- ensureBossBarStyle installs it
// once, guarded by id.

import { BEACON_GLOW_COLOR } from '../world/oldBeacon.js';

// The bar's ONE accent is the Beacon's own cold halo colour (oldBeacon.js's BEACON_GLOW_COLOR,
// 0x9fd0e8) -- reused rather than re-guessed, the same single-source discipline heroScreen.js's
// swatch takes from WILDWOOD_COLOR. The kinship is the point: the Warden is the Beacon's cold made
// into a thing you can fight, so its bar glows in the light a child has already stood in front of
// and wondered about. Derived to a CSS string here, not defined a second time.
const ACCENT_CSS = `#${BEACON_GLOW_COLOR.toString(16).padStart(6, '0')}`;

// Measured from the CSS below (15rem wide, name pill + track + gap tall at the default 16px root) --
// exported so main.js's own overhead projection can reuse enemies/nameplate.js's
// clampNameplateProjection/nameplateProjectionIsSafe against this card's REAL footprint instead of
// the ordinary enemy nameplate's smaller one. Approximate on purpose (HUD overlap avoidance only
// needs to be roughly right, never pixel-exact) the same way ENEMY_NAMEPLATE_SAFE_WIDTH/HEIGHT are.
export const BOSS_BAR_SAFE_WIDTH = 240;
export const BOSS_BAR_SAFE_HEIGHT = 62;

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

// PLACEMENT: OVERHEAD, not top-of-screen. `left`/`top` are written per frame from `projected`
// (screen-space pixels in the #game overlay's own coordinate system, render/screenProjection.js's
// ndcToOverlayPixels -- the identical pipeline enemies/nameplate.js's own project() callback and
// main.js's damage numbers already use), with `translate(-50%, -100%)` so the card's own BOTTOM
// edge sits on that point and it rises up from the Warden's head the way a nameplate does, never
// down through it. Hidden with `display:none` while `data-shown` is false OR while no `left`/`top`
// has been written yet (main.js never calls update() with a numeric projection until one exists),
// so a boss bar can never flash at the CSS origin (0, 0) before its first real frame.
export const BOSS_BAR_CSS = `
      #boss-bar {
        position: absolute; left: 0; top: 0;
        transform: translate(-50%, -100%);
        width: 15rem;
        display: flex; flex-direction: column; align-items: center; gap: 0.3rem;
        opacity: 0;
        transition: opacity 200ms ease-out;
        pointer-events: none; touch-action: none;
        --boss-accent: ${ACCENT_CSS};
      }
      #boss-bar[data-shown="true"] { opacity: 1; }
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
         (see #hero-health et al.) so it reads against open sky. Slightly larger than an ordinary
         enemy's own (enemies/nameplate.js's .enemy-nameplate-name) -- the one card in the game that
         gets to say "this is the boss". */
      #boss-bar-name {
        padding: 0.2rem 1rem; border-radius: 999px;
        background: rgb(12 20 31 / 85%); color: var(--boss-accent);
        font: 800 0.95rem/1.2 system-ui, sans-serif; letter-spacing: 0.14em; white-space: nowrap;
        text-shadow: 0 0 10px rgb(159 208 232 / 45%);
      }
      /* Chunky on purpose: this card is read at gameplay distance by a child mid-fight, not
         studied. Same scaleX-fill trick as #hero-down-bar (composited, never re-laid-out per
         frame) -- SEGMENTED by a repeating-gradient mask laid over the continuous fill, which
         still reads the exact fraction (the fill's own length never lies) while looking like the
         chunky, notched boss bars this brief asks for rather than a smooth wolf-spark dim.
         Ten segments: a body a child can count while thinking "three more hits". */
      #boss-bar-track {
        position: relative;
        width: 100%; height: 1rem; border-radius: 0.3rem;
        background: rgb(12 20 31 / 85%); border: 2px solid rgb(255 255 255 / 40%);
        overflow: hidden;
      }
      #boss-bar-fill {
        height: 100%; border-radius: 0.15rem;
        background: var(--boss-accent);
        box-shadow: 0 0 0.5rem var(--boss-accent);
        transform: scaleX(1); transform-origin: left center;
        transition: transform 160ms ease-out, background-color 240ms ease-out;
      }
      #boss-bar-segments {
        position: absolute; inset: 0; pointer-events: none;
        background-image: repeating-linear-gradient(
          to right, rgb(12 20 31 / 55%) 0, rgb(12 20 31 / 55%) 2px, transparent 2px, transparent 10%
        );
      }
      /* Reduced motion: no eased drain -- states land instantly, the same blanket rule
         index.html's own prefers-reduced-motion block applies to its HUD. */
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
 * The DOM half. Builds the card once, returns { element, update } -- main.js appends element into
 * #game (late in the container, so it paints over the canvas like every other HUD layer) and calls
 * update(bossBarState(warden), projected) each frame.
 *
 * `projected` is `{ x, y } | null` in the SAME overlay-pixel coordinate space
 * enemies/nameplate.js's own project() callback returns: the point the card's own bottom edge sits
 * on, or `null` for "do not draw this frame at all" (behind the camera -- projected.z > 1 at the
 * call site -- or too far off-screen to be worth a nameplate, main.js's own job to decide, this
 * function only draws what it is handed). `null` hides the element outright via `display:none`
 * rather than leaving stale coordinates under an opacity:0 card, so a later bug that forgets to hide
 * it cannot leave an invisible-but-hit-testable div sitting over the touch controls (pointer-events
 * is already none, but display:none is the belt to that belt-and-braces).
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
  element.style.display = 'none';

  const nameEl = doc.createElement('div');
  nameEl.id = 'boss-bar-name';

  const trackEl = doc.createElement('div');
  trackEl.id = 'boss-bar-track';
  trackEl.setAttribute('aria-hidden', 'true');
  const fillEl = doc.createElement('div');
  fillEl.id = 'boss-bar-fill';
  trackEl.appendChild(fillEl);
  // The segment overlay: a static gradient laid ON TOP of the fill, never resized or transformed
  // itself -- the fill's own scaleX is what changes every frame, the notches are just there to
  // count by.
  const segmentsEl = doc.createElement('div');
  segmentsEl.id = 'boss-bar-segments';
  trackEl.appendChild(segmentsEl);

  element.appendChild(nameEl);
  element.appendChild(trackEl);

  function update(state, projected) {
    const shown = state.visible && projected != null;
    element.style.display = shown ? '' : 'none';
    if (!shown) {
      // Still worth clearing the live region on the SAME edge the old top-of-screen bar did, so a
      // Warden that despawns (falls, or was never published) does not leave a screen reader
      // announcing a name for a card nobody can see any more.
      if (nameEl.textContent !== '') nameEl.textContent = '';
      element.dataset.shown = 'false';
      return;
    }
    element.style.left = `${projected.x}px`;
    element.style.top = `${projected.y}px`;
    element.dataset.shown = 'true';
    element.dataset.phase = String(state.phase);
    element.dataset.entering = String(state.entering);
    element.dataset.defeated = String(state.defeated);
    if (nameEl.textContent !== state.name) nameEl.textContent = state.name;
    fillEl.style.transform = `scaleX(${state.fraction})`;
  }

  return { element, update };
}
