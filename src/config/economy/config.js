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
    DAILY_REWARD_COOLDOWN_SECONDS: 86400, // 24 hours
    MIN_BALANCE: 0,
    RICH_THRESHOLD: 500,
    LEVELING: {
      STATE_KEY: 'levelData',
      XP_COOLDOWN_KEY: 'levelXpCooldownUntil',
      XP_COOLDOWN_SECONDS: 20,
      XP_PER_COMMAND_MIN: 8,
      XP_PER_COMMAND_MAX: 16,
      BASE_XP_TO_LEVEL: 100,
      XP_GROWTH_BPS: 11750, // 1.175x per level (basis points)
    },
    BANK: {
      BALANCE_KEY: 'bankBalance',
      MAX_KEY: 'bankMax',
      DEFAULT_MAX: 100,
      BANK_NOTE: {
        MIN_INCREASE: 10,
        CURRENT_MAX_BPS: 1200, // +12% of current max
        LEVEL_BONUS_PER_LEVEL: 4, // +4 per level
      },
    },
    LOANS: {
      STATE_KEY: 'loanState',
      OVERDUE_PENALTY_BPS: 1200, // +12% when loan becomes overdue
      REMINDER_WINDOW_HOURS: 24, // notify users in DMs when a loan is close to due
      OPTIONS: [
        { id: 'micro', amount: 100, durationDays: 7, interestBps: 500 }, // 5%
        { id: 'starter', amount: 500, durationDays: 7, interestBps: 650 }, // 6.5%
        { id: 'standard', amount: 1000, durationDays: 7, interestBps: 800 }, // 8%
        { id: 'advanced', amount: 5000, durationDays: 7, interestBps: 1100 }, // 11%
        { id: 'highroller', amount: 10000, durationDays: 7, interestBps: 1400 }, // 14%
      ],
    },
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
