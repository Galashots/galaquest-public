// The breeding dialog (docs/CONTRACT.md §7: odds always shown, no cost, no gate, no countdown).
// Two views over the same panel, chosen by the model main.js passes to render():
//   pick: choose two parents, see every outcome and its chance, then confirm.
//   nest: the egg is growing. A progress bar (no numbers) and an optional help-along question.
// Choice-only: the rules layer owns everything that changes.
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const pct = (n) => `${Math.round(n)}%`;

export class BreedingDialog {
  constructor(root, { onPickParent, onConfirm, onAnswer, onClose } = {}) {
    this.handlers = { onPickParent, onConfirm, onAnswer, onClose };
    this.backdrop = el('div', 'gq-modal-backdrop');
    this.backdrop.style.display = 'none';
    this.backdrop.style.position = 'absolute';
    this.panel = el('div', 'gq-panel gq-breed-panel');
    this.backdrop.appendChild(this.panel);
    root.appendChild(this.backdrop);
  }

  get isOpen() { return this.backdrop.style.display !== 'none'; }
  open() { this.backdrop.style.display = 'flex'; }
  close() { this.backdrop.style.display = 'none'; }

  /** model: see breedingModel() in main.js. */
  render(model) {
    this.panel.replaceChildren();
    if (model.mode === 'nest') this._renderNest(model); else this._renderPick(model);
    const close = el('button', 'gq-btn gq-btn-back', 'Close');
    close.addEventListener('click', () => this.handlers.onClose && this.handlers.onClose());
    this.panel.appendChild(close);
  }

  _renderPick({ creatures, preview, canConfirm }) {
    this.panel.appendChild(el('h2', '', '💕 Make an egg'));
    this.panel.appendChild(el('p', 'gq-breed-sub', 'Pick two friends. It costs nothing!'));
    const grid = el('div', 'gq-breed-grid');
    for (const c of creatures) {
      const tile = el('button', `gq-breed-tile${c.selected ? ' gq-breed-selected' : ''}`);
      tile.setAttribute('aria-pressed', c.selected ? 'true' : 'false');
      const dot = el('span', 'gq-breed-dot');
      dot.style.background = c.color;
      tile.append(dot, el('strong', '', c.name), el('small', '', `${c.elementLabel} · ${c.rarity}`));
      tile.addEventListener('click', () => this.handlers.onPickParent && this.handlers.onPickParent(c.id));
      grid.appendChild(tile);
    }
    this.panel.appendChild(grid);
    if (preview) this.panel.appendChild(this._odds(preview));
    const go = el('button', `gq-btn gq-btn-gold gq-breed-go${canConfirm ? '' : ' gq-btn-disabled'}`, 'Make the egg!');
    go.disabled = !canConfirm;
    go.addEventListener('click', () => canConfirm && this.handlers.onConfirm && this.handlers.onConfirm());
    this.panel.appendChild(go);
  }

  _odds({ element, rarity, outcomes }) {
    const box = el('div', 'gq-breed-odds');
    box.appendChild(el('strong', '', 'What could hatch?'));
    const traits = el('p', 'gq-breed-traits');
    traits.append(`Element: ${element.map((o) => `${o.label} ${pct(o.percent)}`).join(' · ')}`, el('br'),
      `Rarity: ${rarity.map((o) => `${o.label} ${pct(o.percent)}`).join(' · ')}`);
    box.appendChild(traits);
    for (const o of outcomes) {
      const row = el('div', 'gq-breed-outcome');
      const dot = el('span', 'gq-breed-dot');
      dot.style.background = o.color;
      const bar = el('span', 'gq-breed-bar');
      const fill = el('span', 'gq-breed-fill');
      fill.style.width = `${o.percent}%`;
      bar.appendChild(fill);
      row.append(dot, el('span', 'gq-breed-name', `${o.name} (${o.elementLabel}, ${o.rarity})`), bar,
        el('b', '', pct(o.percent)));
      box.appendChild(row);
    }
    return box;
  }

  _renderNest({ eggLabel, progress, ready, help, hint }) {
    this.panel.appendChild(el('h2', '', '💕 Your egg'));
    this.panel.appendChild(el('p', 'gq-breed-sub', ready
      ? `Your ${eggLabel.toLowerCase()} is ready! Tap it on the farm.`
      : `Your ${eggLabel.toLowerCase()} is growing warm and cozy.`));
    const bar = el('div', 'gq-breed-progress');
    const fill = el('span', 'gq-breed-progress-fill');
    fill.style.width = `${Math.round(progress * 100)}%`;
    bar.appendChild(fill);
    this.panel.appendChild(bar);
    if (!help) return;
    const box = el('div', 'gq-breed-help');
    box.appendChild(el('strong', '', 'Want to help it along?'));
    box.appendChild(el('p', '', help.prompt));
    help.choices.forEach((choice, i) => {
      const button = el('button', 'gq-btn', choice);
      button.addEventListener('click', () => this.handlers.onAnswer && this.handlers.onAnswer(i));
      box.appendChild(button);
    });
    if (hint) box.appendChild(el('p', 'gq-breed-hint', `Hint: ${hint} Try again!`));
    this.panel.appendChild(box);
  }
}
