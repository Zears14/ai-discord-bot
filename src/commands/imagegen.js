/**
 * @fileoverview Image generation command
 * @module commands/imagegen
 */

const BaseCommand = require('./BaseCommand');
const { AttachmentBuilder } = require('discord.js');
const { generateImage } = require('../services/imageService');
const { createLoadingEmbed, createErrorEmbed } = require('../utils/embedUtils');
const CONFIG = require('../config/config');

class ImageGenCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'imagegen',
      description: 'Generate images using AI',
      category: 'AI',
      usage: 'imagegen <prompt>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.IMAGE,
      aliases: ['gen', 'generate', 'img']
    });
  }

  async execute(message, args) {
    const prompt = args.join(' ');

    if (!prompt) {
      return message.reply(CONFIG.EMBED.EMPTY_IMAGE_PROMPT)
        .catch(err => console.error(`Failed to send empty prompt message: ${err.message}`));
    }

    let loadingMessage;

    try {
      loadingMessage = await message.reply({
        embeds: [createLoadingEmbed('image', message, this.client)]
      });

      const imageBuffer = await generateImage(prompt);
      const attachment = new AttachmentBuilder(imageBuffer, { name: CONFIG.IMAGE_OUTPUT.FILENAME });

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

module.exports = ImageGenCommand; 