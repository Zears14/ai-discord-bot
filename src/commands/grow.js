import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import { formatMoney, toNumberClamped } from '../utils/moneyUtils.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calculateGrowth(currentBalance) {
  const growCfg = CONFIG.ECONOMY.GROW_SCALING;
  const balance = Math.max(0, currentBalance);
  const diminishingFactor =
    1 / (1 + Math.pow(balance / growCfg.SLOWDOWN_PIVOT, growCfg.SLOWDOWN_POWER));

  // Growth scales with balance, but the rate itself diminishes as balance gets larger.
  // This keeps growth numerically larger at high balance while relatively less meaningful.
  const growthRate = growCfg.MIN_RATE + (growCfg.MAX_RATE - growCfg.MIN_RATE) * diminishingFactor;
  const scaledGrowth = Math.floor(balance * growthRate);
  const growthCenter = Math.max(randomInt(growCfg.BASE_MIN, growCfg.BASE_MAX), scaledGrowth);
  const positiveMin = Math.max(1, Math.floor(growthCenter * growCfg.RANGE_LOW_MULTIPLIER));
  const positiveMax = Math.max(
    positiveMin,
    Math.floor(growthCenter * growCfg.RANGE_HIGH_MULTIPLIER)
  );

  let negativeChance = 0;
  if (balance > growCfg.NEGATIVE_UNLOCK_BALANCE) {
    negativeChance = clamp(
      growCfg.NEGATIVE_BASE_CHANCE + (1 - diminishingFactor) * growCfg.NEGATIVE_EXTRA_CHANCE,
      0,
      growCfg.MAX_NEGATIVE_CHANCE
    );
  }

  if (Math.random() < negativeChance) {
    const riskFactor = 1 - diminishingFactor;
    const negativeRate =
      growCfg.NEGATIVE_RATE_MIN +
      (growCfg.NEGATIVE_RATE_MAX - growCfg.NEGATIVE_RATE_MIN) * riskFactor;
    const negativeCenter = Math.max(growCfg.NEGATIVE_MIN, Math.floor(balance * negativeRate));
    const negativeMin = Math.max(
      growCfg.NEGATIVE_MIN,
      Math.floor(negativeCenter * growCfg.NEGATIVE_RANGE_LOW_MULTIPLIER)
    );
    const negativeMax = Math.max(
      negativeMin,
      Math.floor(negativeCenter * growCfg.NEGATIVE_RANGE_HIGH_MULTIPLIER)
    );

    // Keep shrinkage valid under min-balance constraints.
    const boundedNegativeMax = Math.min(balance, negativeMax);
    const boundedNegativeMin = Math.min(negativeMin, boundedNegativeMax);
    return -randomInt(boundedNegativeMin, boundedNegativeMax);
  }

  let growth = randomInt(positiveMin, positiveMax);
  const jackpotChance = growCfg.JACKPOT_BASE_CHANCE * diminishingFactor;
  if (Math.random() < jackpotChance) {
    const bonusMax = Math.max(
      growCfg.JACKPOT_BONUS_MIN,
      Math.floor(growthCenter * growCfg.JACKPOT_BONUS_SCALE * diminishingFactor)
    );
    growth += randomInt(1, bonusMax);
  }

  return growth;
}

class GrowCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'grow',
      description: 'Try to grow your Dih (12h cooldown)',
      category: 'Economy',
      usage: 'grow',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: ['g'],
    });
  }

  async execute(message, _args) {
    const userId = message.author.id;
    const guildId = message.guild.id;
    const growStatus = await economy.canGrow(userId, guildId);

    // Check cooldown
    if (!growStatus.canGrow) {
      const cooldownEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.ERROR)
        .setTitle('⏰ Cooldown Active')
        .setDescription(
          `You need to wait ${growStatus.hoursUntilNext.toFixed(1)} more hours before growing again!`
        )
        .setFooter({ text: 'Try again later' })
        .setTimestamp();

      return message.reply({ embeds: [cooldownEmbed] });
    }

    // Get current balance
    const currentBalance = await economy.getBalance(userId, guildId);
    const balanceForMath = toNumberClamped(currentBalance);

    // Calculate growth with diminishing returns at higher balances
    const growth = BigInt(calculateGrowth(balanceForMath));

    // Update balance and cooldown
    await economy.updateBalance(userId, guildId, growth, 'grow');
    await economy.updateLastGrow(userId, guildId);

    const newBalance = await economy.getBalance(userId, guildId);

    // Create result embed
    const isUltraGrowth = growth >= 20n;
    const resultEmbed = new EmbedBuilder()
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .addFields(
        {
          name: 'Change',
          value: `${growth > 0n ? '+' : ''}${formatMoney(growth)} cm`,
          inline: true,
        },
        { name: 'New Length', value: `${formatMoney(newBalance)} cm`, inline: true }
      )
      .setFooter({ text: `Next growth available in ${CONFIG.ECONOMY.GROW_INTERVAL} hours` })
      .setTimestamp();

    if (isUltraGrowth) {
      resultEmbed.setColor(CONFIG.COLORS.ULTRA_GROWTH).setTitle('🌟 ULTRA GROWTH! 🌟');
    } else if (growth > 0n) {
      resultEmbed.setColor(CONFIG.COLORS.SUCCESS).setTitle('📈 Growth Successful!');
    } else {
      resultEmbed.setColor(CONFIG.COLORS.ERROR).setTitle('📉 Shrinkage Occurred');
    }

    await message.reply({ embeds: [resultEmbed] });
  }
}

export default GrowCommand;
