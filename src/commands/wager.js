import { randomInt } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import commandSessionService from '../services/commandSessionService.js';
import deployLockService from '../services/deployLockService.js';
import economy from '../services/economy.js';
import { formatMoney, parsePositiveAmount } from '../utils/moneyUtils.js';

const WAGER_TIMEOUT_MS = 30000;

function buildWagerButtons(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('wager:accept')
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅')
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('wager:decline')
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌')
      .setDisabled(disabled)
  );
}

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
      exclusiveSessionTtlSeconds: 45,
      interactionPrefix: 'wager',
    });
  }

  async execute(message, args) {
    const userId = message.author.id;
    const guildId = message.guild.id;

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

    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      const errorEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.ERROR)
        .setTitle('❌ Invalid User')
        .setDescription('Please mention a valid user to wager with.');

      return message.reply({ embeds: [errorEmbed] });
    }

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

    if (targetUser.id === userId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.ERROR)
        .setTitle('❌ Invalid Wager')
        .setDescription("You can't wager with yourself!");

      return message.reply({ embeds: [errorEmbed] });
    }

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

    const wagerMessage = await message.reply({
      embeds: [wagerEmbed],
      components: [buildWagerButtons(false)],
    });

    const expiresAt = Date.now() + WAGER_TIMEOUT_MS;
    const stored = await commandSessionService.setSession(
      'wager',
      wagerMessage.id,
      {
        challengerId: userId,
        challengerName: message.author.username,
        targetUserId: targetUser.id,
        targetName: targetUser.username,
        guildId,
        amount: amount.toString(),
        expiresAt,
        resolved: false,
      },
      Math.ceil(WAGER_TIMEOUT_MS / 1000) + 15
    );

    if (!stored) {
      await commandSessionService.releaseExclusiveSession(userId, guildId);
      await wagerMessage
        .edit({
          embeds: [
            new EmbedBuilder()
              .setColor(CONFIG.COLORS.ERROR)
              .setTitle('❌ Wager Unavailable')
              .setDescription('Could not start wager session. Please try again.')
              .setTimestamp(),
          ],
          components: [],
        })
        .catch(() => {});
      return { skipCooldown: true };
    }

    return { keepExclusiveSession: true };
  }

  async handleInteraction(interaction) {
    const action = (interaction.customId || '').split(':')[1];
    if (!action || (action !== 'accept' && action !== 'decline')) {
      await interaction.deferUpdate().catch(() => {});
      return;
    }

    const messageId = interaction.message.id;
    const lockAcquired = await deployLockService.acquireLock(`wager:session:${messageId}`, 5);
    if (!lockAcquired) {
      await interaction.deferUpdate().catch(() => {});
      return;
    }

    const session = await commandSessionService.getSession('wager', messageId);
    if (!session) {
      await interaction
        .reply({
          content: 'This wager has already expired.',
          ephemeral: true,
        })
        .catch(() => {});
      return;
    }

    if (session.targetUserId !== interaction.user.id) {
      await interaction
        .reply({
          content: 'Only the challenged user can respond to this wager.',
          ephemeral: true,
        })
        .catch(() => {});
      return;
    }

    const now = Date.now();
    const expiresAt = Number(session.expiresAt || 0);
    if (Boolean(session.resolved) || expiresAt <= now) {
      await commandSessionService.deleteSession('wager', messageId);
      await commandSessionService.releaseExclusiveSession(session.challengerId, session.guildId);

      const timeoutEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.ERROR)
        .setTitle('⏰ Wager Timed Out')
        .setDescription('The wager request has expired.')
        .setTimestamp();

      await interaction
        .update({
          embeds: [timeoutEmbed],
          components: [],
        })
        .catch(async () => {
          await interaction.message
            .edit({ embeds: [timeoutEmbed], components: [] })
            .catch(() => {});
        });
      return;
    }

    await interaction.deferUpdate().catch(() => {});

    let resultEmbed;
    if (action === 'accept') {
      const userWins = randomInt(0, 2) === 1;
      const winnerId = userWins ? session.challengerId : session.targetUserId;
      const loserId = userWins ? session.targetUserId : session.challengerId;
      const winnerName = userWins ? session.challengerName : session.targetName;
      const amount = BigInt(session.amount);

      try {
        await economy.transferBalance(loserId, winnerId, session.guildId, amount, 'wager');

        resultEmbed = new EmbedBuilder()
          .setColor(CONFIG.COLORS.SUCCESS)
          .setTitle('🎉 Wager Result')
          .setDescription(`${winnerName} won ${formatMoney(amount)} cm Dih from the wager!`)
          .addFields(
            { name: 'Winner', value: winnerName, inline: true },
            { name: 'Amount Won', value: `${formatMoney(amount)} cm`, inline: true }
          )
          .setTimestamp();
      } catch {
        resultEmbed = new EmbedBuilder()
          .setColor(CONFIG.COLORS.ERROR)
          .setTitle('❌ Wager Canceled')
          .setDescription('Wager could not be settled because one player no longer has enough Dih.')
          .setTimestamp();
      }
    } else {
      resultEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.ERROR)
        .setTitle('❌ Wager Declined')
        .setDescription(`<@${session.targetUserId}> declined the wager.`)
        .setTimestamp();
    }

    await interaction.editReply({
      embeds: [resultEmbed],
      components: [],
    });

    await commandSessionService.deleteSession('wager', messageId);
    await commandSessionService.releaseExclusiveSession(session.challengerId, session.guildId);
  }
}

export default WagerCommand;
