/**
 * @fileoverview Image generation service
 * @module services/imageService
 */
import logger from './loggerService.js';

/**
 * Generates an image using the image generation API
 * @param {string} prompt - Image generation prompt
 * @returns {Promise<Buffer>} Generated image buffer
 */
async function generateImage(prompt, negative_prompt = null) {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
      throw new Error('Cloudflare account ID or API token is not set in environment variables.');
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/bytedance/stable-diffusion-xl-lightning`;

    const payload = { prompt };
    if (negative_prompt) {
      payload.negative_prompt = negative_prompt;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Cloudflare API responded with status ${response.status}: ${errorData}`);
    }

    const imageBuffer = await response.arrayBuffer();
    return Buffer.from(imageBuffer);
  } catch (error) {
    logger.discord.apiError('Error generating image with Cloudflare AI:', error);
    throw new Error(`Image generation failed: ${error.message || 'Unknown error'}`);
  }
}

export { generateImage };
