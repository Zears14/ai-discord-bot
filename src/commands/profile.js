import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import historyService from '../services/historyService.js';
import inventoryService from '../services/inventoryService.js';
import logger from '../services/loggerService.js';
import { formatMoney } from '../utils/moneyUtils.js';

class ProfileCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'profile',
      description: 'Displays your profile statistics.',
      category: 'Economy',
      usage: 'profile [@user]',
      cooldown: 30, // 30 seconds
      aliases: ['stats', 'user'],
    });
  }

  async execute(message, _args) {
    const target = message.mentions.users.first() || message.author;
    const guildId = message.guild.id;
    try {
      const userData = await economy.getUserData(target.id, guildId);
      const inventory = await inventoryService.getInventory(target.id, guildId);
      const lastGrowTime = userData.lastGrow;

      // Calculate inventory worth
      let inventoryWorth = 0n;
      for (const item of inventory) {
        if (item.price !== null) {
          inventoryWorth += item.price * item.quantity;
        }
      }

      // Get activity stats from history
      const stats = await historyService.getUserStats(target.id, guildId);

      const profileEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle(`${target.username}'s Profile`)
        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '💰 Balance', value: `${formatMoney(userData.balance)} cm`, inline: true },
          { name: '🎒 Inventory Worth', value: `${formatMoney(inventoryWorth)} cm`, inline: true },
          {
            name: '💎 Net Worth',
            value: `${formatMoney(userData.balance + inventoryWorth)} cm`,
            inline: true,
          },
          {
            name: '🎰 Total Gambled',
            value: `${formatMoney(stats.total_gambled ?? 0n)} cm`,
            inline: true,
          },
          { name: '🎲 Games Played', value: `${stats.games_played ?? 0n}`, inline: true },
          {
            name: '📈 Gambling Stats',
            value: `Won: ${formatMoney(stats.total_won ?? 0n)} cm\nLost: ${formatMoney(stats.total_lost ?? 0n)} cm`,
            inline: true,
          },
          {
            name: '🌟 Earnings',
            value: `Claimed: ${formatMoney(stats.total_earned ?? 0n)} cm\nDaily: ${stats.daily_claims ?? 0n}\nGrow: ${stats.grow_claims ?? 0n}`,
            inline: true,
          },
          {
            name: '🌱 Last Grow',
            value: lastGrowTime ? `<t:${Math.floor(lastGrowTime.getTime() / 1000)}:R>` : 'Never',
            inline: true,
          },
          { name: '📦 Inventory Size', value: `${inventory.length} items`, inline: true },
          {
            name: '💫 Member Since',
            value: `<t:${Math.floor(message.member.joinedTimestamp / 1000)}:R>`,
            inline: true,
          }
        )
        .setFooter({ text: `ID: ${target.id}` })
        .setTimestamp();

      await message.reply({ embeds: [profileEmbed] });
    } catch (error) {
      logger.discord.cmdError('Error fetching profile:', error);
      const errorEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.ERROR)
        .setTitle('❌ Error')
        .setDescription('Could not fetch profile information. Please try again later.');
      await message.reply({ embeds: [errorEmbed] });
    }
  }
}

export default ProfileCommand;
