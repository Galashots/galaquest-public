// Persistent order board. The caller owns inventory and saves the returned JSON.
function rngNext(seed) {
  const next = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return [next, next / 4294967296];
}

function validOffers(offers, band) {
  if (band !== 'younger' && band !== 'older') throw new Error('Invalid grade band');
  const filtered = offers.filter((offer) => offer.band === band);
  if (!filtered.length || filtered.some((offer) => !offer.id || !Number.isSafeInteger(offer.coins) || offer.coins < 0 ||
    !offer.wants || !Object.keys(offer.wants).length ||
    Object.values(offer.wants).some((count) => !Number.isSafeInteger(count) || count < 1))) {
    throw new Error('Invalid offers');
  }
  if (new Set(filtered.map((offer) => offer.id)).size !== filtered.length) throw new Error('Duplicate offer ID');
  return filtered;
}

function sizeOf(offer) {
  return Object.values(offer.wants).reduce((sum, count) => sum + count, 0);
}

function draw(board, offers) {
  const active = new Set(board.open.map((order) => order.offerId));
  const available = offers.filter((offer) => !active.has(offer.id));
  if (!available.length) return board;
  const [seed, roll] = rngNext(board.seed);
  const offer = available[Math.floor(roll * available.length)];
  return { ...board, seed, nextId: board.nextId + 1,
    open: [...board.open, { id: `order-${board.nextId}`, offerId: offer.id }] };
}

export function createOrderBoard({ offers, band, seed = 1, slots = 3 }) {
  const eligible = validOffers(offers, band);
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(slots) || slots < 1) throw new Error('Invalid board settings');
  const count = Math.min(slots, eligible.length);
  let board = { band, seed: seed >>> 0, slots: count, nextId: 1, open: [] };
  // For the older player, guarantee a quick option and a save-up option when the content has both.
  if (band === 'older' && count >= 2) {
    const ordered = [...eligible].sort((a, b) => sizeOf(a) - sizeOf(b));
    const first = ordered[0];
    const last = ordered.at(-1);
    if (sizeOf(first) < sizeOf(last)) {
      board.open.push({ id: `order-${board.nextId++}`, offerId: first.id });
      board.open.push({ id: `order-${board.nextId++}`, offerId: last.id });
    }
  }
  while (board.open.length < count) board = draw(board, eligible);
  return board;
}

export function getOpenOrders(board, offers) {
  const byId = new Map(validOffers(offers, board.band).map((offer) => [offer.id, offer]));
  return board.open.map((order) => {
    const offer = byId.get(order.offerId);
    if (!offer) throw new Error(`Missing content offer: ${order.offerId}`);
    return { ...offer, ...order };
  });
}

export function canFulfillOrder(order, inventory) {
  return Object.entries(order.wants).every(([cropId, count]) =>
    Number.isSafeInteger(inventory[cropId] ?? 0) && (inventory[cropId] ?? 0) >= count);
}

export function fulfillOrder({ board, orderId, inventory, offers }) {
  const offer = getOpenOrders(board, offers).find((entry) => entry.id === orderId);
  if (!offer) throw new Error('Order is not open');
  if (!canFulfillOrder(offer, inventory)) throw new Error('Not enough crops');
  const nextInventory = { ...inventory };
  for (const [cropId, count] of Object.entries(offer.wants)) nextInventory[cropId] -= count;
  let nextBoard = { ...board, open: board.open.filter((entry) => entry.id !== orderId) };
  nextBoard = draw(nextBoard, validOffers(offers, board.band));
  return { board: nextBoard, inventory: nextInventory, coinsEarned: offer.coins, fulfilledOfferId: offer.offerId };
}
