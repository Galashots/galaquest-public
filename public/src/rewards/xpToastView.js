// public/src/rewards/xpToastView.js
//
// R1: the floating "+20 XP" toast a kill pops, riding the same overlay pipeline main.js's own
// popDamageNumber does. This is the one pure sliver worth a name and a test -- the DOM/three.js
// positioning is main.js's job (it already owns ndcToOverlayPixels and the CSS rise for damage
// numbers; a second copy of that plumbing for XP would be the exact drift GQ-007 exists to stop) --
// so all this file states is what the toast SAYS, given an amount rewards/killXp.js already priced.

/** The toast's own text for one kill's XP award. Never zero or negative -- a caller handing this a
 *  non-positive amount has a bug upstream (killXpForKind never prices a kill at 0 or less), so this
 *  throws rather than silently printing "+0 XP" or "+-10 XP" to a child. */
export function xpToastText(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new TypeError(`xpToastText needs a positive integer XP amount, got ${JSON.stringify(amount)}`);
  }
  return `+${amount} XP`;
}
