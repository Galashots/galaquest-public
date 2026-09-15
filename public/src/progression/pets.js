// First attachment slice: companions do not modify combat stats or POWER.
export const WORM_PETS = Object.freeze([
  Object.freeze({ id: 'worm_green', displayName: 'Green Worm', campX: -3, campZ: 1 }),
  Object.freeze({ id: 'worm_red', displayName: 'Red Worm', campX: 3, campZ: 1 }),
]);
export const PET_INTERACTION_RADIUS = 3;
export const PET_CAMP_DESTINATION = 'home-hub';
export function petDef(id) { return WORM_PETS.find(pet => pet.id === id); }
