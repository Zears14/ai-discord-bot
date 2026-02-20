/**
 * @fileoverview Command cooldown settings
 * @module config/commands/cooldowns
 */

export default {
  DEFAULT: 3, // Default cooldown in seconds
  AI: 20, // AI command cooldown in seconds
  IMAGE: 60, // Image generation cooldown in seconds
  EXTERNAL_API: 20, // External API commands (weather/convert/etc)
  ECONOMY: 8, // Economy commands (betting, balance-affecting actions)
  STATS: 12, // Heavier profile/activity/stat aggregate commands
};
