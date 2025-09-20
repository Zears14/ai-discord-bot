/**
 * @fileoverview Utility functions for creating Discord embeds
 * @module utils/embedUtils
 */

import { EmbedBuilder } from 'discord.js';
import CONFIG from '../config/config.js';

/**
 * Creates a loading embed for AI or image generation
 * @param {string} type - Type of loading embed ('ai' or 'image')
 * @param {Message} message - Discord.js message object
 * @param {Client} client - Discord.js client
 * @returns {EmbedBuilder} Loading embed
 */
function createLoadingEmbed(type, message, client) {
  const embedData = {
    'ai': {
      color: CONFIG.COLORS.AI_LOADING,
      title: CONFIG.EMBED.AI_TITLE,
      description: CONFIG.EMBED.AI_LOADING
    },
    'image': {
      color: CONFIG.COLORS.IMAGE_LOADING,
      title: CONFIG.EMBED.IMAGE_TITLE,
      description: `Generating image for: "${message.content.slice(message.content.indexOf(' ') + 1).trim()}"`,
      thumbnail: client.user.displayAvatarURL()
    }
  };

  const data = embedData[type];

  return new EmbedBuilder()
    .setColor(data.color)
    .setAuthor({ name: data.title, iconURL: client.user.displayAvatarURL() })
    .setDescription(data.description)
    .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
    .setTimestamp();
}

/**
 * Creates a response embed for AI responses
 * @param {string} responseText - AI response text
 * @param {Message} message - Discord.js message object
 * @param {Client} client - Discord.js client
 * @returns {EmbedBuilder} Response embed
 */
function createResponseEmbed(responseText, message, client) {
  const length = responseText.length ?? 0;
  const sanitizedText =  length > CONFIG.MESSAGE.SIZE_LIMIT
    ? responseText.substring(0, CONFIG.MESSAGE.SIZE_LIMIT) + '...'
    : responseText;

  return new EmbedBuilder()
    .setColor(CONFIG.COLORS.AI_RESPONSE)
    .setAuthor({ name: CONFIG.EMBED.AI_TITLE, iconURL: client.user.displayAvatarURL() })
    .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
    .setTimestamp()
    .setDescription(sanitizedText);
}

/**
 * Creates an error embed
 * @param {string} type - Type of error embed ('ai' or 'image')
 * @param {Error} error - Error object
 * @param {Message} message - Discord.js message object
 * @param {Client} client - Discord.js client
 * @returns {EmbedBuilder} Error embed
 */
function createErrorEmbed(type, error, message, client) {
  const errorMessage = error?.message || error?.toString() || 'Unknown error';

  const embedData = {
    'ai': {
      color: CONFIG.COLORS.ERROR,
      title: CONFIG.EMBED.AI_TITLE,
      description: CONFIG.EMBED.ERROR_AI
    },
    'image': {
      color: CONFIG.COLORS.ERROR,
      title: CONFIG.EMBED.IMAGE_TITLE,
      description: `${CONFIG.EMBED.ERROR_IMAGE_PREFIX}${errorMessage}`
    }
  };

  const data = embedData[type];

  return new EmbedBuilder()
    .setColor(data.color)
    .setAuthor({ name: data.title, iconURL: client.user.displayAvatarURL() })
    .setDescription(data.description)
    .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
    .setTimestamp();
}

/**
 * Sends a long response by splitting it into multiple messages if needed
 * @param {string} responseText - Response text to send
 * @param {Message} message - Discord.js message object
 * @param {EmbedBuilder} firstMessageEmbed - Embed for the first message
 * @returns {Promise<void>}
 */
async function sendLongResponse(responseText, message, firstMessageEmbed) {
  try {
    // Send the first part of the message
    await message.edit({ embeds: [firstMessageEmbed] });

    // If response exceeds the limit, send additional parts
    if (responseText.length > CONFIG.MESSAGE.SIZE_LIMIT) {
      const chunks = [];
      for (let i = CONFIG.MESSAGE.SIZE_LIMIT; i < responseText.length; i += CONFIG.MESSAGE.SIZE_LIMIT) {
        chunks.push(responseText.substring(i, Math.min(responseText.length, i + CONFIG.MESSAGE.SIZE_LIMIT)));
      }

      for (let i = 0; i < chunks.length; i++) {
        const additionalEmbed = new EmbedBuilder()
          .setColor(CONFIG.COLORS.AI_RESPONSE)
          .setDescription(chunks[i])
          .setFooter({
            text: `Part ${i + 2}/${chunks.length + 1} • Requested by ${message.author.tag}`,
            iconURL: message.author.displayAvatarURL()
          });
        await message.channel.send({ embeds: [additionalEmbed] });
      }
    }
  } catch (error) {
    console.error('Error sending long response:', error);
    throw new Error('Failed to send complete response');
  }
}

export {
  createLoadingEmbed,
  createResponseEmbed,
  createErrorEmbed,
  sendLongResponse
}; 