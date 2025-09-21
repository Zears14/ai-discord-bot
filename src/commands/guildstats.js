import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import historyService from '../services/historyService.js';
import logger from '../services/loggerService.js';

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

      const statsEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle(`📊 Economy Stats for ${message.guild.name}`)
        .addFields(
          // Economy stats
          {
            name: '� Economy Overview',
            value: [
              `Total Users: ${economyStats.totalUsers}`,
              `Total Balance: ${economyStats.totalBalance}`,
              `Average Balance: ${economyStats.avgBalance.toFixed(2)}`,
              `Richest Balance: ${economyStats.maxBalance}`,
            ].join('\n'),
            inline: true,
          },
          // Activity stats (last 30 days)
          {
            name: '📈 Activity (30d)',
            value: [
              `Active Users: ${historyStats.active_users}`,
              `Total Games: ${historyStats.total_games}`,
              `Money Gambled: ${historyStats.total_gambled}`,
              `Activities: ${historyStats.unique_activities}`,
            ].join('\n'),
            inline: true,
          },
          // Money flow
          {
            name: '💸 Money Flow (30d)',
            value: [
              `Money Generated: ${historyStats.total_gained}`,
              `Money Lost: ${historyStats.total_lost}`,
              `Net Change: ${historyStats.total_gained + historyStats.total_lost}`,
              `Active Economy: ${Math.abs(historyStats.total_gained) + Math.abs(historyStats.total_lost)}`,
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
