const BaseCommand = require('./BaseCommand');
const economy = require('../services/economy');
const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config/config');

class DailyCommand extends BaseCommand {
    constructor(client) {
        super(client, {
            name: 'daily',
            description: 'Claim your daily Dih reward',
            category: 'Economy',
            usage: 'daily',
            cooldown: 86400, // 24 hours
            aliases: []
        });
    }

    async execute(message, args) {
        const userId = message.author.id;
        const guildId = message.guild.id;
        const dailyAmount = 25; // Amount to be given daily

        // Check cooldown
        const lastDaily = await economy.getLastDaily(userId, guildId);
        const now = new Date();
        if (lastDaily && (now - lastDaily) < (this.cooldown * 1000)) {
            const timeLeft = (this.cooldown * 1000) - (now - lastDaily);
            const hours = Math.floor(timeLeft / (1000 * 60 * 60));
            const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            
            const cooldownEmbed = new EmbedBuilder()
                .setColor(CONFIG.COLORS.ERROR)
                .setTitle('⏰ Cooldown Active')
                .setDescription(`You have already claimed your daily reward. Please wait ${hours}h and ${minutes}m.`)
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
            .setDescription(`You have received ${dailyAmount} cm Dih!`)
            .addFields(
                { name: 'New Balance', value: `${newBalance} cm`, inline: true }
            )
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: 'Come back tomorrow for more!' })
            .setTimestamp();

        await message.reply({ embeds: [resultEmbed] });
    }
}

module.exports = DailyCommand;
