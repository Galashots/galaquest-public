// public/src/world/corpseLootPresenter.js
//
// #87's CLIENT half. world/corpseLoot.js and net/gameServerCore.mjs own the law -- who is eligible,
// what rolled, what taking an item actually grants; net/protocolCore.js's decodeCorpses is what
// carries that law's own state onto the wire, unfiltered (every corpse, every hero's claim, sent to
// every client -- see corpsesSnapshot's own comment in net/gameServerCore.mjs for why that is not a
// privacy boundary this codebase has ever drawn).
//
// This file is the seam that keeps that broadcast honest on the way INTO the UI: it decides what ONE
// hero should see glow, which single corpse is close enough to open, what a panel should list, and
// which items just became theirs -- and it is the reason a sibling's claim can never leak into this
// hero's glow, prompt or panel, even though the wire handed every claim to both tabs. The server
// still enforces isolation for the only thing that actually matters (collection itself,
// requestClaimCorpseItem/requestClaimAllCorpseLoot's own heroId-scoped lookup); this is the second,
// independent place that same isolation is provable, and it is provable with no server at all.
//
// PURE: no DOM, no three.js, no clock, no I/O -- ui/corpseLootPanel.js and world/corpseGlowPresenter.js
// own the browser half, main.js wires them to this file's own outputs every frame, the same
// pure-viewmodel/DOM split unlockCard.js documents for its own two halves.

import { CORPSE_COIN_KIND, CORPSE_LOOT_INTERACT_RADIUS_METERS } from './corpseLoot.js';
import {
  HELMET_SLOT, SHIELD_SLOT, SHOULDERS_SLOT, WEAPON_SLOT, itemDef,
} from '../progression/items.js';

export { CORPSE_LOOT_INTERACT_RADIUS_METERS };

// A picture of the slot, for a child who cannot read yet -- the same emoji-forward, zero-asset
// convention #workshop-interact's '🛠 GEAR' and unlockCard's own gear pills already keep. Generic
// fallback for a kind/slot this file does not recognise, so an unfamiliar itemId still draws SOMETHING
// rather than an empty row.
const SLOT_ICONS = {
  [WEAPON_SLOT]: '🗡️',
  [SHIELD_SLOT]: '🛡️',
  [HELMET_SLOT]: '🪖',
  [SHOULDERS_SLOT]: '🎽',
};
const GENERIC_GEAR_ICON = '🎁';
// The SHIPPED coin glyph, not a new one: public/index.html paints #loot-hud's coin count with
// `content: '\25CF'` in gold, so the loot panel shows a child the same mark their coin counter
// already uses. A second, prettier coin here would read as a second currency to a five-year-old.
const COIN_ICON = '●';

/** This hero's own claim on one corpse, or null -- never anyone else's. The one lookup every other
 *  function below is built from, so "whose claim is this" has exactly one implementation. */
export function claimFor(corpse, heroId) {
  if (!corpse || heroId == null) return null;
  return corpse.claims.find((claim) => claim.heroId === heroId) ?? null;
}

/** True while this hero holds a claim on this corpse AND at least one of their own items is still
 *  untaken. #87's own required outcome: "after a player collects their personal loot, the corpse
 *  stops glowing for that player even if another eligible player still has loot waiting" -- this is
 *  that rule, read per hero rather than per corpse. */
export function hasUnclaimedLoot(corpse, heroId) {
  const claim = claimFor(corpse, heroId);
  return claim != null && claim.items.some((item) => !item.taken);
}

/** Every corpse THIS hero should see glowing right now. Snapshot order preserved -- the wire gives no
 *  ordering guarantee, but a stable render needs SOME order and the array it already arrived in is as
 *  good as any invented one. */
export function corpsesToGlowFor(heroId, corpses) {
  return (corpses ?? []).filter((corpse) => hasUnclaimedLoot(corpse, heroId));
}

function distanceToCorpse(position, corpse) {
  return Math.hypot(position.x - corpse.x, position.z - corpse.z);
}

/**
 * The single corpse a "Loot" prompt should offer to open right now: the NEAREST corpse this hero can
 * still loot, within radiusMeters (defaults to the server's own interact radius -- imported, never
 * restated, so a client offer can never promise a reach the server would then refuse). Nearest rather
 * than "any in range" so two corpses close together never race an ambiguous tap. Never a corpse this
 * hero holds no claim on at all, even standing directly on top of it -- that corpse belongs to
 * somebody else's screen, not this one.
 */
export function nearestLootableCorpse(
  heroId, corpses, position, radiusMeters = CORPSE_LOOT_INTERACT_RADIUS_METERS,
) {
  let best = null;
  let bestDistance = Infinity;
  for (const corpse of corpses ?? []) {
    if (!hasUnclaimedLoot(corpse, heroId)) continue;
    const d = distanceToCorpse(position, corpse);
    if (d > radiusMeters) continue;
    if (d < bestDistance) {
      best = corpse;
      bestDistance = d;
    }
  }
  return best;
}

/** The loot panel's own content for one corpse: THIS hero's items, full stop. Empty (never a
 *  sibling's items) when they hold no claim -- the panel should never actually be asked to open in
 *  that state, but the seam fails closed rather than guessing if it ever is. */
export function panelItemsFor(corpse, heroId) {
  const claim = claimFor(corpse, heroId);
  return claim ? claim.items : [];
}

/**
 * The panel's own display rows for one corpse, THIS hero's claim only: item id (for the collect
 * click), the wire's own claimItemId, a readable name read off progression/items.js (GQ-007 -- never
 * restated), a slot icon, and whether it is already taken. Falls back to a generic name/icon for an
 * itemId this catalogue does not know, so a future pool entry can never crash the panel it has not
 * been named to yet.
 */
