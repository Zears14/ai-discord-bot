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
      description: 'Transfer Dih to another user and upgrade transfer limits.',
      category: 'Economy',
      usage: 'transfer <user> <amount> | transfer status | transfer buy <uses|cap>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: ['give', 'send'],
    });
  }

  async execute(message, args) {
    const fromUserId = message.author.id;
    const guildId = message.guild.id;

    if (args.length === 0) {
      return this.showTransferStatus(message, fromUserId, guildId);
    }

    const subcommand = args[0].toLowerCase();
    if (
      subcommand === 'status' ||
      subcommand === 'limits' ||
      subcommand === 'limit' ||
      subcommand === 'info'
    ) {
      return this.showTransferStatus(message, fromUserId, guildId);
    }

    if (subcommand === 'buy') {
      return this.buyTransferUpgrade(message, fromUserId, guildId, args[1]);
    }

    if (args.length !== 2) {
      return message.reply(
        'Usage: `transfer <user> <amount>`, `transfer status`, or `transfer buy <uses|cap>`'
      );
    }

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
          `You can only transfer **${transaction.limit} times per 24 hours**. Try again <t:${resetAtUnix}:R>.`
        );
      }
      if (transaction?.levelBlocked) {
        return message.reply(
          `Transfer unlocks at **Level ${transaction.requiredLevel}**. Your level: **${transaction.currentLevel}**.`
        );
      }
      if (transaction?.maxExceeded) {
        return message.reply(
          `That transfer is above your current per-transfer cap of **${formatMoney(transaction.maxAllowed)} cm**.`
        );
      }
      if (transaction?.reciprocalLocked) {
        const untilUnix = Math.floor(Number(transaction.until ?? Date.now()) / 1000);
        return message.reply(
          `Reciprocal transfer lock is active for this user pair. You can send again <t:${untilUnix}:R>.`
        );
      }

      const usageText = transaction.transferMeta
        ? `${transaction.transferMeta.usedToday}/${transaction.transferMeta.dailyLimit}`
        : 'N/A';
      const capText = transaction.transferMeta
        ? `${formatMoney(transaction.transferMeta.maxPerTransfer)} cm`
        : 'N/A';

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
          },
          {
            name: 'Transfers Today',
            value: usageText,
            inline: true,
          },
          {
            name: 'Per-Transfer Cap',
            value: capText,
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

  async showTransferStatus(message, userId, guildId) {
    const policy = await economy.getTransferPolicy(userId, guildId);
    const resetAtUnix = Math.floor(Number(policy.resetAt ?? Date.now()) / 1000);
    const levelText = policy.canTransfer
      ? `✅ Enabled (Level ${policy.level})`
      : `❌ Locked (Level ${policy.level}/${policy.requiredLevel})`;

    const embed = new EmbedBuilder()
      .setColor(CONFIG.COLORS.DEFAULT)
      .setTitle('Transfer Limits')
      .addFields(
        { name: 'Status', value: levelText, inline: true },
        {
          name: 'Daily Uses',
          value: `${policy.usedToday}/${policy.dailyLimit} (resets <t:${resetAtUnix}:R>)`,
          inline: true,
        },
        {
          name: 'Per-Transfer Cap',
          value: `${formatMoney(policy.maxPerTransfer)} cm`,
          inline: true,
        },
        {
          name: 'Upgrade Uses',
          value: `+1/day for ${formatMoney(policy.nextUseUpgradeCost)} cm`,
          inline: true,
        },
        {
          name: 'Upgrade Cap',
          value: `+${formatMoney(policy.capUpgradeStep)} cm for ${formatMoney(policy.nextCapUpgradeCost)} cm`,
          inline: true,
        }
      )
      .setFooter({ text: 'Use: transfer buy uses | transfer buy cap' })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  async buyTransferUpgrade(message, userId, guildId, rawType) {
    const type = (rawType || '').toLowerCase();
    if (type !== 'uses' && type !== 'cap') {
      return message.reply('Usage: `transfer buy <uses|cap>`');
    }

    try {
      const result = await economy.purchaseTransferUpgrade(userId, guildId, type);
      const description =
        type === 'uses'
          ? `You now have **${result.dailyLimit}** transfers every 24h.`
          : `Your per-transfer cap is now **${formatMoney(result.maxPerTransfer)} cm**.`;

      const embed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.SUCCESS)
        .setTitle('Transfer Upgrade Purchased')
        .setDescription(description)
        .addFields(
          { name: 'Cost', value: `${formatMoney(result.cost)} cm`, inline: true },
          { name: 'Wallet', value: `${formatMoney(result.walletBalance)} cm`, inline: true },
          {
            name: 'Next Uses Upgrade',
            value: `${formatMoney(result.nextUseUpgradeCost)} cm`,
            inline: true,
          },
          {
            name: 'Next Cap Upgrade',
            value: `${formatMoney(result.nextCapUpgradeCost)} cm`,
            inline: true,
          }
        )
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (error) {
      logger.discord.cmdError('Transfer upgrade error:', error);
      if (error.message.startsWith('Insufficient balance')) {
        const balance = await economy.getBalance(userId, guildId);
        return message.reply(
          `You don't have enough Dih for this upgrade. Your balance: ${formatMoney(balance)} cm`
        );
      }
      return message.reply(error.message || 'Failed to buy transfer upgrade.');
    }
  }
}

export default TransferCommand;
