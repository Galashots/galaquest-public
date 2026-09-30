// The help-along dialog: one learning question that can shorten the nest
// egg's hatch timer. A wrong answer shows the hint and allows a free retry;
// there is no fail state, no score, and no visible counter (lane contract).

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class HelpDialog {
  constructor(root, { onAnswer, onClose } = {}) {
    this.onAnswer = onAnswer;
    this.onClose = onClose;
    this.question = null;

    this.backdrop = el('div', 'gq-modal-backdrop');
    this.backdrop.style.display = 'none';
    this.backdrop.style.position = 'absolute';

    this.panel = el('div', 'gq-panel');
    this.backdrop.appendChild(this.panel);

    const head = el('div', 'gq-breed-head');
    head.appendChild(el('h2', null, 'Help the egg hatch sooner!'));
    this.closeBtn = el('button', 'gq-panel-close', '✕');
    this.closeBtn.setAttribute('aria-label', 'Close help');
    this.closeBtn.addEventListener('click', () => this.close());
    head.appendChild(this.closeBtn);
    this.panel.appendChild(head);

    this.prompt = el('p', 'gq-help-prompt');
    this.panel.appendChild(this.prompt);

    this.choices = el('div', 'gq-help-choices');
    this.panel.appendChild(this.choices);

    this.hint = el('p', 'gq-help-hint');
    this.hint.style.display = 'none';
    this.panel.appendChild(this.hint);

    root.appendChild(this.backdrop);
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
  }

  get isOpen() { return this.backdrop.style.display !== 'none'; }

  /** @param question {id, prompt, choices[]} from content.QUESTIONS */
  open(question) {
    this.question = question;
    this.prompt.textContent = question.prompt;
    this.hint.style.display = 'none';
    this.choices.innerHTML = '';
    question.choices.forEach((choice, i) => {
      const btn = el('button', 'gq-btn', choice);
      btn.style.width = '100%';
      btn.addEventListener('click', () => this.onAnswer && this.onAnswer(question.id, i));
      this.choices.appendChild(btn);
    });
    this.backdrop.style.display = 'flex';
  }

  /** Show the hint after a wrong answer; the choices stay open for retry. */
  showHint(hint) {
    this.hint.textContent = 'Try again! Hint: ' + hint;
    this.hint.style.display = 'block';
  }

  close() {
    this.backdrop.style.display = 'none';
    if (this.onClose) this.onClose();
  }
}
