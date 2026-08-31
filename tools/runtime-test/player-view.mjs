/**
 * WHAT A PLAYER COULD KNOW, and deliberately nothing else.
 *
 * WHY THIS MODULE EXISTS, stated as the failure it prevents rather than as a preference.
 *
 * Every other harness in this directory reads `window.__galaQuestRuntime` for PRIVILEGED TRUTH, and
 * that is correct for what they do: an assertion about the fight wants the server's own numbers, not
 * a guess read off a screenshot. `encounterState()` hands over every enemy's exact hp, its patrol
 * route, its leash radius and its home; `netState()` hands over the authoritative position the
 * client has not rendered yet; `rewards()` hands over the drop table's outcome.
 *
 * A PLAYTEST AGENT FED THAT IS NOT PLAYTESTING. It is running an optimizer over the rules with the
 * answer key open. It will kite a wolf using a leash radius no child can see, break off at 3 hp it
 * has no way to read, and then report that the fight is too easy. That report is not a weak signal;
 * it is a false one, and it is false in the specific direction that makes it dangerous -- it says
 * "easier than it is" about a game tuned for a seven-year-old.
 *
 * So this module builds a PROJECTION. It reads the same privileged accessors (there is no other
 * source) and throws almost all of it away, keeping only what survives the question:
 *
 *     could a child sitting in front of this iPad know this, right now, by looking and listening?
 *
 * Three consequences, each of which is a rule the rest of the file obeys:
 *
 *   1. NUMBERS BECOME BUCKETS. A child does not read `hp: 34`. They see a bar that is getting short.
 *      `healthBucket` is the whole of what leaves this module about the hero's health, and enemy hp
 *      does not leave it at all -- the game draws no enemy health bar outside the boss bar, so an
 *      agent that knew a wolf was nearly dead would know something the screen never said.
 *
 *   2. WORLD COORDINATES BECOME SCREEN POSITIONS. An entity the camera is not pointing at does not
 *      appear in the view, because it does not appear on the screen. This is the single biggest
 *      behavioural difference from a scripted harness: `startWalk` steers by world `{x, z}` and is
 *      right to, but an agent given world coordinates navigates by dead reckoning through walls it
 *      cannot see, and never once experiences being lost. Being lost is a finding.
 *
 *   3. STATE THE UI DOES NOT DRAW IS ABSENT ENTIRELY. Not redacted, not bucketed -- absent. The
 *      allowlist below is the enforcement point and test/playtest-player-view.test.mjs fails the
 *      build if a privileged accessor name reappears in the generated source.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not judge anything. It does not decide whether the
 * view is good, whether the fight is fair, or whether the zone is pretty. It is the eyes only; the
 * verdict belongs to whoever is on the other end of the session, and per AGENTS.md an agent's
 * verdict about APPEARANCE can reject and can never accept.
 */

/** Metres. Past this an entity is reported as present-but-distant rather than with a finer bucket;
 *  a child judges "over there somewhere" long before they judge "11.4 metres". */
const FAR_METRES = 18;
const NEAR_METRES = 8;
const CLOSE_METRES = 3;

/**
 * The accessors a player-fair view must never reach. Asserted against the generated source by
 * test/playtest-player-view.test.mjs, so adding a leak here is a red test rather than a quiet
 * change in what the agent is allowed to know.
 *
 * `encounterState` is the deliberate exception and is NOT on this list because it supplies the
 * hero's published health. It is never used to disclose an enemy: enemy labels and screen positions
 * come from the visible nameplate DOM instead.
 */
export const FORBIDDEN_VIEW_ACCESSORS = Object.freeze([
  'authoritativeEncounterState',
  'authoritativeDownObserved',
  'authoritativeRecoveryProtectionSeconds',
  'netState',
  'rewards',
  'lootState',
  'villageState',
  'equippedWeaponMeshState',
  'heroPreviewState',
  'enemyPresenters',
  'zoneDebug',
  'guestId',
  'rewardEvents',
]);

/**
 * Hero health as a child reads it off the bar: four states, because the bar has roughly four
 * legible states and because the decision a player makes ("keep swinging" vs "back off") does not
 * turn on finer resolution than that.
 *
 * Exported and pure so the bucket boundaries are testable without a browser -- the whole point of
 * putting the numbers here rather than inline in a template string.
 */
export function healthBucket(hp, maxHp) {
  if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) return 'unknown';
  const fraction = hp / maxHp;
  if (fraction <= 0) return 'down';
  if (fraction <= 0.25) return 'critical';
  if (fraction <= 0.6) return 'hurt';
  return 'healthy';
}

/**
 * How far away a thing looks. Buckets rather than metres for the same reason healthBucket exists:
 * an agent handed 11.4 will do arithmetic with it, and a child cannot.
 */
