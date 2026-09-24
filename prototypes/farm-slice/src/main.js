// The only glue between pure rules, the scene, DOM, persistence and audio.
import { Diorama } from './render/diorama.js';
import * as game from './rules/game.js';
import * as economy from './rules/economy.js';
import * as goals from './rules/goals.js';
import { loadGame, saveGame } from './save.js';
import * as audio from './audio.js';
import { Hud } from './ui/hud.js';
import { MarketPanel } from './ui/market.js';
import { NamingDialog } from './ui/namingDialog.js';
import { CollectionBook } from './ui/collectionBook.js';
import { BandDialog } from './ui/bandDialog.js';
import { SeedTray } from './ui/seedTray.js';
import * as content from '../content/index.js';

const app = document.getElementById('app');
const canvas = document.getElementById('scene-canvas');
let { state, isNewGame } = loadGame(Date.now());
if (!isNewGame) state = game.applyVolunteerCarrots(state, content, Date.now());
state = game.checkTimeGates(state, content, Date.now());
const diorama = new Diorama(canvas, content);
const hud = new Hud(app);
const market = new MarketPanel(app, { onFulfillOffer: handleFulfillOffer, onBuyArmor: handleBuyArmor, onClose: closeMarket,
  onSlotFill: (id, count) => { audio.sfx.tap(); audio.say(String(count)); hud.showToast(`${count} ${id}`); },
  onCoinTap: (value) => { audio.sfx.coin(); audio.say(String(value)); hud.showToast(`${value} coins`); } });
const namingDialog = new NamingDialog(app, { onSubmit: handleSubmitName });
const book = new CollectionBook(app, { onClose: closeBook });
const bandDialog = new BandDialog(app, { onPick: handlePickBand });
const tray = new SeedTray(app, (cropId) => { selectedSeed = cropId; refresh(); });
let selectedSeed = null;
let lastTrayKey = null;
let trayOpened = false;
let bookOpenedOnce = false;
let hatchPauseUntil = 0;

function step() { return goals.currentStep(state.goals); }
function resize() { diorama.resize(app.clientWidth, app.clientHeight); }
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 60));
resize();

function applyResult(previous) {
  if (state.egg.cracks > previous.egg.cracks) audio.sfx.crack();
  saveGame(state);
  refresh();
}
function syncVisuals(now) {
  diorama.syncFarm(state.farm, now);
  diorama.syncArmor(game.equippedArmorDefs(state, content),
    step() === 'armor' || step() === 'offer' || step() === 'market' ? content.ARMOR[0] : null);
  diorama.syncEgg(state.egg);
  diorama.setSeedSackVisible(['replant', 'free'].includes(step()));
  diorama.setWateringCanVisible(['grow', 'replant', 'free'].includes(step()) &&
    game.unwateredGrowingPlotIndexes(state, content, now).length > 0);
}
function remainingSeeds() {
  if (!['plant', 'replant', 'free'].includes(step())) return [];
  if (step() === 'plant') {
    const recipe = game.choosePlantingRecipe(content);
    for (const plot of state.farm.plots) {
      const idx = recipe.indexOf(plot.cropId);
      if (idx !== -1) recipe.splice(idx, 1);
    }
    return recipe;
  }
  const slots = step() === 'replant' ? Math.max(0, 3 - (state.replantPlanted || 0)) : state.farm.plots.filter((p) => !p.cropId).length;
  return new Array(Math.min(slots, state.farm.plots.filter((p) => !p.cropId).length)).fill('carrot');
}
function rectPoint(rect) { return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; }
function refresh() {
  const now = Date.now();
  syncVisuals(now);
  const goal = game.currentGoal(state, content, now);
  hud.chip.style.visibility = Date.now() < hatchPauseUntil ? 'hidden' : 'visible';
  const chipText = !market.isOpen && ['offer', 'armor'].includes(step()) ? 'Go to the market'
    : market.isOpen && step() === 'offer' && market.selectedOfferId
      ? (market.selectedOfferId === 'pip_crate' ? "Fill Pip's crate" : 'Fill the bundle')
      : goal.text;
  hud.setGoalText(chipText);
  hud.setCoins(state.basket.coins);
  hud.setBasketCount(Object.values(state.basket.crops).reduce((a, b) => a + b, 0));
  hud.setBookAttract(step() === 'book' && !book.isOpen);
  const progress = state.farm.plots.flatMap((plot, i) => {
    if (!plot.cropId || !['grow', 'harvest', 'replant'].includes(step())) return [];
    const value = game.getGrowthProgress(state, content, i, now);
    if (value >= 1) return [];
    const point = diorama.worldPositionFor({ targetKey: 'sprout', plotIndex: i });
    return [{ ...diorama.projectToScreen(point, app.clientWidth, app.clientHeight), progress: value }];
  });
  hud.setProgressRings(progress);
  hud.setFeedVisible(step() === 'feed' && economy.countOf(state.basket, 'sunberry') > 0);
  hud.setFeedMeter(state.collection.fed?.sprout || 0, !!state.egg.hatchedCreatureId);
  const seeds = remainingSeeds();
  if (seeds.length && !seeds.includes(selectedSeed)) selectedSeed = seeds[0];
  const trayKey = `${trayOpened}:${seeds.join(',')}:${selectedSeed}:${step()}`;
  if (trayKey !== lastTrayKey) { tray.render(trayOpened ? seeds : [], selectedSeed, step() !== 'plant'); lastTrayKey = trayKey; }
  let target = null;
  // The band picker is the grown-up's choice between two equal options: no
  // child-facing arrow, which would also sit on top of its text.
  if (bandDialog.backdrop.style.display === 'flex') target = null;
  else if (namingDialog.backdrop.style.display === 'flex') target = rectPoint(namingDialog.suggestionsEl.getBoundingClientRect());
  else if (book.isOpen) target = rectPoint(book.closeBtn.getBoundingClientRect());
  else if (market.isOpen) target = rectPoint(market.getArrowTargetRect(step()));
  else if (step() === 'feed' && hud.feedBtn.style.display !== 'none') target = rectPoint(hud.feedBtn.getBoundingClientRect());
  else {
    const point = diorama.worldPositionFor(goal);
    if (point) target = diorama.projectToScreen(point, app.clientWidth, app.clientHeight);
    else if (goal.targetKey === 'book') target = rectPoint(hud.bookBtn.getBoundingClientRect());
  }
  hud.setArrowTarget(target);
}

