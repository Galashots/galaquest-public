// public/src/ui/unlockCard.js
//
// The "I GOT THE SWORD!" card. GP1-C1 took the Wildwood Blade away from fresh players so that the
// moment it becomes owned could be AUTHORED; this is that authoring. A short, premium-feeling
// centred card -- not a modal wall: the world keeps running and both thumbs keep working underneath
// (only the card itself catches taps), the same non-blocking rule the Hero screen's own
// pointer-events split enforces. It says four things and stops: UNLOCKED, the item's name, the one
// stat a child cares about ('1 → 2 DAMAGE', the exact comparison-line shape heroScreen.js's
// renderCard already draws), and where the thing now lives (a GEAR pill echoing #hero-button).
//
// Split exactly the way progression/heroScreen.js and village/boardScreen.js are split:
// unlockCardState is pure (no DOM, unit tested directly -- test/unlock-card.test.mjs), and
// createUnlockCard is the DOM half, exercised only through the browser and a runtime harness. Like
// ui/bossBar.js (and unlike those two screens, whose markup is a page of hand-written chrome), the
// factory BUILDS its handful of elements and carries its own CSS, installed once and id-guarded --
// one file owns the whole component, and deleting it orphans nothing in index.html.

// The same plain numeric hex heroScreen.js already imports, and for the same stated reason: this is
// the one colour that already means "the Wildwood Blade" -- on the planted prop in Rowan's clearing,
// on the Hero screen's swatch -- so the card that hands the blade over must glow in it rather than
// in a second guess. Derived to CSS strings below, never restated.
import { WILDWOOD_COLOR } from '../world/wildwoodBlade.js';

const WILDWOOD_CSS = `#${WILDWOOD_COLOR.toString(16).padStart(6, '0')}`;
const WILDWOOD_R = (WILDWOOD_COLOR >> 16) & 0xff;
const WILDWOOD_G = (WILDWOOD_COLOR >> 8) & 0xff;
const WILDWOOD_B = WILDWOOD_COLOR & 0xff;
const wildwoodAlpha = (alpha) => `rgb(${WILDWOOD_R} ${WILDWOOD_G} ${WILDWOOD_B} / ${alpha})`;

// ~4.5s, then it dismisses itself -- long enough to read four short lines twice, short enough that
// a child who taps nothing is back in the world before the moment goes stale. A tap on the card
// ends it early; both routes fire onDone exactly once.
export const UNLOCK_CARD_SECONDS = 4.5;

/**
 * Pure. Turns { itemName, fromDamage, toDamage } into the card's display strings -- no DOM, no
 * item-table lookups of its own: the CALLER reads progression/items.js (damageFor/itemDef) and
 * hands the values in, so this stays a formatter and the damage numbers keep their single source
 * (GQ-007: read off items.js, never restated -- test/unlock-card.test.mjs builds its expectations
 * from that same file).
 *
 * comparison is null rather than a string with a hole in it when either damage is not a finite
 * number -- a card that says 'undefined → 2 DAMAGE' at the arc's biggest moment is worse than one
 * that says nothing. isUpgrade is computed, never assumed (the sabotage test swaps the numbers).
 */
export function unlockCardState({ itemName, fromDamage, toDamage } = {}) {
  const name = typeof itemName === 'string' ? itemName.trim().toUpperCase() : '';
  const comparable = Number.isFinite(fromDamage) && Number.isFinite(toDamage);
  return {
    eyebrow: 'UNLOCKED',
    name,
    // The same '1 → 2 DAMAGE' shape as #hero-item-compare (heroScreen.js's renderCard), so the
    // ceremony and the Gear screen a child opens ten seconds later say it identically.
    comparison: comparable ? `${fromDamage} → ${toDamage} DAMAGE` : null,
    isUpgrade: comparable && toDamage > fromDamage,
    // The affordance hint: #hero-button's own 🗡 glyph plus the word #workshop-interact already
    // taught for the same screen -- the pill IS a picture of the button to tap next.
    hint: '🗡 GEAR',
  };
}

