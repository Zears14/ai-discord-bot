/**
 * @fileoverview Blackjack command
 * @module commands/blackjack
 */

import { randomInt } from 'node:crypto';
import { EmbedBuilder } from 'discord.js';
import BaseCommand from './BaseCommand.js';
import CONFIG from '../config/config.js';
import commandSessionService from '../services/commandSessionService.js';
import deployLockService from '../services/deployLockService.js';
import economy from '../services/economy.js';
import jsonbService from '../services/jsonbService.js';
import logger from '../services/loggerService.js';
import { formatMoney, parsePositiveAmount } from '../utils/moneyUtils.js';

const shoeCache = new Map();

function getShoeCacheKey(userId, guildId) {
  return `${guildId}:${userId}`;
}

function shuffleCards(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
}

function createShoe() {
  const cards = [];
  const { DECKS } = CONFIG.COMMANDS.BLACKJACK.GAME;

  for (let deck = 0; deck < DECKS; deck++) {
    for (const suit of CONFIG.COMMANDS.BLACKJACK.SUITS) {
      for (const rank of CONFIG.COMMANDS.BLACKJACK.RANKS) {
        cards.push({ card: rank, suit });
      }
    }
  }

  shuffleCards(cards);
  return cards;
}

function isValidCard(cardObj) {
  return (
    cardObj &&
    typeof cardObj === 'object' &&
    typeof cardObj.card === 'string' &&
    typeof cardObj.suit === 'string' &&
    CONFIG.COMMANDS.BLACKJACK.RANKS.includes(cardObj.card) &&
    CONFIG.COMMANDS.BLACKJACK.SUITS.includes(cardObj.suit)
  );
}

function normalizeShoe(rawShoe) {
  if (!Array.isArray(rawShoe)) {
    return null;
  }

  return rawShoe.filter(isValidCard);
}

function drawCard(shoe) {
  return shoe.pop();
}

function formatCard(cardObj) {
  return `${cardObj.card}${cardObj.suit}`;
}

function calculateHandDetails(hand) {
  let value = 0;
  let aces = 0;

  for (const cardObj of hand) {
    if (cardObj.card === 'A') {
      aces++;
      value += 11;
    } else {
      value += CONFIG.COMMANDS.BLACKJACK.CARD_VALUES[cardObj.card];
    }
  }

  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }

  return {
    value,
    isSoft: aces > 0,
  };
}

function calculateHandValue(hand) {
  return calculateHandDetails(hand).value;
}

function buildButtons(canSurrender, isHighTable) {
  const hitButton = {
    type: 2,
    style: isHighTable ? 4 : 1,
    label: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIT} Hit`,
    custom_id: 'blackjack:hit',
  };
  const standButton = {
    type: 2,
    style: isHighTable ? 1 : 4,
    label: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.STAND} Stand`,
    custom_id: 'blackjack:stand',
  };

  const components = [hitButton, standButton];
  if (canSurrender) {
    components.push({
      type: 2,
      style: 2,
      label: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.SURRENDER} Surrender`,
      custom_id: 'blackjack:surrender',
    });
  }

  return [
    {
      type: 1,
      components,
    },
  ];
}

function buildFooterText(shoeLength, totalShoeCards, allowSurrender) {
  const instructions = allowSurrender
    ? `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.INSTRUCTIONS} React with Hit, Stand, or Surrender`
    : `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.INSTRUCTIONS} React with Hit or Stand`;
  return `${instructions} • Shoe: ${shoeLength}/${totalShoeCards}`;
}

function buildInitialEmbed({
  bet,
  isHighTable,
  canSurrender,
  playerHand,
  dealerHand,
  reshuffleNotice,
  shoeLength,
  totalShoeCards,
}) {
  const playerValue = calculateHandValue(playerHand);
  const tableNotice = isHighTable
    ? `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIGH_TABLE} This is now a High Table. Dealer hits on soft 17.`
    : `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.SURRENDER} Surrender is available before your first action for a 50% refund.`;

  return new EmbedBuilder()
    .setColor(
      isHighTable
        ? CONFIG.COMMANDS.BLACKJACK.COLORS.HIGH_TABLE_IN_PROGRESS
        : CONFIG.COMMANDS.BLACKJACK.COLORS.IN_PROGRESS
    )
    .setTitle(
      `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.TITLE} Blackjack${isHighTable ? ' • High Table' : ''}`
    )
    .setDescription(
      `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(bet)} cm\n${tableNotice}${reshuffleNotice}`
    )
    .addFields(
      {
        name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
        value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`,
        inline: true,
      },
      {
        name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
        value: `${formatCard(dealerHand[0])} ${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIDDEN}`,
        inline: true,
      }
    )
    .setFooter({
      text: buildFooterText(shoeLength, totalShoeCards, canSurrender),
    });
}

