/**
 * @fileoverview Roll command for dice rolling
 * @module commands/roll
 */

const BaseCommand = require('./BaseCommand');
const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config/config');

class RollCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'roll',
      description: 'Roll some dice',
      category: 'Fun',
      usage: 'roll [number of dice]d[sides]',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
      aliases: ['dice', 'd']
    });
  }

  // Format large numbers with commas
  formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  // Safe random number generation for large numbers
  safeRandom(max) {
    // For numbers that can fit in JavaScript's safe integer range
    if (max <= Number.MAX_SAFE_INTEGER) {
      return Math.floor(Math.random() * max) + 1;
    }

    // For very large numbers, we'll use a different approach
    const maxDigits = max.toString().length;
    const randomDigits = Array.from({ length: maxDigits }, () => 
      Math.floor(Math.random() * 10)
    ).join('');
    
    const randomNum = BigInt(randomDigits);
    const maxNum = BigInt(max);
    
    // If the random number is too large, we'll take modulo
    return Number((randomNum % maxNum) + 1n);
  }

  async execute(message, args) {
    const input = args[0] || '1d6'; // Default to 1d6 if no input
    const match = input.match(/^(\d+)?d(\d+)$/i);

    if (!match) {
      return message.reply('Invalid format! Use `[number of dice]d[sides]`\nExamples: `$roll 2d6` or `$roll d20`');
    }

    const [, numDice = '1', sides] = match;
    const numDiceInt = parseInt(numDice);
    const sidesInt = parseInt(sides);

    if (numDiceInt < 1 || numDiceInt > 10) {
      return message.reply('Please roll between 1 and 10 dice!');
    }

    if (sidesInt < 2) {
      return message.reply('Dice must have at least 2 sides!');
    }

    // Generate rolls
    const rolls = Array.from({ length: numDiceInt }, () => 
      this.safeRandom(sidesInt)
    );

    // Calculate total
    const total = rolls.reduce((sum, roll) => sum + roll, 0);
    const emojis = ['🎲', '🎯', '🎮', '🎪', '🎨', '🎭'];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

    // Format the output
    const formattedRolls = rolls.map(roll => this.formatNumber(roll));
    const formattedTotal = this.formatNumber(total);
    const formattedSides = this.formatNumber(sidesInt);

    const embed = new EmbedBuilder()
      .setColor(CONFIG.COLORS.DEFAULT)
      .setTitle(`${randomEmoji} Dice Roll`)
      .setDescription(`Rolling ${numDiceInt}d${formattedSides}`)
      .addFields(
        { name: 'Rolls', value: formattedRolls.join(', ') },
        { name: 'Total', value: formattedTotal }
      )
      .setFooter({ text: `Rolled by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }
}

module.exports = RollCommand; 