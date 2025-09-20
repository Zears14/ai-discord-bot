const BaseCommand = require('./BaseCommand');
const economy = require('../services/economy');
const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config/config');

class GrowCommand extends BaseCommand {
    constructor(client) {
        super(client, {
            name: 'grow',
            description: 'Try to grow your Dih (12h cooldown)',
            category: 'Economy',
            usage: 'grow',
            cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
            aliases: ['g']
        });
    }

    async execute(message, args) {
        const userId = message.author.id;
        const guildId = message.guild.id;

        // Check cooldown
        if (!await economy.canGrow(userId, guildId)) {
            const lastGrow = await economy.getLastGrow(userId, guildId);
            const hoursLeft = CONFIG.ECONOMY.GROW_INTERVAL - ((new Date() - lastGrow) / (1000 * 60 * 60));
            
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
        let growth = 0;
        const canBeNegative = currentBalance > 20;
        const isNegative = canBeNegative && Math.random() < 0.2; // 20% chance of negative growth if balance > 20

        if (isNegative) {
            // Negative growth logic
            growth = -(Math.floor(Math.random() * 10) + 1); // -1 to -10
        } else {
            // Positive growth logic
            const random = Math.random();
            if (random < 0.7) { // 70% chance for 10-19
                growth = Math.floor(Math.random() * 10) + 10;
            } else { // 30% chance for 20+
                growth = 20;
                while (Math.random() < 0.5) {
                    growth++;
                }
            }
        }

        // Update balance and cooldown
        await economy.updateBalance(userId, guildId, growth, 'grow');
        await economy.updateLastGrow(userId, guildId);

        const newBalance = await economy.getBalance(userId, guildId);

        // Create result embed
        const isUltraGrowth = growth >= 20;
        const resultEmbed = new EmbedBuilder()
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'Change', value: `${growth > 0 ? '+' : ''}${growth} cm`, inline: true },
                { name: 'New Length', value: `${newBalance} cm`, inline: true }
            )
            .setFooter({ text: `Next growth available in ${CONFIG.ECONOMY.GROW_INTERVAL} hours` })
            .setTimestamp();

        if (isUltraGrowth) {
            resultEmbed
                .setColor(CONFIG.COLORS.ULTRA_GROWTH)
                .setTitle('🌟 ULTRA GROWTH! 🌟');
        } else if (growth > 0) {
            resultEmbed
                .setColor(CONFIG.COLORS.SUCCESS)
                .setTitle('📈 Growth Successful!');
        } else {
            resultEmbed
                .setColor(CONFIG.COLORS.ERROR)
                .setTitle('📉 Shrinkage Occurred');
        }

        await message.reply({ embeds: [resultEmbed] });
    }
}

module.exports = GrowCommand; 