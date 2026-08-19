const MOVEMENT_KEYS = new Set([
  'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp',
  'KeyA', 'KeyD', 'KeyS', 'KeyW',
]);

// Desktop swing. The game is played on iPads, where the attack button is the real control, but every
// harness and every debugging session runs on a keyboard and needs to be able to throw a punch.
// Space is preventDefault-ed because otherwise it scrolls the page.
const ATTACK_KEYS = new Set(['Space', 'KeyJ']);

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
    if (MOVEMENT_KEYS.has(event.code) || ATTACK_KEYS.has(event.code)) event.preventDefault();
    // An edge, not a level: `repeat` is true while a key is held, and without this guard leaning on
    // the space bar would request a swing every frame.
    if (ATTACK_KEYS.has(event.code) && !event.repeat) attackPending = true;
    keys.add(event.code);
  };
  const onKeyUp = (event) => keys.delete(event.code);
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
