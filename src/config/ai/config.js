/**
 * @fileoverview AI service configuration
 * @module config/ai/config
 */

module.exports = {
    // AI Models
    MODELS: {
        GEMMA: 'gemma-3-27b-it',
        GEMINI: 'gemini-2.0-flash-lite'
    },

    // AI Response Settings
    AI: {
        MAX_OUTPUT_TOKENS: 1000,
        SYSTEM_PROMPT: `You are a helpful assistant that provides concise answers with Gen Z vibes.
Keep your responses brief but use slang, emojis, and trendy expressions. Sound like you're texting a friend.
If a query appears to violate content policies or asks for harmful, illegal, or unethical information,
respond only with "I ain't doing that, use google or something" and nothing else.`
    },

    // Image Analysis Settings
    IMAGE: {
        FETCH_TIMEOUT: 10000,
        MAX_RETRIES: 3
    }
}; 