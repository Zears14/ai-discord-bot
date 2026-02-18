/**
 * @fileoverview Economy service configuration
 * @module config/economy/config
 */

export default {
  // Database Settings
  DATABASE: {
    COLLECTION: 'userBalances',
    DEFAULT_BALANCE: 0,
  },

  // Economy Settings
  ECONOMY: {
    GROW_INTERVAL: 12, // hours
    MIN_BALANCE: 0,
    RICH_THRESHOLD: 500,
    GROW_SCALING: {
      BASE_MIN: 8,
      BASE_MAX: 30,
      MAX_RATE: 0.03,
      MIN_RATE: 0.004,
      RANGE_LOW_MULTIPLIER: 0.65,
      RANGE_HIGH_MULTIPLIER: 1.35,
      SLOWDOWN_PIVOT: 2500,
      SLOWDOWN_POWER: 0.9,
      NEGATIVE_UNLOCK_BALANCE: 20,
      NEGATIVE_BASE_CHANCE: 0.12,
      NEGATIVE_EXTRA_CHANCE: 0.23,
      MAX_NEGATIVE_CHANCE: 0.35,
      NEGATIVE_MIN: 1,
      NEGATIVE_RATE_MIN: 0.01,
      NEGATIVE_RATE_MAX: 0.16,
      NEGATIVE_RANGE_LOW_MULTIPLIER: 0.7,
      NEGATIVE_RANGE_HIGH_MULTIPLIER: 1.45,
      JACKPOT_BASE_CHANCE: 0.18,
      JACKPOT_BONUS_MIN: 3,
      JACKPOT_BONUS_SCALE: 0.45,
    },
  },
};
