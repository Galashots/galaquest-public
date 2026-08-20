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

// After the cart. This read 'Thank you. The Beacon must wait for now.' until 2026-08-20, and that
// sentence was the honest one exactly as long as the world stopped at this camp. G1 built the road
// north, so the old line became the one thing a quest-giver must never be: WRONG about the world the
// child is standing in (docs/MISTAKES.md GQ-002 -- rewrite the claim in the same commit that stops
// it being true). ROWAN_LINE_INTRO above is untouched locked prose; only the directions moved.
//
// It gives a BEARING and a landmark, not a nudge: "north out of this camp" is the one fact a child
// needs, and "the stones" names the waystones they will walk past thirty seconds later so that
// seeing one confirms they went the right way.
export const ROWAN_LINE_CART_SEARCHED =
  'That map is the old Beacon road. '
  + 'It runs north out of this camp. '
  + 'Follow the stones. I will hold things here.';

// After the Beacon. Honest in the one way that matters: Rowan does NOT hand over the Wildwood Blade,
// because finding a cold Beacon is not waking it and nothing in this slice can wake it. What they do
// is confirm what the child just saw, which is the whole payoff for walking back.
export const ROWAN_LINE_BEACON_FOUND =
  'So it really has gone out. '
  + 'You saw it. That is more than I had. '
  + 'Rest here. We will need more than this.';

/** The line for Rowan's own state: three now, in the order the child earns them. */
export function rowanLineFor(cartSearched, beaconFound = false) {
  if (beaconFound === true) return ROWAN_LINE_BEACON_FOUND;
  return cartSearched === true ? ROWAN_LINE_CART_SEARCHED : ROWAN_LINE_INTRO;
}

/**
 * Proximity edge + line selection + show/hide, one pure read -- same shape as keeperSpeechState,
 * reused rather than re-derived because main.js shares ONE speech bubble between the two NPCs (they
 * stand tens of metres apart and can never both be in range at once).
 */
export function rowanSpeechState({
  heroX, heroZ, rowanX, rowanZ, radiusMeters, cartSearched, beaconFound = false,
}) {
  const distance = Math.hypot(heroX - rowanX, heroZ - rowanZ);
  if (distance > radiusMeters) return { visible: false, line: null };
  return { visible: true, line: rowanLineFor(cartSearched, beaconFound) };
}
