/**
 * @fileoverview gokys command with extremely low success odds.
 * @module commands/gokys
 */

import { randomInt } from 'node:crypto';
import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import jsonbService from '../services/jsonbService.js';
import { formatMoney } from '../utils/moneyUtils.js';

function rollOneIn(chanceOneIn) {
  const parsed = Math.max(2, Math.floor(Number(chanceOneIn) || 1000000));
  return randomInt(parsed) === 0;
}

function pickRandom(values, fallback = '') {
  if (!Array.isArray(values) || values.length === 0) return fallback;
  return values[randomInt(values.length)];
}

function computePercentLoss(balance, percent) {
  if (balance <= 0n) return 0n;
  const loss = (balance * BigInt(percent)) / 100n;
  return loss > 0n ? loss : 1n;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatRemaining(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

async function playGokysAnimation(message, siteText, actionText, finalEmbed) {
  const stageEmbed = new EmbedBuilder()
    .setColor(CONFIG.COLORS.DEFAULT)
    .setTitle('☠️ gokys')
    .setDescription(siteText)
    .setTimestamp();

  const animatedMessage = await message.reply({ embeds: [stageEmbed] });
  await sleep(850);

  stageEmbed.setDescription(`${siteText}\n${actionText}`);
  await animatedMessage.edit({ embeds: [stageEmbed] });
  await sleep(950);

  await animatedMessage.edit({ embeds: [finalEmbed] });
}

class GoKysCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'gokys',
      description: 'Say go kys to someone',
      category: 'Economy',
      usage: 'gokys <@user>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: [],
      exclusiveSession: true,
    });
  }

  async execute(message, args) {
    const userId = message.author.id;
    const guildId = message.guild.id;
    const cfg = CONFIG.COMMANDS.GOKYS;

    if (args.length !== 1) {
      return message.reply('Please mention exactly one user. Usage: `gokys <@user>`');
    }

    const target = message.mentions.users.first();
    if (!target) {
      return message.reply('Please mention a valid user. Usage: `gokys <@user>`');
    }

    if (target.bot) {
      return message.reply('You cannot target a bot with this command.');
    }

    if (target.id === userId) {
      return message.reply('You cannot target yourself.');
    }

    await economy.getUserData(userId, guildId);
    const userWallet = await economy.getBalance(userId, guildId);
    if (userWallet <= 0n) {
      return message.reply('You need money in your wallet to use this command.');
    }

    const now = Date.now();
    const actionCooldownMs = (cfg.ACTION_COOLDOWN_SECONDS ?? 600) * 1000;
    let cooldownLock = await jsonbService.acquireTimedKey(
      userId,
      guildId,
      cfg.COOLDOWN_KEY,
      now + actionCooldownMs,
      now
    );

    if (!cooldownLock.acquired && Number(cooldownLock.value ?? 0n) <= 0) {
      await jsonbService.setKey(userId, guildId, cfg.COOLDOWN_KEY, 0);
      cooldownLock = await jsonbService.acquireTimedKey(
        userId,
        guildId,
        cfg.COOLDOWN_KEY,
        now + actionCooldownMs,
        now
      );
    }

    if (!cooldownLock.acquired && Number(cooldownLock.value ?? 0n) > now) {
      const remainingMs = Number(cooldownLock.value) - now;
      const availableAt = Math.floor((now + remainingMs) / 1000);
      const cooldownEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.ERROR)
        .setTitle('⏰ gokys Cooldown Active')
        .setDescription(
          `You can use this command again <t:${availableAt}:R> (${formatRemaining(remainingMs)}).`
        )
        .setTimestamp();
      return message.reply({ embeds: [cooldownEmbed] });
    }

    const successOneIn = Math.max(2, Math.floor(Number(cfg.SUCCESS_ONE_IN ?? 1000000)));
    const minLoss = Math.max(1, Math.floor(Number(cfg.DEATH_LOSS_MIN_PERCENT ?? 25)));
    const maxLoss = Math.max(minLoss, Math.floor(Number(cfg.DEATH_LOSS_MAX_PERCENT ?? 75)));

    const success = rollOneIn(successOneIn);
    const victimId = success ? target.id : userId;
    const victimMention = success ? `<@${target.id}>` : `${message.author}`;
    const siteText = pickRandom(cfg.SITES, 'You challenge fate in public chat.');
    const actionText = pickRandom(cfg.ACTIONS, 'You run the command and wait for consequences...');

    const victimBalance = await economy.getBalance(victimId, guildId);
    const percentLoss = randomInt(minLoss, maxLoss + 1);
    const moneyLost = computePercentLoss(victimBalance, percentLoss);

    let newWallet = victimBalance;
    if (moneyLost > 0n) {
      const result = await economy.updateBalance(victimId, guildId, -moneyLost, 'gokys-death-loss');
      newWallet = result.balance;
    }

    const outcomeEmbed = new EmbedBuilder()
      .setColor(success ? CONFIG.COLORS.SUCCESS : CONFIG.COLORS.ERROR)
      .setTitle(success ? '☠️ Target Down' : '☠️ Backfired')
      .setDescription(
        success
          ? pickRandom(
              cfg.SUCCESS_MESSAGES,
              `Against impossible odds, **${target.username}** died.`
            )
          : pickRandom(
              cfg.FAIL_MESSAGES,
              `It backfired instantly. **${message.author.username}** died instead.`
            )
      )
      .addFields(
        { name: 'Who Died', value: `${victimMention}`, inline: true },
        { name: 'Wallet Lost', value: `${formatMoney(moneyLost)} cm`, inline: true },
        { name: 'Wallet Left', value: `${formatMoney(newWallet)} cm`, inline: true },
        {
          name: 'Death Loss',
          value: `${percentLoss}% of wallet`,
          inline: true,
        },
        {
          name: 'Success Chance',
          value: `1 in ${successOneIn.toLocaleString()}`,
          inline: true,
        }
      )
      .setTimestamp();

    try {
      await playGokysAnimation(message, siteText, actionText, outcomeEmbed);
    } catch {
      await message.reply({ embeds: [outcomeEmbed] });
    }

    return;
  }
}

export default GoKysCommand;
