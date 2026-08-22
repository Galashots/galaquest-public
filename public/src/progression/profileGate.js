// "Who is playing?" -- the family profile gate.
//
// The product rule behind it (Director correction 4, and the settled *shared adventure, personal
// progression* doctrine) is that a tablet is shared and a child's progress is not. Everything under
// progression/ already keeps two siblings' saves apart; this is the surface through which a child
// says which one is theirs, and until it existed the answer was decided silently by whichever
// profile localStorage happened to hold.
//
// Written for a child who cannot reliably read. That is not a slogan, it is the constraint that
// picked every decision here:
//
//   - Heroes are big tappable cards with a NAME, not a list with a radio button. A name a child
//     chose is the one thing on this screen they are certain to recognise.
//   - Every card carries a plain-language badge of how far that hero has got, because two siblings
//     called "Sam" and "Sam2" are otherwise indistinguishable to the child who has to pick.
//   - Nothing destructive is one tap from the front. Deleting a hero is behind an explicit confirm,
//     because the failure it prevents -- a five-year-old erasing their brother's save -- is the one
//     failure on this screen that cannot be undone.
//   - No jargon. The profile ID is never shown; it is a 38-character machine string and it means
//     nothing to anyone who would be looking at this.
//
// The name and the id are deliberately different things, and this file is where a player can see
// that they are: renaming a hero must never orphan the save (progression/profiles.js's renameProfile
// keeps the id fixed), and two brothers will absolutely pick the same name.
//
// Pure half / DOM half, the same split progression/heroScreen.js and village/boardScreen.js already
// use: profileGateViewModel is testable under bare `node --test`, createProfileGate is the binding
// and is proved in a browser.

import { DEFAULT_DISPLAY_NAME, MAX_PROFILES, sanitizeDisplayName } from './profiles.js';

/** Plain language for how far a hero has got. Not a number in a corner: this is the line a child
 *  uses to tell their own hero from their sibling's, so it says what happened rather than what was
 *  counted. Ordered most-significant first -- the lantern is the opening's whole payoff, so once it
 *  is lit that is what the card says. */
export function progressBadgeFor({ marks = 0, lanternUnlocked = false } = {}) {
  if (lanternUnlocked) return 'Lantern lit';
  if (marks <= 0) return 'Just starting';
  return marks === 1 ? '1 Lantern Mark' : `${marks} Lantern Marks`;
}

/**
 * Pure. Everything the gate needs to paint itself.
 *
 * @param options.heroes  [{ id, displayName, marks, lanternUnlocked }] -- already folded by the
 *   caller, because deriving a profile's state means reading storage and this half touches none.
 * @param options.activeProfileId  which card reads as the current hero.
 * @param options.namingFirstHero  true on a device whose one hero has never been named, which turns
 *   the screen from a chooser into a single question. A child opening the game for the first time
 *   should be asked their hero's name, not shown a list of one.
 */
export function profileGateViewModel({
  heroes = [],
  activeProfileId = null,
  namingFirstHero = false,
  maxProfiles = MAX_PROFILES,
} = {}) {
  const cards = heroes.map((hero) => ({
    id: hero.id,
    name: sanitizeDisplayName(hero.displayName),
    active: hero.id === activeProfileId,
    badge: progressBadgeFor(hero),
  }));

  if (namingFirstHero) {
    return {
      mode: 'naming',
      // A question, in words a child hears rather than reads. "Profile" appears nowhere.
      title: 'What is your hero called?',
      // The name they will get if they just tap GO, shown so the field is never empty and the
      // button is never a dead end -- progression/profiles.js makes the same choice in
      // sanitizeDisplayName, and this is that rule made visible.
      placeholder: DEFAULT_DISPLAY_NAME,
      confirmLabel: 'START',
      // NO CARDS. The first draft passed `cards` here on the reasoning that there is exactly one and
      // showing it is harmless. Looking at the capture said otherwise: the screen asking a child
      // what to call their hero also offered a Remove button for the only hero they have. A list of
      // one is not a choice, and a destructive control has no business on a question with one
      // answer. Every check passed; the picture is what caught it.
      heroes: [],
      // Which profile the typed name belongs to, since there is no card to carry it.
      namingProfileId: cards.find((card) => card.active)?.id ?? cards[0]?.id ?? null,
      canCreate: false,
      createLabel: null,
      fullNotice: null,
    };
  }

  const full = cards.length >= maxProfiles;
  return {
    mode: 'choosing',
    title: 'Who is playing?',
    placeholder: DEFAULT_DISPLAY_NAME,
    confirmLabel: 'START',
    heroes: cards,
    namingProfileId: null,
    canCreate: !full,
    createLabel: 'New hero',
    // Said plainly and only when it applies. A disabled button with no explanation is the single
    // most confusing thing a screen like this can do to a child.
    fullNotice: full ? `This tablet holds ${maxProfiles} heroes. Remove one to add another.` : null,
  };
}

/**
 * The DOM half.
 *
 * Cards are BUILT rather than bound to fixed markup, unlike the Village Board's fixed node row: the
 * number of heroes genuinely varies from one to four, and markup for four with three hidden is a
 * shape that lies about what is on screen.
 *
 * @param options.onSelect(profileId)   an existing hero was chosen.
 * @param options.onCreate(displayName) a new hero was named.
 * @param options.onRename(profileId, displayName)  the active hero was renamed.
 * @param options.onDelete(profileId)   a hero was removed, already confirmed.
 * @param options.onOpenChange(open)    fires after the shown state actually changes, the same
 *   contract createHeroScreen and createVillageBoardScreen already have, so main.js gates input
 *   through one path for all three overlays.
 */