function renderMarket() {
  const cropNames = Object.fromEntries(content.CROPS.map((c) => [c.id, c.name]));
  const offers = content.OFFERS.slice(0, 2).map((o) => ({
    ...o,
    canFulfill: game.canFulfillOffer(state, o),
    paused: !['offer', 'free'].includes(step()),
    haveByCrop: { ...state.basket.crops }, cropNames,
    keepByCrop: Object.fromEntries(['carrot', 'sunberry'].map((id) => [id, Math.max(0, economy.countOf(state.basket, id) - (o.wants[id] || 0))])),
    perCropRate: o.coins / Object.values(o.wants).reduce((a, b) => a + b, 0),
  }));
  const armorDef = content.ARMOR[0];
  market.render({ npcGreeting: content.NPCS[0].greeting, band: state.band, offers,
    armor: state.armor.owned.includes(armorDef.id) ? null : {
      id: armorDef.id, name: armorDef.name, price: armorDef.price,
      canAfford: economy.canAfford(state.basket, armorDef.price), coins: state.basket.coins,
    } });
}
function openMarket() {
  const previous = state;
  state = game.openMarket(state);
  market.open();
  diorama.setMarketOpen(true);
  renderMarket();
  if (state !== previous) applyResult(previous);
  else refresh();
  audio.sfx.open();
  audio.say(content.NPCS[0].greeting);
}
function closeMarket() { market.close(); diorama.setMarketOpen(false); refresh(); }
function handleFulfillOffer(offerId) {
  const previous = state;
  const result = game.fulfillOffer(state, content, offerId, Date.now());
  if (!result.success) return;
  state = result.state;
  audio.sfx.coin();
  diorama.playOfferSparkle();
  const paid = content.OFFERS.find((o) => o.id === offerId).coins;
  audio.say(Array.from({length: paid / 2}, (_, i) => (i + 1) * 2).join(', '));
  hud.showToast(`+${paid} coins · ${Array.from({length: paid / 2}, (_, i) => (i + 1) * 2).join(', ')}`, 2500);
  market.selectedOfferId = null;
  market._fill = {};
  applyResult(previous);
  renderMarket();
}
function handleBuyArmor(armorId) {
  const previous = state;
  const result = game.buyArmor(state, content, armorId, Date.now());
  if (!result.success) return;
  state = result.state;
  audio.sfx.equip();
  diorama.playEquipSparkle();
  hud.showToast(previous.basket.coins === 12 ? '12 − 10 = 2' : 'Helmet on!');
  applyResult(previous);
  renderMarket();
  if (step() === 'hatch') setTimeout(closeMarket, 700);
}
function openNaming() {
  if (step() !== 'name') return;
  namingDialog.open('Sprout');
  refresh();
}
function handleSubmitName(name) {
  const previous = state;
  const result = game.nameCreature(state, content, name, Date.now());
  if (!result.success) return;
  state = result.state;
  namingDialog.close();
  diorama.playNameHop();
  hud.showToast(`${state.collection.names[state.egg.hatchedCreatureId]} joined your book!`);
  applyResult(previous);
}
function renderBook() {
  const found = state.egg.hatchedCreatureId;
  const first = content.CREATURES.find((c) => c.id === found);
  const others = content.CREATURES.filter((c) => c.id !== found).slice(0, 5);
  const entries = [first, ...others].filter(Boolean).map((c) => ({
    id: c.id, name: state.collection.names[c.id] || c.name,
    color: c.colors.body, discovered: !!state.collection.owned[c.id],
  }));
  book.render({ foundCount: found ? 1 : 0, total: 6, entries });
}
function feedSprout(now = Date.now()) {
  const previous = state;
  const result = game.feedSunberry(state, content, now);
  if (!result.success) return;
  state = result.state;
  diorama.playFeedSparkle();
  hud.showToast('Nom nom! 1/3');
  applyResult(previous);
}
function closeBook() {
  book.close();
  if (step() === 'book') {
    const previous = state;
    state = game.closeBook(state);
    applyResult(previous);
  } else refresh();
}
hud.onBookOpen(() => { bookOpenedOnce = true; renderBook(); book.open(); refresh(); });
hud.onFeed(() => feedSprout());
hud.onMuteToggle(() => hud.setMuted(audio.toggleMuted()));
function handlePickBand(band) {
  const previous = state;
  state = game.setBand(state, band);
  bandDialog.close();
  applyResult(previous);
}
hud.onGearHold(() => bandDialog.open());
function anyModalOpen() {
  return market.isOpen || namingDialog.backdrop.style.display === 'flex' || book.isOpen || bandDialog.backdrop.style.display === 'flex';
}
function handlePlotTap(index, now, type) {
  const plot = state.farm.plots[index];
  const previous = state;
  if (plot.cropId) {
    if (game.readyPlotIndexes(state, content, now).includes(index)) {
      const result = game.harvestPlot(state, content, index, now);
      if (!result.harvestedCropId) return;
      state = result.state;
      const def = content.CROPS.find((c) => c.id === result.harvestedCropId);
      hud.showToast(`+${def.yield} ${def.name.toLowerCase()}${def.yield > 1 ? 's' : ''}`);
      audio.sfx.harvest();
      diorama.playHarvestPop(index);
    } else {
      const result = game.waterPlot(state, content, index, now);
      if (!result.success) return;
      state = result.state;
      audio.sfx.water();
      diorama.playWaterSplash(index);
    }
  } else {
    if (!['plant', 'replant', 'free'].includes(step())) return;
    if (!trayOpened) { trayOpened = true; refresh(); return; }
    const result = game.plantPlot(state, content, index, selectedSeed, now);
    if (!result.planted) return;
    state = result.state;
    audio.sfx.plant();
    diorama.playPlantPop();
    if (!remainingSeeds().length) trayOpened = false;
  }
  applyResult(previous);
}
function handleEggTap(now) {
  const previous = state;
  const result = game.tapEgg(state, content, now);
  state = result.state;
  if (state === previous) return;
  if (result.hatched) {
    audio.sfx.hatch();
    hatchPauseUntil = now + 5000;
    hud.showToast('Sprout!', 5000);
    setTimeout(openNaming, 5000);
  } else audio.sfx.crack();
  applyResult(previous);
}
canvas.addEventListener('pointerdown', (e) => {
  audio.unlockAudio();
  if (anyModalOpen() || Date.now() < hatchPauseUntil) return;
  const rect = canvas.getBoundingClientRect();
  const hit = diorama.pickAt(((e.clientX - rect.left) / rect.width) * 2 - 1,
    -(((e.clientY - rect.top) / rect.height) * 2 - 1));
  if (!hit) return;
  const now = Date.now();
  if (hit.type === 'plot' || hit.type === 'sprout') handlePlotTap(hit.plotIndex, now, hit.type);
  else if (hit.type === 'seedSack' && ['replant', 'free'].includes(step())) { trayOpened = true; refresh(); }
  else if (hit.type === 'market' || hit.type === 'mannequin') openMarket();
  else if (hit.type === 'egg') handleEggTap(now);
  else if (hit.type === 'creature') feedSprout(now);
});
document.addEventListener('pointerdown', () => audio.unlockAudio(), { once: true });
if (!state.band) bandDialog.open();
if (step() === 'name') openNaming();
refresh();
function tick() {
  const now = Date.now();
  const next = game.checkTimeGates(state, content, now);
  if (next !== state) { state = next; saveGame(state); }
  refresh();
  diorama.update();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
