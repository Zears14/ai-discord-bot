/**
 * @fileoverview Coinflip gambling command
 * @module commands/coinflip
 */

import { randomInt } from 'node:crypto';
import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import logger from '../services/loggerService.js';
import { formatMoney, parsePositiveAmount } from '../utils/moneyUtils.js';

function normalizeChoice(choice) {
  const normalized = choice.toLowerCase();
  if (normalized === 'h' || normalized === 'heads') return 'heads';
  if (normalized === 't' || normalized === 'tails') return 'tails';
  return null;
}

class CoinflipCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'coinflip',
      description: 'Bet on heads or tails',
      category: 'Economy',
      usage: 'coinflip <heads|tails> <bet>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: ['cf', 'flip'],
      exclusiveSession: true,
    });
  }

  async execute(message, args) {
    if (args.length !== 2) {
      return message.reply('Usage: `coinflip <heads|tails> <bet>`');
    }

    const userId = message.author.id;
    const guildId = message.guild.id;
    const choice = normalizeChoice(args[0]);
    if (!choice) {
      return message.reply('Please choose `heads` or `tails`.');
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
      await economy.updateBalance(userId, guildId, -bet, 'coinflip-bet');
      betDeducted = true;

      const spinEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle('🪙 Coinflip')
        .setDescription('Flipping the coin...')
        .setTimestamp();
      const gameMessage = await message.reply({ embeds: [spinEmbed] });

      await new Promise((resolve) => setTimeout(resolve, 900));

      const result = randomInt(2) === 0 ? 'heads' : 'tails';
      const win = result === choice;
      const payout = win ? bet * 2n : 0n;

      if (win) {
        await economy.updateBalance(userId, guildId, payout, 'coinflip-win');
      } else {
        await economy.updateBalance(userId, guildId, 0n, 'coinflip-loss');
      }
      settled = true;

      const newBalance = await economy.getBalance(userId, guildId);
      const resultEmbed = new EmbedBuilder()
        .setColor(win ? CONFIG.COLORS.SUCCESS : CONFIG.COLORS.ERROR)
        .setTitle('🪙 Coinflip Result')
        .setDescription(
          `You picked **${choice.toUpperCase()}**.\nCoin landed on **${result.toUpperCase()}**.\n${win ? `You won ${formatMoney(bet)} cm Dih!` : `You lost ${formatMoney(bet)} cm Dih.`}`
        )
        .addFields({ name: 'New Balance', value: `${formatMoney(newBalance)} cm`, inline: true })
        .setTimestamp();

      await gameMessage.edit({ embeds: [resultEmbed] });
    } catch (error) {
      if (betDeducted && !settled) {
        await economy
          .updateBalance(userId, guildId, bet, 'coinflip-refund')
          .catch((refundError) => {
            logger.discord.dbError('Failed to refund interrupted coinflip bet:', refundError);
          });
      }
      throw error;
    }
  }
}

export default CoinflipCommand;
