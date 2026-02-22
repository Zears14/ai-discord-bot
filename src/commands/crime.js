/**
 * @fileoverview Crime command with randomized 3-choice risk/reward actions.
 * @module commands/crime
 */

import { randomInt } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import jsonbService from '../services/jsonbService.js';
import levelService from '../services/levelService.js';
import logger from '../services/loggerService.js';
import { computeScaledAdventureReward } from '../utils/adventureRewardScaling.js';
import { formatMoney } from '../utils/moneyUtils.js';

function rollChanceBps(chanceBps) {
  return randomInt(1, 10001) <= chanceBps;
}

function randomUnit() {
  return randomInt(1_000_000) / 1_000_000;
}

function computePercentLoss(balance, percent) {
  if (balance <= 0n) return 0n;
  return (balance * BigInt(percent)) / 100n;
}

function toPercentText(chanceBps) {
  return `${(chanceBps / 100).toFixed(2)}%`;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeCrimeSeverity(crime) {
  const minReward = 25;
  const maxReward = 1600;
  const rewardSpan = maxReward - minReward;
  const rewardComponent = clampNumber(
    rewardSpan > 0 ? (Number(crime.rewardMax ?? minReward) - minReward) / rewardSpan : 0,
    0,
    1
  );
  const riskRaw =
    clampNumber(Number(crime.failChanceBps ?? 0), 0, 10000) +
    clampNumber(Number(crime.deathChanceBps ?? 0), 0, 10000);
  const riskComponent = clampNumber(riskRaw / 12000, 0, 1);
  return clampNumber(rewardComponent * 0.45 + riskComponent * 0.55, 0, 1);
}

function computeJailChanceBps(crime, cfg) {
  const severity = computeCrimeSeverity(crime);
  const minChance = Math.max(0, Math.floor(Number(cfg.JAIL_CHANCE_MIN_BPS ?? 300)));
  const maxChance = Math.max(minChance, Math.floor(Number(cfg.JAIL_CHANCE_MAX_BPS ?? 1800)));
  return minChance + Math.floor((maxChance - minChance) * severity);
}

function chooseJailDurationMinutes(crime, cfg) {
  const severity = computeCrimeSeverity(crime);
  const minMinutes = Math.max(1, Math.floor(Number(cfg.JAIL_MIN_MINUTES ?? 5)));
  const maxMinutes = Math.max(minMinutes, Math.floor(Number(cfg.JAIL_MAX_MINUTES ?? 15)));
  const weightMin = Math.max(1.01, Number(cfg.JAIL_WEIGHT_MIN ?? 1.1));
  const weightMax = Math.max(weightMin, Number(cfg.JAIL_WEIGHT_MAX ?? 3.8));
  const weight = weightMin + (weightMax - weightMin) * severity;
  const weightedRoll = Math.pow(randomUnit(), 1 / weight);
  const rangeSize = maxMinutes - minMinutes + 1;
  const picked = minMinutes + Math.floor(weightedRoll * rangeSize);
  return clampNumber(picked, minMinutes, maxMinutes);
}

function sampleCrimes(crimes, count) {
  const pool = [...crimes];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(Math.max(1, count), pool.length));
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

function buildChoiceEmbed(choices) {
  const lines = choices.map(
    (crime, index) =>
      `**${index + 1}. ${crime.emoji} ${crime.label}**\n` +
      `Reward: ${formatMoney(BigInt(crime.rewardMin))}-${formatMoney(BigInt(crime.rewardMax))} cm\n` +
      `Caught: ${toPercentText(crime.failChanceBps)} | Death: ${toPercentText(crime.deathChanceBps)}`
  );

  return new EmbedBuilder()
    .setColor(CONFIG.COLORS.DEFAULT)
    .setTitle('🚨 Choose Your Crime')
    .setDescription(
      `Pick **1** option below. You only get one attempt this round.\n\n${lines.join('\n\n')}`
    )
    .setFooter({ text: 'Select one button to commit that crime' })
    .setTimestamp();
}

function buildButtons(choices, nonce, disabled = false) {
  return new ActionRowBuilder().addComponents(
    ...choices.map((crime) =>
      new ButtonBuilder()
        .setCustomId(`crime:${nonce}:${crime.id}`)
        .setLabel(`${crime.emoji} ${crime.label}`.slice(0, 80))
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    )
  );
}

async function playCrimeAnimation(
  targetMessage,
  title,
  siteText,
  actionText,
  finalEmbed,
  components
) {
  const stageEmbed = new EmbedBuilder()
    .setColor(CONFIG.COLORS.DEFAULT)
    .setTitle(title)
    .setDescription(siteText)
    .setTimestamp();

  await targetMessage.edit({ embeds: [stageEmbed], components });
  await sleep(850);

  stageEmbed.setDescription(`${siteText}\n${actionText}`);
  await targetMessage.edit({ embeds: [stageEmbed], components });
  await sleep(950);

  await targetMessage.edit({ embeds: [finalEmbed], components: [] });
}

class CrimeCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'crime',
      description: 'Commit a risky crime for money',
      category: 'Economy',
      usage: 'crime',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: ['crimes'],
      exclusiveSession: true,
    });
  }

  async execute(message, args) {
    if (args.length > 0) {
      await message.reply('Usage: `crime`');
      return { skipCooldown: true };
    }

    const userId = message.author.id;
    const guildId = message.guild.id;
    const cfg = CONFIG.COMMANDS.CRIME;

    if (!cfg || !Array.isArray(cfg.CRIMES) || cfg.CRIMES.length < 3) {
      return message.reply('Crime config is missing or invalid. Ask an admin to fix it.');
    }

    try {
      await economy.getUserData(userId, guildId);
      const currentWallet = await economy.getBalance(userId, guildId);
      if (currentWallet <= 0n) {
        return message.reply('You need money in your wallet to commit a crime.');
      }

      const now = Date.now();
      const actionCooldownMs = (cfg.ACTION_COOLDOWN_SECONDS ?? 420) * 1000;
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
          .setTitle('⏰ Crime Cooldown Active')
          .setDescription(
            `You can commit another crime <t:${availableAt}:R> (${formatRemaining(remainingMs)}).`
          )
          .setTimestamp();
        return message.reply({ embeds: [cooldownEmbed] });
      }

      const choiceCount = Math.min(Math.max(1, cfg.CHOICES_PER_RUN ?? 3), 3);
      const selectedCrimes = sampleCrimes(cfg.CRIMES, choiceCount);
      const crimeById = new Map(selectedCrimes.map((crime) => [crime.id, crime]));
      const nonce = randomInt(1_000_000, 9_999_999).toString(36);

      const choiceEmbed = buildChoiceEmbed(selectedCrimes);
      const activeButtons = buildButtons(selectedCrimes, nonce, false);
      const disabledButtons = buildButtons(selectedCrimes, nonce, true);

      const gameMessage = await message.reply({
        embeds: [choiceEmbed],
        components: [activeButtons],
      });

      const collector = gameMessage.createMessageComponentCollector({
        filter: (interaction) => interaction.user.id === userId,
        time: cfg.SELECTION_TIMEOUT_MS ?? 25000,
        max: 1,
      });

      let resolved = false;

      collector.on('collect', async (interaction) => {
        resolved = true;

        try {
          const parts = interaction.customId.split(':');
          const selectedCrimeId = parts[2];
          const crime = crimeById.get(selectedCrimeId);

          if (!crime) {
            await interaction.reply({
              content: 'That crime option is no longer valid. Run `crime` again.',
              ephemeral: true,
            });
            return;
          }

          await interaction.deferUpdate();

          const [walletBalance, bankData, levelData] = await Promise.all([
            economy.getBalance(userId, guildId),
            economy.getBankData(userId, guildId),
            levelService.getLevelData(userId, guildId),
          ]);

          const siteText = crime.siteText || 'You scope out the target area.';
          const actionText = crime.actionText || 'You move in and start the job...';

          const death = rollChanceBps(crime.deathChanceBps);
          const caught = !death && rollChanceBps(crime.failChanceBps);

          let finalEmbed;

          if (death) {
            const minLoss = Math.max(1, cfg.DEATH_LOSS_MIN_PERCENT ?? 25);
            const maxLoss = Math.max(minLoss, cfg.DEATH_LOSS_MAX_PERCENT ?? 75);
            const percentLoss = randomInt(minLoss, maxLoss + 1);
            const moneyLost = computePercentLoss(walletBalance, percentLoss);

            let newWallet = walletBalance;
            if (moneyLost > 0n) {
              const result = await economy.updateBalance(
                userId,
                guildId,
                -moneyLost,
                `crime-${crime.id}-death-loss`
              );
              newWallet = result.balance;
            }

            finalEmbed = new EmbedBuilder()
              .setColor(CONFIG.COLORS.ERROR)
              .setTitle(`☠️ ${crime.label} Failed`)
              .setDescription(crime.deathText || 'You died during the attempt.')
              .addFields(
                { name: 'Loss', value: `${formatMoney(moneyLost)} cm`, inline: true },
                { name: 'Wallet Left', value: `${formatMoney(newWallet)} cm`, inline: true },
                { name: 'Outcome', value: `Fatal (${percentLoss}% wallet loss)`, inline: false }
              )
              .setTimestamp();

            await playCrimeAnimation(
              gameMessage,
              `🚨 Crime: ${crime.label}`,
              siteText,
              actionText,
              finalEmbed,
              [disabledButtons]
            );
            collector.stop('resolved');
            return;
          }

          if (caught) {
            const minFine = Math.max(1, crime.fineMinPercent ?? 5);
            const maxFine = Math.max(minFine, crime.fineMaxPercent ?? 15);
            const finePercent = randomInt(minFine, maxFine + 1);
            const fine = computePercentLoss(walletBalance, finePercent);

            let newWallet = walletBalance;
            if (fine > 0n) {
              const result = await economy.updateBalance(
                userId,
                guildId,
                -fine,
                `crime-${crime.id}-fine`
              );
              newWallet = result.balance;
            }

            let jailMinutes = 0;
            let jailUntilMs = 0;
            const jailChanceBps = computeJailChanceBps(crime, cfg);
            if (rollChanceBps(jailChanceBps)) {
              jailMinutes = chooseJailDurationMinutes(crime, cfg);
              jailUntilMs = Date.now() + jailMinutes * 60 * 1000;
              try {
                await jsonbService.setKey(userId, guildId, cfg.JAIL_UNTIL_KEY, jailUntilMs);
              } catch (error) {
                logger.discord.cmdError('Failed to set jail timer after crime catch:', {
                  userId,
                  guildId,
                  crimeId: crime.id,
                  error,
                });
                jailMinutes = 0;
                jailUntilMs = 0;
              }
            }

            finalEmbed = new EmbedBuilder()
              .setColor(CONFIG.COLORS.WARNING ?? CONFIG.COLORS.DEFAULT)
              .setTitle(`🚓 ${crime.label} Busted`)
              .setDescription(crime.failText || 'You got caught and paid a heavy fine.')
              .addFields(
                { name: 'Fine Paid', value: `${formatMoney(fine)} cm`, inline: true },
                { name: 'Wallet Left', value: `${formatMoney(newWallet)} cm`, inline: true },
                {
                  name: 'Outcome',
                  value: `Caught (${finePercent}% wallet fine)`,
                  inline: false,
                },
                {
                  name: 'Jail',
                  value:
                    jailMinutes > 0
                      ? `You were jailed for ${jailMinutes}m. Out <t:${Math.floor(jailUntilMs / 1000)}:R>.`
                      : 'You dodged jail this time.',
                  inline: false,
                }
              )
              .setTimestamp();

            await playCrimeAnimation(
              gameMessage,
              `🚨 Crime: ${crime.label}`,
              siteText,
              actionText,
              finalEmbed,
              [disabledButtons]
            );
            collector.stop('resolved');
            return;
          }

          const baseReward = BigInt(randomInt(crime.rewardMin, crime.rewardMax + 1));
          const scaled = computeScaledAdventureReward(
            baseReward,
            bankData.totalBalance,
            levelData.level,
            cfg.SCALING
          );
          const finalReward = scaled.reward;

          let newWallet = walletBalance;
          if (finalReward > 0n) {
            const result = await economy.updateBalance(
              userId,
              guildId,
              finalReward,
              `crime-${crime.id}-reward`
            );
            newWallet = result.balance;
          }

          finalEmbed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.SUCCESS)
            .setTitle(`💸 ${crime.label} Success`)
            .setDescription(crime.successText || 'The job paid out.')
            .addFields(
              { name: 'Reward', value: `+${formatMoney(finalReward)} cm`, inline: true },
              { name: 'New Wallet', value: `${formatMoney(newWallet)} cm`, inline: true },
              { name: 'Outcome', value: 'Clean getaway', inline: false }
            )
            .setTimestamp();

          await playCrimeAnimation(
            gameMessage,
            `🚨 Crime: ${crime.label}`,
            siteText,
            actionText,
            finalEmbed,
            [disabledButtons]
          );
          collector.stop('resolved');
        } catch (error) {
          logger.discord.cmdError('Crime collect handler error:', {
            userId,
            guildId,
            error,
          });

          const errorEmbed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.ERROR)
            .setTitle('❌ Crime Failed')
            .setDescription('An unexpected error happened while resolving your crime.')
            .setTimestamp();

          await gameMessage.edit({ embeds: [errorEmbed], components: [] }).catch(() => {});
          collector.stop('error');
        }
      });

      collector.on('end', async (_collected, reason) => {
        if (reason !== 'time' || resolved) {
          return;
        }

        const timeoutEmbed = new EmbedBuilder()
          .setColor(CONFIG.COLORS.DEFAULT)
          .setTitle('⌛ Crime Cancelled')
          .setDescription('You took too long to choose. The opportunity is gone.')
          .setTimestamp();

        await gameMessage
          .edit({ embeds: [timeoutEmbed], components: [disabledButtons] })
          .catch(() => {});
      });

      await new Promise((resolve) => {
        collector.on('end', resolve);
      });
      return;
    } catch (error) {
      logger.discord.cmdError('Crime command error:', { userId, guildId, error });
      return message.reply('Crime failed due to an error. Please try again later.');
    }
  }
}

export default CrimeCommand;
