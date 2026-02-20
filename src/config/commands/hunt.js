/**
 * @fileoverview Configuration for hunt command
 * @module config/commands/hunt
 */

export default {
  TOOL_ITEM_NAME: 'hunting_rifle',
  COOLDOWN_KEY: 'huntCooldownUntil',
  ACTION_COOLDOWN_SECONDS: 300, // 5 minutes
  REWARD_MIN: 55,
  REWARD_MAX: 165,
  SCALING: {
    BALANCE_PIVOT: 7500,
    BALANCE_CURVE_POWER: 0.9,
    BALANCE_MIN_MULT_BPS: 6500, // 0.65x at very low balance
    BALANCE_MAX_MULT_BPS: 26000, // 2.60x wealth scaling cap (before level)
    LEVEL_BONUS_BPS_PER_LEVEL: 110, // +1.10% per level
    LEVEL_BONUS_MAX_BPS: 9000, // +90% max from level
    GLOBAL_MAX_MULT_BPS: 38000, // absolute cap: 3.80x
    REWARD_CAP_BASE: 180, // fixed cap cushion
    REWARD_BALANCE_CAP_BPS: 70, // plus 0.70% of total balance
  },
  BREAK_CHANCE_BPS: 3200, // 32%
  DEATH_CHANCE_BPS: 800, // 8%
  DEATH_LOSS_MIN_PERCENT: 25,
  DEATH_LOSS_MAX_PERCENT: 75,
  ENCOUNTERS: [
    'You tracked fresh footprints deep into the trees.',
    'You waited silently near a river crossing.',
    'You followed rustling noises through thick brush.',
    'You climbed to a rocky ridge for a better shot.',
  ],
  ACTIONS: [
    'You steady your aim and hold your breath...',
    'You move quietly and line up a careful shot...',
    'You track movement and squeeze the trigger...',
    'You push deeper and prepare for a final attempt...',
  ],
  LOOT_MESSAGES: [
    'You came back with valuable game.',
    'You sold your catch to local traders.',
    'You found a premium pelt and got paid well.',
    'You brought home a heavy haul and cashed out.',
  ],
  DEATH_MESSAGES: [
    'A wild beast charged you out of nowhere.',
    'Your footing slipped near a steep ravine.',
    'A misfire caused a critical accident.',
    'You got ambushed while tracking in dense fog.',
  ],
  BREAK_MESSAGES: [
    'Your rifle stock cracked during the hunt.',
    'Your rifle jammed hard and snapped beyond repair.',
    'Your rifle barrel got damaged and is unusable now.',
    'Your rifle took a bad hit and broke.',
  ],
};
