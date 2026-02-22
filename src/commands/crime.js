/**
 * @fileoverview Crime command with randomized 3-choice risk/reward actions.
 * @module commands/crime
 */

import { randomBytes, randomInt } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import commandSessionService from '../services/commandSessionService.js';
import deployLockService from '../services/deployLockService.js';
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
  const loss = (balance * BigInt(percent)) / 100n;
  return loss > 0n ? loss : 1n;
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

function randomBigIntInRange(min, max) {
  const lower = min <= max ? min : max;
  const upper = min <= max ? max : min;
  if (lower === upper) {
    return lower;
  }

  const lowerAsNumber = Number(lower);
  const upperAsNumber = Number(upper);
  if (
    Number.isSafeInteger(lowerAsNumber) &&
    Number.isSafeInteger(upperAsNumber) &&
    BigInt(lowerAsNumber) === lower &&
    BigInt(upperAsNumber) === upper
  ) {
    return BigInt(randomInt(lowerAsNumber, upperAsNumber + 1));
  }

  const span = upper - lower + 1n;
  const bits = span.toString(2).length;
  const byteLength = Math.max(1, Math.ceil(bits / 8));
  const upperBound = 1n << BigInt(byteLength * 8);
  const rejectionThreshold = upperBound - (upperBound % span);

  while (true) {
    const randomHex = randomBytes(byteLength).toString('hex');
    const sampled = BigInt(`0x${randomHex}`);
    if (sampled < rejectionThreshold) {
      return lower + (sampled % span);
    }
  }
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

function computeScaledRange(crime, totalBalance, level, scalingConfig) {
  const rawMin = Math.floor(Number(crime.rewardMin ?? 0));
  const rawMax = Math.floor(Number(crime.rewardMax ?? 0));
  const normalizedMin = Number.isFinite(rawMin) ? Math.max(1, rawMin) : 1;
  const normalizedMax = Number.isFinite(rawMax) ? Math.max(normalizedMin, rawMax) : normalizedMin;
  const scaledMin = computeScaledAdventureReward(
    BigInt(normalizedMin),
    totalBalance,
    level,
    scalingConfig
  ).reward;
  const scaledMax = computeScaledAdventureReward(
    BigInt(normalizedMax),
    totalBalance,
    level,
    scalingConfig
  ).reward;

  return {
    min: scaledMin,
    max: scaledMax >= scaledMin ? scaledMax : scaledMin,
  };
}

function buildChoiceEmbed(choices, scaledRangesByCrimeId = new Map()) {
  const lines = choices.map((crime, index) => {
    const scaledRange = scaledRangesByCrimeId.get(crime.id);
    const minReward = scaledRange?.min ?? BigInt(crime.rewardMin);
    const maxReward = scaledRange?.max ?? BigInt(crime.rewardMax);

    return (
      `**${index + 1}. ${crime.emoji} ${crime.label}**\n` +
      `Reward: ${formatMoney(minReward)}-${formatMoney(maxReward)} cm\n` +
      `Caught: ${toPercentText(crime.failChanceBps)} | Death: ${toPercentText(crime.deathChanceBps)}`
    );
  });

  return new EmbedBuilder()
    .setColor(CONFIG.COLORS.DEFAULT)
    .setTitle('🚨 Choose Your Crime')
    .setDescription(
      `Pick **1** option below. You only get one attempt this round.\n\n${lines.join('\n\n')}`
    )
    .setFooter({ text: 'Select one button to commit that crime' })
    .setTimestamp();
}

function buildButtons(choices, disabled = false) {
  return new ActionRowBuilder().addComponents(
    ...choices.map((crime) =>
      new ButtonBuilder()
        .setCustomId(`crime:pick:${crime.id}`)
        .setLabel(`${crime.emoji} ${crime.label}`.slice(0, 80))
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    )
  );
}

function buildCrimeTimeoutEmbed() {
  return new EmbedBuilder()
    .setColor(CONFIG.COLORS.DEFAULT)
    .setTitle('⌛ Crime Cancelled')
    .setDescription('You took too long to choose. The opportunity is gone.')
    .setTimestamp();
}

function scheduleCrimeTimeout(gameMessage, timeoutMs) {
  const messageId = gameMessage.id;
  const timeoutHandle = setTimeout(async () => {
    try {
      const lockAcquired = await deployLockService.acquireLock(`crime:timeout:${messageId}`, 15);
      if (!lockAcquired) {
        return;
      }

      const session = await commandSessionService.getSession('crime', messageId);
      if (!session) {
        return;
      }

      const expiresAt = Number(session.expiresAt || 0);
      if (Boolean(session.resolved) || expiresAt > Date.now()) {
        return;
      }

      const cfg = CONFIG.COMMANDS.CRIME;
      const crimeLookup = new Map(cfg.CRIMES.map((crime) => [crime.id, crime]));
      const sessionCrimes = (session.crimeIds || [])
        .map((id) => crimeLookup.get(id))
        .filter(Boolean);
      const disabledButtons = sessionCrimes.length > 0 ? buildButtons(sessionCrimes, true) : null;

      await commandSessionService.deleteSession('crime', messageId);
      await commandSessionService.releaseExclusiveSession(
        session.userId,
        session.guildId,
        session.exclusiveSessionToken || null
      );

      await gameMessage.edit({
        embeds: [buildCrimeTimeoutEmbed()],
        components: disabledButtons ? [disabledButtons] : [],
      });
    } catch {
      // Best-effort timeout cleanup.
    }
  }, timeoutMs + 250);

  timeoutHandle.unref?.();
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
      exclusiveSessionTtlSeconds: 45,
      interactionPrefix: 'crime',
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
      const [currentWallet, levelData] = await Promise.all([
        economy.getBalance(userId, guildId),
        levelService.getLevelData(userId, guildId),
      ]);
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
      const scaledRangesByCrimeId = new Map(
        selectedCrimes.map((crime) => [
          crime.id,
          computeScaledRange(crime, currentWallet, levelData.level, cfg.SCALING),
        ])
      );

      const gameMessage = await message.reply({
        embeds: [buildChoiceEmbed(selectedCrimes, scaledRangesByCrimeId)],
        components: [buildButtons(selectedCrimes, false)],
      });

      const timeoutMs = cfg.SELECTION_TIMEOUT_MS ?? 25000;
      const expiresAt = Date.now() + timeoutMs;
      const stored = await commandSessionService.setSession(
        'crime',
        gameMessage.id,
        {
          userId,
          guildId,
          exclusiveSessionToken: message.__exclusiveSessionToken || null,
          crimeIds: selectedCrimes.map((crime) => crime.id),
          expiresAt,
          resolved: false,
        },
        Math.ceil(timeoutMs / 1000) + 20
      );

      if (!stored) {
        await commandSessionService.releaseExclusiveSession(
          userId,
          guildId,
          message.__exclusiveSessionToken || null
        );
        await gameMessage
          .edit({
            embeds: [
              new EmbedBuilder()
                .setColor(CONFIG.COLORS.ERROR)
                .setTitle('❌ Crime Unavailable')
                .setDescription('Could not start crime session. Please try again.')
                .setTimestamp(),
            ],
            components: [],
          })
          .catch(() => {});
        return { skipCooldown: true };
      }

      scheduleCrimeTimeout(gameMessage, timeoutMs);
      return { keepExclusiveSession: true };
    } catch (error) {
      logger.discord.cmdError('Crime command error:', { userId, guildId, error });
      await commandSessionService.releaseExclusiveSession(
        userId,
        guildId,
        message.__exclusiveSessionToken || null
      );
      return message.reply('Crime failed due to an error. Please try again later.');
    }
  }

  async handleInteraction(interaction) {
    const parts = (interaction.customId || '').split(':');
    const action = parts[1];
    const selectedCrimeId = parts[2];
    if (action !== 'pick' || !selectedCrimeId) {
      await interaction.deferUpdate().catch(() => {});
      return;
    }

    const messageId = interaction.message.id;
    const lockKey = interaction.id || `crime:fallback:${messageId}:${interaction.user.id}`;
    const lockAcquired = await deployLockService.acquireLock(`crime:interaction:${lockKey}`, 15);
    if (!lockAcquired) {
      await interaction.deferUpdate().catch(() => {});
      return;
    }

    const session = await commandSessionService.getSession('crime', messageId);
    if (!session) {
      const expiredEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle('⌛ Crime Session Expired')
        .setDescription('This crime session has expired. Run `crime` again.')
        .setTimestamp();

      await interaction
        .update({
          embeds: [expiredEmbed],
          components: [],
        })
        .catch(async () => {
          await interaction.message
            .edit({ embeds: [expiredEmbed], components: [] })
            .catch(() => {});
          if (!interaction.replied && !interaction.deferred) {
            await interaction
              .reply({
                content: 'That crime session has expired. Run `crime` again.',
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});
          }
        });
      return;
    }

    const userId = session.userId;
    const guildId = session.guildId;
    if (interaction.user.id !== userId) {
      await interaction
        .reply({
          content: 'These crime buttons are not for you.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const cfg = CONFIG.COMMANDS.CRIME;
    const expiresAt = Number(session.expiresAt || 0);
    const now = Date.now();
    const crimeLookup = new Map(cfg.CRIMES.map((crime) => [crime.id, crime]));
    const sessionCrimes = (session.crimeIds || []).map((id) => crimeLookup.get(id)).filter(Boolean);
    const disabledButtons = sessionCrimes.length > 0 ? buildButtons(sessionCrimes, true) : null;

    if (Boolean(session.resolved) || expiresAt <= now) {
      await commandSessionService.deleteSession('crime', messageId);
      await commandSessionService.releaseExclusiveSession(
        userId,
        guildId,
        session.exclusiveSessionToken || null
      );

      const timeoutEmbed = buildCrimeTimeoutEmbed();

      await interaction
        .update({
          embeds: [timeoutEmbed],
          components: disabledButtons ? [disabledButtons] : [],
        })
        .catch(async () => {
          await interaction.message
            .edit({ embeds: [timeoutEmbed], components: disabledButtons ? [disabledButtons] : [] })
            .catch(() => {});
        });
      return;
    }

    if (!session.crimeIds?.includes(selectedCrimeId)) {
      await interaction
        .reply({
          content: 'That crime option is no longer valid. Run `crime` again.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const crime = crimeLookup.get(selectedCrimeId);
    if (!crime) {
      await interaction
        .reply({
          content: 'That crime option is unavailable right now. Run `crime` again.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    await interaction.deferUpdate().catch(() => {});

    try {
      const [walletBalance, levelData] = await Promise.all([
        economy.getBalance(userId, guildId),
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
          interaction.message,
          `🚨 Crime: ${crime.label}`,
          siteText,
          actionText,
          finalEmbed,
          [disabledButtons]
        );
      } else if (caught) {
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
          interaction.message,
          `🚨 Crime: ${crime.label}`,
          siteText,
          actionText,
          finalEmbed,
          [disabledButtons]
        );
      } else {
        const scaledRange = computeScaledRange(crime, walletBalance, levelData.level, cfg.SCALING);
        const finalReward = randomBigIntInRange(scaledRange.min, scaledRange.max);

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
          interaction.message,
          `🚨 Crime: ${crime.label}`,
          siteText,
          actionText,
          finalEmbed,
          [disabledButtons]
        );
      }

      await commandSessionService.deleteSession('crime', messageId);
      await commandSessionService.releaseExclusiveSession(
        userId,
        guildId,
        session.exclusiveSessionToken || null
      );
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

      await interaction.message.edit({ embeds: [errorEmbed], components: [] }).catch(() => {});
      await commandSessionService.deleteSession('crime', messageId);
      await commandSessionService.releaseExclusiveSession(
        userId,
        guildId,
        session.exclusiveSessionToken || null
      );
    }
  }
}

export default CrimeCommand;
