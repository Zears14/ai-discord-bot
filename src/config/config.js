/**
 * @fileoverview Configuration settings for the Discord bot
 * @module config/config
 */

const { Colors } = require('discord.js');
const botConfig = require('./bot');
const aiConfig = require('./ai');
const embedConfig = require('./embed');
const commandsConfig = require('./commands.config');

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

  // AI models
  MODELS: aiConfig.MODELS,

  // Image generation settings
  IMAGE_GEN: aiConfig.IMAGE_GEN,

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

  // AI response settings
  AI: aiConfig.AI,

  // Generated image settings
  IMAGE_OUTPUT: aiConfig.IMAGE_OUTPUT,

  // Server management (top-level for backward compatibility)
  getServer: () => CONFIG.SERVER.getInstance(),
  setServer: (server) => CONFIG.SERVER.setInstance(server)
};

module.exports = CONFIG; 