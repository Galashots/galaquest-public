// Transient seed choice. Each plot still needs its own tap.
export class SeedTray {
  constructor(root, onChoose) {
    this.el = document.createElement('div');
    this.el.className = 'gq-seed-tray';
    this.el.hidden = true;
    this.onChoose = onChoose;
    root.appendChild(this.el);
  }

  render(remaining, selected, repeat = false) {
    this.el.hidden = !remaining.length;
    this.el.replaceChildren();
    if (!remaining.length) return;
    const caption = document.createElement('div');
    caption.textContent = repeat ? 'Free seeds · tap each empty hole' : 'Seed tray · tap each empty hole';
    this.el.appendChild(caption);
    for (const cropId of [...new Set(remaining)]) {
      const count = remaining.filter((id) => id === cropId).length;
      const button = document.createElement('button');
      button.className = 'gq-seed-choice' + (cropId === selected ? ' gq-seed-selected' : '');
      button.textContent = cropId === 'sunberry' ? `✦ Star seed ×${count}` : `🥕 Carrot seed ×${count}`;
      button.addEventListener('click', () => this.onChoose(cropId));
      this.el.appendChild(button);
    }
  }

  getTargetRect() { return this.el.getBoundingClientRect(); }
}
