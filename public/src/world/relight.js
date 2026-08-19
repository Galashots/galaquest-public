// public/src/world/relight.js
//
// The Lantern Tree's relight, as a TIMELINE and nothing else. Pure: no three.js, no DOM, no clock.
// world/zoneLoader.js owns the lights, the sprites and the motes; this file owns *when* each of
// them is where, so the beat can be tuned and tested without a browser.
//
// Why the moment needed building at all, from looking at the running game rather than the code:
// the shipped relight was one instruction -- point light 0 -> 22, emissive warmed -- applied on
// whatever frame the third mark landed. Two things were wrong with that, both visible in
// .local/runtime-test/relight-{fresh-dark,unlocked-lit}-tree.png side by side.
//
//   1. It was INVISIBLE. The wolf spawns at (2.5, 8) and the tree stands at (-6.5, -6.5), about
//      18 m apart, with the camera behind the hero. A child kills their third wolf facing the
//      wilderness and the payoff for the entire quest happens behind their back. main.js now holds
//      the ceremony until the tree is actually in front of them (RELIGHT_TRIGGER_RADIUS_METERS).
//   2. It read as AUTUMN, not as light. Warming one merged material's emissive turns the whole
//      canopy orange in one frame -- the before/after looks like the leaves changed season. What
//      says "the light came back" is light ARRIVING: it climbs the trunk, blooms in the canopy
//      with an overshoot, and then runs out along the village's own street lanterns.
//
// Timings are taste, tuned by watching it, and are meant to be edited. The shape is not: rise,
// bloom past the target, settle, then spread outward. Every reference for a "the light returns"
// beat (Ori's spirit trees, Sky's relit lamps, Zelda's lit torches) overshoots and settles rather
// than switching on, because a light that arrives at exactly its final value reads as a switch.

export const TRUNK_RISE_START = 0;
export const TRUNK_RISE_END = 0.9;
export const CANOPY_BLOOM_START = 0.7;
export const CANOPY_PEAK = 1.35;
export const CANOPY_SETTLE_END = 2.2;
export const MOTES_FADE_START = 0.9;
export const MOTES_FADE_END = 1.9;
export const LANTERN_CHAIN_START = 1.2;
export const LANTERN_CHAIN_INTERVAL = 0.18;
export const RELIGHT_SECONDS = 3.4;

// How far past its steady intensity the canopy swells before settling back. 1.0 would be a switch.
export const CANOPY_OVERSHOOT = 1.55;

/** 0 at `from`, 1 at `to`, clamped outside, and 0 for a degenerate window rather than NaN. */
export function ramp(value, from, to) {
  if (!(to > from)) return value >= to ? 1 : 0;
  if (value <= from) return 0;
  if (value >= to) return 1;
  return (value - from) / (to - from);
}

/** Smoothstep on an already-normalised 0..1 -- eases both ends, which is what stops the trunk
 *  light setting off and stopping like a lift. */
export function ease(t01) {
  const t = t01 < 0 ? 0 : t01 > 1 ? 1 : t01;
  return t * t * (3 - 2 * t);
}

/**
 * Everything the presenter needs for one frame of the ceremony, from elapsed seconds alone.
 *
 *   trunkRise01     0..1 up the trunk; 0 before it starts, 1 once it has arrived in the canopy
 *   trunkGlow01     the travelling light's own brightness -- it fades out as the canopy takes over,
 *                   so the two never read as two separate lamps
 *   canopy01        multiplier on the canopy's steady intensity: 0, up past CANOPY_OVERSHOOT, then
 *                   settling to exactly 1
 *   motes01         fade-in for the drifting light motes; they stay at 1 forever after
 *   lanternsLit     how many street lanterns have caught, in the order the caller supplies them
 *   done            the ceremony has finished and the steady lit state is now correct
 */
export function relightBeats(elapsedSeconds, lanternCount = 0) {
  const t = elapsedSeconds > 0 ? elapsedSeconds : 0;
  const trunkRise01 = ease(ramp(t, TRUNK_RISE_START, TRUNK_RISE_END));
  // Rises with the light, then hands over: full while climbing, gone by the canopy's peak.
  const trunkGlow01 = t <= TRUNK_RISE_END
    ? ease(ramp(t, TRUNK_RISE_START, TRUNK_RISE_END * 0.6))
    : 1 - ease(ramp(t, TRUNK_RISE_END, CANOPY_PEAK));

  let canopy01;
  if (t <= CANOPY_BLOOM_START) canopy01 = 0;
  else if (t <= CANOPY_PEAK) canopy01 = CANOPY_OVERSHOOT * ease(ramp(t, CANOPY_BLOOM_START, CANOPY_PEAK));
  else canopy01 = CANOPY_OVERSHOOT + (1 - CANOPY_OVERSHOOT) * ease(ramp(t, CANOPY_PEAK, CANOPY_SETTLE_END));

  const motes01 = ease(ramp(t, MOTES_FADE_START, MOTES_FADE_END));

  const lanternsLit = lanternCount <= 0 ? 0 : Math.max(0, Math.min(
    lanternCount,
    Math.floor((t - LANTERN_CHAIN_START) / LANTERN_CHAIN_INTERVAL) + 1,
  ));

  return { trunkRise01, trunkGlow01, canopy01, motes01, lanternsLit, done: t >= RELIGHT_SECONDS };
}

/** How long the whole ceremony runs, including the last street lantern -- so a caller sizing a
 *  banner or a harness sizing a wait never has to add the two up by hand and get it wrong. */
export function relightDurationSeconds(lanternCount = 0) {
  const chainEnd = lanternCount <= 0
    ? 0
    : LANTERN_CHAIN_START + LANTERN_CHAIN_INTERVAL * Math.max(0, lanternCount - 1);
  return Math.max(RELIGHT_SECONDS, chainEnd);
}
