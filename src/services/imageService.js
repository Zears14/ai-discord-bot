/**
 * @fileoverview Image generation service
 * @module services/imageService
 */

const CONFIG = require('../config/config');

/**
 * Generates an image using the image generation API
 * @param {string} prompt - Image generation prompt
 * @returns {Promise<Buffer>} Generated image buffer
 */
async function generateImage(prompt) {
  try {
    const options = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.IMAGEROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        "prompt": prompt,
        "model": CONFIG.IMAGE_GEN.IMAGE_GEN.MODEL,
        "quality": CONFIG.IMAGE_GEN.IMAGE_GEN.QUALITY
      }),
      timeout: 30000 // 30 second timeout
    };

    const response = await fetch(CONFIG.IMAGE_GEN.IMAGE_GEN.API_URL, options);

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`API responded with status ${response.status}: ${errorData}`);
    }

    const data = await response.json();

    if (!data || !data.data || !data.data.length || !data.data[0].b64_json) {
      console.error('Invalid image generation API response:',
                    JSON.stringify(data, null, 2).substring(0, 500) + '...');
      throw new Error('Failed to generate image - invalid response format');
    }

    const base64Image = data.data[0].b64_json;
    return Buffer.from(base64Image, 'base64');
  } catch (error) {
    console.error('Error generating image:', error);
    throw new Error(`Image generation failed: ${error.message || 'Unknown error'}`);
  }
}

module.exports = {
  generateImage
}; 