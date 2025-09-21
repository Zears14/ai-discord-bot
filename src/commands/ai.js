/**
 * @fileoverview AI command for text and image analysis
 * @module commands/ai
 */

import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import { generateTextResponse, generateImageResponse } from '../services/aiService.js';
import logger from '../services/loggerService.js';
import {
  createLoadingEmbed,
  createResponseEmbed,
  createErrorEmbed,
  sendLongResponse,
} from '../utils/embedUtils.js';
import { getServerInfo } from '../utils/serverUtils.js';

class AICommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'ai',
      description: 'Process text or image with AI',
      category: 'AI',
      usage: 'ai <query> or attach an image',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.AI,
      aliases: ['ask', 'question'],
    });
  }

  async execute(message, args) {
    let query = args.join(' ');

    // Fetch conversation history
    const messages = await message.channel.messages.fetch({ limit: 51 });
    const history = messages
      .filter((m) => m.id !== message.id && (!m.author.bot || m.author.id === this.client.user.id))
      .map((m) => {
        if (m.author.id === this.client.user.id && m.embeds.length > 0) {
          const embed = m.embeds[0];
          return `${m.author.username}: ${embed.description || ''}`;
        } else {
          return `${m.author.username}: ${m.content}`;
        }
      })
      .reverse()
      .join('\n');

    // Handle reply context
    if (message.reference) {
      try {
        const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
        query = `(in reply to ${repliedTo.author.username}: "${repliedTo.content}") ${query}`;
      } catch (err) {
        logger.warn('Failed to fetch replied to message:', err);
      }
    }

    if (!query && message.attachments.size === 0) {
      return message
        .reply(CONFIG.EMBED.EMPTY_QUERY)
        .catch((err) => logger.discord.error(`Failed to send empty query message: ${err.message}`));
    }

    let loadingMessage;

    try {
      loadingMessage = await message.reply({
        embeds: [createLoadingEmbed('ai', message, this.client)],
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
            ...serverInfo,
            history
          );
        } else {
          aiResponse = await generateTextResponse(query, ...serverInfo, history);
        }
      } else {
        aiResponse = await generateTextResponse(query, ...serverInfo, history);
      }

      const responseEmbed = createResponseEmbed(aiResponse, message, this.client);
      await sendLongResponse(aiResponse, loadingMessage, responseEmbed);
    } catch (error) {
      logger.discord.cmdError('AI command error:', error);
      if (loadingMessage) {
        await loadingMessage
          .edit({
            embeds: [createErrorEmbed('ai', error, message, this.client)],
          })
          .catch((err) => logger.discord.error(`Failed to update loading message: ${err.message}`));
      } else {
        await message
          .reply({
            embeds: [createErrorEmbed('ai', error, message, this.client)],
          })
          .catch((err) => logger.discord.error(`Failed to send error message: ${err.message}`));
      }
    }
  }
}

export default AICommand;
