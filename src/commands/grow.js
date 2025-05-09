const BaseCommand = require('./BaseCommand');
const economy = require('../services/economy');
const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config/config');

class GrowCommand extends BaseCommand {
    constructor(client) {
        super(client, {
            name: 'grow',
            description: 'Try to grow your Dih (24h cooldown)',
            category: 'Economy',
            usage: 'grow',
            cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT, // 24 hours in seconds
            aliases: ['g']
        });
    }

    async execute(message, args) {
        const userId = message.author.id;
        const guildId = message.guild.id;

        // Check cooldown
        if (!await economy.canGrow(userId, guildId)) {
            const lastGrow = await economy.getLastGrow(userId, guildId);
            const hoursLeft = 24 - ((new Date() - lastGrow) / (1000 * 60 * 60));
            
            const cooldownEmbed = new EmbedBuilder()
                .setColor(CONFIG.COLORS.ERROR)
                .setTitle('⏰ Cooldown Active')
                .setDescription(`You need to wait ${hoursLeft.toFixed(1)} more hours before growing again!`)
                .setFooter({ text: 'Try again later' })
                .setTimestamp();

            return message.reply({ embeds: [cooldownEmbed] });
        }

        // Get current balance
        const currentBalance = await economy.getBalance(userId, guildId);
        
        // Calculate growth
        let growth;
        if (currentBalance === 0) {
            // Always grow if balance is 0
            growth = Math.floor(Math.random() * 5) + 1; // Random growth between 1-5 cm
        } else {
            // 50% chance to grow or shrink
            const willGrow = Math.random() > 0.5;
            growth = Math.floor(Math.random() * 3) + 1; // Random amount between 1-3 cm
            if (!willGrow) {
                growth = -growth;
            }
        }

        // Update balance and cooldown
        await economy.updateBalance(userId, guildId, growth);
        await economy.updateLastGrow(userId, guildId);

        const newBalance = await economy.getBalance(userId, guildId);

        // Create result embed
        const resultEmbed = new EmbedBuilder()
            .setColor(growth > 0 ? CONFIG.COLORS.SUCCESS : CONFIG.COLORS.ERROR)
            .setTitle(growth > 0 ? '📈 Growth Successful!' : '📉 Growth Failed')
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'Change', value: `${growth > 0 ? '+' : ''}${growth} cm`, inline: true },
                { name: 'New Length', value: `${newBalance} cm`, inline: true }
            )
            .setFooter({ text: 'Next growth available in 24 hours' })
            .setTimestamp();

        await message.reply({ embeds: [resultEmbed] });
    }
}

module.exports = GrowCommand; 