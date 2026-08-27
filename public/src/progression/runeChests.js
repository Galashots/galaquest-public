// public/src/progression/runeChests.js
//
// THE HIDDEN LEARNING LAYER. "Massive dopamine, and then we sneak in a little bit of learning" (the
// Owner's own words) -- everything the combat push already ships (kills, XP, drops, streaks) stays
// exactly as loud as it is; this rides ALONGSIDE it rather than interrupting it. Every 8th kill this
// hero personally lands spawns one small glowing chest nearby. Walking into it asks ONE quick
// question with three big answers. Either answer opens the chest -- there is no wrong door, only a
// bigger one.
//
// PURE, the same discipline progression/streaks.js's own header states for the identical reason: no
// DOM, no clock, no wall-clock randomness, no three.js. `rng` is caller-supplied (`() => number in
// [0, 1)` -- main.js passes Math.random, a test passes a scripted sequence) so a spawn/question/judge
// sequence is reproducible in a test the same way world/enemyDrops.js's own roll is.
//
// CLIENT-LOCAL AND OFFLINE-FIRST, DELIBERATELY, and that is the one way this module's whole shape
// differs from R1's kill drops or kill XP. Those are shared/durable world concerns that the server
// adjudicates online and an offline fallback merely approximates. A rune chest is not shared world
// state at all -- it is a per-child learning beat, the same "cosmetic, allowed to diverge" posture
// progression/streaks.js's own header takes for the streak meter, just spent on a bigger moment. So
// this module knows nothing about a server: main.js drives it identically whether netStatus is
// 'online' or not, off the SAME "this hero personally landed the killing blow" signal
// (myKillEnemyIds) both branches already produce for the XP toast.
//
// The XP the chest pays out is real, durable, and travels the SAME `xp-earned` door P2 opened and R1
// (rewards/killXp.js) already walks through a second time -- see runeChestXpEventId below for why a
// THIRD source through that door is safe, and progression/facts.js's own PROFILE_SCOPED_EVENT_ID_
// PREFIXES for the durable-identity reservation this needs to be given there.

// ── THE COUNTER ─────────────────────────────────────────────────────────────────────────────────

/** Every 8th kill earns a chest. Not 5 or 10: low enough that a session with a handful of kills sees
 *  at least one (the whole point is dead if a short session never encounters the mechanic), high
 *  enough that it reads as a MILESTONE rather than a tax on every kill's own loot. */
export const KILLS_PER_CHEST = 8;

/** How far the chest appears from the hero when it spawns -- close enough to be found without a
 *  hunt (a child mid-fight should not lose the moment looking for a prize), far enough that it is
 *  never sitting directly under the hero's own feet, indistinguishable from the kill's own drops. */
export const CHEST_SPAWN_MIN_METERS = 2;
export const CHEST_SPAWN_MAX_METERS = 4;

/** Matches world/enemyDrops.js's own DROP_COLLECT_RADIUS_METERS exactly -- a walk-up pickup is a
 *  walk-up pickup, and there is no reason a chest should ask for finer aim than a coin does. */
export const CHEST_COLLECT_RADIUS_METERS = 1.3;

/** How many times one standing chest's own shimmer can step up before it caps out. Session cap: max
 *  ONE chest active at a time (the brief's own words) -- 8 more kills while one already stands never
 *  spawns a second, it only makes the one waiting brighter, and this is where that brightening stops
 *  reading as "more" and starts just being the chest's own resting glow. */
export const MAX_SHIMMER_TIER = 3;

/** What a normal (wrong-answer) open pays, and what a correct one pays -- both `xp-earned`, so both
 *  feed the SAME level-up ceremony main.js already fires off the folded level diff (see this file's
 *  own header). Sized well above a single kill's own XP (combat/enemyStats.js's killXpForKind tops
 *  out well under either of these) so the chest itself, not merely opening it, reads as the reward --
 *  and sized so CORRECT is a real multiple of normal (3x) rather than a token bonus, because "did you
 *  get it right" has to matter enough for a confident-reader brother to notice and try. */
export const REWARD_XP_NORMAL = 10;
export const REWARD_XP_CORRECT = 30;

