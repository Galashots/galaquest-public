// The breeding dialog: pick two owned creatures, see the full outcome odds
// BEFORE choosing (the lane's preview contract -- never hidden odds), then
// confirm. Pure DOM; the caller supplies parent instances and callbacks.

import { previewBreeding } from '../depth/breeding.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function oddsText(options) {
  return options.map((o) => `${o.value} ${o.percent}%`).join(' · ');
}

export class BreedingDialog {
  constructor(root, { onBreed, onClose } = {}) {
    this.onBreed = onBreed;
    this.onClose = onClose;
    this.parents = [];
    this.selected = [];

    this.backdrop = el('div', 'gq-modal-backdrop');
    this.backdrop.style.display = 'none';
    this.backdrop.style.position = 'absolute';

    this.panel = el('div', 'gq-panel');
    this.backdrop.appendChild(this.panel);

    const head = el('div', 'gq-breed-head');
    this.title = el('h2', null, 'Breed two creatures!');
    head.appendChild(this.title);
    this.closeBtn = el('button', 'gq-panel-close', '✕');
    this.closeBtn.setAttribute('aria-label', 'Close breeding');
    this.closeBtn.addEventListener('click', () => this.close());
    head.appendChild(this.closeBtn);
    this.panel.appendChild(head);

    this.hint = el('p', 'gq-breed-hint', 'Pick two friends to make an egg.');
    this.panel.appendChild(this.hint);

    this.grid = el('div', 'gq-breed-grid');
    this.panel.appendChild(this.grid);

    this.preview = el('div', 'gq-breed-preview');
    this.preview.style.display = 'none';
    this.panel.appendChild(this.preview);

    this.breedBtn = el('button', 'gq-btn gq-btn-gold', 'Breed!');
    this.breedBtn.style.width = '100%';
    this.breedBtn.disabled = true;
    this.breedBtn.addEventListener('click', () => {
      if (this.selected.length === 2 && this.onBreed) {
        this.onBreed(this.selected[0], this.selected[1]);
      }
    });
    this.panel.appendChild(this.breedBtn);

    root.appendChild(this.backdrop);
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
  }

  get isOpen() { return this.backdrop.style.display !== 'none'; }

  /** @param parents Array<{id,name,element,shape,rarity,colors:{body,accent}}> */
  open(parents) {
    this.parents = parents || [];
    this.selected = [];
    this.render();
    this.backdrop.style.display = 'flex';
  }

  close() {
    this.backdrop.style.display = 'none';
    if (this.onClose) this.onClose();
  }

  toggle(id) {
    const i = this.selected.indexOf(id);
    if (i !== -1) this.selected.splice(i, 1);
    else if (this.selected.length < 2) this.selected.push(id);
    this.render();
  }

  render() {
    this.grid.innerHTML = '';
    for (const p of this.parents) {
      const chip = el('button', 'gq-breed-chip' + (this.selected.includes(p.id) ? ' gq-selected' : ''));
      const swatch = el('span', 'gq-breed-swatch');
      swatch.style.background = p.colors.body;
      chip.appendChild(swatch);
      chip.appendChild(el('span', null, p.name));
      chip.addEventListener('click', () => this.toggle(p.id));
      this.grid.appendChild(chip);
    }
    this.renderPreview();
    this.breedBtn.disabled = this.selected.length !== 2;
  }

  renderPreview() {
    if (this.selected.length !== 2) {
      this.preview.style.display = 'none';
      this.preview.innerHTML = '';
      return;
    }
    const a = this.parents.find((p) => p.id === this.selected[0]);
    const b = this.parents.find((p) => p.id === this.selected[1]);
    let odds;
    try {
      odds = previewBreeding(a, b);
    } catch (err) {
      this.preview.style.display = 'none';
      return;
    }
    this.preview.innerHTML = '';
    this.preview.style.display = 'block';
    this.preview.appendChild(el('div', 'gq-breed-preview-title',
      `Their egg could be... (${a.name} + ${b.name})`));
    const rows = [
      ['Element', oddsText(odds.element)],
      ['Shape', oddsText(odds.shape)],
      ['Rarity', oddsText(odds.rarity)],
    ];
    for (const [label, text] of rows) {
      const row = el('div', 'gq-breed-row');
      row.appendChild(el('span', 'gq-breed-label', label));
      row.appendChild(el('span', null, text));
      this.preview.appendChild(row);
    }
    const colorRows = [
      ['Body color', odds.bodyColor],
      ['Accent color', odds.accentColor],
    ];
    for (const [label, options] of colorRows) {
      const colorRow = el('div', 'gq-breed-row');
      colorRow.appendChild(el('span', 'gq-breed-label', label));
      const swatches = el('span', 'gq-breed-colors');
      for (const opt of options) {
        const s = el('span', 'gq-breed-swatch');
        s.style.background = opt.value;
        s.title = `${opt.value} ${opt.percent}%`;
        swatches.appendChild(s);
        swatches.appendChild(el('span', 'gq-breed-pct', `${opt.percent}%`));
      }
      colorRow.appendChild(swatches);
      this.preview.appendChild(colorRow);
    }
    this.preview.appendChild(el('div', 'gq-breed-note',
      'The egg shows its family before it hatches. No surprises!'));
  }
}
