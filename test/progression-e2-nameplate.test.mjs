import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  createEnemyNameplateLayer,
  enemyNameplateModel,
} from '../public/src/enemies/nameplate.js';

test('E2 C3 nameplate model exposes bounded health and the locked danger threshold', () => {
  const ordinary = enemyNameplateModel({ kind: 'wolf', level: 2, hp: 20, maxHp: 40 }, { heroLevel: 1 });
  assert.deepEqual(ordinary, {
    name: 'Wolf',
    level: 2,
    levelText: 'Lv 2',
    healthFraction: 0.5,
    danger: false,
    dangerText: '',
    visible: true,
  });

  const danger = enemyNameplateModel({ kind: 'wolf', level: 4, hp: 60, maxHp: 60 }, { heroLevel: 2 });
  assert.equal(danger.danger, true, 'danger begins exactly two levels above the hero');
  assert.equal(danger.dangerText, 'DANGER');
  assert.equal(enemyNameplateModel({ kind: 'wolf', level: 4, hp: 0, maxHp: 60 }).visible, false);
  assert.equal(enemyNameplateModel({ kind: 'wolf', level: 4, hp: 60, maxHp: 60, mode: 'dead' }).visible, false);
});

class FakeElement {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.attributes = {};
    this.textContent = '';
    this.parentNode = null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  querySelector(selector) {
    const wanted = selector.replace(/^.*\.([^ >]+).*$/, '$1');
    return this.children.find((child) => child.className?.split(' ').includes(wanted))
      ?? this.children.flatMap((child) => child.children).find((child) => child.className?.split(' ').includes(wanted));
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  set innerHTML(value) {
    if (!value) return;
    const classes = [
      'enemy-nameplate-name',
      'enemy-nameplate-level',
      'enemy-nameplate-danger',
      'enemy-nameplate-health',
    ];
    this.children = classes.map((className) => {
      const child = new FakeElement(this.ownerDocument);
      child.className = className;
      if (className === 'enemy-nameplate-health') {
        const bar = new FakeElement(this.ownerDocument);
        bar.className = 'enemy-nameplate-health-fill';
        child.appendChild(bar);
      }
      child.parentNode = this;
      return child;
    });
  }
}

const fakeDocument = { createElement: () => new FakeElement(fakeDocument) };

test('E2 C3 layer keeps one DOM identity per enemyId while collections reorder', () => {
  const container = new FakeElement(fakeDocument);
  const layer = createEnemyNameplateLayer({ container });
  const enemies = [
    { enemyId: 'wolf-1', kind: 'wolf', level: 1, hp: 30, maxHp: 30 },
    { enemyId: 'wolf-5', kind: 'wolf', level: 4, hp: 60, maxHp: 60 },
  ];
  const project = (enemy) => ({ visible: true, x: enemy.level, y: enemy.level + 1 });

  layer.update(enemies, { heroLevel: 1, project });
  assert.equal(layer.count, 2);
  const firstById = new Map(container.children.map((element) => [element.dataset.enemyId, element]));
  assert.equal(firstById.get('wolf-5').dataset.danger, 'true');

  layer.update([enemies[1], enemies[0]], { heroLevel: 1, project });
  assert.equal(layer.count, 2);
  assert.equal(container.children.find((element) => element.dataset.enemyId === 'wolf-1'), firstById.get('wolf-1'));
  assert.equal(container.children.find((element) => element.dataset.enemyId === 'wolf-5'), firstById.get('wolf-5'));

  layer.update([enemies[1]], { heroLevel: 1, project });
  assert.equal(layer.count, 1);
  assert.equal(container.children[0].dataset.enemyId, 'wolf-5');
  layer.dispose();
  assert.equal(layer.count, 0);
});