function parseSession(session) {
  if (!session || typeof session !== 'object') {
    return null;
  }

  try {
    const bet = BigInt(session.bet);
    const playerHand = Array.isArray(session.playerHand)
      ? session.playerHand.filter(isValidCard)
      : [];
    const dealerHand = Array.isArray(session.dealerHand)
      ? session.dealerHand.filter(isValidCard)
      : [];
    const shoe = normalizeShoe(session.shoe) || [];
    const totalShoeCards = Number(session.totalShoeCards || 312);

    if (playerHand.length < 2 || dealerHand.length < 2) {
      return null;
    }

    return {
      ...session,
      bet,
      playerHand,
      dealerHand,
      shoe,
      totalShoeCards,
      canSurrender: Boolean(session.canSurrender),
      hasTakenAction: Boolean(session.hasTakenAction),
      isHighTable: Boolean(session.isHighTable),
      expiresAt: Number(session.expiresAt || 0),
    };
  } catch {
    return null;
  }
}

async function persistShoe(userId, guildId, shoeStateKey, shoe) {
  const shoeCacheKey = getShoeCacheKey(userId, guildId);
  shoeCache.set(shoeCacheKey, shoe);

  try {
    await jsonbService.setKey(userId, guildId, shoeStateKey, shoe);
  } catch (error) {
    logger.discord.dbError('Failed to persist blackjack shoe:', error);
  }
}

class BlackjackCommand extends BaseCommand {
  constructor(client) {
    super(client, {
      name: 'blackjack',
      description: 'Play blackjack with your Dih',
      category: 'Economy',
      usage: 'blackjack <bet>',
      cooldown: CONFIG.COMMANDS.COOLDOWNS.ECONOMY,
      aliases: ['bj', '21'],
      exclusiveSession: true,
      exclusiveSessionTtlSeconds: 50,
      interactionPrefix: 'blackjack',
    });
  }

