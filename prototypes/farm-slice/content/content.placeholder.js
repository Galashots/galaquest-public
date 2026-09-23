// Placeholder content for the "Hatch & Harvest" farm slice.
// Follows the shared schema in content-schema.md (named exports only, no
// imports, no logic), tuned to the numbers in CONTRACT.md section 2 & 8.
// The real content pack (content.js) is written by a parallel agent; see
// content/index.js for how the two are wired together.
//
// NOTE: `yield` (crops produced per harvested plant) is not in the original
// schema example, but the contract's numbers require it (a carrot plant
// gives 3 carrots, a sunberry plant gives 2). The integrator should add this
// field to content.js's CROPS entries too -- see CONTRACT.md section 2.

export const CROPS = [
  { id: 'carrot', name: 'Carrot', growSeconds: 20, sellPrice: 2, yield: 3, color: '#f28c28', element: null, distinctive: false },
  { id: 'sunberry', name: 'Sunberry', growSeconds: 40, sellPrice: 5, yield: 2, color: '#ffca28', element: 'sun', distinctive: true },
];

export const ARMOR = [
  { id: 'leaf_crest_helmet', name: 'Leaf Crest Helmet', slot: 'helmet', price: 10, color: '#6cc24a', accent: '#2e7d32', set: 'Leaf' },
];

export const CREATURES = [
  { id: 'sprout', name: 'Sprout', element: 'sun', rarity: 'common', shape: 'round',
    colors: { body: '#ffca28', accent: '#ff8f00' }, blurb: 'Loves warm sunberries.' },
  { id: 'aquapip', name: 'Aquapip', element: 'water', rarity: 'common', shape: 'round',
    colors: { body: '#4fc3f7', accent: '#0277bd' }, blurb: 'Splashes in the creek.' },
  { id: 'leafling', name: 'Leafling', element: 'earth', rarity: 'common', shape: 'tall',
    colors: { body: '#8bc34a', accent: '#33691e' }, blurb: 'Grows a new leaf every day.' },
  { id: 'skybit', name: 'Skybit', element: 'air', rarity: 'rare', shape: 'winged',
    colors: { body: '#e1bee7', accent: '#8e24aa' }, blurb: 'Naps on clouds.' },
  { id: 'stonepal', name: 'Stonepal', element: 'earth', rarity: 'rare', shape: 'long',
    colors: { body: '#a1887f', accent: '#4e342e' }, blurb: 'Very, very patient.' },
  { id: 'glimmerfox', name: 'Glimmerfox', element: 'fire', rarity: 'rare', shape: 'tall',
    colors: { body: '#ffb74d', accent: '#e65100' }, blurb: 'Sparkles when happy.' },
];

export const NPCS = [
  { id: 'pip', name: 'Farmer Pip', color: '#8d6e63', greeting: 'Hi, farmer!' },
];

export const OFFERS = [
  { id: 'pip_crate', npc: 'pip', band: 'younger', text: "Fill Pip's crate: 5 carrots for 10 coins!",
    wants: { carrot: 5 }, coins: 10, teach: 'counting to 10; skip-count by 2' },
  { id: 'pip_bundle', npc: 'pip', band: 'older', text: 'Bundle deal: 2 carrots + 1 sunberry for 12 coins!',
    wants: { carrot: 2, sunberry: 1 }, coins: 12, teach: 'ratios; multiplying/dividing within 100,000' },
];

export const QUESTIONS = [
  { id: 'g2_add_01', grade: 2, prompt: 'Pip has 4 carrots and picks 3 more. How many now?',
    choices: ['6', '7', '8'], answerIndex: 1, hint: 'Count up from 4: 5, 6, 7.',
    outcome: 'Alberta Math Gr 2: addition within 20' },
];

export const DIALOG = {
  pip: ['Hi, farmer!', 'Nice harvest!', 'That egg is wiggling!', 'Come back any time!'],
};
