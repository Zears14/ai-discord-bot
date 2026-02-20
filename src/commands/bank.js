/**
 * @fileoverview Bank command for wallet/bank transfers and overview.
 * @module commands/bank
 */

import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import { formatMoney, parsePositiveAmount } from '../utils/moneyUtils.js';

function normalizeAmountToken(raw) {
  return raw ? raw.toLowerCase() : '';
}

class BankCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'bank',
      description: 'Store money safely from robbing.',
      category: 'Economy',
      usage: 'bank | bank deposit <amount|all> | bank withdraw <amount|all>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: ['safe', 'vault'],
    });
  }

  async execute(message, args) {
    const userId = message.author.id;
    const guildId = message.guild.id;

    if (args.length === 0) {
      return this.showOverview(message, userId, guildId);
    }

    const action = args[0].toLowerCase();
    if (action === 'deposit' || action === 'dep' || action === 'd') {
      return this.handleDeposit(message, userId, guildId, args[1]);
    }

    if (action === 'withdraw' || action === 'with' || action === 'w') {
      return this.handleWithdraw(message, userId, guildId, args[1]);
    }

    return message.reply(
      'Usage: `bank`, `bank deposit <amount|all>`, or `bank withdraw <amount|all>`'
    );
  }

  async showOverview(message, userId, guildId) {
    const bankData = await economy.getBankData(userId, guildId);
    const embed = new EmbedBuilder()
      .setColor(CONFIG.COLORS.DEFAULT)
      .setTitle('🏦 Bank')
      .setDescription('Money in bank is protected from `rob`.')
      .addFields(
        { name: 'Wallet', value: `${formatMoney(bankData.walletBalance)} cm`, inline: true },
        {
          name: 'Bank',
          value: `${formatMoney(bankData.bankBalance)} / ${formatMoney(bankData.bankMax)} cm`,
          inline: true,
        },
        { name: 'Bank Space', value: `${formatMoney(bankData.availableSpace)} cm`, inline: true },
        { name: 'Total Worth', value: `${formatMoney(bankData.totalBalance)} cm`, inline: true }
      )
      .setFooter({ text: 'Use bank_note items to increase max bank storage.' })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  async handleDeposit(message, userId, guildId, rawAmount) {
    if (!rawAmount) {
      return message.reply('Usage: `bank deposit <amount|all>`');
    }

    let amount;
    const token = normalizeAmountToken(rawAmount);
    if (token === 'all' || token === 'max') {
      const bankData = await economy.getBankData(userId, guildId);
      amount =
        bankData.walletBalance < bankData.availableSpace
          ? bankData.walletBalance
          : bankData.availableSpace;
      if (amount <= 0n) {
        return message.reply('Nothing to deposit. Your wallet is empty or your bank is full.');
      }
    } else {
      try {
        amount = parsePositiveAmount(rawAmount, 'Deposit amount');
      } catch {
        return message.reply('Please provide a valid deposit amount.');
      }
    }

    try {
      const result = await economy.depositToBank(userId, guildId, amount);
      const embed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.SUCCESS)
        .setTitle('✅ Deposit Successful')
        .setDescription(`Moved ${formatMoney(result.movedAmount)} cm from wallet to bank.`)
        .addFields(
          { name: 'Wallet', value: `${formatMoney(result.walletBalance)} cm`, inline: true },
          {
            name: 'Bank',
            value: `${formatMoney(result.bankBalance)} / ${formatMoney(result.bankMax)} cm`,
            inline: true,
          },
          { name: 'Bank Space', value: `${formatMoney(result.availableSpace)} cm`, inline: true }
        )
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (error) {
      return message.reply(error.message || 'Deposit failed.');
    }
  }

  async handleWithdraw(message, userId, guildId, rawAmount) {
    if (!rawAmount) {
      return message.reply('Usage: `bank withdraw <amount|all>`');
    }

    let amount;
    const token = normalizeAmountToken(rawAmount);
    if (token === 'all' || token === 'max') {
      const bankData = await economy.getBankData(userId, guildId);
      amount = bankData.bankBalance;
      if (amount <= 0n) {
        return message.reply('Nothing to withdraw. Your bank balance is empty.');
      }
    } else {
      try {
        amount = parsePositiveAmount(rawAmount, 'Withdraw amount');
      } catch {
        return message.reply('Please provide a valid withdraw amount.');
      }
    }

    try {
      const result = await economy.withdrawFromBank(userId, guildId, amount);
      const embed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.SUCCESS)
        .setTitle('✅ Withdrawal Successful')
        .setDescription(`Moved ${formatMoney(result.movedAmount)} cm from bank to wallet.`)
        .addFields(
          { name: 'Wallet', value: `${formatMoney(result.walletBalance)} cm`, inline: true },
          {
            name: 'Bank',
            value: `${formatMoney(result.bankBalance)} / ${formatMoney(result.bankMax)} cm`,
            inline: true,
          },
          { name: 'Bank Space', value: `${formatMoney(result.availableSpace)} cm`, inline: true }
        )
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (error) {
      return message.reply(error.message || 'Withdrawal failed.');
    }
  }
}

export default BankCommand;
