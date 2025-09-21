import BaseCommand from './BaseCommand.js';
import economy from '../services/economy.js';
import logger from '../services/loggerService.js';
import { EmbedBuilder } from 'discord.js';
import CONFIG from '../config/config.js';
import historyService from '../services/historyService.js';
import inventoryService from '../services/inventoryService.js';

class ProfileCommand extends BaseCommand {
    constructor(client) {
        super(client, {
            name: 'profile',
            description: 'Displays your profile statistics.',
            category: 'Economy',
            usage: 'profile [@user]',
            cooldown: 30, // 30 seconds
            aliases: ['stats', 'user']
        });
    }

    async execute(message, args) {
        const target = message.mentions.users.first() || message.author;
        const guildId = message.guild.id;

        try {
            const userData = await economy.getUserData(target.id, guildId);
            const inventory = await inventoryService.getInventory(target.id, guildId);
            const lastGrowTime = userData.lastGrow;
            
            // Calculate inventory worth
            let inventoryWorth = 0;
            for (const item of inventory) {
                if (item.price) {
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
                    { name: '💰 Balance', value: userData.balance.toString(), inline: true },
                    { name: '🎒 Inventory Worth', value: inventoryWorth.toString(), inline: true },
                    { name: '💎 Net Worth', value: (userData.balance + inventoryWorth).toString(), inline: true },
                    { name: '🎰 Total Gambled', value: stats.total_gambled?.toString() || '0', inline: true },
                    { name: '🎲 Games Played', value: stats.games_played?.toString() || '0', inline: true },
                    { name: '📈 Gambling Stats', value: `Won: ${stats.total_won || 0}\nLost: ${stats.total_lost || 0}`, inline: true },
                    { name: '🌟 Earnings', value: `Claimed: ${stats.total_earned || 0}\nDaily: ${stats.daily_claims || 0}\nGrow: ${stats.grow_claims || 0}`, inline: true },
                    { name: '🌱 Last Grow', value: lastGrowTime ? `<t:${Math.floor(lastGrowTime.getTime() / 1000)}:R>` : 'Never', inline: true },
                    { name: '📦 Inventory Size', value: `${inventory.length} items`, inline: true },
                    { name: '💫 Member Since', value: `<t:${Math.floor(message.member.joinedTimestamp / 1000)}:R>`, inline: true }
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
