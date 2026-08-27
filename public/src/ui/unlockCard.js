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

// A `#rrggbb` accent (the shape heroScreen.js's swatchFor hands in) to the space-separated
// `rgb(r g b / a%)` the burst gradient uses -- so an override accent tints its own pulse the same way
// the Wildwood default does. Returns null for anything that is not a plain six-digit hex, and the
// caller then leaves the CSS default in place rather than painting a broken colour.
function accentAlpha(cssColor, alpha) {
  const match = /^#([0-9a-f]{6})$/i.exec(typeof cssColor === 'string' ? cssColor : '');
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return `rgb(${(value >> 16) & 0xff} ${(value >> 8) & 0xff} ${value & 0xff} / ${alpha})`;
}

// ~4.5s, then it dismisses itself -- long enough to read four short lines twice, short enough that
// a child who taps nothing is back in the world before the moment goes stale. A tap on the card
// ends it early; both routes fire onDone exactly once.
export const UNLOCK_CARD_SECONDS = 4.5;

/**
 * Pure. Turns { itemName, fromDamage, toDamage } -- or, for defensive gear, { itemName, power,
 * prompt } -- into the card's display strings. No DOM, no item-table lookups of its own: the CALLER
 * reads progression/items.js (damageFor/itemDef) and progression/power.js (powerChange) and hands
 * the values in, so this stays a formatter and the numbers keep their single source (GQ-007: read
 * off those files, never restated -- test/unlock-card.test.mjs builds its expectations from them).
 *
 * comparison is null rather than a string with a hole in it when the numbers it needs are not finite
 * -- a card that says 'undefined → 2 DAMAGE' at the arc's biggest moment is worse than one that says
 * nothing. isUpgrade is computed, never assumed (the sabotage test swaps the numbers).
 *
 * `power` is a progression/power.js powerChange() object -- G1-C3's Helmet is the first reward whose
 * worth is a POWER move rather than a DAMAGE line, because a helmet's defence is not damage and a
 * child reads its value off the one number the whole game teaches them to. `prompt` ('EQUIP NOW?')
 * turns the informational card into an offer: ownership and equipment stay two beats, so the card
 * asks rather than auto-equipping, and the DOM half renders Equip/Later against this string.
 */
export function unlockCardState({ itemName, fromDamage, toDamage, power = null, prompt = null } = {}) {
  const trimmed = typeof itemName === 'string' ? itemName.trim() : '';
  const name = trimmed.toUpperCase();
  // The card SHOUTS and a voice should not. Read from the untouched name rather than the display
  // one, and fall back to something a child can act on rather than saying "Unlocked! ." at them.
  const spokenName = trimmed === '' ? 'new gear' : trimmed;
  const promptText = typeof prompt === 'string' && prompt.trim() !== '' ? prompt.trim() : null;

  // POWER comparison (defensive/other gear). Uses the SAME before → after shape the weapon line and
  // the Hero screen's own #hero-item-compare draw, in POWER rather than DAMAGE, so the ceremony and
  // the Gear screen a child opens ten seconds later say it identically.
  if (power && Number.isFinite(power.before) && Number.isFinite(power.after)) {
    return {
      eyebrow: 'UNLOCKED',
      name,
      comparison: `${power.beforeText} → ${power.afterText} POWER`,
      isUpgrade: power.delta > 0,
      // The buttons ARE the affordance for a card that offers an equip, so no gear-pill hint here.
      hint: null,
      prompt: promptText,
      // Said as a sentence, arrow-free and shout-free like the weapon spoken form: the arrow read
      // aloud is the word "arrow", and a voice should not read the uppercased card name.
      spoken: `Unlocked! ${spokenName}. Power ${power.beforeText} to ${power.afterText}.`
        + (promptText ? ' Equip it now?' : ''),
    };
  }

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
    prompt: promptText,
    // WHAT A CHILD WHO CANNOT READ GETS OUT OF THIS CARD, which until now was nothing. This is the
    // biggest moment in the game -- the thing you were sent for, arriving -- and all four fields on
    // it are text. keeperSpeech.js makes the argument in full; the same latch reads this out once a
    // child has tapped the speaker button, and stays silent for one who never asked.
    //
    // Deliberately NOT the displayed strings. `name` is uppercased for the card and the eyebrow is
    // a label; '1 → 2 DAMAGE' reads the arrow aloud, and '🗡 GEAR' is a picture of a button, which
    // is the one thing a spoken sentence cannot be. So the ear gets its own wording, and the
    // comparison becomes the sentence a person would actually say.
    spoken: comparable
      ? `Unlocked! ${spokenName}. Now ${toDamage} damage instead of ${fromDamage}.`
      : `Unlocked! ${spokenName}.`,
  };
}

