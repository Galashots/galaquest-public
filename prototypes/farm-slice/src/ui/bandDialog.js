// A one-time, grown-up-facing card (CONTRACT.md "Band"): picks which
// presentation style the market uses. The economy is identical either way --
// this only changes wording, never numbers or difficulty.

export class BandDialog {
  constructor(root, { onPick } = {}) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'gq-modal-backdrop';
    this.backdrop.style.display = 'none';
    this.backdrop.style.position = 'absolute';

    this.panel = document.createElement('div');
    this.panel.className = 'gq-panel';
    this.backdrop.appendChild(this.panel);

    const title = document.createElement('h2');
    title.textContent = 'For the grown-up';
    this.panel.appendChild(title);

    const sub = document.createElement('p');
    sub.style.textAlign = 'center';
    sub.style.marginTop = '0';
    sub.textContent = 'Pick how the market explains its deals. Same game either way.';
    this.panel.appendChild(sub);

    const choices = document.createElement('div');
    choices.className = 'gq-band-choices';

    const younger = document.createElement('button');
    younger.className = 'gq-band-btn';
    younger.textContent = 'Counting helper (ages 6–8)';
    younger.addEventListener('click', () => onPick && onPick('younger'));
    choices.appendChild(younger);

    const older = document.createElement('button');
    older.className = 'gq-band-btn';
    older.textContent = 'Deal helper (ages 9–11)';
    older.addEventListener('click', () => onPick && onPick('older'));
    choices.appendChild(older);

    this.panel.appendChild(choices);
    root.appendChild(this.backdrop);
  }

  open() { this.backdrop.style.display = 'flex'; }
  close() { this.backdrop.style.display = 'none'; }
}