// A sword, point down, drawn in the Wildwood teal -- the same silhouette as the planted prop in
// Rowan's clearing (blade planted point-down is that prop's whole pose), inline SVG so this ships
// zero image assets. Deliberately crude, matching wildwoodBlade.js's own "a crude blade standing in
// the right place tonight" trade.
const SWORD_SVG = `
  <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="${WILDWOOD_CSS}">
      <rect x="21.5" y="2" width="5" height="7" rx="1.5"/>
      <rect x="22.75" y="8" width="2.5" height="5"/>
      <rect x="12" y="13" width="24" height="4.5" rx="2.25"/>
      <path d="M20 17.5 h8 l-2.4 22.5 L24 46 l-1.6 -6 Z"/>
    </g>
  </svg>
`;

// LAYOUT, stated per index.html's own ledger discipline. The layer is inset:0 and centres the card
// with grid -- so the card sits mid-frame in both required shapes. Checked against the touch
// controls before choosing it: #touch-stick and #attack-button are 112px circles at 1rem insets,
// so the bottom ~8.5rem band on each side belongs to the thumbs. A centred card capped at 19rem
// wide never enters either corner, and on the shortest supported frame (1024x768 landscape) its
// bottom edge sits well above the 640px line where the thumb circles begin. The layer itself takes
// no pointer events -- the stick and ATTACK keep working straight through the ceremony; only the
// card catches the dismissing tap.
export const UNLOCK_CARD_CSS = `
      #unlock-card-layer {
        position: absolute; inset: 0; display: grid; place-items: center;
        opacity: 0; transition: opacity 200ms ease-out;
        pointer-events: none; touch-action: none;
      }
      #unlock-card-layer[data-shown="true"] { opacity: 1; }
      /* The light-burst: one radial pulse behind the card on entry, in the blade's own teal --
         'forwards' so it ends gone rather than snapping back. Decorative only (aria-hidden). */
      #unlock-burst {
        position: absolute; width: 34rem; height: 34rem; border-radius: 50%;
        background: radial-gradient(circle, ${wildwoodAlpha('45%')} 0%, transparent 62%);
        opacity: 0; transform: scale(0.25); pointer-events: none;
      }
      #unlock-card-layer[data-shown="true"] #unlock-burst { animation: unlock-burst 900ms ease-out 1 forwards; }
      @keyframes unlock-burst {
        0%   { opacity: 0; transform: scale(0.25); }
        30%  { opacity: 1; }
        100% { opacity: 0; transform: scale(1); }
      }
      /* Storybook parchment, teal-edged: the ONE warm paper object in a HUD of dark pills, because
         this moment is a page from the story, not another readout. */
      #unlock-card {
        position: relative; pointer-events: auto;
        --wildwood: ${WILDWOOD_CSS};
        width: min(19rem, calc(100% - 2rem));
        padding: 1.1rem 1.2rem 1.15rem; border-radius: 1rem;
        background: linear-gradient(180deg, #f8eed8 0%, #efdfbe 100%);
        border: 2px solid var(--wildwood);
        box-shadow: 0 0.6rem 2rem rgb(12 20 31 / 45%), 0 0 1.6rem ${wildwoodAlpha('35%')};
        color: #3a3120; text-align: center;
        transform: translateY(0.6rem) scale(0.96);
        transition: transform 260ms ease-out;
      }
      #unlock-card-layer[data-shown="true"] #unlock-card { transform: none; }
      #unlock-card-eyebrow {
        color: #2c7a64; font: 800 0.78rem/1.2 system-ui, sans-serif; letter-spacing: 0.22em;
      }
      #unlock-card-name { margin-top: 0.2rem; font: 900 1.5rem/1.15 system-ui, sans-serif; }
      #unlock-card-sword { margin: 0.35rem auto 0; width: 3.4rem; height: 3.4rem; }
      #unlock-card-sword svg { display: block; width: 100%; height: 100%; }
      /* The comparison is the ONLY stat, deliberately big -- same weight class as
         #hero-item-compare, in the teal's own darker ink rather than reward gold, because this card
         is about the BLADE; the gold lives on the GEAR pill that points at ownership. */
      #unlock-card-compare {
        margin-top: 0.3rem; min-height: 1.3em;
        font: 800 1.3rem/1.2 system-ui, sans-serif; color: #2c7a64;
      }
      #unlock-card-hint {
        display: inline-block; margin-top: 0.65rem; padding: 0.32rem 0.85rem; border-radius: 999px;
        background: rgb(12 20 31 / 85%); color: #f2b33d;
        font: 800 0.8rem/1.2 system-ui, sans-serif; letter-spacing: 0.06em;
      }
      /* Reduced motion: no pulse, no entrance -- the card simply is there, then is not. */
      @media (prefers-reduced-motion: reduce) {
        #unlock-card-layer, #unlock-card { transition: none; }
        #unlock-card-layer[data-shown="true"] #unlock-burst { animation: none; }
      }
`;

