/**
 * @fileoverview Dig command with risk/reward and tool durability.
 * @module commands/dig
 */

import { randomInt } from 'node:crypto';
import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import inventoryService from '../services/inventoryService.js';
import itemsService from '../services/itemsService.js';
import jsonbService from '../services/jsonbService.js';
import levelService from '../services/levelService.js';
import logger from '../services/loggerService.js';
import { computeScaledAdventureReward } from '../utils/adventureRewardScaling.js';
import { formatMoney } from '../utils/moneyUtils.js';

function rollChanceBps(chanceBps) {
  return randomInt(1, 10001) <= chanceBps;
}

function pickRandom(values) {
  return values[randomInt(values.length)];
}

function computePercentLoss(balance, percent) {
  if (balance <= 0n) return 0n;
  return (balance * BigInt(percent)) / 100n;
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

async function playAdventureAnimation(message, title, siteText, actionText, finalEmbed) {
  const stageEmbed = new EmbedBuilder()
    .setColor(CONFIG.COLORS.DEFAULT)
    .setTitle(title)
    .setDescription(`${siteText}`)
    .setTimestamp();

  const animatedMessage = await message.reply({ embeds: [stageEmbed] });
  await sleep(850);

  stageEmbed.setDescription(`${siteText}\n${actionText}`);
  await animatedMessage.edit({ embeds: [stageEmbed] });
  await sleep(950);

  await animatedMessage.edit({ embeds: [finalEmbed] });
}

class DigCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'dig',
      description: 'Dig for valuables (requires shovel)',
      category: 'Economy',
      usage: 'dig',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: ['excavate'],
    });
  }

  async execute(message, args) {
    if (args.length > 0) {
      await message.reply('Usage: `dig`');
      return { skipCooldown: true };
    }

    const userId = message.author.id;
    const guildId = message.guild.id;
    const cfg = CONFIG.COMMANDS.DIG;

    try {
      const toolItem = await itemsService.getItemByName(cfg.TOOL_ITEM_NAME);
      if (!toolItem) {
        return message.reply('Shovel item is missing. Ask an admin to reload items.');
      }

      const hasTool = await inventoryService.hasItem(userId, guildId, toolItem.id, 1);
      if (!hasTool) {
        return message.reply('You need a **Shovel** to dig. Buy one from `shop`.');
      }

      const currentWallet = await economy.getBalance(userId, guildId);
      if (currentWallet <= 0n) {
        return message.reply('You need money in your wallet to dig.');
      }

      // Separate action cooldown (independent from command cooldown)
      await economy.getUserData(userId, guildId);
      const now = Date.now();
      const cooldownMs = (cfg.ACTION_COOLDOWN_SECONDS ?? 300) * 1000;
      let cooldownLock = await jsonbService.acquireTimedKey(
        userId,
        guildId,
        cfg.COOLDOWN_KEY,
        now + cooldownMs,
        now
      );

      if (!cooldownLock.acquired && Number(cooldownLock.value ?? 0n) <= 0) {
        await jsonbService.setKey(userId, guildId, cfg.COOLDOWN_KEY, 0);
        cooldownLock = await jsonbService.acquireTimedKey(
          userId,
          guildId,
          cfg.COOLDOWN_KEY,
          now + cooldownMs,
          now
        );
      }

      if (!cooldownLock.acquired && Number(cooldownLock.value ?? 0n) > now) {
        const remainingMs = Number(cooldownLock.value) - now;
        const availableAt = Math.floor((now + remainingMs) / 1000);
        const cooldownEmbed = new EmbedBuilder()
          .setColor(CONFIG.COLORS.ERROR)
          .setTitle('⏰ Dig Cooldown Active')
          .setDescription(
            `You can dig again <t:${availableAt}:R> (${formatRemaining(remainingMs)}).`
          )
          .setTimestamp();
        return message.reply({ embeds: [cooldownEmbed] });
      }

      const [bankData, levelData] = await Promise.all([
        economy.getBankData(userId, guildId),
        levelService.getLevelData(userId, guildId),
      ]);
      const walletBalance = await economy.getBalance(userId, guildId);

      const siteText = pickRandom(cfg.SITES);
      const actionText = pickRandom(cfg.ACTIONS);
      const death = rollChanceBps(cfg.DEATH_CHANCE_BPS);
      const brokeTool = rollChanceBps(cfg.BREAK_CHANCE_BPS);

      if (brokeTool) {
        try {
          await inventoryService.removeItemFromInventory(userId, guildId, toolItem.id, 1);
        } catch (error) {
          logger.discord.cmdError('Failed to remove broken shovel:', {
            userId,
            guildId,
            error,
          });
        }
      }

      if (death) {
        const percentLoss = randomInt(cfg.DEATH_LOSS_MIN_PERCENT, cfg.DEATH_LOSS_MAX_PERCENT + 1);
        const moneyLost = computePercentLoss(walletBalance, percentLoss);

        if (moneyLost > 0n) {
          await economy.updateBalance(userId, guildId, -moneyLost, 'dig-death-loss');
        }

        const walletAfter = walletBalance - moneyLost;
        const embed = new EmbedBuilder()
          .setColor(CONFIG.COLORS.ERROR)
          .setTitle('☠️ Digging Disaster')
          .setDescription(
            `${pickRandom(cfg.DEATH_MESSAGES)} You died and lost **${percentLoss}%** of your wallet.`
          )
          .addFields(
            { name: 'Wallet Lost', value: `${formatMoney(moneyLost)} cm`, inline: true },
            { name: 'Wallet Left', value: `${formatMoney(walletAfter)} cm`, inline: true },
            {
              name: 'Shovel Status',
              value: brokeTool ? `💥 ${pickRandom(cfg.BREAK_MESSAGES)}` : '✅ Shovel survived',
              inline: false,
            }
          )
          .setTimestamp();

        try {
          await playAdventureAnimation(message, '⛏️ Dig', siteText, actionText, embed);
        } catch {
          await message.reply({ embeds: [embed] });
        }
        return;
      }

      const baseReward = brokeTool ? 0n : BigInt(randomInt(cfg.REWARD_MIN, cfg.REWARD_MAX + 1));
      let finalReward = 0n;

      if (!brokeTool) {
        const scaled = computeScaledAdventureReward(
          baseReward,
          bankData.totalBalance,
          levelData.level,
          cfg.SCALING
        );
        finalReward = scaled.reward;
      }

      if (finalReward > 0n) {
        await economy.updateBalance(userId, guildId, finalReward, 'dig-reward');
      }

      const newWallet = await economy.getBalance(userId, guildId);
      const resultText = brokeTool
        ? 'Your shovel broke before you found anything valuable.'
        : pickRandom(cfg.FIND_MESSAGES);

      const embed = new EmbedBuilder()
        .setColor(brokeTool ? CONFIG.COLORS.DEFAULT : CONFIG.COLORS.SUCCESS)
        .setTitle('⛏️ Dig Result')
        .setDescription(resultText)
        .addFields(
          {
            name: 'Reward',
            value: `${finalReward > 0n ? '+' : ''}${formatMoney(finalReward)} cm`,
            inline: true,
          },
          { name: 'New Wallet', value: `${formatMoney(newWallet)} cm`, inline: true },
          {
            name: 'Shovel Status',
            value: brokeTool ? `💥 ${pickRandom(cfg.BREAK_MESSAGES)}` : '✅ Shovel held up',
            inline: false,
          }
        )
        .setTimestamp();

      try {
        await playAdventureAnimation(message, '⛏️ Dig', siteText, actionText, embed);
      } catch {
        await message.reply({ embeds: [embed] });
      }
      return;
    } catch (error) {
      logger.discord.cmdError('Dig command error:', error);
      return message.reply('Dig failed due to an error. Please try again later.');
    }
  }
}

export default DigCommand;