  async execute(message, args) {
    const userId = message.author.id;
    const guildId = message.guild.id;

    if (args.length !== 1) {
      return message.reply('Please provide an amount to bet. Usage: `blackjack <bet>`');
    }

    let bet;
    try {
      bet = parsePositiveAmount(args[0], 'Bet amount');
    } catch {
      return message.reply('Please provide a valid amount to bet.');
    }

    const balance = await economy.getBalance(userId, guildId);
    if (balance < bet) {
      return message.reply(`You don't have enough Dih! Your balance: ${formatMoney(balance)} cm`);
    }

    const highTableMinBet = CONFIG.COMMANDS.BLACKJACK.GAME.HIGH_TABLE_MIN_BET;
    const isHighTable = bet >= highTableMinBet;
    const canSurrender = bet < highTableMinBet;
    const shoeStateKey = CONFIG.COMMANDS.BLACKJACK.GAME.SHOE_STATE_KEY;
    const reshuffleAt = CONFIG.COMMANDS.BLACKJACK.GAME.SHOE_RESHUFFLE_AT;
    const shoeCacheKey = getShoeCacheKey(userId, guildId);
    const totalShoeCards =
      CONFIG.COMMANDS.BLACKJACK.GAME.DECKS *
      CONFIG.COMMANDS.BLACKJACK.RANKS.length *
      CONFIG.COMMANDS.BLACKJACK.SUITS.length;

    let shoe = normalizeShoe(shoeCache.get(shoeCacheKey));

    if (!shoe) {
      try {
        shoe = normalizeShoe(await jsonbService.getKey(userId, guildId, shoeStateKey));
      } catch (error) {
        logger.discord.dbError('Failed to load blackjack shoe:', error);
      }
    }

    let shoeReshuffled = false;
    if (!shoe || shoe.length < reshuffleAt) {
      shoe = createShoe();
      shoeReshuffled = true;
    }
    shoeCache.set(shoeCacheKey, shoe);

    const drawFromShoe = () => {
      if (shoe.length === 0) {
        shoe = createShoe();
        shoeReshuffled = true;
      }
      return drawCard(shoe);
    };

    await economy.updateBalance(userId, guildId, -bet, 'blackjack-bet');

    const playerHand = [drawFromShoe(), drawFromShoe()];
    const dealerHand = [drawFromShoe(), drawFromShoe()];
    const playerValue = calculateHandValue(playerHand);
    const reshuffleNotice = shoeReshuffled
      ? '\n🃏 A fresh 6-deck shoe was shuffled for this hand.'
      : '';

    const gameEmbed = buildInitialEmbed({
      bet,
      isHighTable,
      canSurrender,
      playerHand,
      dealerHand,
      reshuffleNotice,
      shoeLength: shoe.length,
      totalShoeCards,
    });

    if (playerValue === 21) {
      const dealerValue = calculateHandValue(dealerHand);
      if (dealerValue === 21) {
        await economy.updateBalance(userId, guildId, bet, 'blackjack-push');
        gameEmbed
          .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.PUSH)
          .setDescription(
            `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(bet)} cm\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PUSH} Blackjack! Push - your bet is returned.`
          )
          .setFields(
            {
              name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
              value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`,
              inline: true,
            },
            {
              name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
              value: `${dealerHand.map(formatCard).join(' ')} (${dealerValue})`,
              inline: true,
            }
          );
        await persistShoe(userId, guildId, shoeStateKey, shoe);
        return message.reply({ embeds: [gameEmbed] });
      }

      const winnings = (bet * 3n) / 2n;
      await economy.updateBalance(userId, guildId, bet + winnings, 'blackjack-win');
      gameEmbed
        .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.WIN)
        .setDescription(
          `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(bet)} cm\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.WIN} Blackjack! You win ${formatMoney(winnings)} cm Dih!`
        )
        .setFields(
          {
            name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
            value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`,
            inline: true,
          },
          {
            name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
            value: `${dealerHand.map(formatCard).join(' ')} (${dealerValue})`,
            inline: true,
          }
        );
      await persistShoe(userId, guildId, shoeStateKey, shoe);
      return message.reply({ embeds: [gameEmbed] });
    }

    const dealerInitialValue = calculateHandValue(dealerHand);
    if (dealerInitialValue === 21) {
      await economy.updateBalance(userId, guildId, bet, 'blackjack-push');
      gameEmbed
        .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.PUSH)
        .setDescription(
          `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(bet)} cm\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PUSH} Dealer has blackjack. Your bet is returned.`
        )
        .setFields(
          {
            name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
            value: `${playerHand.map(formatCard).join(' ')} (${playerValue})`,
            inline: true,
          },
          {
            name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
            value: `${dealerHand.map(formatCard).join(' ')} (${dealerInitialValue})`,
            inline: true,
          }
        );
      await persistShoe(userId, guildId, shoeStateKey, shoe);
      return message.reply({ embeds: [gameEmbed] });
    }

    const gameReply = await message.reply({
      embeds: [gameEmbed],
      components: buildButtons(canSurrender, isHighTable),
    });

    const timeoutMs = CONFIG.COMMANDS.BLACKJACK.GAME.TIMEOUT;
    const expiresAt = Date.now() + timeoutMs;
    const stored = await commandSessionService.setSession(
      'blackjack',
      gameReply.id,
      {
        userId,
        guildId,
        bet: bet.toString(),
        isHighTable,
        canSurrender,
        hasTakenAction: false,
        playerHand,
        dealerHand,
        shoe,
        totalShoeCards,
        shoeStateKey,
        expiresAt,
      },
      Math.ceil(timeoutMs / 1000) + 30
    );

    if (!stored) {
      await economy.updateBalance(userId, guildId, bet, 'blackjack-push');
      await commandSessionService.releaseExclusiveSession(userId, guildId);
      await gameReply
        .edit({
          embeds: [
            new EmbedBuilder()
              .setColor(CONFIG.COLORS.ERROR)
              .setTitle('❌ Blackjack Unavailable')
              .setDescription('Could not start blackjack session. Your bet was refunded.')
              .setTimestamp(),
          ],
          components: [],
        })
        .catch(() => {});
      await persistShoe(userId, guildId, shoeStateKey, shoe);
      return { skipCooldown: true };
    }

    return { keepExclusiveSession: true };
  }

  async handleInteraction(interaction) {
    const action = (interaction.customId || '').split(':')[1];
    if (!action || !['hit', 'stand', 'surrender'].includes(action)) {
      await interaction.deferUpdate().catch(() => {});
      return;
    }

    const messageId = interaction.message.id;
    const lockAcquired = await deployLockService.acquireLock(`blackjack:session:${messageId}`, 5);
    if (!lockAcquired) {
      await interaction.deferUpdate().catch(() => {});
      return;
    }

    const rawSession = await commandSessionService.getSession('blackjack', messageId);
    const session = parseSession(rawSession);
    if (!session) {
      await interaction
        .reply({
          content:
            'This blackjack hand is no longer active. Start a new game with `blackjack <bet>`.',
          ephemeral: true,
        })
        .catch(() => {});
      return;
    }

    const { userId, guildId } = session;
    if (interaction.user.id !== userId) {
      await interaction
        .reply({
          content: 'This blackjack hand is not yours.',
          ephemeral: true,
        })
        .catch(() => {});
      return;
    }

    const now = Date.now();
    if (session.expiresAt <= now) {
      const timeoutEmbed = new EmbedBuilder()
        .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.LOSE)
        .setTitle(
          `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.TITLE} Blackjack${session.isHighTable ? ' • High Table' : ''}`
        )
        .setDescription(
          `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.TIMEOUT} Game timed out! You forfeited ${formatMoney(session.bet)} cm Dih.`
        )
        .setFooter({
          text: buildFooterText(session.shoe.length, session.totalShoeCards, false),
        })
        .setFields(
          {
            name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
            value: `${session.playerHand.map(formatCard).join(' ')} (${calculateHandValue(session.playerHand)})`,
            inline: true,
          },
          {
            name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
            value: `${formatCard(session.dealerHand[0])} ${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIDDEN}`,
            inline: true,
          }
        );

      await interaction.update({ embeds: [timeoutEmbed], components: [] }).catch(async () => {
        await interaction.message.edit({ embeds: [timeoutEmbed], components: [] }).catch(() => {});
      });

      await economy.updateBalance(userId, guildId, 0n, 'blackjack-loss').catch((error) => {
        logger.discord.dbError('Failed to settle timed-out blackjack game:', error);
      });

      await persistShoe(userId, guildId, session.shoeStateKey, session.shoe);
      await commandSessionService.deleteSession('blackjack', messageId);
      await commandSessionService.releaseExclusiveSession(userId, guildId);
      return;
    }

    const drawFromShoe = () => {
      if (session.shoe.length === 0) {
        session.shoe = createShoe();
      }
      return drawCard(session.shoe);
    };

    if (action === 'surrender') {
      if (!session.canSurrender || session.hasTakenAction) {
        await interaction
          .reply({
            content:
              'Surrender is only available before your first action on tables below 10,000 cm.',
            ephemeral: true,
          })
          .catch(() => {});
        return;
      }

      const refund = session.bet / 2n;
      await economy.updateBalance(userId, guildId, refund, 'blackjack-surrender');

      const resultEmbed = new EmbedBuilder()
        .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.PUSH)
        .setTitle(
          `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.TITLE} Blackjack${session.isHighTable ? ' • High Table' : ''}`
        )
        .setDescription(
          `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(session.bet)} cm\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.SURRENDER} You surrendered and got back ${formatMoney(refund)} cm Dih.`
        )
        .setFooter({
          text: buildFooterText(session.shoe.length, session.totalShoeCards, session.canSurrender),
        })
        .setFields(
          {
            name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
            value: `${session.playerHand.map(formatCard).join(' ')} (${calculateHandValue(session.playerHand)})`,
            inline: true,
          },
          {
            name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
            value: `${session.dealerHand.map(formatCard).join(' ')} (${calculateHandValue(session.dealerHand)})`,
            inline: true,
          }
        );

      await interaction.update({ embeds: [resultEmbed], components: [] });
      await persistShoe(userId, guildId, session.shoeStateKey, session.shoe);
      await commandSessionService.deleteSession('blackjack', messageId);
      await commandSessionService.releaseExclusiveSession(userId, guildId);
      return;
    }

    if (action === 'hit') {
      session.hasTakenAction = true;
      const drawnCard = drawFromShoe();
      session.playerHand.push(drawnCard);
      const playerValue = calculateHandValue(session.playerHand);

      if (playerValue > 21) {
        await economy.updateBalance(userId, guildId, 0n, 'blackjack-loss');

        const bustEmbed = new EmbedBuilder()
          .setColor(CONFIG.COMMANDS.BLACKJACK.COLORS.LOSE)
          .setTitle(
            `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.TITLE} Blackjack${session.isHighTable ? ' • High Table' : ''}`
          )
          .setDescription(
            `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(session.bet)} cm\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIT} You drew: ${formatCard(drawnCard)}\n${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BUST} Bust! You lose ${formatMoney(session.bet)} cm Dih.`
          )
          .setFooter({
            text: buildFooterText(session.shoe.length, session.totalShoeCards, false),
          })
          .setFields(
            {
              name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
              value: `${session.playerHand.map(formatCard).join(' ')} (${playerValue})`,
              inline: true,
            },
            {
              name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
              value: `${session.dealerHand.map(formatCard).join(' ')} (${calculateHandValue(session.dealerHand)})`,
              inline: true,
            }
          );

        await interaction.update({ embeds: [bustEmbed], components: [] });
        await persistShoe(userId, guildId, session.shoeStateKey, session.shoe);
        await commandSessionService.deleteSession('blackjack', messageId);
        await commandSessionService.releaseExclusiveSession(userId, guildId);
        return;
      }

      const inProgressEmbed = new EmbedBuilder()
        .setColor(
          session.isHighTable
            ? CONFIG.COMMANDS.BLACKJACK.COLORS.HIGH_TABLE_IN_PROGRESS
            : CONFIG.COMMANDS.BLACKJACK.COLORS.IN_PROGRESS
        )
        .setTitle(
          `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.TITLE} Blackjack${session.isHighTable ? ' • High Table' : ''}`
        )
        .setDescription(
          `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(session.bet)} cm`
        )
        .setFooter({
          text: buildFooterText(session.shoe.length, session.totalShoeCards, false),
        })
        .setFields(
          {
            name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
            value: `${session.playerHand.map(formatCard).join(' ')} (${playerValue})`,
            inline: true,
          },
          {
            name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
            value: `${formatCard(session.dealerHand[0])} ${CONFIG.COMMANDS.BLACKJACK.EMOJIS.HIDDEN}`,
            inline: true,
          }
        );

      await interaction.update({
        embeds: [inProgressEmbed],
        components: buildButtons(false, session.isHighTable),
      });

      const ttlSeconds = Math.max(1, Math.ceil((session.expiresAt - now) / 1000));
      await commandSessionService.setSession(
        'blackjack',
        messageId,
        {
          ...session,
          bet: session.bet.toString(),
        },
        ttlSeconds
      );
      return;
    }

    session.hasTakenAction = true;
    let dealerDetails = calculateHandDetails(session.dealerHand);
    while (
      dealerDetails.value < CONFIG.COMMANDS.BLACKJACK.GAME.DEALER_STAND_VALUE ||
      (session.isHighTable &&
        dealerDetails.value === CONFIG.COMMANDS.BLACKJACK.GAME.DEALER_STAND_VALUE &&
        dealerDetails.isSoft)
    ) {
      session.dealerHand.push(drawFromShoe());
      dealerDetails = calculateHandDetails(session.dealerHand);
    }

    const dealerValue = dealerDetails.value;
    const playerValue = calculateHandValue(session.playerHand);
    let result;
    let color;

    if (dealerValue > 21) {
      result = `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.WIN} Dealer busts! You win ${formatMoney(session.bet)} cm Dih!`;
      await economy.updateBalance(userId, guildId, session.bet * 2n, 'blackjack-win');
      color = CONFIG.COMMANDS.BLACKJACK.COLORS.WIN;
    } else if (dealerValue > playerValue) {
      result = `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.LOSE} Dealer wins! You lose ${formatMoney(session.bet)} cm Dih.`;
      await economy.updateBalance(userId, guildId, 0n, 'blackjack-loss');
      color = CONFIG.COMMANDS.BLACKJACK.COLORS.LOSE;
    } else if (dealerValue < playerValue) {
      result = `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.WIN} You win ${formatMoney(session.bet)} cm Dih!`;
      await economy.updateBalance(userId, guildId, session.bet * 2n, 'blackjack-win');
      color = CONFIG.COMMANDS.BLACKJACK.COLORS.WIN;
    } else {
      result = `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PUSH} Push - your bet is returned.`;
      await economy.updateBalance(userId, guildId, session.bet, 'blackjack-push');
      color = CONFIG.COMMANDS.BLACKJACK.COLORS.PUSH;
    }

    const resultEmbed = new EmbedBuilder()
      .setColor(color)
      .setTitle(
        `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.TITLE} Blackjack${session.isHighTable ? ' • High Table' : ''}`
      )
      .setDescription(
        `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.BET} Bet: ${formatMoney(session.bet)} cm\n${result}`
      )
      .setFooter({
        text: buildFooterText(session.shoe.length, session.totalShoeCards, false),
      })
      .setFields(
        {
          name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.PLAYER} Your Hand`,
          value: `${session.playerHand.map(formatCard).join(' ')} (${playerValue})`,
          inline: true,
        },
        {
          name: `${CONFIG.COMMANDS.BLACKJACK.EMOJIS.DEALER} Dealer's Hand`,
          value: `${session.dealerHand.map(formatCard).join(' ')} (${dealerValue})`,
          inline: true,
        }
      );

    await interaction.update({ embeds: [resultEmbed], components: [] });
    await persistShoe(userId, guildId, session.shoeStateKey, session.shoe);
    await commandSessionService.deleteSession('blackjack', messageId);
    await commandSessionService.releaseExclusiveSession(userId, guildId);
  }
}

export default BlackjackCommand;
