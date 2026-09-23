// The glue: wires rules + save + renderer + DOM UI + audio together. This is
// the only module allowed to know about all the others.
import { Diorama } from './render/diorama.js';
import * as game from './rules/game.js';
import * as economy from './rules/economy.js';
import { loadGame, saveGame } from './save.js';
import * as audio from './audio.js';
import { Hud } from './ui/hud.js';
import { MarketPanel } from './ui/market.js';
import { NamingDialog } from './ui/namingDialog.js';
import { CollectionBook } from './ui/collectionBook.js';
import { BandDialog } from './ui/bandDialog.js';
import * as content from '../content/index.js';

const app = document.getElementById('app');
const canvas = document.getElementById('scene-canvas');

let { state, isNewGame } = loadGame(Date.now());
if (!isNewGame) {
  state = game.applyVolunteerCarrots(state, content, Date.now());
}

const diorama = new Diorama(canvas, content);

const hud = new Hud(app);
const market = new MarketPanel(app, {
  onFulfillOffer: handleFulfillOffer,
  onBuyArmor: handleBuyArmor,
  onClose: () => market.close(),
});
const namingDialog = new NamingDialog(app, { onSubmit: handleSubmitName });
const book = new CollectionBook(app, { onClose: () => book.close() });
const bandDialog = new BandDialog(app, { onPick: handlePickBand });

let bookOpenedOnce = false;

function resize() {
  diorama.resize(app.clientWidth, app.clientHeight);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 60));
resize();

function persist() {
  saveGame(state);
}

/** Call after every action that may have changed state, passing the state before the action. */
function applyResult(prevState) {
  if (state.egg.cracks > prevState.egg.cracks) audio.sfx.crack();
  const now = Date.now();
  syncVisuals(now);
  refreshHud();
  persist();
}

function syncVisuals(now) {
  diorama.syncFarm(state.farm, now);
  diorama.syncArmor(game.equippedArmorDefs(state, content), game.nextArmorForSale(state, content));
  diorama.syncEgg(state.egg);
}

function goalDescriptor(now) {
  const goal = game.currentGoal(state);
  if (goal.targetKey === 'ripeCrop') {
    const ready = game.readyPlotIndexes(state, content, now);
    return { ...goal, plotIndex: ready.length ? ready[0] : 0 };
  }
  if (goal.targetKey === 'plot') {
    const emptyIdx = state.farm.plots.findIndex((p) => !p.cropId);
    // In the loop-tease beat, prefer nudging toward feeding if a sunberry is
    // ready to give -- planting again is always available regardless.
    const feedCropDef = content.CROPS.find((c) => c.distinctive);
    const feedCropId = feedCropDef ? feedCropDef.id : 'sunberry';
    if (goal.step === 'loop' && economy.countOf(state.basket, feedCropId) > 0 && state.egg.hatchedCreatureId) {
      return { ...goal, targetKey: 'creature' };
    }
    return { ...goal, plotIndex: emptyIdx >= 0 ? emptyIdx : 0 };
  }
  return goal;
}

function refreshHud() {
  const now = Date.now();
  const goal = goalDescriptor(now);
  hud.setGoalText(goal.text);

  const worldPos = market.isOpen || namingDialog.backdrop.style.display === 'flex'
    ? null
    : diorama.worldPositionFor(goal);
  if (worldPos) {
    hud.setArrowTarget(diorama.projectToScreen(worldPos, app.clientWidth, app.clientHeight));
  } else {
    hud.setArrowTarget(null);
  }

  hud.setCoins(state.basket.coins);
  const basketTotal = Object.values(state.basket.crops).reduce((a, b) => a + b, 0);
  hud.setBasketCount(basketTotal);

  const ownedCount = Object.keys(state.collection.owned).length;
  hud.setBookAttract(ownedCount > 0 && !bookOpenedOnce);
}

// -- Market panel -----------------------------------------------------------

function renderMarket() {
  const npc = content.NPCS.find((n) => n.id === 'pip');
  const offers = content.OFFERS.map((o) => ({
    id: o.id,
    text: o.text,
    coins: o.coins,
    canFulfill: economy.canFulfillOffer(state.basket, o),
  }));
  const armorDef = game.nextArmorForSale(state, content);
  const armor = armorDef
    ? { id: armorDef.id, name: armorDef.name, price: armorDef.price, canAfford: economy.canAfford(state.basket, armorDef.price) }
    : null;
  market.render({ npcGreeting: npc ? npc.greeting : '', offers, armor });
}

function openMarket() {
  renderMarket();
  market.open();
  refreshHud();
}

