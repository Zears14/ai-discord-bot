import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
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

    // Check cooldown
    const lastDaily = await economy.getLastDaily(userId, guildId);
    const now = new Date();
    if (lastDaily && now - lastDaily < dailyRewardCooldownSeconds * 1000) {
      const timeLeft = dailyRewardCooldownSeconds * 1000 - (now - lastDaily);
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
