// public/src/ui/runeChestCard.js
//
// The DOM half of the rune chest's question card -- progression/runeChests.js owns the rules (which
// question, what counts as correct, what it pays), main.js decides WHEN to show one (proximity to a
// standing chest) and WHAT to do with the answer (judge it, journal the XP, celebrate); this file
// only owns the handful of DOM nodes index.html already declares (#rune-chest-card and its chrome)
// and the two things a caller needs from them: render a question onto the card, and know when a
// button was tapped. Same split progression/heroScreen.js's own DOM half keeps for the Hero screen.
//
// Deliberately NOT a toggle button's panel the way #hero-screen/#village-board-screen are -- there is
// no chest icon in the corner to tap; this opens itself the instant the hero walks within
// progression/runeChests.js's own CHEST_COLLECT_RADIUS_METERS of a standing chest (main.js's own
// proximity check) and closes itself the instant an answer is judged. A tap on the ✕ or the dimmed
// backdrop (main.js wires the backdrop the same centralised way it already does for #profile-gate)
// closes it WITHOUT judging anything -- "a kid can just walk away... dismissing leaves the chest for
// later" is the brief's own words, and that is exactly what NOT calling onAnswer achieves: the chest
// itself is untouched by a dismiss, so runeChests.js's own state still shows it standing.

/**
 * @param options.root            defaults to `document`.
 * @param options.onAnswer(index) fires the instant one of the three answer buttons is tapped, BEFORE
 *   the card closes -- main.js judges the tap against the question it handed to show() and reacts
 *   (reward, ceremony, closeRuneChest). Never fires for a ✕/backdrop dismissal.
 * @param options.onOpenChange(open)  fires after show()/close() actually change the shown state, the
 *   same seam progression/heroScreen.js's own onOpenChange documents -- so main.js can suspend
 *   movement/attack input and re-arm its own "do not instantly reopen while still standing here"
 *   guard without polling isOpen() every frame.
 */
export function createRuneChestCard(options = {}) {
  const root = options.root ?? document;
  const onAnswer = options.onAnswer ?? (() => {});
  const onOpenChange = options.onOpenChange ?? (() => {});

  const layer = root.querySelector('#rune-chest-card');
  const closeButton = root.querySelector('#rune-chest-card-close');
  const promptEl = root.querySelector('#rune-chest-card-prompt');
  const visualEl = root.querySelector('#rune-chest-card-visual');
  const answerButtons = [...root.querySelectorAll('.rune-chest-answer')];

  let shown = false;

  function setShown(next) {
    if (shown === next) return;
    shown = next;
    if (layer) layer.dataset.shown = String(shown);
    onOpenChange(shown);
  }

  /** Paint one question onto the card's chrome. A question with fewer than 3 answers (should never
   *  happen -- every bank entry builds exactly 3, see runeChests.js's own buildQuestionFromEntry --
   *  but this is rendering a caller-handed object, not trusting its shape) hides the spare button
   *  rather than showing an empty one a child could tap into a broken answer. */
  function render(question) {
    promptEl.textContent = question.prompt ?? '';
    if (typeof question.visual === 'string' && question.visual.length > 0) {
      visualEl.textContent = question.visual;
      visualEl.hidden = false;
    } else {
      visualEl.textContent = '';
      visualEl.hidden = true;
    }
    const answers = Array.isArray(question.answers) ? question.answers : [];
    answerButtons.forEach((button, index) => {
      const text = answers[index];
      button.textContent = typeof text === 'string' ? text : '';
      button.hidden = typeof text !== 'string';
    });
  }

  /** Open the card on a fresh question. Safe to call while already open (a second chest cannot exist
   *  per runeChests.js's own session cap, so this should never actually happen mid-question, but
   *  re-rendering rather than assuming is the cheaper contract to keep). */
  function show(question) {
    render(question);
    setShown(true);
  }

  /** Close the card WITHOUT judging anything -- the ✕, the backdrop, or main.js's own escape hatch.
   *  Idempotent: closing an already-closed card is a no-op, the same discipline every other overlay's
   *  close() keeps. */
  function close() {
    setShown(false);
  }

  answerButtons.forEach((button, index) => {
    button.addEventListener('click', () => {
      if (!shown || button.hidden) return;
      // Closed FIRST, then the callback -- an answer tap must not read as "the card is still open"
      // to anything onAnswer's own handler goes on to check (main.js re-arms the proximity guard off
      // onOpenChange(false), which has to have already fired by the time onAnswer starts judging).
      setShown(false);
      onAnswer(index);
    });
  });
  closeButton?.addEventListener('click', () => close());

  return {
    show,
    close,
    isOpen() { return shown; },
  };
}
