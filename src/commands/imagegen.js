/**
 * @fileoverview Image generation command
 * @module commands/imagegen
 */

import BaseCommand from './BaseCommand.js';
import { AttachmentBuilder } from 'discord.js';
import { generateImage } from '../services/imageService.js';
import { createLoadingEmbed, createErrorEmbed } from '../utils/embedUtils.js';
import CONFIG from '../config/config.js';

class ImageGenCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'imagegen',
      description: 'Generate images using AI. Use "|" to separate the prompt from the negative prompt.',
      category: 'AI',
      usage: 'imagegen <prompt> | <negative_prompt>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.IMAGE,
      aliases: ['gen', 'generate', 'img']
    });
  }

  async execute(message, args) {
    const fullPrompt = args.join(' ');
    if (!fullPrompt) {
      return message.reply(CONFIG.EMBED.EMPTY_IMAGE_PROMPT)
        .catch(err => console.error(`Failed to send empty prompt message: ${err.message}`));
    }

    const [prompt, negative_prompt] = fullPrompt.split('|').map(s => s.trim());

    if (!prompt) {
      return message.reply(CONFIG.EMBED.EMPTY_IMAGE_PROMPT)
        .catch(err => console.error(`Failed to send empty prompt message: ${err.message}`));
    }

    let loadingMessage;

    try {
      loadingMessage = await message.reply({
        embeds: [createLoadingEmbed('image', message, this.client)]
      });

      const imageBuffer = await generateImage(prompt, negative_prompt);
      const attachment = new AttachmentBuilder(imageBuffer, { name: CONFIG.IMAGE_GEN.IMAGE_OUTPUT.FILENAME });

      // Try to delete loading message but continue if it fails
      await loadingMessage.delete().catch(err => {
        console.warn(`Failed to delete loading message: ${err.message}`);
      });

      await message.channel.send({
        content: `Generated image for ${message.author}:`,
        files: [attachment]
      });
    } catch (error) {
      console.error('Image generation command error:', error);
      if (loadingMessage) {
        await loadingMessage.edit({
          embeds: [createErrorEmbed('image', error, message, this.client)]
        }).catch(err => console.error(`Failed to update loading message: ${err.message}`));
      } else {
        await message.reply({
          embeds: [createErrorEmbed('image', error, message, this.client)]
        }).catch(err => console.error(`Failed to send error message: ${err.message}`));
      }
    }
  }
}

export default ImageGenCommand; 