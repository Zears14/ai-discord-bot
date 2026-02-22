/**
 * @fileoverview Roulette command for gambling.
 * @module commands/roulette
 */

import { randomInt } from 'node:crypto';
import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import logger from '../services/loggerService.js';
import { formatMoney, parsePositiveAmount } from '../utils/moneyUtils.js';

// Roulette wheel configuration
const ROULETTE_NUMBERS = [...Array(37).keys()]; // 0-36
const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const BLACK_NUMBERS = [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35];

class RouletteCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'roulette',
      description: 'Play roulette with your Dih.',
      category: 'Economy',
      usage: 'roulette <bet_type> <amount>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: ['roul'],
      exclusiveSession: true,
    });
  }

  async execute(message, args) {
    const userId = message.author.id;
    const guildId = message.guild.id;

    // Check arguments
    if (args.length !== 2) {
      return message.reply(
        'Please provide a bet type and an amount. Usage: `roulette <bet_type> <amount>`\n**Bet Types:** `red`, `black`, `even`, `odd`, or a number from 0-36.'
      );
    }

    const betType = args[0].toLowerCase();
    let amount;

    // Validate amount
    try {
      amount = parsePositiveAmount(args[1], 'Bet amount');
    } catch {
      return message.reply('Please provide a valid amount to bet.');
    }

    // Check balance
    const balance = await economy.getBalance(userId, guildId);
    if (balance < amount) {
      return message.reply(`You don't have enough Dih! Your balance: ${formatMoney(balance)} cm`);
    }

    // Validate bet type
    const validBetTypes = ['red', 'black', 'even', 'odd', ...ROULETTE_NUMBERS.map(String)];
    if (!validBetTypes.includes(betType)) {
      return message.reply(
        'Invalid bet type. Please choose from: `red`, `black`, `even`, `odd`, or a number from 0-36.'
      );
    }

    let betDeducted = false;
    let settled = false;

    try {
      // Deduct the bet up front to avoid mid-command interruption exploits.
      await economy.updateBalance(userId, guildId, -amount, 'roulette-bet');
      betDeducted = true;

      // Create initial spinning animation embed with loading bar
      const spinEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle('🎰 Roulette Wheel')
        .setDescription('```\n[=         ] Spinning...\n```')
        .setTimestamp();

      const spinMsg = await message.reply({ embeds: [spinEmbed] });

      // Determine result early but don't show it
      const winningNumber = ROULETTE_NUMBERS[randomInt(ROULETTE_NUMBERS.length)];
      const winningColor = RED_NUMBERS.includes(winningNumber)
        ? 'red'
        : BLACK_NUMBERS.includes(winningNumber)
          ? 'black'
          : 'green';

      // Wait for "spin" with just two message updates
      await new Promise((resolve) => setTimeout(resolve, 700));

      // Update with progress
      const midEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle('🎰 Roulette Wheel')
        .setDescription('```\n[=====     ] Still spinning...\n```')
        .setTimestamp();
      await spinMsg.edit({ embeds: [midEmbed] });

      await new Promise((resolve) => setTimeout(resolve, 700));

      // Show final spin with click effect
      const finalSpinEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle('🎰 Roulette Wheel')
        .setDescription('```\n[=========] *Click*\n```')
        .setTimestamp();
      await spinMsg.edit({ embeds: [finalSpinEmbed] });

      await new Promise((resolve) => setTimeout(resolve, 500));

      let payout = 0n;
      let resultMessage = `The ball landed on **${winningNumber} (${winningColor.toUpperCase()})**. You lost ${formatMoney(amount)} cm Dih.`;

      // Check for win
      if (betType === winningColor) {
        payout = amount * 2n;
        resultMessage = `The ball landed on **${winningNumber} (${winningColor.toUpperCase()})**. You won ${formatMoney(amount)} cm Dih!`;
      } else if (betType === 'even' && winningNumber % 2 === 0 && winningNumber !== 0) {
        payout = amount * 2n;
        resultMessage = `The ball landed on **${winningNumber}**. It's an even number! You won ${formatMoney(amount)} cm Dih!`;
      } else if (betType === 'odd' && winningNumber % 2 !== 0) {
        payout = amount * 2n;
        resultMessage = `The ball landed on **${winningNumber}**. It's an odd number! You won ${formatMoney(amount)} cm Dih!`;
      } else if (parseInt(betType) === winningNumber) {
        payout = amount * 36n;
        resultMessage = `The ball landed on **${winningNumber}**. You hit the number! You won ${formatMoney(amount * 35n)} cm Dih!`;
      }

      if (payout > 0n) {
        await economy.updateBalance(userId, guildId, payout, 'roulette-win');
      } else {
        await economy.updateBalance(userId, guildId, 0n, 'roulette-loss');
      }
      settled = true;
      const newBalance = await economy.getBalance(userId, guildId);

      // Create embed
      const embed = new EmbedBuilder()
        .setColor(payout > 0n ? CONFIG.COLORS.SUCCESS : CONFIG.COLORS.ERROR)
        .setTitle('Roulette')
        .setDescription(resultMessage)
        .addFields(
          {
            name: 'Your Bet',
            value: `${betType.toUpperCase()} - ${formatMoney(amount)} cm`,
            inline: true,
          },
          { name: 'New Balance', value: `${formatMoney(newBalance)} cm`, inline: true }
        )
        .setTimestamp();

      // Edit the spinning message with the final result
      return spinMsg.edit({ embeds: [embed] });
    } catch (error) {
      if (betDeducted && !settled) {
        await economy
          .updateBalance(userId, guildId, amount, 'roulette-refund')
          .catch((refundError) => {
            logger.discord.dbError('Failed to refund interrupted roulette bet:', refundError);
          });
      }
      throw error;
    }
  }
}

export default RouletteCommand;
