/**
 * @fileoverview Rob command for stealing currency from another user
 * @module commands/rob
 */

import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import jsonbService from '../services/jsonbService.js';
import logger from '../services/loggerService.js';
import {
  bigintAbs,
  floorPercentOf,
  formatMoney,
  toBigInt,
  toNumberClamped,
} from '../utils/moneyUtils.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function weightedPick(tiers) {
  const totalWeight = tiers.reduce((sum, tier) => sum + tier.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const tier of tiers) {
    roll -= tier.weight;
    if (roll <= 0) return tier;
  }

  return tiers[tiers.length - 1];
}

function pickWeightedPercent(tiers) {
  const tier = weightedPick(tiers);
  if (tier.min === tier.max) return tier.min;
  return tier.min + Math.random() * (tier.max - tier.min);
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatRemainingTime(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

async function notifyVictim(victim, robberName, guildName, amountDelta) {
  const parsedAmountDelta = toBigInt(amountDelta, 'Robbery delta');
  const verb = parsedAmountDelta < 0n ? 'lost' : 'gained';
  const amount = bigintAbs(parsedAmountDelta);
  const directionEmoji = parsedAmountDelta < 0n ? '💸' : '💰';

  const embed = new EmbedBuilder()
    .setColor(
      parsedAmountDelta < 0n ? CONFIG.COMMANDS.ROB.COLORS.FAIL : CONFIG.COMMANDS.ROB.COLORS.SUCCESS
    )
    .setTitle('Robbery Update')
    .setDescription(
      `${directionEmoji} You were involved in a robbery with **${robberName}** in **${guildName}**.\nYou **${verb} ${formatMoney(amount)} cm** Dih.`
    )
    .setTimestamp();

  await victim.send({ embeds: [embed] });
}

class RobCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'rob',
      description: 'Attempt to rob another user.',
      category: 'Economy',
      usage: 'rob <@user>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: ['steal', 'mug'],
    });
  }

  async execute(message, args) {
    const robberId = message.author.id;
    const guildId = message.guild.id;

    if (args.length !== 1) {
      return message.reply('Please mention exactly one user. Usage: `rob <@user>`');
    }

    const victim = message.mentions.users.first();
    if (!victim) {
      return message.reply('Please mention a valid user to rob.');
    }

    if (victim.id === robberId) {
      return message.reply('You cannot rob yourself.');
    }

    if (victim.bot) {
      return message.reply('You cannot rob a bot.');
    }

    try {
      const [robberBalance, victimBalance] = await Promise.all([
        economy.getBalance(robberId, guildId),
        economy.getBalance(victim.id, guildId),
      ]);
      const minBalanceToRob = toBigInt(CONFIG.COMMANDS.ROB.MIN_BALANCE_TO_ROB);

      if (robberBalance < minBalanceToRob) {
        return message.reply(
          `You need at least ${formatMoney(minBalanceToRob)} cm Dih to attempt a robbery.`
        );
      }

      if (victimBalance <= 0n) {
        return message.reply(`${victim.username} has no wallet Dih to steal.`);
      }

      const now = BigInt(Date.now());
      const protectionUntilTimestamp = now + BigInt(CONFIG.COMMANDS.ROB.PROTECTION_MS);
      const protectionLock = await jsonbService.acquireTimedKey(
        victim.id,
        guildId,
        CONFIG.COMMANDS.ROB.PROTECTION_KEY,
        protectionUntilTimestamp,
        now
      );
      if (!protectionLock.acquired && protectionLock.value > now) {
        const remaining = Number(protectionLock.value - now);
        const embed = new EmbedBuilder()
          .setColor(CONFIG.COMMANDS.ROB.COLORS.INFO)
          .setTitle('🛡️ Target Protected')
          .setDescription(
            `${victim.username} was recently robbed and is protected for ${formatRemainingTime(remaining)}.`
          )
          .setTimestamp();

        return message.reply({ embeds: [embed] });
      }

      const balanceDifference = bigintAbs(robberBalance - victimBalance);
      const maxBalance = robberBalance > victimBalance ? robberBalance : victimBalance;
      const relativeDifference =
        maxBalance === 0n
          ? 0
          : toNumberClamped(balanceDifference) / Math.max(toNumberClamped(maxBalance), 1);
      const successChance = clamp(
        CONFIG.COMMANDS.ROB.CHANCE.BASE - relativeDifference * CONFIG.COMMANDS.ROB.CHANCE.DECAY,
        CONFIG.COMMANDS.ROB.CHANCE.MIN,
        CONFIG.COMMANDS.ROB.CHANCE.BASE
      );

      const success = Math.random() < successChance;

      if (success) {
        const stealPercent = pickWeightedPercent(CONFIG.COMMANDS.ROB.STEAL_PERCENT_TIERS);
        const computedStolen = floorPercentOf(victimBalance, stealPercent);
        const stolenAmount =
          computedStolen < 1n
            ? 1n
            : computedStolen > victimBalance
              ? victimBalance
              : computedStolen;

        const transfer = await economy.transferBalance(
          victim.id,
          robberId,
          guildId,
          stolenAmount,
          'rob-success'
        );

        await notifyVictim(
          victim,
          message.author.username,
          message.guild.name,
          -stolenAmount
        ).catch(() => {});

        const embed = new EmbedBuilder()
          .setColor(CONFIG.COMMANDS.ROB.COLORS.SUCCESS)
          .setTitle('🦹 Robbery Success')
          .setDescription(
            `You robbed ${victim.username} and stole **${formatMoney(stolenAmount)} cm** Dih.`
          )
          .addFields(
            { name: 'Success Chance', value: formatPercent(successChance), inline: true },
            { name: 'Stolen %', value: formatPercent(stealPercent), inline: true },
            {
              name: 'Your New Wallet',
              value: `${formatMoney(transfer.to.newBalance)} cm`,
              inline: true,
            },
            {
              name: `${victim.username}'s Wallet`,
              value: `${formatMoney(transfer.from.newBalance)} cm`,
              inline: true,
            },
            { name: 'Target Protection', value: `${victim.username} cannot be robbed for 1 hour.` }
          )
          .setTimestamp();

        return message.reply({ embeds: [embed] });
      }

      const finePercent = pickWeightedPercent(CONFIG.COMMANDS.ROB.FAIL_FINE_PERCENT_TIERS);
      const computedFine = floorPercentOf(robberBalance, finePercent);
      const fineAmount =
        computedFine < 1n ? 1n : computedFine > robberBalance ? robberBalance : computedFine;

      const transfer = await economy.transferBalance(
        robberId,
        victim.id,
        guildId,
        fineAmount,
        'rob-fail'
      );

      await notifyVictim(victim, message.author.username, message.guild.name, fineAmount).catch(
        () => {}
      );

      const embed = new EmbedBuilder()
        .setColor(CONFIG.COMMANDS.ROB.COLORS.FAIL)
        .setTitle('🚨 Robbery Failed')
        .setDescription(
          `You were caught. You paid **${formatMoney(fineAmount)} cm** Dih to ${victim.username}.`
        )
        .addFields(
          { name: 'Success Chance', value: formatPercent(successChance), inline: true },
          { name: 'Fine %', value: formatPercent(finePercent), inline: true },
          {
            name: 'Your New Wallet',
            value: `${formatMoney(transfer.from.newBalance)} cm`,
            inline: true,
          },
          {
            name: `${victim.username}'s Wallet`,
            value: `${formatMoney(transfer.to.newBalance)} cm`,
            inline: true,
          }
        )
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (error) {
      logger.discord.cmdError('Rob command error:', error);
      return message.reply('Robbery failed due to an error. Please try again later.');
    }
  }
}

export default RobCommand;