// A sword, point down -- the same silhouette as the planted prop in Rowan's clearing (blade planted
// point-down is that prop's whole pose), inline SVG so this ships zero image assets. Deliberately
// crude, matching wildwoodBlade.js's own "a crude blade standing in the right place tonight" trade.
// Drawn in `currentColor` so the icon takes the card's --accent (the Wildwood teal by default), the
// one change from GP1-C1: the card is no longer weapon-only, and a second reward wears a second
// accent through the same slot rather than a second card.
export const SWORD_ICON_SVG = `
  <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="currentColor">
      <rect x="21.5" y="2" width="5" height="7" rx="1.5"/>
      <rect x="22.75" y="8" width="2.5" height="5"/>
      <rect x="12" y="13" width="24" height="4.5" rx="2.25"/>
      <path d="M20 17.5 h8 l-2.4 22.5 L24 46 l-1.6 -6 Z"/>
    </g>
  </svg>
`;

// An open-face helmet: a domed skull-cap with a raised brow ridge and an open face, the read the
// running-game mount and its hair/ear occlusion are authored for (character/gear.js). Same crude,
// zero-asset, currentColor discipline as the sword, so G1-C3's Helmet card wears the Helmet's own
// accent (heroScreen.js's swatch, handed in by main.js) instead of a sword in teal.
export const HELMET_ICON_SVG = `
  <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="currentColor">
      <path d="M24 6 C13 6 7 14 7 25 v3 h6 v-3 c0-8 4-13 11-13 s11 5 11 13 v3 h6 v-3 C41 14 35 6 24 6 Z"/>
      <rect x="6" y="27" width="8" height="6" rx="2"/>
      <rect x="34" y="27" width="8" height="6" rx="2"/>
      <rect x="20" y="6" width="8" height="9" rx="3"/>
    </g>
  </svg>
`;

