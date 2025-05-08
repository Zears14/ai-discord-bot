/**
 * @fileoverview Configuration settings for the Discord bot
 * @module config/config
 */

const { Colors } = require('discord.js');

/**
 * @constant {Object} CONFIG - Main configuration object
 */
const CONFIG = {
  // Command settings
  COMMANDS: {
    COOLDOWNS: {
      DEFAULT: 5, // Default cooldown in seconds
      AI: 20,     // AI command cooldown in seconds
      IMAGE: 60   // Image generation cooldown in seconds
    }
  },

  // Bot information
  BOT: {
    SUPPORT_SERVER_URL: 'https://discord.gg', // Replace with your support server URL
    INVITE_URL: 'https://discord.com/api/oauth2/authorize', // Replace with your bot's invite URL
    VERSION: '1.0.0'
  },

  // AI models
  MODELS: {
    GEMMA: "gemma-3-27b-it",
    GEMINI: "gemini-2.0-flash-lite"
  },

  // Image generation settings
  IMAGE_GEN: {
    API_URL: 'https://ir-api.myqa.cc/v1/openai/images/generations',
    MODEL: "stabilityai/sdxl-turbo:free",
    QUALITY: "auto",
    TIMEOUT: 30000 // 30 second timeout
  },

  // Discord message settings
  MESSAGE: {
    SIZE_LIMIT: 4000,
    ERROR_FALLBACK: "I ain't doing that, use google or something",
    PREFIX: '$' // Bot command prefix
  },

  // Health check server
  SERVER: {
    PORT: process.env.PORT || 8000,
    HEALTH_MESSAGE: 'Discord Bot is alive!'
  },

  // Discord embed colors
  COLORS: {
    AI_LOADING: Colors.Blue,
    AI_RESPONSE: Colors.Green,
    IMAGE_LOADING: Colors.Purple,
    ERROR: Colors.Red,
    DEFAULT: Colors.Blurple
  },

  // Discord embed texts
  EMBED: {
    AI_TITLE: 'Zears AI H',
    IMAGE_TITLE: 'Zears AI Image Gen',
    AI_LOADING: 'Processing your query with zears ai h',
    ERROR_AI: 'Ts is having no.',
    ERROR_IMAGE_PREFIX: 'Failed to generate image. Error: ',
    EMPTY_QUERY: 'What am i supposed to do nga?',
    EMPTY_IMAGE_PROMPT: 'What do you want me to generate nga?'
  },

  // AI response settings
  AI: {
    MAX_OUTPUT_TOKENS: 1000,
    SYSTEM_PROMPT: 'You are a helpful assistant that provides concise answers with Gen Z vibes. Keep your responses brief but use slang, emojis, and trendy expressions. Sound like you\'re texting a friend.'
  },

  // Generated image settings
  IMAGE_OUTPUT: {
    FILENAME: 'generated_image.png',
    MAX_SIZE: 8 * 1024 * 1024 // 8MB max file size
  }
};

module.exports = CONFIG; 