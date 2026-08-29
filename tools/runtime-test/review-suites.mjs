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
  'drive-drop-collect': { gate: true, why: 'the kill-drop pickup over the REAL socket: production drop ids survive collect-drop decode, the connection never closes, the playerId never changes, the hero is never reseated at spawn without an honest knockdown, and the screen never blinks (GQ-023)' },
  'drive-recovery': { gate: true, why: 'the recovery boundary through the real client: a Mark earned by killing a wolf survives the reward database being replaced with an empty one, is restored INTO that empty server, and a Mark earned with no server at all survives a reload' },
  'drive-guidance-rescue': { gate: true, why: 'Checkpoint 2 "never lost": turning away loses the objective off-camera, a tap on empty ground does NOT recover it, and the rescue button turns the camera back -- the recovery path itself, which nothing covered before' },
  'drive-old-beacon': { gate: true, why: 'G1 Old Beacon road: the whole approach walked with the stick, visibility before arrival, one-shot arrival, honest post-arrival objective, world edge, portrait, landscape, reduced motion and a reload' },
  'fit-shield': { gate: true, why: 'shield carry fit; exits non-zero when its own bake is untrustworthy' },
  'fit-sword': { gate: false, why: 'sword carry measurement; always exits 0 by design' },
  'fit-carry': { gate: false, why: 'carry-pose measurement; always exits 0 by design' },
  'fit-lantern': { gate: false, why: 'lantern mount measurement; always exits 0 by design' },
  'fit-helmet': { gate: false, why: 'G1-C3 Silverguard Helmet mount measurement + baked-value round-trip captures; exits 0/2 like its fit-* neighbours, never a verdict' },
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
  // P2's own end-to-end proof: a child one kill short of the Lantern earns it for real, watches the
  // XP meter complete, LEVELS UP, and walks away with a bigger body and a harder blow that BOTH
  // fights actually use -- then reloads and finds all of it still there with no ceremony replayed.
  // A GATE, and firmly so: every check in it is a question about behaviour a script can answer
  // honestly (did the level land, did the fight take the bigger blow, did hydration stay quiet),
  // never about how any of it looks. Its captures are the human evidence; its exit code is not a
  // claim that anybody has looked at them.
  'drive-first-level-up': { gate: true, why: 'the first Hero level earned on the real path: Lantern -> 100 XP -> Level 2 -> bigger body and harder blow in both fights, surviving a reload without replaying the ceremony' },
  'drive-e2-enemy': { gate: true, why: 'E2 enemy population, level-aware nameplates, leash return, safe recovery, portrait and landscape, and two-client isolation' },
  'drive-ranger': { gate: true, why: 'the Beacon is answered: Wren is standing in the village because of it, takes her brother\'s satchel, and the charm grows the health bar in a way that survives a reload' },
  // G1-C3's own end-to-end proof: a child owning no helmet is granted one mid-session, the acquisition
  // card fires with the real resolved POWER move and asks EQUIP NOW?, EQUIP NOW mounts it, the Hero
  // screen tells the truth about the Shield and Helmet slots, and a reload restores the worn pixels
  // WITHOUT replaying the ceremony. A GATE, and firmly so: every check is a question about behaviour a
  // script can answer honestly (did the card appear, did EQUIP mount it, did the reload stay quiet),
  // never about how it looks. Its captures are the human evidence; its exit code is not a claim anyone
  // has looked at them.
  'drive-helmet-vertical': { gate: true, why: 'the Silverguard Helmet vertical played end to end: mid-session grant, the acquisition card and its POWER move, EQUIP NOW mounts it, truthful Hero screen, and a reload that restores the worn Helmet without replaying the ceremony' },
  // #87's client presenter. Two halves with different honesty profiles, both real: the boot/DOM-
  // wiring checks (new imports load with zero uncaught exceptions, the Loot prompt/panel/toast layer
  // exist and start hidden/closed) are deterministic and always run. The deeper open/collect proof
  // fights a real, UNSEEDED server enemy to death repeatedly until a real gear roll produces a real
  // corpse claim -- there is deliberately no seed hook (the server must not special-case a harness's
  // own dice), so this half can legitimately go red on bad luck within its own time budget rather
  // than on a regression. A gate, not an instrument: the wiring half is a genuine regression signal,
  // and the file's own header records the exact real-kill/gear-roll counts this session's runs
  // produced, for a reader deciding whether a red run is bad luck or a real defect.
  'drive-corpse-loot': { gate: true, why: 'personal corpse loot client presenter, end to end and fully gating: a real fought kill spawns a real personal claim (contents fixtured through net/gameServerCore.mjs\'s opt-in guaranteedCorpseItemIds, so no unseeded gear roll decides whether this gate can run), then real touch dispatch drives glow/prompt -> panel -> individual TAKE -> Take All on the last item -> acquired-item toast and Hero-button pulse. No best-effort tier: a red run is a real regression' },
};
/**
 * `full` is deliberately every RUNNING-GAME harness and nothing else. It is not "the whole test
 * suite" -- `test.yml` already owns the unit suite on every push, and duplicating it here would
 * spend ten minutes of real browser time re-proving something already proven in eight seconds.
 */
export const SUITES = {
  keeper: ['drive-village', 'drive-relight', 'review-keeper-idle', 'review-keeper-material', 'review-keeper-turn', 'review-shipping-assets'],
  hero: ['fit-carry', 'fit-sword', 'fit-shield', 'fit-lantern', 'fit-helmet', 'fit-wildwood-blade', 'play-fight', 'review-hero-attack', 'review-hero-idle11', 'review-shipping-assets', 'review-studio', 'review-owner-annotations', 'drive-hero-screen'],
  full: [
    'drive-village', 'drive-relight', 'drive-lifecycle', 'drive-marks', 'drive-touch',
    'drive-two-clients', 'play-fight', 'fit-carry', 'fit-sword', 'fit-shield', 'fit-lantern',
    'fit-helmet', 'fit-wildwood-blade', 'review-keeper-idle', 'review-hero-attack', 'review-keeper-material',
    'review-keeper-turn', 'review-hero-idle11', 'review-shipping-assets', 'review-rowan-camp-composite',
    'review-studio', 'review-owner-annotations', 'drive-hero-screen', 'drive-cart-loot',
    'drive-village-board', 'drive-old-beacon', 'drive-beacon-siege', 'drive-ranger',
    'drive-profile-gate', 'drive-recovery', 'drive-guidance-rescue', 'drive-first-level-up',
    'drive-e2-enemy', 'drive-helmet-vertical', 'drive-drop-collect', 'drive-corpse-loot',
  ],
};
