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

import { CORPSE_LOOT_INTERACT_RADIUS_METERS } from './corpseLoot.js';
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
