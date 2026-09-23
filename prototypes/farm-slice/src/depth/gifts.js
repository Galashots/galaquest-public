// Gift codes are unsigned, local JSON. They are for known siblings, not authenticated trade.
const PREFIX = 'GQ1.';
const MAX_CODE_LENGTH = 3000;
const ELEMENTS = new Set(['fire', 'water', 'leaf', 'spark']);
const SHAPES = new Set(['round', 'tall', 'long', 'winged']);
const RARITIES = new Set(['common', 'rare', 'epic']);
const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

function encode(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decode(code) {
  if (typeof code !== 'string' || code.length > MAX_CODE_LENGTH || !code.startsWith(PREFIX) ||
    !/^[A-Za-z0-9_-]+$/.test(code.slice(PREFIX.length))) throw new Error('Invalid gift code');
  const body = code.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
  try {
    const bytes = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('Invalid gift code');
  }
}

function validEgg(egg) {
  return egg && SAFE_ID.test(egg.id) && Number.isSafeInteger(egg.createdAt) &&
    Number.isSafeInteger(egg.readyAt) && egg.readyAt > egg.createdAt &&
    egg.child && ELEMENTS.has(egg.child.element) && SHAPES.has(egg.child.shape) &&
    RARITIES.has(egg.child.rarity) && egg.child.colors &&
    COLOR.test(egg.child.colors.body) && COLOR.test(egg.child.colors.accent);
}

function giftIdOrNew(giftId) {
  const id = giftId ?? globalThis.crypto?.randomUUID?.();
  if (!id || !SAFE_ID.test(id)) throw new Error('A unique gift ID is required');
  return id;
}

export function createGiftCode(state, { kind, itemId, giftId } = {}) {
  const id = giftIdOrNew(giftId);
  if ((state.createdGiftIds ?? []).includes(id) || (state.redeemedGiftIds ?? []).includes(id))
    throw new Error('Gift ID already used on this device');
  let item;
  let nextState;
  if (kind === 'crop') {
    if (!SAFE_ID.test(itemId) || !Number.isSafeInteger(state.crops?.[itemId]) || state.crops[itemId] < 1)
      throw new Error('Crop is not owned');
    item = { kind, cropId: itemId };
    nextState = { ...state, crops: { ...state.crops, [itemId]: state.crops[itemId] - 1 } };
  } else if (kind === 'egg') {
    const egg = state.eggs?.find((entry) => entry.id === itemId);
    if (!validEgg(egg) || egg.hatchedAt != null) throw new Error('Egg is not owned or already hatched');
    item = { kind, egg: { id: egg.id, createdAt: egg.createdAt, readyAt: egg.readyAt, child: egg.child } };
    nextState = { ...state, eggs: state.eggs.filter((entry) => entry.id !== itemId) };
  } else throw new Error('Unsupported gift kind');
  const code = PREFIX + encode({ version: 1, giftId: id, item });
  return { code, state: { ...nextState, createdGiftIds: [...(state.createdGiftIds ?? []), id],
    redeemedGiftIds: [...(state.redeemedGiftIds ?? []), id] } };
}

export function redeemGiftCode(state, code, { cropIds } = {}) {
  const payload = decode(code);
  if (payload?.version !== 1 || !SAFE_ID.test(payload.giftId)) throw new Error('Invalid gift code');
  if ((state.redeemedGiftIds ?? []).includes(payload.giftId)) throw new Error('Gift already redeemed');
  let nextState;
  if (payload.item?.kind === 'crop') {
    const cropId = payload.item.cropId;
    if (!SAFE_ID.test(cropId) || !Array.isArray(cropIds) || !cropIds.includes(cropId))
      throw new Error('Unknown crop');
    const count = state.crops?.[cropId] ?? 0;
    if (!Number.isSafeInteger(count) || count < 0 || count === Number.MAX_SAFE_INTEGER)
      throw new Error('Invalid crop count');
    nextState = { ...state, crops: { ...state.crops, [cropId]: count + 1 } };
  } else if (payload.item?.kind === 'egg') {
    const egg = payload.item.egg;
    if (!validEgg(egg)) throw new Error('Invalid egg');
    const id = `gift-${payload.giftId}`;
    if (state.eggs?.some((entry) => entry.id === id)) throw new Error('Egg ID already exists');
    nextState = { ...state, eggs: [...(state.eggs ?? []), { ...egg, id, ordinal: null,
      lastObservedAt: egg.createdAt, hatchedAt: null }] };
  } else throw new Error('Unsupported gift kind');
  return { ...nextState, redeemedGiftIds: [...(state.redeemedGiftIds ?? []), payload.giftId] };
}