function handleFulfillOffer(offerId) {
  const prev = state;
  const offerDef = content.OFFERS.find((o) => o.id === offerId);
  const res = game.fulfillOffer(state, content, offerId, Date.now());
  if (res.success) {
    state = res.state;
    audio.sfx.coin();
    diorama.playOfferSparkle();
    hud.showToast(`+${offerDef.coins} coins!`);
    applyResult(prev);
    renderMarket();
  } else {
    audio.sfx.denied();
  }
}

function handleBuyArmor(armorId) {
  const prev = state;
  const res = game.buyArmor(state, content, armorId, Date.now());
  if (res.success) {
    state = res.state;
    audio.sfx.equip();
    diorama.playEquipSparkle();
    hud.showToast('Equipped!');
    applyResult(prev);
    renderMarket();
    if (state.egg.readyToHatch) {
      setTimeout(() => { market.close(); refreshHud(); }, 700);
    }
  } else {
    audio.sfx.denied();
  }
}

// -- Naming -------------------------------------------------------------

function openNaming() {
  const creatureDef = content.CREATURES.find((c) => c.id === state.egg.hatchedCreatureId);
  namingDialog.open(creatureDef ? creatureDef.name : 'Buddy');
  refreshHud();
}

function handleSubmitName(name) {
  const prev = state;
  const res = game.nameCreature(state, content, name, Date.now());
  if (res.success) {
    state = res.state;
    namingDialog.close();
    applyResult(prev);
    hud.showToast(`${name} joined your book!`);
  }
}

// -- Collection book ------------------------------------------------------

function renderBook() {
  const owned = state.collection.owned;
  const entries = content.CREATURES.map((c) => ({
    id: c.id,
    name: state.collection.names[c.id] || c.name,
    color: c.colors.body,
    discovered: !!owned[c.id],
  }));
  book.render({ foundCount: Object.keys(owned).length, total: content.CREATURES.length, entries });
}

hud.onBookOpen(() => {
  bookOpenedOnce = true;
  renderBook();
  book.open();
  refreshHud();
});

hud.onMuteToggle(() => {
  hud.setMuted(audio.toggleMuted());
});

// -- Band picker (grown-up, one-time) --------------------------------------

function handlePickBand(band) {
  const prev = state;
  state = game.setBand(state, band);
  bandDialog.close();
  applyResult(prev);
}

if (!state.band) {
  bandDialog.open();
}

// -- Canvas tap handling ----------------------------------------------------

function anyModalOpen() {
  return market.isOpen
    || namingDialog.backdrop.style.display === 'flex'
    || book.backdrop.style.display === 'flex'
    || bandDialog.backdrop.style.display === 'flex';
}

function handlePlotTap(plotIndex, now) {
  const plot = state.farm.plots[plotIndex];
  const prev = state;
  if (plot.cropId) {
    const res = game.harvestPlot(state, content, plotIndex, now);
    if (res.harvestedCropId) {
      state = res.state;
      audio.sfx.harvest();
      diorama.playHarvestPop(plotIndex);
      applyResult(prev);
    }
  } else {
    const res = game.plantAll(state, content, now);
    if (res.planted.length) {
      state = res.state;
      audio.sfx.plant();
      diorama.playPlantPop();
      applyResult(prev);
    }
  }
}

function handleCreatureTap(now) {
  const prev = state;
  const res = game.feedSunberry(state, content, now);
  if (res.success) {
    state = res.state;
    audio.sfx.equip();
    diorama.playFeedSparkle();
    hud.showToast('Nom nom!');
    applyResult(prev);
  } else {
    diorama.playFeedSparkle();
  }
}

function handleEggTap(now) {
  const prev = state;
  const res = game.tapEgg(state, content, now);
  state = res.state;
  if (res.hatched) {
    audio.sfx.hatch();
    applyResult(prev);
    setTimeout(openNaming, 550);
  } else if (state.egg.readyToHatch) {
    audio.sfx.crack();
    applyResult(prev);
  }
}

canvas.addEventListener('pointerdown', (e) => {
  audio.unlockAudio();
  if (anyModalOpen()) return;

  const rect = canvas.getBoundingClientRect();
  const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  const hit = diorama.pickAt(ndcX, ndcY);
  if (!hit) return;

  const now = Date.now();
  switch (hit.type) {
    case 'plot':
      handlePlotTap(hit.plotIndex, now);
      break;
    case 'market':
    case 'mannequin':
      audio.sfx.open();
      openMarket();
      break;
    case 'egg':
      handleEggTap(now);
      break;
    case 'creature':
      handleCreatureTap(now);
      break;
    default:
      break;
  }
});

document.addEventListener('pointerdown', () => audio.unlockAudio(), { once: true });

// -- Boot -------------------------------------------------------------------

syncVisuals(Date.now());
refreshHud();

function tick() {
  const now = Date.now();
  syncVisuals(now);
  diorama.update();
  refreshHud();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
