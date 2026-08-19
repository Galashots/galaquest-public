// public/src/world/rowanSpeech.js
//
// Rowan's own lines, mirroring keeperSpeech.js's split: PURE state->text mapping, no three.js, no
// DOM. The camp used to raise a question ("Who left this camp?") and never answer it -- the
// second child playtest's own "who's Rowan?" energy (younger players asking about a new weapon unprompted)
// is the evidence this beat exists to answer.
//
// The lines are locked prose from the design brief (ChatGPT, as design/product lead, 2026-08-15),
// not placeholder text -- do not rewrite them while touching this file for something else. They
// follow the same writing rules keeperSpeech.js documents: short sentences, no em dash or
// semicolon, the speaker's name kept out of the line itself.

export const ROWAN_NAME = 'Rowan';

// One paragraph, shown whole on approach -- Rowan is a single encounter, not a returning
// quest-giver counted down over repeat visits the way Aldric is, so there is no shorter "you have
// heard this before" variant to write yet. Ends on the one instruction that matters: go search the
// cart. The Beacon is named as a reason, deliberately not as something reachable today -- see
// world/quest.js's own OBJECTIVE_SEARCH_THE_CART for why the objective chip does not promise it.
export const ROWAN_LINE_INTRO =
  'This was a supply camp. Everyone ran. '
  + 'I followed their tracks. Something drove them off. '
  + 'The old Beacon has gone cold too. '
  + 'You woke these lanterns. I could use help. '
  + 'See that sword? It is a Wildwood Blade. '
  + 'Wake the Beacon. This Wildwood Blade is yours. '
  + 'First, search the broken cart for clues.';

// After the cart: honest about what is NOT built yet (there is no walkable Beacon in this slice)
// rather than repeating an instruction already done, the same reasoning the Keeper's own
// KEEPER_LINE_GATE_FOUND follows once a finished step has nothing further to send the child to.
export const ROWAN_LINE_CART_SEARCHED = 'Thank you. The Beacon must wait for now.';

/** The line for Rowan's own state: only two, because he has one job in this slice. */
export function rowanLineFor(cartSearched) {
  return cartSearched === true ? ROWAN_LINE_CART_SEARCHED : ROWAN_LINE_INTRO;
}

/**
 * Proximity edge + line selection + show/hide, one pure read -- same shape as keeperSpeechState,
 * reused rather than re-derived because main.js shares ONE speech bubble between the two NPCs (they
 * stand tens of metres apart and can never both be in range at once).
 */
export function rowanSpeechState({ heroX, heroZ, rowanX, rowanZ, radiusMeters, cartSearched }) {
  const distance = Math.hypot(heroX - rowanX, heroZ - rowanZ);
  if (distance > radiusMeters) return { visible: false, line: null };
  return { visible: true, line: rowanLineFor(cartSearched) };
}
