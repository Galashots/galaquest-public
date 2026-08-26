// Lightweight DOM presentation for ordinary enemies. Simulation and network state stay upstream;
// this adapter only projects stable enemy identities into a bounded, readable overlay.

export const ENEMY_NAMEPLATE_MAX_DISTANCE = 16;

export function enemyNameplateModel(enemy, { heroLevel = 1 } = {}) {
  const level = Number.isSafeInteger(enemy?.level) ? enemy.level : 1;
  const maxHp = Number.isFinite(enemy?.maxHp) && enemy.maxHp > 0 ? enemy.maxHp : 1;
  const hp = Number.isFinite(enemy?.hp) ? Math.max(0, Math.min(maxHp, enemy.hp)) : 0;
  const danger = level >= heroLevel + 2;
  return {
    name: enemy?.kind === 'wolf' ? 'Wolf' : String(enemy?.kind ?? 'Enemy'),
    level,
    levelText: `Lv ${level}`,
    healthFraction: hp / maxHp,
    danger,
    dangerText: danger ? 'DANGER' : '',
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
