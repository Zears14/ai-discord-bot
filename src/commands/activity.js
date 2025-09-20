import BaseCommand from './BaseCommand.js';
import { EmbedBuilder } from 'discord.js';
import CONFIG from '../config/config.js';
import historyService from '../services/historyService.js';

class ActivityCommand extends BaseCommand {
    constructor(client) {
        super(client, {
            name: 'activity',
            description: 'Shows recent activity for a user.',
            category: 'Economy',
            usage: 'activity [@user] [limit]',
            cooldown: 30, // 30 seconds
            aliases: ['history', 'recent']
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
            const formattedActivities = activities.map(activity => {
                let description = `**${activity.type}**`;
                if (activity.amount !== 0) {
                    description += ` | ${activity.amount > 0 ? '+' : ''}${activity.amount}`;
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
                activityEmbed.addFields(
                    { 
                        name: '📊 Summary', 
                        value: `Games Played: ${stats.games_played}\nTotal Gambled: ${stats.total_gambled}\nNet Gains: ${stats.total_gained + stats.total_lost}` 
                    }
                );
            }

            activityEmbed.setFooter({ text: `Showing last ${activities.length} activities` });

            await message.reply({ embeds: [activityEmbed] });

        } catch (error) {
            console.error('Error fetching activity:', error);
            const errorEmbed = new EmbedBuilder()
                .setColor(CONFIG.COLORS.ERROR)
                .setTitle('❌ Error')
                .setDescription('Could not fetch activity information. Please try again later.');
            await message.reply({ embeds: [errorEmbed] });
        }
    }
}

export default ActivityCommand;
