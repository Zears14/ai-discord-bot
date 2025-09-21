
/**
 * @fileoverview Transfer command to send money to other users.
 * @module commands/transfer
 */

import BaseCommand from './BaseCommand.js';
import logger from '../services/loggerService.js';
import economy from '../services/economy.js';
import { EmbedBuilder } from 'discord.js';
import CONFIG from '../config/config.js';

class TransferCommand extends BaseCommand {
    constructor(client) {
        super(client, {
            name: 'transfer',
            description: 'Transfer Dih to another user.',
            category: 'Economy',
            usage: 'transfer <user> <amount>',
            cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
            aliases: ['give', 'send']
        });
    }

    async execute(message, args) {
        const fromUserId = message.author.id;
        const guildId = message.guild.id;

        // Check arguments
        if (args.length !== 2) {
            return message.reply('Please provide a user and an amount to transfer. Usage: `transfer <user> <amount>`');
        }

        // Get recipient
        const recipient = message.mentions.users.first();
        if (!recipient) {
            return message.reply('Please mention a user to transfer Dih to.');
        }

        if (recipient.id === fromUserId) {
            return message.reply('You cannot transfer Dih to yourself.');
        }

        if (recipient.bot) {
            return message.reply('You cannot transfer Dih to a bot.');
        }

        // Parse amount
        const amount = parseInt(args[1]);
        if (isNaN(amount) || amount <= 0) {
            return message.reply('Please provide a valid amount to transfer.');
        }

        try {
            // Perform transfer
            const transaction = await economy.transferBalance(fromUserId, recipient.id, guildId, amount);

            // Create embed
            const embed = new EmbedBuilder()
                .setColor(CONFIG.COLORS.SUCCESS)
                .setTitle('Transfer Successful')
                .setDescription(`You have successfully transferred ${amount} cm Dih to ${recipient.username}.`)
                .addFields(
                    { name: 'Your New Balance', value: `${transaction.from.newBalance} cm`, inline: true },
                    { name: `${recipient.username}'s New Balance`, value: `${transaction.to.newBalance} cm`, inline: true }
                )
                .setTimestamp();

            return message.reply({ embeds: [embed] });

        } catch (error) {
            logger.discord.cmdError('Transfer error:', error);
            if (error.message.startsWith('Insufficient balance')) {
                const balance = await economy.getBalance(fromUserId, guildId);
                return message.reply(`You don't have enough Dih! Your balance: ${balance} cm`);
            }
            return message.reply('An error occurred during the transfer. Please try again later.');
        }
    }
}

export default TransferCommand;
