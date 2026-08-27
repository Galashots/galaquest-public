// test/beacon-ignite-late-zone.test.mjs
//
// THE CLIENT-SIDE HALF of the playtest's multiplayer bug: the shared siege/beacon-lit state itself
// is proven sound at the server (test/beacon-siege-multiplayer.test.mjs, test/beacon-arena-handoff
// .test.mjs, test/beacon-persistence-latch.test.mjs) -- every connected child's snapshot and every
// late joiner's welcome already carry the SAME beaconLit:true and the SAME burst seals. What is not
// proven by any of that is whether a client that RECEIVES that true frame actually draws it, and
// main.js's own G3 payoff had exactly the bug the Lantern Tree's relight already found and fixed one
// arc earlier (see main.js's own rewardsForRelight/relightSpent comment): a one-shot latch spent the
// instant `siegeState.beaconLit` turns true, whether or not `zoneOldBeacon` (the Beacon's own GLB,
// loaded asynchronously off `zone.ready`) exists yet to act on.
//
// A snapshot saying the Beacon is lit routinely lands before a slower device's zone has finished
// loading -- a second child on a second iPad, a cold asset cache, the two arriving in the "wrong"
// order. If the latch closes on that frame regardless, `zoneOldBeacon.ignite()` is a call that never
// happens (the frame it WOULD have fired, the presenter was still null) and `beaconLitSeen` stays
// true forever after -- nothing ever retries it. That child's Beacon stays visibly, permanently
// unlit for the rest of the session even though the shared world -- and every OTHER child's screen
// -- has it burning. That is "Luke saw it light; Henrik's stayed cold" without the server ever
// disagreeing with itself.
//
// main.js is the integration file, not a pure module -- this is a source-seam regression guard, the
// same shape test/beacon-persistence-latch.test.mjs already takes for the sibling bug in
// gameServerCore.mjs's own beacon-lit latch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the Beacon ignition latch only closes once there is a Beacon to ignite', () => {
  const source = readFileSync(new URL('../public/src/main.js', import.meta.url), 'utf8');
  const block = source.match(
    /if \(siegeState\.beaconLit && !beaconLitSeen[^)]*\) \{([\s\S]*?)\n {4}\}/,
  )?.[1] ?? '';

  assert.ok(block.length > 0, 'could not find the Beacon ignition block in main.js');
  assert.ok(block.includes('beaconLitSeen = true'), 'the ignition latch itself has moved or been renamed');
  // The bug this guards: `if (siegeState.beaconLit && !beaconLitSeen) { beaconLitSeen = true;
  // zoneOldBeacon?.ignite(); ... }` -- the latch closes UNCONDITIONALLY, so a null zoneOldBeacon (zone
  // still loading) spends the one shot on nothing and the Beacon never lights on that client again.
  assert.match(
    source.match(/if \(siegeState\.beaconLit && !beaconLitSeen[\s\S]{0,40}/)?.[0] ?? '',
    /zoneOldBeacon\)/,
    'the ignition latch must not close before confirming zoneOldBeacon actually exists -- a late/slow '
      + 'zone load must retry next frame, not spend the one-shot on a presenter that is not there yet',
  );
  // And once it DOES close, it must act on a real presenter, not the same optional-chained no-op
  // that let the original bug slip through review.
  assert.match(block, /zoneOldBeacon\.ignite\(\)/,
    'the ignite() call itself must run against a confirmed zoneOldBeacon, not `zoneOldBeacon?.ignite()`');
});
