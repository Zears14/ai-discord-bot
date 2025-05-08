/**
 * @fileoverview AI command for text and image analysis
 * @module commands/ai
 */

const BaseCommand = require('./BaseCommand');
const { generateTextResponse, generateImageResponse } = require('../services/aiService');
const { createLoadingEmbed, createResponseEmbed, createErrorEmbed, sendLongResponse } = require('../utils/embedUtils');
const { getServerInfo } = require('../utils/serverUtils');
const CONFIG = require('../config/config');

class AICommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'ai',
      description: 'Process text or image with AI',
      category: 'AI',
      usage: 'ai <query> or attach an image',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.AI,
      aliases: ['ask', 'question']
    });
  }

  async execute(message, args) {
    const query = args.join(' ');

    if (!query && message.attachments.size === 0) {
      return message.reply(CONFIG.EMBED.EMPTY_QUERY)
        .catch(err => console.error(`Failed to send empty query message: ${err.message}`));
    }

    let loadingMessage;

    try {
      loadingMessage = await message.reply({
        embeds: [createLoadingEmbed('ai', message, this.client)]
      });

      const serverInfo = await getServerInfo(message);
      let aiResponse;

      if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        if (attachment?.contentType?.startsWith('image/')) {
          aiResponse = await generateImageResponse(
            query,
            attachment.url,
            attachment.contentType,
            ...serverInfo
          );
        } else {
          aiResponse = await generateTextResponse(query, ...serverInfo);
        }
      } else {
        aiResponse = await generateTextResponse(query, ...serverInfo);
      }

      const responseEmbed = createResponseEmbed(aiResponse, message, this.client);
      await sendLongResponse(aiResponse, loadingMessage, responseEmbed);
    } catch (error) {
      console.error('AI command error:', error);
      if (loadingMessage) {
        await loadingMessage.edit({
          embeds: [createErrorEmbed('ai', error, message, this.client)]
        }).catch(err => console.error(`Failed to update loading message: ${err.message}`));
      } else {
        await message.reply({
          embeds: [createErrorEmbed('ai', error, message, this.client)]
        }).catch(err => console.error(`Failed to send error message: ${err.message}`));
      }
    }
  }
}

module.exports = AICommand; 