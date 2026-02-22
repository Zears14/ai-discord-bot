/**
 * @fileoverview Loan command for taking and repaying timed loans.
 * @module commands/loan
 */

import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import logger from '../services/loggerService.js';
import { formatMoney, parsePositiveAmount } from '../utils/moneyUtils.js';

function formatInterest(interestBps) {
  return `${(Number(interestBps) / 100).toFixed(2)}%`;
}

function formatDateRelative(timestampMs) {
  if (!timestampMs || timestampMs <= 0) return 'N/A';
  return `<t:${Math.floor(timestampMs / 1000)}:R>`;
}

function findLoanOption(options, token) {
  const normalized = token.trim().toLowerCase();
  const byId = options.find((option) => option.id === normalized);
  if (byId) return byId;

  if (/^\d+$/.test(normalized)) {
    const amount = BigInt(normalized);
    return options.find((option) => option.amount === amount) || null;
  }

  return null;
}

class LoanCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'loan',
      description: 'Take and repay timed loans',
      category: 'Economy',
      usage: 'loan | loan take <option_id|amount> | loan pay <amount|all>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: ['debt'],
    });
  }

  async execute(message, args) {
    const userId = message.author.id;
    const guildId = message.guild.id;
    const subcommand = (args[0] || '').toLowerCase();

    if (!subcommand || subcommand === 'status' || subcommand === 'options') {
      return this.showLoanStatus(message, userId, guildId);
    }

    if (subcommand === 'take') {
      return this.takeLoan(message, userId, guildId, args.slice(1));
    }

    if (subcommand === 'pay') {
      return this.payLoan(message, userId, guildId, args.slice(1));
    }

    return message.reply('Usage: `loan`, `loan take <option_id|amount>`, `loan pay <amount|all>`');
  }

  async showLoanStatus(message, userId, guildId) {
    const [loanState, options] = await Promise.all([
      economy.getLoanState(userId, guildId),
      economy.getLoanOptions(),
    ]);

    const optionsText = options
      .map(
        (option) =>
          `• \`${option.id}\` — ${formatMoney(option.amount)} cm for ${option.durationDays}d (${formatInterest(option.interestBps)} interest)`
      )
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(CONFIG.COLORS.DEFAULT)
      .setTitle('🏦 Loan Desk')
      .setDescription(
        loanState.hasLoan
          ? loanState.loan.status === 'delinquent'
            ? 'Your debt is delinquent. Earnings are auto-collected toward debt.'
            : 'You currently have an active loan.'
          : 'No active loan. You can take one option at a time.'
      )
      .addFields(
        {
          name: 'Current Loan',
          value: loanState.hasLoan
            ? [
                `Status: **${loanState.loan.status.toUpperCase()}**`,
                `Debt Remaining: **${formatMoney(loanState.loan.debt)} cm**`,
                loanState.loan.status === 'active'
                  ? `Due: ${formatDateRelative(loanState.loan.dueAt)}`
                  : 'Debt Lock: Transfers disabled until debt is cleared',
              ].join('\n')
            : 'None',
          inline: false,
        },
        {
          name: 'Your Funds',
          value: [
            `Wallet: ${formatMoney(loanState.walletBalance)} cm`,
            `Bank: ${formatMoney(loanState.bankBalance)} cm`,
            `Total: ${formatMoney(loanState.totalBalance)} cm`,
          ].join('\n'),
          inline: true,
        },
        {
          name: 'Loan Options',
          value: optionsText || 'No options configured.',
          inline: false,
        }
      )
      .setFooter({ text: 'Use: loan take <id> | loan pay <amount|all>' })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  async takeLoan(message, userId, guildId, args) {
    if (args.length !== 1) {
      return message.reply('Usage: `loan take <option_id|amount>`');
    }

    const options = await economy.getLoanOptions();
    const option = findLoanOption(options, args[0]);
    if (!option) {
      return message.reply('Invalid loan option. Use `loan` to see valid option IDs and amounts.');
    }

    try {
      const result = await economy.takeLoan(userId, guildId, option.id);
      const embed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.SUCCESS)
        .setTitle('✅ Loan Approved')
        .setDescription(
          `You received **${formatMoney(option.amount)} cm**.\nRepayment due: **${formatMoney(result.loan.debt)} cm**`
        )
        .addFields(
          { name: 'Due', value: formatDateRelative(result.loan.dueAt), inline: true },
          { name: 'Interest', value: formatInterest(option.interestBps), inline: true },
          { name: 'Wallet', value: `${formatMoney(result.walletBalance)} cm`, inline: true }
        )
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (error) {
      logger.discord.cmdError('Loan take error:', error);
      return message.reply(error.message || 'Failed to take loan.');
    }
  }

  async payLoan(message, userId, guildId, args) {
    if (args.length !== 1) {
      return message.reply('Usage: `loan pay <amount|all>`');
    }

    const token = args[0].toLowerCase();
    let amount = null;
    if (token !== 'all' && token !== 'max') {
      try {
        amount = parsePositiveAmount(args[0], 'Payment amount');
      } catch {
        return message.reply('Please provide a valid payment amount (or `all`).');
      }
    }

    try {
      const result = await economy.payLoan(userId, guildId, amount);
      const embed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.SUCCESS)
        .setTitle('💳 Loan Payment Processed')
        .setDescription(`Paid **${formatMoney(result.paid)} cm** toward your debt.`)
        .addFields(
          {
            name: 'Debt Remaining',
            value: result.hasLoan ? `${formatMoney(result.loan.debt)} cm` : 'Paid off ✅',
            inline: true,
          },
          { name: 'Wallet', value: `${formatMoney(result.walletBalance)} cm`, inline: true },
          { name: 'Bank', value: `${formatMoney(result.bankBalance)} cm`, inline: true }
        )
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (error) {
      logger.discord.cmdError('Loan pay error:', error);
      return message.reply(error.message || 'Failed to pay loan.');
    }
  }
}

export default LoanCommand;