/**
 * A fresh, empty ledger: no kills counted yet, no chest standing.
 *
 * `nextQuestionTypeIndex` is the variety mechanism named in the brief ("age tier cycling so both
 * brothers get variety"): rather than gate question TYPE on a birthdate this game has never asked
 * for, every chest cycles to the NEXT type in QUESTION_TYPES round-robin, so two brothers sharing one
 * tablet across a session see counting, arithmetic, word-pick and pattern turn up in turn rather than
 * the same type (or a randomly-repeating one) landing on whichever child happens to open the next
 * chest. A confident reader who only ever saw counting would be bored; an early reader who only ever
 * saw arithmetic would be lost -- round-robin is the one answer that is honest about not knowing
 * which child is currently holding the tablet.
 */
export function createRuneChestState() {
  return Object.freeze({ killsSinceChest: 0, chest: null, nextQuestionTypeIndex: 0 });
}

/**
 * Record one kill THIS hero personally landed (main.js's own myKillEnemyIds gate, the identical one
 * the XP toast already uses -- see this file's header). A pure counter: no positions, no rng, no
 * question. Every KILLS_PER_CHEST-th call answers `chestDue: true` when no chest is currently
 * standing, so the caller knows to go find it a spot (pickChestSpawnPoint) and open it (openRuneChest)
 * -- OR, if a chest IS already standing, bumps its own shimmer instead and answers `chestDue: false`,
 * which is the whole of the "session cap: max one chest, extra kills upgrade the shimmer" rule.
 */
export function registerRuneChestKill(state) {
  const killsSinceChest = (state.killsSinceChest ?? 0) + 1;
  if (killsSinceChest < KILLS_PER_CHEST) {
    return { state: Object.freeze({ ...state, killsSinceChest }), chestDue: false };
  }
  if (state.chest === null) {
    return { state: Object.freeze({ ...state, killsSinceChest: 0 }), chestDue: true };
  }
  const shimmerTier = Math.min(MAX_SHIMMER_TIER, state.chest.shimmerTier + 1);
  return {
    state: Object.freeze({
      ...state, killsSinceChest: 0, chest: Object.freeze({ ...state.chest, shimmerTier }),
    }),
    chestDue: false,
  };
}

// ── WHERE IT STANDS ─────────────────────────────────────────────────────────────────────────────

/**
 * Pick a spot for the chest, `[CHEST_SPAWN_MIN_METERS, CHEST_SPAWN_MAX_METERS]` from the hero in a
 * random direction -- the same polar scatter world/enemyDrops.js's own scatterPoint uses, at a
 * bigger radius (a chest is a destination to walk to, not set dressing scattered underfoot).
 *
 * `isAllowed(x, z)` is the world-knowledge seam: this module knows nothing about world bounds, the
 * Beacon arena or the sanctuary (that is world/bounds.js's and world/zones/village.js's own job, and
 * a pure progression/ rule has no business duplicating either), so the caller hands in a predicate
 * and this only promises never to hand back a point that predicate refused. Retries up to `attempts`
 * times with fresh draws off the SAME rng before giving up -- a chest failing to find a legal spot
 * this frame is not an error, the brief's own answer is simply "never inside the arena or the
 * sanctuary", and a caller that gets `null` back is free to try again next frame once the hero has
 * moved. Defaults `isAllowed` to "anywhere" so a caller/test that does not care about exclusion zones
 * (most of them) does not have to supply a predicate that always says yes.
 */
export function pickChestSpawnPoint({
  playerX, playerZ, rng, isAllowed = () => true, attempts = 12,
}) {
  for (let i = 0; i < attempts; i += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = CHEST_SPAWN_MIN_METERS + rng() * (CHEST_SPAWN_MAX_METERS - CHEST_SPAWN_MIN_METERS);
    const point = { x: playerX + Math.cos(angle) * distance, z: playerZ + Math.sin(angle) * distance };
    if (isAllowed(point.x, point.z)) return point;
  }
  return null;
}

// ── THE QUESTION BANK ───────────────────────────────────────────────────────────────────────────
//
// Every string here is kid-short on purpose -- this is a five-second beat between kills, not a
// worksheet. Every entry is PLAIN DATA (a prompt, an optional big visual, one correct answer, two
// distractors); buildQuestionFromEntry below is the one place that turns an entry into a real
// three-button question, shuffling the answer order with the caller's own rng so "the right one is
// always the last button" never becomes a pattern a child learns instead of the actual question.

export const QUESTION_TYPES = Object.freeze(['counting', 'arithmetic', 'word-pick', 'pattern']);

