/**
 * @fileoverview Poll command with reaction-based voting
 * @module commands/poll
 */

import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import logger from '../services/loggerService.js';

const POLL_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function parsePollInput(input) {
  const parts = input
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return null;
  }

  if (parts.length === 1) {
    return {
      question: parts[0],
      options: ['Yes', 'No'],
    };
  }

  return {
    question: parts[0],
    options: parts.slice(1),
  };
}

class PollCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'poll',
      description: 'Create a reaction poll',
      category: 'Utility',
      usage: 'poll <question> | <option1> | <option2> [| optionN]',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
      aliases: ['vote'],
    });
  }

  async execute(message, args) {
    const input = args.join(' ').trim();
    if (!input) {
      return message.reply(
        'Usage: `poll <question> | <option1> | <option2> [| optionN]`\nExample: `poll Best language? | JavaScript | Python | Go`'
      );
    }

    const parsed = parsePollInput(input);
    if (!parsed) {
      return message.reply('Invalid poll format.');
    }

    const { question, options } = parsed;
    if (options.length < 2) {
      return message.reply('A poll needs at least 2 options.');
    }
    if (options.length > 10) {
      return message.reply('A poll can have at most 10 options.');
    }

    const optionsText = options
      .map((option, index) => `${POLL_EMOJIS[index]} ${option}`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(CONFIG.COLORS.DEFAULT)
      .setTitle('📊 New Poll')
      .setDescription(`**${question}**`)
      .addFields({ name: 'Options', value: optionsText })
      .setFooter({
        text: `Created by ${message.author.tag}`,
        iconURL: message.author.displayAvatarURL(),
      })
      .setTimestamp();

    try {
      const pollMessage = await message.reply({ embeds: [embed] });

      for (let index = 0; index < options.length; index++) {
        await pollMessage.react(POLL_EMOJIS[index]);
      }

      return null;
    } catch (error) {
      logger.discord.cmdError('Poll command error:', error);
      return message.reply(
        'Failed to create poll reactions. Ensure I have `Add Reactions` and `Read Message History` permissions.'
      );
    }
  }
}

export default PollCommand;
