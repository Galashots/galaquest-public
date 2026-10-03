// Pip's market: who sells, what they want, and what they say.
export const NPCS = [
  { id: 'pip', name: 'Pip', color: '#8d6e63', greeting: 'Hi, farmer!' },
  { id: 'maple', name: 'Maple', color: '#e57373', greeting: 'Hey there, friend!' },
  { id: 'reed', name: 'Reed', color: '#64b5f6', greeting: 'Adventure awaits!' },
];

export const OFFERS = [
  { id: 'pip_crate', npc: 'pip', text: '5 carrots → 10 coins',
    wants: { carrot: 5 }, coins: 10, teach: 'count by 2s' },
  { id: 'pip_bundle', npc: 'pip', text: '2 carrots + 1 sunberry → 12 coins',
    wants: { carrot: 2, sunberry: 1 }, coins: 12, teach: 'compare two deals' },
  { id: 'pip_big_order', npc: 'pip', band: 'older', text: '6 carrots + 2 sunberries → 26 coins',
    wants: { carrot: 6, sunberry: 2 }, coins: 26, teach: 'saving for a big deal' },
  { id: 'maple_wheat', npc: 'maple', band: 'younger', text: 'Two wheat bundles, please!',
    wants: { wheat: 2 }, coins: 4, teach: 'counting by 2s' },
  { id: 'pip_pumpkins_big', npc: 'pip', band: 'younger', text: 'Two pumpkins? I will pay eight coins!',
    wants: { pumpkin: 2 }, coins: 8, teach: 'comparing bigger number' },
  { id: 'maple_carrots_five', npc: 'maple', band: 'younger', text: 'Five carrots, two coins each! Count by twos!',
    wants: { carrot: 5 }, coins: 10, teach: 'skip-counting by 2s' },
  { id: 'pip_carrot_wheat', npc: 'pip', band: 'younger', text: 'One carrot and two wheat, please!',
    wants: { carrot: 1, wheat: 2 }, coins: 5, teach: 'adding within 20' },
  { id: 'pip_sunberries', npc: 'pip', band: 'older', text: 'Four sunberries! How many coins?',
    wants: { sunberry: 4 }, coins: 12, teach: 'multiplication facts' },
  { id: 'maple_dewmelons', npc: 'maple', band: 'older', text: 'Nine coins for three dewmelons. How much is each?',
    wants: { dewmelon: 3 }, coins: 9, teach: 'division facts' },
  { id: 'pip_glowleaf_half', npc: 'pip', band: 'older', text: 'Half my basket of glowleaf, please!',
    wants: { glowleaf: 4 }, coins: 18, teach: 'fractions of a basket' },
  { id: 'maple_pumpkin_compare', npc: 'maple', band: 'older', text: 'Is four pumpkins worth twelve coins?',
    wants: { pumpkin: 4 }, coins: 12, teach: 'comparing bundle value' },
  { id: 'reed_wheat_save', npc: 'reed', band: 'older', text: 'Save ten wheat for a big reward!',
    wants: { wheat: 10 }, coins: 25, teach: 'is it worth saving for' },
];

export const DIALOG = {
  pip: ['Nice harvest!', 'That egg is wiggling!', 'Coins for your crops!', 'Welcome to the market!', 'What a fine day to farm!'],
  maple: ['Your farm is growing!', 'I love dewmelons!', 'Creatures are so cute!', 'The sun feels nice today!', 'You are doing great!'],
  reed: ['Let us explore!', 'I spotted something shiny!', 'Every creature is special!', 'The farm is full of surprises!', 'Ready for an adventure?'],
};

/**
 * Which offers and armor the market shows. `firstVisit` is the two-card choice in the first
 * session; `board` is the persistent order board in free play, per band. Only list offers
 * the player can actually grow, or the board shows orders that can never be filled.
 */
export const MARKET = {
  armorSet: 'Sprout',
  firstVisit: ['pip_crate', 'pip_bundle'],
  board: {
    younger: ['pip_crate', 'pip_bundle'],
    older: ['pip_crate', 'pip_bundle', 'pip_big_order'],
  },
};
