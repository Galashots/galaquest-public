import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  clampNameplateProjection,
  createEnemyNameplateLayer,
  enemyNameplateModel,
  nameplateProjectionIsSafe,
} from '../public/src/enemies/nameplate.js';

test('E2 C3 clamps an edge projection so the full card remains readable', () => {
  assert.deepEqual(
    clampNameplateProjection({ x: 420, y: -10 }, { width: 390, height: 844 }),
    { x: 348, y: -10 },
  );
});

test('E2 C3 rejects projected labels that overlap a reserved HUD rectangle', () => {
  const joystick = { left: 0, top: 700, right: 112, bottom: 812 };
  assert.equal(nameplateProjectionIsSafe({ x: 56, y: 735 }, [joystick]), false);
  assert.equal(nameplateProjectionIsSafe({ x: 220, y: 500 }, [joystick]), true);
});

test('E2 C3 nameplate model exposes bounded health and the locked danger threshold', () => {
  const ordinary = enemyNameplateModel({ kind: 'wolf', level: 2, hp: 20, maxHp: 40 }, { heroLevel: 1 });
  assert.deepEqual(ordinary, {
    name: 'Wolf',
    level: 2,
    levelText: 'Lv 2',
    healthFraction: 0.5,
    danger: false,
    dangerText: '',
    menacing: false,
    visible: true,
  });

  const danger = enemyNameplateModel({ kind: 'wolf', level: 4, hp: 60, maxHp: 60 }, { heroLevel: 2 });
  assert.equal(danger.danger, true, 'danger begins exactly two levels above the hero');
  assert.equal(danger.dangerText, 'DANGER');
  assert.equal(enemyNameplateModel({ kind: 'wolf', level: 4, hp: 0, maxHp: 60 }).visible, false);
  assert.equal(enemyNameplateModel({ kind: 'wolf', level: 4, hp: 60, maxHp: 60, mode: 'dead' }).visible, false);
});

test('R1: each density-package kind carries its own display name, and only the Alpha is menacing', () => {
  const ember = enemyNameplateModel({ kind: 'ember-wolf', level: 1, hp: 40, maxHp: 40 }, { heroLevel: 1 });
  assert.equal(ember.name, 'Ember Wolf');
  assert.equal(ember.menacing, false);

  const frost = enemyNameplateModel({ kind: 'frost-wolf', level: 1, hp: 55, maxHp: 55 }, { heroLevel: 1 });
  assert.equal(frost.name, 'Frost Wolf');
  assert.equal(frost.menacing, false);

  // Level 1 against a Level-1 hero: the ordinary danger threshold is NOT met, yet the plate still
  // carries the Alpha's own accent -- the two are independent signals.
  const alpha = enemyNameplateModel({ kind: 'alpha-wolf', level: 1, hp: 90, maxHp: 90 }, { heroLevel: 1 });
  assert.equal(alpha.name, 'Alpha Wolf');
  assert.equal(alpha.danger, false);
  assert.equal(alpha.menacing, true);
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
