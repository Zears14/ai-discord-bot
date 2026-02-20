import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import historyService from '../services/historyService.js';
import inventoryService from '../services/inventoryService.js';
import levelService from '../services/levelService.js';
import logger from '../services/loggerService.js';
import { formatMoney } from '../utils/moneyUtils.js';

function buildXpBar(currentXp, xpToNext, size = 12) {
  if (xpToNext <= 0n) return '░'.repeat(size);
  const filled = Number((currentXp * BigInt(size)) / xpToNext);
  const clampedFilled = Math.max(0, Math.min(size, filled));
  return `${'█'.repeat(clampedFilled)}${'░'.repeat(size - clampedFilled)}`;
}

class ProfileCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'profile',
      description: 'Displays your profile statistics.',
      category: 'Economy',
      usage: 'profile [@user]',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.STATS,
      aliases: ['stats', 'user'],
    });
  }

  async execute(message, _args) {
    const target = message.mentions.users.first() || message.author;
    const guildId = message.guild.id;
    try {
      const [userData, inventory, stats, levelData, targetMember] = await Promise.all([
        economy.getUserData(target.id, guildId),
        inventoryService.getInventory(target.id, guildId),
        historyService.getUserStats(target.id, guildId),
        levelService.getLevelData(target.id, guildId),
        message.guild.members.fetch(target.id).catch(() => null),
      ]);
      const lastGrowTime = userData.lastGrow;

      // Calculate inventory worth
      let inventoryWorth = 0n;
      for (const item of inventory) {
        if (item.price !== null) {
          inventoryWorth += item.price * item.quantity;
        }
      }

      const xpBar = buildXpBar(levelData.currentXp, levelData.xpToNext);
      const memberSince = targetMember?.joinedTimestamp
        ? `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:R>`
        : 'Unknown';

      const profileEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DEFAULT)
        .setTitle(`${target.username}'s Profile`)
        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
        .addFields(
          {
            name: '🏅 Level',
            value: [
              `Level: **${levelData.level}**`,
              `XP: ${formatMoney(levelData.currentXp)}/${formatMoney(levelData.xpToNext)}`,
              `Progress: \`${xpBar}\``,
            ].join('\n'),
            inline: false,
          },
          {
            name: '💰 Economy',
            value: [
              `Balance: ${formatMoney(userData.balance)} cm`,
              `Inventory Worth: ${formatMoney(inventoryWorth)} cm`,
              `Net Worth: ${formatMoney(userData.balance + inventoryWorth)} cm`,
              `Inventory Items: ${inventory.length}`,
            ].join('\n'),
            inline: true,
          },
          {
            name: '🎲 Gambling',
            value: [
              `Games Played: ${stats.games_played ?? 0n}`,
              `Total Gambled: ${formatMoney(stats.total_gambled ?? 0n)} cm`,
              `Won: ${formatMoney(stats.total_won ?? 0n)} cm`,
              `Lost: ${formatMoney(stats.total_lost ?? 0n)} cm`,
            ].join('\n'),
            inline: true,
          },
          {
            name: '📅 Activity',
            value: [
              `Earned (Daily/Grow): ${formatMoney(stats.total_earned ?? 0n)} cm`,
              `Daily Claims: ${stats.daily_claims ?? 0n}`,
              `Grow Claims: ${stats.grow_claims ?? 0n}`,
              `Last Grow: ${lastGrowTime ? `<t:${Math.floor(lastGrowTime.getTime() / 1000)}:R>` : 'Never'}`,
              `Member Since: ${memberSince}`,
            ].join('\n'),
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
