/**
 * Which harnesses each review suite runs, and whether their exit code means anything.
 *
 * Pure data, in its own module so `test/review-suite.test.mjs` can check it without importing
 * `run-review-suite.mjs` -- that file has top-level await and starts a browser the moment it loads.
 *
 * `gate` is not decoration. Three of the fit-* tools end in an unconditional `process.exit(0)`
 * because they are measuring instruments that report offsets, not gates that pass or fail. Treating
 * their exit code as a verdict would report a permanently green suite forever, which is worse than
 * having no check at all. Their evidence is the baked JSON and the captures, which a reviewer reads.
 */

export const HARNESSES = {
  'drive-village': { gate: true, why: 'zone loads, keeper waves, composition captures' },
  'drive-relight': { gate: true, why: 'lantern-tree relight state and its captures' },
  'drive-lifecycle': { gate: true, why: 'boot/teardown and context-loss survival' },
  'drive-marks': { gate: true, why: 'reward loop end to end' },
  'drive-touch': { gate: true, why: 'real touch input on a phone-sized viewport' },
  'drive-two-clients': { gate: true, why: 'two heroes on one server' },
  'play-fight': { gate: true, why: 'server-authoritative combat, separation and convergence' },
  'drive-hero-screen': { gate: true, why: 'GP1 Hero screen: open, compare, equip via a real server round trip, portrait and landscape' },
  'drive-cart-loot': { gate: true, why: 'GP2 cart loot: search, burst, HUD-gated collection, and a two-client double-collect proof, portrait and landscape' },
  'drive-village-board': { gate: true, why: 'GP3 Village Board: Workshop I purchase, 3D transformation, shared-balance two-client and race proofs, and a real server restart, portrait and landscape' },
  'drive-profile-gate': { gate: true, why: 'Stage 1 family profile gate: name a first hero, add a sibling, switch, reload, per-child isolation, the four-hero cap, two-tap remove, and the 44px tap floor, portrait and landscape' },
  'drive-old-beacon': { gate: true, why: 'G1 Old Beacon road: the whole approach walked with the stick, visibility before arrival, one-shot arrival, honest post-arrival objective, world edge, portrait, landscape, reduced motion and a reload' },
  'fit-shield': { gate: true, why: 'shield carry fit; exits non-zero when its own bake is untrustworthy' },
  'fit-sword': { gate: false, why: 'sword carry measurement; always exits 0 by design' },
  'fit-carry': { gate: false, why: 'carry-pose measurement; always exits 0 by design' },
  'fit-lantern': { gate: false, why: 'lantern mount measurement; always exits 0 by design' },
  // Wave 1A (CSB): Character-Studio-only, not the running game -- drives public/studio.html rather
  // than main.js, but is otherwise the same measuring-instrument contract as its fit-* neighbours.
  'fit-wildwood-blade': { gate: false, why: 'Wildwood Blade candidate mount measurement; always exits 0 by design' },
  // A1 Studio convergence: Character-Studio-only behavioural gate -- loadout switching matches the
  // descriptors, one-sword rule, deterministic views, fail-closed unknown states, panel occlusion
  // bounds at both orientations. Its captures are evidence for a person; its exit code judges only
  // the behavioural invariants, never appearance.
  'review-studio': { gate: true, why: 'Character Studio review states, deterministic views, and responsive panel invariants, portrait and landscape' },
  // Owner Review Mode: verifies the client-only annotation/export workflow against a real WebGL
  // Studio frame. It gates mechanics (exact context, pointer marks, PNG capture, invalidation and
  // responsive panel bounds) but its screenshots remain human evidence rather than appearance PASS.
  'review-owner-annotations': { gate: true, why: 'Owner Review annotation packet mechanics and exact-state binding, portrait and landscape' },
  // AP1's two artist-review cameras. Both are instruments, not gates: their product is the captures
  // and a per-frame record, and a person decides what those show. A green exit code from either
  // would be a claim that somebody has LOOKED, which is exactly the thing a script cannot assert.
  'review-keeper-idle': { gate: false, why: 'keeper idle contact sheet; always exits 0 by design' },
  'review-hero-attack': { gate: false, why: 'hero attack strip + per-frame record; always exits 0 by design' },
  // AP2-A's surface probe. Same reason as the two above, plus one of its own: three of its four
  // variants are deliberately WRONG, photographed so a reviewer can see which surface is right.
  'review-keeper-material': { gate: false, why: 'keeper surface A/B variants; always exits 0 by design' },
  // AP2-A's turn-clip proof. tools/foundry/diagnose_keeper_turn.mjs already gates on convergence and
  // drift offline; this is the visual half, same "captures, not a verdict" contract as its neighbours.
  'review-keeper-turn': { gate: false, why: 'keeper native-turn six-scenario captures; always exits 0 by design' },
  // AP2-A item 5: hero Idle_11 raw-vs-IDLE_ARM_SETTLE A/B, fully geared. Same instrument contract.
  'review-hero-idle11': { gate: false, why: 'hero idle11 raw-vs-settled captures; always exits 0 by design' },
  // The pre-integration artist's review, taken from the EXACT shipping GLBs rather than an injected
  // candidate. Same instrument contract as its neighbours -- it photographs hero and Keeper at both
  // scales and drives the greeting/talk sequence, and a person says what the captures show.
  'review-shipping-assets': { gate: false, why: 'pre-merge hero+Keeper review sheet; always exits 0 by design' },
  // Rowan camp asset audit: injects Meshy candidates into the real running camp over CDP and
  // captures whole-camp current-vs-candidate, both orientations. Same instrument contract -- a
  // person reads the captures and Sol's own visual ruling, not this harness's exit code.
  'review-rowan-camp-composite': { gate: false, why: 'rowan camp whole-camp current-vs-candidate composite; always exits 0 by design' },
  // G2..G5's own end-to-end play-through: walk to the Beacon, break all three cold seals with real
  // taps on ATTACK, fight the Warden to the death, watch the Beacon catch. A GATE, and firmly so --
  // every check in it is a question about BEHAVIOUR that a script can answer honestly (did the seal
  // burst, did the boss bar name the thing, did the fire latch, did the chip finally point home),
  // never about how any of it looks. Its captures are the human evidence; its exit code is not a
  // claim that anybody has looked at them.
  'drive-beacon-siege': { gate: true, why: 'the whole Beacon arc played end to end: seals, Warden, ignition, and the objective chain' },
  'drive-ranger': { gate: true, why: 'the Beacon is answered: Wren is standing in the village because of it, takes her brother\'s satchel, and the charm puts a fourth heart on the bar that survives a reload' },
};
/**
 * `full` is deliberately every RUNNING-GAME harness and nothing else. It is not "the whole test
 * suite" -- `test.yml` already owns the unit suite on every push, and duplicating it here would
 * spend ten minutes of real browser time re-proving something already proven in eight seconds.
 */
export const SUITES = {
  keeper: ['drive-village', 'drive-relight', 'review-keeper-idle', 'review-keeper-material', 'review-keeper-turn', 'review-shipping-assets'],
  hero: ['fit-carry', 'fit-sword', 'fit-shield', 'fit-lantern', 'fit-wildwood-blade', 'play-fight', 'review-hero-attack', 'review-hero-idle11', 'review-shipping-assets', 'review-studio', 'review-owner-annotations', 'drive-hero-screen'],
  full: [
    'drive-village', 'drive-relight', 'drive-lifecycle', 'drive-marks', 'drive-touch',
    'drive-two-clients', 'play-fight', 'fit-carry', 'fit-sword', 'fit-shield', 'fit-lantern',
    'fit-wildwood-blade', 'review-keeper-idle', 'review-hero-attack', 'review-keeper-material',
    'review-keeper-turn', 'review-hero-idle11', 'review-shipping-assets', 'review-rowan-camp-composite',
    'review-studio', 'review-owner-annotations', 'drive-hero-screen', 'drive-cart-loot',
    'drive-village-board', 'drive-old-beacon', 'drive-beacon-siege', 'drive-ranger',
    'drive-profile-gate',
  ],
};
