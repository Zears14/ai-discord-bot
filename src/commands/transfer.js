const BaseCommand = require('./BaseCommand');
const economy = require('../services/economy');
const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config/config');

class TransferCommand extends BaseCommand {
    constructor(client) {
        super(client, {
            name: 'transfer',
            description: 'Transfer Dih to another user.',
            category: 'Economy',
            usage: 'transfer <@user> <amount>',
            cooldown: CONFIG.COMMANDS.COOLDOWNS.DEFAULT,
            aliases: ['give', 'pay'],
            args: true
        });
    }

    async execute(message, args) {
        const guildId = message.guild.id;
        const fromUser = message.author;

        // Get the recipient
        const toUser = message.mentions.users.first();
        if (!toUser) {
            return message.reply('You need to mention a user to transfer Dih to.');
        }

        if (toUser.id === fromUser.id) {
            return message.reply('You cannot transfer Dih to yourself.');
        }
        
        if (toUser.bot) {
            return message.reply('You cannot transfer Dih to a bot.');
        }

        // Get the amount
        const amount = parseInt(args[1]);
        if (isNaN(amount) || amount <= 0) {
            return message.reply('You need to specify a valid amount of Dih to transfer.');
        }

        try {
            const success = await economy.transferBalance(fromUser.id, toUser.id, guildId, amount);

            if (success) {
                const embed = new EmbedBuilder()
                    .setColor(CONFIG.COLORS.SUCCESS)
                    .setTitle('💸 Transfer Successful')
                    .setDescription(`You have successfully transferred ${amount} cm of Dih to ${toUser.username}.`)
                    .addFields(
                        { name: 'Sender', value: fromUser.username, inline: true },
                        { name: 'Recipient', value: toUser.username, inline: true },
                        { name: 'Amount', value: `${amount} cm`, inline: true }
                    )
                    .setTimestamp();
                
                await message.reply({ embeds: [embed] });
            }
        } catch (error) {
            console.error(error);
            // Specific error messages from the economy service
            if (error.message === 'Insufficient balance.' || error.message === 'Transfer amount must be positive.') {
                return message.reply(error.message);
            }
            // Generic error message
            return message.reply('An error occurred during the transfer. Please try again later.');
        }
    }
}

module.exports = TransferCommand;
