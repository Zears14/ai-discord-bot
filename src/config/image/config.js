/**
 * @fileoverview Image generation service configuration
 * @module config/image/config
 */

module.exports = {
    // Image Generation API Settings
    IMAGE_GEN: {
        API_URL: 'https://ir-api.myqa.cc/v1/openai/images/generations',
        MODEL: 'stabilityai/sdxl-turbo:free',
        QUALITY: 'auto',
        TIMEOUT: 30000 // 30 second timeout
    },

    // Image Output Settings
    IMAGE_OUTPUT: {
        FILENAME: 'generated_image.png',
        MAX_SIZE: 8 * 1024 * 1024 // 8MB max file size
    }
}; 