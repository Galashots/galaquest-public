// The always-visible HUD: goal chip, bouncing arrow/ring, coin + basket
// pills, mute toggle, and the collection-book button. Pure DOM, no canvas.

export class Hud {
  constructor(root) {
    this.root = root;
    this.overlay = document.createElement('div');
    this.overlay.className = 'gq-overlay';
    root.appendChild(this.overlay);

    this.chip = document.createElement('div');
    this.chip.className = 'gq-goal-chip';
    this.chip.textContent = 'Plant a seed';
    this.overlay.appendChild(this.chip);

    this.arrow = document.createElement('div');
    this.arrow.className = 'gq-arrow';
    this.arrow.innerHTML = arrowSvg();
    this.arrow.style.display = 'none';
    this.overlay.appendChild(this.arrow);

    this.ring = document.createElement('div');
    this.ring.className = 'gq-ring';
    this.ring.style.display = 'none';
    this.overlay.appendChild(this.ring);
    this.progressRings = [];
    for (let i = 0; i < 3; i++) {
      const ring = document.createElement('div');
      ring.className = 'gq-progress-ring';
      ring.style.display = 'none';
      this.overlay.appendChild(ring);
      this.progressRings.push(ring);
    }

    this.hudCluster = document.createElement('div');
    this.hudCluster.className = 'gq-hud-cluster';
    this.overlay.appendChild(this.hudCluster);

    this.coinPill = document.createElement('div');
    this.coinPill.className = 'gq-pill';
    this.coinPill.innerHTML = '<span class="gq-icon">🪙</span><span class="gq-coin-count">0</span>';
    this.hudCluster.appendChild(this.coinPill);

    this.basketPill = document.createElement('div');
    this.basketPill.className = 'gq-pill';
    this.basketPill.innerHTML = '<span class="gq-icon">\u{1F9FA}</span><span class="gq-basket-count">0</span>';
    this.hudCluster.appendChild(this.basketPill);

    this.muteBtn = document.createElement('button');
    this.muteBtn.className = 'gq-round-btn';
    this.muteBtn.setAttribute('aria-label', 'Mute sound');
    this.muteBtn.textContent = '\u{1F50A}';
    this.hudCluster.appendChild(this.muteBtn);

    this.gearBtn = document.createElement('button');
    this.gearBtn.className = 'gq-round-btn';
    this.gearBtn.textContent = '⚙';
    this.gearBtn.setAttribute('aria-label', 'Hold for grown-up settings');
    this.hudCluster.appendChild(this.gearBtn);

    this.bookBtn = document.createElement('button');
    this.bookBtn.className = 'gq-book-btn';
    this.bookBtn.setAttribute('aria-label', 'Open collection book');
    this.bookBtn.textContent = '\u{1F4D6}';
    this.overlay.appendChild(this.bookBtn);

    this.feedBtn = document.createElement('button');
    this.feedBtn.className = 'gq-feed-btn';
    this.feedBtn.textContent = '☀️ Feed Sprout';
    this.feedBtn.style.display = 'none';
    this.overlay.appendChild(this.feedBtn);
    this.feedMeter = document.createElement('div');
    this.feedMeter.className = 'gq-feed-meter';
    this.feedMeter.style.display = 'none';
    this.overlay.appendChild(this.feedMeter);

    this.toast = document.createElement('div');
    this.toast.className = 'gq-toast';
    this.overlay.appendChild(this.toast);

    this._toastTimer = null;
  }

  onGearHold(cb) {
    let timer;
    this.gearBtn.addEventListener('pointerdown', () => { timer = setTimeout(cb, 2000); });
    for (const event of ['pointerup', 'pointercancel', 'pointerleave']) this.gearBtn.addEventListener(event, () => clearTimeout(timer));
  }
  onMuteToggle(cb) { this.muteBtn.addEventListener('click', cb); }
  onBookOpen(cb) { this.bookBtn.addEventListener('click', cb); }
  onFeed(cb) { this.feedBtn.addEventListener('click', cb); }
  setFeedVisible(on) { this.feedBtn.style.display = on ? 'block' : 'none'; }
  setFeedMeter(fed, visible) { this.feedMeter.style.display = visible ? 'block' : 'none'; this.feedMeter.textContent = `☀️ Sprout ${Math.min(fed, 3)}/3`; }

  setGoalText(text) {
    if (this.chip.textContent === text) return;
    this.chip.textContent = text;
    this.chip.classList.remove('gq-pulse');
    // eslint-disable-next-line no-unused-expressions
    void this.chip.offsetWidth; // restart animation
    this.chip.classList.add('gq-pulse');
  }

  /** pos is {x,y} in CSS pixels, or null to hide the arrow entirely. */
  setArrowTarget(pos) {
    if (!pos) {
      this.arrow.style.display = 'none';
      this.ring.style.display = 'none';
      return;
    }
    this.arrow.style.display = 'block';
    this.ring.style.display = 'block';
    this.arrow.style.left = `${pos.x}px`;
    this.arrow.style.top = `${pos.y}px`;
    this.ring.style.left = `${pos.x}px`;
    this.ring.style.top = `${pos.y + 40}px`;
  }

  setProgressRings(items) {
    this.progressRings.forEach((ring, i) => {
      const item = items[i];
      ring.style.display = item ? 'block' : 'none';
      if (item) { ring.style.left = `${item.x}px`; ring.style.top = `${item.y}px`; ring.style.setProperty('--progress', `${Math.round(item.progress * 100)}%`); }
    });
  }

  setCoins(n) {
    this.coinPill.querySelector('.gq-coin-count').textContent = String(n);
  }

  setBasketCount(n) {
    this.basketPill.querySelector('.gq-basket-count').textContent = String(n);
  }

  setMuted(muted) {
    this.muteBtn.textContent = muted ? '\u{1F507}' : '\u{1F50A}';
  }

  setBookAttract(on) {
    this.bookBtn.classList.toggle('gq-attract', !!on);
  }

  showToast(text, duration = 1400) {
    this.toast.textContent = text;
    this.toast.classList.add('gq-show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toast.classList.remove('gq-show'), duration);
  }
}

function arrowSvg() {
  return `<svg viewBox="0 0 56 56" width="56" height="56">
    <path d="M28 2 L52 40 L28 30 L4 40 Z" fill="#ffca28" stroke="#7a4a12" stroke-width="3" stroke-linejoin="round"/>
  </svg>`;
}
