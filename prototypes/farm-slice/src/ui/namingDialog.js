// The naming dialog for a freshly hatched creature. No question gate, no
// wrong answer: pick a suggestion or type your own (capped at 12 chars).

const SUGGESTIONS = ['Sprout', 'Buddy', 'Sunny', 'Pip', 'Ember', 'Star'];

export class NamingDialog {
  constructor(root, { onSubmit } = {}) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'gq-modal-backdrop';
    this.backdrop.style.display = 'none';
    this.backdrop.style.position = 'absolute';

    this.panel = document.createElement('div');
    this.panel.className = 'gq-panel';
    this.backdrop.appendChild(this.panel);

    this.title = document.createElement('h2');
    this.title.textContent = 'Name your creature!';
    this.panel.appendChild(this.title);

    this.input = document.createElement('input');
    this.input.className = 'gq-name-input';
    this.input.maxLength = 12;
    this.input.style.display = 'none';
    this.input.setAttribute('placeholder', 'Type a name...');
    this.panel.appendChild(this.input);

    this.suggestionsEl = document.createElement('div');
    this.suggestionsEl.className = 'gq-name-suggestions';
    SUGGESTIONS.forEach((name) => {
      const chip = document.createElement('button');
      chip.className = 'gq-name-chip';
      chip.textContent = name;
      chip.addEventListener('click', () => onSubmit && onSubmit(name));
      this.suggestionsEl.appendChild(chip);
    });
    this.panel.appendChild(this.suggestionsEl);

    this.typeBtn = document.createElement('button');
    this.typeBtn.className = 'gq-btn gq-btn-back';
    this.typeBtn.textContent = 'Type my own';
    this.typeBtn.addEventListener('click', () => { this.input.style.display = 'block'; this.submitBtn.style.display = 'block'; this.typeBtn.style.display = 'none'; this.input.focus(); });
    this.panel.appendChild(this.typeBtn);

    this.submitBtn = document.createElement('button');
    this.submitBtn.className = 'gq-btn';
    this.submitBtn.style.width = '100%';
    this.submitBtn.style.display = 'none';
    this.submitBtn.textContent = "That's the name!";
    this.submitBtn.addEventListener('click', () => {
      const name = this.input.value.trim();
      onSubmit && onSubmit(name);
    });
    this.panel.appendChild(this.submitBtn);

    root.appendChild(this.backdrop);
  }

  open(defaultName) {
    this._defaultName = defaultName;
    this.input.value = '';
    this.input.style.display = 'none';
    this.submitBtn.style.display = 'none';
    this.typeBtn.style.display = 'block';
    this.backdrop.style.display = 'flex';
  }

  close() {
    this.backdrop.style.display = 'none';
  }
}