// counting: a row of a familiar emoji, "how many?" -- the earliest-reader question this bank has,
// answerable without reading a word. Five subjects (all things this game already put in front of a
// child: the wolves they are fighting, the world's own butterflies/mushrooms/stars/apples) times five
// counts (3-7, never 1-2 -- too trivial to bother asking -- and never past 7, which is as many as a
// single emoji row can show before it stops reading as a countable group at a glance) is 25 entries,
// GENERATED rather than hand-typed 25 times over (docs/MISTAKES.md GQ-007: a rule with 25 copies is a
// rule waiting to disagree with itself).
const COUNTING_SUBJECTS = Object.freeze([
  { emoji: '🐺', plural: 'wolves' },
  { emoji: '🦋', plural: 'butterflies' },
  { emoji: '🍄', plural: 'mushrooms' },
  { emoji: '⭐', plural: 'stars' },
  { emoji: '🍎', plural: 'apples' },
]);
const COUNTING_COUNTS = Object.freeze([3, 4, 5, 6, 7]);

function countingDistractors(count) {
  // Two neighbours that are never the count itself and never each other, clamped to stay a real
  // countable amount (1-9). Spread apart (one below, one two-above where there is room) so the three
  // options are not three consecutive numbers a child could win by guessing the middle one.
  const below = count - 1 >= 1 ? count - 1 : count + 1;
  let above = count + 2 <= 9 ? count + 2 : count - 2;
  if (above === below || above === count) above = count + 1 !== below ? count + 1 : count - 2;
  return [String(below), String(above)];
}

const COUNTING_ENTRIES = COUNTING_SUBJECTS.flatMap(
  (subject) => COUNTING_COUNTS.map((count) => Object.freeze({
    type: 'counting',
    prompt: `How many ${subject.plural}?`,
    visual: subject.emoji.repeat(count),
    correctText: String(count),
    distractorTexts: countingDistractors(count),
  })),
);

// arithmetic: addition and subtraction, both within 12 (the brief's own ceiling -- a confident second
// grader's own comfortable range, not a curriculum stretch). Pairs are AUTHORED as plain (a, b) tuples
// and the questions/distractors are DERIVED from them, the same "generated parametrically where
// sensible" instruction requestEnemyDrop's own coin-count roll follows for a different kind of table.
const ADDITION_PAIRS = Object.freeze([
  [2, 3], [4, 3], [5, 4], [6, 2], [3, 3], [7, 4], [5, 5], [6, 5], [2, 9], [8, 3], [4, 6], [9, 2],
]);
const SUBTRACTION_PAIRS = Object.freeze([
  [9, 4], [10, 3], [8, 5], [12, 7], [11, 6], [7, 2], [9, 6], [10, 4], [8, 3], [12, 5], [6, 1], [11, 8],
]);

function arithmeticDistractors(answer) {
  // Off-by-one in both directions is the honest shape of a real arithmetic slip (a miscounted finger,
  // not a wild guess) -- clamped so a small answer never offers a negative option.
  const low = answer - 1 >= 0 ? answer - 1 : answer + 2;
  const high = answer + 1 !== low ? answer + 1 : answer + 2;
  return [String(low), String(high)];
}

const ARITHMETIC_ENTRIES = [
  ...ADDITION_PAIRS.map(([a, b]) => {
    const answer = a + b;
    return Object.freeze({
      type: 'arithmetic',
      prompt: `${a} + ${b} = ?`,
      visual: null,
      correctText: String(answer),
      distractorTexts: arithmeticDistractors(answer),
    });
  }),
  ...SUBTRACTION_PAIRS.map(([a, b]) => {
    const answer = a - b;
    return Object.freeze({
      type: 'arithmetic',
      prompt: `${a} - ${b} = ?`,
      visual: null,
      correctText: String(answer),
      distractorTexts: arithmeticDistractors(answer),
    });
  }),
];

// word-pick: "which one is a/an X?" -- the one type that asks a child to READ rather than count, so
// it is aimed a little older, and its three categories are all words this game has already put in
// front of every child playing it (what they fight, where they walk, what they carry), never an
// invented vocabulary list. Parametrically built the same way counting is: one question per word,
// its two distractors pulled from the OTHER two categories so the wrong answers are never from the
// same family as the right one (a child should never have to tell two animals apart to answer
// "which one is an animal").
const WORD_CATEGORIES = Object.freeze([
  { label: 'animal', words: Object.freeze(['WOLF', 'BUTTERFLY', 'RABBIT', 'OWL']) },
  { label: 'place', words: Object.freeze(['ROAD', 'RIVER', 'MOUNTAIN', 'CASTLE']) },
  { label: 'thing', words: Object.freeze(['LANTERN', 'SHIELD', 'COIN', 'SWORD', 'HELMET']) },
]);

