/**
 * @fileoverview Configuration for dig command
 * @module config/commands/dig
 */

export default {
  TOOL_ITEM_NAME: 'shovel',
  COOLDOWN_KEY: 'digCooldownUntil',
  ACTION_COOLDOWN_SECONDS: 300, // 5 minutes
  REWARD_MIN: 30,
  REWARD_MAX: 110,
  SCALING: {
    BALANCE_PIVOT: 6000,
    BALANCE_CURVE_POWER: 0.95,
    BALANCE_MIN_MULT_BPS: 6000, // 0.60x at very low balance
    BALANCE_MAX_MULT_BPS: 22000, // 2.20x wealth scaling cap (before level)
    LEVEL_BONUS_BPS_PER_LEVEL: 90, // +0.90% per level
    LEVEL_BONUS_MAX_BPS: 7000, // +70% max from level
    GLOBAL_MAX_MULT_BPS: 32000, // absolute cap: 3.20x
    REWARD_CAP_BASE: 110, // fixed cap cushion
    REWARD_BALANCE_CAP_BPS: 45, // plus 0.45% of total balance
  },
  BREAK_CHANCE_BPS: 1500, // 15%
  DEATH_CHANCE_BPS: 500, // 5%
  DEATH_LOSS_MIN_PERCENT: 25,
  DEATH_LOSS_MAX_PERCENT: 75,
  SITES: [
    'You searched an old construction site.',
    'You dug around a ruined foundation.',
    'You explored a dusty field at dawn.',
    'You probed a forgotten trail near the hills.',
  ],
  ACTIONS: [
    'You drive the shovel down and clear packed dirt...',
    'You dig wider and sift through old rubble...',
    'You keep digging as the ground gets unstable...',
    'You pry up heavy soil and push deeper...',
  ],
  FIND_MESSAGES: [
    'You uncovered valuables and sold them.',
    'You found old coins and traded them fast.',
    'You dug up scrap and antiques worth real money.',
    'You discovered buried trinkets and cashed out.',
  ],
  DEATH_MESSAGES: [
    'The ground collapsed and trapped you.',
    'A hidden gas pocket ignited underground.',
    'A cave-in hit before you could react.',
    'You fell into a deep sinkhole.',
  ],
  BREAK_MESSAGES: [
    'Your shovel handle snapped in half.',
    'Your shovel blade bent and broke.',
    'The shovel cracked under heavy rock.',
    'Your shovel is destroyed after the dig.',
  ],
};
