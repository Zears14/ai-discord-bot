/**
 * @fileoverview Configuration for rob command
 * @module config/commands/rob
 */

import { Colors } from 'discord.js';

export default {
  PROTECTION_KEY: 'robProtectionUntil',
  PROTECTION_MS: 60 * 60 * 1000, // 1 hour
  MIN_BALANCE_TO_ROB: 1,

  CHANCE: {
    BASE: 0.55, // 55% at equal balances
    DECAY: 0.45, // drops as absolute balance difference grows
    MIN: 0.08, // minimum 8% chance
  },

  // Weighted random steal percentage tiers.
  // 100% is possible, but intentionally very rare.
  STEAL_PERCENT_TIERS: [
    { min: 0.05, max: 0.12, weight: 45 },
    { min: 0.12, max: 0.25, weight: 28 },
    { min: 0.25, max: 0.45, weight: 16 },
    { min: 0.45, max: 0.75, weight: 8 },
    { min: 0.75, max: 0.95, weight: 2.8 },
    { min: 1, max: 1, weight: 0.2 },
  ],

  // Weighted random fine percentage of robber's balance on failure.
  FAIL_FINE_PERCENT_TIERS: [
    { min: 0.06, max: 0.12, weight: 50 },
    { min: 0.12, max: 0.2, weight: 30 },
    { min: 0.2, max: 0.35, weight: 15 },
    { min: 0.35, max: 0.5, weight: 5 },
  ],

  COLORS: {
    SUCCESS: Colors.Green,
    FAIL: Colors.Red,
    INFO: Colors.Orange,
  },
};
