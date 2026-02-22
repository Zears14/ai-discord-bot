/**
 * @fileoverview Transfer command to send money to other users.
 * @module commands/transfer
 */

import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import logger from '../services/loggerService.js';
import { formatMoney, parsePositiveAmount } from '../utils/moneyUtils.js';

class TransferCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'transfer',
      description: 'Transfer Dih to another user.',
      category: 'Economy',
      usage: 'transfer <user> <amount>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: ['give', 'send'],
    });
  }

  async execute(message, args) {
    const fromUserId = message.author.id;
    const guildId = message.guild.id;

    // Check arguments
    if (args.length !== 2) {
      return message.reply(
        'Please provide a user and an amount to transfer. Usage: `transfer <user> <amount>`'
      );
    }

    // Get recipient
    const recipient = message.mentions.users.first();
    if (!recipient) {
      return message.reply('Please mention a user to transfer Dih to.');
    }

    if (recipient.id === fromUserId) {
      return message.reply('You cannot transfer Dih to yourself.');
    }

    if (recipient.bot) {
      return message.reply('You cannot transfer Dih to a bot.');
    }

    // Parse amount
    let amount;
    try {
      amount = parsePositiveAmount(args[1], 'Transfer amount');
    } catch {
      return message.reply('Please provide a valid amount to transfer.');
    }

    try {
      // Perform transfer
      const transaction = await economy.transferBalance(
        fromUserId,
        recipient.id,
        guildId,
        amount,
        'user-transfer'
      );
      if (transaction?.limited) {
        const resetAtUnix = Math.floor(Number(transaction.resetAt ?? Date.now()) / 1000);
        return message.reply(
          `You can only transfer **2 times per 24 hours**. Try again <t:${resetAtUnix}:R>.`
        );
      }

      // Create embed
      const embed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.SUCCESS)
        .setTitle('Transfer Successful')
        .setDescription(
          `You have successfully transferred ${formatMoney(amount)} cm Dih to ${recipient.username}.`
        )
        .addFields(
          {
            name: 'Your New Balance',
            value: `${formatMoney(transaction.from.newBalance)} cm`,
            inline: true,
          },
          {
            name: `${recipient.username}'s New Balance`,
            value: `${formatMoney(transaction.to.newBalance)} cm`,
            inline: true,
          }
        )
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (error) {
      logger.discord.cmdError('Transfer error:', error);
      if (error.message.startsWith('Insufficient balance')) {
        const balance = await economy.getBalance(fromUserId, guildId);
        return message.reply(`You don't have enough Dih! Your balance: ${formatMoney(balance)} cm`);
      }
      if (
        error.message.includes('Transfers are disabled while you have an active loan') ||
        error.message.includes('your loan is delinquent')
      ) {
        return message.reply(
          'You cannot transfer while you have an active loan or delinquent debt. Repay it first with `loan pay`.'
        );
      }
      if (
        error.message.includes(
          'Transfers to this user are disabled while they have an active loan'
        ) ||
        error.message.includes('Transfers to this user are disabled while their loan is delinquent')
      ) {
        return message.reply(
          'You cannot transfer to that user while they have an active loan or delinquent debt.'
        );
      }
      return message.reply('An error occurred during the transfer. Please try again later.');
    }
  }
}

export default TransferCommand;
