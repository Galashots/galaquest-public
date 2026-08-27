// R1-C2, D7: CEREMONY PRIORITY. Level-up is the strongest routine progression celebration the game
// has (docs/product/PRODUCT_VISION.md's own settled invariant, restated in this package's brief: "if
// one enemy life yields both a level-up and a gear choice, level-up has presentation priority and the
// gear choice waits/persists rather than stacking over it"). This is the one narrow piece of policy
// that makes that true whenever both happen to land in the same beat, instead of trusting main.js's
// two independent diff-driven ceremonies (the Blade's, the Helmet's -- and, once G2 populates the
// ordinary-drop pool, a third) to never race each other.
//
// Pure by the same discipline every other module under rewards/ keeps: no DOM, no timers, no `import`
// of anything that touches a screen. main.js owns WHEN a level-up starts and ends and WHAT a gear card
// looks like; this only decides WHETHER a requested gear ceremony may play right now, which is why it
// is unit-testable with nothing but function calls (see test/progression-r1-c2.test.mjs).
//
// A QUEUE, not a lock: a gear ceremony asked for while something else is showing is HELD, never
// dropped, and is released the moment the thing blocking it ends -- "the gear card waits and still
// arrives", not "the gear card is skipped". Two gear ceremonies requested back-to-back while blocked
// queue in FIFO order and are released one at a time, each only after the caller reports the previous
// one has actually finished (gearCeremonyEnded) -- so a queued gear card is never shown stacked on
// top of another gear card either, the identical "never stacks" rule this gate already enforces
// against a level-up.
//
// SCOPE, stated honestly: this gate only understands "is something currently occupying the screen",
// tracked as one flag. It does not know whether a level-up interrupting an ALREADY-SHOWING gear card
// is itself a real production path (it is not, today: both ceremonies are diffed once per frame off
// rare, independent state changes, so the two beginning in the same frame -- the case this gate
// exists for -- is the reachable one). Solving that harder interruption case is not this package's
// job; see the brief's own stop conditions on rewriting presentation frameworks.
const LEVEL_UP_CEREMONY = 'level-up';
const GEAR_CEREMONY = 'gear';

export function createCeremonyGate() {
  // WHICH ceremony currently owns the screen, or null. This was a bare `blocked` boolean, and a
  // boolean could not answer the question the two "ended" callbacks actually have to ask: ended
  // WHICH one? Both cleared the flag unconditionally, so a levelUpEnded() arriving after a gear
  // ceremony had already taken the screen freed it out from under that card and released the next
  // queued one straight over the top of it -- the exact stacking this module exists to prevent.
  // Naming the occupant makes that case a no-op by construction: an "ended" for something that is
  // not what is showing is not a state change.
  //
  // WHAT THIS STILL DOES NOT CATCH, stated plainly rather than left to be discovered: two successive
  // gearCeremonyEnded() calls are indistinguishable to this gate, because `showing` names the KIND of
  // ceremony and not WHICH gear card. A caller that reports one card finished twice therefore still
  // releases the next one early. Closing that needs a per-ceremony handle rather than a shared
  // callback, which changes this module's API and main.js's wiring with it -- disproportionate while
  // the real caller cannot do it: ui/unlockCard.js's hide() nulls its `done` before invoking it, so
  // one card reports done exactly once. If a future ceremony type does not carry that guarantee,
  // give this gate a handle instead of assuming the caller is careful.
  let showing = null;
  const queue = [];

  /** Call the moment the level-up ceremony starts showing. */
  function levelUpStarted() {
    showing = LEVEL_UP_CEREMONY;
  }

  /** Call the moment the level-up ceremony ends (hides/dismisses). Releases the next queued gear
   *  ceremony, if any -- see release() below for what "releases" means. Ignored unless the level-up
   *  is what is actually showing, so a duplicate call cannot free the screen out from under a gear
   *  ceremony that has since taken it. */
  function levelUpEnded() {
    if (showing !== LEVEL_UP_CEREMONY) return;
    showing = null;
    release();
  }

  /** Call once a released gear ceremony has ACTUALLY finished (its own onDone) -- not when it is
   *  merely requested. Only this unblocks the gate for a SECOND queued gear ceremony to play; without
   *  it, two back-to-back grants would show their cards on top of each other the instant the first is
   *  requested. Ignored unless a gear ceremony is what is actually showing -- see `showing` above for
   *  the one duplicate case this deliberately still does not catch, and why. */
  function gearCeremonyEnded() {
    if (showing !== GEAR_CEREMONY) return;
    showing = null;
    release();
  }

  function release() {
    if (showing !== null || queue.length === 0) return;
    const next = queue.shift();
    // Own showing IS a ceremony blocking the screen -- set before calling out, so a level-up that
    // starts synchronously inside the caller's own show() (it never does in main.js's real wiring,
    // but this gate does not get to assume that) still sees the gate as occupied.
    showing = GEAR_CEREMONY;
    next();
  }

  /**
   * Ask to show a gear ceremony. `show` is a zero-argument function that actually displays it --
   * main.js hands in a closure over its own unlockCard.show(...) call (plus whatever sound/speech
   * rides with it) so this module never needs to know what a gear card is. Called IMMEDIATELY if
   * nothing is currently showing; otherwise queued (never dropped) and released in order as whatever
   * is showing ends (levelUpEnded / gearCeremonyEnded).
   */
  function requestGearCeremony(show) {
    if (typeof show !== 'function') {
      throw new TypeError('requestGearCeremony needs a show() function to call when its turn comes');
    }
    queue.push(show);
    release();
  }

  return {
    levelUpStarted, levelUpEnded, gearCeremonyEnded, requestGearCeremony,
  };
}
