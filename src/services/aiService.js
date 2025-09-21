/**
 * @fileoverview AI service for text and image analysis
 * @module services/aiService
 */
import { GoogleGenAI } from '@google/genai';
import CONFIG from '../config/config.js';
import logger from './loggerService.js';
// Initialize Google Generative AI client
let genAI;
try {
  genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
} catch (error) {
  logger.discord.apiError('Failed to initialize Google Generative AI client:', error);
  process.exit(1);
}

/**
 * Creates a system prompt for AI responses
 * @param {string} username - Discord username
 * @param {string} serverName - Discord server name
 * @param {number} memberCount - Number of members in server
 * @param {string[]} onlineMemberUsernames - List of online member usernames
 * @returns {string} System prompt
 */
function createSystemPrompt(username, serverName, memberCount, onlineMemberUsernames, history = null) {
  const historyPrompt = history ? `Here is the recent chat history:\n${history}\n` : '';
  return `${CONFIG.AI.AI.SYSTEM_PROMPT}
  ${historyPrompt}
  The user asking this question has the username: ${username}.
  The current Discord server is called: ${serverName}.
  This server has ${memberCount} human members.
  ${onlineMemberUsernames.length > 0 ? `The usernames of some online human members in this server are: ${onlineMemberUsernames.slice(0, 10).join(', ')}${onlineMemberUsernames.length > 10 ? '...' : ''}.` : ''}
  The following text is the user question:`
}

/**
 * Generates a text response using AI
 * @param {string} userPrompt - User's prompt
 * @param {string} username - Discord username
 * @param {string} serverName - Discord server name
 * @param {number} memberCount - Number of members in server
 * @param {string[]} onlineMemberUsernames - List of online member usernames
 * @param {string} history - Conversation history
 * @returns {Promise<string>} AI response
 */
async function generateTextResponse(userPrompt, username, serverName, memberCount, onlineMemberUsernames, history = null) {
  try {
    if (genAI === undefined) {
      genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    }
    const systemPrompt = createSystemPrompt(username, serverName, memberCount, onlineMemberUsernames, history);
    const fullPrompt = systemPrompt + userPrompt;
    const response = await genAI.models.generateContent({
      model: CONFIG.AI.MODELS.GEMMA,
      contents: fullPrompt,
      config: {
        maxOutputTokens: CONFIG.AI.MAX_OUTPUT_TOKENS
      }
    });

    logger.discord.api('AI response:', response);

    if (response.candidates[0].finishReason === 'PROHIBITED_CONTENT') {
      return CONFIG.MESSAGE.ERROR_FALLBACK;
    }

    return response.text;
  } catch (error) {
    logger.discord.apiError('Error generating text response:', error);
    if (error.message?.includes("safety") ||
      error.message?.includes("blocked") ||
      error.message?.includes("policy")) {
      return CONFIG.MESSAGE.ERROR_FALLBACK;
    }
    throw new Error(`AI generation error: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Generates a response for an image using AI
 * @param {string} userPrompt - User's prompt
 * @param {string} imageUrl - URL of the image to analyze
 * @param {string} mimeType - MIME type of the image
 * @param {string} username - Discord username
 * @param {string} serverName - Discord server name
 * @param {number} memberCount - Number of members in server
 * @param {string[]} onlineMemberUsernames - List of online member usernames
 * @param {string} history - Conversation history
 * @returns {Promise<string>} AI response
 */
async function generateImageResponse(userPrompt, imageUrl, mimeType, username, serverName, memberCount, onlineMemberUsernames, history = null) {
  try {
    if (genAI === undefined) {
      genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    }
    const systemPrompt = createSystemPrompt(username, serverName, memberCount, onlineMemberUsernames, history);


    // Fetch image with timeout and retry logic
    const fetchWithTimeout = async (url, options = {}, retries = CONFIG.AI.IMAGE.MAX_RETRIES, timeout = CONFIG.AI.IMAGE.FETCH_TIMEOUT) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
      } catch (error) {
        clearTimeout(timeoutId);
        if (retries > 0) {
          logger.discord.api(`Retrying image fetch (${retries} attempts left)`);
          return fetchWithTimeout(url, options, retries - 1, timeout);
        }
        throw error;
      }
    };

    const response = await fetchWithTimeout(imageUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    const imageArrayBuffer = await response.arrayBuffer();
    const base64ImageData = Buffer.from(imageArrayBuffer).toString('base64');

    const result = await genAI.models.generateContent({
      model: CONFIG.AI.MODELS.GEMINI,
      contents: [
        {
          inlineData: {
            mimeType: mimeType,
            data: base64ImageData,
          },
        },
        { text: systemPrompt + userPrompt }
      ],
      config: {
        maxOutputTokens: CONFIG.AI.MAX_OUTPUT_TOKENS
      }
    });

    if (response.candidates[0].finishReason === 'PROHIBITED_CONTENT') {
      return CONFIG.MESSAGE.ERROR_FALLBACK;
    }

    return response.text;
  } catch (error) {
    logger.discord.apiError('Error generating image response:', error);
    throw new Error(`Image analysis error: ${error.message || 'Unknown error'}`);
  }
}

export {
  generateTextResponse,
  generateImageResponse
}; 