export function corpseLootPanelViewModel(corpse, heroId) {
  return panelItemsFor(corpse, heroId).map((item) => {
    // #87: a coin row is a COUNT, not a catalogue entry -- there is no items.js def to look up, and a
    // child reads "Coins × 3" as one thing they are getting, not three things to tap.
    if (item.kind === CORPSE_COIN_KIND) {
      return {
        id: item.id,
        itemId: null,
        name: `Coins × ${item.amount}`,
        icon: COIN_ICON,
        guaranteed: item.guaranteed,
        taken: item.taken,
      };
    }
    const def = itemDef(item.itemId);
    return {
      id: item.id,
      itemId: item.itemId,
      name: def?.name ?? 'Mystery Gear',
      icon: (def && SLOT_ICONS[def.slot]) ?? GENERIC_GEAR_ICON,
      guaranteed: item.guaranteed,
      taken: item.taken,
    };
  });
}

/**
 * Diff two consecutive snapshots for ONE hero's own claims across every corpse and report which items
 * flipped false -> true since the last frame -- the signal that drives the short acquired-item
 * confirmation. Comparing snapshots rather than trusting a one-shot ack from sendCollectCorpseItem/All
 * means a delayed confirmation, a resend, or a second connection acting on the same guest all still
 * surface exactly one toast per item, on the frame the server actually confirms it: never zero, never
 * twice for the same transition, and never for an item that was already taken before this hero's own
 * client ever saw the corpse (a fresh join/reconnect must not replay every already-resolved claim as
 * a fresh pickup).
 */
export function newlyTakenItems(previousCorpses, nextCorpses, heroId) {
  if (!Array.isArray(previousCorpses) || !Array.isArray(nextCorpses)) return [];
  const takenBefore = new Set();
  for (const corpse of previousCorpses) {
    const claim = claimFor(corpse, heroId);
    if (!claim) continue;
    for (const item of claim.items) if (item.taken) takenBefore.add(item.id);
  }
  const arrivals = [];
  for (const corpse of nextCorpses) {
    const claim = claimFor(corpse, heroId);
    if (!claim) continue;
    for (const item of claim.items) {
      if (item.taken && !takenBefore.has(item.id)) arrivals.push(item);
    }
  }
  return arrivals;
}

/**
 * SHOULD AN OPEN LOOT PANEL SURRENDER THIS FRAME? A snapshot diff on this hero's own body, in the
 * same shape newlyTakenItems above takes for their claim -- previous view, next view, no clock, no
 * DOM, no wire.
 *
 * WHY THIS EXISTS, measured hosted at 946857f. The loot panel is a MODAL: ui/corpseLootPanel.js's
 * layer is `inset: 0` and flips to `pointer-events: auto` while shown, over a full-screen backdrop
 * whose pointerdown is stopped from reaching `#game`. So while it is open the hero can neither walk
 * nor swing. wolf-1 respawns ENEMY_KIND_RESPAWN_SECONDS (10s) after death at its authored home --
 * which is exactly where its own corpse is -- and bites WOLF_LEVEL_STATS[1].biteDamage (10) into
 * HERO_MAX_HP (30) every WOLF_BITE_COOLDOWN_SECONDS (2.6s). A hero who opened the panel on hp 20 had
 * two bites, about 2.6 seconds: he collected the first item correctly and was dead before the second
 * round trip finished, then reseated at HERO_SPAWN where every further TAKE was refused on reach --
 * silently, because net/gameServerCore.mjs answers an out-of-reach collect with a bare
 * `if (!accepted) return;`. The child is shown live TAKE buttons that do nothing.
 *
 * THE SAME LAW THE RUNE CHEST ALREADY STATES, reused as a principle and deliberately NOT as a
 * helper. progression/runeChests.js's own heroInCombat exists because "a child who backs over a
 * chest while a wolf is on them gets a maths question over a frozen hero and keeps taking bites they
 * can no longer answer" -- identical failure, identical cause. But that helper is a proximity/mode
 * gate on OPENING, and this is a damage gate on STAYING OPEN, and the two cannot be the same
 * function here: the wolf respawns ON this corpse forever, so a proximity rule would make this
 * corpse permanently unlootable rather than merely interrupted. Sharing the sentence, not the code,
 * is the honest reuse -- and it keeps this a local #87 correction rather than a modal framework.
 *
 * The rule is deliberately the narrowest thing that answers the evidence: real damage, or actually
 * going down. Not proximity, not "a wolf exists", not a mode list that goes stale as the state
 * machine grows -- the exact trap runeChests.js's own header records being caught by twice.
 *
 * @param previousSelf  this hero's body on the last snapshot, or null (first frame, offline, or a
 *                      reconnect that minted a fresh heroId -- none of which can prove damage).
 * @param nextSelf      this hero's body on the current snapshot.
 */
export function dismissLootPanelForCombat(previousSelf, nextSelf) {
  if (!nextSelf) return false;
  // Downed is its own trigger, not a consequence of the hp diff: the blow that puts a hero down can
  // land on a frame this client never sampled, and a body on the floor must not be left holding a
  // modal open whatever the numbers either side of it say.
  if (Number.isFinite(nextSelf.downSeconds) && nextSelf.downSeconds >= 0) return true;
  if (!previousSelf) return false;
  if (!Number.isFinite(previousSelf.hp) || !Number.isFinite(nextSelf.hp)) return false;
  // A DROP is damage; a rise is a heart pickup or the full-HP restore that ends a knockdown, and
  // neither is a reason to take the loot away from a child who is reading it.
  return nextSelf.hp < previousSelf.hp;
}
