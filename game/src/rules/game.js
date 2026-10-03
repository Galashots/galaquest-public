// The game's public rules API: one import for main.js and tests. Pure, no DOM, no three.js.
// Each system lives in its own module; this file only re-exports them.
//
//   state.js      state shape, new game, save migrations
//   progress.js   tutorial steps (content.TUTORIAL)
//   planting.js   plant, water, harvest
//   market.js     offers, order board, armor
//   creatures.js  eggs, hatching, naming, feeding, growth
//   rewards.js    rewards earned by playing (content.REWARDS)
//   guide.js      the goal chip and arrow target
export {
  SAVE_VERSION, NUM_PLOTS, STARTER_EGG_ID, createGameState, createEgg, migrateSave, migrateV1,
  starterEgg, findEgg, cropsById,
} from './state.js';
export { step, inFreePlay, completeStep } from './progress.js';
export {
  freeSeedCrop, choosePlantingRecipe, remainingSeeds, plantPlot, waterPlot, getGrowthProgress,
  readyPlotIndexes, unwateredGrowingPlotIndexes, checkTimeGates, harvestPlot, applyVolunteerCarrots,
} from './planting.js';
export {
  BOARD_SEED, boardOffers, firstVisitOffers, ensureOrderBoard, openBoardOrders, visibleOffers, setBand,
  openMarket, canFulfillOffer, fulfillBoardOrder, fulfillOffer, nextArmorForSale, equippedArmorDefs, buyArmor,
} from './market.js';
export {
  hatchCreatureId, unhatchedEggs, tapEgg, firstCreatureId, hatchedCreatures, nameCreatureById, nameCreature,
  closeBook, canFeed, feedCreature, growthStages, adornments, nextGrowthStage,
} from './creatures.js';
export { checkRewards, rewardEarned, newlyEarned, unseenRewards, markRewardSeen, trackProgress } from './rewards.js';
export { currentGoal, FREE_PLAY_GOALS } from './guide.js';
