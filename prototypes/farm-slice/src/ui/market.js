// The market panel: two offer cards + the armor buy button on the
// mannequin. Pure DOM. Takes a ready-made view model from main.js (which
// owns reading game state) so this module never has to know about rules.

export class MarketPanel {
  constructor(root, { onFulfillOffer, onBuyArmor, onClose } = {}) {
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

    const title = document.createElement('h2');
    title.textContent = "Pip's Market";
    this.panel.appendChild(title);

    this.npcLine = document.createElement('div');
    this.npcLine.className = 'gq-npc-line';
    this.panel.appendChild(this.npcLine);

    this.offersEl = document.createElement('div');
    this.offersEl.className = 'gq-offers';
    this.panel.appendChild(this.offersEl);

    this.armorRow = document.createElement('div');
    this.armorRow.className = 'gq-armor-row';
    this.armorRow.style.display = 'none';
    this.panel.appendChild(this.armorRow);

    root.appendChild(this.backdrop);
    this._onFulfillOffer = onFulfillOffer;
    this._onBuyArmor = onBuyArmor;

    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) onClose && onClose();
    });
  }

  get isOpen() { return this.backdrop.style.display !== 'none'; }

  open() { this.backdrop.style.display = 'flex'; }
  close() { this.backdrop.style.display = 'none'; }

  /**
   * @param {{npcGreeting:string, offers: Array<{id:string,text:string,coins:number,canFulfill:boolean}>,
   *          armor: {id:string,name:string,price:number,canAfford:boolean}|null}} viewModel
   */
  render(viewModel) {
    this.npcLine.textContent = viewModel.npcGreeting || '';

    this.offersEl.innerHTML = '';
    viewModel.offers.forEach((offer) => {
      const card = document.createElement('div');
      card.className = 'gq-offer-card';

      const text = document.createElement('p');
      text.textContent = offer.text;
      card.appendChild(text);

      const btn = document.createElement('button');
      btn.className = 'gq-btn' + (offer.canFulfill ? '' : ' gq-btn-disabled');
      btn.textContent = offer.canFulfill ? `Trade! (+${offer.coins} coins)` : 'Need more crops';
      btn.addEventListener('click', () => {
        if (!offer.canFulfill) return;
        this._onFulfillOffer && this._onFulfillOffer(offer.id);
      });
      card.appendChild(btn);

      this.offersEl.appendChild(card);
    });

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
      buyBtn.textContent = viewModel.armor.canAfford ? 'Buy!' : 'Need more coins';
      buyBtn.addEventListener('click', () => {
        if (!viewModel.armor.canAfford) return;
        this._onBuyArmor && this._onBuyArmor(viewModel.armor.id);
      });
      this.armorRow.appendChild(buyBtn);
    } else {
      this.armorRow.style.display = 'none';
    }
  }
}
