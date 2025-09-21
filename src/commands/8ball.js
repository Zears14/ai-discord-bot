/**
 * @fileoverview 8ball command for fortune telling
 * @module commands/8ball
 */

import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';

class EightBallCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: '8ball',
      category: 'Fun',
      description: 'Ask the magic 8ball a question',
      usage: '8ball <question>',
      aliases: ['8b', 'magic8ball'],
      cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
    });
  }

  async execute(message, args) {
    if (!args.length) {
      return message.reply('Please ask a question!');
    }

    const question = args.join(' ');
    const responses = CONFIG.COMMANDS.EIGHTBALL;

    // Randomly select response type (positive, neutral, negative)
    const responseType =
      Math.random() < 0.4 ? 'POSITIVE' : Math.random() < 0.7 ? 'NEUTRAL' : 'NEGATIVE';

    // Get random response from selected type
    const response =
      responses[responseType][Math.floor(Math.random() * responses[responseType].length)];

    // Create embed based on response type
    const embed = new EmbedBuilder()
      .setColor(
        responseType === 'POSITIVE'
          ? CONFIG.COLORS.AI_RESPONSE
          : responseType === 'NEUTRAL'
            ? CONFIG.COLORS.AI_LOADING
            : CONFIG.COLORS.ERROR
      )
      .setTitle('🎱 Magic 8-Ball')
      .addFields({ name: 'Question', value: question }, { name: 'Answer', value: response })
      .setFooter({
        text: `Asked by ${message.author.tag}`,
        iconURL: message.author.displayAvatarURL(),
      })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
}

export default EightBallCommand;
