// Lightweight DOM presentation for ordinary enemies. Simulation and network state stay upstream;
// this adapter only projects stable enemy identities into a bounded, readable overlay.

// R1: the display name and the danger-plate accent both come from the ONE kind->appearance table
// (enemies/enemyKindPresentation.js) wolf.js's tint/scale and this plate now share -- so "Ember Wolf"
// on the card and the ember tint on the body can never name two different animals (GQ-007).
import { displayNameForKind, presentationForKind } from './enemyKindPresentation.js';

export const ENEMY_NAMEPLATE_MAX_DISTANCE = 16;
// Slightly larger than the rendered compact Wolf card, leaving a small buffer for font/layout drift
// without hiding otherwise readable labels in the narrow portrait viewport.
export const ENEMY_NAMEPLATE_SAFE_WIDTH = 84;
export const ENEMY_NAMEPLATE_SAFE_HEIGHT = 48;

/** Keep a projected label card fully inside the horizontal overlay before testing HUD overlap. */
export function clampNameplateProjection(
  { x, y }, { width, height }, { width: labelWidth = ENEMY_NAMEPLATE_SAFE_WIDTH, height: labelHeight = ENEMY_NAMEPLATE_SAFE_HEIGHT } = {},
) {
  return {
    x: Math.max(labelWidth / 2, Math.min(width - labelWidth / 2, x)),
    y,
  };
}

/** Return whether a projected label rectangle would enter a reserved HUD/control rectangle. */
export function nameplateProjectionIsSafe(
  { x, y }, reservedRects, { width = ENEMY_NAMEPLATE_SAFE_WIDTH, height = ENEMY_NAMEPLATE_SAFE_HEIGHT } = {},
) {
  const label = { left: x - width / 2, right: x + width / 2, top: y - height, bottom: y };
  return !reservedRects.some((reserved) => label.left < reserved.right
    && label.right > reserved.left && label.top < reserved.bottom && label.bottom > reserved.top);
}

export function enemyNameplateModel(enemy, { heroLevel = 1 } = {}) {
  const level = Number.isSafeInteger(enemy?.level) ? enemy.level : 1;
  const maxHp = Number.isFinite(enemy?.maxHp) && enemy.maxHp > 0 ? enemy.maxHp : 1;
  const hp = Number.isFinite(enemy?.hp) ? Math.max(0, Math.min(maxHp, enemy.hp)) : 0;
  const danger = level >= heroLevel + 2;
  return {
    name: displayNameForKind(enemy?.kind),
    level,
    levelText: `Lv ${level}`,
    healthFraction: hp / maxHp,
    danger,
    dangerText: danger ? 'DANGER' : '',
    // R1: the Alpha's own danger accent, independent of the level-vs-hero threshold `danger` reads --
    // a Level-1 Alpha is still meant to read as meaner than a Level-1 Wolf standing beside it.
    menacing: presentationForKind(enemy?.kind).menacing,
    visible: enemy?.mode !== 'dead' && enemy?.mode !== 'dying' && hp > 0,
  };
}

function createElement(document) {
  const root = document.createElement('div');
  root.className = 'enemy-nameplate';
  root.dataset.enemyNameplate = 'true';
  root.innerHTML = '<span class="enemy-nameplate-name"></span>'
    + '<span class="enemy-nameplate-level"></span>'
    + '<span class="enemy-nameplate-danger"></span>'
    + '<span class="enemy-nameplate-health" aria-hidden="true"><span></span></span>';
  return root;
}

export function createEnemyNameplateLayer({ container } = {}) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new TypeError('container must be a DOM element');
  }
  const byId = new Map();

  function update(enemies, { heroLevel = 1, project } = {}) {
    if (!Array.isArray(enemies)) throw new TypeError('enemies must be an array');
    if (typeof project !== 'function') throw new TypeError('project must be a function');
    const seen = new Set();
    for (const enemy of enemies) {
      const id = enemy?.enemyId;
      if (typeof id !== 'string' || id.length === 0) continue;
      seen.add(id);
      const model = enemyNameplateModel(enemy, { heroLevel });
      const projection = model.visible ? project(enemy) : null;
      let entry = byId.get(id);
      if (!entry) {
        entry = { element: createElement(container.ownerDocument ?? document) };
        container.appendChild(entry.element);
        byId.set(id, entry);
      }
      const visible = model.visible && projection?.visible === true;
      entry.element.hidden = !visible;
      if (!visible) continue;
      entry.element.dataset.danger = String(model.danger);
      entry.element.dataset.menacing = String(model.menacing);
      entry.element.dataset.enemyId = id;
      entry.element.style.left = `${projection.x}px`;
      entry.element.style.top = `${projection.y}px`;
      entry.element.querySelector('.enemy-nameplate-name').textContent = model.name;
      entry.element.querySelector('.enemy-nameplate-level').textContent = model.levelText;
      entry.element.querySelector('.enemy-nameplate-danger').textContent = model.dangerText;
      entry.element.querySelector('.enemy-nameplate-health > span').style.width = `${model.healthFraction * 100}%`;
      entry.element.setAttribute('aria-label', `${model.name}, ${model.levelText}, ${Math.round(model.healthFraction * 100)}% health${model.danger ? ', danger' : ''}`);
    }
    for (const [id, entry] of byId) {
      if (seen.has(id)) continue;
      entry.element.remove();
      byId.delete(id);
    }
  }

  function dispose() {
    for (const entry of byId.values()) entry.element.remove();
    byId.clear();
  }

  return { update, dispose, get count() { return byId.size; } };
}
