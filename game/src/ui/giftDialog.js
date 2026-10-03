// Pip's gift dialog (CONTRACT.md section 5 item 2): announces the earned gift
// -- a plantable star seed plus the visible Leaf egg. Announcement-only; the
// grant already happened in the rules layer, so this never touches game state
// beyond reporting the Take tap. No choice, no odds, no expiry.
export class GiftDialog {
  constructor(root, { onTake } = {}) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'gq-modal-backdrop';
    this.backdrop.style.display = 'none';
    this.backdrop.style.position = 'absolute';

    this.panel = document.createElement('div');
    this.panel.className = 'gq-panel';
    this.backdrop.appendChild(this.panel);

    this.title = document.createElement('h2');
    this.title.textContent = "Pip's gift!";
    this.panel.appendChild(this.title);

    this.body = document.createElement('p');
    this.body.className = 'gq-gift-text';
    this.panel.appendChild(this.body);

    this.takeBtn = document.createElement('button');
    this.takeBtn.className = 'gq-btn gq-btn-gold';
    this.takeBtn.textContent = 'Take the gift';
    this.takeBtn.addEventListener('click', () => onTake && onTake());
    this.panel.appendChild(this.takeBtn);

    root.appendChild(this.backdrop);
  }

  get isOpen() { return this.backdrop.style.display !== 'none'; }

  /** reward: a content.REWARDS entry; `title` heads the dialog and optional `text` is the message. */
  open(reward) {
    this.title.textContent = reward?.title || "Pip's gift!";
    this.body.textContent = reward?.text || '';
    this.backdrop.style.display = 'flex';
  }

  close() { this.backdrop.style.display = 'none'; }
}
