import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import jsonbService from '../services/jsonbService.js';
import { formatMoney } from '../utils/moneyUtils.js';

class DailyCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'daily',
      description: 'Claim your daily Dih reward',
      category: 'Economy',
      usage: 'daily',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: [],
    });
  }

  async execute(message, _args) {
    const userId = message.author.id;
    const guildId = message.guild.id;
    const dailyAmount = 25n; // Amount to be given daily
    const dailyRewardCooldownSeconds = CONFIG.ECONOMY.DAILY_REWARD_COOLDOWN_SECONDS ?? 86400;
    const cooldownKey = 'dailyRewardCooldownUntil';
    const now = Date.now();
    const cooldownMs = dailyRewardCooldownSeconds * 1000;

    let cooldownLock = await jsonbService.acquireTimedKey(
      userId,
      guildId,
      cooldownKey,
      now + cooldownMs,
      now
    );

    if (!cooldownLock.acquired && Number(cooldownLock.value ?? 0n) <= 0) {
      await jsonbService.setKey(userId, guildId, cooldownKey, 0);
      cooldownLock = await jsonbService.acquireTimedKey(
        userId,
        guildId,
        cooldownKey,
        now + cooldownMs,
        now
      );
    }

    if (!cooldownLock.acquired && Number(cooldownLock.value ?? 0n) > now) {
      const timeLeft = Number(cooldownLock.value) - now;
      const hours = Math.floor(timeLeft / (1000 * 60 * 60));
      const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

      const cooldownEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.ERROR)
        .setTitle('⏰ Cooldown Active')
        .setDescription(
          `You have already claimed your daily reward. Please wait ${hours}h and ${minutes}m.`
        )
        .setFooter({ text: 'Try again later' })
        .setTimestamp();

      return message.reply({ embeds: [cooldownEmbed] });
    }

    // Update balance and last daily
    await economy.updateBalance(userId, guildId, dailyAmount, 'daily');
    await economy.updateLastDaily(userId, guildId);

    const newBalance = await economy.getBalance(userId, guildId);

    // Create result embed
    const resultEmbed = new EmbedBuilder()
      .setColor(CONFIG.COLORS.SUCCESS)
      .setTitle('🎉 Daily Reward Claimed!')
      .setDescription(`You have received ${formatMoney(dailyAmount)} cm Dih!`)
      .addFields({ name: 'New Balance', value: `${formatMoney(newBalance)} cm`, inline: true })
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: 'Come back tomorrow for more!' })
      .setTimestamp();

    await message.reply({ embeds: [resultEmbed] });
  }
}

export default DailyCommand;
