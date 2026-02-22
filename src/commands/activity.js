import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import historyService from '../services/historyService.js';
import logger from '../services/loggerService.js';
import { formatMoney, toBigInt } from '../utils/moneyUtils.js';

function toSafeMoneyBigInt(value) {
  try {
    return toBigInt(value ?? 0n, 'Money');
  } catch {
    if (typeof value === 'number' && Number.isFinite(value)) {
      try {
        return toBigInt(Math.trunc(value), 'Money');
      } catch {
        return 0n;
      }
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();

      // Accept decimal strings from legacy numeric aggregates and floor them.
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        const asNumber = Number(trimmed);
        if (Number.isFinite(asNumber)) {
          try {
            return toBigInt(Math.trunc(asNumber), 'Money');
          } catch {
            return 0n;
          }
        }
      }
    }

    return 0n;
  }
}

class ActivityCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'activity',
      description: 'Shows recent activity for a user.',
      category: 'Economy',
      usage: 'activity [@user] [limit]',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.STATS,
      aliases: ['history', 'recent'],
    });
  }

  async execute(message, args) {
    const target = message.mentions.users.first() || message.author;
    const limit = args.length > 1 ? parseInt(args[1], 10) : 10;

    if (isNaN(limit) || limit < 1 || limit > 25) {
      return message.reply('Please provide a valid limit between 1 and 25.');
    }

    try {
      const activities = await historyService.getUserActivity(target.id, message.guild.id, limit);

      if (!activities || activities.length === 0) {
        return message.reply('No recent activity found for this user.');
      }

      const activityEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle(`${target.username}'s Recent Activity`)
        .setThumbnail(target.displayAvatarURL({ dynamic: true }));

      // Format activities into a readable list
      const formattedActivities = activities.map((activity) => {
        const moneyAmount = toSafeMoneyBigInt(activity.amount);
        let description = `**${activity.type}**`;
        if (moneyAmount !== 0n) {
          description += ` | ${moneyAmount > 0n ? '+' : ''}${formatMoney(moneyAmount)} cm`;
        }
        if (activity.item_name) {
          description += ` | ${activity.item_title || activity.item_name}`;
        }
        description += ` | <t:${Math.floor(new Date(activity.created_at).getTime() / 1000)}:R>`;
        return description;
      });

      activityEmbed.setDescription(formattedActivities.join('\n'));

      // Add summary statistics
      const stats = await historyService.getUserStats(target.id, message.guild.id);
      if (stats) {
        const totalEarned = toSafeMoneyBigInt(stats.total_earned);
        const totalWon = toSafeMoneyBigInt(stats.total_won);
        const totalLost = toSafeMoneyBigInt(stats.total_lost);
        const totalGambled = toSafeMoneyBigInt(stats.total_gambled);
        const netGains = totalEarned + totalWon + totalLost;

        activityEmbed.addFields({
          name: '📊 Summary',
          value: `Games Played: ${stats.games_played ?? 0n}\nTotal Gambled: ${formatMoney(totalGambled)} cm\nNet Gains: ${formatMoney(netGains)} cm`,
        });
      }

      activityEmbed.setFooter({ text: `Showing last ${activities.length} activities` });

      await message.reply({ embeds: [activityEmbed] });
    } catch (error) {
      logger.discord.cmdError('Error fetching activity:', error);
      const errorEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.ERROR)
        .setTitle('❌ Error')
        .setDescription('Could not fetch activity information. Please try again later.');
      await message.reply({ embeds: [errorEmbed] });
    }
  }
}

export default ActivityCommand;
