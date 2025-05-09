/**
 * @fileoverview Bot-related configuration settings
 * @module config/bot/config
 */

// Store server instance
let serverInstance = null;

module.exports = {
  BOT: {
    VERSION: '1.0.0'
  },
  MESSAGE: {
    SIZE_LIMIT: 4000,
    ERROR_FALLBACK: "I ain't doing that, use google or something",
    PREFIX: '$' // Bot command prefix
  },
  SERVER: {
    PORT: process.env.PORT || 8000,
    HEALTH_MESSAGE: 'Discord Bot is alive!',
    // Server instance management
    getInstance: () => serverInstance,
    setInstance: (instance) => {
      serverInstance = instance;
    }
  }
}; 