const MOVEMENT_KEYS = new Set([
  'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp',
  'KeyA', 'KeyD', 'KeyS', 'KeyW',
]);

// Desktop swing. The game is played on iPads, where the attack button is the real control, but every
// harness and every debugging session runs on a keyboard and needs to be able to throw a punch.
// Space is preventDefault-ed because otherwise it scrolls the page.
const ATTACK_KEYS = new Set(['Space', 'KeyJ']);

// A NAME A CHILD TYPED HAD LETTERS GO MISSING, and this is why: KeyW/A/S/D and Space are movement
// and swing everywhere else in this game, so this module preventDefault-ed and recorded them on
// EVERY window keydown regardless of what was focused. The profile gate's own name field
// (progression/profileGate.js's #profile-gate-name) sits on the same window, so a hero named "Wander"
// arrived as "ander" -- W was eaten before the input ever saw it, and a stray Shift held the run flag
// on besides.
//
// The fix is to recognise "this keystroke belongs to a text field" and get out of the way entirely:
// no preventDefault (the input needs the key to actually type), no keys.add (nothing here should
// believe WASD is held down just because a child is spelling their hero's name).
const EDITABLE_TAG_NAMES = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True for an <input>, <textarea>, <select>, or anything contenteditable -- the target owns its own
 *  keystrokes and this module must act as though the event never happened. */
export function isEditableTarget(target) {
  if (!target || typeof target !== 'object') return false;
  if (EDITABLE_TAG_NAMES.has(target.tagName)) return true;
  return target.isContentEditable === true;
}

export function keysToScreenVector(keys) {
  const x = Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA'));
  const y = Number(keys.has('ArrowUp') || keys.has('KeyW')) - Number(keys.has('ArrowDown') || keys.has('KeyS'));
  const length = Math.hypot(x, y);
  if (length === 0) return { x: 0, y: 0 };
  return { x: x / length, y: y / length };
}

export function createKeyboardInput(target = window) {
  const keys = new Set();
  let attackPending = false;
  const onKeyDown = (event) => {
    // Ignored ENTIRELY, before anything else here runs -- see isEditableTarget's own comment. A
    // child naming their hero must get every letter, including W/A/S/D and Space.
    if (isEditableTarget(event.target)) return;
    if (MOVEMENT_KEYS.has(event.code) || ATTACK_KEYS.has(event.code)) event.preventDefault();
    // An edge, not a level: `repeat` is true while a key is held, and without this guard leaning on
    // the space bar would request a swing every frame.
    if (ATTACK_KEYS.has(event.code) && !event.repeat) attackPending = true;
    keys.add(event.code);
  };
  const onKeyUp = (event) => {
    // Symmetric with onKeyDown: a key that was never added (because it was typed into a field) has
    // nothing to remove, but checking keeps the two handlers agreeing about whose keystroke this is
    // rather than one of them guessing from what the other left behind.
    if (isEditableTarget(event.target)) return;
    keys.delete(event.code);
  };
  const onBlur = () => { keys.clear(); attackPending = false; };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);

  return {
    read() {
      return {
        run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
        screen: keysToScreenVector(keys),
      };
    },
    /** True once per key press, mirroring the attack button's edge behaviour. */
    takeAttack() {
      if (!attackPending) return false;
      attackPending = false;
      return true;
    },
    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    },
    keys,
  };
}
