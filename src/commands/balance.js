const BaseCommand = require('./BaseCommand');
const economy = require('../services/economy');
const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config/config');

class BalanceCommand extends BaseCommand {
    constructor(client) {
        super(client, {
            name: 'balance',
            description: 'Check your Dih balance',
            category: 'Economy',
            usage: 'balance [@user]',
            cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
            aliases: ['bal', 'dih']
        });
    }

    async execute(message, args) {
        const guildId = message.guild.id;
        let targetUser;

        // Check if a user was mentioned
        if (args.length > 0) {
            targetUser = message.mentions.users.first();
            if (!targetUser) {
                return message.reply('Please mention a valid user to check their balance.');
            }
        } else {
            targetUser = message.author;
        }

        const balance = await economy.getBalance(targetUser.id, guildId);
        
        // Create embed
        const embed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.DEFAULT)
            .setTitle('💰 Dih Balance')
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'User', value: targetUser.username, inline: true },
                { name: 'Length', value: `${balance} cm`, inline: true }
            )
            .setFooter({ 
                text: targetUser.id === message.author.id 
                    ? 'Your current balance' 
                    : `${targetUser.username}'s current balance`
            })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    }
}

module.exports = BalanceCommand; 