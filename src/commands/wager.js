import BaseCommand from './BaseCommand.js';
import economy from '../services/economy.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import CONFIG from '../config/config.js';

class WagerCommand extends BaseCommand {
    constructor(client) {
        super(client, {
            name: 'wager',
            description: 'Wager your Dih with another user',
            category: 'Economy',
            usage: 'wager <@user> <amount>',
            cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
            aliases: ['bet', 'gamble']
        });
    }

    async execute(message, args) {
        const userId = message.author.id;
        const guildId = message.guild.id;

        // Check arguments
        if (args.length !== 2) {
            const helpEmbed = new EmbedBuilder()
                .setColor(CONFIG.COLORS.ERROR)
                .setTitle('❌ Invalid Usage')
                .setDescription('Please provide a user mention and amount to wager.')
                .addFields(
                    { name: 'Usage', value: '`wager @user <amount>`' },
                    { name: 'Example', value: '`wager @user 10`' }
                );

            return message.reply({ embeds: [helpEmbed] });
        }

        // Parse target user
        const targetUser = message.mentions.users.first();
        if (!targetUser) {
            const errorEmbed = new EmbedBuilder()
                .setColor(CONFIG.COLORS.ERROR)
                .setTitle('❌ Invalid User')
                .setDescription('Please mention a valid user to wager with.');

            return message.reply({ embeds: [errorEmbed] });
        }

        // Parse amount
        const amount = parseInt(args[1]);
        if (isNaN(amount) || amount <= 0) {
            const errorEmbed = new EmbedBuilder()
                .setColor(CONFIG.COLORS.ERROR)
                .setTitle('❌ Invalid Amount')
                .setDescription('Please provide a valid amount to wager.');

            return message.reply({ embeds: [errorEmbed] });
        }

        // Prevent self-wagering
        if (targetUser.id === userId) {
            const errorEmbed = new EmbedBuilder()
                .setColor(CONFIG.COLORS.ERROR)
                .setTitle('❌ Invalid Wager')
                .setDescription("You can't wager with yourself!");

            return message.reply({ embeds: [errorEmbed] });
        }

        // Check if both users have enough balance
        const userBalance = await economy.getBalance(userId, guildId);
        const targetBalance = await economy.getBalance(targetUser.id, guildId);

        if (userBalance < amount) {
            const errorEmbed = new EmbedBuilder()
                .setColor(CONFIG.COLORS.ERROR)
                .setTitle('❌ Insufficient Balance')
                .setDescription(`You don't have enough Dih!`)
                .addFields(
                    { name: 'Your Balance', value: `${userBalance} cm`, inline: true },
                    { name: 'Required', value: `${amount} cm`, inline: true }
                );

            return message.reply({ embeds: [errorEmbed] });
        }

        if (targetBalance < amount) {
            const errorEmbed = new EmbedBuilder()
                .setColor(CONFIG.COLORS.ERROR)
                .setTitle('❌ Insufficient Balance')
                .setDescription(`${targetUser.username} doesn't have enough Dih!`)
                .addFields(
                    { name: 'Their Balance', value: `${targetBalance} cm`, inline: true },
                    { name: 'Required', value: `${amount} cm`, inline: true }
                );

            return message.reply({ embeds: [errorEmbed] });
        }

        // Create wager embed
        const wagerEmbed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.DEFAULT)
            .setTitle('🎲 Wager Request')
            .setDescription(`${targetUser}, do you accept the wager of ${amount} cm Dih from ${message.author}?`)
            .addFields(
                { name: 'Amount', value: `${amount} cm`, inline: true },
                { name: 'Challenger', value: message.author.username, inline: true }
            )
            .setFooter({ text: 'Click the buttons below to accept or decline' })
            .setTimestamp();

        // Create buttons
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('accept')
                    .setLabel('Accept')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId('decline')
                    .setLabel('Decline')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );

        const wagerMessage = await message.reply({ 
            embeds: [wagerEmbed],
            components: [row]
        });

        // Create button collector
        const filter = i => i.user.id === targetUser.id;
        const collector = wagerMessage.createMessageComponentCollector({ 
            filter, 
            time: 30000 
        });

        collector.on('collect', async i => {
            if (i.customId === 'accept') {
                // 50% chance to win
                const userWins = Math.random() > 0.5;

                if (userWins) {
                    await economy.updateBalance(userId, guildId, amount, 'wager-win');
                    await economy.updateBalance(targetUser.id, guildId, -amount, 'wager-loss');

                    const resultEmbed = new EmbedBuilder()
                        .setColor(CONFIG.COLORS.SUCCESS)
                        .setTitle('🎉 Wager Result')
                        .setDescription(`${message.author} won ${amount} cm Dih from ${targetUser}!`)
                        .addFields(
                            { name: 'Winner', value: message.author.username, inline: true },
                            { name: 'Amount Won', value: `${amount} cm`, inline: true }
                        )
                        .setTimestamp();

                    await i.update({ embeds: [resultEmbed], components: [] });
                } else {
                    await economy.updateBalance(userId, guildId, -amount, 'wager-loss');
                    await economy.updateBalance(targetUser.id, guildId, amount, 'wager-win');

                    const resultEmbed = new EmbedBuilder()
                        .setColor(CONFIG.COLORS.SUCCESS)
                        .setTitle('🎉 Wager Result')
                        .setDescription(`${targetUser} won ${amount} cm Dih from ${message.author}!`)
                        .addFields(
                            { name: 'Winner', value: targetUser.username, inline: true },
                            { name: 'Amount Won', value: `${amount} cm`, inline: true }
                        )
                        .setTimestamp();

                    await i.update({ embeds: [resultEmbed], components: [] });
                }
            } else {
                const declineEmbed = new EmbedBuilder()
                    .setColor(CONFIG.COLORS.ERROR)
                    .setTitle('❌ Wager Declined')
                    .setDescription(`${targetUser} declined the wager.`);

                await i.update({ embeds: [declineEmbed], components: [] });
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                const timeoutEmbed = new EmbedBuilder()
                    .setColor(CONFIG.COLORS.ERROR)
                    .setTitle('⏰ Wager Timed Out')
                    .setDescription('The wager request has expired.');

                await wagerMessage.edit({ embeds: [timeoutEmbed], components: [] });
            }
        });
    }
}

export default WagerCommand; 