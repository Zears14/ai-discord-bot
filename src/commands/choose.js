/**
 * @fileoverview Choose command for decision making
 * @module commands/choose
 */

const BaseCommand = require('./BaseCommand');
const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config/config');

class ChooseCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'choose',
      description: 'Choose between multiple options',
      category: 'Fun',
      usage: 'choose <option1> | <option2> [| option3...]',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
      aliases: ['pick', 'decide']
    });
  }

  async execute(message, args) {
    const input = args.join(' ');
    
    if (!input) {
      return message.reply('Please provide some options to choose from! Use | to separate them.\nExample: `$choose pizza | burger | pasta`');
    }

    const options = input.split('|').map(opt => opt.trim()).filter(opt => opt.length > 0);

    if (options.length < 2) {
      return message.reply('Please provide at least 2 options to choose from!');
    }

    if (options.length > 10) {
      return message.reply('Too many options! Please provide 10 or fewer options.');
    }

    const choice = options[Math.floor(Math.random() * options.length)];
    const emojis = ['🎯', '🎲', '🎮', '🎪', '🎨', '🎭', '🎪', '🎯', '🎲', '🎮'];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

    const embed = new EmbedBuilder()
      .setColor(CONFIG.COLORS.DEFAULT)
      .setTitle('🤔 Decision Maker')
      .setDescription(`I choose: **${choice}** ${randomEmoji}`)
      .addFields(
        { name: 'Options', value: options.map((opt, i) => `${i + 1}. ${opt}`).join('\n') }
      )
      .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }
}

module.exports = ChooseCommand; 