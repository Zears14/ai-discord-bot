const BaseCommand = require('./BaseCommand');
const economy = require('../services/economy');
const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config/config');

class GuildStatsCommand extends BaseCommand {
    constructor(client) {
        super(client, {
            name: 'guildstats',
            description: 'Displays economy statistics for the server.',
            category: 'Economy',
            usage: 'guildstats',
            cooldown: 60, // 60 seconds
            aliases: ['serverstats', 'guildstat']
        });
    }

    async execute(message, args) {
        const guildId = message.guild.id;

        try {
            const stats = await economy.getGuildStats(guildId);

            const statsEmbed = new EmbedBuilder()
                .setColor(CONFIG.COLORS.DEFAULT)
                .setTitle(`📊 Economy Stats for ${message.guild.name}`)
                .addFields(
                    { name: '👥 Total Users', value: stats.totalUsers.toString(), inline: true },
                    { name: '💰 Total Balance', value: stats.totalBalance.toString(), inline: true },
                    { name: '📈 Average Balance', value: stats.avgBalance.toFixed(2), inline: true },
                    { name: '🥇 Max Balance', value: stats.maxBalance.toString(), inline: true },
                    { name: '🥉 Min Balance', value: stats.minBalance.toString(), inline: true },
                    { name: '👑 "Rich" Users', value: stats.richUsers.toString(), inline: true }
                )
                .setThumbnail(message.guild.iconURL({ dynamic: true }))
                .setFooter({ text: `Requested by ${message.author.tag}` })
                .setTimestamp();

            await message.reply({ embeds: [statsEmbed] });

        } catch (error) {
            console.error('Error fetching guild stats:', error);
            const errorEmbed = new EmbedBuilder()
                .setColor(CONFIG.EMBED.COLORS.ERROR)
                .setTitle('❌ Error')
                .setDescription('Could not fetch guild statistics. Please try again later.');
            await message.reply({ embeds: [errorEmbed] });
        }
    }
}

module.exports = GuildStatsCommand;