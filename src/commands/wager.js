import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import economy from '../services/economy.js';
import { formatMoney, parsePositiveAmount } from '../utils/moneyUtils.js';

class WagerCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'wager',
      description: 'Wager your Dih with another user',
      category: 'Economy',
      usage: 'wager <@user> <amount>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: ['bet', 'gamble'],
      exclusiveSession: true,
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
    let amount;
    try {
      amount = parsePositiveAmount(args[1], 'Wager amount');
    } catch {
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
        .setDescription("You don't have enough Dih!")
        .addFields(
          { name: 'Your Balance', value: `${formatMoney(userBalance)} cm`, inline: true },
          { name: 'Required', value: `${formatMoney(amount)} cm`, inline: true }
        );

      return message.reply({ embeds: [errorEmbed] });
    }

    if (targetBalance < amount) {
      const errorEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.ERROR)
        .setTitle('❌ Insufficient Balance')
        .setDescription(`${targetUser.username} doesn't have enough Dih!`)
        .addFields(
          { name: 'Their Balance', value: `${formatMoney(targetBalance)} cm`, inline: true },
          { name: 'Required', value: `${formatMoney(amount)} cm`, inline: true }
        );

      return message.reply({ embeds: [errorEmbed] });
    }

    // Create wager embed
    const wagerEmbed = new EmbedBuilder()
      .setColor(CONFIG.COLORS.DEFAULT)
      .setTitle('🎲 Wager Request')
      .setDescription(
        `${targetUser}, do you accept the wager of ${formatMoney(amount)} cm Dih from ${message.author}?`
      )
      .addFields(
        { name: 'Amount', value: `${formatMoney(amount)} cm`, inline: true },
        { name: 'Challenger', value: message.author.username, inline: true }
      )
      .setFooter({ text: 'Click the buttons below to accept or decline' })
      .setTimestamp();

    // Create buttons
    const row = new ActionRowBuilder().addComponents(
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
      components: [row],
    });

    // Create button collector
    const filter = (i) => i.user.id === targetUser.id;
    const collector = wagerMessage.createMessageComponentCollector({
      filter,
      time: 30000,
    });
    let resolved = false;

    collector.on('collect', async (i) => {
      if (resolved) {
        return i.reply({
          content: 'This wager has already been resolved.',
          ephemeral: true,
        });
      }

      if (i.customId === 'accept') {
        resolved = true;
        // 50% chance to win
        const userWins = Math.random() > 0.5;
        const winnerId = userWins ? userId : targetUser.id;
        const loserId = userWins ? targetUser.id : userId;
        const winnerName = userWins ? message.author.username : targetUser.username;

        try {
          await economy.transferBalance(loserId, winnerId, guildId, amount, 'wager');

          const resultEmbed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.SUCCESS)
            .setTitle('🎉 Wager Result')
            .setDescription(`${winnerName} won ${formatMoney(amount)} cm Dih from the wager!`)
            .addFields(
              { name: 'Winner', value: winnerName, inline: true },
              { name: 'Amount Won', value: `${formatMoney(amount)} cm`, inline: true }
            )
            .setTimestamp();

          await i.update({ embeds: [resultEmbed], components: [] });
        } catch {
          const failedEmbed = new EmbedBuilder()
            .setColor(CONFIG.COLORS.ERROR)
            .setTitle('❌ Wager Canceled')
            .setDescription(
              'Wager could not be settled because one player no longer has enough Dih.'
            )
            .setTimestamp();

          await i.update({ embeds: [failedEmbed], components: [] });
        }
        collector.stop('resolved');
      } else {
        resolved = true;
        const declineEmbed = new EmbedBuilder()
          .setColor(CONFIG.COLORS.ERROR)
          .setTitle('❌ Wager Declined')
          .setDescription(`${targetUser} declined the wager.`);

        await i.update({ embeds: [declineEmbed], components: [] });
        collector.stop('declined');
      }
    });

    collector.on('end', async (_collected, reason) => {
      if (reason === 'time') {
        const timeoutEmbed = new EmbedBuilder()
          .setColor(CONFIG.COLORS.ERROR)
          .setTitle('⏰ Wager Timed Out')
          .setDescription('The wager request has expired.');

        await wagerMessage.edit({ embeds: [timeoutEmbed], components: [] });
      }
    });

    // Keep the command session active until the collector ends
    await new Promise((resolve) => {
      collector.on('end', resolve);
    });
  }
}

export default WagerCommand;
