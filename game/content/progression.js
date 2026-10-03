// How the game unfolds: the first-session tutorial, eggs, feeding growth, and rewards.
// Most new progression should be a data change here, not a code change.

/**
 * The first-session beat sheet (docs/CONTRACT.md §1 and §4), in order. `crack: true` adds a
 * crack to the starter egg when the step completes. After the last step the game is in free
 * play and the goal chip picks the best next action by itself (see src/rules/guide.js).
 */
export const TUTORIAL = [
  { id: 'plant', crack: true },
  { id: 'grow' },
  { id: 'harvest', crack: true },
  { id: 'market' },
  { id: 'offer', crack: true },
  { id: 'armor', crack: true },
  { id: 'hatch' },
  { id: 'name' },
  { id: 'book' },
  { id: 'feed' },
  { id: 'replant' },
  { id: 'free' },
];

/** Seeds offered in the tutorial's two planting steps. */
export const TUTORIAL_SEEDS = {
  plant: ['sunberry', 'carrot', 'carrot'],
  replant: ['carrot', 'carrot', 'carrot'],
};

/** The egg every new farm starts with. Its creature follows the first special crop harvested. */
export const STARTER_EGG = { id: 'starter', defaultName: 'Sprout' };

/** Feeding: creatures eat `food`; growth stages unlock at feed counts. */
export const FEEDING = {
  food: 'sunberry',
  stages: [{ feeds: 3, adornment: 'sunCrest', toast: "{name}'s sun crest bloomed! ☀️" }],
};

/**
 * Rewards earned by playing. Each is granted once, the first time its condition holds.
 * `when.freeOrderFills`: orders filled in free play.
 * `grant.seeds`: limited seeds added to the sack. `grant.egg`: a new egg, ready to hatch.
 */
export const REWARDS = [
  {
    id: 'pip_gift',
    when: { freeOrderFills: 2 },
    grant: {
      seeds: { sunberry: 1 },
      egg: { id: 'pip_gift', element: 'leaf', creatureId: 'mossbun', label: 'Leaf egg' },
    },
    title: 'Pip has a gift for you!',
    text: '“Two more orders filled — you’re a true farmer now! For you: a twinkling ✦ star seed for '
      + 'your sack, and this speckled Leaf egg. I can hear a little Mossbun inside!” — Pip',
    toast: 'Star seed in your sack — plant it! ✦',
  },
];