const WORD_PICK_ENTRIES = WORD_CATEGORIES.flatMap((category, categoryIndex) => {
  const others = WORD_CATEGORIES.filter((_, index) => index !== categoryIndex).flatMap((c) => c.words);
  return category.words.map((word, wordIndex) => {
    // Deterministic rather than rng-picked (bank entries are plain data, built once at module load;
    // the RANDOMNESS this module promises stays at the seam -- see buildQuestionFromEntry): two
    // distractors spread across `others` by index so repeated entries in the same category do not
    // all draw the identical pair.
    const first = others[wordIndex % others.length];
    const second = others[(wordIndex + Math.floor(others.length / 2)) % others.length];
    return Object.freeze({
      type: 'word-pick',
      prompt: `Which one is a${/^[aeiou]/i.test(category.label) ? 'n' : ''} ${category.label}?`,
      visual: null,
      correctText: word,
      distractorTexts: first === second ? [first, others[(wordIndex + 1) % others.length]] : [first, second],
    });
  });
});

// pattern: skip-counting. (start, step) is authored, the sequence and its distractors are derived --
// the same parametric shape arithmetic's own pairs take. Distractors are the two real mistakes a
// child skip-counting actually makes: repeating the last number shown (not moving on) or jumping one
// step too far (losing count of how many steps they have taken).
const PATTERN_STEPS = Object.freeze([
  [2, 2], [1, 2], [0, 5], [5, 5], [1, 3], [3, 3], [10, 10], [0, 10], [0, 2], [2, 4], [1, 4], [4, 2],
]);

const PATTERN_ENTRIES = PATTERN_STEPS.map(([start, step]) => {
  const terms = [start, start + step, start + step * 2];
  const answer = start + step * 3;
  return Object.freeze({
    type: 'pattern',
    prompt: `${terms.join(', ')}, ?`,
    visual: null,
    correctText: String(answer),
    // The third term shown (a "didn't move" repeat) and one step past the true answer (an
    // over-count), never the same value twice even when step is small.
    distractorTexts: [String(terms[2]), String(answer + step)],
  });
});

/** Every entry, by type -- frozen, and never mutated: buildQuestionFromEntry below reads one and
 *  shuffles a FRESH array, it never touches the bank itself. */
export const QUESTION_BANKS = Object.freeze({
  counting: Object.freeze(COUNTING_ENTRIES),
  arithmetic: Object.freeze(ARITHMETIC_ENTRIES),
  'word-pick': Object.freeze(WORD_PICK_ENTRIES),
  pattern: Object.freeze(PATTERN_ENTRIES),
});

/**
 * Turn one bank entry into a real, ASKABLE question: three answers in a caller-rng-shuffled order,
 * `correctIndex` naming which one is right. The shuffle is the ONE piece of randomness a question
 * needs beyond which entry was picked -- without it every counting question would show its correct
 * count in the same button position it was authored in above, which a child learns in about three
 * chests.
 */
function buildQuestionFromEntry(entry, id, rng) {
  const options = [
    { text: entry.correctText, correct: true },
    { text: entry.distractorTexts[0], correct: false },
    { text: entry.distractorTexts[1], correct: false },
  ];
  // Fisher-Yates over exactly 3 items, off the caller's own rng -- deterministic under a scripted
  // sequence, uniform under Math.random, the same shuffle discipline this game already applies
  // wherever a caller-supplied rng meets a small array.
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return Object.freeze({
    id,
    type: entry.type,
    prompt: entry.prompt,
    visual: entry.visual,
    answers: Object.freeze(options.map((option) => option.text)),
    correctIndex: options.findIndex((option) => option.correct),
  });
}

/**
 * Pick the next question, cycling QUESTION_TYPES round-robin off `typeIndex` (state.
 * nextQuestionTypeIndex, read by openRuneChest below) and a random entry within that type off `rng`.
 */
export function pickRuneChestQuestion({ rng, typeIndex }) {
  const type = QUESTION_TYPES[((typeIndex % QUESTION_TYPES.length) + QUESTION_TYPES.length) % QUESTION_TYPES.length];
  const bank = QUESTION_BANKS[type];
  const entry = bank[Math.floor(rng() * bank.length) % bank.length];
  return buildQuestionFromEntry(entry, `${type}-${bank.indexOf(entry)}`, rng);
}

// ── OPENING, ANSWERING, CLOSING ─────────────────────────────────────────────────────────────────

