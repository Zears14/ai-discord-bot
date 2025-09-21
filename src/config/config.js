/**
 * @fileoverview Configuration settings for the Discord bot
 * @module config/config
 */
import aiConfig from './ai/config.js';
import botConfig from './bot/config.js';
import commandsConfig from './commands.config.js';
import economyConfig from './economy/config.js';
import embedConfig from './embed/config.js';
import imageConfig from './image/config.js';

/**
 * @constant {Object} CONFIG - Main configuration object
 */
const CONFIG = {
  // Command settings
  COMMANDS: commandsConfig,

  // Bot information
  BOT: {
    VERSION: botConfig.BOT.VERSION,
  },

  // AI models and settings
  AI: aiConfig,

  // Image generation settings
  IMAGE_GEN: imageConfig,

  // Discord message settings
  MESSAGE: botConfig.MESSAGE,

  // Health check server
  SERVER: {
    PORT: botConfig.SERVER.PORT,
    HEALTH_MESSAGE: botConfig.SERVER.HEALTH_MESSAGE,
    getInstance: botConfig.SERVER.getInstance,
    setInstance: botConfig.SERVER.setInstance,
  },

  // Discord embed colors
  COLORS: embedConfig.COLORS,

  // Discord embed texts
  EMBED: embedConfig.EMBED,

  // Economy settings
  ECONOMY: economyConfig.ECONOMY,
  DATABASE: economyConfig.DATABASE,

  // Admin settings
  ADMIN: {
    ID: '745984199588315216',
  },

  // Server management (top-level for backward compatibility)
  getServer: () => CONFIG.SERVER.getInstance(),
  setServer: (server) => CONFIG.SERVER.setInstance(server),
};

export default CONFIG;