export function createProfileGate(options = {}) {
  const root = options.root ?? document;
  const onSelect = options.onSelect ?? (() => {});
  const onCreate = options.onCreate ?? (() => {});
  const onRename = options.onRename ?? (() => {});
  const onDelete = options.onDelete ?? (() => {});
  const onOpenChange = options.onOpenChange ?? (() => {});

  const screen = root.querySelector('#profile-gate');
  const titleEl = root.querySelector('#profile-gate-title');
  const listEl = root.querySelector('#profile-gate-list');
  const nameRow = root.querySelector('#profile-gate-name-row');
  const nameInput = root.querySelector('#profile-gate-name');
  const confirmButton = root.querySelector('#profile-gate-confirm');
  const noticeEl = root.querySelector('#profile-gate-notice');
  const closeButton = root.querySelector('#profile-gate-close');

  let shown = false;
  let lastView = null;
  // Which card is asking "are you sure?" right now. Held here rather than in the DOM because it must
  // be cleared by any other interaction: a confirm left armed while a child taps elsewhere is a
  // delete waiting to happen on a mis-tap.
  let confirmingDeleteId = null;

  function setShown(next) {
    if (shown === next) return;
    shown = next;
    screen.dataset.shown = String(shown);
    if (!shown) confirmingDeleteId = null;
    onOpenChange(shown);
  }

  function makeButton(className, label) {
    const button = root.ownerDocument?.createElement?.('button')
      ?? document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    return button;
  }

  function renderCards(view) {
    listEl.replaceChildren();

    for (const hero of view.heroes) {
      const card = document.createElement('div');
      card.className = 'profile-card';
      card.dataset.profileId = hero.id;
      card.dataset.active = String(hero.active);

      // The whole card is the tap target, not a small button inside it.
      const choose = makeButton('profile-card-choose', '');
      choose.dataset.profileId = hero.id;
      const nameSpan = document.createElement('span');
      nameSpan.className = 'profile-card-name';
      nameSpan.textContent = hero.name;
      const badgeSpan = document.createElement('span');
      badgeSpan.className = 'profile-card-badge';
      badgeSpan.textContent = hero.badge;
      choose.append(nameSpan, badgeSpan);
      choose.addEventListener('click', () => {
        confirmingDeleteId = null;
        onSelect(hero.id);
      });
      card.append(choose);

      const armed = confirmingDeleteId === hero.id;
      const remove = makeButton('profile-card-remove', armed ? 'Really remove?' : 'Remove');
      remove.dataset.armed = String(armed);
      remove.setAttribute('aria-label', armed ? `Confirm removing ${hero.name}` : `Remove ${hero.name}`);
      remove.addEventListener('click', () => {
        // Two taps, always, and the second one is labelled with what it does. The first tap only
        // arms; nothing is removed until the child reads a different word and taps again.
        if (confirmingDeleteId === hero.id) {
          confirmingDeleteId = null;
          onDelete(hero.id);
          return;
        }
        confirmingDeleteId = hero.id;
        render(lastView);
      });
      card.append(remove);

      listEl.append(card);
    }

    if (view.canCreate) {
      // Deliberately NOT also `.profile-card`. It looks like one and it is not one: anything asking
      // "how many heroes are on this tablet" queries that class, and a create button answering to it
      // makes the count wrong for every reader -- which is exactly how the browser harness first
      // read three heroes on a two-hero device. Shared look, separate identity.
      const add = makeButton('profile-card-add', view.createLabel);
      add.addEventListener('click', () => {
        confirmingDeleteId = null;
        nameRow.dataset.shown = 'true';
        nameInput.value = '';
        nameInput.focus();
        // The confirm button now means "make this new hero" rather than "rename the current one",
        // and the DOM says so rather than the handler remembering it.
        confirmButton.dataset.intent = 'create';
      });
      listEl.append(add);
    }
  }

  function render(view) {
    if (!view) return;
    lastView = view;
    titleEl.textContent = view.title;
    nameInput.placeholder = view.placeholder;
    confirmButton.textContent = view.confirmLabel;
    noticeEl.textContent = view.fullNotice ?? '';
    noticeEl.dataset.shown = String(Boolean(view.fullNotice));
    // Naming the very first hero is the whole screen; there is no list to choose from and no way
    // out of it, because a child who dismisses it has no hero at all.
    nameRow.dataset.shown = String(view.mode === 'naming');
    confirmButton.dataset.intent = view.mode === 'naming' ? 'name-first' : 'create';
    closeButton.dataset.shown = String(view.mode !== 'naming');
    renderCards(view);
  }

  confirmButton?.addEventListener('click', () => {
    const typed = nameInput.value;
    if (confirmButton.dataset.intent === 'name-first') {
      // Read off the view rather than off a card, because the naming screen deliberately has none.
      if (lastView?.namingProfileId) onRename(lastView.namingProfileId, typed);
      return;
    }
    onCreate(typed);
  });

  // Enter is a real affordance on a tablet with a keyboard and on every desktop, and a child who
  // has just typed a name will press it before they look for a button.
  nameInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') confirmButton.click();
  });

  closeButton?.addEventListener('click', () => setShown(false));

  return {
    render,
    open: () => setShown(true),
    close: () => setShown(false),
    isOpen: () => shown,
  };
}
