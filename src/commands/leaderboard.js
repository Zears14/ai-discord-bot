import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import logger from '../services/loggerService.js';
import { formatMoney } from '../utils/moneyUtils.js';

class LeaderboardCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'leaderboard',
      description: 'View the top users by Dih balance',
      category: 'Economy',
      usage: 'leaderboard',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: ['lb', 'top'],
    });
  }

  async execute(message, _args) {
    const { guild } = message;

    try {
      const topUsers = await economy.getTopUsers(guild.id, 10);

      // Create embed
      const embed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle('🏆 Dih Leaderboard')
        .setDescription('Top users by wallet Dih balance')
        .setTimestamp();

      // Add fields for each user
      if (topUsers.length === 0) {
        embed.setDescription('No users have any Dih yet!');
      } else {
        const fields = await Promise.all(
          topUsers.map(async (user, index) => {
            const discordUser = await message.client.users.fetch(user.userId).catch(() => null);
            const username = discordUser ? discordUser.username : 'Unknown User';
            return {
              name: `#${index + 1} ${username}`,
              value: `${formatMoney(user.balance)} cm`,
              inline: false,
            };
          })
        );

        embed.addFields(fields);
      }

      await message.reply({ embeds: [embed] });
    } catch (error) {
      logger.discord.cmdError('Error in leaderboard command:', error);
      const errorEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.ERROR)
        .setTitle('❌ Error')
        .setDescription('Failed to fetch the leaderboard. Please try again later.');

      await message.reply({ embeds: [errorEmbed] });
    }
  }
}

export default LeaderboardCommand;