/**
 * Place the chest a caller (main.js, once pickChestSpawnPoint found it a legal spot) has decided to
 * spawn, and hand it its own question. One call, atomically: a chest with a position but no question
 * (or the reverse) is not a state this game should ever be able to observe.
 *
 * @param id  a caller-minted identity, unique for this chest's own lifetime -- used only to name the
 *            xp-earned fact it eventually pays out (runeChestXpEventId below), never persisted or
 *            checked for durable idempotency beyond that one fact, the identical "never durable on
 *            its own" posture world/enemyDrops.js's own lifeId takes.
 */
export function openRuneChest(state, { id, x, z, rng }) {
  const typeIndex = state.nextQuestionTypeIndex ?? 0;
  const question = pickRuneChestQuestion({ rng, typeIndex });
  return Object.freeze({
    ...state,
    chest: Object.freeze({ id, x, z, question, shimmerTier: 1 }),
    nextQuestionTypeIndex: (typeIndex + 1) % QUESTION_TYPES.length,
  });
}

/**
 * Judge a tapped answer against the chest's own question. Pure and total: `answerIndex` outside
 * 0..2 (should not happen -- the card only ever offers three buttons -- but this is read off a tap
 * event, not trusted) reads as simply wrong rather than throwing, the same "a confused caller gets
 * the safe answer" posture world/enemyDrops.js's own requestCollectEnemyDrop takes for a bad id.
 */
export function judgeRuneChestAnswer(question, answerIndex) {
  const correct = answerIndex === question.correctIndex;
  return { correct, correctText: question.answers[question.correctIndex] };
}

/** What one open pays, in XP -- see REWARD_XP_NORMAL/REWARD_XP_CORRECT above for why both are sized
 *  the way they are. */
export function rewardXpForRuneChestAnswer(correct) {
  return correct ? REWARD_XP_CORRECT : REWARD_XP_NORMAL;
}

/**
 * The chest is answered (right OR wrong -- both open it, see this file's header): clear it so the
 * NEXT KILLS_PER_CHEST kills can eventually earn a fresh one. Does NOT touch killsSinceChest, which
 * keeps counting independently -- a chest answered mid-streak does not reset or refund the count
 * toward the next one.
 */
export function closeRuneChest(state) {
  return Object.freeze({ ...state, chest: null });
}

/**
 * MAY THE CARD OPEN RIGHT NOW? The question card is a MODAL: while it is up, main.js's
 * anyOverlayOpen gate makes movement input inert and drains attack presses unheard. Auto-opening it
 * on proximity was therefore a trap mid-fight: a child who backs over a chest while a wolf is on
 * them gets a maths question over a frozen hero and keeps taking bites they can no longer answer.
 * The fix is a rule, not a UI patch: hold the card while any live enemy is actively hostile
 * (bite, or closing in on 'walk') within its own notice radius of the hero. The chest itself
 * stays, the collect radius stays; the question simply waits for the fight to be over -- the next
 * frame with no hostile within range opens it from the very same spot.
 *
 * Pure and dependency-free: the caller passes the notice radius (main.js hands it
 * WOLF_AGGRO_RANGE -- imported there, never restated here, GQ-007).
 */
export function heroInCombat({ heroX, heroZ, enemies, noticeRadiusMeters }) {
  if (!Array.isArray(enemies)) return false;
  return enemies.some((enemy) => enemy
    && (enemy.mode === 'bite' || enemy.mode === 'walk')
    && Math.hypot((enemy.x ?? 0) - heroX, (enemy.z ?? 0) - heroZ) <= noticeRadiusMeters);
}

/**
 * THE XP FACT'S NAME. Scoped to the PROFILE, not a guestId, and that is the one deliberate difference
 * from rewards/killXp.js's own `kill-xp:<guestId>:...` -- a rune chest has no server-side counterpart
 * to ever mint a guestId-scoped copy of this fact (this file's own header: chests are never
 * server-adjudicated, online or off), so there is no second identity for this one to collide with or
 * defer to. The profile id IS this device's own durable identity for exactly this child
 * (progression/facts.js's own PROFILE_SCOPED_EVENT_ID_PREFIXES documents the same scoping for
 * `lantern-unlocked:<profileId>`), which is what lets this fact survive a reconnect: the wire's own
 * guestId equals the profile id once a device has one (main.js's own "the profile id IS the wire's
 * guestId" comment), so restoreProfileFacts' owner check passes for the rightful child and refuses
 * everyone else's.
 */
export function runeChestXpEventId(profileId, chestId) {
  return `rune-chest:${profileId}:${chestId}`;
}
