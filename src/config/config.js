/**
 * @fileoverview Configuration settings for the Discord bot
 * @module config/config
 */

const { Colors } = require('discord.js');
const botConfig = require('./bot');
const aiConfig = require('./ai');
const embedConfig = require('./embed');
const commandsConfig = require('./commands.config');
const imageConfig = require('./image');
const economyConfig = require('./economy');

/**
 * @constant {Object} CONFIG - Main configuration object
 */
const CONFIG = {
  // Command settings
  COMMANDS: commandsConfig,

  // Bot information
  BOT: {
    VERSION: botConfig.BOT.VERSION
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
    setInstance: botConfig.SERVER.setInstance
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
    ID: '745984199588315216'
  },

  // Server management (top-level for backward compatibility)
  getServer: () => CONFIG.SERVER.getInstance(),
  setServer: (server) => CONFIG.SERVER.setInstance(server)
};

module.exports = CONFIG; 