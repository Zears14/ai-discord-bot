/**
 * @fileoverview Dice gambling command
 * @module commands/dice
 */

import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import logger from '../services/loggerService.js';
import { formatMoney, parsePositiveAmount } from '../utils/moneyUtils.js';

class DiceCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'dice',
      description: 'Bet on an exact d6 roll',
      category: 'Economy',
      usage: 'dice <1-6> <bet>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: ['d6', 'dicebet'],
      exclusiveSession: true,
    });
  }

  async execute(message, args) {
    if (args.length !== 2) {
      return message.reply('Usage: `dice <1-6> <bet>`');
    }

    const userId = message.author.id;
    const guildId = message.guild.id;
    const pickedNumber = Number.parseInt(args[0], 10);
    if (!Number.isInteger(pickedNumber) || pickedNumber < 1 || pickedNumber > 6) {
      return message.reply('Please pick a valid number from 1 to 6.');
    }

    let bet;
    try {
      bet = parsePositiveAmount(args[1], 'Bet amount');
    } catch {
      return message.reply('Please provide a valid bet amount.');
    }

    const balance = await economy.getBalance(userId, guildId);
    if (balance < bet) {
      return message.reply(`You don't have enough Dih! Your balance: ${formatMoney(balance)} cm`);
    }

    let betDeducted = false;
    let settled = false;

    try {
      await economy.updateBalance(userId, guildId, -bet, 'dice-bet');
      betDeducted = true;

      const rollEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle('🎲 Dice Roll')
        .setDescription('Rolling...')
        .setTimestamp();
      const gameMessage = await message.reply({ embeds: [rollEmbed] });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const roll = Math.floor(Math.random() * 6) + 1;
      const win = roll === pickedNumber;
      const payout = win ? bet * 6n : 0n;

      if (win) {
        await economy.updateBalance(userId, guildId, payout, 'dice-win');
      } else {
        await economy.updateBalance(userId, guildId, 0n, 'dice-loss');
      }
      settled = true;

      const newBalance = await economy.getBalance(userId, guildId);
      const resultEmbed = new EmbedBuilder()
        .setColor(win ? CONFIG.COLORS.SUCCESS : CONFIG.COLORS.ERROR)
        .setTitle('🎲 Dice Result')
        .setDescription(
          `You picked **${pickedNumber}**.\nDice rolled **${roll}**.\n${win ? `Jackpot! You won ${formatMoney(bet * 5n)} cm Dih.` : `You lost ${formatMoney(bet)} cm Dih.`}`
        )
        .addFields({ name: 'New Balance', value: `${formatMoney(newBalance)} cm`, inline: true })
        .setTimestamp();

      await gameMessage.edit({ embeds: [resultEmbed] });
    } catch (error) {
      if (betDeducted && !settled) {
        await economy.updateBalance(userId, guildId, bet, 'dice-refund').catch((refundError) => {
          logger.discord.dbError('Failed to refund interrupted dice bet:', refundError);
        });
      }
      throw error;
    }
  }
}

export default DiceCommand;
