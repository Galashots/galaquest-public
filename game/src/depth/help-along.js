// Targets are caller-owned JSON: {id, kind:'egg'|'crop', rarity, ordinal?, startedAt, readyAt}.
// Only explicit rare targets qualify. A missing egg ordinal is ineligible.
const DAY_MS = 86400000;
const DAILY_SOFT_CAP = 3;
const MAX_SHORTEN_MS = 5 * 60000;

function observeHelpState(state, now) {
  if (!Number.isSafeInteger(now)) throw new Error('Invalid timestamp');
  const observedAt = Math.max(now, state.lastObservedAt ?? now);
  const dayIndex = Math.floor(observedAt / DAY_MS);
  return { dayIndex, usedToday: state.dayIndex === dayIndex ? (state.usedToday ?? 0) : 0,
    lastObservedAt: observedAt, answered: { ...(state.answered ?? {}) } };
}

export function getHelpOffer({ target, state = {}, grade, questions, now }) {
  const nextState = observeHelpState(state, now);
  const eligible = target && (target.kind === 'egg' || target.kind === 'crop') &&
    (target.rarity === 'rare' || target.rarity === 'epic') &&
    (target.kind !== 'egg' || target.ordinal > 3) &&
    nextState.lastObservedAt < target.readyAt && nextState.usedToday < DAILY_SOFT_CAP;
  if (!eligible) return { offer: null, state: nextState };
  const available = questions.filter((question) => question.grade === grade &&
    !nextState.answered[`${target.id}:${question.id}`]);
  if (!available.length) return { offer: null, state: nextState };
  // Stable rotation avoids always presenting the first question; no extra state or hidden roll.
  const index = [...String(target.id)].reduce((n, char) => n + char.charCodeAt(0), 0) % available.length;
  return { offer: available[index], state: nextState };
}

export function answerHelpQuestion({ target, state = {}, question, choiceIndex, grade, questions, now }) {
  const offered = getHelpOffer({ target, state, grade, questions, now });
  if (!offered.offer || offered.offer.id !== question.id) throw new Error('Question is not available');
  const canonicalQuestion = offered.offer;
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= canonicalQuestion.choices.length)
    throw new Error('Invalid choice');
  if (choiceIndex !== canonicalQuestion.answerIndex) {
    return { correct: false, hint: canonicalQuestion.hint, target, state: offered.state };
  }
  const duration = Math.max(0, target.readyAt - target.startedAt);
  const remaining = Math.max(0, target.readyAt - offered.state.lastObservedAt);
  const shortenedMs = Math.min(remaining, MAX_SHORTEN_MS, Math.floor(duration / 4));
  const nextTarget = { ...target, readyAt: target.readyAt - shortenedMs };
  const nextState = { ...offered.state, usedToday: offered.state.usedToday + 1,
    answered: { ...offered.state.answered, [`${target.id}:${canonicalQuestion.id}`]: true } };
  return { correct: true, shortenedMs, target: nextTarget, state: nextState };
}
