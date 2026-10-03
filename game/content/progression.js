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
 * `grant.decoration`: a farm decoration id (the renderer has a builder for each).
 * A reward with a `title` is announced in a dialog and the goal chip until opened; one
 * without is just a `toast`. `track` groups rewards into a progress line (see TRACKS);
 * `label` names the reward in that line. `celebrate` makes every creature dance.
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
  // Pip's Garden Festival: every free-play order builds the party, then a Water egg.
  { id: 'festival_bunting', track: 'festival', label: 'bunting', when: { freeOrderFills: 1 },
    grant: { decoration: 'festivalBunting' }, toast: 'Bunting for the festival! 🎉' },
  { id: 'festival_pots', track: 'festival', label: 'flowers', when: { freeOrderFills: 3 },
    grant: { decoration: 'festivalPots' }, toast: 'Flowers for the festival! 🌸' },
  { id: 'festival_lanterns', track: 'festival', label: 'lanterns', when: { freeOrderFills: 5 },
    grant: { decoration: 'festivalLanterns' }, toast: 'Lanterns for the festival! 🏮' },
  { id: 'festival_banner', track: 'festival', label: 'the banner', when: { freeOrderFills: 7 },
    grant: { decoration: 'festivalBanner' }, toast: 'The festival banner is up! 🎪' },
  {
    id: 'festival_prize', track: 'festival', label: 'a Water egg', when: { freeOrderFills: 8 },
    grant: { egg: { id: 'festival', element: 'water', creatureId: 'puddlefin', label: 'Water egg' } },
    title: 'The Garden Festival is ready!',
    text: '“You built the whole festival! Here is a prize for the best farmer: a Water egg.” — Pip',
    toast: 'A Water egg! 💧',
    celebrate: true,
  },
];

/** Progress lines shown at the market for reward tracks. */
export const TRACKS = [
  { id: 'festival', icon: '🎪', name: 'Festival', doneText: 'Festival complete! Thank you for building it!' },
];
