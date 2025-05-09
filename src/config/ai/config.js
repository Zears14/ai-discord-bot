/**
 * @fileoverview AI-related configuration settings
 * @module config/ai/config
 */

module.exports = {
  MODELS: {
    GEMMA: "gemma-3-27b-it",
    GEMINI: "gemini-2.0-flash-lite"
  },
  AI: {
    MAX_OUTPUT_TOKENS: 1000
  },
  IMAGE_GEN: {
    API_URL: 'https://ir-api.myqa.cc/v1/openai/images/generations',
    MODEL: "stabilityai/sdxl-turbo:free",
    QUALITY: "auto",
    TIMEOUT: 30000 // 30 second timeout
  },
  IMAGE_OUTPUT: {
    FILENAME: 'generated_image.png',
    MAX_SIZE: 8 * 1024 * 1024 // 8MB max file size
  }
}; 