export function distanceBucket(metres) {
  if (!Number.isFinite(metres)) return 'unknown';
  if (metres <= CLOSE_METRES) return 'right-there';
  if (metres <= NEAR_METRES) return 'near';
  if (metres <= FAR_METRES) return 'far';
  return 'distant';
}

/**
 * JS source installing `window.__gqPlayerView()` in the page.
 *
 * Returns SOURCE rather than doing the work, for the reason in-page-driver.mjs states in its own
 * header: this module must not know what a CDP page object looks like, because each harness here
 * wraps CDP differently and they are allowed to keep differing.
 *
 * The installed function is idempotent and side-effect free with respect to the product. It reads
 * published accessors and the DOM. It sets nothing, calls no rule, and mutates no gameplay value.
 * The one piece of state it keeps is its own previous audio counter, so it can answer "what did you
 * hear SINCE THE LAST TIME YOU LOOKED" rather than "how many noises have ever happened", which is
 * the difference between a sound being an event and a sound being a running total.
 */
export function installPlayerViewSource() {
  return `(() => {
  const NEAR = ${NEAR_METRES}, CLOSE = ${CLOSE_METRES}, FAR = ${FAR_METRES};
  const healthBucket = (hp, maxHp) => {
    if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) return 'unknown';
    const f = hp / maxHp;
    if (f <= 0) return 'down';
    if (f <= 0.25) return 'critical';
    if (f <= 0.6) return 'hurt';
    return 'healthy';
  };
  const distanceBucket = (m) => {
    if (!Number.isFinite(m)) return 'unknown';
    if (m <= CLOSE) return 'right-there';
    if (m <= NEAR) return 'near';
    if (m <= FAR) return 'far';
    return 'distant';
  };

  // Every sound the engine has triggered, last time anyone looked. audioDebug().triggered is a
  // CUMULATIVE count per recipe; a player experiences the DIFFERENCE.
  let heardBefore = {};

  // Projecting a world point to the screen without importing three.js: clone a Vector3 that already
  // exists (the hero's own position) and reuse it as scratch. .project() is on the prototype, so the
  // clone carries it, and this avoids the harness needing a module handle the page never exported.
  const project = (runtime, x, y, z) => {
    const v = runtime.player.position.clone();
    v.set(x, y, z);
    v.project(runtime.camera);
    return v;
  };

  /** Text a player can actually read this instant: leaf elements with their own text, visible, not
   *  transparent, and inside the viewport.
   *
   *  A selector allowlist was the first attempt and was wrong -- it silently answered "no text on
   *  screen" for every element nobody had thought to list, which is the blind spot a fresh-eyes
   *  tester exists to find.
   *
   *  CHECKING THE LEAF ALONE WAS THE SECOND ATTEMPT, AND WAS WORSE. Measured on the first real
   *  session (step 1, village spawn): it reported "LEVEL UP!", "Who is playing?", "RUNE CHEST",
   *  "Shield", "Helmet" and the whole hero panel as readable, because every one of those is a leaf
   *  with its own text whose HIDDEN ANCESTOR was the thing keeping it off the screen. That is not a
   *  cosmetic inaccuracy: an agent told the screen says LEVEL UP at spawn is being lied to about the
   *  one channel it has, and every finding after that point is downstream of the lie.
   *
   *  So visibility is asked of the whole ancestor chain via checkVisibility (which is what its
   *  checkOpacity/checkVisibilityCSS options are for), and the rect must actually intersect the
   *  viewport -- a panel parked off-canvas at x:-9999 is laid out, sized, and not on screen. */
  const readable = () => {
    const out = [];
    const seen = new Set();
    for (const el of document.body.querySelectorAll('*')) {
      if (el.children.length > 0) continue;
      const text = (el.textContent || '').trim().replace(/\\s+/g, ' ');
      if (!text || text.length > 300) continue;
      if (typeof el.checkVisibility === 'function'
        && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (Number(style.opacity) < 0.05) continue;
      const box = el.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      if (box.bottom <= 0 || box.right <= 0) continue;
      if (box.top >= window.innerHeight || box.left >= window.innerWidth) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
    return out;
  };

  window.__gqPlayerView = () => {
    const r = window.__galaQuestRuntime;
    if (!r || !r.hero) return { ready: false };

    const encounter = r.encounterState();
    const hero = encounter && encounter.hero ? encounter.hero : null;
    const heroPos = r.player.position;
    const screen = { w: window.innerWidth, h: window.innerHeight };

    // WHAT IS ON SCREEN. Enemy presence comes only from the rendered nameplate DOM, never from an
    // encounter snapshot projected through the scene. That fails closed for occlusion: an enemy
    // behind a building with no visible label is absent rather than leaked to the agent. The card's
    // name and rectangle are ordinary player-visible pixels, so the nameplate can speak for itself
    // without handing over its backing enemy id, hp, or world coordinates. Other literal visible
    // nameplate text remains in the read channel, not as privileged structured entity state.
    const see = [];
    for (const plate of document.querySelectorAll('.enemy-nameplate')) {
      if (typeof plate.checkVisibility === 'function'
        && !plate.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const style = getComputedStyle(plate);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.05) continue;
      const box = plate.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      if (box.bottom <= 0 || box.right <= 0 || box.top >= screen.h || box.left >= screen.w) continue;
      const name = (plate.querySelector('.enemy-nameplate-name')?.textContent || '')
        .trim().replace(/\\s+/g, ' ');
      if (!name) continue;
      see.push({
        what: name.toLowerCase(),
        xPct: Math.round(((box.left + (box.width / 2)) / screen.w) * 100),
        yPct: Math.round(((box.top + (box.height / 2)) / screen.h) * 100),
        // Screen pixels reveal no reliable metres without reading world state, so do not invent it.
        distance: 'unknown',
      });
    }
    // THE CHARACTERS STANDING AROUND. Found by scene-node name rather than through a per-zone
    // accessor, because there is no accessor for them and adding one per zone would make this
    // module know about village.js. Discovered by running: the first session's spawn view reported
    // an empty screen while the capture plainly showed five villagers, the Keeper and the pet. An
    // agent told nobody is here, looking at a screen full of people, does not report a perception
    // gap -- it reports that the village is deserted.
    //
    // The labels are deliberately what a CHILD sees, not what the code calls them. A villager and
    // the Keeper are both "a person" until you are close enough for the game to name him, which is
    // exactly the information a player has. The one thing that legitimately distinguishes the
    // Keeper at a distance is the marker drawn above his head, and that is on screen, so it is here.
    const label = (name) => {
      if (name === 'keeper') return 'person';
      if (/^villager-\\d+$/.test(name)) return 'person';
      if (name === 'prototype-companion') return 'small animal';
      return null;
    };
    const keeperMarker = Boolean((r.zoneKeeperState() || {}).questMarker);
    r.scene.traverse((node) => {
      const kind = label(node.name);
      if (!kind || node.visible === false) return;
      const world = r.player.position.clone();
      node.getWorldPosition(world);
      const wx = world.x;
      const wz = world.z;
      const ndc = project(r, wx, 1, wz);
      if (ndc.z >= 1 || ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1) return;
      const metres = Math.hypot(wx - heroPos.x, wz - heroPos.z);
      see.push({
        what: kind === 'person' && node.name === 'keeper' && keeperMarker
          ? 'a person with a mark above them'
          : (kind === 'person' ? 'a person' : 'a small animal'),
        xPct: Math.round(((ndc.x + 1) / 2) * 100),
        yPct: Math.round(((1 - ndc.y) / 2) * 100),
        distance: distanceBucket(metres),
      });
    });

    for (const d of (r.dropsOnGround() || [])) {
      if (!Number.isFinite(d.x) || !Number.isFinite(d.z)) continue;
      const ndc = project(r, d.x, 0.5, d.z);
      if (ndc.z >= 1 || ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1) continue;
      const metres = Math.hypot(d.x - heroPos.x, d.z - heroPos.z);
      see.push({
        what: 'something on the ground',
        xPct: Math.round(((ndc.x + 1) / 2) * 100),
        yPct: Math.round(((1 - ndc.y) / 2) * 100),
        distance: distanceBucket(metres),
      });
    }

    // WHAT WAS HEARD SINCE THE LAST LOOK. Recipe names are the engine's vocabulary, not a child's,
    // but they are what the ear actually got and renaming them here would be inventing a fiction
    // about the audio design. They go through as-is.
    const triggered = (r.audioDebug() || {}).triggered || {};
    const heard = [];
    for (const name of Object.keys(triggered)) {
      const delta = (triggered[name] || 0) - (heardBefore[name] || 0);
      for (let i = 0; i < delta && i < 8; i += 1) heard.push(name);
    }
    heardBefore = { ...triggered };

    const spokenAll = window.__gqSpoken || [];
    const spokenSince = spokenAll.length - (window.__gqSpokenSeen || 0);
    window.__gqSpokenSeen = spokenAll.length;

    return {
      ready: true,
      health: healthBucket(hero && hero.hp, hero && hero.maxHp),
      // Visible on screen as the knocked-out veil, so a player unambiguously knows it.
      down: r.heroDownShown(),
      screen,
      read: readable(),
      see,
      heard,
      spoken: spokenSince > 0 ? spokenAll.slice(-spokenSince) : [],
    };
  };
  return true;
})()`;
}

/** JS source calling the installed view. Separate from installation so a session installs once and
 *  looks many times, and so a look costs one Runtime.evaluate rather than re-parsing the installer. */
export const READ_PLAYER_VIEW = 'JSON.stringify(window.__gqPlayerView())';
