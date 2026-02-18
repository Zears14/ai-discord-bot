import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import historyService from '../services/historyService.js';
import logger from '../services/loggerService.js';
import { bigintAbs, formatMoney } from '../utils/moneyUtils.js';

class GuildStatsCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'guildstats',
      description: 'Displays economy statistics for the server.',
      category: 'Economy',
      usage: 'guildstats',
      cooldown: 60, // 60 seconds
      aliases: ['serverstats', 'guildstat'],
    });
  }

  async execute(message, _args) {
    const guildId = message.guild.id;

    try {
      const [economyStats, historyStats] = await Promise.all([
        economy.getGuildStats(guildId),
        historyService.getGuildStats(guildId),
      ]);
      const totalGained = historyStats.total_gained ?? 0n;
      const totalLost = historyStats.total_lost ?? 0n;
      const netChange = totalGained + totalLost;
      const activeEconomy = bigintAbs(totalGained) + bigintAbs(totalLost);

      const statsEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle(`📊 Economy Stats for ${message.guild.name}`)
        .addFields(
          // Economy stats
          {
            name: '💼 Economy Overview',
            value: [
              `Total Users: ${economyStats.totalUsers}`,
              `Total Balance: ${formatMoney(economyStats.totalBalance)} cm`,
              `Average Balance: ${economyStats.avgBalance.toFixed(2)}`,
              `Richest Balance: ${formatMoney(economyStats.maxBalance)} cm`,
            ].join('\n'),
            inline: true,
          },
          // Activity stats (last 30 days)
          {
            name: '📈 Activity (30d)',
            value: [
              `Active Users: ${historyStats.active_users ?? 0n}`,
              `Total Games: ${historyStats.total_games ?? 0n}`,
              `Money Gambled: ${formatMoney(historyStats.total_gambled ?? 0n)} cm`,
              `Activities: ${historyStats.unique_activities ?? 0n}`,
            ].join('\n'),
            inline: true,
          },
          // Money flow
          {
            name: '💸 Money Flow (30d)',
            value: [
              `Money Generated: ${formatMoney(totalGained)} cm`,
              `Money Lost: ${formatMoney(totalLost)} cm`,
              `Net Change: ${formatMoney(netChange)} cm`,
              `Active Economy: ${formatMoney(activeEconomy)} cm`,
            ].join('\n'),
            inline: true,
          }
        )
        .setThumbnail(message.guild.iconURL({ dynamic: true }))
        .setFooter({ text: `Requested by ${message.author.tag} • Last 30 days activity` })
        .setTimestamp();

      await message.reply({ embeds: [statsEmbed] });
    } catch (error) {
      logger.discord.cmdError('Error fetching guild stats:', error);
      const errorEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.ERROR)
        .setTitle('❌ Error')
        .setDescription('Could not fetch guild statistics. Please try again later.');
      await message.reply({ embeds: [errorEmbed] });
    }
  }
}

export default GuildStatsCommand;
