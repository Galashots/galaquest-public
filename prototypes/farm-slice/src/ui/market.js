// The market panel: pick a deal, fill it by tapping basket crops into
// slots (a Fill button also lets the older band skip straight to it), then
// buy the helmet. Pure DOM. Takes a ready-made view model from main.js
// (which owns reading game state) so this module never has to know about
// rules -- fill progress here is transient UI state only, never persisted
// (CONTRACT.md: "Partial fills and coin taps: UI-only").

export class MarketPanel {
  constructor(root, { onFulfillOffer, onBuyArmor, onClose, onSlotFill, onCoinTap } = {}) {
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
    closeBtn.setAttribute('aria-label', 'Close market');
    closeBtn.addEventListener('click', () => onClose && onClose());
    this.panel.appendChild(closeBtn);

    this.titleEl = document.createElement('h2');
    this.titleEl.textContent = "Pip's Market";
    this.panel.appendChild(this.titleEl);

    this.npcLine = document.createElement('div');
    this.npcLine.className = 'gq-npc-line';
    this.panel.appendChild(this.npcLine);

    this.bodyEl = document.createElement('div');
    this.panel.appendChild(this.bodyEl);

    this.armorRow = document.createElement('div');
    this.armorRow.className = 'gq-armor-row';
    this.armorRow.style.display = 'none';
    this.panel.insertBefore(this.armorRow, this.bodyEl);

    root.appendChild(this.backdrop);
    this._onFulfillOffer = onFulfillOffer;
    this._onSlotFill = onSlotFill;
    this._onCoinTap = onCoinTap;
    this._onBuyArmor = onBuyArmor;
    this.selectedOfferId = null;
    this._fill = {}; // { [cropId]: count } for the selected offer, local-only
    this._lastViewModel = null;
    this.armorBuyBtn = null;
    this._commitToken = 0;

    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) onClose && onClose();
    });
  }

  get isOpen() { return this.backdrop.style.display !== 'none'; }

  open() { this.backdrop.style.display = 'flex'; }

  close() {
    this.backdrop.style.display = 'none';
    this.selectedOfferId = null;
    this._fill = {};
    this._coinTaps = 0;
    this._committing = false;
    this._commitToken++;
  }

  /** A brief, silent visual nudge -- CONTRACT.md: no fail sounds, ever, just a gentle pulse on the right target. */
  pulse(el) {
    if (!el) return;
    el.classList.remove('gq-pulse');
    // eslint-disable-next-line no-unused-expressions
    void el.offsetWidth;
    el.classList.add('gq-pulse');
  }

  /**
   * @param {{npcGreeting:string, band:string|null,
   *   offers: Array<{id:string, text:string, wants:Object, coins:number,
   *     canFulfill:boolean, haveByCrop:Object, cropNames:Object,
   *     perCropRate:number, keepByCrop:Object}>,
   *   armor: {id:string,name:string,price:number,canAfford:boolean}|null}} viewModel
   */
  render(viewModel) {
    this._lastViewModel = viewModel;
    this.npcLine.textContent = viewModel.npcGreeting || '';

    if (this.selectedOfferId) {
      const offer = viewModel.offers.find((o) => o.id === this.selectedOfferId);
      if (!offer) { this.selectedOfferId = null; } else {
        this._renderFillView(viewModel, offer);
        this._renderArmorRow(viewModel);
        return;
      }
    }
    this._renderCardList(viewModel);
    this._renderArmorRow(viewModel);
  }

  _renderCardList(viewModel) {
    this.bodyEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'gq-offers';
    this.offerCards = [];
    viewModel.offers.forEach((offer) => {
      const card = document.createElement('div');
      card.className = 'gq-offer-card';

      const text = document.createElement('p');
      text.textContent = viewModel.band === 'older'
        ? `${offer.text} · You keep ${Object.entries(offer.keepByCrop).map(([id, qty]) => `${qty} ${offer.cropNames[id]}`).join(', ')}`
        : `${Object.entries(offer.wants).map(([id, qty]) => `${'🥕'.repeat(id === 'carrot' ? qty : 0)}${'☀️'.repeat(id === 'sunberry' ? qty : 0)}`).join(' + ')} → ${offer.coins / 2} two-coins`;
      card.appendChild(text);

      const btn = document.createElement('button');
      btn.className = 'gq-btn';
      btn.textContent = offer.paused ? 'More deals after Sprout’s snack' : 'Choose this deal';
      btn.disabled = !!offer.paused;
      if (offer.paused) btn.classList.add('gq-btn-disabled');
      btn.addEventListener('click', () => {
        this.selectedOfferId = offer.id;
        this._fill = {};
        this.render(this._lastViewModel);
      });
      card.appendChild(btn);
      if (Object.entries(offer.wants).some(([id, qty]) => (offer.haveByCrop[id] || 0) < qty)) {
        const need = document.createElement('small');
        need.textContent = Object.entries(offer.wants).filter(([id, qty]) => (offer.haveByCrop[id] || 0) < qty)
          .map(([id, qty]) => `Needs ${qty - (offer.haveByCrop[id] || 0)} more ${offer.cropNames[id]}`).join(', ');
        card.appendChild(need);
      }

      wrap.appendChild(card);
      this.offerCards.push(card);
    });
    this.bodyEl.appendChild(wrap);
  }

  _renderFillView(viewModel, offer) {
    this.bodyEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'gq-fill-view';

    const backBtn = document.createElement('button');
    backBtn.className = 'gq-btn gq-btn-back';
    backBtn.textContent = '← Back';
    backBtn.addEventListener('click', () => {
      this.selectedOfferId = null;
      this._fill = {};
      this.render(this._lastViewModel);
    });
    wrap.appendChild(backBtn);
    this.backBtn = backBtn;

    const text = document.createElement('p');
    text.className = 'gq-fill-text';
    text.textContent = offer.text;
    wrap.appendChild(text);

    if (viewModel.band === 'older') {
      const rate = document.createElement('p');
      rate.className = 'gq-fill-hint';
      const totalWanted = Object.values(offer.wants).reduce((a, b) => a + b, 0);
      rate.textContent = `${offer.coins} ÷ ${totalWanted} = ${offer.perCropRate} coins per crop`;
      wrap.appendChild(rate);

      const keepBits = Object.entries(offer.keepByCrop)
        .map(([cropId, qty]) => `${qty} ${offer.cropNames[cropId] || cropId}`)
        .join(', ');
      const keep = document.createElement('p');
      keep.className = 'gq-fill-hint';
      const keptValue = Object.entries(offer.keepByCrop).reduce((sum, [id, qty]) => sum + qty * (id === 'sunberry' ? 5 : 2), 0);
      keep.textContent = `You'd keep: ${keepBits || 'nothing'} · ${keptValue} coin value · ${offer.coins + keptValue} total`;
      wrap.appendChild(keep);
    }

    const scale = document.createElement('div');
    scale.className = 'gq-scale';
    const filledCount = Object.values(this._fill).reduce((a, b) => a + b, 0);
    const wantedCount = Object.values(offer.wants).reduce((a, b) => a + b, 0);
    scale.textContent = filledCount === wantedCount ? '⚖️ Level! Full crate!' : `⚖️ ${filledCount} in · ${wantedCount - filledCount} more`;
    scale.style.setProperty('--tilt', `${(wantedCount - filledCount) * -4}deg`);
    wrap.appendChild(scale);
    const slotsWrap = document.createElement('div');
    slotsWrap.className = 'gq-slots';
    let nextEmptySlotEl = null;

    Object.entries(offer.wants).forEach(([cropId, want]) => {
      const row = document.createElement('div');
      row.className = 'gq-slot-row';

      const label = document.createElement('div');
      label.className = 'gq-slot-label';
      label.textContent = offer.cropNames[cropId] || cropId;
      row.appendChild(label);

      const filled = Math.min(this._fill[cropId] || 0, want);
      const slotsEl = document.createElement('div');
      slotsEl.className = 'gq-slot-dots';
      for (let i = 0; i < want; i++) {
        const dot = document.createElement('div');
        dot.className = 'gq-slot-dot' + (i < filled ? ' gq-slot-filled' : '');
        slotsEl.appendChild(dot);
      }
      row.appendChild(slotsEl);

      const have = offer.haveByCrop[cropId] || 0;
      const tapBtn = document.createElement('button');
      tapBtn.className = 'gq-btn gq-slot-tap';
      const remaining = have - filled;
      const canTap = filled < want && remaining > 0;
      tapBtn.disabled = !canTap;
      if (!canTap) tapBtn.classList.add('gq-btn-disabled');
      tapBtn.textContent = `Add (${Math.max(0, remaining)} left)`;
      tapBtn.addEventListener('click', () => {
        if (!canTap) return;
        this._fill = { ...this._fill, [cropId]: filled + 1 };
        this._onSlotFill?.(cropId, filled + 1);
        if (!this._maybeAutoCommit(viewModel, offer)) this.render(this._lastViewModel);
      });
      row.appendChild(tapBtn);

      if (canTap && !nextEmptySlotEl) nextEmptySlotEl = tapBtn;
      slotsWrap.appendChild(row);
    });
    wrap.appendChild(slotsWrap);
    this._fillNextEmptySlotEl = nextEmptySlotEl;

    const basket = document.createElement('div');
    basket.className = 'gq-basket-items';
    const caption = document.createElement('strong');
    caption.textContent = 'Your basket · tap crops into the crate';
    basket.appendChild(caption);
    for (const cropId of ['carrot', 'sunberry']) {
      const have = offer.haveByCrop[cropId] || 0;
      if (!have) continue;
      const button = document.createElement('button');
      button.className = 'gq-basket-item' + (offer.wants[cropId] ? ' gq-basket-needed' : '');
      button.textContent = `${cropId === 'carrot' ? '🥕' : '☀️'} ${offer.cropNames[cropId]} ×${Math.max(0, have - (this._fill[cropId] || 0))}`;
      button.addEventListener('click', () => {
        const count = this._fill[cropId] || 0;
        if (!offer.wants[cropId] || count >= offer.wants[cropId] || have <= count) { this.pulse(this._fillNextEmptySlotEl); return; }
        this._fill = { ...this._fill, [cropId]: count + 1 };
        this._onSlotFill?.(cropId, count + 1);
        if (!this._maybeAutoCommit(viewModel, offer)) this.render(this._lastViewModel);
      });
      basket.appendChild(button);
    }
    wrap.appendChild(basket);

    if (viewModel.band === 'older') {
      const fillBtn = document.createElement('button');
      fillBtn.className = 'gq-btn gq-btn-gold';
      fillBtn.textContent = 'Fill!';
      const ready = offer.canFulfill && !this._committing &&
        !Object.entries(offer.wants).every(([id, qty]) => (this._fill[id] || 0) >= qty);
      if (!ready) fillBtn.classList.add('gq-btn-disabled');
      fillBtn.addEventListener('click', () => {
        if (!ready) { this.pulse(fillBtn); return; }
        this._onFulfillOffer && this._onFulfillOffer(offer.id);
      });
      wrap.appendChild(fillBtn);
      this.fillBtn = fillBtn;
    } else {
      this.fillBtn = null;
    }

    this.bodyEl.appendChild(wrap);
  }

  _maybeAutoCommit(viewModel, offer) {
    const allFull = Object.entries(offer.wants).every(([cropId, want]) => (this._fill[cropId] || 0) >= want);
    if (allFull && offer.canFulfill) {
      // Younger band (and older, if they filled it by hand) auto-commits the
      // moment every slot is full -- the scale "levels", no extra tap needed.
      if (this._committing) return true;
      this._committing = true;
      const token = this._commitToken;
      this.render(this._lastViewModel);
      setTimeout(() => {
        if (token !== this._commitToken) return;
        this._committing = false;
        if (this.isOpen) this._onFulfillOffer?.(offer.id);
      }, 350);
      return true;
    }
    return false;
  }

  _renderArmorRow(viewModel) {
    if (viewModel.armor) {
      this.armorRow.style.display = 'flex';
      this.armorRow.innerHTML = '';

      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'gq-armor-name';
      name.textContent = viewModel.armor.name;
      const price = document.createElement('div');
      price.className = 'gq-armor-price';
      price.textContent = `${viewModel.armor.price} coins`;
      info.appendChild(name);
      info.appendChild(price);
      this.armorRow.appendChild(info);

      const buyBtn = document.createElement('button');
      buyBtn.className = 'gq-btn gq-btn-gold' + (viewModel.armor.canAfford ? '' : ' gq-btn-disabled');
      buyBtn.textContent = viewModel.band === 'younger' ? 'Add a 2-coin' : 'Buy!';
      if (viewModel.band === 'younger') {
        const outlines = document.createElement('div');
        outlines.className = 'gq-coin-outlines';
        outlines.textContent = Array.from({length: 5}, (_, i) => i < (this._coinTaps || 0) ? '🪙' : '◯').join(' ');
        this.armorRow.appendChild(outlines);
      }
      buyBtn.addEventListener('click', () => {
        if (!viewModel.armor.canAfford) { this.pulse(buyBtn); return; }
        if (viewModel.band === 'younger') {
          this._coinTaps = (this._coinTaps || 0) + 1;
          this._onCoinTap?.(this._coinTaps * 2);
          if (this._coinTaps < 5) { this.render(this._lastViewModel); return; }
          this._coinTaps = 0;
        }
        this._onBuyArmor && this._onBuyArmor(viewModel.armor.id);
      });
      this.armorRow.appendChild(buyBtn);
      this.armorBuyBtn = buyBtn;
    } else {
      this.armorRow.style.display = 'none';
      this.armorBuyBtn = null;
    }
  }

  /**
   * A DOMRect for the goal arrow to point at while the market is open, so it
   * never has to disappear during a goal (CONTRACT.md section 5). Never
   * favours one offer card over the other -- no biased arrow (section 7).
   */
  getArrowTargetRect(step) {
    if (step === 'armor' && this.armorBuyBtn) {
      return this.armorBuyBtn.getBoundingClientRect();
    }
    if (this.selectedOfferId) {
      if (this._fillNextEmptySlotEl) return this._fillNextEmptySlotEl.getBoundingClientRect();
      if (this.fillBtn && !this.fillBtn.classList.contains('gq-btn-disabled')) {
        return this.fillBtn.getBoundingClientRect();
      }
      return this.backBtn.getBoundingClientRect();
    }
    if (step === 'offer' && this.offerCards?.length) return this.offerCards[Math.floor(Date.now() / 1400) % this.offerCards.length].getBoundingClientRect();
    return this.bodyEl.getBoundingClientRect();
  }
}
