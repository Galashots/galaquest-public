// The collection book: filled entries for discovered creatures, silhouettes
// for the rest. Read-only view -- main.js supplies a ready view model.

export class CollectionBook {
  constructor(root, { onClose } = {}) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'gq-modal-backdrop';
    this.backdrop.style.display = 'none';
    this.backdrop.style.position = 'absolute';

    this.panel = document.createElement('div');
    this.panel.className = 'gq-panel';
    this.panel.style.position = 'relative';
    this.backdrop.appendChild(this.panel);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'gq-panel-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => onClose && onClose());
    this.panel.appendChild(closeBtn);

    this.title = document.createElement('h2');
    this.panel.appendChild(this.title);

    this.grid = document.createElement('div');
    this.grid.className = 'gq-book-grid';
    this.panel.appendChild(this.grid);

    root.appendChild(this.backdrop);
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) onClose && onClose();
    });
  }

  open() { this.backdrop.style.display = 'flex'; }
  close() { this.backdrop.style.display = 'none'; }

  /** @param {{foundCount:number, total:number, entries: Array<{id,name,color,discovered}>}} viewModel */
  render(viewModel) {
    this.title.textContent = `Your Book (${viewModel.foundCount} of ${viewModel.total} found)`;
    this.grid.innerHTML = '';
    viewModel.entries.forEach((entry) => {
      const card = document.createElement('div');
      card.className = 'gq-book-entry' + (entry.discovered ? '' : ' gq-silhouette');

      const swatch = document.createElement('div');
      swatch.className = 'gq-book-swatch';
      if (entry.discovered) swatch.style.background = entry.color;
      card.appendChild(swatch);

      const name = document.createElement('div');
      name.className = 'gq-book-name';
      name.textContent = entry.discovered ? entry.name : '?';
      card.appendChild(name);

      this.grid.appendChild(card);
    });
  }
}
