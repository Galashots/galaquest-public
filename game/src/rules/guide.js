// The goal chip: what to do next and where the arrow points. Pure, no DOM.
//
// During the tutorial the chip follows content.TUTORIAL. In free play it walks FREE_PLAY_GOALS
// in priority order and shows the first one that applies, so there is always an obvious next
// step. New systems add their own entry to that list.
//
// A goal is { step, text, targetKey, plotIndex?, eggId? }.
// targetKey: 'plot' | 'sprout' | 'ripeCrop' | 'market' | 'mannequin' | 'egg' | 'nameDialog'
//          | 'book' | 'creature'
import * as economy from './economy.js';
import * as farm from './farm.js';
import { cropsById, findById } from './state.js';
import { step } from './progress.js';
import { readyPlotIndexes, unwateredGrowingPlotIndexes } from './planting.js';
import { openBoardOrders } from './market.js';
import { unhatchedEggs, firstCreatureId } from './creatures.js';
import { unseenRewards } from './rewards.js';

const firstEmptyPlot = (state) => state.farm.plots.findIndex((p) => !p.cropId);
const firstPlantedPlot = (state) => state.farm.plots.findIndex((p) => p.cropId);

function waitingOnCrops(state, content, now) {
  const unwatered = unwateredGrowingPlotIndexes(state, content, now);
  if (unwatered.length) return { text: 'Water your sprouts', targetKey: 'sprout', plotIndex: unwatered[0] };
  return { text: 'Your crops are growing...', targetKey: 'sprout', plotIndex: firstPlantedPlot(state) };
}

/** Free play, highest priority first. Each returns a goal or null. */
export const FREE_PLAY_GOALS = [
  (state, content) => {
    const reward = unseenRewards(state, content)[0];
    return reward ? { text: reward.title, targetKey: 'market' } : null;
  },
  (state) => {
    const egg = unhatchedEggs(state).find((e) => e.readyToHatch);
    return egg ? { text: `Tap the ${egg.label || 'egg'}!`, targetKey: 'egg', eggId: egg.id } : null;
  },
  (state, content) => {
    // Only send the child to Pip when an order can actually be filled.
    const offers = state.orderBoard ? openBoardOrders(state, content) : content.OFFERS;
    return offers.some((o) => economy.canFulfillOffer(state.basket, o))
      ? { text: 'Pip wants more carrots', targetKey: 'market' } : null;
  },
  (state, content, now) => {
    const ready = readyPlotIndexes(state, content, now);
    return ready.length ? { text: 'Pick your crops', targetKey: 'ripeCrop', plotIndex: ready[0] } : null;
  },
  (state, content) => {
    const empty = firstEmptyPlot(state);
    if (empty < 0) return null;
    const limited = Object.entries(state.seeds || {}).find(([, n]) => n > 0);
    if (limited) {
      const crop = findById(content.CROPS, limited[0]);
      return { text: crop?.starSeed ? 'Plant your star seed!' : `Plant your ${crop?.name.toLowerCase()} seed!`, targetKey: 'plot', plotIndex: empty };
    }
    return { text: 'Plant more carrots', targetKey: 'plot', plotIndex: empty };
  },
  (state, content, now) => {
    const unwatered = unwateredGrowingPlotIndexes(state, content, now);
    return unwatered.length ? { text: 'Water your sprouts', targetKey: 'sprout', plotIndex: unwatered[0] } : null;
  },
  (state, content, now) => {
    // Everything is planted and watered: point at the crop closest to ripe.
    const byId = cropsById(content);
    const soonest = state.farm.plots
      .map((p, i) => ({ i, progress: p.cropId ? farm.getGrowthProgress(p, byId.get(p.cropId), now) : -1 }))
      .sort((a, b) => b.progress - a.progress)[0];
    return { text: 'Your crops are growing...', targetKey: 'sprout', plotIndex: soonest ? soonest.i : 0 };
  },
];

const TUTORIAL_GOALS = {
  plant: (state) => ({
    text: state.farm.plots.some((p) => p.cropId) ? 'Plant all 3 seeds' : 'Plant a seed',
    targetKey: 'plot', plotIndex: firstEmptyPlot(state),
  }),
  grow: waitingOnCrops,
  harvest: (state, content, now) => {
    const ready = readyPlotIndexes(state, content, now);
    if (ready.length) return { text: 'Pick your crops', targetKey: 'ripeCrop', plotIndex: ready[0] };
    return { text: 'Your crops are growing...', targetKey: 'sprout', plotIndex: firstPlantedPlot(state) };
  },
  market: () => ({ text: 'Go to the market', targetKey: 'market' }),
  offer: () => ({ text: 'Pick a deal', targetKey: 'market' }),
  armor: () => ({ text: 'Buy the helmet', targetKey: 'mannequin' }),
  hatch: () => ({ text: 'Tap the egg!', targetKey: 'egg', eggId: 'starter' }),
  name: () => ({ text: 'Name your creature', targetKey: 'nameDialog' }),
  book: () => ({ text: 'Open your book', targetKey: 'book' }),
  feed: (state, content) => {
    const id = firstCreatureId(state);
    const name = state.collection.names[id] || findById(content.CREATURES, id)?.name || 'your creature';
    const food = findById(content.CROPS, content.FEEDING.food)?.name.toLowerCase() || content.FEEDING.food;
    return { text: `Feed ${name} a ${food}`, targetKey: 'creature' };
  },
  replant: (state, content, now) => {
    if (farm.allPlotsEmpty(state.farm)) return { text: 'Plant again', targetKey: 'plot', plotIndex: firstEmptyPlot(state) };
    const empty = firstEmptyPlot(state);
    if ((state.replantPlanted || 0) < content.TUTORIAL_SEEDS.replant.length && empty >= 0) {
      return { text: 'Plant all 3 carrots', targetKey: 'plot', plotIndex: empty };
    }
    const ready = readyPlotIndexes(state, content, now);
    if (ready.length) return { text: 'Pick your crops', targetKey: 'ripeCrop', plotIndex: ready[0] };
    return waitingOnCrops(state, content, now);
  },
};

export function currentGoal(state, content, now) {
  const current = step(state);
  const tutorial = TUTORIAL_GOALS[current];
  if (tutorial) return { step: current, ...tutorial(state, content, now) };
  for (const suggest of FREE_PLAY_GOALS) {
    const goal = suggest(state, content, now);
    if (goal) return { step: current, ...goal };
  }
  return { step: current, text: '', targetKey: null };
}
