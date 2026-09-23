// Single point of truth for game content. The content pack is being written
// in parallel against content-schema.md. Until it lands, we use the local
// placeholder so this prototype stays runnable on its own.
//
// INTEGRATOR: once content/content.js exists, change the next line to:
//   import * as C from './content.js';
import * as C from './content.placeholder.js';

export const CROPS = C.CROPS;
export const ARMOR = C.ARMOR;
export const CREATURES = C.CREATURES;
export const NPCS = C.NPCS;
export const OFFERS = C.OFFERS;
export const QUESTIONS = C.QUESTIONS;
export const DIALOG = C.DIALOG;
