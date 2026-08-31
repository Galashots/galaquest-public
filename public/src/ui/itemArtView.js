// public/src/ui/itemArtView.js
//
// ONE ITEM, ONE PICTURE, ON EVERY SURFACE THAT DRAWS IT.
//
// progression/itemArt.js decides WHAT an item looks like (a rendered portrait URL, plus an inline
// silhouette to fall back to). This module is the other half: the tiny piece of DOM that puts that
// decision on screen. It exists as its own file because three unrelated surfaces need it and the
// alternative is three copies of the same fifteen lines --
//
//   * the inventory grid, the equipped slots and the comparison portrait (progression/heroScreen.js)
//   * the acquisition ceremony (ui/unlockCard.js)
//   * the corpse-loot receipt (ui/corpseLootPanel.js)
//
// -- and three copies is how the Checkpoint 2 player-fair session ended up photographing the SAME
// Silverguard Shoulders as a rendered portrait in the inventory, a crude grey pauldron silhouette in
// the ceremony that granted it, and a 🎽 emoji in the loot window it came out of. Three pictures,
// one item, in one thirty-second stretch of play. #88 asks for "an exact recognizable likeness of
// the in-game model"; the likeness is only worth anything if it is the likeness EVERYWHERE.
//
// This is deliberately in ui/ rather than progression/: it touches the DOM, and progression/ has to
// stay framework-free because net/gameServer.mjs imports from that directory directly.

/**
 * Paint one item's art into `host`, idempotently.
 *
 * @param host  the element to draw into -- gets `.item-art` styling from index.html.
 * @param art   `{ iconUrl, iconSvg }`, straight from progression/itemArt.js.
 *
 * IDEMPOTENT BY URL, because every caller here repaints on a render loop or a re-show and rebuilding
 * an <img> sixty times a second would restart its decode sixty times a second. `data-art-url`
 * records what is currently painted; a repaint with the same URL is a no-op.
 */
export function paintItemArt(host, { iconUrl = null, iconSvg = null } = {}) {
  if (!host) return;
  if (host.dataset.artUrl === String(iconUrl) && host.dataset.artPainted === 'true') return;
  host.dataset.artUrl = String(iconUrl);
  host.dataset.artPainted = 'true';
  host.innerHTML = '';

  const doc = host.ownerDocument ?? document;
  const fallback = doc.createElement('span');
  fallback.className = 'item-art-fallback';
  fallback.setAttribute('aria-hidden', 'true');
  fallback.innerHTML = iconSvg ?? '';
  host.appendChild(fallback);
  if (!iconUrl) return;

  const img = doc.createElement('img');
  img.className = 'item-art-image';
  img.alt = '';
  img.decoding = 'async';
  // The fallback is hidden only once the real portrait has actually decoded. Hiding it up front
  // would leave an empty square for as long as the PNG takes, and an empty square is the exact
  // Checkpoint 0 defect this whole package is about.
  const revealPortrait = () => { fallback.hidden = true; };
  img.addEventListener('load', revealPortrait);
  img.addEventListener('error', () => { img.remove(); });
  img.src = iconUrl;
  // AND SYNCHRONOUSLY, IF IT IS ALREADY THERE. Setting src on an image the browser has cached can
  // complete before this line runs, and a `load` listener attached to an already-complete image
  // never fires -- so the silhouette behind it stays lit. It is drawn in the rarity ink, so the
  // symptom is an item tinted by its own rarity, which is precisely what #88 forbids. Found in a
  // Checkpoint 2 capture, not by reading this code. `complete` alone is not enough (it is also true
  // for a failed load), so the decode is confirmed with naturalWidth.
  if (img.complete && img.naturalWidth > 0) revealPortrait();
  host.appendChild(img);
}

/** Clear an art host back to empty -- an equipped slot that just became empty, for instance. */
export function clearItemArt(host) {
  if (!host || host.dataset.artPainted !== 'true') return;
  host.innerHTML = '';
  host.dataset.artPainted = 'false';
  host.dataset.artUrl = '';
}