const STYLE_ID = 'unlock-card-style';

function ensureUnlockCardStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = UNLOCK_CARD_CSS;
  doc.head.appendChild(style);
}

/**
 * The DOM half. Builds the layer once, returns { element, show, hide } -- main.js appends element
 * into #game (after the other HUD layers, so the ceremony paints over them) and calls
 * show(unlockCardState(...), onDone) the frame it diffs the blade into ownedItemIds -- the same
 * "diff the published state, do not chase a transient event" discipline cart-jolt's recipes.js
 * comment documents for its own moment.
 *
 * show() arms a ~4.5s auto-dismiss; a tap on the card dismisses early. Either way onDone fires
 * exactly once, then never again until the next show() -- hide() is idempotent, and calling it on
 * an already-hidden card does nothing (no stray callback for a ceremony that never started).
 */
export function createUnlockCard(doc) {
  ensureUnlockCardStyle(doc);

  const element = doc.createElement('div');
  element.id = 'unlock-card-layer';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.dataset.shown = 'false';

  const burst = doc.createElement('div');
  burst.id = 'unlock-burst';
  burst.setAttribute('aria-hidden', 'true');

  const card = doc.createElement('div');
  card.id = 'unlock-card';
  const eyebrowEl = doc.createElement('div');
  eyebrowEl.id = 'unlock-card-eyebrow';
  const nameEl = doc.createElement('div');
  nameEl.id = 'unlock-card-name';
  const swordEl = doc.createElement('div');
  swordEl.id = 'unlock-card-sword';
  swordEl.setAttribute('aria-hidden', 'true');
  swordEl.innerHTML = SWORD_SVG;
  const compareEl = doc.createElement('div');
  compareEl.id = 'unlock-card-compare';
  const hintEl = doc.createElement('div');
  hintEl.id = 'unlock-card-hint';
  card.appendChild(eyebrowEl);
  card.appendChild(nameEl);
  card.appendChild(swordEl);
  card.appendChild(compareEl);
  card.appendChild(hintEl);

  element.appendChild(burst);
  element.appendChild(card);

  let dismissTimer = null;
  let done = null;

  function clearTimer() {
    if (dismissTimer !== null) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  }

  function hide() {
    clearTimer();
    element.dataset.shown = 'false';
    const callback = done;
    done = null;
    if (callback) callback();
  }

  function show(state, onDone) {
    // A second show() while one is up resolves the first ceremony cleanly (its onDone fires)
    // before starting the next -- a dropped callback would strand whatever main.js gated on it.
    if (element.dataset.shown === 'true') hide();
    eyebrowEl.textContent = state.eyebrow;
    nameEl.textContent = state.name;
    compareEl.textContent = state.comparison ?? '';
    hintEl.textContent = state.hint;
    done = onDone ?? null;
    element.dataset.shown = 'true';
    dismissTimer = setTimeout(hide, UNLOCK_CARD_SECONDS * 1000);
  }

  card.addEventListener('click', () => {
    if (element.dataset.shown === 'true') hide();
  });

  return { element, show, hide };
}