// R1: a pair of pauldrons -- two domed shoulder caps, same crude/zero-asset/currentColor discipline
// as the sword and helmet above, so a Shoulders card wears the item's own accent (heroScreen.js's
// swatchFor) instead of borrowing the Helmet's silhouette for a different body slot.
export const SHOULDER_ICON_SVG = `
  <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="currentColor">
      <path d="M6 22 C6 13 12 7 18 7 s10 5 10 11 v6 H6 Z"/>
      <path d="M42 22 C42 13 36 7 30 7 s-10 5 -10 11 v6 h22 Z"/>
      <rect x="4" y="27" width="16" height="7" rx="2.5"/>
      <rect x="28" y="27" width="16" height="7" rx="2.5"/>
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
        /* The card's accent, ONE colour driving the border, burst and icon. Defaults to the Wildwood
           teal so the weapon ceremony is unchanged (GP1-C1); show() overrides it per reward -- G1-C3's
           Helmet wears the Hero screen's own Helmet swatch, handed in by main.js, so the ceremony and
           the Gear screen agree the same way the Blade already does. */
        --accent: ${WILDWOOD_CSS};
        --burst: ${wildwoodAlpha('45%')};
        --burst-soft: ${wildwoodAlpha('35%')};
      }
      #unlock-card-layer[data-shown="true"] { opacity: 1; }
      /* The light-burst: one radial pulse behind the card on entry, in the reward's accent --
         'forwards' so it ends gone rather than snapping back. Decorative only (aria-hidden). */
      #unlock-burst {
        position: absolute; width: 34rem; height: 34rem; border-radius: 50%;
        background: radial-gradient(circle, var(--burst) 0%, transparent 62%);
        opacity: 0; transform: scale(0.25); pointer-events: none;
      }
      #unlock-card-layer[data-shown="true"] #unlock-burst { animation: unlock-burst 900ms ease-out 1 forwards; }
      @keyframes unlock-burst {
        0%   { opacity: 0; transform: scale(0.25); }
        30%  { opacity: 1; }
        100% { opacity: 0; transform: scale(1); }
      }
      /* Storybook parchment, accent-edged: the ONE warm paper object in a HUD of dark pills, because
         this moment is a page from the story, not another readout. */
      #unlock-card {
        position: relative; pointer-events: auto;
        width: min(19rem, calc(100% - 2rem));
        padding: 1.1rem 1.2rem 1.15rem; border-radius: 1rem;
        background: linear-gradient(180deg, #f8eed8 0%, #efdfbe 100%);
        border: 2px solid var(--accent);
        box-shadow: 0 0.6rem 2rem rgb(12 20 31 / 45%), 0 0 1.6rem var(--burst-soft);
        color: #3a3120; text-align: center;
        transform: translateY(0.6rem) scale(0.96);
        transition: transform 260ms ease-out;
      }
      #unlock-card-layer[data-shown="true"] #unlock-card { transform: none; }
      #unlock-card-eyebrow {
        color: #2c7a64; font: 800 0.78rem/1.2 system-ui, sans-serif; letter-spacing: 0.22em;
      }
      #unlock-card-name { margin-top: 0.2rem; font: 900 1.5rem/1.15 system-ui, sans-serif; }
      #unlock-card-icon { margin: 0.35rem auto 0; width: 3.4rem; height: 3.4rem; color: var(--accent); }
      #unlock-card-icon svg { display: block; width: 100%; height: 100%; }
      /* The comparison is the ONLY stat, deliberately big -- same weight class as
         #hero-item-compare, in a darker ink rather than reward gold, because this card is about the
         ITEM; the gold lives on the GEAR pill / the Equip button that points at what to do next. */
      #unlock-card-compare {
        margin-top: 0.3rem; min-height: 1.3em;
        font: 800 1.3rem/1.2 system-ui, sans-serif; color: #2c7a64;
      }
      #unlock-card-hint {
        display: inline-block; margin-top: 0.65rem; padding: 0.32rem 0.85rem; border-radius: 999px;
        background: rgb(12 20 31 / 85%); color: #f2b33d;
        font: 800 0.8rem/1.2 system-ui, sans-serif; letter-spacing: 0.06em;
      }
      /* G1-C3: the offer. A prompt line ('EQUIP NOW?') and two thumb-sized buttons -- ownership and
         equipment are two beats, so the card ASKS. Hidden entirely on the weapon path, where the card
         only announces. */
      #unlock-card-prompt {
        margin-top: 0.7rem; font: 800 0.95rem/1.2 system-ui, sans-serif; letter-spacing: 0.08em;
        color: #3a3120;
      }
      #unlock-card-actions { display: none; margin-top: 0.6rem; gap: 0.55rem; justify-content: center; }
      #unlock-card[data-actions="true"] #unlock-card-actions { display: flex; }
      #unlock-card[data-actions="true"] #unlock-card-hint { display: none; }
      #unlock-card-equip, #unlock-card-later {
        pointer-events: auto; border: none; cursor: pointer; border-radius: 999px;
        padding: 0.5rem 1.1rem; font: 800 0.9rem/1 system-ui, sans-serif; letter-spacing: 0.04em;
      }
      #unlock-card-equip { background: #2c7a64; color: #f8eed8; }
      #unlock-card-later { background: rgb(12 20 31 / 12%); color: #3a3120; }
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
  const iconEl = doc.createElement('div');
  iconEl.id = 'unlock-card-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.innerHTML = SWORD_ICON_SVG;
  const compareEl = doc.createElement('div');
  compareEl.id = 'unlock-card-compare';
  const hintEl = doc.createElement('div');
  hintEl.id = 'unlock-card-hint';
  // G1-C3: the offer. Absent from the weapon path (card.dataset.actions stays 'false'), which keeps
  // that card exactly the announce-and-dismiss card GP1-C1 shipped.
  const promptEl = doc.createElement('div');
  promptEl.id = 'unlock-card-prompt';
  const actionsEl = doc.createElement('div');
  actionsEl.id = 'unlock-card-actions';
  const equipButton = doc.createElement('button');
  equipButton.id = 'unlock-card-equip';
  equipButton.type = 'button';
  const laterButton = doc.createElement('button');
  laterButton.id = 'unlock-card-later';
  laterButton.type = 'button';
  // The buttons ANSWER the prompt rather than repeating it: the card asks "EQUIP NOW?" once, in the
  // prompt line, and the button is the imperative the child taps. Echoing the full question on the
  // button read as the same words twice in a running-game capture.
  equipButton.textContent = 'EQUIP';
  laterButton.textContent = 'LATER';
  actionsEl.appendChild(equipButton);
  actionsEl.appendChild(laterButton);
  card.appendChild(eyebrowEl);
  card.appendChild(nameEl);
  card.appendChild(iconEl);
  card.appendChild(compareEl);
  card.appendChild(promptEl);
  card.appendChild(hintEl);
  card.appendChild(actionsEl);

  element.appendChild(burst);
  element.appendChild(card);

  let dismissTimer = null;
  let done = null;
  // The equip choice for THIS showing, cleared on hide so a stale callback can never fire against the
  // next card. Only set while an offering card (one given an onEquip) is up.
  let equipChoice = null;

  function clearTimer() {
    if (dismissTimer !== null) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  }

  function hide() {
    clearTimer();
    equipChoice = null;
    element.dataset.shown = 'false';
    const callback = done;
    done = null;
    if (callback) callback();
  }

  /**
   * show(state) -- announce and auto-dismiss (the weapon path, unchanged).
   * show(state, onDone) -- same, with a completion callback (onDone fires once, on any dismissal).
   * show(state, { onDone, onEquip, accent, icon }) -- an OFFER: renders Equip/Later against
   *   state.prompt and does NOT auto-dismiss, because putting the item on is the child's beat to take.
   *   onEquip fires only when Equip is tapped; onDone fires on either choice. accent (a '#rrggbb' from
   *   heroScreen's swatch) and icon (an SVG string) restyle the card for this reward.
   */
  function show(state, arg) {
    // A second show() while one is up resolves the first ceremony cleanly (its onDone fires)
    // before starting the next -- a dropped callback would strand whatever main.js gated on it.
    if (element.dataset.shown === 'true') hide();
    const options = typeof arg === 'function' ? { onDone: arg } : (arg ?? {});

    // Accent + icon, reset to the Wildwood default first so a previous reward's override never leaks
    // onto the next card. The default lives in the CSS on the layer, so clearing the inline property
    // is what restores it.
    const accent = typeof options.accent === 'string' ? options.accent : null;
    if (accent) {
      element.style.setProperty('--accent', accent);
      const burstFill = accentAlpha(accent, '45%');
      const burstSoft = accentAlpha(accent, '35%');
      if (burstFill) element.style.setProperty('--burst', burstFill);
      if (burstSoft) element.style.setProperty('--burst-soft', burstSoft);
    } else {
      element.style.removeProperty('--accent');
      element.style.removeProperty('--burst');
      element.style.removeProperty('--burst-soft');
    }
    iconEl.innerHTML = typeof options.icon === 'string' ? options.icon : SWORD_ICON_SVG;

    eyebrowEl.textContent = state.eyebrow;
    nameEl.textContent = state.name;
    compareEl.textContent = state.comparison ?? '';
    hintEl.textContent = state.hint ?? '';
    promptEl.textContent = state.prompt ?? '';

    const offers = typeof options.onEquip === 'function';
    card.dataset.actions = String(offers);
    equipChoice = offers ? options.onEquip : null;

    done = typeof options.onDone === 'function' ? options.onDone : null;
    element.dataset.shown = 'true';
    // An offering card waits for a choice; an announcing card dismisses itself. Either way hide()
    // fires onDone exactly once.
    if (!offers) dismissTimer = setTimeout(hide, UNLOCK_CARD_SECONDS * 1000);
  }

  equipButton.addEventListener('click', () => {
    if (element.dataset.shown !== 'true') return;
    const choice = equipChoice;
    // Fire the equip BEFORE hide() so the equip intent is recorded even though hide() clears the
    // handle; onDone (fired inside hide) then closes the ceremony after it.
    if (choice) choice();
    hide();
  });
  laterButton.addEventListener('click', () => {
    if (element.dataset.shown === 'true') hide();
  });

  card.addEventListener('click', (event) => {
    // On an offering card the buttons own dismissal, so a stray tap on the parchment must not count
    // as "Later" -- only the announce-and-dismiss card closes on a body tap. The buttons stop their
    // own clicks from bubbling here so an Equip tap is never also read as a body dismiss.
    if (card.dataset.actions === 'true') return;
    if (event.target === equipButton || event.target === laterButton) return;
    if (element.dataset.shown === 'true') hide();
  });

  return { element, show, hide };
}
